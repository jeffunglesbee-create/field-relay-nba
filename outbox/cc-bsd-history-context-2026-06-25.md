# BSD History Context + R2 List Endpoint — 2026-06-25 (CC-CMD-H Task 2)

## Scope split

CC-CMD-H has two tasks:
- **Task 1** — League ID discovery + MD1-MD2 backfill. Requires Ecuador vs
  Germany to be live or final (~20:00–22:00 UTC tonight) so BSD's live
  endpoint surfaces the WC league_id. **Not run in this session.** The CC-CMD
  spec also embeds Python writing to D1 via a `CF_API_TOKEN` env var — that
  would put a credential into agent context (Rule 80 violation). Task 1
  should run after the game completes and via the admin POST endpoint
  shipped in 0af35ca, not via direct CF API from this session.
- **Task 2** — `/bsd/r2/list` endpoint + `buildBSDHistoryContext` CONTEXT_SOURCE.
  Shipped now.

## Spec correction (critical bug avoided)

Spec section 2b declared `async function buildBSDHistoryContext(game, env)`.
All other builders in `context-assembler.js` use `(env, game)` and the
registry dispatches with `source.builder(env, game)` (verified at L623).
Shipping the spec literally would have crashed the builder. **Implemented
with corrected `(env, game)` signature.**

## Edits

**`src/index.js`** — `/bsd/r2/list` endpoint inside the `/bsd/*` block
(initial commit `6170de0` placed it after the block; it was shadowed by
the `'Unknown BSD route'` catch-all, fixed in `54d1036`).
- Returns 503 if `FIELD_DATA` R2 binding unbound.
- Default prefix `bsd/wc26/`, accepts `?prefix=` override.
- Limit 100, returns `{keys: [{key, size, uploaded}], truncated}`.
- No BSD token needed (R2 only).

**`src/context-assembler.js`**
- `buildBSDHistoryContext(env, game)` added before CONTEXT_SOURCES.
  - Queries `wc_results WHERE bsd_event_id IS NOT NULL AND (home/away
    = ? OR home/away = ?) ORDER BY match_date DESC LIMIT 4`.
  - For each prior match: reads `bsd/wc26/{id}/shotmap.json` and
    `bsd/wc26/{id}/momentum.json` from R2.
  - Computes per-match summary: total shots + on-target + xG sum;
    peak momentum value with minute marker.
  - Emits `[BSD HISTORY]` block with `match_date | teamLabel vs opponent
    (score) | shot summary | peak momentum`.
  - All R2 reads wrapped in individual try/catch — one missing file
    doesn't kill the whole block.
- Registered as `bsd_history` priority 7, budget 200, sports `['wc26']`.
- Exported.

## Commits & deploy

- `6170de0` feat(bsd): buildBSDHistoryContext + /bsd/r2/list endpoint (2 files, +96)
- `54d1036` fix(bsd): move /bsd/r2/list inside /bsd/* block (was shadowed) (1 file, +19/−16)
- Deploys: 28185947556 + 28186061742 — both completed/success.

## Done conditions

- [x] `node --check` passes both files
- [x] `buildBSDHistoryContext` defined + registered + exported (4 grep hits)
- [x] `bsd_history` entry in CONTEXT_SOURCES (1 hit)
- [x] `/bsd/r2/list` route present (2 hits, inside /bsd/* block)
- [x] Deploy green (28186061742)
- [x] `/bsd/r2/list?prefix=bsd/wc26/` returns 200 with `{"keys":[],"truncated":false}`
      — correct (no captures yet; R2 fills as games hit final + writeWCResult fires)

## Task 1 carry-forward

After Ecuador vs Germany goes final tonight (~22:00 UTC):

1. Probe `/bsd/events/live` while game is live — capture the `league_id`.
2. Once final, `0af35ca` writes `bsd_event_id` to `wc_results` for that game,
   `a55ebd3` writes shotmap/momentum/incidents/avg-positions to R2.
3. Probe `/bsd/r2/list?prefix=bsd/wc26/` — confirm 4 keys appear for the
   game.
4. Probe `/bsd/events/season?league_id={WC_LEAGUE_ID}` — list all WC 2026
   events from BSD.
5. Match BSD events to existing `wc_results` rows (MD1+MD2 completed games
   that lack `bsd_event_id`). Issue UPDATE via the admin endpoint from
   0af35ca, not via direct CF API.
6. With backfilled `bsd_event_id`s in wc_results, `buildBSDHistoryContext`
   will start surfacing prior-match context for the relevant WC briefs
   (assuming R2 has the corresponding captures — for MD1+MD2 games that
   completed before today, R2 will NOT have data; only games post-a55ebd3
   will have R2 captures).

## Activation gate summary

`buildBSDHistoryContext` returns `''` when:
- `FIELD_DATA` or `WC2026_DB` unbound
- Game sport ≠ `wc26`/`soccer`
- `prior.length === 0` (no priors with `bsd_event_id`)
- All R2 reads fail or yield empty data

No regression risk. The block surfaces only when there's real R2 history
for one of the playing teams.
