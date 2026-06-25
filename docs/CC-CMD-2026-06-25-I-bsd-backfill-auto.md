# CC-CMD I: Auto-Backfill WC bsd_event_ids (CC-CMD-H Task 1, automated)
**Date:** 2026-06-25 · **Repo:** field-relay-nba · **Rule 87:** Self-completing.
**Replaces:** CC-CMD-H Task 1 (deferred because it embedded a CF_API_TOKEN
Python script — Rule 80 violation). This version is credential-clean and
auto-fires on every WC game-final.
**Cross-repo dep:** field-relay-nba HEAD ≥ `52aebd4`.

---

## WHAT THIS DOES

Two pieces, one commit:

1. **`backfillWCBsdEventIds(env, { leagueId?, since? })`** — reusable function.
   - Fetches BSD season events for the WC league_id.
   - Matches to `wc_results` rows that lack `bsd_event_id` (normalized name
     compare, both orientations).
   - UPDATEs the matched rows. All writes via the `WC2026_DB` D1 binding —
     no CF API token needed anywhere in this session or the worker.

2. **`POST /admin/wc/bsd-backfill`** — auth-gated endpoint.
   - `Authorization: Bearer ${FIELD_MCP_SECRET}` (matches other admin endpoints).
   - Body (all optional): `{ leagueId?: string, since?: 'YYYY-MM-DD' }`.
   - If `leagueId` omitted, calls `/bsd/events/live` and extracts the
     first WC `league_id` from any live WC event.
   - Returns `{ ok, season_events, matched, updated, remaining_null }`.

3. **Auto-fire hook in `writeWCResult`** — at game-final, when this game
   wrote a `bsd_event_id`, fire-and-forget call to `backfillWCBsdEventIds`
   via `ctx.waitUntil` (passed through to writeWCResult; already in scope).
   Gate via KV key `bsd:backfill:done:{YYYY-MM-DD}` with 24h TTL so
   backfill runs at most once per day. First final of the day triggers
   it; subsequent finals skip.

End result: as soon as the first WC game of tonight goes final with a
`bsd_event_id`, the relay automatically discovers the WC `league_id`,
scans BSD's season events, and updates every wc_results row whose names
match. No manual probe, no manual UPDATE, no credential handling.

---

## PROBE BLOCK

```bash
cd /home/claude/field-relay-nba && git pull

# 1. Confirm writeWCResult exists + already writes bsd_event_id
grep -n "writeWCResult\|bsd_event_id" src/index.js | head -10

# 2. Confirm /bsd/events/season is wired
grep -n "/bsd/events/season" src/index.js | head -3

# 3. Confirm FIELD_MCP_SECRET pattern (auth model)
grep -n "FIELD_MCP_SECRET" src/index.js | head -5

# 4. Confirm FIELD_JOURNALISM KV is bound (for the gate key)
grep "FIELD_JOURNALISM" wrangler.toml

# 5. Confirm wc_results schema has bsd_event_id column
curl -s https://field-relay-nba.jeffunglesbee.workers.dev/wc/results?group=A \
  | python3 -c "import json,sys; r=json.load(sys.stdin)['results']; \
    print('keys:', list(r[0].keys()) if r else 'empty')"

# 6. Confirm no /admin/wc/bsd-backfill route exists yet
grep -c '/admin/wc/bsd-backfill' src/index.js
# Expected: 0
```

---

## TASK 1 — `backfillWCBsdEventIds` function

Add as a module-level function near `writeWCResult` in `src/index.js`:

