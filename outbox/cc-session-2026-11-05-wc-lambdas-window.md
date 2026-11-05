# Session 2026-11-05 — TASK 0 and TASK 1 of docs/CC-CMD-2026-10-23-odds-spend-without-need.md

**Date:** 2026-11-05 · **Repo:** field-relay-nba · **Branch:** main
**HEAD progression:** `b59b469` (when the work began) → `04dc077` (the gate and its check) → `d05d7fd` (the by_hour data point for 2026-11-04) → the documents and this close-out (one commit) → a docs-only commit after the deploy that replaces the two PENDING tokens below
**Task:** the owner's order "It's been 2 weeks, check the freshness and suitability of the 10-23 cc-cmd before beginning." Audit first, then begin.
**Odds API credits spent:** 0. **Deploy:** Deploy RELAY Worker run 42103983396, success (deploy job 2026-11-05T20:30:21Z to 20:39:21Z, post-deploy verify job to 20:40:02Z); Repo guards run 42103983255, success (commit `04dc077`, pushed 20:30Z with the two docs commits; the gate steps that cannot run in the sandbox, `every BSD frame...` and `Every archived game is dated...`, ran in that guards run and passed).

## What was asked, and what the audit said

Is a 13-day-old FILED CC-CMD still true at HEAD, and should TASK 1 be built as written. A 27-agent workflow (`wf_d54b5c1a-da7`; six lenses, skeptics, two attempts to break "gating changes no behaviour outside the window", a completeness critic) returned **BUILD WITH AMENDMENTS**. The premise was fresh. The CC-CMD was wrong in four places, all corrected in the CC-CMD itself (its "Audit 2026-11-05" section lists ten rows): the window constants were locals of `scheduled()`; the existing check stayed green with the window removed; the done condition passes on the unfixed worker; and the finding was typed as vendor spend when the vendor kept 0 on 1,801 of 1,801 reconciled calls.

## A second review, before the push

A 9-agent workflow (`wf_8a2d1755-d90`: code, document accuracy, governance; a skeptic on each blocker or major) reviewed the unpushed commits and staged documents. No blocker; the source change was driven through the real `default.fetch` at five pinned instants by the code lens and is correct. Six major findings (four confirmed, two refuted as major) and about twenty minors. What changed because of it:

