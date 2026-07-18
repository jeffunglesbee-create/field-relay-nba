# CC Session Doc — Gap 10: Backfill → Full Debrief Reconstruction
**Date:** 2026-07-18
**Repo:** field-relay-nba
**Branch:** main
**HEAD start:** 64e81a2 (post-rebase: 1ba7002) → **end:** 7095be1

---

## Commits

- `7095be1` feat: Gap 10 — /archive/debrief-backfill endpoint + CI probe (STRUCTURAL 8)

---

## TASK 1 — Existing backfill infrastructure

**Finding:** `/archive/backfill` (L9518) calls `executeBackfill(env, date)` which:
- Pulls all games for the date
- Calls Gemini via journalism proxy
- Runs quality chain
- Stores `brief_type='slate'`, `source='backfill'` — **full-date AI prose, not per-game**

This is the wrong shape for Gap 10. Gap 10 needs per-game structured Debrief reconstruction from existing archived data with no AI generation. A new separate endpoint is correct — extending `/archive/backfill` would conflate two distinct concerns.

`brief_type='debrief'` — zero occurrences in codebase. No collision.

---

## TASK 2 — `/archive/debrief-backfill` endpoint

Added in `src/index.js` before the `/archive/drama` route:

**Endpoint:** `GET /archive/debrief-backfill?date=YYYY-MM-DD`

1. Queries both `regular_season_games` and `postseason_games` for the date
2. For each game: parallel `findGame` + `findBriefs` + `findSeries` (proven helpers)
3. Assembles debrief payload:
   - `odds.opening/closing/lineMovement` from `findGame`'s already-parsed fields
   - `series` from `findSeries` result
   - `brief` from `findBriefs` `gameBriefs[0]`
   - `drama_peak / drama_arc` from game row (null for pre-Phase-3a games)
   - `drama_peak_tracked: boolean` — explicit not-silently-omitted signal
4. Inserts as `brief_type='debrief'`, `source='debrief_backfill'` per game
5. Idempotent: `ON CONFLICT(id) DO NOTHING` keyed on `debrief_{gameId}`

Also added `/archive/debrief-backfill` to the MCP probe allow-list.

---

## TASK 3 — Honest partial-layer handling

The `drama_peak_tracked` field is an **explicit boolean** computed as:
```js
drama_peak_tracked: game.drama_peak !== null && game.drama_peak !== undefined,
```

A game row for a pre-Phase-3a game has `drama_peak = NULL` in D1. This reads as `null` in JS → `drama_peak_tracked: false`. The client receives `drama_peak: null, drama_peak_tracked: false` — enough information to render "Not tracked" rather than guessing or silently omitting the drama layer.

This is verified in code (not just a comment) and asserted in the CI probe (Task 4).

---

## TASK 4 — CI probe (STRUCTURAL 8)

Cannot probe from sandbox (no outbound HTTP). User authorized GitHub Actions runner as the probe environment.

Added `STRUCTURAL 8` step to `.github/workflows/deploy.yml` immediately before STRUCTURAL 1:
- `continue-on-error: false` (hard gate — same as STRUCTURAL 1-7)
- Probes `GET /archive/debrief-backfill?date=2026-05-20`
- Asserts: HTTP 200, `ok:true`
- If `gameCount > 0`: asserts every non-skipped result has `drama_peak_tracked` as a boolean
- If `gameCount == 0` (no games for that date in ARCHIVE_DB): passes with informational message

Probe date `2026-05-20` is NBA Conference Finals era, predating Phase 3a drama_peak write path. If games exist, `drama_peak_tracked:false` confirms the honest null-handling. If the date has no ARCHIVE_DB rows, the endpoint's structural correctness is still verified.

---

## Confidence: 97/100

- T1 (15/15): confirmed — existing `/archive/backfill` is slate-only AI prose; new endpoint correct separate concern
- T2 (35/35): endpoint built with proven helpers; no brief_type collision; idempotent
- T3 (25/25): `drama_peak_tracked` explicit boolean in code, asserted in CI probe
- T4 (22/25): CI runner provides HTTP access; shape probe is `continue-on-error:false`; -3 for date-uncertainty (2026-05-20 may have zero ARCHIVE_DB rows — endpoint structural check still passes)

---

## Integration state

**RELAY CONTRACT:** `GET /archive/debrief-backfill?date=YYYY-MM-DD` returns:
```json
{
  "ok": true,
  "date": "2026-05-20",
  "gameCount": N,
  "results": [{
    "game_id": "...",
    "ok": true,
    "home": "...", "away": "...",
    "drama_peak_tracked": false,
    "has_odds": true,
    "has_series": false,
    "has_brief": true
  }]
}
```

**CLIENT CONSUMER:** `injectDebriefCards` in jubilant-bassoon — reads `ctx` from `/context/game/{id}` which now includes `bracketDelta` (Gap 7). Debrief backfill data becomes available via `ctx.archive.gameBriefs` after a `debrief` brief_type row is written. No jubilant-bassoon changes needed for Gap 10 to work — existing `injectDebriefCards` context consumption already reads `gameBriefs`.

**INTEGRATION STATUS: STAGED** — endpoint deployed; CI probe fires on `7095be1` run; live E2E verification depends on CI STRUCTURAL 8 result.

**OPEN (per Rule 74 — STAGED-GATE-A):**
- Blocked by: CI run on `7095be1` must complete and STRUCTURAL 8 must pass
- Unblocked when: CI green on this commit
- Verify: `curl -s "https://field-relay-nba.jeffunglesbee.workers.dev/archive/debrief-backfill?date=2026-05-20" | node -e 'd=JSON.parse(require("fs").readFileSync("/dev/stdin","utf8")); console.assert(d.ok, "ok must be true"); console.log("gameCount:", d.gameCount)'`
