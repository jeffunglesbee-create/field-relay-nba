# Session 2026-11-26 — the Carabao Cup is on the BSD club-league endgame capture (owner: "Capture the carabao cup")

**Owner order:** "Capture the carabao cup", the option left open at the end of the EFL Cup join (`outbox/cc-session-2026-11-26-efl-cup-join.md`). Spec: `docs/CC-CMD-2026-08-08-efl-carabao-cup-coverage.md`, "Addendum 2026-11-26" (what the id switches on, cost, STAGED criteria). Branch main, no PR; worked solo.

## Probe before the change (Rule 100)

The one reader of `bsdLeagueId` is `BSD_LEAGUE_ID_TO_SLUG` in `src/index.js`, used by `runBSDClubLeagueEndgameCapture` on the `*/5` cron. It reads `/api/v2/events/live/` (one request, made every tick already) and, for a tracked league's match at minute 80+ (or the not-started fallback 80 to 120 minutes after kickoff), writes momentum, incidents and stats to R2 under `bsd/<slug>/<id>/`: 3 BSD requests per match per tick, at most 27 per match. No CC-CMD held a ruling against adding a league (`docs/CC-CMD-2026-08-02-gate-bsd-club-league-capture.md` gates cadence only). The census reads R2 directory names and counts a call as gradeable only with an `incidents.json` for its event, so no census change is needed; its probe's league-id set gains 40 (informational counts only).

## What was built

| commit | what |
|---|---|
| `12c1785` | `V2_LEAGUES.eflcup.bsdLeagueId` 40 (comment rewritten); `scripts/check-bsd-club-capture-leagues.mjs` cuts the real functions out of `src/index.js` and runs them against a scripted live feed and a recording R2 (12 assertions; failed 8 of 12 against the old registry, passes with the id); `scripts/mutate-bsd-club-capture-leagues.mjs` 17 of 17 caught (the harness takes the nth of a duplicated anchor, because the WC capture function above carries near-identical lines); a deploy gate step |
| docs | Addendum 2026-11-26 in `docs/CC-CMD-2026-08-08-efl-carabao-cup-coverage.md`; pointer in the join CC-CMD's decision 3; this doc; HANDOFF |

Checks run on the change: five census and probe checks (241 + 102 + 96 + 66 assertions, grade-run 126 with `--lab`), the label contract, the reach probe (27), the task0 lib (85), brace balance, doc citations, KV and route provenance, seed coverage, empty-catch baseline (112), the five in-place identity harnesses on a clean tree.

## Verified end to end (Rule 61), and what is not

- **Deploy:** run `45830221347` on `12c1785`, success (including the new gate step); Repo guards runs `45830221393` (`12c1785`) and `45830447374` (`92a9af8`), success.
- **Verified offline on the real code:** the ten-league map with `40: eflcup`; a Cup match at 85' and one on the fallback written under `bsd/eflcup/`; finished, early, untracked and out-of-window matches not; MLS unchanged; 3 requests per captured match, 13 for four plus the live read.
- **STAGED:** a real Cup match captured to R2. Blocked: no Cup match has been live since the id was set; the next round (quarter-finals) is not in this repo's data. Also unverified until then: that BSD's `/events/live/` lists Cup matches at all. Unblocked when a Cup match reaches minute 80; verify with the census dispatch and `a.analysis.r2.eventsPerSlug.eflcup >= 1` (exact commands in the addendum). Follow-up scheduled for 2026-12-19.

## Errors found and fixed, matter-of-fact

- The first mutation run stopped at an anchor that occurs twice (the WC capture function has the same lines); the harness now declares how many times an anchor occurs and which one it mutates.
- An earlier draft of the addendum named a workflow (`probe-bsd-live.yml`) that does not exist; replaced by the command to run, before anything was committed.
