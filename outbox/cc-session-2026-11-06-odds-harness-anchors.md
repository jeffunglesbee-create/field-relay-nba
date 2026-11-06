# Session 2026-11-06 — the odds-wrapper harness: five anchors re-pointed, and a tripwire so they cannot rot silently again

**Date:** 2026-11-06 · **Repo:** field-relay-nba · **Branch:** main
**HEAD progression:** `d9b4f5a` (when the work began) → `71a1fd3` (the five anchors) → `edbf0c6` (the anchors-only mode and the deploy.yml step) → `f229f01` (the same step in guards.yml) → `5b15144` (the review's fixes to the tripwire) → the documents and this close-out (one commit)
**Task:** the owner's order "Fix the anchors", answering the 2026-11-05 close-out's open item: 5 of 39 cases of `scripts/mutate-deploy-odds-wrappers.mjs` reported `anchor matched 0 times ... NOTHING MUTATED`.
**Odds API credits spent:** 0. **Worker code changed:** none (`src/` untouched; the commits touch `scripts/` and `.github/workflows/` only, which neither deploys nor sits on the CFL experiment's VOID list).

## What was wrong

The five cases (S1 `fetchSportOddsLive`; S3 and E7 `fetchSportOddsHistorical`; S4 and "the refusal logs and no longer returns" on the ambient closing capture) quoted single-line source text. Two later src edits changed that text: the per-site labels (2026-10-28) turned the `site` argument of the consume call at `fetchSportOddsLive` and `fetchSportOddsHistorical` into a ternary that continues onto a second or third line, and the closing-capture refusal began returning `false` (retryable, 2026-10-24). The anchors matched nothing, the harness printed `FAIL ... NOTHING MUTATED` (as it is built to), and nobody read it, because the harness is a 100-minute manual run wired to no workflow. It failed identically at `b59b469`, so the 2026-11-05 deploy did not cause it.

## What was done

| Item | Detail |
|---|---|
| Re-point | `HIST_IF` and a `HIST_SITE`, `LIVE_GUARD`, `LIVE_RECONCILE`, `CLOSING_REFUSAL` constants now carry the current multi-line text. Each mutation keeps its meaning: the guard block removed and re-inserted before the reconcile call; a dedupe flag in front of the verdict; the consume call inside a `try` whose decline throws into a `catch` that only logs; the refusal logging without returning. |
| Each case alone | In a clean clone, control GREEN first, then: S1 CAUGHT (2 steps), S4 CAUGHT (1), S3 CAUGHT (1), E7 CAUGHT (4), refusal-case CAUGHT (1). All five are caught by the odds gates, so the stale anchors did not hide a gate gap. |
| Tripwire | `node scripts/mutate-deploy-odds-wrappers.mjs --anchors-only` applies every case's edits to the working tree in memory (about 4 s, no step run) and exits 1 when an anchor matches other than once, a wrapper is missing or declared twice, or a mutant does not parse. Printed: `every anchor of 39 of 39 harness cases ... and every mutant parses (12 wrapper cases, 27 site cases)`. Failed on purpose in a copy of the tree (the cases are under "Verified"). |
| Wiring | One step in `deploy.yml` (where src-only pushes run, and where the drift comes from) and the same step in `guards.yml` (pushes that touch only the harness or workflows, and a first run on a real runner). The harness now excludes that step from the odds steps it runs inside each mutant, since the step reads the source a mutant has just edited and would be red in every case. |

## Verified vs staged

**Each re-pointed case alone, clean clone, control GREEN first:** S1 CAUGHT (red steps: `Every odds call is charged to the monthly ledger`, `the unauthenticated odds routes spend under their own labels`); S4 CAUGHT (1 step); S3 CAUGHT (1); E7 CAUGHT (4: the ledger step, `a per-site cap refuses its own site and charges nothing it refused`, the unauthenticated-routes step, `Every odds call names which consumer spent it`); the closing-capture refusal case CAUGHT (1). So the stale anchors hid no gate gap.

**The full harness, clean clone of the gate commits (before the review's tripwire fixes): `39 of 39 cases as expected (control green first): 30 mutants must turn a step red, 9 equivalents must leave all 32 odds steps green.`** It was 34 of 39 at `b59b469` and on 2026-11-05.

**The final tree (`5b15144`), partial run `--only=getWCPregameLambdas`:** 4 of 4 as expected, control GREEN, and the changed COVERAGE line prints `32 of 118 runnable pre-deploy steps (the odds ones, not counting this harness's own 1 anchors step)`. The full run was not repeated: the review's fixes touch only the `--anchors-only` branch, the header and comments, and that one printed line, and the partial run exercises the run path end to end.

**The tripwire:** `node scripts/mutate-deploy-odds-wrappers.mjs --anchors-only` prints `PASS every anchor of 39 of 39 harness cases matches the source exactly once and every mutant parses (12 wrapper cases, 27 site cases)`, about 3.7 s. Failed on purpose in a copy of the tree, exit 1 each time, naming the right cases: a live guard re-wrapped onto one line (S1); a wrapper renamed (4 cases); a wrapper declared twice (9); a replacement that does not parse (the 404-braces case); a case that is neither wrapper nor site (`checked 39 of 40 cases`). Earlier, before the review: the closing refusal changed back to a bare return (2 cases).

**The gates:** all deploy-job and guards-job steps (172, the two new ones included) on a clean clone of the gate commits: 170 pass; the 2 that stay red are the environment-only ones named in the 2026-11-05 session doc (no network; `RELAY_SHARED_SECRET`), which CI runs. Both new steps PASS. `workflow-yaml-check` and `check-workflow-timeouts` pass.

**Review (`wf_e548f66c-ae1`, semantics and tripwire lenses, a skeptic on each major):** no blocker. The semantic lens rebuilt the old single-line text, applied the old cases there and compared with the new mutants on the current text: byte-identical for all five; each mutant parses and trips `check-odds-calls-guarded` for the reason its label names. One major, confirmed: the tripwire did not `node --check` the mutants the full run checks. Fixed in `5b15144`, with the five minors that were cheap (the Rule 91 denominator, wrapper declared once, printable anchors, the header, the excluded self step shown in COVERAGE, the working-tree note). **Not done:** decoupling `--anchors-only` from the `git archive` and YAML load that run before it. Moving that block would touch the run path the 39-of-39 verdict covers. Both are available on a runner (the guards run is the proof, below).

**Staged:** the first run of the two new CI steps on a real runner. Blocked by: the push. Unblocked when the guards run for the pushed commits finishes. Verify: `gh run list -R jeffunglesbee-create/field-relay-nba --workflow guards.yml --limit 1` shows `success`, and its log has `PASS  every anchor of 39 of 39 harness cases`.

## Decisions the owner may reverse

1. **The tripwire was added although the order was only "fix the anchors".** The anchors would rot again the next time a guard call is re-wrapped; the 17-day silence is the defect. It is three commits (`edbf0c6`, `f229f01`, `5b15144`) and reverts cleanly without touching the re-pointed anchors.
2. **The step is in both workflows.** `deploy.yml` alone would not run on a push that touches only `scripts/` or `.github/`.

## Open

- Nothing from this change. The done condition of the 10-23 CC-CMD is still read by `trig_018UGzSA57zJmCwKSywz8SzX` at 2026-11-08T09:15Z (a different matter).
