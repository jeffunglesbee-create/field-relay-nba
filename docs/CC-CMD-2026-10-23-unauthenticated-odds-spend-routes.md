# Claude Code Command — two unauthenticated GET routes spend billed odds credits

**Date:** 2026-10-23
**Repo:** field-relay-nba
**Branch:** main. Commit directly; no feature branch, no PR.
**Type:** A (spend reachable by anyone)
**Confidence gate:** >= 95 before any commit
**Status:** FILED, not dispatched
**Filed by:** the Task 3 premise test of `docs/CC-CMD-2026-09-16-odds-spend-attribution.md`
(workflow `wf_c984c219-a1f`, 2026-10-23), Rule 87.4.

---

## What was found (read from source; not exercised, because it would bill)

- `/archive/odds-backfill` (GET and POST) calls `runOddsBackfillForDate`,
  which calls `fetchSportOddsHistorical` at 30 credits per sport-date.
- `/identity/mismatches` (GET) calls `fetchSportOddsLive` for up to five
  sports.
- Neither route head checks `Authorization`; the `/admin/*` routes near them
  check `FIELD_MCP_SECRET`. A grep for `Authorization` and `FIELD_MCP_SECRET`
  between the two route heads found none.
- Both spend under the crons' own site labels, so the ledger cannot tell an
  anonymous caller from the cron, and an anonymous caller spends toward the
  shared 3,800.
- Related, not covering these: `/archive/game` is
  `docs/CC-CMD-2026-10-14-archive-game-unauthenticated-write.md` (RULED).

## TASK 0

1. Find every caller of the two routes in both repos and in the workflows
   (`grep -rn "archive/odds-backfill\|identity/mismatches"`). A caller that
   cannot send the secret decides the design.
2. Read the relay's request logs or the provenance census for any call to
   either route in the last 30 days, if they are recorded.

## TASK 1

Require the same secret as `/admin/*` on both routes, or move them under
`/admin/`, keeping every caller TASK 0 found working. A check that a request
without the header gets 401 and spends nothing; a mutation that removes the
check.

## Done condition (Rule 90 artifacts)

TASK 0's outputs; after deploy, an unauthenticated GET of each route through
the relay self-probe returns 401 (or the route's allow-list refusal), and
`/budget/odds` shows no charge from it.
