# Claude Code Command — the AFL win-probability round discovery sends a date range, which ESPN now answers 400, and the resolver says nothing

**Date:** 2026-11-24
**Repo:** field-relay-nba
**Branch:** main — commit directly, do not create a feature branch or PR
**Type:** B (fix; the verification is staged until AFL has fixtures)
**Status:** FILED 2026-11-24, not started. Blocked on a live AFL slate to verify against (the 2026 season ended 2026-09-30; fixtures return in 2027) and on the owner's choice of approach (below). Nothing is broken for a user today: there are no AFL picks to resolve.
**Filed from:** the owner's "Check on espn 400s", 2026-11-24. Searched by content before filing (BUILD-ON-A): no existing CC-CMD tracks this. The AFL CC-CMDs of 2026-07-05 and 2026-07-08 describe the resolver; `docs/CC-CMD-2026-10-14-espn-host-flip.md` records, in its table, that ESPN's scoreboard refuses a date range.

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

**Not established, and not guessed:** when ESPN began refusing ranges (it was accepted on 2026-07-08 and refused by the host-flip CC-CMD's own probe in November); whether AFL win probabilities were already null before the 2026 season ended on 2026-09-30; whether `week.number` on a single-day response behaves as the comment says it does on a range.

## Task 0 — probe first (no spend, no deploy)

1. During an AFL round (2027), read one day at a time for the same 10-day window the resolver uses and record, per event, `week.number` and the team names. If an AFL round is not available, say so and stop: this task is STAGED, not skipped.
2. Check whether the no-`dates` scoreboard (today's slate, the default) already carries `week.number` and the team names for the current round; if it does, the round can be found from one request in most weeks.

## Task 1 — the change (after Task 0, and the owner's choice)

Options, none chosen here: (a) one read per day over the window (up to ten), each cached for a day; (b) the no-`dates` slate first, then walk single days forward until the predicted winner's game is found (stops early; at most seven reads); (c) take the round from a source that is not a range (the Squiggle games list the fallback already reads). Whichever is chosen: a refusal must be SAID (a `console.warn` naming the status, and the answer's `source`), not returned as `null` in silence, and the comment claiming a range was "confirmed live" must be corrected to what was measured.

## Done condition (artifact, not a bare action)

A committed check that runs the real `_discoverAFLRound` over a stub that answers 400 to a range and 200 to a single day, returns the round, and has a mutant that restores the range and goes red; and, when AFL has fixtures, one recorded real read of the 10-day window showing the round found. STAGED until then; unblocked when AFL has fixtures inside the window: `curl` is blocked from the sandbox, so use `html_probe` or a runner.
