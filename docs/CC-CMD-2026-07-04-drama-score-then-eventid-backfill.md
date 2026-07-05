# CC-CMD: Score-fill, then event-ID backfill, for the 108 real gap rows

**Date:** 2026-07-04
**Repo:** jeffunglesbee-create/field-relay-nba (sole)
**Branch:** main
**Order, as specified: score-fill first, event-ID backfill second.**

**Real, verified starting state (re-confirm via probe, do not trust this
snapshot blindly):**
```
CFL:  2 rows, null_score=2, null_espn_id=2
FIFA: 2 rows, null_score=2, null_espn_id=0
MLB:  74 rows, null_score=73, null_espn_id=48
WNBA: 30 rows, null_score=30, null_espn_id=27
```
Root cause (confirmed): these are real past games (June–early July) whose
`home_score`/`away_score` were never written — the GameDO archive write
depends on an active browser session at game-end, which didn't happen for
these. This is a data-completeness gap, not a drama-scoring gap.

**Critical fix required before any score-fill writes — real bug, not
theoretical:** `index.html`'s client read path uses
`Number(localStorage.getItem('field_drama_peak_'+gameId)) || 50` — the `||`
operator means a literal `drama_peak = 0` is treated identically to unset,
silently defaulting to 50. Any row this CC-CMD marks as "unsupported,
cleared" must NOT use literal `0` as the sentinel, or it will silently
render as 50 on the client, not 0. Confirm the actual D1-column read path
used by `getCardCircadian`/wherever `drama_peak` is surfaced client-side
(not just the unrelated `localStorage` cache checked here) before choosing
a sentinel — do not assume the D1 column has the identical `||` bug without
checking that specific code path directly.

**Target time:** ~40 min

## ENVIRONMENT CONSTRAINTS (copy verbatim)
- *.workers.dev:443 blocked from CC egress — CI-as-proxy / GitHub Actions job for live checks
- No branch switching — work on main only
- 2 attempts max on any push — declare failure and stop if both fail

## CONFIDENCE GATE
Do not commit unless confidence ≥ 95.

## PROBE BLOCK
```bash
# Re-confirm the 108 breakdown hasn't drifted
```
Query D1 directly (same query used to produce the table above) before
writing any code. Also grep the actual D1-column drama_peak read path
(not the unrelated localStorage cache) to settle the sentinel-value
question with certainty, not inference from a different code path.

## TASK 1 — Score-fill pass (all 108, regardless of espn_event_id status)

For each of the 108 null-score rows: try the relay's own `/v2/games?date=
{date}&sport={sport}` first (has recent-date coverage already). For rows
outside that recency window, fall back to `/espn-summary` (requires an
espn_event_id — will only work for the ~30 rows that already have one;
for the ~77 that don't, this step can only succeed via the `/v2/games`
path, not ESPN). Write real, verified final scores to
`home_score`/`away_score`. Do not write placeholder/guessed scores for
rows where no real source returns a match — leave those genuinely null
and report them, don't force a number.

## TASK 2 — Event-ID backfill (for rows still missing espn_event_id after Task 1)

For the subset that now has a real score but still lacks `espn_event_id`:
attempt to match against ESPN's schedule/scoreboard endpoint by team +
date (same matching approach already proven for CFL/other sport discovery
this session). This is a best-effort match, not guaranteed — report how
many were successfully matched vs. how many remain genuinely unmatchable,
don't inflate the success count.

## TASK 3 — Re-run the existing backfill workflow

Newly-scored (and where possible, newly-ID'd) rows should now surface via
`/archive/drama-missing`. Re-trigger `drama-backfill.yml`
(`workflow_dispatch`, same as before). Rows with both a real score and a
real espn_event_id get genuine drama scores via the existing exact
formulas. Rows with a score but still no espn_event_id get the
"unsupported" treatment — using whatever sentinel Task 0's probe
determined is actually safe against the `0`-vs-unset collision, not
literal `0` without checking first.

## TASK 4 — Precise, honest verification

Report four distinct real numbers, not one blended total:
1. Rows that gained a real score in Task 1
2. Rows that gained a real espn_event_id in Task 2
3. Rows that got a genuine non-zero drama score in Task 3
4. Rows that remain genuinely unresolved (no real score found anywhere) —
   name these explicitly, don't silently drop them from the report

## SCOPE BOUNDARY

DO:
- Follow the specified order: score-fill, then event-ID
- Use only real, verified data — no guessed/placeholder scores
- Resolve the 0-vs-unset sentinel question via direct code check, not assumption
- Report all four numbers in Task 4 distinctly

DO NOT:
- Touch the 277 genuinely-future MLS games — separate, unrelated problem
- Write literal `0` for any "unsupported" row without first confirming via
  the probe block whether that's actually safe for the real D1-backed
  client read path
- Blend "got a score" and "got a real drama score" into one success number

## DONE CONDITIONS
- [ ] Probe block re-run, 108 breakdown re-confirmed, sentinel-value question resolved via direct code check
- [ ] Task 1: real scores written where found, unresolved rows reported explicitly
- [ ] Task 2: event-ID matches attempted, success/failure counts both reported
- [ ] Task 3: backfill re-run, correct sentinel value used
- [ ] Task 4: all four numbers reported distinctly
- [ ] Outbox manifest with the real, itemized results

## COMPLIANCE
- Rule 68: probe block first, including the sentinel-value check
- Rule 87: self-completing — genuinely unresolvable rows are an acceptable, honestly-reported outcome, not a blocker to completion

## CONFIDENCE SCORING TABLE
+20  Sentinel-value question resolved via direct code check, not assumed
+30  Task 1 real scores written, unresolved rows reported honestly
+20  Task 2 event-ID matching attempted with honest success/failure counts
+30  Task 4's four numbers reported distinctly, not blended

## ONE-LINER
git pull. Read docs/CC-CMD-2026-07-04-drama-score-then-eventid-backfill.md.
Score-fill first (Task 1), then event-ID backfill (Task 2), in that order.
Before writing any placeholder value, resolve via direct code check whether
literal 0 collides with an existing `||` fallback on the real D1-backed
read path (not just the localStorage cache already checked) — use a safe
sentinel if it does. Re-run the backfill, then report four distinct real
numbers: scores gained, IDs gained, real drama scores gained, and rows
still genuinely unresolved. Do not commit unless confidence ≥ 95. If score
< 95 report verbatim and stop.
