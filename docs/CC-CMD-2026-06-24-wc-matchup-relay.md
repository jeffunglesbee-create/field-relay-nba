# CC-CMD: WC Matchup Context — KV Cache + writeWCResult Injection
**Date:** 2026-06-24  
**Repo:** field-relay-nba (relay side)  
**Paired with:** CC-CMD-2026-06-24-wc-matchup-client.md in jubilant-bassoon (run after this)
**Rule 87:** Self-completing.

---

## CONTEXT

`writeWCResult` now includes standings + events in the journalism prompt.
Still missing: the pre-game matchupNote (e.g., "Switzerland vs Canada — Group B
MD3 decider; path trap active; Canada plays their final home game of the
tournament"). These exist in `wc26Raw` client-side but the relay never sees them.

Fix: a two-part KV bridge.
- Relay: add `POST /wc/matchup/cache` endpoint — writes `wc:matchup:{key}` to
  `FIELD_JOURNALISM` KV (24h TTL).
- Relay: in `writeWCResult`, read `wc:matchup:{homeName}_{awayName}` before
  building the prompt. Inject as `[PRE-GAME CONTEXT]` block.
- Client: (separate CC-CMD) POST matchupNotes for today's upcoming WC games
  during `_fetchWCTournBriefForSchedule`.

---

## PROBE BLOCK

1. Confirm `env.FIELD_JOURNALISM` is accessible in `writeWCResult` scope.
   `writeWCResult(db, game, env)` — `env` is the 3rd parameter. Confirm.

2. Find where `standingsContext` is declared in `writeWCResult` (~L1546).
   The `matchupContext` block goes immediately before `standingsContext`.

3. Confirm `/wc/matchup/cache` does NOT yet exist in `src/index.js`.

4. Find the MCP `ALLOWED_EXACT` or `ALLOWED_PREFIX` list — add the new
   route so MCP tools can probe it.

---

## TASK 1 — `POST /wc/matchup/cache` endpoint

Add near the other `/wc/*` write endpoints. Accepts `{ home, away, note }`,
writes `wc:matchup:{home}_{away}` (and reverse `wc:matchup:{away}_{home}`)
to FIELD_JOURNALISM KV with 24h TTL. Both directions so writeWCResult's
lookup works regardless of which side is home.

```javascript
// POST /wc/matchup/cache — client writes pre-game matchupNote to KV so
// writeWCResult can inject it into the journalism prompt.
// Body: { home: string, away: string, note: string }
if (pathname === '/wc/matchup/cache' && request.method === 'POST') {
    if (!env.FIELD_JOURNALISM) return new Response(
        JSON.stringify({ ok: false, error: 'FIELD_JOURNALISM not bound' }),
        { status: 503, headers: { ...CORS, 'Content-Type': 'application/json' } }
    );
    try {
        const body = await request.json();
        const { home, away, note } = body || {};
        if (!home || !away || !note) return new Response(
            JSON.stringify({ ok: false, error: 'missing home/away/note' }),
            { status: 400, headers: { ...CORS, 'Content-Type': 'application/json' } }
        );
        const norm = s => (s || '').trim().toLowerCase().replace(/\s+/g, '_');
        const key  = `wc:matchup:${norm(home)}_${norm(away)}`;
        const keyR = `wc:matchup:${norm(away)}_${norm(home)}`;
        const val  = note.slice(0, 400);  // cap at 400 chars
        await Promise.all([
            env.FIELD_JOURNALISM.put(key,  val, { expirationTtl: 86400 }),
            env.FIELD_JOURNALISM.put(keyR, val, { expirationTtl: 86400 }),
        ]);
        return new Response(
            JSON.stringify({ ok: true, key, keyR }),
            { headers: { ...CORS, 'Content-Type': 'application/json' } }
        );
    } catch (e) {
        return new Response(
            JSON.stringify({ ok: false, error: e.message }),
            { status: 500, headers: { ...CORS, 'Content-Type': 'application/json' } }
        );
    }
}
```

Add `/wc/matchup/cache` to ALLOWED_EXACT or equivalent probe allow-list.

---

## TASK 2 — Read matchupContext in `writeWCResult`

Find the `let standingsContext = '';` block at ~L1546. Insert immediately
before it:

```javascript
        // Fetch pre-game matchup context cached by client via POST /wc/matchup/cache.
        // Keys: wc:matchup:{home}_{away} and reverse, written by _fetchWCTournBriefForSchedule.
        // Non-blocking — empty string on miss or FIELD_JOURNALISM unavailable.
        let matchupContext = '';
        try {
            if (env.FIELD_JOURNALISM) {
                const norm = s => (s || '').trim().toLowerCase().replace(/\s+/g, '_');
                const mcKey = `wc:matchup:${norm(homeName)}_${norm(awayName)}`;
                const mc = await env.FIELD_JOURNALISM.get(mcKey);
                if (mc) matchupContext = `\n\nPRE-GAME CONTEXT:\n${mc}`;
            }
        } catch (_) { /* non-blocking */ }
```

Then find the prompt array and add `matchupContext` before `standingsContext`:

```javascript
            `RESULT: ${homeName} ${homeScore} - ${awayScore} ${awayName}`,
            `Group: ${groupId}`,
            `Date: ${matchDate}`,
            matchupContext,
            standingsContext,
            eventsContext,
```

---

## TASK 3 — `node --check` + commit + deploy

```
node --check src/index.js
```

Commit:
```
feat: wc matchup context — POST /wc/matchup/cache + writeWCResult injection

Client writes wc26Raw matchupNotes to FIELD_JOURNALISM KV via
POST /wc/matchup/cache (24h TTL, both home/away orientations).
writeWCResult reads wc:matchup:{home}_{away} before building the
journalism prompt and injects as PRE-GAME CONTEXT block.

Enables relay briefs to include narrative setup ("Switzerland vs Canada
— Group B MD3 decider; path trap active") that was previously only
available on the client-side night owl path.
```

Push. Deploy.

---

## TASK 4 — Outbox manifest + [skip ci] commit.

---

## DONE CONDITIONS

- [ ] `POST /wc/matchup/cache` endpoint in `src/index.js`
- [ ] `wc:matchup:` key written with 24h TTL, both orientations
- [ ] `let matchupContext = ''` block in `writeWCResult`
- [ ] `matchupContext` in prompt array before `standingsContext`
- [ ] `/wc/matchup/cache` in probe allow-list
- [ ] `node --check` passes
- [ ] Deploy green
- [ ] Outbox manifest committed [skip ci]
