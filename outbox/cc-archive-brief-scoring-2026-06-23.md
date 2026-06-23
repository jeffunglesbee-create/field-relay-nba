# Archive Brief Scoring — 2026-06-23

## Probe results (Rule 68 — verified before code)

| # | Probe                                  | Result                                                                                        |
|---|----------------------------------------|------------------------------------------------------------------------------------------------|
| 1 | `/archive/brief` POST handler          | `src/index.js:7076`                                                                            |
| 2 | `runQualityChain` already imported     | Yes, line 52 (also used 7× elsewhere — slate, queue, backfill, per-game)                      |
| 3 | queue-consumer callProxy pattern       | `src/index.js:10760–10770` — fetch(PROXY_URL) with `X-FIELD-Relay` auth, model haiku-4-5      |
| 4 | **PROXY_URL constant**                 | `env.CLAUDE_PROXY_URL || 'https://field-claude-proxy.jeffunglesbee.workers.dev'` (line 10751). **Spec's URL was wrong** — it proposed `https://field-relay-nba.../proxy/claude`, which doesn't exist. Corrected to the actual proxy. |
| 5 | current `/archive/brief` body          | Lines 7076–7110; takes `{id, brief_type, date, sport, game_id, brief_text, model, quality_score, context_hash, word_count, source}`; persists `quality_score || null` directly. |
| 6 | scoreThreshold conventions             | 90 (queue/per-game), 130 (slate backfill), 110 (one slate path). Used 90 per spec.            |

## What shipped

- **`src/index.js` `/archive/brief` POST handler rewritten:**
  - When `quality_score` is absent/null AND `brief_text` > 50 chars, calls
    `runQualityChain` with `maxRetries: 1` (score only, no regenerate;
    the original prompt isn't available, so regenerating would invent
    intent).
  - PROXY_URL pulled from `env.CLAUDE_PROXY_URL` (matches every other
    callProxy in the file).
  - `ON CONFLICT DO UPDATE` now `COALESCE(excluded.quality_score, briefs.quality_score)`
    so a re-POST without a score can never NULL out an existing score.
  - Response shape changed from plain `'ok'` to `{ok:true, scored:bool}`.
    Backward-compatible: clients check HTTP status, not body shape.
  - `word_count` derives from `brief_text` when omitted (was NULL).
  - Scoring failure wrapped in try/catch — archival always reaches INSERT
    (Rule 5: scoring is the secondary, archival is the primary).

## Commit & deploy

- `5c0b63e` feat: /archive/brief POST now scores client briefs via
  runQualityChain (1 file, +39/−3)
- Deploy: workflow 28052882900 — completed/success.

## Task 3 verification

| Probe                                      | Result                                                                         |
|--------------------------------------------|--------------------------------------------------------------------------------|
| POST `/archive/brief` with no quality_score | **STAGED** — sandbox blocks worker.dev egress; cannot self-probe POST. Will trigger from jubilant-bassoon's `archiveBrief()` on next client cycle. |
| GET `/archive/query?brief_type=night_owl`   | 200, 3 rows returned. **All `quality_score:null`** — these are pre-fix rows (CC-CMD UNKNOWN: existing NULL rows are not retroactively scored). |
| GET `/quality/report`                       | 200. `night_owl`: 52 rows MLB / 42 rows WC / 12 misc, all `scored: 0`. `mlb_game`: 61 rows MLB, scored 0. `wc_matchup`: 57 rows, scored 0. These are the exact 3 brief types the spec targets — fix is wired, future POSTs will populate scores. |

### Why GET probes show no scores yet

Per the spec's UNKNOWN section and standard archive semantics: existing
NULL-scored rows in D1 are **not** retroactively scored by this change.
Only POSTs received after the deploy timestamp pass through the scoring
path. The first scored row will appear when jubilant-bassoon's
`archiveBrief()` next fires for a night_owl/mlb_game/wc_matchup —
typically within the next night-owl cron cycle.

### Unblock criteria (Rule 74)

Either of:
1. Wait for jubilant-bassoon's archive cron to fire and re-probe
   `/quality/report` — `scored` count for `night_owl`/`mlb_game`/`wc_matchup`
   should go from 0 → N within one client cycle.
2. Manual curl from a non-sandboxed host:
   ```bash
   curl -s -X POST "https://field-relay-nba.jeffunglesbee.workers.dev/archive/brief" \
     -H "Content-Type: application/json" \
     -d '{
       "id":"night_owl_test_scoring_2026-06-23",
       "brief_type":"night_owl","date":"2026-06-23","sport":"MLB",
       "brief_text":"The Dodgers defeated the Cubs 5-2 in a tightly contested affair at Wrigley Field, with Freddie Freeman delivering the decisive two-run double in the seventh inning.",
       "source":"smoke_test"
     }'
   # expect: {"ok":true,"scored":true}
   ```

## Task 2 — Smoke assertions

No `smoke.js` exists in `field-relay-nba` (verified again). Assertions
documented here for jubilant-bassoon `smoke.js` per CC-CMD scope:

```javascript
// A-ARCHIVE-BRIEF-SCORE-1: POST with no quality_score returns JSON {ok:true, scored:true}
//   (not plain 'ok'). Body must include brief_text > 50 chars.
// A-ARCHIVE-BRIEF-SCORE-2: COALESCE guard — re-POST same id without quality_score
//   preserves prior score (not NULLed). Verify by querying /archive/query before+after.
// A-ARCHIVE-BRIEF-SCORE-3: scoring failure is silent — even when proxy is unreachable
//   the brief still archives (response is {ok:true, scored:false}).
```

## Carry-forwards

1. **Backfill of existing NULL rows not in scope.** ~325 pre-fix rows
   sit at `quality_score: null` across night_owl/mlb_game/wc_matchup +
   the lowercase `mlb`/`wnba`/`fifa world cup 2026` aliases visible in
   `/quality/report`. A future backfill pass could re-score them — but
   the scoring prompt here is degenerate ("Score this sports brief for
   journalism quality: …"), so retrofitted scores would be heuristic
   rather than reflect actual prompt intent. Worth a separate session
   to decide whether degenerate-prompt scores are useful enough to
   backfill, or whether to skip and let attrition handle it.
2. **`quality_score` field is single-pass only.** `maxRetries: 1`
   means no regeneration. If the score comes back low, the prose is
   still archived as-is and downstream consumers (UI, analytics) see
   the low score. Intentional — we're observing, not gating.
3. **Brief-type/sport alias drift.** `/quality/report` shows the same
   sport stored as both `MLB` and `mlb`, both `FIFA World Cup 2026`
   and lowercase variants. Out of scope but worth normalizing in a
   future archive-hygiene pass — currently inflates the row count in
   any group-by-sport analytics.
4. **Word count fallback.** `brief_text.split(/\s+/).length` is now
   the default when the client omits `word_count`. Acceptable
   approximation; matches the queue-consumer pattern at line 10816.

## Verify commands

```
probe_relay_route /archive/query?brief_type=night_owl&limit=3
probe_relay_route /quality/report
# Watch for night_owl/mlb_game/wc_matchup `scored` count climbing
# from 0 after the next jubilant-bassoon archive cron.
```