```javascript
// ── Auto-backfill: discover BSD league_id + UPDATE wc_results rows ─────
// Called by /admin/wc/bsd-backfill (manual trigger) and by writeWCResult
// once per day after the first WC final with a bsd_event_id.
// No external credentials — uses the relay's own /bsd routes + WC2026_DB binding.
async function backfillWCBsdEventIds(env, { leagueId, since } = {}) {
    if (!env?.WC2026_DB || !env?.BSD_API_TOKEN) {
        return { ok: false, error: 'WC2026_DB or BSD_API_TOKEN unbound' };
    }
    const bsdBase = 'https://sports.bzzoiro.com';
    const bsdHdrs = {
        'Authorization': `Token ${env.BSD_API_TOKEN}`,
        'User-Agent': 'FIELD/1.0',
        'Accept': 'application/json',
    };

    // 1. Discover league_id if not provided — probe live, take any WC league_id
    let league = leagueId ? String(leagueId) : null;
    if (!league) {
        try {
            const r = await fetch(`${bsdBase}/api/v2/events/live/`,
                { headers: bsdHdrs, signal: AbortSignal.timeout(5000) });
            if (r.ok) {
                const d = await r.json();
                const events = Array.isArray(d.events) ? d.events : [];
                // WC team names are countries — pick first event whose
                // home/away match an existing wc_results team.
                const { results: knownTeams } = await env.WC2026_DB.prepare(
                    'SELECT DISTINCT home AS t FROM wc_results UNION SELECT DISTINCT away FROM wc_results'
                ).all();
                const known = new Set((knownTeams || []).map(r =>
                    String(r.t || '').toLowerCase().replace(/[^a-z0-9]/g, '')));
                for (const ev of events) {
                    const bh = String(ev.home_team?.name ?? ev.home_team ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
                    const ba = String(ev.away_team?.name ?? ev.away_team ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
                    if (known.has(bh) || known.has(ba)) {
                        league = String(ev.league_id || ev.league?.id || '');
                        if (league) break;
                    }
                }
            }
        } catch (_) {}
    }
    if (!league) return { ok: false, error: 'league_id not discoverable from live events' };

    // 2. Fetch BSD season events for that league_id
    let seasonEvents = [];
    try {
        const r = await fetch(`${bsdBase}/api/v2/events/season/?league_id=${league}`,
            { headers: bsdHdrs, signal: AbortSignal.timeout(10_000) });
        if (r.ok) {
            const d = await r.json();
            seasonEvents = d.results || d.events || [];
        }
    } catch (_) {}
    if (!seasonEvents.length) return { ok: false, error: 'BSD season returned no events', league_id: league };

    // 3. Load wc_results rows lacking bsd_event_id (optionally filtered by since)
    const sinceClause = since ? 'AND match_date >= ?' : '';
    const stmt = env.WC2026_DB.prepare(
        `SELECT game_id, home, away, match_date FROM wc_results
         WHERE bsd_event_id IS NULL ${sinceClause}`);
    const { results: pending } = await (since ? stmt.bind(since) : stmt).all();
    if (!pending?.length) return { ok: true, league_id: league, season_events: seasonEvents.length,
                                    matched: 0, updated: 0, remaining_null: 0 };

    // 4. Match by normalized name (both orientations)
    const norm = s => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    const matches = [];
    for (const wr of pending) {
        const wh = norm(wr.home), wa = norm(wr.away);
        const hit = seasonEvents.find(be => {
            const bh = norm(be.home_team?.name ?? be.home_team);
            const ba = norm(be.away_team?.name ?? be.away_team);
            return (bh === wh && ba === wa) || (bh === wa && ba === wh);
        });
        if (hit) matches.push({ game_id: wr.game_id, bsd_event_id: String(hit.id) });
    }

    // 5. UPDATE matched rows (batch via prepare loop — D1 doesn't accept array bind in UPDATE)
    let updated = 0;
    for (const m of matches) {
        const r = await env.WC2026_DB.prepare(
            'UPDATE wc_results SET bsd_event_id = ? WHERE game_id = ? AND bsd_event_id IS NULL'
        ).bind(m.bsd_event_id, m.game_id).run();
        if (r?.meta?.changes) updated += r.meta.changes;
    }

    // 6. Re-count remaining nulls
    const { results: stillNull } = await env.WC2026_DB.prepare(
        'SELECT COUNT(*) AS n FROM wc_results WHERE bsd_event_id IS NULL'
    ).all();

    return {
        ok: true,
        league_id: league,
        season_events: seasonEvents.length,
        pending_rows: pending.length,
        matched: matches.length,
        updated,
        remaining_null: stillNull?.[0]?.n ?? null,
    };
}
```

