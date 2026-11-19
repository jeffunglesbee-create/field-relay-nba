# Session 2026-11-12 to 2026-11-15: reads closed, daily odds and CI reads, and the cause of the 197 older unjoined BSD rows

Docs and read-only work only. No `src/` commit (CFL VOID window 2026-11-08..11-23), no Odds API call, no BSD call, nothing written to production except the one owner-ordered workflow dispatch below.

## 1. Reads that closed (2026-11-12)

- **`nfl-player-stats.yml`, first scheduled tick (cron `41 12 * * 3`).** At 19:47Z on 11-11 no `schedule` run existed (426 min after 12:41Z); run 43090991384 was created at 19:50:57Z (430 min, `success`, 559 players, `WRITTEN AND SERVED`). Late, not dropped. The owner ordered "dispatch refresh now" on 2026-11-12 and run 43134528433 (`workflow_dispatch`, `success`) rewrote the same data: redundant. Recorded in `docs/CC-CMD-2026-11-03-nfl-r2-player-stats-oom.md` ("Observed 2026-11-11" and "Resolved 2026-11-11 19:51Z"). The check for the 2026-11-18 tick is armed as `trig_01FyXZK9Z55tASiM7oK2T7S3` (21:00Z); it does not dispatch without an order.
- **NFL R2 memory part, verified.** `worker-cpu-read.yml` (`days=14 mode=localise status=exceededMemory`): 15 buckets, all on 2026-11-04, none on 2026-11-11; the Worker stub `a5c8da1` was in the deploy `1e3e9a5` (2026-11-08 11:06Z), before the window. Log `outbox/worker-cpu-read-localise-field-relay-nba-exceededMemory-2026-11-12T0130.log`.
- **`docs/CC-CMD-2026-11-02-scheduled-job-skipped-every-time.md` is DONE.** `patent-watch.yml`'s 2026-11-11 scheduled run (client run 43113004662, created 395 min after 16:00Z) succeeded, both "Commit results" steps `success`, the commits `db30fe3` and `e54ce07` are on the client's main, the manifest has `read_complete` true; the first dead-cron run created after it (43294450943) no longer lists the workflow. No baseline edit.

## 2. Daily odds and CI reads (11-12, 11-13, 11-14, each at about 18:35Z)

All seven watches green on each day: `odds-daily-vs-vendor` `tracks-the-bill` with residual 0 (closed days 11-11, 11-12, 11-13), attribution 0 unaccounted, pairing unexplained 0, no degrade events, no refusals, `undeployed-src-watch` `deployed` with 0 src commits since the last green deploy `1e3e9a5`. Nothing spent. One non-zero first appearance noted, not a finding: `fetchSportOddsHistorical` 30 credits on 11-12, well under its 1800 cap and fully attributed.

## 3. The 197 older unjoined archive rows: the cause is read (2026-11-15 01:30Z)

Full record: `docs/CC-CMD-2026-10-28-bsd-join-aliases-beyond-the-fixture-dates.md`, "Addendum 2026-11-15". Read-only from D1 `field-archive`: 197 unjoined rows over 34 dates (2026-08-15 to 2026-10-23) plus 38 May rows the CC-CMD did not count; every row from 2026-10-24 on is joined. The join's `change_log` rows begin 2026-10-28T00:23Z, and nine dates were joined in one admin pass that night; the scheduled join visits only today to today+3 and yesterday, so a date older than yesterday is reached only by `POST /admin/bsd-game-join`, which was never run for the other 34. A coverage gap by design, not the aliases (97 of 97 club names match). A backfill costs about 170 BSD pages (derived) against a budget nobody knows (BSD sent no RateLimit header, 2026-10-29), so it is the owner's call; the closing artifact is in the addendum. Not run, not built.

## 4. Observed, not acted on (TOUCH-ONLY)

