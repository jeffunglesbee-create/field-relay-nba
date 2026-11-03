# Session 2026-11-03 — wrap-up of docs/CC-CMD-2026-10-13-vendor-residual-window.md

**Date:** 2026-11-03 (work began 2026-11-02 evening, finished after midnight UTC) · **Repo:** field-relay-nba · **Branch:** main
**HEAD progression:** `c96d007` → `72ef452` (noHeaderCredits) → `247e77a` (analyzer) → `6b6ff60` (src comments) → the documents and this close-out in one commit (the next one)
**Task:** the owner's order "wrap up entire cc-cmd" on the CC-CMD that held the vendor residual, the CFL abort experiment and Task 3 (the `ctx.waitUntil` fix).
**Odds API credits spent:** 0. **Worker code changed:** `src/index.js`, two comments (no behaviour). **Deploy:** Deploy RELAY Worker run 41555964661 success (its `deploy` job, including the deploy gate "confirm relay is live" at 01:03:07Z, and its post-deploy `verify` job; commit `6b6ff60`).

## What the wrap-up was

An independent audit of the CC-CMD (39 agents, three lenses, skeptics per finding) before closing it as DONE returned 35 confirmed findings and 1 refuted. Everything below is those findings applied, not a re-design. The original deliverables (Task 1, Task 2, Task 3, done conditions 1 to 4) were already built, deployed and proved; this session changed how the one open measurement is defined, where it is recorded, and who owns each leftover.

| Cluster of findings | What was wrong | What was done |
|---|---|---|
| Status | the carrier's Status said DONE and "OPEN and STAGED", the vendor Status said "every done condition is MET" and ended "is open" | carrier PARTIAL 2026-11-03 (flips to DONE on or after 2026-11-24); vendor DONE for conditions 1 to 4 with condition 5 CARRIED; Task 3 part 2 "carried" |
| The 11-07 criterion | defined on the raw gap `by_site - kept`, which an `error` row lowers by 6 per call | moved to `stranded` before any 11-07 data exist; the analyzer prints both; thresholds unchanged |
| Where the result goes | the armed wake said "done condition 4, part 2" and "record in the vendor CC-CMD"; the docs said the carrier owns it; the carrier is on the calendar experiment's VOID list | the wake rewritten; the result is recorded in the vendor CC-CMD's Data points; the carrier's last edit before the window is dated 2026-11-03 |
| Leftovers with no carrier | window-drift refusal, P2, the `\|\| 0` sum, the "2 credits" comment, the open half of Note 2026-10-27, option 3's revisit, `getWCPregameLambdas` | each has an outcome in the carrier's Note 2026-11-02, items 1 to 9 |
| Stale or wrong statements | "0 of 5 ... left no tally" read backwards; r 0.93 vs 0.925; "three charges" for 24 credits; "cannot be re-measured"; the open approval in two session docs; "cancel as a pair" in a third; the 08:15Z close-out's stamp and credits | corrected where they were, dated |
| Reproducibility | the drift series is a rolling 60 samples; a bare analyzer run overwrote the committed 2026-11-01 record | `--out`, `--day`, the 11-01 record left alone, quoted figures labelled as that record |

## Commits

