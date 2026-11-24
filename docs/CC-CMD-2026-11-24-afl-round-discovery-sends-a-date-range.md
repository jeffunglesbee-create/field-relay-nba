# Claude Code Command — the AFL win-probability round discovery sends a date range, which ESPN now answers 400, and the resolver says nothing

**Date:** 2026-11-24
**Repo:** field-relay-nba
**Branch:** main — commit directly, do not create a feature branch or PR
**Type:** B (fix)
**Status:** DONE for the change, 2026-11-24, on the owner's "Build the AFL fix now". Five commits on `main` (`109d2ed2`, `ac187a0b`, `2da46894`, `11670e9d`, `b3dbdf81`); the live proof ran from a real runner against real ESPN (Actions run 45489913728: fixed source 8 of 8, pre-fix control 0 of 8, logs `outbox/afl-round-live-check-2026-11-24T2119.log` and `-control-`). **STAGED** (verifier: afl_round_in_season @ relay/staged-verification.yml): the in-season read (a real AFL round inside the window, read live, not through a pinned clock on past dates). Blocked by: AFL has no fixtures until 2027. Unblocked when: the relay's `/v2/games?sport=afl` carries a game with a round inside the ten days the resolver reads. Verify: `staged-verification.yml` (daily 06:00 UTC) runs `afl_round_in_season`, which reads those ten days through the relay adapter (an independent path), calls `_discoverAFLRound` for the earliest game's home club and says PASS only if the rounds agree; it is PENDING off-season and FAIL if the resolver finds none or a different one (`node scripts/verify-staged-items.mjs`, check 11). Two parts this CC-CMD could not reach are filed as `docs/CC-CMD-2026-11-24-afl-finals-round-and-journalism-club-match.md`.
**Filed from (and built from):** the owner's "Check on espn 400s", 2026-11-24. Searched by content before filing (BUILD-ON-A): no existing CC-CMD tracks this. The AFL CC-CMDs of 2026-07-05 and 2026-07-08 describe the resolver; `docs/CC-CMD-2026-10-14-espn-host-flip.md` records, in its table, that ESPN's scoreboard refuses a date range.

## What was measured, 2026-11-24 (read-only; ESPN read through the `html_probe` connector, which fetches from a Cloudflare Worker IP; the sandbox itself cannot reach ESPN)

| request | result |
|---|---|
| `site.api.espn.com/apis/site/v2/sports/australian-football/afl/scoreboard?dates=20261121-20261130` (a range) | **HTTP 400**, `{"code":400,"message":"Failed to get events endpoint."}` |
| the same with `dates=20261124` (one day) | HTTP 200, `events: []` (off-season) |
| `.../soccer/eng.1/scoreboard?dates=20261121-20261130` (a range) | **HTTP 400**, the same body |
| the same with `dates=20261124` | HTTP 200 |
| the relay's own `/v2/games?sport=afl`, `?sport=ucl` and `?sport=nba` for 2026-11-24 | HTTP 200 each, no `error` field, `source: "espn-wc"` (afl 0 games, ucl 9, nba 3) |

So the 400s are specific: ESPN's scoreboard refuses a **range**; every one-day request answers. Today's `espn-task0.yml` runs hit 9 of 9 for that reason and fixed it by reading one day at a time (`outbox/cc-session-2026-11-24-espn-task0.md`).

## The one production request that sends a range

`src/wp-resolver.js`, `_discoverAFLRound`: it asks for `dates=${toDateStr(rangeStart)}-${toDateStr(rangeEnd)}` (3 days back to 6 days ahead) and, on a refusal, does `if (!r.ok) return null;`. Its one caller, the AFL branch of `resolveWinProbability`, does `if (!discovered) return null;` before it reaches Kali or the Squiggle fallback. **So every AFL pick resolves to no win probability, with no log line and no error.** The function's own comment says a range was "confirmed live" on 2026-07-08; today ESPN refuses it, so ESPN's behaviour changed after that date.

**Not affected (checked):** every other ESPN `dates=` request in `src/` (the scoreboard routes, the cron, the closing-line and mirror paths) sends `dates=${espnDate}`, one day. One non-production script, `scripts/verify-mls-sub-impact.mjs` (a one-shot CI probe for `docs/CC-CMD-2026-07-19-mls-sub-impact-metric.md`), also sends a range with `&limit=200` and would 400 if run again.

**Established since filing (2026-11-24):** a range was accepted on 2026-07-08 (the live Kali test in `outbox/cc-afl-wp-kali-integration-2026-07-08.md` went through the range code) and in the 2026-07-19 session (`outbox/cc-session-2026-07-19-mls-sub-impact-metric.md`, `dates=20260601-20260720`), and refused on both ESPN hosts on 2026-11-06 (`outbox/probe-fa-cup-season-2026-11-06T23-18-47-844Z.json`) and again today: the change is between 2026-07-19 and 2026-11-06. `week.number` on a single-day body is the event's own round, as the old comment said for a range: the real `dates=20260709` body carries `events[0].week.number` 18 and a top-level `week.number` 18 (`outbox/espn-afl-scoreboard-20260709-recorded-2026-11-24.json`, trimmed, with its provenance).

**Not established, and not guessed:** whether AFL win probabilities were already null before the 2026 season ended on 2026-09-30 (no AFL pick has been resolved since the refusal began, so the failure was never observed on a real pick; it is read from the code and the measured refusal).