- `scripts/check-handoff-current.mjs` reads only `**HEAD:** \`a\` -> \`b\``. Close-outs since 2026-11-08, mine of 11-11 included, used another form, so the check measured from `00c4866` and went red on 2026-11-15 when the oldest unrecorded work commit passed a day (it was red on the clean tree). This entry restores the form. The check also counts workflow-authored "verify: tennis draw route against three real slam editions" commits as work; that classification is not changed here.
- Client `scripts/check-probe-meta-read.mjs` exits 1 in the authoring sandbox (Playwright's headless shell is missing) and passes on a runner.

## 5. Armed and unchanged

the NFL tick check above (11-18); the CFL judge, the WC Defect B work, the item 3 landing check and the retire-NFL-R2-callers work on 2026-11-24; the daily 18:30Z read. Owner-gated, unchanged: the item 3 landing go line, the 61-row `wc_results` DELETE and `wc_group` re-derivation, Odds credit spend, the by_hour restart, and now the BSD backfill.

## 6. Update 2026-11-15 14:10Z: the CFL pre-window record is written

`trig_01EZCgJPQonto9XQmztYGvc5` fired at 14:00Z. Rows appended to `outbox/odds-cfl-season-end-prediction-2026-10-18.md` under "Recorded 2026-11-15, before kickoff" (commit `e385b11`, on `origin/main` at 14:06Z, 9 hours before the 23:00Z kickoff), from read-only D1 `SELECT`s (`odds_budget`, `odds_budget_site`, `odds_reconcile_state`) and the seven committed logs `odds-daily-vs-vendor-2026-11-09T0613.log` to `...-11-15T0618.log`. 7 of 7 closed days (2026-11-08 to 2026-11-14) judged, every verdict `tracks-the-bill`. Watch residual 0, `daily - receipts` 0 and `CFL by site - CFL receipts` 0 on every day (reference week: 5,154 and 4,530); CFL by site 570 over 95 reconciled calls at 6 credits each; 25 CFL `error` calls kept 150 credits that are not in CFL by site. No prediction text edited. No credits, no odds route, no `src/` commit. The first push was refused because `origin/main` had moved (a census chore commit); the one commit was rebased onto it and pushed, not forced.

The recorded figure is 0, where the 2026-11-01 paragraph of that document expected "a SMALL stranded figure ... on busy days, not zero". No cause was tested here; the judge's report on 2026-11-24 carries the contrast.

## 7. Update 2026-11-15 23:35Z: the archive date-keying row was not written

`trig_01DrtUC8zfMiPfKvQFP8ttQT` fired at 23:30Z. Oklahoma v Ole Miss is final (24 to 17). The trigger's rule for a second row applied: `CFB_2026-11-15_e401856887` exists (created 21:15:31, at finalization) beside the stale `CFB_2026-11-14_e401856887`, so no write, no delete. Both rows, their `change_log` rows (26626, 26722, 26734) and four options with costs are recorded in `docs/CC-CMD-2026-10-16-cfl-archive-date-keying.md` under "Observed 2026-11-15". Read-only D1 `SELECT`s only. The one query that failed was a `sqlite_master` join (`SQLITE_AUTH`); it was not needed, since the odds lines are columns of `regular_season_games` and rows of `change_log`.

## 8. Update 2026-11-16: both premises behind options A to D are probed

The owner asked to probe the two premises left open in section 7. Method: a read-only census of the four repos at `origin/main` `397b961` (7 areas, a second reader per area, 2 completeness critics; `src/`, `workers/`, `scripts/` and `.github/` unchanged through `ca464ce`), plus three D1 reads and one relay GET. Nothing was written to production.

Result, in the CC-CMD (`docs/CC-CMD-2026-10-16-cfl-archive-date-keying.md`, Observed 2026-11-15, item 5): no reader resolves `change_log.game_id` to a games row, so options A and B drop nothing; a second row for one game does change what is served, and does today (`/context/game/espn:401856887` returns the unscored old row, and `isGameFinalByEventId` reports the finished game as not final). The recommendation (A) stands. Denominators: 308 sites recorded, 230 re-opened by a second reader (68 corrected), 63 added by the critics and not re-checked; the unread parts are named there.

Open and not probed: which writer put final text in `game_live_cfb_401856887`; whether the client payload spans both dates; the `/freshness` bound-parameter cap. Found in passing and added to the CC-CMD that already covers the route (`docs/CC-CMD-2026-06-21-brief-freshness-guard.md`, BUILD-ON-A): three closing-line writers store `ts` in a format `/freshness` compares as text against an ISO `since`. Owner-gated, unchanged: the choice among A to D, the writer fix after 2026-11-23.

## 9. Update 2026-11-18: option A was applied by another session; this session verified it

The owner answered the A to D choice ("Go with claudes best recommendations") and, separately, told another session "Option A". That session ran a one-shot workflow (run 44223383680, commits `0c7a708`, `72da938`, `9b73d57`) while this one was building a guarded four-statement executor for the same order. This session re-read `origin/main` before dispatching anything, found the apply, stopped its own review (a second pass was running), and did not run its tooling. Nothing was written twice. The tooling (plan, executor, a 279-check suite on node:sqlite with a fake relay, 103 mutants run on copies, a dispatch-only workflow) is not in the repo: it was reviewed twice by five-lens workflows, whose confirmed findings are the reason its checks are what they are, but the write it was for is done.

What this session recorded, in `docs/CC-CMD-2026-10-16-cfl-archive-date-keying.md` (2026-11-18 verification): the independent read-back (one scored row carrying the opening line byte for byte; `/context/game` serves it; `Repo guards` run 44223368895 all 56 steps green), the `odds_history` reader census (nothing breaks on the one row that now has no games row; 4 of 57 `src/`, 6 of 212 `.github/`, 19 of 505 `scripts/` files name the table), the departure from the laboratory's MLS-merge precedent and its reason, and the one gap (no `change_log` entry for either write; the two inserts need the owner's word). Added to the 2026-09-13 duplicate-rows CC-CMD under BUILD-ON-A: the collision-cleanup delete path guards on briefs only, and a live same-date duplicate for ESPN event 401909985 that no document recorded.

