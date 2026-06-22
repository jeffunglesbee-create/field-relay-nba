# Backfill Prompt Quality — JQ_STYLE + Quality Chain + Force Mode (2026-06-22)

## Pre-build probes

- JQ_STYLE (`FIELD_PROSE_STYLE`) imported at `src/index.js:43`.
  runQualityChain imported at `src/index.js:44`. Both module-scope —
  no scope changes needed inside the route handler.
- Live pipeline reference: `executeGameBriefBackfill` at ~line 4394 uses
  the pattern this change replicates (sport context + isPostseason +
  series record + JQ_STYLE + runQualityChain with scoreThreshold:90).
- The old endpoint shipped one tick earlier (commit f50fb1b). All 10
  initial missing games already had a `source='backfill'` row when this
  rewrite started, so probe with no `force` flag returns `missing:0`.

## What ships (commit 931fd05)

### Prompt rebuilt to match live pipeline
- 50-70 word target (was "2-3 sentences", no word target)
- `${sport}${isPostseason ? ' playoff' : ''} game` header
- Series context: `hW`-`aW` win counts from postseason_games + narrative
- `isPostseason` flag derived from `series_key || importance`
- Sport context preserved (assembleContext, 600 token budget)
- Closing `JQ_STYLE` block (banned phrases, specificity rules) appended

### runQualityChain wraps initial proxy call
- `scoreThreshold: 90, maxRetries: 2` (matches executeGameBriefBackfill)
- Records `qResult.score` in `briefs.quality_score` (previously NULL)
- Markdown still stripped via `stripMarkdown`

### `?force=true` re-generation gate
- `existsClause` switches to `NOT EXISTS (… AND source != 'backfill')`
  when force=true, so games whose only game_brief is a stale backfill
  row appear in the missing set
- Before INSERT, deletes the existing `source='backfill'` row for the
  game (idempotent via `.catch(() => {})`)
- Response includes `force: true|false` for transparency

## Verify after deploy

```
# Dry-run force pass — should list every previously-backfilled game
GET /backfill/game-briefs?dry=true&force=true&limit=50

# Live force pass — re-generates with quality chain
GET /backfill/game-briefs?force=true&limit=10
# Expect: response.results[].score populated (was missing previously)

# Spot check D1 — confirm quality_score now non-null
SELECT id, sport, quality_score, word_count, source, brief_text
  FROM briefs
  WHERE source = 'backfill' AND brief_type = 'game_brief'
  ORDER BY date DESC LIMIT 5;
```

## Failure modes (silent per Rule 5)

- runQualityChain throw → caught by per-game try/catch, recorded as
  `ok:false, reason:<msg>` in results array.
- Series-count queries throw → series context omitted, brief still
  generates.
- DELETE-before-INSERT failure (force path) → `.catch(()=>{})` swallows;
  the INSERT then either lands or is no-op via ON CONFLICT.

## Scope-boundary preservation

- `executeGameBriefBackfill` untouched.
- handleJournalismCycle / live cron untouched.
- assembleContext + journalism-quality.js untouched.
- /backfill/game-briefs is still on-demand-only; never wired to cron.

## Carry-forwards

1. JQ_STYLE is large (~2 KB). Backfill prompt now hits ~3 KB total
   before context. Proxy currently routes Haiku 4.5 with 400 max_tokens
   on the initial call; runQualityChain's retries may bump tokens.
   If budget pressure surfaces, lower `maxRetries` from 2 → 1.
2. Golf (`golf_2026-06-22_usopen_r4`) and FIFA WC games still go
   through the same prompt. assembleContext returns empty for golf, so
   the recap leans on JQ_STYLE rules + score-only facts. A dedicated
   golf builder in context-assembler.js would tighten those briefs but
   is out of this spec's scope.
