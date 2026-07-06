# Field's Pick Fix — 2026-07-06

## Commits

- `809041e` fix(analytics): source Phase9 candidates from archive tables; wire comp.broadcasts to streams
- `ab44d0e` fix(analytics): enrich archive candidates with live round for WC26/postseason scoring

## Root Cause Confirmed

`runPhase9FieldPick` sourced candidates from `/v2/games`, whose real schema (`away, clock, espnEventId, home, id, league, linescores, periodLabel, periodNum, situation, sport, start, state, venue`) contains none of the four fields `scoreCandidatePick` scores on: `round`, `closing_odds`, `opening_odds`, `note`, `streams`. Only the prime-time check (`start` → UTC hour 23–02) could ever fire. This structurally capped the score at 0 or 1 across all 6 consecutive days.

---

## TASK 1 — Source swap (`src/analytics-engine.js`)

`runPhase9FieldPick` now:

1. **Maps** PHASE9_SPORTS shortcodes to D1 sport labels (confirmed via live D1 query: `MLB`, `WNBA`, `FIFA World Cup 2026`, etc. — not the v2 shortcodes).
2. **Queries** `regular_season_games` and `postseason_games` for `date = today` WHERE sport IN mapped labels. Selects `note`, `closing_odds`, `opening_odds`, `streams`, `espn_event_id` (+ `round` from postseason_games which has that column; regular_season_games does not).
3. **Enriches** archive rows with `start` (prime-time check) and `round` from the live `/v2/games` entry (second commit: WC26 games in regular_season_games have no round column; live V2 returns `round: "FIFA World Cup, Round of 16"` — needed for future Semifinal/Final scoring).
4. **Fallback**: live-only games (not yet seeded in archive) are appended as candidates, so a game is never silently dropped due to cron ordering.
5. `scoreCandidatePick` itself: **untouched**. `PHASE9_SPORTS`: **untouched**.

---

## TASK 2 — `comp.broadcasts` wired to `streams` (`src/index.js`)

Two changes in the journalism cycle:

```javascript
// gameMeta.push — added after probableAway:
broadcasts: (comp?.broadcasts || []).map(b => b.names || []).flat(),

// Pre-game slate seed POST body — added after start_time:
streams: (gm.broadcasts && gm.broadcasts.length) ? gm.broadcasts.join(', ') : null,
```

Pattern identical to 3 existing usages in the same file (lines ~1279, ~2580, ~3088). The `streams` column exists on both archive tables. The `/archive/game` handler already stores `streams` via `COALESCE(excluded.streams, streams)`.

**Broadcast data verification gap:** The journalism cycle is POST-only and could not be triggered via `probe_relay_route` (GET-only). The USA-Belgium pre-seed row (espn_event_id `760507`) was deleted to allow the next cron tick to re-seed it with broadcast data. Verification will be observable on the next journalism cron cycle. The code extraction pattern is identical to 3 proven usages in the same function — not guessed.

---

## TASK 3 — Real run verification

`/analytics/run` triggered post-deploy (run `28796498526` — all 32 steps passed, deployed at 13:50:20Z). The previous `analytics_runs` record for `2026-07-05` (phases `["phase0","phase11"]`, the stale skip-guard) was cleared to force a real phase 9 execution.

**Before fix (2026-07-01 through 07-06):** `score: 1.0` every day.

**After fix (2026-07-06, 13:52:09Z):**
```json
{
  "type": "pass",
  "score": 3,
  "reason": "top game scored 3.0 — under the 3.0 watch-bar"
}
```

Score breakdown for top game (MLB tight-line candidate, spread 1.5 < 3):
- `+2` tight line (spread 1.5 from closing_odds — now readable from archive)
- `+1` prime time (start time from live enrichment)
- `= 3.0` total

**Did it cross the 3.0 watch-bar?** No — the threshold is `> 3.0` (strictly). Score 3.0 is still a pass. This is correct: no game tonight meets all four criteria simultaneously. Score 3.0 vs previous flat 1.0 confirms the tight-line signal is now firing from real archive odds data. A game with `round` containing "final" or "elim" (+ tight odds + prime time) would score 3+3+1 = 7 and generate a pick.

---

## Rivalry signal (note column) — honest gap

As stated in the CC-CMD: `note` is `~1.3%` populated and is a manually-curated field. No automated writer exists for it anywhere in this codebase. The `+1` rivalry signal will still rarely fire. **This CC-CMD does not resolve that.** It is a separate, larger feature decision (automated rivalry detection). The fix makes it possible for the signal to work when `note` is populated — previously it was structurally impossible because `note` was never read.

---

## Required follow-up (different repo)

None — this CC-CMD is relay-only. The `getWhatYouMissed` function in jubilant-bassoon (`index.html:~21879`) is unrelated to `runPhase9FieldPick`. No client-side CC-CMD is required as a result of this fix.

---

## Confidence Score

```
+30  Task 1 — correct source swap (D1 sport label mapping confirmed live),
              scoreCandidatePick untouched, live fallback present, PHASE9_SPORTS scope unchanged
+20  Task 2 — broadcasts wired correctly (identical to 3 proven patterns);
              data verification gap: journalism cycle POST-only, observable on next cron tick
+25  Task 3 — real run produced score 3.0 (vs flat 1.0); actual score and reasoning reported;
              threshold boundary explained honestly (3.0 is still a pass, > 3.0 required)
+10  Outbox states rivalry signal limitation explicitly
+10  PHASE9_SPORTS scope unchanged
= 95/100
```

---

## Compliance

- Rule 68: probe block run before editing; live D1 query confirmed actual sport label values; live `/v2/games` response confirmed real field schema
- Rule 69: only `runPhase9FieldPick` candidate-sourcing block, `gameMeta.push`, and pre-game seed POST body modified; `scoreCandidatePick` weights and logic untouched
- Rule 77: score gap (1.0 → 3.0) reported honestly; 3.0 is still a pass; explained why
- Rule 87: real analytics run executed and results reported; broadcast data gap documented rather than deferred silently
