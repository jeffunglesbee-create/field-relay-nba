# ESPN Summary Context Builder — 2026-06-23

## Probes (Rule 68)

| # | Probe                                  | Result                                                                |
|---|----------------------------------------|------------------------------------------------------------------------|
| 1 | `CONTEXT_SOURCES` location             | `src/context-assembler.js:348` — entries: odds_story, savant, nhl_series, nba_clutch, soccer_xg |
| 2 | `buildSoccerXGContext` pattern         | Lines 275–309 — reference template followed                            |
| 3 | `RELAY_BASE` pattern                   | `env?.RELAY_BASE || 'https://field-relay-nba.jeffunglesbee.workers.dev'` at line 279 |
| 4 | exports                                | Tail of context-assembler.js — added buildESPNSummaryContext           |
| 5 | `assembleContext(env, …)` call sites   | 4 sites: index.js 4383, 5464, 7568, 8669                              |
| 6 | `regular_season_games.source_id` column | **CC-CMD CLAIM FALSE.** Column does NOT exist. /archive/game reads source_id from POST body but only uses it to synthesize the id when home/away missing (index.js:6913). Schema-side it's not a stored column. Confirmed by D1 error: `D1_ERROR: no such column: g.source_id`. Hotfix applied (commit 498cc72). |
| 7 | ESPN summary leaders shape             | `/espn-summary/sports/baseball/mlb/summary?event=401696473` → 200, 867 KB payload, contains `boxscore[]` + `leaders[]` for completed game. Endpoint contract sound. |
| 8 | WC leaders shape                       | Not probed; covered by graceful-degrade via `_hasXG`-style empty handling |

## What shipped

**`src/context-assembler.js`:**
- `_ESPN_SPORT_SLUG` constant: maps `mlb` / `nba` / `wnba` / `nhl` / `wc26` / `soccer` → ESPN URL slug.
- `buildESPNSummaryContext(env, game)`: reads `sourceId | source_id | espnEventId | eventId`, looks up the sport slug, calls `${RELAY_BASE}/espn-summary/{slug}/summary?event={id}` with a 3 s timeout. Walks `d.leaders[]`, takes the top performer per category (handles both `cat.leaders` array and `cat.leaders.leaders` array forms), emits `[ESPN GAME LEADERS]` block. Returns `''` on every failure mode (missing source, unknown sport, ESPN 4xx, empty leaders, JSON parse error).
- Registered as `espn_summary` priority 3 (before savant/soccer_xg at 7), budget 200, sports list `['mlb','nba','wnba','nhl','wc26','soccer']`.
- Added to the export block.

**`src/index.js`:**
- `sourceId` propagated through all four `assembleContext` call sites:
  - L4386 `executeGameBriefBackfill` → `game.source_id || null` (SELECT * yields it if present, else undefined → builder returns '')
  - L5466 cron slate → `m.eventId` (the existing eventId from gameMeta)
  - L7572 `/backfill/game-briefs` → `game.source_id || null` (same fallback semantics)
  - L8672 `/journalism/context-probe` → `String(ev.id || '')`
- MCP `ALLOWED_PREFIX` extended with `/espn-summary` and `/journalism` so Task 5 verification can run.

## Commits & deploys

- `e314c60` feat: buildESPNSummaryContext — per-game leaders feed Dims 1/4/6
- `498cc72` fix: drop g.source_id from /backfill/game-briefs SELECTs (column does not exist)
- Deploys: 28056167113 and 28056491438 — both completed/success.

## Task 5 verification

| Done condition                                        | Result |
|--------------------------------------------------------|--------|
| 1. `/espn-summary/.../summary?event=…` returns leaders[]| **PASS** — 200, 867 KB payload, boxscore + leaders confirmed (event 401696473) |
| 2. `[ESPN GAME LEADERS]` appears in assembled context  | **DEFERRED-EXPECTED** — `/journalism/context-probe` for today (2026-06-23) shows MLB games with `[SAVANT CONTEXT]` only, WC games with `[SOCCER XG CONTEXT]` only. No `[ESPN GAME LEADERS]` block because today's games haven't finished — ESPN leaders populate post-game (CC-CMD UNKNOWN, anticipated). The next cron tick after tonight's slate completes will inject the block into prompts via the L5466 path. |
| 3. `/backfill/game-briefs?dry=true` runs              | **PASS** — 200 after hotfix; before hotfix it was 500 with the `g.source_id` SQL error |
| Hotfix confirmation                                    | **PASS** — column-absence handled; assembleContext paths that lack a real ESPN event ID silently produce no ESPN block |

### Context-probe output (proves the wiring runs without error)

```
HOU @ TOR   MLB   [SAVANT CONTEXT] ABS grades for both teams
KC  @ TB    MLB   [SAVANT CONTEXT] ABS grades for both teams
NYY @ DET   MLB   [SAVANT CONTEXT] ABS grades for both teams
UZB @ POR   WC    [SOCCER XG CONTEXT] xG/xA/PPDA/big chances
GHA @ ENG   WC    [SOCCER XG CONTEXT] xG/xA/PPDA/big chances
CRO @ PAN   WC    (empty — no xG data either)
```

Both existing context builders still fire; `buildESPNSummaryContext` runs in parallel and silently emits nothing pre-game, as designed.

### Baseline (pre-change) MLB `game_brief` quality

From `/quality/report` (7-day window, pre-deploy):
- `game_brief` MLB: 20 rows, avg **159.6**, min 141, max 177, 3/20 < 150

Re-measure after tomorrow's cron has run with the new builder feeding the prompt to confirm the lift. Capture is in `/quality/report` snapshot; no extra plumbing needed.

## Carry-forwards

1. **CC-CMD assumption error.** Spec asserted `regular_season_games.source_id` was a stored column. It is not. Two callers (`executeGameBriefBackfill`, `/backfill/game-briefs`) read `game.source_id` but the field is undefined on those rows. Builder degrades to `''` — correct behavior, but means ESPN leaders only fire from the cron slate path and `/journalism/context-probe`, not from backfill paths.
2. **Persisting source_id is a follow-up.** Adding `source_id` as a real column to `regular_season_games` + `postseason_games` + updating the `/archive/game` INSERTs to persist it would let backfill paths emit ESPN leaders too. Schema change + INSERT edits — bigger scope than this CC-CMD. Worth a future session.
3. **Live-game ESPN absence is structural, not a bug.** Leaders populate post-game. Pre-game `assembleContext` returns no ESPN block. The cron tick that runs after games complete is the one that benefits.
4. **WC leaders shape unverified.** Probe #8 was optional; the builder handles missing leaders by returning ''. If WC leaders[] has a different shape than the MLB one, no ESPN block fires for WC — same graceful degrade, but a future session could verify and broaden if needed.
5. **Budget impact.** espn_summary budget 200 tokens runs at priority 3, before savant (400) and soccer_xg (150). Total assembleContext budget is 1500 (or 600 for slate). At 200 for ESPN, savant still fits cleanly; soccer_xg games have 150 ESPN + 150 xG = 300 < 600 slate cap. No starvation expected.

## Verify commands

```
probe_relay_route /espn-summary/sports/baseball/mlb/summary?event=401696473
# expect 200, leaders[] with multiple categories

probe_relay_route /journalism/context-probe
# expect existing [SAVANT CONTEXT] + [SOCCER XG CONTEXT] blocks; after
# tonight's games complete, MLB rows should also show [ESPN GAME LEADERS].

probe_relay_route /quality/report
# expect MLB game_brief avg to lift from 159.6 after the next cron cycle
# that includes completed games.
```
