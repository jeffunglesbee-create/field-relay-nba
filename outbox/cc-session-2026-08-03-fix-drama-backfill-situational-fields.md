# CC-CMD-2026-08-03-fix-drama-backfill-situational-fields — Result

## Status: DONE. Real field-path fix, real scoped data correction,
real before/after evidence for named games.

## Task 1 — real, confirmed field shapes (Rule 87 — re-verified fresh,
doc's own assumptions were partially wrong)

Probed real ESPN MLB play-by-play live (event `401696639`, 514 real
plays, via `probe-drama-backfill-fields.yml` + a deeper follow-up
probe once the first sample play turned out to be an inning-start play
with no baserunners):

- **No `situation` sub-object exists at all** — confirmed.
- `outs` — top-level number. Confirmed correct as the doc assumed.
- `onFirst`/`onSecond`/`onThird` — top-level, but **not booleans**:
  present as an object (`{athlete:{id}}`) only when that base is
  occupied, absent (`undefined`) otherwise. `Boolean(p.onFirst)` is the
  correct test.
- `balls`/`strikes` — **the doc's "presumably also top-level" was
  wrong.** Real location: nested under `p.pitchCount.balls` /
  `p.pitchCount.strikes` (confirmed identical to the sibling
  `resultCount` in every sampled play). This would have been a second,
  undiscovered bug if fixed purely from the doc's stated assumption.

**Other sports — real per-fetcher findings (not assumed):**
- `fetchWNBAHistoricalStates` — confirmed via code read: only reads
  `homeScore`/`awayScore`/`period`/`clock`, no situational fields at
  all. No bug of this class exists; nothing to fix. Live WNBA probe
  was skipped since there's no situational-field code path to validate
  against a live shape either way.
- `buildAFLStates` / `fetchSoccerHistoricalStates` — confirmed via
  code read: neither references a `situation`-style sub-object or any
  base-runner/count-analog field. No bug of this class.

## Task 2 — real field-path fix

`scripts/drama-backfill.mjs`'s `fetchMLBHistoricalStates` now reads
`p.onFirst/onSecond/onThird/outs` (top-level, `Boolean()`-tested for
the base fields) and `p.pitchCount.balls/strikes` (nested). `homeScore`/
`awayScore`/`period.number` left unchanged (already correct, out of
scope).

## Task 3 — real, scoped correction of already-written flat data

**Real, structural signal used to identify buggy-script-written rows**
(not a heuristic): the Node backfill script's `computeDramaRetroactive`
always writes `drama_arc` as a bare JSON **array** of numbers
(`states.map(dramaScoreLive(...))`). Every client write path — both
the live in-game path and the client's own retroactive backfill, both
via `jubilant-bassoon/src/legacy/field.js`'s `computeDramaRetroactive`
— always writes `drama_arc` as a JSON **object**
(`{peak, peakPeriod, sustainedMinutes, trend, classification,
samples}`), confirmed by reading both real `/archive/drama` POST call
sites in field.js. A row's `drama_arc` starting with `[` vs `{` is a
100%-reliable authorship signal, not a guess.

Real D1 query (`/d1/execute`, `regular_season_games` +
`postseason_games`, sport=MLB):
- `regular_season_games`: 564 rows with `drama_peak IS NOT NULL`, of
  which **537 had array-shape `drama_arc`** (buggy-script-written) and
  0 had object-shape (client-written for MLB specifically, currently
  zero — the client's own MLB drama-writing path hasn't fired yet in
  production).
- `postseason_games`: 0 MLB rows with `drama_peak IS NOT NULL` at all
  — nothing to reset there.

Captured full before-state for all 537 matched rows, then reset only
those rows' `drama_peak`/`drama_arc` to `NULL` via one explicit
`UPDATE ... WHERE sport='MLB' AND drama_peak IS NOT NULL AND drama_arc
LIKE '[%'` statement. Real result: `changes=537`, post-reset recheck
of the same WHERE clause returned 0 rows remaining. The 27 remaining
non-null-but-unmatched rows (564-537) were left untouched — these are
honest `drama_peak=0, drama_arc=null` writes from the script's own
skip/no-states paths (missing ESPN data), not incorrectly-computed
rows, per the CC-CMD's explicit "do not touch the honest-null design"
scope note.

(Workflow note: the reset workflow's own log-commit step initially
failed on a real `403` — I'd omitted `permissions: contents: write`
from the workflow YAML, a genuine authoring mistake, not the
previously-seen push-race pattern. Investigated per Rule 77 rather
than assumed; the actual D1 reset had already succeeded regardless.
Fixed the workflow and recovered the full before-state log directly
from the job's own captured output, committed as
`outbox/reset-mlb-drama-20260803T132356Z.log`.)

Re-ran the now-fixed `drama-backfill.mjs` via the existing
`drama-backfill.yml` cron workflow (dispatched manually, run
[`30817919857`](https://github.com/jeffunglesbee-create/field-relay-nba/actions/runs/30817919857),
completed successfully) — it picked the 537 reset rows back up
naturally through the existing `/archive/drama-missing` →
`/archive/drama-by-id` flow, exactly as the CC-CMD specified, no new
mechanism invented.

## Task 4 — real verification, named games

Real before → after `drama_peak` for 4 specific named games (not a
generic "distinctness improved" claim):

| Game | Date | Before | After |
|---|---|---|---|
| Baltimore Orioles vs Tampa Bay Rays | 2026-05-27 | 52 | **58** |
| Baltimore Orioles vs Tampa Bay Rays | 2026-05-26 | 52 | **60** |
| Baltimore Orioles vs Tampa Bay Rays | 2026-05-25 | 74 | **99** |
| Minnesota Twins vs Chicago White Sox | 2026-06-02 | 52 | **55** |

Also queried the real live `/archive/drama/leaderboard?sport=MLB&limit=50`
endpoint (run
[`30818507740`](https://github.com/jeffunglesbee-create/field-relay-nba/actions/runs/30818507740)):
top games now show genuine escalation patterns within their arcs (e.g.
a White Sox/Yankees game's arc contains a run of `60, 52, 52, 58,58,
58,58,58,58,58` — real situational variation the always-zero-sitBonus
bug could never produce). Long stretches of `52` still appear and are
**expected, not residual bug evidence** — a tied, bases-empty,
pre-7th-inning play legitimately scores exactly `base(1.0)*52=52` with
zero bonuses; the fix's real signature is that scores now *also* vary
(44/58/60/97/99/100) when the real game state calls for it, which
never happened under the bug.

## Explicitly NOT touched (per scope)
- The live client's own `/archive/drama` write path — untouched,
  confirmed already correct.
- Non-MLB sports' already-written drama data — untouched; Task 1 found
  no equivalent bug for WNBA/AFL/soccer.
- The honest-null design for genuinely-missing ESPN data — untouched.

## Commits
- `9d107c5` — field-path fix (Task 2) + reset script/workflow (Task 3 infra)
- `0d31e94` — reset workflow permissions fix + recovered evidence log
- `a0f36a0` — leaderboard distinctness verification script (Task 4)
- Probe infra: `e938933`, `fe23c4f`

## Outbox
This file + `outbox/drama-backfill-probe-*.log`,
`outbox/drama-backfill-probe2-*.log`,
`outbox/reset-mlb-drama-20260803T132356Z.log`,
`outbox/drama-leaderboard-verify-*.log` (all already committed to main).