---

## TASK 2 — Admin endpoint `POST /admin/wc/bsd-backfill`

Insert near the other admin endpoints (search for `handleWCAdminSeed`):

```javascript
if (pathname === '/admin/wc/bsd-backfill' && request.method === 'POST') {
    const auth = (request.headers.get('Authorization') || '').replace('Bearer ', '');
    if (auth !== env.FIELD_MCP_SECRET)
        return new Response('Unauthorized', { status: 401, headers: CORS });
    const body = await request.json().catch(() => ({}));
    const result = await backfillWCBsdEventIds(env, {
        leagueId: body.leagueId ? String(body.leagueId) : undefined,
        since:    body.since ? String(body.since) : undefined,
    });
    return new Response(JSON.stringify(result), {
        status: result.ok ? 200 : 400,
        headers: { 'Content-Type': 'application/json', ...CORS },
    });
}
```

(Find the route block where other `/admin/wc/*` or similar admin POSTs live;
slot this in alongside them.)

---

## TASK 3 — Auto-fire hook in `writeWCResult`

Modify `writeWCResult` to call the backfill once per day after writing a
`bsd_event_id`. Use FIELD_JOURNALISM KV as the gate (matches existing
journalism cache pattern, 24h TTL).

In `writeWCResult`, find the block at L1525 that runs after writing
`bsd_event_id`. Add this immediately after the R2 capture `ctx.waitUntil`
block (do NOT block the game-final path):

```javascript
// Auto-trigger once-per-day backfill of remaining NULL bsd_event_id rows.
// Gated by KV key bsd:backfill:done:{YYYY-MM-DD} with 24h TTL so this
// only fires on the FIRST WC final of each day. Fire-and-forget via the
// ctx waitUntil passed from the calling code path.
if (env?.FIELD_JOURNALISM && env?.ctx?.waitUntil) {
    const gateKey = `bsd:backfill:done:${matchDate}`;
    env.ctx.waitUntil((async () => {
        try {
            const already = await env.FIELD_JOURNALISM.get(gateKey);
            if (already) return;
            await env.FIELD_JOURNALISM.put(gateKey, '1', { expirationTtl: 86400 });
            const r = await backfillWCBsdEventIds(env, { since: matchDate });
            console.log('[writeWCResult] auto-backfill result:', JSON.stringify(r));
        } catch (e) {
            console.warn('[writeWCResult] auto-backfill failed:', e.message);
        }
    })());
}
```

**Note on `env.ctx.waitUntil`**: `writeWCResult` doesn't currently take a
`ctx` arg. Two options:
- **(a) Pass `ctx` to `writeWCResult`** (cleaner but touches more sites).
- **(b) Inline the backfill call WITHOUT waitUntil** — runs sync at end
  of writeWCResult, adds ~2s to the game-final flow. Acceptable given
  rarity (one game per day triggers it).

Recommend **(a)**. Update the two call sites at L2903 and L2905:
```javascript
ctx.waitUntil(Promise.allSettled(finals.map(g =>
    writeWCResult(env.WC2026_DB, g, env, ctx))));
// ...and the sync path:
await Promise.allSettled(finals.map(g =>
    writeWCResult(env.WC2026_DB, g, env, ctx)));
```

And update the signature:
```javascript
async function writeWCResult(db, game, env, ctx) {
    // ... existing code ...
    // Use ctx.waitUntil(...) directly inside the backfill block above
}
```

If `ctx` is not provided (defensive), skip the backfill — the admin
endpoint can always be poked manually.

---

## TASK 4 — Smoke check

```bash
node --check src/index.js
```

---

## DONE CONDITIONS

