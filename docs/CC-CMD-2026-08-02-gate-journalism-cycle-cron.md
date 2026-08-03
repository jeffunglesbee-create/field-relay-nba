# CC-CMD-2026-08-02-gate-journalism-cycle-cron

**Repo:** field-relay-nba
**Branch:** main — commit directly, do not create a feature branch or PR

One-liner:
```
git remote get-url origin | grep -q field-relay-nba || { echo "WRONG REPO"; exit 1; }
git pull. Read docs/CC-CMD-2026-08-02-gate-journalism-cycle-cron.md. Execute all tasks.
Do not commit unless confidence >= 95. If score < 95, report verbatim and stop.
```

---

## Real precedent — this is not a new problem, it's an old one recurring

`docs/outbox` (via Drive: "Odds API Quota Audit — Diagnosis Results",
2026-06-16, P0 incident, 19,999/20,000 credits) found and fixed:
`handleJournalismCycle` (cron) called `snapshotCronOdds` every tick
during live hours and `runOddsBackfillForDate` every tick during dead
hours, with no gate on whether the tick actually needed to run —
~10,000 calls/day, 14× the intended budget.

**`handleJournalismCycle` itself still has no `event.cron` gate today**
— confirmed directly in current `scheduled()`: two other handlers in
the same function (`0 * * * *` anomaly watcher, `30 * * * *` thread
cleanup) have explicit early-returns keyed on `event.cron`;
`handleJournalismCycle` does not, and per the code's own comment,
"the journalism cycle, KV sweep, handleCron... are not gated by
event.cron at all." The June fix addressed the odds-API symptom.
The actual root — this function firing on every matching cron
regardless of which one — was never fixed, and `wrangler.toml`
currently defines `*/5` and `*/15` both landing on this same,
ungated code path.

## Task 1 — Re-verify from HEAD before writing anything (Rule 87)

- Re-confirm the real, current cron list in `wrangler.toml` and the
  real, current `scheduled()` dispatch logic — don't assume this
  doc's description is still accurate.
- Confirm `handleJournalismCycle`'s originally-intended cadence — the
  function's own internal comments reference "15-min cron" repeatedly
  (dead-hour backfill assumes "up to 4 dates/hour" from a 15-min
  tick). Confirm `*/15` is genuinely the intended cadence, not `*/5`
  — re-derive from the function's own internal assumptions, don't
  guess.
- Confirm why `*/5` exists at all (real candidate: BSD WC endgame
  capture, confirmed referenced elsewhere in this file as "called
  from scheduled() every 5 min during WC window") — the real question
  is whether `*/5` was ever meant to also drive journalism, or
  whether journalism only reaches it because of the missing gate.

## Task 2 — Add the gate, matching the established pattern

Add an `event.cron` gate to `handleJournalismCycle`'s call site,
matching the pattern the two other handlers already use — run it only
on its real, intended cadence (per Task 1's finding). Do not guess the
right cadence; use what Task 1 establishes.

- Apply the same real question to the other unconditional calls in
  the same block (`handleCron`, `sweepKVBriefs`) — are they also
  meant to run on every tick regardless of cadence, or did they
  inherit the same gap? State the real finding for each rather than
  assuming they're fine because they weren't the one caught by the
  odds-API incident.

## Task 3 — Smoke + real verification

- Confirm this repo's real current quality gate passes.
- Real verification: confirm journalism generation still fires
  correctly on its real, intended schedule after the gate is added —
  don't just confirm it stopped firing on the other one; confirm it
  still works on the one it should.
- If feasible, real evidence the double-fire is now gone (e.g. two
  consecutive real cron ticks at a :00/:15/:30/:45 boundary no longer
  both reach the journalism call) — direct log/telemetry evidence
  preferred over assumption.

---

## Explicitly NOT in scope

- Do not touch the odds-API-specific gating from the June 16 fix —
  that's already correct and separate.
- Do not change `*/5`'s own real purpose (BSD WC endgame capture) —
  gate journalism away from it, don't remove the trigger itself.

---

## Outbox

`outbox/cc-session-2026-08-02-gate-journalism-cycle-cron.md`: the real
intended cadence confirmed, the gate added, and real evidence the fix
holds without breaking journalism's actual schedule.
