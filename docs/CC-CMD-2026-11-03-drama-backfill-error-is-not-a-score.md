# Claude Code Command — the Drama backfill stores a refused read as a score

**Date:** 2026-11-03
**Repo:** field-relay-nba (the script, the one-row reset). The check that holds the script is in field-laboratory (LAB-FIRST-A).
**Branch:** main. Commit directly; no feature branch, no PR.
**Type:** B (a script that records a failure as data)
**Confidence gate:** >= 95 before any commit
**Status:** IN PROGRESS
**Filed by:** the owner's order of 2026-11-02 23:35 ET to resolve the "Could not verify" list, item "the Drama backfill 403". Searched first, by content (BUILD-ON-A): `writeGameDrama`, `drama-by-id`, `drama-missing`, "loop forever", "drama_peak = 0". No CC-CMD covers the error path. The neighbours, read for rulings and holds before this was written: `CC-CMD-2026-07-06-drama-peak-immutability-guard.md` (the guard that makes a stored value final; nothing here weakens it), `CC-CMD-2026-07-12-drama-peak-nightstars-invalidation.md` (the recompute after a write; `touchedDates` is left exactly where it was), `CC-CMD-2026-07-05-backfill-wnba-afl-epl.md` and `CC-CMD-2026-07-04-drama-score-then-eventid-backfill.md` (0 is the "cannot be scored" mark for an unsupported sport; "no guessed or placeholder values"). None is on a hold or a VOID list.

---

## What was measured (2026-11-03)

- Run 41235124610, event `schedule`, created 2026-10-31T19:37:51Z, `failure`. The log has one error, at 19:38:00Z: `[error] Bundesliga | Bayern vs Dortmund (2026-10-31) [event=401884754]: ESPN soccer 403 for event 401884754 (fifa.world)`. `=== Done: 28 processed, 1 errors ===`.
- The refused request was the run's first ESPN request: the nine games before it were unsupported sports (`[skip]`, no ESPN call). The next eight ESPN requests, five Bundesliga and three La Liga, all on the same default slug, were answered 200 between 19:38:01 and 19:38:06Z.
- D1 (`field-archive`, `regular_season_games`), read 2026-11-03 about 06:50Z: `Bundesliga_2026-10-31_e401884754`, Bayern 2, Dortmund 2, `drama_peak` 0, `drama_arc` the string `null`, `finalized_at` 2026-10-31 19:30:26. The five other Bundesliga rows of that day hold 57, 52, 70, 62 and 52, finalized at 16:30:25 to 16:30:31. The refused game is the only one of the six finalized in the minutes before the run (7.5 minutes).
- The relay, same minute: `/espn-summary/sports/soccer/fifa.world/summary?event=401884754` answers 200, 427,492 bytes, Bayern Munich v Borussia Dortmund. The league slug is not the cause: `soccerLeagueSlug` returns `fifa.world` for every soccer sport except MLS and EPL, and ESPN answers a Bundesliga event under it (the five Bundesliga events scored one second later in the same run used it).
- The relay's own 403, `ESPN Summary path not allowed`, is not what the script saw: `espnSummaryAllowed` has accepted dotted league slugs since af44167b (2026-06-25) and the same path shape passed five times in that run. `relayFetch` passes an upstream status through (`espn-summary returned N`, header `X-RELAY-Error: espn-summary-N`). Probed 2026-11-03: a missing event answers 404 for soccer and for MLB.

## Cause

Why ESPN's side refused one request at 19:38Z: **not established.** The log holds the status only, no body and no `X-RELAY-Error` header. The relay's source records Akamai refusing Worker egress IPs in episodes (2026-08-08, 2026-10-13), and the game had been final for 7.5 minutes; either may apply, neither is shown.

