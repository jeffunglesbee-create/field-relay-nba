# Claude Code Command — a billed closing-capture call that writes no line leaves no trace

**Date:** 2026-10-25
**Repo:** field-relay-nba
**Branch:** main. Commit directly; no feature branch, no PR.
**Type:** A (spend with no record of what it bought)
**Confidence gate:** >= 95 before any commit
**Status:** FILED, not dispatched. The shape of the record (a `change_log` row, or a
counter beside `odds_reconcile_state`) is a design choice for the owner.
**Filed by:** run 2 of done condition 3 in
`docs/CC-CMD-2026-10-21-closing-capture-calls-18x-its-need.md`, which could not
name one billed call (Rule 87.4). That CC-CMD passes without this; it does not
resolve it.

---

## What was measured

Closed day 2026-10-24, read 2026-10-25 11:09Z (`outbox/odds-consumer-demand-20261025T110935Z.log`
and D1 `cc49101c`):

- **26 billed calls** for `ambientCaptureClosingOdds`: reconcile `EXPIRED` n 24 plus
  `MISS` n 2, 78 credits.
- **25 call groups** in `change_log` (`source='closing_odds_capture'`, one per
  sport and minute). The windows from 18:33Z tie to the credit; the 13 groups
  before 18:33Z are 39 credits against 42 billed. One call is unaccounted for,
  and it falls before 18:33Z.
- **One 10-24 kickoff with an empty row and no capture:**
  `La Liga_2026-10-24_e401882831` (14:15Z). Its `closing_odds` is NULL, and
  `change_log` holds no row of any source for it. It is the only window-a
  kickoff group with a row to fill and no line written.

`_writeClosingLine` returns without a word when the vendor lists no event for
the game, when more than one event matches, or when the matched event has no
bookmaker. Only a failed fetch or a thrown write logs, and that to the console. After the call the
`odds_budget*` tables, `odds_reconcile_state` and `change_log` hold a count and a
credit total with no time and no game on it, so a billed call that wrote nothing
cannot be told from a call that did.

## TASK 0 — premises, one command each

1. **A billed call with no matched event writes nothing persistent.** Run
   `check-ambient-capture-dedup.mjs`'s harness with a vendor answer of `[]` for
   one due game and list every `storage.put` and D1 write. Anything beyond the
   credit charge refutes it.
2. **The unnamed call is the La Liga 14:15Z capture.** UNVERIFIED. The row was
   empty, so the capture should have fired at 14:05Z, and no record could exist
   either way. No stored data can refute or confirm it; only a record written
   from now on can. This is the reason for the CC-CMD, not a finding.
3. **How often.** Over the closed days since 2026-10-22, count capture-eligible
   kickoffs (a row with `closing_odds` NULL at T-10 and no `change_log` row).
   Zero refutes a standing problem, and the single call is then a one-off.

## TASK 1 — decided from TASK 0

- Write one record per billed capture call: sport, kickoff instant, the games it
  was for, and how many lines it wrote. The `charge` and `reconcile` bookkeeping
  stays as it is.
- Rule 90: the check must go red when the record is removed, and green when a
  call that writes nothing leaves a row.

## Done condition (Rule 90 artifacts)

1. TASK 0's three outputs committed.
2. A day's billed capture calls equal its recorded calls, read from D1 and
   committed, with the zero-line calls listed by game.
