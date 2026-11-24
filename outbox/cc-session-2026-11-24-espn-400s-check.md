# Session doc — "Check on espn 400s"

**Date:** 2026-11-24 · **Repo:** field-relay-nba · **Branch:** main · no `src/` change, no deploy, no credits, no Odds API call.
**Task:** the owner's "Check on espn 400s". The question did not say which; the repo's own records said where to look: today's `espn-task0.yml` runs (9 of 9 scoreboards HTTP 400), the host-flip CC-CMD's table (a range is refused), and the relay's own ESPN requests.

## Findings

1. **The 400s in today's `espn-task0.yml` runs were the probe, not the relay**: it asked for a date range; ESPN's scoreboard refuses ranges (`{"code":400,"message":"Failed to get events endpoint."}`). Fixed in that session by reading one day at a time (run `45445954294`, all answered). Recorded in `outbox/cc-session-2026-11-24-espn-task0.md`.
2. **Re-measured today through the `html_probe` connector** (the sandbox cannot reach ESPN): a range answers 400 for AFL AND soccer (`eng.1`); one day answers 200 for both.
3. **The relay's ESPN-backed routes are healthy:** `/v2/games` for 2026-11-24 answered 200 with no `error` field for `afl` (0 games, off-season), `ucl` (9) and `nba` (3).
4. **One production request sends a range:** `src/wp-resolver.js`'s `_discoverAFLRound` (`dates=${toDateStr(rangeStart)}-${toDateStr(rangeEnd)}`); it swallows the refusal (`if (!r.ok) return null;`) and the AFL win-probability branch then returns null for every pick. No user effect today (no AFL fixtures until 2027); a silent failure when the season returns. Filed: `docs/CC-CMD-2026-11-24-afl-round-discovery-sends-a-date-range.md` (STAGED: it needs a live AFL slate). Every other ESPN `dates=` request in `src/` is a single day.
5. **One non-production script would 400 if re-run:** `scripts/verify-mls-sub-impact.mjs` (a one-shot CI probe, dispatch only). Not changed (Rule 69).

## Not checked

The relay's own error counters for ESPN (there is no route that exposes them; `/analytics/degraded` reports phases, not upstream statuses), and the Worker's log stream (no access from here). So "healthy" above means the probed routes answered 200 on 2026-11-24, not that no request failed over any past window.
