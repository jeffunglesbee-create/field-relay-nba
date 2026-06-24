# Bracket Impact — Pre-Snapshot Write + Dual-Key findBracketImpact — 2026-06-24

## Root cause

BracketDO Step 10 wrote only the post-result snapshot. `findBracketImpact`
expected 2 rows per team (`before` and `after`) keyed by the same
`triggered_by`. With only one row, `impact[team].after` stayed undefined →
the `change != null` filter dropped every team → `[BRACKET IMPACT]` block
never appeared in any WC brief prompt.

## Probes

- `this.prevSnapshot` rotated at Step 5 (L332), runs BEFORE Step 10 (L401)
  → safe to read at write time.
- Step 10 was a single `fetch('/archive/bracket-snapshot')` call.
- `findBracketImpact` used `WHERE triggered_by = ?` with first/second row
  ordering for before/after. With one row, second-pass branch never hit.

## Edits

**`src/bracket-do.js` L401–445** — Step 10 replaced.
- `_mapTeams(snap)` helper extracts the 7-field projection shape.
- Pre write: `triggered_by = 'pre:{key}'`, body from `this.prevSnapshot`
  (only fires when prevSnapshot has teams).
- Post write: `triggered_by = '{key}'`, body from `newSnapshot`.
- Both wrapped in `this.ctx.waitUntil(...).catch(...)` — fire-and-forget,
  archive failure cannot break the recompute path (Rule 5).

**`src/context-assembler.js` L445–474** — `findBracketImpact` rewritten.
- `Promise.all` parallel fetch of `pre:{key}` and `{key}`.
- Pre rows seed `impact[team] = {before, r32Before}`.
- Post rows fill `after`, `r32After` only when pre row exists.
- Diff loop unchanged: `change = round((after - before) * 1000) / 1000`,
  `stateBefore/stateAfter = advancementState(r32...)`.

## Commit & deploy

- `e97fffd` fix: bracket impact — pre-snapshot write + dual-key findBracketImpact (2 files, +47/−22)
- Deploy: workflow 28115245442 — completed/success.

## Done conditions

- [x] `pre:${triggeredBy}` in BracketDO Step 10 (L426)
- [x] `_mapTeams` helper used for both writes (L410, L428, L441)
- [x] `Promise.all` in `findBracketImpact` querying both keys (context-assembler.js L450)
- [x] `node --check` passes both files
- [x] Deploy green (28115245442)
- [x] Outbox manifest pushed (no [skip ci])

## Why this matters

The infrastructure for bracket impact context — D1 schema, prompt wiring,
journalism queue threading — has been in place but the data side was a
single-row miss. Next time BracketDO fires (any WC result with `triggerResult`),
it writes two rows per team. `findBracketImpact(env, triggeredBy)` returns
populated `impact[team]` with `change`, `stateBefore`, `stateAfter`. The
queue consumer's `[BRACKET IMPACT]` prepend runs for the first time, and the
journalism model finally sees the pre/post advancement state transition.

## Verify

Next WC result fires BracketDO recompute. AI Gateway log for that brief will
show `[BRACKET IMPACT]` block prepended to the prompt with lines like:

```
[BRACKET IMPACT]
- Switzerland: STRONG → THROUGH (pChamp +0.024)
- Canada: ALIVE → STRONG (pChamp +0.012)
```

If the block still doesn't appear, check D1 `bracket_snapshots` for two
rows per team keyed `pre:{home}_{away}_{date}` and `{home}_{away}_{date}`.
