# Claude Code Command — Season Drama Leaderboard + percentile query endpoint

**Date:** 2026-07-16
**Repo:** jeffunglesbee-create/field-relay-nba (this CC-CMD targets the RELAY repo, not jubilant-bassoon — confirm you are in the correct repo before proceeding)
**Branch:** main — commit directly, do not create a feature branch or PR.

git remote get-url origin | grep -q field-relay-nba || { echo "WRONG REPO"; exit 1; }; git pull; git log --oneline -5.

Write findings to outbox/amnesty-leaderboard-relay-2026-07-16.md. Commit with `[skip ci]` unless confirmed working end-to-end against real D1 data, in which case commit normally so it deploys.

## CONTEXT

The client repo (jubilant-bassoon) wants to display a "Season Drama Leaderboard" (top-N games by drama score this season) and a historical percentile ("Top 8% of ECF games since 2010"-style framing) on post-game cards. **Real finding from the client-side investigation, not assumed here: the write path already exists.** `saveEspnFinal` (jubilant-bassoon) POSTs to `/archive/drama` with `{source_id, drama_peak, drama_arc}` on every game going final — this has been running and instrumented (silent-catch fixes, same-day session) against the real `field-archive` D1 database, confirmed to hold 1900+ real archived entries as of this session. This means the raw data for a leaderboard/percentile likely already exists — this CC-CMD's job is a query/aggregation endpoint, not a new data pipeline.

**Do not assume the D1 schema from this description.** Query it directly first.

## TASK 1 — Probe (real, live, first)

Query the real `field-archive` D1 database directly (this session has established precedent for doing this — same pattern as the earlier "how many archived briefs do we have" investigation this same day). Confirm: the actual table name, the actual column names for `drama_peak`/`drama_arc`/`source_id`, whether there's a `sport`/`league` column to scope a leaderboard per-league (an NBA game and a golf round are not comparable on the same 0-100 scale necessarily — confirm with real data whether cross-sport comparison is even meaningful, or whether the leaderboard must be scoped per-sport), whether there's a season/date-range field to scope "this season" vs. all-time, and roughly how many rows currently have a non-null `drama_peak`. Report all of this with real query output before writing any endpoint code.

## TASK 2 — Leaderboard endpoint

New route (e.g. `/archive/drama/leaderboard?sport=X&limit=N`) returning the top-N games by `drama_peak` for the given sport, most-recent-season scoped (confirm the real season-boundary convention already used elsewhere in this relay, e.g. for standings/schedule endpoints — reuse it, don't invent a new date-range convention).

## TASK 3 — Percentile endpoint

New route or extension (e.g. `/archive/drama/percentile?sport=X&score=N`) returning what percentile `score` falls at within the stored distribution for that sport. If TASK 1's probe finds too few real rows for a given sport to make a percentile meaningful (e.g. under ~20 data points), report this honestly in the outbox rather than shipping a percentile that's statistically meaningless from a tiny sample — this is a real finding to surface, not a reason to fabricate a plausible-looking number.

## TASK 4 — Verify

Live D1 queries against the real database confirming the endpoint's numbers match a manual query for at least 2 real sports. Real forced test against the deployed route (not just local logic) — this session has established MCP-based relay-route-probing precedent (`probe_relay_route`-style tooling) if available in the execution session; otherwise curl the deployed route directly.

## DONE CONDITION

Both endpoints return real, verified-correct numbers for at least 2 real sports, cross-checked against a direct D1 query, not just internally self-consistent. If the data is too sparse for a meaningful percentile in some sport, that's documented explicitly, not papered over.

**Confidence scoring:**
- TASK 1 (30 pts): real D1 schema probe, not assumed
- TASK 2 (25 pts): leaderboard endpoint correct, reuses existing season-boundary convention
- TASK 3 (25 pts): percentile endpoint correct, sparse-data cases disclosed honestly
- TASK 4 (20 pts): live verification against real D1 data for 2+ sports

Do not commit unless confidence >= 95. If score < 95, report verbatim and stop. Automate follow-ups. No fallbacks, only fixes.
