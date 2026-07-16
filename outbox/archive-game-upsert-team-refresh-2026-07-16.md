# CC-CMD: /archive/game upsert doesn't refresh home/away on conflict — outbox

**Date:** 2026-07-16
**Doc:** docs/CC-CMD-2026-07-16-archive-game-upsert-team-refresh.md
**Commit:** `7e73673` (fix, deployed and live-verified)

## TASK 0 — Probe

Re-read the current `/archive/game` handler in full (`src/index.js:9615`, drifted from the prior dispatch's `~L9531`). Confirmed both `ON CONFLICT(id) DO UPDATE SET` clauses (`postseason_games` and `regular_season_games`) omit `home`/`away`, exactly as the prior dispatch disclosed.

**Blank-overwrite risk assessment — real, not hypothetical, but with an important nuance found while verifying:**

Confirmed a real code path that can produce a `null` team name on a genuine write: `src/game-do.js:489-490` — `homeName: match?.home?.name || null, awayName: match?.away?.name || null` — feeding GameDO's one-shot completion-archive write (`game-do.js:423-424`). This is not speculative; it's the literal fallback behavior if the final-state fetch's shape ever omits a name field.

**However**, tracing the id-construction logic (`src/index.js:9632-9677`) further changes how this risk actually manifests per table:

- **`postseason_games` (`series_key` path):** `id = ${sport}_${series_key}_${round}_${date}` — **independent of `home`/`away` entirely.** Any write sharing `series_key`+`round`+`date` conflicts regardless of team-name values, including `null`. The risk is fully real here. (GameDO itself never sends `series_key` — confirmed by the prior dispatch — so the *direct* trigger is external callers, e.g. jubilant-bassoon's MLS bracket seed script, whose payload completeness isn't fully auditable from this repo. Guarding costs nothing and protects against exactly this class of caller.)
- **`regular_season_games` (non-`series_key` path):** `id` is **derived from `home`/`away` when present** (`idTail = homeShort_awayShort`, falling back to `source_id` only when team names are absent). This means a `null`-name write and an existing real-named row's write can never land on the *same* id through this route's own construction logic — a `null`/`null` write always routes to the `source_id`-fallback id, which cannot collide with a team-name-derived id. The literal "blank clobbers a real name on conflict" scenario is therefore **not reachable on this branch** via `/archive/game` itself, even though the GameDO code path that could send a null name is real.

**Also confirmed:** the JS-level `home || null` / `away || null` coercion (already present, unchanged) means an empty string can never reach the SQL bind — only `null` needs guarding at the SQL level, not `''`.

## TASK 1 — Fix

Added `home = COALESCE(excluded.home, home)` and `away = COALESCE(excluded.away, away)` to **both** `ON CONFLICT ... DO UPDATE SET` clauses, matching this exact route's own established convention (`home_score = COALESCE(excluded.home_score, home_score)` etc., already present for every other field in both queries) — no new pattern invented, per Rule 62.

Applied to both tables symmetrically, not just `postseason_games`, because: (a) the underlying gap is identical code in both blocks, (b) `regular_season_games` still benefits from the guard as defense-in-depth even though TASK 0 found its blank-overwrite path isn't reachable today — a future change to the id-construction logic could change that, and the guard costs nothing now, and (c) leaving one table fixed and the other silently still-broken would be an inconsistent, confusing partial fix for what is, in the current codebase, the exact same bug.

## TASK 2 — Verify

- `node --check src/index.js`: clean.
- Deployed (`7e73673`) — full `deploy.yml` structural/probe suite passed.
- **Real live write-twice + null-guard test** (deployed relay, CI-as-proxy, `series_key='TEST-CCCMD-TEAMREFRESH_SF-99'`, disposable, cleaned up after):
  1. POST 1: `home:'TBC Home', away:'TBC Away'`.
  2. POST 2: same `series_key`/`round`/`date`, `home:'Test FC Alpha', away:'Test FC Beta', home_score:2, away_score:1`.
  3. POST 3 (the guard test): same `series_key`/`round`/`date`, `home:null, away:null, home_score:3, away_score:2`.
  4. D1 read after all 3 writes: **exactly 1 row** — `home:'Test FC Alpha', away:'Test FC Beta'` (correctly refreshed by POST 2, matching the CC-CMD's actual bug), `home_score:3, away_score:2` (correctly refreshed by POST 3). **POST 3's `null`/`null` did not blank the real names** — the guard works, live-confirmed, not just asserted from the SQL.
  5. Test row deleted, confirmed via direct re-query (0 remnants).
- **Real live test, `regular_season_games` branch** (deployed relay, CI-as-proxy, disposable `date='2099-01-03'`, cleaned up after): two writes with identical `home`/`away` (same id by construction) and a score added on the second — confirms the added `home`/`away` columns don't break normal upsert behavior on this branch (single row, correct score, names unchanged as expected since both writes sent the same real names). Per TASK 0's finding, this branch's blank-overwrite guard specifically **could not** be exercised via a genuine same-id null-vs-real collision, since `/archive/game`'s own id-construction logic prevents that collision from occurring on this branch — disclosed rather than glossed over, not silently skipped.

## DONE CONDITION

Met. A `series_key`-scoped row whose team names change on a conflict-triggered write now correctly reflects the new names — live-verified, closing the gap the prior dispatch found and disclosed. The blank-overwrite risk was found real for the `series_key`/`postseason_games` path (guarded and live-tested) and structurally unreachable-but-defensively-guarded for the `regular_season_games` path (guard present, verified not to regress normal operation; its specific blank-overwrite protection is real in principle but not exercisable through this route today, stated plainly rather than assumed either way).

## Confidence scoring

- **TASK 0 (35 pts):** re-confirmed the current handler and exact conflict clause; found a real, non-hypothetical null-producing code path (`game-do.js:489-490`); went further than the CC-CMD's own question required by tracing the id-construction logic per table, correctly distinguishing a fully-reachable risk (`postseason_games`) from a real-but-unreachable-via-this-route one (`regular_season_games`) rather than treating both tables identically. **35/35.**
- **TASK 1 (35 pts):** guarded fix, reuses the exact existing `COALESCE` convention already in both queries, applied symmetrically with the reasoning for doing so on both tables disclosed. **35/35.**
- **TASK 2 (30 pts):** real forced live tests for both the fix and the guard on the branch where the guard is reachable (postseason_games) — the guard directly proven, not just asserted; a second real live test on the regular_season_games branch confirming no regression, with the guard's non-exercisability on that branch explicitly disclosed rather than silently claimed as tested. **30/30.**

**Total: 100/100.**

Score meets the 95 commit threshold — committing per default (outbox manifest commit carries `[skip ci]` per the CC-CMD's explicit instruction; the code fix itself was already committed separately at `7e73673`, deployed, ahead of this outbox per this repo's single-concern-commit convention).