1. `72ef452` **`noHeaderCredits` no longer sums a missing field as 0.** `scripts/watch-odds-daily-vs-vendor.mjs`: a row that is not an object, or a `no-header` row without a numeric `credits_kept` or `n`, makes the tally null (UNREADABLE). Self-test 83 of 83; mutation harness with `--with-run` 53 of 53 (V3a restores the original defect; V14's anchor had to be re-pointed, it had silently stopped mutating anything); the run check passes against the stub relay. The line feeds only a diagnostic, not `judgeDay`.
2. `247e77a` **The analyzer.** `stranded` and `kept_error` in `cflSample`; `--day` (the day's last sample, both figures, the unread hours, a verdict, `outbox/cfl-stranded-day-<day>.json`); `ciSide` (P2); `--out`. Self-test 41 of 41, harness 35 of 35. `outbox/cfl-reconcile-gap-2026-11-03.json` is the P2 evidence.
3. `6b6ff60` **Two header comments** in `src/index.js` (`/cfl/odds-probs` 6 credits, `/wc/odds-probs` 4), single-line replacements so line citations do not move. Before 2026-11-08 because a commit to `handleCFLOddsProbs` inside the window voids the calendar experiment.
4. **The documents** (one commit with the close-out): the vendor CC-CMD (Status, P2, P5, Command, Task 2b pointer, Task 3 part 2, done conditions 3 to 5, a 2026-11-03 Data point), the carrier (Status, Decisions 3 and 4, Note 2026-11-02 items 1 to 9), the prediction document ("Added 2026-11-03"), the 10-23 CC-CMD, three older session docs, HANDOFF.

## Two scheduled tasks changed

- `trig_01E9kMQiyKXENeyzuxNFBNsV` (2026-11-08T08:00Z): now done condition 5. It runs `--day` for 11-03 to 11-07, treats the 11-07 line as the criterion and the other four as context, never runs the analyzer bare, records the result in the vendor CC-CMD's Data points and leaves the carrier untouched. Inconclusive closes the condition as inconclusive; nothing is re-armed.
- `trig_019aQvU36rYwZ7PqjaMnV5ut` (the judge, 2026-11-24T14:00Z): one additive paragraph. Its scoring text is unchanged. The paragraph is quoted verbatim in the prediction document's "Added 2026-11-03", item 5.

## Verified end to end vs staged

**VERIFIED here, on the committed tree:** the analyzer self-test and harness; the watch self-test, run check and harness; `--day` on three real days (10-29 `fail` at stranded 588 of 357 HIT; 11-01 `pass` at 24 with a 21:24Z last sample; 11-07 `no-data`); the P2 count (10 of 11); the three odds checks on `src/index.js`; the doc gates (`cc-cmd-status-check`, `check-doc-citations`, `check-handoff-current`, `check-closeout-session-doc`) on the clean clone; CI on `6b6ff60`: Deploy RELAY Worker 41555964661, Repo guards 41555964700, Runner read path and CFL gap guards 41555964620 and Workflow YAML Gate 41555964728, all success.

**STAGED, done condition 5.** What is staged: the busy-day read of 2026-11-07. Blocked by: the day itself (no data exist) and the drift series reaching 11-07's last sample. Unblocked when: `trig_01E9kMQiyKXENeyzuxNFBNsV` fires at 2026-11-08T08:00Z. Verify: `node scripts/analyze-cfl-reconcile-gap.mjs --day 2026-11-07` prints `verdict: pass`; `node -e 'console.log(JSON.parse(require("fs").readFileSync("outbox/cfl-stranded-day-2026-11-07.json")).verdict)'` prints `pass`. No verifier reads the drift series by day, so this is read by hand and the result is a Data point.

**Not verified live:** the next scheduled run of `odds-daily-vs-vendor.yml` is the first to run the rewritten `noHeaderCredits`; its log should still print the "unreconciled estimate" line (a number, or UNREADABLE).

## Decisions made here that the owner may want to reverse

1. The window-drift refusal is left as it is (1 of 34 logs; none of the 22 since 10-12).
2. The judge's prompt got an additive paragraph. The alternative was to leave the duties it was given on 2026-11-01 unreadable by the judge.
3. P2 is closed on a 10-of-11 count, with the one exception recorded and unexplained.
4. The recommendation on `getWCPregameLambdas` is to land TASK 1 of `docs/CC-CMD-2026-10-23-odds-spend-without-need.md` first. Nothing is built for it.

## Open

- Done condition 5 (above), and Note 2026-10-27's second reading (`trig_01Kc6YEYyFDtRDsuQzjtrHxW`, 2026-11-03T08:30Z, bound to another session): both have owners and triggers.
- The carrier is PARTIAL until 2026-11-24.
- Not part of this CC-CMD and not started: TASK 1 of the 10-23 CC-CMD; the dead-cron ratchet's two new entries from another session's in-flight work.
