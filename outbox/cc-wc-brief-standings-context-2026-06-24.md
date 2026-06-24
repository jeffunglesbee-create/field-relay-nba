# WC Brief — Group Standings Context — 2026-06-24

## Probes

- `env.WC2026_DB` already in scope in `writeWCResult` — used by
  `recomputeGroupStandings(db, groupId)` at L1514.
- `groupId` declared at L1503 via `extractWCGroup`, alive through the
  function body.
- Prompt array (L1579–) had RESULT / Group / Date / eventsContext but no
  standings block.

## Edits (src/index.js)

1. **L1542–1559**: new `standingsContext` block right after the BracketDO
   notify and before the events fetch. Queries `wc_group WHERE group_id = ?`
   ordered by `points DESC, gd DESC, gf DESC`, formats each row as
   `  N. Team: Xpts (W D L, GD±N)`. Empty string on failure (non-blocking).
2. **Prompt array**: `standingsContext` slotted between `Date:` and
   `eventsContext` lines.

`recomputeGroupStandings` runs at L1514, so the SELECT sees the
post-result table — the model gets the standings as they look after the
game just completed.

## Commit & deploy

- `bc2dc9c` fix: inject group standings into writeWCResult journalism prompt (1 file, +19)
- Deploy: workflow 28098475715 — completed/success.

## Done conditions

- [x] `standingsContext` variable declared with D1 query in `writeWCResult`
- [x] `standingsContext` in prompt array between `Date:` and `eventsContext`
- [x] `node --check src/index.js` passes
- [x] Deploy green
- [x] Outbox manifest committed

## Why this matters

Closes the Colombia 1-0 Congo DR "in the driver's seat" hallucination
class. That brief was factually correct on the score but invented the
advancement narrative — the model had to guess what 1-0 meant for
Group K because the prompt didn't carry the standings.

Tonight's MD3 group-stage finales make this the highest-leverage prompt
in the pipeline: the entire story IS the standings (who's through, who's
out, who needs what in extra time). With the standings block in the
prompt, the model reads them instead of inventing them.

## Example prompt addition (sample)

```
GROUP K STANDINGS (after this result):
  1. Colombia: 7pts (2W 1D 0L, GD+4)
  2. Senegal: 5pts (1W 2D 0L, GD+2)
  3. Iran: 3pts (1W 0D 2L, GD-1)
  4. Congo DR: 1pts (0W 1D 2L, GD-5)
```

## Verify

Next WC final tonight (MD3 round) will fire writeWCResult → the
`Group <X> STANDINGS (after this result)` line will appear in the journalism
queue payload. AI Gateway log of the next WC brief generation will show
it injected between `Date:` and the match-events list.