```bash
# 1. backfillWCBsdEventIds present
grep -c 'backfillWCBsdEventIds' src/index.js
# Expected: ≥ 3 (function def + admin endpoint + writeWCResult hook)

# 2. Admin endpoint route present
grep -c "'/admin/wc/bsd-backfill'" src/index.js
# Expected: ≥ 1

# 3. ctx threaded into writeWCResult (if option a chosen)
grep -n "writeWCResult(.*ctx)" src/index.js | head -3
# Expected: 2 call sites updated

# 4. Live probe: endpoint exists with auth gate
curl -X POST https://field-relay-nba.jeffunglesbee.workers.dev/admin/wc/bsd-backfill \
  -H 'Content-Type: application/json' -d '{}'
# Expected: 401 Unauthorized (no auth header) — proves the route exists

# 5. Live probe: with auth, returns shaped response (may show error until
#    a live WC game exposes league_id)
#  curl -X POST https://field-relay-nba.jeffunglesbee.workers.dev/admin/wc/bsd-backfill \
#    -H "Authorization: Bearer $FIELD_MCP_SECRET" -H 'Content-Type: application/json' -d '{}'
#  Expected (no live game yet): {"ok":false,"error":"league_id not discoverable from live events"}
#  Expected (live game running): {"ok":true,"league_id":"...","season_events":N,"matched":N,"updated":N,...}

# 6. Diff scope
git diff --stat
# Expected: src/index.js only
```

---

## COMMIT

```bash
git add src/index.js
git commit -m "feat(bsd): auto-backfill WC bsd_event_ids — admin endpoint + writeWCResult hook"
git push origin main
```

---

## OUTBOX MANIFEST — required (no [skip ci])

```
outbox/cc-bsd-backfill-auto-2026-06-25.md
```

Document: commits, deploy run, probe outputs (curl 401 + curl with auth
when first WC final completes tonight).

---

## ACTIVATION TIMELINE

- **Now (deploy time)** — endpoint live, hook armed but inert. Auto-fire
  gate has no entry yet; manual probe with auth header returns
  `{ok:false, error:"league_id not discoverable"}` because no live BSD
  WC event exists yet.
- **20:00 UTC (Ecuador vs Germany kickoff)** — game enters BSD's live
  pool. `handleV2Games` enrichment populates `game.bsdEventId`.
- **~22:00 UTC (Ecuador vs Germany final)** — `writeWCResult` writes
  `bsd_event_id` to the row, captures R2 data, then auto-fire hook
  triggers `backfillWCBsdEventIds(env, { since: '2026-06-25' })`.
- **Within seconds** — backfill probes `/bsd/events/live` (still has the
  fresh-final game in some BSD plans), extracts `league_id`, fetches
  season events, matches all completed MD1+MD2 wc_results rows lacking
  bsd_event_id, UPDATEs them.
- **From next brief cycle onward** — `buildBSDHistoryContext` (shipped
  CC-CMD-H Task 2) starts surfacing prior-match data for WC briefs.

If `/bsd/events/live` no longer carries the just-finalized game at the
hook-fire moment, the auto-fire returns `{ok:false, error:...}` silently.
Manual fallback: POST to `/admin/wc/bsd-backfill` with an explicit
`leagueId` body once known.

---

## SECURITY POSTURE

- Zero credentials enter agent context. `BSD_API_TOKEN`, `FIELD_MCP_SECRET`,
  `CLOUDFLARE_API_TOKEN` all stay on the worker.
- The admin endpoint is auth-gated by the existing `FIELD_MCP_SECRET`
  (no new secret needed).
- The auto-fire hook needs no auth — it's worker-internal code calling a
  worker-internal function, never crossing a network boundary.
- D1 writes via the `WC2026_DB` binding — same surface as existing writes.
- KV gate prevents repeated daily fires; even if exploited, it can only
  trigger a backfill that's already idempotent (`WHERE bsd_event_id IS NULL`).

Rule 80 compliant. Rule 47 compliant (no editorial computation; pure
arithmetic + classification — name match → UPDATE).