Owner-gated, unchanged: the two `change_log` entries for the apply; the writer fix after 2026-11-23; the 61-row `wc_results` delete and `wc_group` re-derivation; the item 3 landing go line; the BSD backfill; any Odds API spend.

## 10. Update 2026-11-18: the two audit rows are written

The owner ordered them ("Write the audit rows"), which is the word section 9 said was needed. Recorded in full in `docs/CC-CMD-2026-10-16-cfl-archive-date-keying.md`, 2026-11-18 verification, item 8. In short:

- Writer, check (148) and mutation harness (70 mutants, all caught) and a dispatch-only workflow, committed `e5fe9d4`.
- Dry run, run 44227491296: phase `fresh`, 8 of 8 preconditions PASS, nothing written. Apply, run 44227605344: both statements `changes=1`, re-read 12 of 12.
- Independent read-back from D1: `change_log` 27069 (keeper, `opening_odds`) and 27070 (old id, `row_deleted`, both blobs in `old_value`, the keeper's id in `new_value`) exist once each and equal the rows they were copied from by SQL `=`. The games row, 26626, 26722, 26734 and the `odds_history` row are unchanged.
- One defect found on the way and fixed before the push: the absence-collapse ratchet (`scripts/absence-collapse-ratchet.sh`) flagged a `?? ''` in the run-id header line (3 sites against a baseline of 2). It was rewritten to say `sha not set` when `GITHUB_SHA` is absent; the ratchet passes.

Owner-gated, unchanged: the writer fix after 2026-11-23; the optional repoint of the `odds_history` row to the keeper; the 61-row `wc_results` delete and `wc_group` re-derivation; the item 3 landing go line; the BSD backfill; any Odds API spend.

## 11. Update 2026-11-18: the odds_history row is repointed

The owner ordered it ("Repoint the odds_history row"), which is the owner-gated item section 9 left open. Recorded in full in `docs/CC-CMD-2026-10-16-cfl-archive-date-keying.md`, 2026-11-18 verification, items 9 and 10. In short:

- **Probed first (Rule 100), read-only, 5 agents:** the item 4 warning that the row would read as misjoined to `repair-odds-wrong-pairs.mjs` is refuted (no mismatch predicate, closed id lists, no workflow runs it). Two latent paths the repoint arms were found and made refused preconditions: a NULLed keeper blob refilled by the daily sync, and a deleted 2026-11-15 progress row letting a reprocess insert a second close row. The primary key was not renamed (outside the order).
- **Built and reviewed:** a writer, a check of 153 assertions, 87 mutants (all caught for their named reason) and a dispatch-only workflow, committed `0356907`; a four-lens adversarial review returned safe-to-run from all four, and its gaps (an unbacked dry-run default among them) were closed with mutants before the push.
- **Run:** dry run 44239518896 (8 of 8 preconditions), apply 44239772368 (`changes=1`, re-read 9 of 9). **Independent D1 read-back:** the row is on the keeper with every other column and its primary key unchanged; history rows with no games row 0 (was 1); the table's 1,556 rows and 1,556 distinct triples unchanged.
- **Found on the way, not fixed (shared tooling):** `scripts/probe-commit-retry.sh` does not check its own `git add`, so a failed add with an empty index prints "nothing to commit" and exits 0. Added as a dated note to `docs/CC-CMD-2026-09-14-git-state-swallow-sweep.md`.
- **Goes stale, not changed:** the spent audit-rows one-shot pins one history row on the old id, so a re-dispatch of `write-oklahoma-audit-rows.yml` now refuses (exit 1, nothing written) instead of printing ALREADY DONE.

Owner-gated, unchanged: the writer fix after 2026-11-23; the optional primary-key rename of this row (one statement, closes the duplicate path only); the 61-row `wc_results` delete and `wc_group` re-derivation; the item 3 landing go line; the BSD backfill; any Odds API spend.

## 12. Update 2026-11-18: the items recorded and not built are built (the owner's "Rule 42")

Section 10 and 11 left four things recorded and unbuilt. Rule 42 (change approach after repeated attempts at the same thing) was read as: stop recording, build what is unblocked. Full text in `docs/CC-CMD-2026-09-14-git-state-swallow-sweep.md`. In short:

- **`scripts/probe-commit-retry.sh`:** reproduced first (an index.lock with a file present, two pathspecs with one absent, an ignored explicit path: each printed "nothing to commit" and exited 0 with nothing pushed). My earlier note was wrong twice: the script is run by 55 workflows directly and 19 more through the reusable one (74), not ten; and the bare `|| exit 1` I proposed would have broken the empty-pathspec case (`git add` exits 128 there) for all of them. Built: stage each path under `LC_ALL=C`, skip only "did not match any files", fail on anything else, print git's words always, refuse a blank `PROBE_PATHS`, check the commit. Check 25 to 48 assertions (14 go red on the unfixed script), mutants 10 to 18, all caught; the check now also runs in `guards.yml`.
- **The German:** the empty-pathspec test reads git's English text; the `git` shim that answers in German is the only way to make `LC_ALL=C` testable here (the German locale is not installed, so the first mutant changed nothing and was not caught).
- **Four-lens review before the commit:** safe to ship or safe after fixes from all four, 0 blocks, 0 regressions; its gaps (silenced stderr on success, `continue` versus `break` untested, blank `PROBE_PATHS`, the unchecked commit, wrong counts, no CI run on a scripts-only push) were closed in the commit.
- **Audit-rows one-shot:** the precondition is "at most the one history row", so a re-dispatch after the repoint reads ALREADY DONE; 149 checks, 72 mutants; its check no longer leaks temp directories.
- **Daily-read prompt:** the "104-405 min" in watch 1 now says where the figure came from and adds the 492.
- **Recorded, not built (reasons in the CC-CMD):** the push-race locale test, `deploy.yml`'s swallowed add, the in-place mutation harness, `${STATE}` undefined in `timetravel-window-watch.yml`, a pre-staged index.

## 13. Update 2026-11-19: `deploy.yml`'s swallowed add is fixed (the owner's order)

Item (2) of what section 12 recorded and did not build. Full text in `docs/CC-CMD-2026-09-14-git-state-swallow-sweep.md`, section "Found and fixed 2026-11-19". In short:

- **Defect:** the `Commit results` step of `verify` turned a failed `git add` into "(no ... artifact to stage)" and a refused `git commit` into "Nothing to commit - no push needed." with exit 0, in the sole deploy path.
- **Fix:** `stage()` runs one `LC_ALL=C git add -- "$@"` per glob; only a bare "did not match any files" is skipped; everything else exits 1 naming the path. The commit is tested on `git diff --cached --quiet`. Push loop untouched.
- **Check:** `scripts/check-deploy-commit-results.sh`, 59 assertions on the step's own extracted text, real clones and pushes under `bash -e`: 13 red on `HEAD`'s step, 0 on the fix. **Mutants:** `scripts/mutate-deploy-commit-results.py`, 30 plus three safety tests of the check (H1 hostile git environment, H2a/H2b a failed clone must not run the step in the caller's repository), all caught. `guards.yml` runs the check and `--anchors-only`.
- **Review (three lenses, before the commit):** no bug in the step. In the check: a step key written after the `run:` block was never read (a trailing `continue-on-error: true` passed), the check was not hermetic (this sandbox exports `GIT_CONFIG_COUNT=3`), a failed clone would have run the step in the caller's repository and pushed there (reproduced), one assertion could not fail for the original text, six regressions passed unnoticed. Cost: the first version ran 607 `git add` calls on the real checkout (about 4 s a deploy), so the step stages per glob. All fixed in the commit.
- **Stray from the review:** the reviewer's experiment created `/nonexistent/pre-commit` (a 37-byte refusing hook) on this machine; the built-in safety check blocked removing it, so it is left for the owner (`rm -r /nonexistent`).
- **Behaviour change for the owner:** a real add or commit error now turns `verify` red, the whole Deploy run reads `failure` after a green deploy, three `workflow_run` probes SKIP and `undeployed-src-watch` reports `undeployed`. Not reachable today. If a red verification note must not disable the probes, move the commit into its own job and workflow; do not swallow the error again.
- **NOT verified:** the runner's git 2.56.1 (ran on 2.43.0); the first real execution (STAGED, below).
- **STAGED:** the fixed step on a real deploy. Blocked by `deploy.yml`'s `paths` filter (a workflow-only edit does not deploy; a deploy is not dispatched without the owner's order). Unblocked by the first push touching `src/**` or `wrangler.toml`. Verify: that Deploy run concluded `success`, its `verify` job's `Commit results` step concluded `success`, its log has `Pushed verification note on attempt N.` and no `::error::`, and `main` carries a `chore: post-deploy live verification` commit with two files. Read armed: TRIGGER_ID_PLACEHOLDER.