What turned a refusal into a permanent wrong value is established, and it is the defect: the `catch` block of `scripts/drama-backfill.mjs` wrote `drama_peak = 0` for **every** error, "to clear this game from the missing queue so we don't loop forever". `/archive/drama-by-id` updates `WHERE drama_peak IS NULL` and `/archive/drama-missing` lists only NULL rows (both from the immutability-guard CC-CMD), so a 0 leaves the queue and can never be replaced: a later run cannot repair it, and the relay answers a second write `{ok: true, skipped: true, reason: "already_scored"}`. A failure to read was recorded as a measurement of 0.

## Same defect elsewhere in D1, measured and not touched

`regular_season_games` rows with `drama_peak = 0` in sports the script scores: MLB 30 (13 on 2026-06-21 and 7 on 06-20, ten single days from 07-07 to 10-12), WNBA 3 (06-20, 06-21), AFL 2 (03-12, 03-19), Bundesliga 1 (this game). `postseason_games` holds none. The stored 0 is the same for an unsupported sport, an empty reading, an AFL no-match and an error, so the cause of each of the other 35 is **not established**; the 06-20/21 cluster predates the 07-05 classifier fix. The 0s of sports `classifySport` calls `other` (CFB, NHL, NFL, NBA, golf, Serie A, EFL Cup, EFL Trophy, CFL, PGA Tour) are the intended "cannot be scored" mark. Serie A is soccer and the classifier skips it; that is a separate defect, carried forward, not in this CC-CMD.

## TASK 1 — a read that failed is not a score

`scripts/drama-backfill.mjs`: the four ESPN readers throw `EspnStatusError` carrying the HTTP status. In the loop's `catch`: 404 and 410 (ESPN has no such event; passed through by the relay) store the 0 mark once, as before, and are still counted as errors. Any other failure (403, 429, 5xx, a dropped connection, a body that is not JSON, a refused write) stores nothing: the game stays NULL, is added to a per-run `deferred` set, is not fetched again in that run, and is scored by the next scheduled run (`drama-backfill.yml` runs every 2 hours). A batch in which every listed game is deferred ends the loop, with a line that says the relay's 20-game window may hide games below it. The `Done:` line gains `, N deferred`. `touchedDates` stays where the 07-12 CC-CMD put it. The immutability guard is untouched.

Held by `scripts/check-drama-backfill.py` in field-laboratory (the script run unmodified against a stand-in of the relay's routes, including the guard): 75 checks in 7 scenarios on the fixed script, red on the original with the 10-31 failure reproduced (`('...e4001', 0, None, 'stored')`); `scripts/mutate-drama-backfill.py`: 15 of 15 mutants caught. Not held: the real relay and ESPN, and the AFL reader (it fetches ESPN directly).

## TASK 2 — reset the one row the log proves

`scripts/reset-drama-refused-read.mjs` through `reset-drama-refused-read.yml` (dispatch only), the pattern of `reset-mlb-drama-array-shape`: reads the row; refuses unless it is exactly the stored refusal (`drama_peak` 0, `drama_arc` `null`, event 401884754); refuses unless ESPN's summary answers 200 with key events now (a reset that would only be refused again is not done); sets both columns NULL with a statement that must change exactly one row; reads it back. The next `drama-backfill.yml` run then scores it, and recomputes night-stars and jinx for 2026-10-31 as it does for any date it touches. The other 35 zeros are not reset: nothing proves them wrong.

## Done conditions

1. [ ] TASK 1 landed in the relay; the laboratory's check and mutants landed and green in CI.
2. [ ] The reset ran once: before `0 / null`, `changes` 1, after NULL / NULL.
3. [ ] A `drama-backfill.yml` run after the reset stored a real peak for the game (`[ok] Bundesliga | Bayern vs Dortmund ... → drama_peak=N`, D1 `drama_peak` > 0 with an arc).
4. [ ] Observed on the real host, not only the stand-in: a scheduled run that meets a refusal leaves the game NULL. **May never be observable on demand**; it is stated as not observed until a run logs `[deferred]`.

## Observed

(none yet)