## What was done (option (a), with three differences)

Option (a): ten one-day reads over the same -3d..+6d UTC window, in parallel, the earliest game in day order winning, as with the range. Differences from the sketch above: **not cached** (a 300 s entry on the URL `/v2/games` reads at 15 s would have served its live poll stale; found in review, reproduced against the real `handleV2Games`), a day that is refused, fails, or answers a body with no `events` array is **warned by status and day and skipped** (the days that answered are still searched), and a loud warning when none answered. The comment that called the range "confirmed live" is replaced by the dated records above.

| commit | what |
|---|---|
| `109d2ed2` | the range becomes ten one-day reads; the check (real `resolveWinProbability` over a stub that answers 400 to a range) and its mutation harness; wired into `deploy.yml` and `guards.yml` |
| `ac187a0b` | `week.number` 0 (ESPN's Opening Round; Squiggle serves `round=0` tips with an Aggregate source) is a round, not "no round" |
| `2da46894` | clubs are matched by `resolveAFLTeamKey` equality, not `teamNameMatch`'s 5-character prefix, in the round search and the tip search |
| `11670e9d` | `afl-round-live-check.yml` (dispatch only): the real resolver, real ESPN, the clock pinned to 2026-07-08, and the pre-fix source as a control that must fail |
| `b3dbdf81` | the second review's findings: check 57 → 69 assertions, harness 33 → 49 mutants, one real ESPN body on record and replayed, wording |

**Why the third commit exists.** The range's 400 had kept the code after it from running. With the round found again, `teamNameMatch('Melbourne', 'North Melbourne')` and `('Port Adelaide', 'Adelaide')` are true (the prefix rule), so a Melbourne pick resolved through North Melbourne's game and returned North Melbourne's probability under `source: 'squiggle'`, a Port Adelaide pick took Adelaide's tip, and a GWS pick (`GWS GIANTS` at ESPN, `Greater Western Sydney` at Squiggle) resolved to nothing. A wrong probability is worse than null. Reproduced by the review with ESPN's served names and Squiggle's live tips; fixed with the existing AFL identity (`resolveAFLTeamKey`: 18 clubs, 18 distinct keys, the three sources' spellings agree, measured and pinned in the check).

## Verification (artifacts)

- **The committed check:** `node scripts/check-afl-round-discovery.mjs` → `69 of 69 passed.`; on the pre-fix source (`git show f3aa4f55:src/wp-resolver.js`) it is red: `20 of 69 passed.` (49 assertions fail). Mutants: `node scripts/mutate-afl-round-discovery.mjs` → `mutations: 49 of 49 caught`, including A1 (the range restored), the window's ends, parallel vs sequential, the cache, the timeout and its value, every warning, an unreadable body, scan order, week 0, the top-level week, club identity (the prefix rule restored in each search, the generic key, 3- and 4-character keys, the empty-key guard), the year, the UTC anchor, and the Squiggle row reading (source filter, field, rounding, sides).
- **The live proof (the Done condition's "recorded real read"):** run 45489913728, `afl-round-live-check.yml`, head `b3dbdf81`. Forty real ESPN reads, all HTTP 200, `dates=20260709` carrying `r18 Fremantle v Sydney Swans`, `dates=20260711` carrying `r18 GWS GIANTS v Geelong Cats`, `dates=20260705` carrying `r17 Port Adelaide v North Melbourne`; Squiggle asked for `[[2026,18],[2026,18],[2026,18],[2026,17]]`; answers 0.6, 0.4, 0.4 (GWS GIANTS) and 0.7 (Port Adelaide); `8 of 8 passed`. The control (pre-fix source `7ec2d03f`, same real ESPN) made four range reads, all HTTP 400, answered null four times, and failed `0 of 8` by assertion. A date range is still answered `HTTP 400 {"code":400,"message":"Failed to get events endpoint."}` today.
- **What this does not prove:** an in-season round (the live proof reads past dates with a pinned clock), Kali (offline until 2027; 8 of its 18 team names are recorded in `outbox/` and match), and finals (below).

## Two independent reviews

Round 1: 4 lenses, 11 agents, a skeptic per finding. Round 2: 3 lenses, 14 agents. Every finding that was not a note was confirmed by its skeptic and is closed in the commits above, except the two filed as the second CC-CMD: the shared cache entry (mine, fixed), the club match (fixed), round 0 (fixed), shape faults and non-JSON bodies (fixed), the check unable to tell Western Bulldogs from West Coast, to see the Aggregate filter or a 3-character key, and the check crashing instead of failing when the resolver returned null (7 harness errors on the first run of the harness; fixed, Rule 77). **Filed, not built:** (1) `buildAFLJournalismContext` (`src/index.js`) has the same prefix-match defect (visible in served data: `GWS GIANTS v Geelong Cats` on 2026-07-11 carries `journalism.squiggle: null`) and drops round 0; (2) ESPN's finals week (1–5) is used as Squiggle's round (26 is "Finals Week 1"), so a finals pick resolves through a regular-season tip. See `docs/CC-CMD-2026-11-24-afl-finals-round-and-journalism-club-match.md`; deadline before the 2027 Wildcard Finals week; nothing reaches a user until AFL has fixtures.

## Left alone (Rule 69)

`scripts/verify-mls-sub-impact.mjs` (a one-shot CI probe) still sends a range; `teamNameMatch` itself, which other sports use.
