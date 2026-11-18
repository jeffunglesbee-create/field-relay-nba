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

