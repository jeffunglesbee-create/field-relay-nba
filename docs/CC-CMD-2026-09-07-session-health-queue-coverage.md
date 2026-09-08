# Claude Code Command — Fix `session_health` under-reporting the CC-CMD queue

**Date:** 2026-09-07
**Repo:** field-relay-nba
**Branch:** main — commit directly, do not create a feature branch or PR
**Type:** B (bug fix)
**Severity:** Instrument defect. Every session start reads a wrong number as fact.

## CONTEXT — the defect, read from HEAD

`src/index.js` at approximately line 19232 builds `stale_pending_cc_cmds`:

```sql
SELECT key, title,
       ROUND((julianday('now') - julianday(updated_at)) * 24, 1) AS hours_stale
FROM codex
WHERE category = 'cc-cmd-queue' AND title LIKE 'PENDING%'
ORDER BY updated_at ASC LIMIT 15
```

Two independent faults:

**Fault 1 — silent truncation.** 29 rows currently match `title LIKE 'PENDING%'`.
The query returns 15 and the response carries no total, no `has_more`, and no
indication it truncated. On 2026-09-07 a chat session opened by reporting "15
open queue items" as fact; the real number was 31. This is precisely the failure
mode Rule 91 (SAMPLE-COVERAGE-A) was written to prevent, and this relay authored
that rule on 2026-09-05.

**Fault 2 — predicate blindness.** `LIKE 'PENDING%'` cannot see open entries
whose titles do not begin with the literal `PENDING`. Two live entries are
invisible permanently, not merely truncated:

- `playground-weatherpoll-wrong-endpoint` — title begins `OPEN — `
- `queue-deadcode-and-ambiguous` — title begins `CORRECTED, still PENDING --`

Raising the LIMIT alone does not fix these. Both faults must be fixed together.

## TASK 0 — PROBE (read from HEAD, do not trust this document)

1. Read the real current query. Record its exact line number and exact text —
   this document's transcription is a starting point, not the source of truth.
2. Run against the live `codex` table and record real counts:
   - total rows with `category = 'cc-cmd-queue'`
   - rows matching `title LIKE 'PENDING%'`
   - rows NOT matching that predicate whose status is not resolved
3. Confirm whether the `codex` table has a `status` column and whether it is
   populated for `cc-cmd-queue` rows. `codex_write` accepts `status`
   (`open`/`resolved`). If `status` is reliably populated, it is a better
   predicate than title-prefix matching — report which is actually true rather
   than assuming.

## TASK 1 — Fix the predicate

Prefer `status` if Task 0.3 proves it reliable for this category. Otherwise
broaden the title match to catch open entries regardless of prefix, e.g. match
`PENDING`, `OPEN`, and `still PENDING` case-insensitively while still excluding
`DONE`. Do not invent a scheme the existing rows do not support — derive it from
the Task 0.2/0.3 output.

## TASK 2 — Make coverage explicit

Return alongside the list, whatever the shape:

- `total_open` — real total matching the predicate, uncapped
- `returned` — how many are in this payload
- `truncated` — boolean

Raise `LIMIT` to a value that covers the current real total with headroom (Task
0.2 gives the number), but keep a cap so the payload cannot grow without bound —
the point is that truncation is *declared*, not that it never happens.

## TASK 3 — Verification (runs inside this session)

1. Call the live `session_health` route after deploy. Record the real
   `total_open`, `returned`, `truncated` values.
2. Confirm `playground-weatherpoll-wrong-endpoint` and
   `queue-deadcode-and-ambiguous` now appear (or are correctly excluded if
   Task 0 proves them resolved — state which and why).
3. Confirm `total_open` matches the Task 0.2 hand count exactly. If it does not,
   stop and report the discrepancy rather than adjusting the number to match.

## DONE CONDITION (verifiable probe output)

Live `session_health` response pasted verbatim into the outbox, showing
`total_open`, `returned`, `truncated`, and both previously-invisible keys
accounted for.

## TASK 4 — Outbox manifest (last task)

Write `outbox/cc-session-2026-09-07-session-health-queue-coverage.md` with the
Task 0 counts, the chosen predicate and why, the commit SHA, and the verbatim
live response from Task 3.
