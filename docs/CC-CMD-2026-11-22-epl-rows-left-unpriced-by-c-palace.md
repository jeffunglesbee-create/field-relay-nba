# Claude Code Command — Nine EPL archive rows were left without odds by the `C Palace` defect

**Date:** 2026-11-22
**Repo:** field-relay-nba
**Branch:** main — commit directly, do not create a feature branch or PR
**Type:** B (data repair, billed)
**Status:** DONE 2026-11-22. The owner approved ("Backfill approved", then "Go with Claude's best recommendations and state what they are", the stated number being 270 credits); one capped dispatch (run `45072843545`) priced all nine rows; the done-condition query returns 0. Session doc: `outbox/cc-session-2026-11-22-epl-rows-left-unpriced.md`.
**Filed from:** `docs/CC-CMD-2026-09-11-epl-identity-resolve.md` (DONE 2026-11-22). That CC-CMD's scope was "two defects, both measured. Do not extend", so this finding is its own document (Rule 87.4), not a carry-forward.

## What was measured, 2026-11-22 (read-only SELECTs of `field-archive`; no credit spent)

Nine EPL rows from the 2026-27 season have `opening_odds IS NULL`:

| date | home | away |
|---|---|---|
| 2026-08-21 | Arsenal | Coventry |
| 2026-08-22 | Everton | C Palace |
| 2026-08-28 | C Palace | Man City |
| 2026-09-05 | Fulham | C Palace |
| 2026-09-12 | C Palace | Ipswich |
| 2026-09-20 | Leeds | C Palace |
| 2026-10-11 | C Palace | Nottm Forest |
| 2026-10-18 | Brighton | C Palace |
| 2026-10-25 | C Palace | Newcastle |

**What was measured:** of the 11 EPL rows that carry `C Palace`, the 8 dated before 2026-10-27 are all unpriced and the 3 dated after (2026-10-31 Spurs v C Palace, 2026-11-08 C Palace v Liverpool, 2026-11-21 Coventry v C Palace) are all priced. Zero exceptions either way. **That is a correlation with the date, not a cause.** Two relay changes sit between the early and the late rows: the per-team name-token join (`f4bea6af`, committed 2026-10-25T14:31Z, which lets a row WITH a kickoff match `C Palace` to `Crystal Palace` by name) and the alias (`7191291f`, 2026-10-27T23:42Z). The data cannot say which one made the difference, and the repair does not need to know: the current tree prices a `C Palace` row either way (Task 0, result 5). An earlier version of this paragraph named the alias as the cause; the review below showed the check offered as proof could not fail for the alias.

**The ninth row, Arsenal v Coventry on 2026-08-21, has a measured cause** (found by the review, then re-checked here): the archive writes `Coventry`, the vendor writes `Coventry City` (recorded payload `outbox/odds-h2h-shape-20260824T234850Z.json`, line 142, `Hull City @ Coventry City`). Before commit `e4ad440c` (2026-08-21T23:14:43Z) `resolveTeamKey` gave `coventry` for the one and `coventrycity` for the other; from that commit both give `coventrycity`. The kickoff was 19:00Z, so the alias landed 4 h 14 min after it and no pre-kickoff tick could join the row. Not established: why the dead-hour catch-up did not price it after that night; the repair prices it now.

**Out of scope:** 20 further unpriced EPL rows dated 2026-05-09 to 2026-05-24 (last season's end) carry full club names (`Manchester City`, `Crystal Palace`), so an alias miss does not explain them. Recorded here so they are not mistaken for this defect; not part of this CC-CMD.

## Read before building (BUILD-ON-A)

Statuses read 2026-11-22, none holds this work: `docs/CC-CMD-2026-09-15-backfill-captured-at-not-snapshot-time.md` CLOSED, `docs/CC-CMD-2026-10-19-odds-stage1-wrong-game.md` DONE, `docs/CC-CMD-2026-08-25-misjoined-opening-odds.md` DONE, `docs/CC-CMD-2026-09-15-odds-backfill-missing-api-key.md` CLOSED. The CFL experiment's VOID window (2026-11-08 to 11-23) lists functions this work does not touch.

## Task 0 — probe first (no spend)

1. Re-read the nine rows: `SELECT date, home, away FROM regular_season_games WHERE sport = 'EPL' AND opening_odds IS NULL AND date >= '2026-07-01' ORDER BY date` (read-only; `wrangler d1 execute field-archive --remote` or the Cloudflare D1 tool). Expected 9. A different number means this document is stale: stop and say so.
2. Read the route that would do the repair: `GET|POST /archive/odds-backfill?date=YYYY-MM-DD` (`src/index.js`, `pathname === '/archive/odds-backfill'`; quota floor `ODDS_QUOTA_FLOOR = 50`). It walks one date, calls the Odds API's HISTORICAL endpoint once per sport, matches by team pair and writes `opening_odds` where NULL. It is a write route: do not call it to see what it does.
3. Find what a historical call costs, from evidence and not memory: the Results of `docs/CC-CMD-2026-10-19-odds-stage1-wrong-game.md` (a repair was applied there) and the Odds API's documentation. Write the figure with its source, per date and for nine dates. If it cannot be established without a billed call, say so; do not estimate silently.
4. Confirm the nine rows would join: run `resolveTeamKey` on each name and compare with the vendor's historical names for that date (offline, from the relay's resolver).

