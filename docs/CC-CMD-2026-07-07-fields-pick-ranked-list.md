# CC-CMD: Field's Pick — rank all candidates, not just the winner

**Date:** 2026-07-07
**Repo:** jeffunglesbee-create/field-relay-nba (sole)
**Branch:** main — commit directly, do not create a feature branch or PR

**Source:** direct read of the current, live `runPhase9FieldPick()`
today. Its candidate-gathering already pulls every live game across
every Phase 9 sport (`nba`, `nhl`, `mlb`, `wnba`, `wc26`) — the scoring
loop then discards everything except the single highest scorer:
`if (!best || score > best.score) best = ...`. Confirmed live just now:
tonight's real pick is Padres–Diamondbacks at `score: 3.5` — the fix
from earlier this session is genuinely working, this isn't a "still
broken" situation. This is a real design upgrade, not a bug fix.

**Why now, not before:** this redesign requires the relay to hold and
compare interest-level values across every live game at once — under
the corrected ADR-002 reading (Rules A/B/C/E, `docs/ADR-002-CONTEXT.md`,
commit `01b18e6`), that's now explicitly permitted as long as delivery
stays pull-only, which this already is — `/analytics/newspaper` is a
GET response, never an autonomous push.

**Confirmed safe for the client:** grepped `jubilant-bassoon/index.html`
directly — it only ever reads `bundle.pick.type` and `bundle.pick.brief`.
`game_id`/`sport`/`home`/`away`/`score`/`reasons` are computed today but
never consumed. This means extending the shape is purely additive; no
client change is required for this CC-CMD to ship safely, though a
follow-up client CC-CMD would be needed to actually *display* the new
ranked list (out of scope here — note this explicitly in the outbox).

**Target time:** ~30 min

## PROBE BLOCK
```bash
sed -n '/async function runPhase9FieldPick/,/^}/p' src/analytics-engine.js
```
Confirm this still matches — especially the `best = null; for (g of
candidates) { if (score > best.score) best = ... }` loop and the
existing output-writing block, before changing either.

## TASK 1 — Rank instead of discard

Replace the single-winner loop:
```javascript
let best = null;
for (const g of candidates) {
  const { score, reasons } = scoreCandidatePick(g);
  if (!best || score > best.score) best = { game: g, score, reasons };
}
```
with a full scored-and-sorted list:
```javascript
const scored = candidates
  .map(g => ({ game: g, ...scoreCandidatePick(g) }))
  .sort((a, b) => b.score - a.score);
const best = scored[0] || null;
const ranked = scored.slice(0, 5).map(s => ({
  game_id: s.game.id || null,
  sport:   s.game.sport || null,
  home:    s.game.home?.name || s.game.home || null,
  away:    s.game.away?.name || s.game.away || null,
  score:   s.score,
  reasons: s.reasons,
}));
```
`scoreCandidatePick()` itself is untouched — this only changes how its
results are used afterward.

## TASK 2 — Extend both output branches with the ranked list

**Pass branch** (`best.score <= 3`, no AI-worthy pick tonight): still
write the same `pass` object and KV line as today — but add `ranked` to
the `value` written via `writeAnalyticsOutput`, so a quiet night still
has real, honest, ranked data available (e.g., "closest game tonight
scored 2.1") even though nothing earns the enthusiastic recommendation
line. Do not fabricate enthusiasm for a night that doesn't have any —
the `pass` framing and its brief text stay exactly as-is; `ranked` is
additive context alongside it, not a replacement for honest scoring.

**Pick branch** (`best.score > 3`): keep the existing AI-written
recommendation line generation exactly as today — one AI call, for the
`#1` game only, not one per ranked entry (cost and voice consistency:
this is a deliberate choice, not an oversight — do not generate N AI
lines). Add `ranked` to the `value` object alongside the existing
`game_id`/`sport`/`home`/`away`/`score`/`reasons` fields.

## TASK 3 — Verification

- `node --check src/analytics-engine.js`
- Trigger a real analytics run (or wait for the next natural cron tick)
  and confirm the live `/analytics/newspaper/{today}` response now
  includes a real `ranked` array of up to 5 games alongside the
  existing `pick` fields — report the actual returned array, not a
  hypothetical shape.
- Confirm exactly one AI call still happens per run (check `aiCalls` in
  the return value / logs), not five — this must not silently 5x the
  proxy cost.
- Confirm the client's existing rendering (`bundle.pick.type`,
  `bundle.pick.brief`) is completely unaffected — this is additive only.

## DONE CONDITIONS
- [ ] Probe block confirms citation before editing
- [ ] Scoring loop replaced with sort-and-slice, `scoreCandidatePick` itself untouched
- [ ] `ranked` array added to both pass and pick output branches
- [ ] Exactly one AI call per run, verified via real run output, not assumed
- [ ] Confirmed client's existing `type`/`brief` consumption is unaffected
- [ ] Outbox explicitly notes a separate client-side CC-CMD is still needed to actually display `ranked` in the UI

## CONFIDENCE SCORING TABLE
+30  Ranking logic correct, `scoreCandidatePick` untouched
+25  Both output branches correctly extended with `ranked`
+25  Verified via a real run: correct array shape, exactly one AI call
+10  Confirmed client unaffected
+10  Outbox correctly scopes the follow-up client work as separate

## ONE-LINER
git remote get-url origin | grep -q field-relay-nba || { echo "WRONG REPO -- this CC-CMD targets field-relay-nba"; exit 1; }
git pull. Read docs/CC-CMD-2026-07-07-fields-pick-ranked-list.md. Replace
runPhase9FieldPick's single-winner selection with a full sort-and-slice
ranking (top 5), adding a `ranked` array to both the pass and pick
output branches -- scoreCandidatePick itself stays untouched, and only
the #1 game still gets an AI-written line (one call per run, not five).
Verify against a real run showing the actual returned array shape and
confirming exactly one AI call. Confirm the client's existing
type/brief-only consumption is unaffected -- this is additive. Note in
the outbox that a separate client-side CC-CMD is still needed to
display the ranked list. Do not commit unless confidence >= 95. If
score < 95, report verbatim and stop.