| Finding | Disposition |
|---|---|
| The check passed a negated, commented-out, or-true and comma-operator window conjunct (Rule 90) | `check-wc-lambdas-gated.mjs` now judges a comment-blanked gate, requires an un-negated TOP-LEVEL `&&` term, refuses a top-level `or` or comma, locates the Dates and the predicate in comment-blanked code and outside a template literal, and pins `Date.now()` as well as `new Date()`. Old check versus new on four hand-made defects: the old passed all four, the new caught all four (`outbox/wc-lambdas-window-check-2026-11-05.txt`, section 4) |
| The done-condition query was documented as returning NO ROWS but an aggregate returns one NULL row; `odds_budget_site` was never read | rewritten in GROUP BY form over both tables |
| The demand control "at least 78" | kept, calibrated and its denominators printed (T=78: 0 false passes on 18 eligible days of 28), called a proxy of a different caller, INCONCLUSIVE below it; the paired in-day probe was rejected because it would call the vendor on a broken worker (`outbox/wc-lambdas-demand-control-replay-2026-11-05.txt`) |
| PENDING placeholders had been staged into the VOID-listed carrier | removed from the carrier and the prediction document; they remain only in the 10-23 CC-CMD and this document |
| "the vendor body was never observed" | evidence added: the sister route `/wc/odds-probs` (same URL, same `h2h` skip) returned `probs: []` in 186 of 206 committed probe artifacts, none non-empty (counted again here) |
| the "null, empty and unmatched Map give the same winProb" claim had no artifact | `outbox/wc-lambdas-winprob-equivalence-2026-11-05.txt`: the real lookup block, `teamNameMatch` and `computeLiveWP`, 4 of 4 games identical, and the condition shown (a matching Map entry changes the result) |
| Wrong or loose figures in the documents (13 not 14 calls; error calls not rows; item 3 not item 5; the FORBIDDEN source; "same weekday"; the for-of count; the carrier's last-edit date) | each corrected where it stood |
| The 11-08 trigger could not be followed from the CC-CMD alone (refuted as major: the trigger's stored prompt does carry the queries) | the CC-CMD now carries the trigger id and both queries verbatim and names the heading to write |

## What was built

| Item | What | Where |
|---|---|---|
| TASK 0 | readers census (one call, four reads, zero code readers in the other repos) and the per-day ledger since 2026-10-08 with the by-state split | `outbox/odds-wc-lambdas-ledger-2026-11-05.json` |
| TASK 1, source | `_wcOpen`/`_wcClose` MOVED to module scope (once); `wcWindowOpenNow()`; the window as a conjunct of `_wcWpPossible` | `src/index.js`, commit `04dc077` |
| TASK 1, check | red on `b59b469` (4 findings), green on the change; self-test 39/39: 35 mutants (the M series on fixtures, the R series on the real source) and 4 controls | `scripts/check-wc-lambdas-gated.mjs` |
| Documents | the CC-CMD (Status, TASK 0 result, TASK 1 note, done condition replaced, audit section); the prediction document ("Added 2026-11-05"); the carrier's pointer; HANDOFF | `docs/`, `outbox/`, `HANDOFF.md` |

Not touched: `consumeOddsCredit`, `checkAndIncrementDailyOdds`, `chargeMonthlyOdds`, `chargeOdds`, `reconcileOddsCredit`, `handleCFLOddsProbs`, any wrapper, any option of the 10-18 charge CC-CMD, `check-odds-calls-guarded.mjs` (run unchanged, green), the `_isWCWindow` line.

## Verified here vs staged

**VERIFIED on the committed tree:** the check red/green and its self-test; `node scripts/measure-odds-consumer-demand.mjs --self-test` (the moved Dates still read exactly once); `node --check src/index.js`; the odds checks on `src/index.js`; every deploy-job and guards-job step (170 steps) on a clean clone named `field-relay-nba`: 143 green on the first pass, which ran on a `.git`-less export; the 27 reds were re-run in a real clone and 23 went green. The 4 that stayed red were 3 distinct causes, none about this change: HANDOFF currency (two entries, one script, `check-handoff-current.mjs`), which passes with this close-out written; `every BSD frame the contract declares matches the captures` (`list page 1 failed: HTTP 0`, no network here); and `Every archived game is dated on the ET day of its own kickoff` (`RELAY_SHARED_SECRET must be set`). The last two run in CI after the push. That gate run predates the review fixes; the check, the source comment and the documents were re-run after them (self-test 39/39, the doc gates).

**`scripts/mutate-deploy-odds-wrappers.mjs`, finished, on a clean clone at the gate commit: 34 of 39 cases as expected, control GREEN.** All four `getWCPregameLambdas` cases behave as expected (S5 CAUGHT, R1 CAUGHT, R2 CAUGHT, the equivalent rewrite GREEN), so the two anchors inside the function still bite. The 5 that do not are FAIL with `anchor matched 0 times ... NOTHING MUTATED`: `fetchSportOddsLive` (S1), `fetchSportOddsHistorical` (S3 and E7) and the ambient closing capture (S4 and `the refusal logs and no longer returns`). **They fail identically at `b59b469`, before this change** (each run alone with `--only=` in a clean clone of that commit, control GREEN first), so they are pre-existing harness drift, not caused here. Cause, from the source: the consume calls at those sites now continue onto a second line, and the harness anchors are single-line text. Those five cases therefore test nothing today; the deploy gates they were written to prove are not shown to fail on a moved guard at those five sites. Noted in `docs/CC-CMD-2026-10-19-odds-guard-before-fetch.md`, which owns the S cases.

**STAGED, done condition (Rule 74).** Staged: the two-sided read of closed day 2026-11-07. Blocked by: the day itself. Unblocked when: `trig_018UGzSA57zJmCwKSywz8SzX` fires at 2026-11-08T09:15Z. Verify, exactly as in the CC-CMD:

```
SELECT day, SUM(n) AS attempts FROM odds_reconcile_state WHERE site='getWCPregameLambdas' AND day IN ('2026-11-06','2026-11-07') GROUP BY day   -- must be EMPTY
SELECT day, used FROM odds_budget_site WHERE site='getWCPregameLambdas' AND day IN ('2026-11-06','2026-11-07')                             -- must be EMPTY
SELECT SUM(n) FROM odds_reconcile_state WHERE site='fetchSportOddsLive' AND day='2026-11-07'                                              -- must be >= 78, else INCONCLUSIVE (repeat 2026-11-14)
```

with Saturdays 2026-10-24 (932) and 2026-10-31 (711) and Sunday 2026-11-01 (451) as the pre-deploy controls, all printed `N of M days`.

## Decisions made here that the owner may reverse

1. **The window gate was built, not the `sport === 'wc26'` gate.** The CC-CMD ordered the window; the audit named the sport gate as the smaller change (no date literal, no edit to `scheduled()`, it also removes the club-league calls made inside the tournament). It is written in the CC-CMD as the owner's alternative. Switching replaces one conjunct and the M/R cases.
2. **The original done condition was withdrawn and replaced** (it passes on the unfixed worker). The original text is kept in the CC-CMD.
3. **The carrier and the prediction document were edited** on 2026-11-05, before the window: a pointer sentence in the carrier, an "Added 2026-11-05" paragraph in the prediction document. Neither takes a commit from 2026-11-08 to 11-23, and neither carries a PENDING token.
4. **Re-typed** from A (real vendor spend) to C: the vendor billed 0.

## Open

- The done condition (above). `trig_018UGzSA57zJmCwKSywz8SzX` records the result in the CC-CMD, not in the carrier.
- DONE in the docs commit after the deploy: the two PENDING tokens are replaced and the wrappers-harness verdict is recorded (next section).
- Not mine and not started: the dead-cron ratchet (`patent-watch.yml`), another session's.
- The waitUntil registration of the lambdas calls (carrier Note 2026-11-02, item 2) is moot outside the tournament now and stays the owner's call for a day inside it.
