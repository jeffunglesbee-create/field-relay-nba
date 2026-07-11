# CLOSED — nhlSeriesInit/nhlGSAXInit findings resolved before this CC-CMD was picked up

**Date closed:** 2026-07-11
**Original scope:** Diagnose real HTTP 403s on `/nhl-series/scf-2026/stats` and `/nhl-gsax/playoffs.json`.

**Do not execute the tasks below — both findings are already fully resolved.** This doc is kept for the record rather than deleted, so the history of what was found is traceable. If you've opened this file expecting live work, stop and read this section only.

## What actually happened, in order

1. **Root cause of the 403s found and fixed directly, outside this CC-CMD.** `pathname.startsWith('/nhl')` (no trailing slash) at the top-level `/nhl` route handler was catching `/nhl-series/*` and `/nhl-gsax/*` before they ever reached their real handlers further down — simple prefix collision, confirmed and fixed with a one-character change (added the trailing slash), commit `1d0934f`. Verified live and confirmed correct.

2. **Post-fix, `nhl-series` returns HTTP 200** — fully working, real data.

3. **Post-fix, `nhl-gsax` returns HTTP 404 with body `{"error":"no GSAX data yet"}`** — this is NOT a bug. Traced directly to source (`src/nhl-gsax-r2.js`): this endpoint is R2-backed, populated by a cron explicitly scoped to run "weekly during playoffs (same April-July guard as series stats)." NHL playoffs concluded before the current date; the route's own code returns this exact message specifically when the R2 object for the current cycle doesn't exist — this is the intended, designed behavior for the off-season, not an error state. Confirmed by fetching the live endpoint directly and matching the response body verbatim against the source line that produces it.

## If a future session has a reason to revisit this

The only genuinely open question, if it ever becomes relevant: whether the cron actually ran and simply found no new goalie data to write (MoneyPuck's playoffs CSV going stale/empty post-season), versus not running at all this cycle. This distinction doesn't matter today (no games to serve GSAX context for either way) but would matter again next April when playoffs resume — worth a quick cron-run-history check *then*, not now.

## Original tasks (preserved for reference only, not to be executed)

The original doc asked for a diagnosis-first investigation into both endpoints' 403s, with TASK 1-4 covering route verification, live reproduction, root-cause tracing, and fix-or-report. All of that work is done — see above. Re-running it would duplicate completed investigation for no benefit.
