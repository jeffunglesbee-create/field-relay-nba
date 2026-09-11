# Claude Code Command — Re-measure the quality bar against the true ceiling, and stop the ceiling moving silently

**Date:** 2026-09-10
**Repo:** field-relay-nba
**Branch:** main — commit directly, do not create a feature branch or PR
**Type:** B (bug fix) + measurement
**What this is NOT:** this does not choose the bar. Choosing between 240, four-fifths-of-reachable, or some other standard is an editorial judgement about journalism and belongs to Jeff. This produces the numbers that make the choice possible, and stops them going stale again.

## CONTEXT — why the existing answers can no longer be trusted

Two sessions already did real work here and both should be read first:

- `outbox/cc-session-2026-08-16-quality-bar-scale.md` — named the scale wherever the
  flat bar is reported. `/quality/report` now emits `flat_bar`,
  `flat_bar_pct_of_nominal`, `flat_bar_pct_of_reachable`, `four_fifths_of_reachable`.
- `outbox/cc-session-2026-08-22-quality-scale-verified.md` — titled "the 240 bar has
  never been cleared". Measured 0 briefs clearing 240, 0%. Closed the open question
  *"is 240 discriminating, or practically another unreachable bar?"* with data: at
  11.7% it discriminates.

**Both measured against a reachable ceiling of 245. That number is no longer correct,
and the published percentages are therefore wrong.**

Read at HEAD `641a86d`:

- `src/journalism-quality.js:1948` — `export const REACHABLE_CEILING` … `// 252`
- `src/journalism-quality.js:1957` — `export const REACHABLE_CEILING_GAME` … `// 294`

The narrative comment block above them (around :1902) states the ceilings went
`245 -> 277` and `270 -> 294` silently, caused by renaming `SCALE.matchup` ->
`SCALE.margin` so that two filters matched nothing. The constant now reads **252**,
not 277. So the ceiling has moved at least twice, and the prose explaining the move
is already stale against the code three lines below it.

`grep -c "CEILING_GUARD\|assertCeiling\|ceiling.*regress"` returns **0**. Nothing
prevents this happening again.

**The shape problem, stated in the file's own comment and not yet fixed.** A binary
reachable/unreachable list is now the wrong model. Era 5/6 replaced the two
game-fact dimensions with ones that ABSTAIN AT THE MIDPOINT when the fact is absent:
`marginAgreement(text, null)` returns 15 of 30, `finalityAgreement(text, null)`
returns 10 of 20. Neither is unreachable and neither is fully reachable. The comment
says calling them either one is "wrong by 15 and 10 points respectively."

## TASK 0 — PROBE (read from HEAD; this document is a starting point, not truth)

1. Print the real evaluated values of `REACHABLE_CEILING` and
   `REACHABLE_CEILING_GAME` — evaluate them, do not read the trailing comments.
   Record both, and record whether each trailing comment matches its value.
2. Print `FOUR_FIFTHS_REACHABLE` and `FOUR_FIFTHS_REACHABLE_GAME` and state which
   ceiling each was derived from.
3. Enumerate every dimension in `SCALE` and classify each into exactly three states:
   fully reachable in this runtime / structurally zero / abstains at a midpoint
   (with the abstention value). Do not force any dimension into a binary.
4. Confirm whether `/quality/report`'s `unreachable_points` is currently correct for
   both shapes. The comment records it once published `unreachable_points: 0` while
   still naming "matchup" as unreachable.

## TASK 1 — Re-measure, against the real ceiling

Recompute over the same window shape the 2026-08-22 session used, so results are
comparable:

- clear rate at 240, expressed as a percentage of BOTH nominal and the real
  reachable ceiling from Task 0.1
- clear rate at `four_fifths_of_reachable`, recomputed from the real ceiling
- best brief in window, and the distribution (p25/p50/p75/p90)
- the same figures split by the two shapes (game-context available vs not)

Report the numbers. Do not adjust any threshold in this task.

## TASK 2 — Replace the binary with the three-state shape

`/quality/report` must stop describing dimensions as reachable/unreachable. Emit the
three states from Task 0.3, with the abstention value named per dimension. A
dimension that abstains at 15 of 30 is neither dark nor earned, and the endpoint
should say so rather than round it to one or the other.

## TASK 3 — Guard the ceiling (this is the durable fix)

Add an assertion that fails loudly when a reachable ceiling changes without the
change being declared. Derive it, do not hardcode a second copy of the number —
a second literal is the same bug. Suggested shape: a checked-in expected value with
the assertion naming both figures and the dimension list that produced them, so a
rename that silently empties a filter fails the build rather than moving the ceiling.

Verify by temporarily renaming a `SCALE` key in a scratch branch-free test and
confirming the guard fires. Restore before committing.

## TASK 4 — Report, do not fix: `scoreThreshold: 110`

Two relay enqueue sites pass `110` against a documented standard of 240. The
2026-08-22 session classified this as **inert, not wrong**, noted 110 predates the
240 standard by two weeks, and called it a spend decision under Rule 78. Confirm
whether both sites still pass 110 at HEAD and whether it is still inert. Report
only — do not change it.

## DONE CONDITION (verifiable probe output)

- Task 0.1 evaluated values pasted, with a statement of whether the trailing
  comments match.
- Task 1 clear-rate table pasted, both shapes, both bars.
- `/quality/report` live response pasted showing the three-state dimension output.
- Guard demonstrated firing on a deliberate rename, then restored.

## TASK 5 — Outbox manifest (last task)

Write `outbox/cc-session-2026-09-10-quality-bar-true-ceiling.md` with every number
from Tasks 0 and 1, the commit SHA, the guard demonstration, and an explicit
statement of what remains Jeff's decision: which bar, given the corrected figures.