### Task 0 results, 2026-11-22 (no credit spent)

1. **The nine rows re-read** (Cloudflare D1 tool, `field-archive`, SELECT only): 9 rows, the table above, each `start_time` 13:00Z or later. A second SELECT shows `odds_history_rows = 0` for all nine, so nothing partial exists to reconcile.
2. **The route's cost model**, read from source and exercised in `scripts/check-odds-backfill-sport-filter.mjs` against a vendor stub: one historical fetch per sport bucket per date, markets `h2h,spreads,totals`, `regions=us`, snapshot `${date}T12:00:00Z` = **30 credits per sport-date** (10 per market). The route had no sport filter, so an unfiltered date costs 30 credits for every sport with NULL-opening rows on it: the check's baseline seeds four sports and spends 120. Measured in D1 (regular and postseason tables, SELECT only, 2026-11-22): the nine dates carry NULL-opening rows in 5, 7, 7, 7, 8, 8, 10, 7 and 9 distinct sports, 68 sport-dates in all. That is an upper bound on the unfiltered bill (68 x 30 = 2,040), because a sport with no odds key is not fetched; how many of the 68 map to a key was not measured. Either way a single date can reach 10 x 30 = 300, the route's whole day cap (`SITE_CEILINGS.archiveOddsBackfill`).
3. **Why the filter, and why not an existing tool** (BUILD-ON-A, searched by content): `scripts/targeted-odds-fill.mjs` already takes `--sport` and `--date`, but its sport set `NEWLY_REACHABLE` (line 72) is twelve sports that excludes EPL, it asks for two markets (20 credits) and writes `odds_history`, not `opening_odds`. Using it would mean editing its set and routing the nine rows through a second table and a sync. The route's own writer already does the repair; the missing piece was only a way to name one sport. Added: `?sport=EPL` on `/archive/odds-backfill`, validated against `archiveSportToOddsKey`, refused with 400 on an unknown label before anything is spent.
4. **Cost for the owner:** 9 sport-dates x 30 = **270 credits**, against the 300 day cap and the 50-credit floor. Nothing is fetched twice by design (the runner allows one attempt per date, and a 24-hour edge cache covers a repeat).
5. **Would the nine rows join:** `scripts/check-odds-backfill-sport-filter.mjs` runs the real worker over a vendor slate of five real-shaped events with different prices, among them decoys that share a team with the target or repeat its pair reversed a week later. The `C Palace` row is priced from ITS event (160/175/250), the postseason EPL row from its own, and a snapshot the vendor serves after kickoff prices nothing. The alias is asserted on the resolver directly (`C Palace` = `Crystal Palace`, `Coventry` = `Coventry City`), each of which fails if its alias is deleted. All nine kickoffs are 13:00Z or later, after the noon snapshot. NOT shown, and not claimable: that the vendor's 12:00Z snapshot of 2026-08-21 and the other eight dates carries these fixtures. That is what the first billed call finds out, which is why the plan runs a `C Palace` date first and the Coventry date last, and why the runner stops, naming the date, when a date finds games and populates none.

### The independent review, 2026-11-22 (29 agents, four lenses, each finding re-checked by a skeptic; 25 findings, 19 confirmed, 6 refuted)

What it found in the first version, all fixed and covered by a named check (commits `c9fc09ba`, `3919b475`, `c2a5e087`):

