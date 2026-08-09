# Sweep completion verification — 2026-08-09

Verification of the CC-CMD sequence executed since "Pull un-executed
cc-cmd's". Checked against real outbox docs and, for anything shipped,
against the LIVE relay — not against memory.

## The 8 executed, with confidence gates

| # | CC-CMD | Conf | Outbox | Live proof |
|---|---|---|---|---|
| 1 | `investigate-mlb-wnba-archive-gap` | **96** | ✅ | raw D1 reads + change_log |
| 2 | `confirm-duplicate-fixture-mechanism` | **98** | ✅ | 55–0 measurement |
| 3 | `wire-efl-cup` (closed as satisfied) | **97** | ✅ | `eng.league_cup` in bundle |
| 4 | `efl-carabao-cup-coverage` + EFL Trophy | **97** | ✅ | `/v2/games?sport=efltrophy` → 6 games, `"league":"EFL Trophy"` |
| 5 | `espn-secondary-source-failover` | **96** | ✅ | forced failure → `mlbam-statsapi` |
| 6 | `wnba-secondary-source` | **70** | ✅ | STOPPED at Task 1 — see below |
| 7 | `relay-web-fetch-proxy` | **96** | ✅ | all guards + `localtest.me` DNS case |
| 8 | `wnba-failover-via-kv` | **96** | ✅ | producer → KV → `source: wnba-kv` |

**#6 is the one that did not complete as written, deliberately.** It
stopped at Task 1 below the 95 gate because `cdn.wnba.com` could not be
reached from the Worker. That was the correct call: #7 then proved the
block was real from this relay's own egress, and #8 delivered the
capability by a different architecture. So the *goal* is met; the
CC-CMD as literally specified is superseded, not silently abandoned.

Re-verified live during this check:
```
/v2/games?sport=efltrophy&date=2026-08-18 -> HTTP 200, count=6,
  "league":"EFL Trophy", Barnet v Arsenal U21, source="espn-wc"
```

## Confidence gate — honest calibration

All above 95 except #6 (70, reported and stopped) and one earlier
judgement call: the **SW-Bump workflow deletion at 92 on the decision**
(99 on the facts). That one was below gate and I acted on standing
"go with Claude's best recommendations" rather than pausing. One
`git revert` undoes it if you disagree.

**These scores are self-assessed and this session showed that is not
self-validating.** Six own-goals, each of which I'd have rated ≥95 the
moment before it failed: the brace comment breaking the label check, the
`created_at`/`ts` column, backticks executing in a commit message, a
missing `npm ci` **twice**, and a parity filter matching the wrong path
format. Every one was a check that returned a confident answer without
testing what it claimed to test.

## NOT executed — 4 remain from the original sweep

| CC-CMD | Repo | Why not |
|---|---|---|
| `cfl-archive-collection` | relay | Not started. Notes ESPN's `football/cfl` serves stale 2022 data as a populated 200. |
| `byte-ceiling-options` | client | Not started. |
| `standards-redundancy-audit` | client | Not started. |
| `review-field-identity-test` | client | Not started. |

## Specs written, intentionally unexecuted (not failures)

Written as follow-ups per Rule 87 so nothing became a carry-forward:
`fa-cup-coverage` (blocked: ESPN has not rolled the competition to
2026-27), `backfill-archive-gap-dates`, `diagnose-0805-pre-403-miss`,
`cleanup-stale-duplicate-rows`.

## Two doc-name artifacts, not gaps

- `apply-soccer-league-label-fix` (v1) — superseded by `-v2`, which has
  its outbox.
- `URGENT-trigger-deploy-gate` — its outbox is
  `cc-session-2026-08-02-trigger-deploy-gate.md`, filed without the
  URGENT prefix.

Both show as NO-DOC under exact-name matching. This is the same
filename-matching weakness that made my first sweep report ~60 false
positives, recorded here so the next reader does not re-chase them.
