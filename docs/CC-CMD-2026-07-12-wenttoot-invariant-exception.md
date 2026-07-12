# RESOLVED — do not execute, all 38 rows fixed directly

Chat resolved this directly, live, rather than wait for CC pickup. Both
real mechanisms found and fixed with real data, not excused:

**Pattern A (23 rows, short-name/null-ID)** — matched by team nickname
against live `/v2/games` for the stored date, extracted real
`espn_event_id` + `periodNum`, computed `went_to_ot` for real. Found 2
genuine extra-innings games in the process that would have stayed
permanently invisible otherwise: `MLB_2026-06-20_rangers_padres` (10
innings) and `MLB_2026-06-21_tigers_whitesox` (10 innings).

**Pattern B (15 rows, full-name + real ID, still failed)** — root cause
was NOT a matching-logic gap. The stored `date` field is consistently
one day *later* than the actual ESPN game date for every one of these
15 rows (confirmed individually, not assumed after the first match) --
likely a timezone-boundary bug in whatever originally seeded them.
Looked each one up at `date - 1`, found all 15 there by their own
already-correct `espn_event_id`, all confirmed regulation (no OT).
`date` field itself left untouched -- fixing that is separate, real,
out-of-scope work (Rule 69), not silently done here.

**Verified independently after writing:**
```sql
SELECT COUNT(*) FROM regular_season_games
WHERE home_score IS NOT NULL AND finalized_at IS NOT NULL
  AND sport IN ('MLB','WNBA') AND went_to_ot IS NULL
-- 0
```

No acknowledged-exceptions file was built. Nothing was excused --
everything was actually resolved. The original CC-CMD's TASK A/B plan
(below, preserved for the record) is what chat executed directly instead
of dispatching further.

---

*(original TASK A/B plan preserved below for audit trail — do not act on it, superseded by the resolution above)*

Chat found, after dispatching the original acknowledged-exceptions version of
this CC-CMD, that the "genuinely unresolvable" premise from the
historical-backfill CC-CMD's outbox did not hold for most of these 36 rows.

Two mechanisms were identified and are now confirmed as the complete
explanation: short-name/null-ID rows from a different ingestion path, and
a systematic date-field-off-by-one for rows that already had a correct ID.
