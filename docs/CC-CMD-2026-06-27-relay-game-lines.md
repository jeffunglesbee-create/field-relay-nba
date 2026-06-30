# CC-CMD: /journalism/game-lines endpoint
**Date:** 2026-06-27
**Repo:** jeffunglesbee-create/field-relay-nba (sole)
**Branch:** main
**SW_VERSION:** relay only — no SW change

---

## CONTEXT

The client's `_gameBriefCache` object is already populated by on-demand
fetches (fetchGameBriefOnDemand, compound editorial), but only fires when
the user opens the bottom sheet. Per-game brief text is never pre-loaded
into cards on page open. The relay already generates and stores per-game
briefs in FIELD_JOURNALISM KV under keys `brief:game:{espnEventId}` with
1hr TTL. This CC-CMD exposes a batch read endpoint so the client can
pre-populate `_gameBriefCache` in one call on page load without N
individual fetches.

---

## PROBE BLOCK (Rule 68 — run before any edits)

```bash
# P1 — Confirm FIELD_JOURNALISM binding name in wrangler.toml
grep 'FIELD_JOURNALISM' wrangler.toml

# P2 — Confirm brief:game KV key format in source
grep -n 'brief:game:' src/index.js | head -20

# P3 — Check if /journalism/game-lines already exists
grep -n 'game-lines\|game_lines' src/index.js

# P4 — Find existing /journalism/* route block to insert near
grep -n "pathname.startsWith('/journalism/')\|/journalism/tonight\|/journalism/game" src/index.js | head -20

# P5 — Confirm FIELD_JOURNALISM.list() is used elsewhere (pattern check)
grep -n 'FIELD_JOURNALISM.list\|\.list(' src/index.js | head -10

# P6 — node --check src/index.js (baseline clean)
node --check src/index.js
```

If any probe contradicts the assumptions below, STOP and document findings.
Do not proceed until reconciled.

**Expected:**
- P1: `binding = "FIELD_JOURNALISM"` present
- P2: `brief:game:` prefix found with espnEventId suffix
- P3: zero matches (does not exist yet)
- P4: existing `/journalism/` route block found (insertion anchor)
- P5: list pattern exists in source
- P6: clean

---

## TASK 1 — Add /journalism/game-lines endpoint

Location: `src/index.js`, inside the existing `/journalism/` route block.
Insert BEFORE the catch-all or final return in that block.

**Route:** `GET /journalism/game-lines`
**Auth:** none (same as `/journalism/tonight`)
**Cache:** 60s (KV updates every 15 min from cron — 60s is safe staleness)

```javascript
// GET /journalism/game-lines
// Returns first sentences of all per-game briefs in KV for today.
// Client uses this to pre-populate _gameBriefCache on page load.
// KV key pattern: brief:game:{espnEventId}
if (pathname === '/journalism/game-lines') {
  // Check CF edge cache first
  const cacheKey = new Request(request.url, { method: 'GET' });
  const cached = await caches.default.match(cacheKey);
  if (cached) return cached;

  if (!env.FIELD_JOURNALISM) {
    return new Response(JSON.stringify({ ok: false, error: 'KV unbound' }), {
      status: 503, headers: { 'Content-Type': 'application/json' }
    });
  }

  try {
    const listed = await env.FIELD_JOURNALISM.list({ prefix: 'brief:game:', limit: 100 });
    const lines = {};

    await Promise.all((listed.keys || []).map(async ({ name }) => {
      try {
        const raw = await env.FIELD_JOURNALISM.get(name);
        if (!raw) return;
        // Value may be plain text or JSON with a text/brief field
        let text = raw;
        try {
          const parsed = JSON.parse(raw);
          text = parsed.text || parsed.brief || parsed.brief_text || raw;
        } catch (_) {}
        // Extract first complete sentence
        const first = String(text).split(/\.\s+/)[0].trim();
        if (first.length < 20) return;
        // Key format is brief:game:{sport}:{id} OR brief:game:{id} — confirmed
        // 2026-06-30 against sweepKVBriefs (~line 4239), which is the only
        // other consumer of this prefix. A bare .replace() would leave the
        // sport prefix attached for sport-tagged keys, breaking the client's
        // lookup (it matches on bare espnEventId). Mirror sweepKVBriefs's
        // parsing exactly so both consumers agree on the same id.
        const parts = name.replace('brief:game:', '').split(':');
        const espnId = parts.length >= 2 ? parts[parts.length - 1] : parts[0];
        lines[espnId] = first.endsWith('.') ? first : first + '.';
      } catch (_) {}
    }));

    const body = JSON.stringify({ ok: true, lines, count: Object.keys(lines).length });
    const resp = new Response(body, {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=60',
        'Access-Control-Allow-Origin': '*',
      }
    });
    ctx.waitUntil(caches.default.put(cacheKey, resp.clone()));
    return resp;
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: e.message }), {
      status: 500, headers: { 'Content-Type': 'application/json' }
    });
  }
}
```

---

## TASK 2 — node --check + commit + deploy

```bash
node --check src/index.js
git add src/index.js
git commit -m "feat(journalism): /journalism/game-lines — batch per-game brief lines for client pre-population"
git push origin main
```

Wait for CI deploy (poll /deploy/verify until match:true or timeout 5 min).

---

## TASK 3 — Post-deploy probes

```bash
# P7 — Endpoint responds 200
curl -s https://field-relay-nba.jeffunglesbee.workers.dev/journalism/game-lines | python3 -c "
import sys, json
d = json.load(sys.stdin)
print('ok:', d.get('ok'))
print('count:', d.get('count'))
for k, v in list((d.get('lines') or {}).items())[:3]:
    print(f'  {k}: {v[:60]}')
"
# Expected: ok:true, count ≥ 0 (may be 0 outside live hours — that is correct)

# P8 — /health still returns OK
curl -s https://field-relay-nba.jeffunglesbee.workers.dev/health | grep -c 'ok'
```

---

## DONE CONDITIONS

- [ ] P1–P6 probes all pass before any edit
- [ ] `/journalism/game-lines` route added to src/index.js
- [ ] `node --check src/index.js` clean
- [ ] Commit pushed, CI deploy green
- [ ] `/journalism/game-lines` → HTTP 200, `ok:true`
- [ ] `/health` still OK
- [ ] Outbox manifest written to `docs/outbox/cc-journalism-game-lines-{date}.md`

## COMPLIANCE

- Rule 5: all KV operations in try/catch, errors return ok:false not throw
- Rule 7: single-concern commit — one endpoint, one file
- Rule 47/ADR-002: returns prose text only, no drama scores, no interest values
- Rule 68: probe block must run and pass before any edits
- Rule 87: self-completing — done conditions checkable in-session
