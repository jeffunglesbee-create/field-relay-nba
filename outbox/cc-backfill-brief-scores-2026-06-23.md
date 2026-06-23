# Backfill Brief Scores — 2026-06-23

## Probes (Rule 68)

| # | Probe                                  | Result                                                                |
|---|----------------------------------------|------------------------------------------------------------------------|
| 1 | `JOURNALISM_CLAUDE_PROXY`              | `'https://field-claude-proxy.jeffunglesbee.workers.dev'` at line 3415 |
| 2 | `runQualityChain` import               | Line 52 (used 7× elsewhere)                                            |
| 3 | NULL-row count by type (pre-flight)    | Dry-run capped at limit; live count discovered 452 rows across all passes |
| 4 | `/backfill/` route block               | `/backfill/game-briefs` at line 7458, closing `}` at line 7639 — inserted new handler at 7640 |
| 5 | MCP allow-list contains `/backfill`    | Yes — `/backfill` prefix already in `ALLOWED_PREFIX` (line 10538). No allow-list edit needed. |

## What shipped

- **`src/index.js`** — `GET /backfill/brief-scores?limit=&dry=&type=` route
  inserted after the `/backfill/game-briefs` handler at line 7640.
  - SELECTs up to `limit` (default 20, max 50) NULL-scored rows ordered
    by `created_at DESC`, optional `?type=<brief_type>` filter.
  - `?dry=true` returns count + by-type breakdown without scoring.
  - Per row: builds the same degenerate scoring prompt as `/archive/brief`
    (`"Score this sports brief for journalism quality:\n\n<text>"`), calls
    `runQualityChain` with `maxRetries:1` (score only), then
    `UPDATE briefs SET quality_score = ? WHERE id = ? AND quality_score IS NULL`
    so a concurrent `/archive/brief` POST cannot be double-stomped.
  - Per-row failure pushed into an `errors` array; never throws.

## Commit & deploy

- `f883975` feat: GET /backfill/brief-scores — retroactively score
  NULL-quality_score briefs (1 file, +88)
- Deploy: workflow 28054099865 — completed/success.

## Execution log

Ran 10 batches of `limit=50` via `probe_relay_route`:

| Pass | Processed | Scored | Failed |
|------|-----------|--------|--------|
| 1    | 50        | 50     | 0      |
| 2    | 50        | 50     | 0      |
| 3    | 50        | 50     | 0      |
| 4    | 50        | 50     | 0      |
| 5    | 50        | 50     | 0      |
| 6    | 50        | 50     | 0      |
| 7    | 50        | 50     | 0      |
| 8    | 50        | 50     | 0      |
| 9    | 50        | 50     | 0      |
| 10   | 2         | 2      | 0      |
| **Total** | **452** | **452** | **0** |

Final dry-run probe: `{found: 0, by_type: {}}` — every NULL-scored row in
the briefs table now has a score.

## Task 4 — /quality/report verification

After backfill, `/quality/report` (7-day window since 2026-06-16) shows:

| brief_type                | sport               | scored / total | avg_score |
|---------------------------|---------------------|---------------:|----------:|
| `mlb_game`                | MLB                 | 61 / 61        | 200.9     |
| `night_owl`               | MLB                 | 61 / 61        | 156.0     |
| `night_owl`               | Baseball (MLB)      | 52 / 52        | 150.5     |
| `night_owl`               | FIFA World Cup 2026 | 42 / 42        | 154.5     |
| `wc_matchup`              | FIFA World Cup 2026 | 57 / 57        | 126.7     |
| `wnba_game`               | WNBA                | 3 / 3          | 158.0     |
| `standings_snapshot`      | FIFA World Cup 2026 | 8 / 8          | 146.1     |
| `game_recap` (all variants) | MLB / WNBA / WC    | 100% scored    | 180–245   |
| `narrative_context` (WC teams) | —              | 50 / 50        | 209.4 avg |
| `narrative_context` (NBA Finals / SCF) | —      | 2 / 2          | 180.5     |

Top-level: `unscored_count: 0`. **Every brief type/sport pair is fully
scored.**

## Done conditions

- [x] `/backfill/brief-scores?dry=true` returns `found: 0`
- [x] `/quality/report` shows `scored > 0` for `mlb_game`, `night_owl`,
      `wc_matchup` (in fact, scored == total for every type)
- [x] Outbox manifest committed

## Notes & carry-forwards

1. **Degenerate scoring prompt.** Same one used by `/archive/brief`:
   `"Score this sports brief for journalism quality:\n\n<text>"`. The
   original generation prompts are not stored, so retro scores reflect
   the prose quality as judged by `runQualityChain`'s scoring layer in
   isolation — not the original intent. These are useful for distribution
   analytics (avg, percentile, drift) but should not be compared apples-
   to-apples with scores from briefs that went through the full quality
   chain at generation time.
2. **Score distribution surfaced new alert candidates.** `/quality/report`
   now shows 10 alerts in the `avg_below_170` bucket (4 pre-backfill).
   This is signal, not noise — the wc_matchup briefs genuinely cluster
   around 126.7 avg with 86% failure_pct. Worth a future session to
   investigate prompt drift in that brief type, but out of scope here.
3. **Narrative_context discovered.** ~50 WC team narratives + 2 series
   narratives existed unscored. Now scored; nothing else to do.
4. **No allow-list edits needed.** `/backfill` prefix entry from the
   earlier `Brief Archive Complete` session covers this route.

## Verify commands

```
probe_relay_route /backfill/brief-scores?dry=true
# expect {found: 0}

probe_relay_route /quality/report
# expect unscored_count: 0
```
