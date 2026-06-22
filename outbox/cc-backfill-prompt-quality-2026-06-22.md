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

## Post-deploy verification

Deploy 931fd05 completed at 13:08:40 UTC. Force-run 3-game probe at
13:14:11 UTC — all spec items green, but spot-check reveals a deeper
quality issue rooted OUTSIDE this spec's scope.

### Spec items (all green)
- `?force=true` echoes `force:true` in response and finds the 5 stale
  backfill rows that the no-force path skipped.
- 3/3 succeeded on `?force=true&limit=3`.
- `quality_score` populated: 151, 188, 159 (all above threshold 90).
- `word_count`: 70, 66, 69 — inside 50-70 target band.
- DELETE-before-INSERT under force=true overwrote prior rows
  (created_at timestamps now 13:14:11-13:14:21).

### Spot-check FAILURE — assembleContext data dominates the prose
Per spec step 10 ("verify no ABS fixation, no nameless recaps"):

- **MLB Dodgers-Orioles (12-1)**: "Baltimore's 12-run offensive
  outburst… The Orioles successfully challenged 39 of 75 calls this
  season, while the Dodgers overturned 35 of 67 ABS challenges this
  season… Both clubs maintained a B+ grade for their ABS challenge
  accuracy through 142 total combined challenges this season." Two
  full sentences on ABS challenges in a four-sentence brief.
- **MLB Athletics-Angels (9-7)**: "Angels hitters powered a 9-7
  win… overcoming a C-grade ABS challenge performance where the
  team holds a 33/77 overturned rate this season." Score is the
  lead, but ABS is still the dominant statistical thread.
- **Golf US Open R4 (-4)**: "Finishing at -4 through the final round…
  Comparisons to Brunson's 29.0 PPG this series, Wembanyama's 28.2
  PPG this postseason, and a 26.0 PPG average this season highlight
  the competitive intensity." Cross-sport hallucination: NBA player
  PPG stats injected into a golf recap. The leader is unnamed.

### Why JQ_STYLE didn't fix it
JQ_STYLE rules are appended to the prompt, but `assembleContext`'s
output dominates because it's the only specific data in the prompt
besides the score. The LLM grabs the densest signal. For MLB,
`buildSavantContext` (or whatever NBA clutch context is being mis-
routed for golf) returns ABS challenge metrics + cross-sport leaders;
that becomes the brief's spine.

This is a `context-assembler.js` data-routing bug, not a backfill
prompt bug. The spec explicitly forbids modifying assembleContext,
so the fix lands here as a carry-forward.

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

1. **context-assembler.js mis-routes data across sports.** The golf
   recap pulled NBA clutch stats (Brunson, Wembanyama PPG). MLB recaps
   are dominated by ABS-challenge metrics rather than game-relevant
   stats. Needs investigation in a separate prompt — likely the sport-
   key router in `assembleContext` falls through to a default builder
   when the sport label doesn't match its known set. Out of THIS
   spec's scope (DO NOT touch assembleContext).
2. **Quality threshold may be too low** — score 188 with two ABS
   sentences passes scoreThreshold:90. runQualityChain doesn't
   penalize "cling to context block stats" because that's a context
   problem, not a prose problem. Raising the threshold won't help
   without smarter prompt-level guidance about WHICH context lines
   to prioritize. Out of scope per "DO NOT change journalism-quality.js."
3. JQ_STYLE is large (~2 KB). Backfill prompt now hits ~3 KB total
   before context. Proxy currently routes Haiku 4.5 with 400 max_tokens
   on the initial call; runQualityChain's retries may bump tokens.
   If budget pressure surfaces, lower `maxRetries` from 2 → 1.
4. Golf assembleContext routing produces cross-sport hallucinations
   (NBA stats in golf prose). A `buildGolfContext` builder + an early
   return on unsupported sport labels in context-assembler.js would
   prevent this. Tracked alongside item 1.
