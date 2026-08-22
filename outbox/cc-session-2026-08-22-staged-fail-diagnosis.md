# CC session — staged FAIL diagnosis and the third closing-odds writer

**Date:** 2026-08-22 · **Repo:** field-relay-nba · **Branch:** main
**HEAD progression:** `5f2fabb` → `aca5c93`
**Deploy:** run 834 (`0d74e2b`), completed 21:13:25Z, success

Two staged checks were FAILing. One was the probe's fault. The other found a
writer nobody had accounted for.

---

## Commits

| hash | concern |
|---|---|
| `a8e99d6` | check 3 asserts absence of prompt-example literals, imported from journalism-quality.js |
| `d24e03a` | read-only diagnostic for both FAILs |
| `591efea` | check 2 sample-size floor (n≥4) |
| `2a656b9` | diagnostic section 4 excluded future fixtures |
| `6424761` | check 3 leak assertion gets its own baseline |
| `f6fa820` | **/archive/game finality gate + its first change_log entry** |
| `a1937eb` | **captured_at honesty for historical snapshots** |
| `0d74e2b` | staged-verification runs daily |
| `aca5c93` | check 1 baseline moved to the deploy that fixed the writer |

---

## FAIL 2 was the measurement, not the data

`soccer_opening_coverage` reported "coverage fell for La Liga" from **0 of 1**.
A single row can only produce 0% or 100%, both of which differ from any
baseline — at n=1 the check was guaranteed to report a regression or an
improvement regardless of what the aliases did.

Over 30 days of played fixtures:

| sport | played | with opening | rate | baseline |
|---|---|---|---|---|
| EPL | 6 | 4 | 66.7% | 23.1% |
| La Liga | 9 | 2 | 22.2% | 11.8% |

**Both rose.** The alias work held; the check misread its denominator. A 4-game
floor now holds sports below it at PENDING and names them in `below_floor`.

---

## FAIL 1 was real, and there was a third writer

All 41 failing rows carried closing **22–26 seconds before** opening — not
equal timestamps, earlier ones — with identical moneylines.

`change_log` was decisive: the backfill last wrote 2026-08-20, before the fix,
and `closing_odds_capture` has written **once** since. Neither logged writer
produced these rows.

They came from **`/archive/game`, `src/index.js`**, which wrote **no
`change_log` row at all** — which is exactly why it stayed hidden. Its gate was
`if (start_time && ...)`, under a comment claiming *"start_time gate confirms
this is a final game with real timing."* It does not: a scheduled fixture has a
`start_time`. It fired at 10:01 UTC for evening kickoffs.

**The ordering was the symptom; the damage was the blocking.** By pre-filling
`closing_odds` for an unplayed game, it made AmbientDO's
`WHERE closing_odds IS NULL` guard permanently false, so the genuine pre→live
capture never landed. Hence **19 `closing_odds_capture` writes in all of
history** against 1436 opening writes.

Positive control passed: sequenced pairs do exist (MLS 2026-08-19, open 10:01 →
close 23:55). The pipeline can do this; the writer was preventing it.

### Second, independent cause

`extractOddsForGame` stamped `captured_at: new Date()` unconditionally —
including for payloads from the historical endpoint, which
`fetchSportOddsHistorical` anchors to `{date}T12:00:00Z`. The stored timestamp
recorded when the worker wrote the row, not when the market data was from. The
23-second gap was purely that `/archive/game` ran seconds before the
opening-odds cron.

**Any check comparing opening and closing `captured_at` was measuring cron
execution order,** and would have kept doing so after the finality gate landed.

### Both fixed

- Finality gate reads the row's own `finalized_at` — the same test
  `isGameFinalByEventId` uses — from the dedup SELECT that was already running.
  No extra query, no extra Odds API credit. The block remains the writer for
  sports AmbientDO does not cover; it is no longer a writer for games with a
  kickoff still to come.
- `fetchSportOddsHistorical` returns `snapshotAt` (the API's served timestamp,
  or the requested anchor, with divergence logged rather than smoothed over).
  Both historical call sites pass it. `snapshotCronOdds` keeps `new Date()`
  because `fetchSportOddsLive` really is live — verified, not assumed.
- `/archive/game` now writes a `change_log` row (`archive_game_closing`),
  registered in `brief-freshness.js` `_ODDS_SOURCES` so a closing move from
  that path still stales a brief.

**Impact analysis:** three `extractOddsForGame` call sites, all enumerated —
live (unchanged), historical backfill (opening_odds), /archive/game
(closing_odds). Parameter defaults to null, so behaviour is unchanged for any
caller that does not opt in.

---

## The failure shape that recurred four times today

Every one of these was a filter or ordering that excluded the very rows the
query existed to read:

1. check 1's sport filter excluded soccer — the failing case
2. check 2's denominator counted 326 unplayed MLS fixtures
3. check 2's `date < now` excluded today, the only day with fixtures
4. the diagnostic's own section 4 returned 60 future MLS rows and no EPL

And its sibling — judging a fix by rows it never touched — appeared three
times: check 1's original game-date filter, check 3's leak assertion running
against pre-fix briefs, and check 1's baseline still pointing at the backfill
fix after the real fix shipped. **The baseline must move with the fix it
measures.** That is now true of all three checks.

---

## State after this session

```
closing_after_opening      PENDING — no game priced since deploy 834
soccer_opening_coverage    PASS    — improved for EPL (La Liga/Ligue 1 below floor)
epl_brief_event_grounded   PARTIAL — 6/10 grounded; leak-freedom UNPROVEN
any_failed: false
```

No false FAILs remain. Every remaining unknown is genuinely unknown.

**Follow-up is automated.** `staged-verification.yml` now runs daily at 06:00
UTC — after the previous day's European and US slates finalise — reversing this
file's own earlier "no schedule" argument. That argument said a daily run would
mostly report PENDING; two days showed the higher cost was that every answer
required a human to remember to dispatch it, which is how staged items become
orphans (Rule 74). It still exits non-zero only on a genuine regression.

**Unblock criteria (Rule 74):**
- *check 1* — one game priced by AmbientDO's hook after 21:13:25Z. Now
  reachable for the first time, since the writer that blocked the guard is gated.
- *check 3 leak half* — one EPL brief written after the 2f deploy (18:36Z).

Neither needs a human action; the daily run answers both.

---

## Not addressed here

- **Odds API key rotation** — still outstanding, still a user action. Note this
  session touched `fetchSportOddsHistorical`, which reads
  `env.ODDS_API_KEY || ODDS_API_KEY_FALLBACK`; the fallback constant is the
  exposed value and should be removed once rotation happens.
- **Residual D1 mutations** — 601 sport values, 539 ordinal `gNN` ids, 41
  mislabelled recaps, all awaiting authorization.
- **The 41 mis-sequenced rows themselves** are left as they are. They are
  correct history of what was written; the fix governs future writes.
