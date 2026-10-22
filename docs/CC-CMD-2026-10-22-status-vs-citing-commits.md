# Claude Code Command — a non-terminal status that commits already cite by task number

**Date:** 2026-10-22
**Repo:** field-relay-nba
**Branch:** main — commit directly, do not create a feature branch or PR
**Type:** A (governance guard) — no production change
**Confidence gate:** >= 95 before any commit
**Status:** FILED, not started.

---

## Why

`scripts/cc-cmd-status-check.mjs` (`docs/CC-CMD-2026-10-18-relay-governance-guards.md`)
fails on the CFL CC-CMD as it read before 2026-10-18 only because
`NOT STARTED` is outside the vocabulary. Had the same document read
`**Status:** FILED, not started.`, with the same five commits citing it (three by
task number: `3ad28bd` TASK 3, `9e76e87` TASK 4, `85a95da` TASK 5.5), no guard
would fire. The incident's real shape, a status contradicting the tree, is still
unguarded.

## Task 0 — probe before building

1. `git log --oneline -5`.
2. For every CC-CMD whose status is `FILED` or `OPEN`, count the commits whose
   message names that CC-CMD's file name. A commit that only FILES the CC-CMD
   (`docs: CC-CMD for …`) is not work on it; decide the rule for telling them
   apart from the real log before writing it, and record the rule.
3. Report the count. If it is 0, a tripwire at 0 is the guard. If it is not,
   read each one first: a doc may be FILED with a probe commit and still be
   honestly not started.

## Task 1 — the guard

Only if Task 0 gives a rule that separates work from filing on the real log:
a check that a non-terminal status line is not contradicted by a commit doing
that CC-CMD's TASK work. It needs a self-test that includes the CFL case
reconstructed with `FILED` in place of `NOT STARTED`, and a fixture where only
the filing commit cites the doc, which must pass.

## Done conditions

1. Task 0's count and the separating rule in `outbox/`.
2. If built: the self-test fails on the CFL-as-FILED fixture, and `guards.yml`
   runs it. If not built: the reason, measured, in the same `outbox/` doc.