1. **The deploy of the filter was red** from the first push (the label-split mutation harness's anchors had moved, and `check-scope-claims.mjs` found the new check in the vendor-host population). While it was red the old relay stayed live and the workflow was already dispatchable; an old relay ignores `?sport=` and would have fetched every sport on the first date at 30 credits each. Now: anchors re-pointed (27 of 27), the check listed with its reason, and the runner PREFLIGHTS the relay before spending (an unknown `?sport=` label must be answered 400; costs nothing on either relay). `preflight_only` runs just that.
2. A date with no rows of the sport answered without `sport`, which the runner reads as "filter not applied": it would have stopped the run at the first already-priced date. `sport` is now on every answer.
3. `?sport=epl` and `?sport=constructor` passed the refusal and then matched nothing. The filter ignores case (as the lookup does) and the label must resolve to a string.
4. A credit-guard refusal read as "credits were spent and nothing was written", was added to the estimate and burned the date. The answer now carries `guarded`; the runner names it a refusal that spent nothing.
5. The attempt was recorded only after the answer, so a runner killed in flight let the same date be paid twice. The record is written before the request; every request has a 120 s timeout.
6. The credential was printed unredacted on the stop line for answers the judge rejected, and not redacted in its JSON-escaped form. One redaction point, both forms.
7. The workflow's globs matched three tracked files of other tools; the sport label could reach a file name unvalidated. Both closed.
8. The check could not fail for the alias, and the cron's default was asserted only by call text. Reworked, with the harness going from 10 to 19 mutants (runner: 28 to 41, an equivalent mutant and a dead clause removed).

Not changed, and why: the nine-date cap is per sport label and the approval binds a number rather than the sport (stated design, the owner's approval IS a number); the once-per-date ledger being committed only at the end of the job is covered by the write-ahead file plus the `always()` commit step.

**Recovery.** A date's result file marks it attempted. If a file says no credit was spent (a guard refusal, a request that never reached the vendor), delete that one file in a commit and dispatch again with the number stated again.

**The plan for the one billed dispatch** (after the owner states a number): `dates=2026-08-22,2026-08-28,2026-09-05,2026-09-12,2026-09-20,2026-10-11,2026-10-18,2026-10-25,2026-08-21`, `sport=EPL`, `approved_credits=<the number>`. Before it: `preflight_only=true` with the same inputs, expected `PREFLIGHT OK, nothing spent` in the log.

## Task 1 — the owner's decision

Report Task 0's cost for nine dates to the owner and stop. The owner may approve a number of credits, narrow the dates, or decline (the rows then stay NULL and are listed as accepted in the manifest). Do not proceed on an inferred yes.

## Task 2 — the repair, only after Task 1

One date at a time, in date order, through a spend-capped runner step with the shape of `scripts/probe-identity-mismatches.mjs` (a cap in the code, one attempt per date, the first failure ends the run, a 200 that carries an error is a failure, the calls already made counted from committed artifacts). Not through an uncapped loop.

## Done condition (artifact, not a bare action)

`SELECT COUNT(*) FROM regular_season_games WHERE sport = 'EPL' AND opening_odds IS NULL AND date >= '2026-07-01'` returns `0`, with the query and its output committed in the manifest; or the owner has declined in writing and the manifest lists the nine rows as accepted. "The backfill ran" is not a done condition.

## Task 3 — outbox manifest (last task)

`outbox/cc-session-<date>-epl-rows-left-unpriced.md`: the Task 0 numbers with sources, the owner's decision verbatim, the calls made and their cost as the ledger recorded them, and the done-condition query output.

## Results, 2026-11-22

- **Done condition:** `SELECT COUNT(*) FROM regular_season_games WHERE sport = 'EPL' AND opening_odds IS NULL AND date >= '2026-07-01'` returned `9` at 21:34Z before the dispatch and `0` after it (read-only, `field-archive`). Met.
- **Task 1:** the owner's words are quoted in the Status line; the number was the one this CC-CMD recommended, 270 (nine sport-dates at 30).
- **Task 2:** run `45072843545`, nine dates in the planned order (the eight `C Palace` dates, Arsenal v Coventry last): nine answers, each `games_found 1`, `odds_populated 1`, no guard refusal, no stop. The Coventry date populated like the rest, so the hedge of running it last was not needed. `quota_remaining` fell by exactly 30 between consecutive calls, eight times; the first call's debit is not measured (no reading before it).
- **What was written:** `source draftkings`, `captured_at` 11:55Z on each row's own date, before each kickoff; the nine values are in the session doc. Undo: `change_log` holds the nine `old_value NULL` rows.
- **Task 3:** `outbox/cc-session-2026-11-22-epl-rows-left-unpriced.md` (commit hashes, deploy and dispatch run ids, the query and its output, the spend as measured and as estimated, the residuals).
- **Residual, filed as its own CC-CMD (Rule 87.4):** twenty unpriced EPL rows dated 2026-05-09 to 2026-05-24 are a different state (no `start_time`, never finalized): `docs/CC-CMD-2026-11-22-epl-june-seed-rows-unpriced.md`.
