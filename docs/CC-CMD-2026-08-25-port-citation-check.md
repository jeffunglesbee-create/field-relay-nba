# CC-CMD-2026-08-25-port-citation-check

**Filed:** 2026-08-25.
**Target:** jubilant-bassoon, then field-playground.
**Status:** OPEN.

## Why

`scripts/check-doc-citations.mjs` shipped here and in field-laboratory on
2026-08-25 after five of six citations published that morning turned out stale
by the afternoon. jubilant-bassoon carries the largest documentation corpus of
the four repos and has no such check.

This is the same shape as the secret scanner six hours earlier: written for one
repo, reported as if it measured the problem, and a cross-repo scan found the
rest. **Do not report a citation figure for "the project" from one tree.**

## The ask

1. **Copy `scripts/check-doc-citations.mjs`** verbatim. It carries eight
   self-test cases including the `lineOf` uniqueness fix — a repair hint must
   not be printed for an ambiguous anchor.
2. **Run it and paste the counts.** Do not assume they resemble this repo's
   (`anchored 1550 / bare 9 / no file 51`). Measure.
3. **Set `docs/citation-budget.txt` to the MEASURED bare count**, not to 9.
4. **Wire it into a workflow that runs on every push** — in jubilant-bassoon
   that is `smoke-and-verify.yml`, not the paths-filtered `deploy-gate.yml`.
5. **Repeat for field-playground.**

## Expect a high `no file` count, and do not treat it as failure

jubilant-bassoon cites relay paths constantly and vice versa. The check reports
missing files and never fails on them, for exactly that reason.

## Done condition

The printed count block from each repo, verbatim, in the outbox manifest — plus
one green CI run per repo on a real push. A green run alone is not the done
condition; the counts are, because the budget is only meaningful if it was
measured rather than copied.
