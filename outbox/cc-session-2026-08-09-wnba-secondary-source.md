# CC-CMD-2026-08-09-wnba-secondary-source — Result

## Status: Task 1 COMPLETE. Tasks 2–3 NOT started, deliberately, and the gate is why.

**Confidence in proceeding to Task 2: ~70. Below the 95 gate. Stopping and
reporting, per the one-liner's own instruction.**

## Task 1 — a viable source exists, but not necessarily for a Worker

Probe: `scripts/wnba-secondary-probe.mjs`, log
`outbox/wnba-secondary-probe-20260808T233735Z.log`. Six candidates, each
tried with and without the relay's real `NBA_HEADERS`.

**Best candidate — `cdn.wnba.com/static/json/liveData/scoreboard/todaysScoreboard_10.json`:**
```
bare: HTTP 200 -> VIABLE (3 game-shaped entries)
      {"gameId":"1022600236","gameCode":"20260808/LVAMIN","gameStatus":3,
       "gameStatusText":"Final","period":4,"gameTimeUTC":"2026-08-08T17:00:00Z"...
```
Real WNBA games for today, in the **same shape the NBA CDN uses**, which
`adaptNbaCDN` already parses.

Also viable from the runner: `cdn.wnba.com/.../scheduleLeagueV2_10.json`
(121 game-dates, full season, date-addressable) and
`stats.wnba.com/stats/scoreboardv2` (with headers only; times out bare).
Not viable: `data.wnba.com` (403 both ways); `cdn.nba.com` league-10
returned a **2020** game — stale, correctly rejected.

### The blocking problem

`cdn.wnba.com` served real JSON to a GitHub runner **bare**, but returns
an HTML error page ("We are unable to process your request") to a
Cloudflare Worker. Since bare worked on the runner, headers are not the
variable — **egress is**. The relay is a Worker.

This is precisely the failure mode the CC-CMD anticipated when it said to
probe from Worker egress rather than a runner, and precisely the class of
thing that caused the original ESPN P0.

**Caveat, stated because it matters:** `html_probe` runs on a *different*
Worker than field-relay-nba. It is strong evidence that Worker egress is
blocked, not proof that *this relay's* egress is. The only way to settle
it is to attempt the fetch from field-relay-nba itself.

## Why I stopped rather than building it

Task 1 says: *"If no candidate returns real WNBA games, STOP... do not
build a partial adapter."* The literal condition is not met — a candidate
does return real games. But the spirit is: do not build against a source
that cannot serve, and I cannot currently show that this relay can reach
it.

Two honest paths, and the choice is yours, not mine:

1. **Wire it and let the forced-failure artifact decide.** The failover is
   additive and only fires when ESPN fails, so shipping it cannot degrade
   the working path. `_forcePrimaryFail=1` would then answer the egress
   question definitively in one run. Risk: committing an adapter that may
   turn out to be dead code (Rule 63).
2. **Settle egress first.** `CC-CMD-2026-08-06-relay-web-fetch-proxy` — an
   already-approved, still-unexecuted capability in this repo — would let
   the relay fetch an arbitrary URL and answer this in isolation, with no
   speculative adapter. Slower, but it is the "correct route" rather than
   the quick one (Rule 88), and it unblocks every future source question,
   not just this one.

**My recommendation: option 2**, then Task 2. The egress question is the
real blocker, it is not WNBA-specific, and the tool for answering it is
already scoped and approved.

## Corrections to my own probe, both material

1. **First verdict was wrong and said so confidently.** An earlier run
   printed `NO viable WNBA secondary`. That was my bug, not a finding:
   `assess()` rejected on `content-type` before ever parsing the body, and
   cdn.wnba.com serves JSON as `text/plain` while cdn.nba.com serves it as
   `application/octet-stream`. Both were real JSON with real games. Fixed
   to parse first and treat content-type as context.
2. **The first probe had no fetch timeout** and hung indefinitely on
   `stats.wnba.com`, which stalls rather than refuses. Run 31284308722 was
   cancelled. Fixed with a 15s `AbortSignal.timeout` per candidate.

Both are the same shape of error: a check that returns a confident answer
without actually testing what it claims to test.

## Also corrected: the CONTROL

The initial `html_probe` pass showed the NBA control (`todaysScoreboard_00`,
the path this relay uses in production) returning 403, which invalidated
that whole pass. With the real headers on a runner it returns **HTTP 200,
0 games** — correct behaviour for the NBA off-season. The control is now
healthy, which is what makes the WNBA rows readable at all.
