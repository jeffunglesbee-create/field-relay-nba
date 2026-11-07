# Session 2026-11-06/07 — "No lineup source for this game", and the FA Cup missing from the scoreboard

**Date:** 2026-11-06 22:50Z to 2026-11-07 · **Repo:** field-relay-nba (and field-laboratory, below) · **Branch:** main
**HEAD progression:** `142f50c` (when the work began) → `d468c78` and `c17de04` (the FA Cup season probe and its runner output) → `533090e` (the lineup join fix) → `a18d3d5` (FA Cup on the relay) → `4059f8d` (two both-direction gates) → the documents and this close-out
**Task:** the owner's message after a screenshot of the laboratory scoreboard (5:50 PM ET, 2026-11-06): "More leagues do sit below the fold, although fa cup is missing. The main issue is the lineup source can't be found."
**Odds API credits spent:** 0. **Worker code changed:** yes (`src/index.js`, `src/journalism-quality.js`, `src/morning-report.js`), so there is a deploy; before 2026-11-08T00:00Z, the start of the CFL experiment's VOID window.

## Issue 1 — "No lineup source for this game"

**Cause, measured.** The laboratory's card says it when a game row has no `bsd_event_id`. All five big-five rows of 2026-11-06 were unjoined at 22:50Z, hours after the games. `change_log` (`ts`) joined to `regular_season_games` on `game_id`, read 2026-11-07: the rows of game days 10-30, 10-31, 11-01, 11-02 and 11-06, every one created at 10:00Z, were joined at 00:xxZ of the following day (68 rows). The only other write since 10-31 is 8 rows dated 11-07 that had existed since 2026-06-30 and were joined on 11-04 at 10:xxZ, as the +3 date. The archive creates a day's rows at about 10:00Z; `runBsdGameJoinWindow` marked a date done for 36 h after ANY ok pass, including one with nothing pending; a date's first pass of each UTC day is near 00:00Z; so the rows waited for the next midnight UTC. Reproduced on the real function text in a simulation: 855 minutes.

**Fix, in two parts** (`533090e`): an empty date's marker lasts an hour, and an empty pass no longer ends the tick. The second part was found by review, not by me: with the marker change alone the empty dates ahead of a date with rows took one tick each and held hourly markers that expired in lockstep, so a date late in the window waited for the field date to roll (1140 minutes for the +3 date; 1440 when the join is reached once an hour).

**The artifact.** `scripts/check-bsd-join-window-timing.mjs`, 384 scenarios over the real function: one date with rows at each of five window positions and four creation minutes; all five dates holding rows; a marker alive and expired at exactly its TTL; exact and jittered ticks; four reach cadences; and the Rule 78 bound that at most ONE pass reads BSD per tick. Base source: 464 findings (840 minutes and more). Marker change alone: 172 (up to 1485). This source: none. Self-test 13/13 (control, eleven mutants, a refusal). Wiring check 13/13 with W10–W13, 13 of 13 wiring mutants caught.

## Issue 2 — FA Cup missing

**Unblock, measured.** `docs/CC-CMD-2026-08-08-fa-cup-coverage.md` said wire `eng.fa` only when `season.year >= 2026` and the type is not `Final`. The probe that first reopened it printed an event count, not the criterion, so a new probe (`scripts/probe-fa-cup-season.mjs`, run `42311014646`, artifact `outbox/probe-fa-cup-season-2026-11-06T23-18-47-844Z.json`) read it: 4 of 4 reads that answered say `UNBLOCKED`, 2026, "First Round", "2026-27 English FA Cup". Two events, both 2026-11-06.

**Built** (`a18d3d5`): five registrations (`V2_LEAGUES.facup`, `SOCCER_LEAGUE_LABELS.facup`, the cron's `LEAGUES` row, `detectSportClass`, `FAMILIES.soccer.labels`), plus the two edits the gates demanded (`check-individual-sports-not-archived.mjs` 22 -> 23; the morning-report oracle's copy of the label table). `4059f8d`: `check-leagues-label-contract.mjs` gains C (every label key is a route key and the reverse) and now evaluates the two constants instead of reading them with regexes; `check-morning-report-cite.mjs` gains the src-to-oracle direction. Each mutated on purpose; the results are in the commit messages.

**The laboratory half** (LAB-FIRST) is the consumer the owner named. Built in field-laboratory as `Sport.FACup` in `src/Desk.fs`, with `sport-registry-check.mjs` 21 -> 22 contest sports: see "Laboratory" below.

## Two independent reviews, before the push

| | Review | Findings that were real | Disposition |
|---|---|---|---|
| 1 | `wf_753e8877-a88` (13 agents: three lenses, a skeptic per major) | the empty pass used the tick's slot; the check tested one window position; the morning-report oracle lacked `FA Cup`; no static gate caught a removed `V2_LEAGUES.facup`; the commit message cited a probe that did not read the criterion; the stale CONTRACTS.md cadence | all fixed in the commits |
| 2 | `wf_2e9f8e6d-9e4` (9 agents) | nothing held "one BSD pass per tick" against an over-eager `continue`; the new check C and the old regexes passed a COMMENTED-OUT key; the timing bound held only for rows created exactly on a tick; the production wc_results table is already polluted by club games | all fixed except the last, which is a separate CC-CMD |

Two reviewer claims did not survive: that the FA Cup relay half was built before the criterion was measured (it was committed nine minutes before the measuring probe ran; the measurement is committed and the criterion is met), and that any correct WC-write guard breaks `check-v2-games-nba-board.mjs` (only a guard at the gate line does).

## Found, filed, not built: club games are written into the World Cup tables

