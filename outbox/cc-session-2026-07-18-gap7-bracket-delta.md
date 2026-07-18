# CC Session Doc — Gap 7: Bracket Projection Delta in WC Debrief
**Date:** 2026-07-18
**Repo:** field-relay-nba
**Branch:** main
**HEAD start:** ca610e9 → **end:** 79f950e

---

## Commits

- `79f950e` feat: Gap 7 — bracket projection delta persisted to ARCHIVE_DB and exposed via /context/game/{id}

---

## TASK 1 — Fire-and-forget delta write in BracketDO

In `_recomputeAndBroadcast` (`src/bracket-do.js`), after step 8 (KV writes), added:

```js
// Gap 7: persist bracket delta to ARCHIVE_DB via relay route for /context/game/{id}
if (triggerResult?.gameId && delta) {
    const _bdDate = new Date().toISOString().slice(0, 10);
    const _bdId = `bracket_delta:${triggerResult.gameId}:${delta.computedAt || _bdDate}`;
    this.ctx.waitUntil(
        fetch(`${RELAY_BASE}/archive/brief`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                id:            _bdId,
                brief_type:    'bracket_delta',
                date:          _bdDate,
                sport:         'wc',
                game_id:       triggerResult.gameId,
                brief_text:    JSON.stringify(delta),
                quality_score: 0,
                source:        'bracket_do',
            }),
        }).catch(() => {})
    );
}
```

- `quality_score: 0` prevents `/archive/brief`'s quality chain from trying to score the JSON payload
- `this.ctx.waitUntil(...)` is fire-and-forget — does not block the recompute path
- `.catch(() => {})` ensures archive failure never blocks `_recomputeAndBroadcast` (Rule 5)
- `id` is `bracket_delta:{gameId}:{computedAt}` — unique per recompute (no conflict collisions for same game)

---

## TASK 2 — `findBracketDelta` helper in `src/index.js`

Added at L6356 (between `findBriefs` and `findSeries`):

```js
async function findBracketDelta(env, id) {
    if (!env.ARCHIVE_DB) return null;
    try {
        const row = await env.ARCHIVE_DB.prepare(
            `SELECT brief_text, created_at FROM briefs
             WHERE game_id = ? AND brief_type = 'bracket_delta'
             ORDER BY created_at DESC LIMIT 1`
        ).bind(id).first();
        if (!row) return null;
        try { return JSON.parse(row.brief_text); } catch (_) { return null; }
    } catch (_) { return null; }
}
```

---

## TASK 3 — `/context/game/{id}` route updated

Added `findBracketDelta` to the `Promise.allSettled` and `bracketDelta` to the response payload:

```js
const settled = await Promise.allSettled([
    findGame(env, id),
    findBriefs(env, id),
    findSeries(env, id),
    findEnrichment(env, id),
    findBracketDelta(env, id),   // Gap 7
]);
const [g, b, s, e, bd] = settled;
// ...
const payload = {
    ok: true, id, game,
    archive, series, enrichment,
    bracketDelta: bd.status === 'fulfilled' ? bd.value : null,
    _errors: ...
};
```

---

## TASK 4 — Verification

```
node --check src/bracket-do.js → OK
node --check src/index.js → OK
git diff --stat: 2 files changed, 45 insertions(+), 8 deletions(-)
```

**Integration status: STAGED** — logic trace verified; end-to-end requires:
1. A WC match to complete during an active session (BracketDO `_recomputeAndBroadcast` fires)
2. That fires `fetch(${RELAY_BASE}/archive/brief, ...)` → writes `bracket_delta` row to `briefs`
3. Client calls `GET /context/game/{gameId}` → `findBracketDelta` returns the parsed delta object as `bracketDelta`

**Unblock criteria (Rule 74 — STAGED-GATE-A):**
- Blocked by: WC Final is 2026-07-19; no WC matches may have triggered since this session
- Unblocked when: any WC match completes with BracketDO active
- Verify (relay side):
  ```
  curl -s "https://field-relay-nba.jeffunglesbee.workers.dev/context/game/{gameId}" \
    | node -e 'd=JSON.parse(require("fs").readFileSync("/dev/stdin","utf8")); console.assert(d.bracketDelta !== undefined, "bracketDelta key missing")'
  ```
- Verify (D1 direct):
  ```
  # Query ARCHIVE_DB briefs WHERE brief_type='bracket_delta' — should have rows
  ```

CI triggered on `79f950e`.

---

## Confidence: 97/100
- T1 (30/30): fire-and-forget via `ctx.waitUntil` + `.catch(() => {})` — Rule 5 compliant; `quality_score:0` prevents proxy call on JSON payload
- T2 (25/25): `findBracketDelta` helper — guards `!env.ARCHIVE_DB`, double try/catch for D1 and JSON.parse failures
- T3 (25/25): parallel query added cleanly; payload key `bracketDelta` consistent with `_computeDelta` field naming conventions
- T4 (17/20): syntax clean; logic-trace complete; STAGED per Rule 61 (-3 for no live E2E, sandbox blocks outbound)

---

## Integration state

**RELAY CONTRACT:** `GET /context/game/{id}` returns `bracketDelta` field (object | null). Shape matches `_computeDelta` return: `{significant, maxChampShift, shifts[], narrativeSeeds[], triggerGame, computedAt}`.
**CLIENT CONSUMER:** `injectDebriefCards` in `src/legacy/field.js` (jubilant-bassoon) — NOT YET UPDATED to read `bracketDelta`. Gap 7 client-side rendering is a separate CC-CMD.
**INTEGRATION STATUS: STAGED** — relay-side complete; client consumer pending.
**KNOWN MISMATCHES:** None. Field names pass through unchanged from `_computeDelta`.

**OPEN (per Rule 74 — STAGED-GATE-A):**
- Gap 7 client rendering (jubilant-bassoon): read `ctx.bracketDelta` in `injectDebriefCards` and render shift summary in the Debrief card — separate CC-CMD required.
