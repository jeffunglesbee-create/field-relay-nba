# CC-CMD-2026-08-03-fix-drama-backfill-situational-fields

**Repo:** field-relay-nba
**Branch:** main — commit directly, do not create a feature branch or PR

One-liner:
```
git remote get-url origin | grep -q field-relay-nba || { echo "WRONG REPO"; exit 1; }
git pull. Read docs/CC-CMD-2026-08-03-fix-drama-backfill-situational-fields.md. Execute all tasks.
Do not commit unless confidence >= 95. If score < 95, report verbatim and stop.
```

---

## The real, confirmed bug

`scripts/drama-backfill.mjs`'s `fetchMLBHistoricalStates` reads
`p.situation?.onFirst/onSecond/onThird/outs/balls/strikes` from ESPN's
real play-by-play. Confirmed directly against a real live event
(401696639): ESPN's real play object has no `situation` sub-object at
all — `outs`, and presumably the base-runner/count fields, are
top-level keys on the play object itself. Every situational read
silently defaults (`?? false` / `?? 0`), meaning `sitBonus` is always 0
regardless of the real game state — bases loaded, 2 outs, full count,
none of it is ever captured.

Real, observed consequence: for any tied-score play before the 7th
inning (the majority of a typical game's ~500+ pitch-level plays),
`dramaScoreLive` collapses to exactly `base(1.0) * 52 = 52` regardless
of real situational tension — matching the flat, repeated `52` values
found live in the archived `drama_arc` data today. `homeScore`,
`awayScore`, and `period.number` are read correctly and are not part
of this bug.

## Task 1 — Re-verify from HEAD before writing anything (Rule 87)

- Re-fetch a real MLB event's play-by-play fresh (via the relay's own
  `/espn-summary` proxy, same as the script does) and confirm the
  exact real key names for base-runner state, outs, balls, and strikes
  — do not assume this doc's field names are exactly right; read the
  real, current response shape directly.
- Check `fetchWNBAHistoricalStates`, `buildAFLStates`, and
  `fetchSoccerHistoricalStates` for the same class of bug — WNBA's own
  fetcher doesn't currently read any situational fields at all (so it's
  likely unaffected by this specific bug, but confirm rather than
  assume), and soccer/AFL don't have a `situation`-style sub-object
  dependency in the code as written. State the real finding for each,
  don't just fix MLB and assume the rest are fine.

## Task 2 — Fix the real field paths

Correct `fetchMLBHistoricalStates` to read the real, confirmed
top-level field names from Task 1. Keep `homeScore`/`awayScore`/
`period.number` unchanged — those are already correct.

## Task 3 — Correct already-written, flat historical data

The existing `/archive/drama-by-id` write path only updates rows
`WHERE drama_peak IS NULL` — simply re-running the fixed script will
silently skip every game this bug already wrote flat data for, since
they're no longer null. This needs a real, careful correction path:

- Identify which rows were written by this specific buggy script
  version, not all MLB rows with a non-null `drama_peak` (some may be
  correctly written by the live client's own `/archive/drama` path,
  which does not have this bug and must not be touched or reset).
  A real, checkable signal: rows whose `drama_arc` (once parsed)
  consists overwhelmingly of the exact value 52 with zero situational
  variation, or a real timestamp/authorship signal if one exists in
  the schema — investigate what's actually distinguishable before
  picking an approach, don't guess at a heuristic.
- Once real, correctly-scoped candidate rows are identified, reset
  only those rows' `drama_peak`/`drama_arc` to NULL (a real, explicit,
  reviewable SQL statement — report the real row count affected before
  and after), then re-run the fixed backfill script so it picks them
  back up naturally through the existing `/archive/drama-missing` →
  `/archive/drama-by-id` flow.

## Task 4 — Real verification

- Re-fetch the same real games checked live today (Orioles/Rays,
  White Sox/Twins, and at least 2 more from the original 15-game
  sample) via `/archive/drama/leaderboard?sport=MLB` and confirm
  `drama_peak` values are no longer identical across unrelated games,
  and `drama_arc` shows genuine situational variation, not a long flat
  run of 52.
- Report the real before/after `drama_peak` value for at least 3 of
  the specific games already observed flat today, not a generic
  "distinctness improved" claim.

---

## Explicitly NOT in scope

- Do not touch the live client's own `/archive/drama` write path — it
  is confirmed correct and unaffected by this bug.
- Do not reset or touch any non-MLB sport's already-written drama data
  unless Task 1 finds a real, equivalent bug for that sport specifically.
- Do not change the honest-null design for games that genuinely have
  no ESPN play-by-play available — this fix is about correcting a real
  computation bug, not revisiting that separate design decision.

---

## Outbox

`outbox/cc-session-2026-08-03-fix-drama-backfill-situational-fields.md`:
the real, confirmed field names from Task 1, the per-sport findings,
the real row count identified and reset, and real before/after
`drama_peak`/`drama_arc` values for specific, named games.