`docs/CC-CMD-2026-11-07-wc-results-club-contamination.md`. Production D1 (`WC2026_DB`, read-only, 2026-11-07): `wc_results` holds 58 `third` rows dated 2026-08-11..09-16 and three `final` rows dated May; `wc_group` has groups of five and six teams and `played` of 5 to 7. Cause: `writeWCResult` runs for every soccer final and nothing asks which competition. FA Cup would add four writing rounds from January. Not fixed in this push (a second src change under the same deadline, a production data cleanup that needs the owner, and the guard turns an existing check red). `src/index.js` cannot change 2026-11-08..11-23; the CC-CMD says when it may land.

## Verified here vs staged

**Verified locally, on clean clones of the final tree:** all 172 deploy-job and guards-job steps on a clean clone of the final tree (`4059f8d`): 170 pass; the 2 that stay red are `every BSD frame the contract declares matches the captures` (no network to the BSD host here) and `Every archived game is dated on the ET day of its own kickoff` (`RELAY_SHARED_SECRET` is not set here), which CI runs. Each of the three code commits' own trees passes the checks that touch what it changed (timing, wiring, absence ratchet, individual-sports count, label contract, morning-report cite, seeded labels, seed coverage, sport canonicaliser).

**STAGED (Rule 74), the live checks, in order:**
1. *The deploy.* Blocked by: the push. Unblocked when Deploy RELAY Worker for the push is `success` (the run id is recorded in the commit after the deploy).
2. *The join happens in the cycle that creates the rows.* Blocked by: 2026-11-07 10:00Z, when the day's rows are created. Verify, about 12:00Z, on `field-archive`: `SELECT substr(c.ts,1,13) AS wrote_at, g.date, COUNT(*) FROM change_log c JOIN regular_season_games g ON g.id = c.game_id WHERE c.source='bsd_game_join' AND c.ts >= '2026-11-07T01:00:00' GROUP BY 1,2` must show game date 2026-11-07 written at `2026-11-07T10` or `T11` (the five earlier game days all show the NEXT day's `T00`), and `SELECT COUNT(*) FROM regular_season_games WHERE date='2026-11-07' AND sport IN ('EPL','La Liga','Serie A','Bundesliga','Ligue 1','MLS') AND bsd_event_id IS NULL` is the unjoined remainder (a row BSD cannot match stays null; 0 is not required, a drop from all of them is). UNVERIFIED: how often production reaches the call (it sits behind live hours, game lines and a changed slate context); if the 10:00Z cycle does not reach it, the join lands at the first later cycle that does.
3. *FA Cup serves.* Blocked by: the deploy and a day with fixtures (the first round proper runs 2026-11-07..09). Verify: `probe_relay_route /v2/games?sport=facup&date=2026-11-07` (then 11-08, 11-09) returns HTTP 200 and `"league":"FA Cup"`; INCONCLUSIVE, not a pass, if none has a game.
4. *FA Cup rows in the archive.* Verify after the 10:00Z creation of a day with fixtures: `SELECT sport, COUNT(*) FROM regular_season_games WHERE sport='FA Cup' GROUP BY sport`.

## Laboratory (field-laboratory)

Written, not yet pushed (Rule 70: the relay deploys first): `src/Desk.fs` gains `Sport.FACup` (label "FA Cup", `HomeVersusAway`, soccer, modelled; the CFB exception: modelled the day the relay carries it, not on the first slate with a fixture, so the first FA Cup day does not render under "UNMODELLED SPORT" with "vs" for both sides); `scripts/sport-registry-check.mjs` 21 -> 22 contest sports; `docs/JLAYER-PLAN.md` claim `sports.modelled` 24 -> 25, which `docs-check` re-derives from the registry. The convention is read from the relay's ESPN adapter, which orders sides by `homeAway` (the code that serves EFL Cup and EFL Trophy); the first archived FA Cup row has not been read. STAGED: the F# is not compiled here (no `dotnet` in this sandbox). Unblocked when the relay deploy is green; verify: the laboratory's verify run for the push is `success` (it compiles and runs `sport-registry-check` and `docs-check`).

## Decisions the owner may reverse

1. **The relay fix lands before the VOID window**, as two changes in `src/index.js` and no change to any function the experiment names (`handleCFLOddsProbs`, `reconcileOddsCredit`, `consumeOddsCredit`, `checkAndIncrementDailyOdds`, `chargeMonthlyOdds`). The judge reads `git log --since=2026-11-08`, so nothing further may touch `src/index.js` until after 2026-11-23.
2. **Empty dates are looked at hourly**, at a cost of 240 D1 SELECTs and 120 KV puts a day if every tick reaches the call (10 and 5 before). No BSD call.
3. **The club-games-in-World-Cup-tables fix was filed, not built.**

## Open

- Residuals recorded in `docs/CC-CMD-2026-10-27-bsd-event-id-on-game-rows.md`: R1 (a second batch of rows after a date's first row-seeing pass, and rows BSD cannot match yet, wait for the next UTC day, as before) and R2 (a date whose pass throws is retried first on every tick and holds the later dates; before and after this change).
- UEFA competitions and the cups are not in `BSD_SOCCER_SPORTS`, so their cards will still say "No lineup source": whether BSD covers them is a separate question (`outbox/bsd-leagues-2026-10-04T14-08-27-432Z.json` mentions FA Cup).
- The odds sport key for FA Cup (`soccer_fa_cup`) is outside the old CC-CMD's scope and costs credits to verify.
- Card lines the screenshot showed (a draw price with side labels, a "pre-match" basis, rounding) are the owner's call: offered 2026-11-06, not asked for.
- The jubilant-bassoon `SOCCER_LEAGUES` entry (Task 4 of the FA Cup CC-CMD).
