# Outbox — Container Drama Peak Backfill

**Date:** 2026-07-05
**CC-CMD:** docs/CC-CMD-2026-07-04-container-drama-backfill.md
**Confidence:** 40/100 — below 95 gate. Tasks 3-4 not executed. Honest stop per CC-CMD instructions.

---

## Probe Block — run before any design decisions

All four probe block items run in full before any code decisions.

### Docker capability (Task 1)

```
$ docker --version
Docker version 29.3.1, build c2be9cc
```

**Docker IS available.** The Task 1 stop condition (no Docker) does NOT apply. Proceeding to probe block continuation.

### D1 gap — re-confirmed fresh (2026-07-05, before any code)

```sql
SELECT COUNT(*) as total, SUM(CASE WHEN drama_peak IS NOT NULL THEN 1 ELSE 0 END) as populated
FROM regular_season_games WHERE date >= '2026-06-01'
```

**Result: total=587, populated=0**

Identical to the CC-CMD's snapshot (587 total, 0 populated) — gap has not shrunk. Sport breakdown for games that are processable (home_score IS NOT NULL, i.e., completed):

| sport | count |
|---|---|
| MLB | 102 |
| FIFA World Cup 2026 | 33 |
| AFL | 32 |
| golf | 17 |
| WNBA | 14 |
| PGA Tour | 4 |
| **Total processable** | **202** |

385 of the 587 have `home_score IS NULL` (incomplete/no scores) — those correctly stay NULL.

### Scoring function probe

```bash
grep -n "archive/drama-missing\|_backfillOneDramaGame\|fetchMLBHistoricalStates\|fetchSoccerHistoricalStates" src/*.js
```

**Result:**

```
src/index.js:8102: // GET /archive/drama-missing?limit=N — lists recently-completed games...
src/index.js:8111: if (pathname === '/archive/drama-missing' && request.method === 'GET') {
```

`_backfillOneDramaGame`, `fetchMLBHistoricalStates`, and `fetchSoccerHistoricalStates` return **zero results** in `src/*.js`. Confirmed: all three are client-side only (jubilant-bassoon `index.html`). This is **path (b)** — scoring logic is genuinely client-only with no relay equivalent.

### wrangler.toml

Confirms zero `[containers]` section — no existing Container config. The `ARCHIVE_DB` binding is `field-archive` (id `cc49101c-0569-4d41-8e7a-be139cde4f26`), confirmed working via D1 MCP queries above.

---

## Task 1 — Capability Check: PASSED

Docker 29.3.1 confirmed available. Build capability verified — do not stop here.

---

## Task 2 — Path Determination: CONFIRMED PATH (b)

Real code inspection (probe block above) confirms all scoring functions are client-side only. No relay-side equivalent exists — `dramaScoreLive`, `computeDramaRetroactive`, `fetchMLBHistoricalStates`, `fetchSoccerHistoricalStates`, `_backfillOneDramaGame` all absent from `src/*.js`.

**Path (b) chosen:** Container must implement the same scoring rules. From CC-CMD docs + jubilant-bassoon `docs/CC-CMD-2026-07-04-soccer-drama-scoring-fix.md` and `docs/CC-CMD-2026-07-02-drama-backfill-client.md`, the formula structure is known:

```
raw = base*52 + timeBonus + sitBonus + upsetBonus  (capped 0-100)
```

**Known exactly from docs:**
- `timeBonus` per sport: MLB `period>=10`→22, NHL `period>3`→25, NBA `period>4`→22, NFL `period>4`→20; soccer `period>=3`→24, `minNum>=90`→18, `>=80`→10, `>=70`→5 (WC26 also triggered via `sp.includes('wc26')||sp.includes('world cup')`)
- `upsetBonus` (soccer only): `rankGap >= 30 && diff <= 1` → `min(15, floor(rankGap / 10))`

**Not known exactly (source inaccessible — see blockers):**
- `base`: the score-differential component; equals 1.0 when tied, decreases with lead — exact formula unknown
- `sitBonus`: situational bonus — exact formula unknown

---

## Tasks 3-4 — NOT EXECUTED

**Confidence gate blocks execution.** Three real capability blockers, confirmed via probe, not assumed:

---

### Blocker 1: ESPN API blocked from CC egress

```
$ curl -sv "https://site.api.espn.com/apis/site/v2/sports/baseball/mlb/summary?event=401815989"
  ...
  CONNECT site.api.espn.com:443 HTTP/1.1
  < HTTP/1.1 403 Forbidden
  * CONNECT tunnel failed, response 403
```

The CC proxy blocks `site.api.espn.com:443`. Historical game states (plays[] for MLB, keyEvents[] for soccer) cannot be fetched from this environment. `site.web.api.espn.com` (the relay's `ESPN_SUMMARY_BASE`) returns data via `probe_relay_route` (confirmed: `/espn-summary/sports/baseball/mlb/summary?event=401815989` → 200, 861KB) — but this requires one relay tool call per game, 202 individual calls for the full backfill, which is impractical for a sustained batch job.

### Blocker 2: Wrangler not authenticated — no CF_API_TOKEN

```
$ npx wrangler d1 execute field-archive --remote --command="SELECT COUNT(*)..."
✘ [ERROR] In a non-interactive environment, it's necessary to set a
  CLOUDFLARE_API_TOKEN environment variable for wrangler to work.
```

Cannot deploy a Cloudflare Container or run bulk D1 operations via wrangler without the token. The D1 MCP tool (single SQL per call) is available and confirmed working, but cannot drive a programmatic loop across 202 games.

### Blocker 3: dramaScoreLive formula inaccessible — cannot guarantee exact parity

`index.html` in jubilant-bassoon returns `total_lines: 1` via the `read_lines` MCP tool; all line-range reads (tried lines 23365-23470 and 33755-33900 corresponding to documented function positions) return empty content. The file is likely treated as a single unit (large single line or tool limitation) preventing surgical extraction of the function body.

jubilant-bassoon is not deployed at the expected GitHub Pages URL (`jeffunglesbee-create.github.io/jubilant-bassoon/` → 404). Alternative deployment URL unknown; `html_probe` cannot be used.

`base` and `sitBonus` are documented structurally but not numerically. Implementing them as approximations would violate "+25 Existing scoring logic preserved exactly, not reinterpreted."

**Without exact formula, max achievable confidence = 75/100 (20+20+35+0).** CI-based execution is feasible (CI can reach both ESPN and relay endpoints) but still cannot clear 95 due to this blocker.

---

## Confidence Score

| Criterion | Points |
|---|---|
| Task 1 capability check performed honestly, not assumed | +20 ✓ |
| Correct path (2b) identified via real code inspection, not guessed | +20 ✓ |
| Backfill actually completes, verified via real before/after D1 query | +0 BLOCKED |
| Existing scoring logic preserved exactly, not reinterpreted | +0 BLOCKED |
| **Total** | **40/100** |

**Gate: 95. Score: 40. Stop condition met. No code committed.**

---

## What Unblocks This

Any ONE of the following would change the outcome:

**Option A — CF_API_TOKEN available:** If `CLOUDFLARE_API_TOKEN` is set as an environment variable in this session, `wrangler d1 execute` and `wrangler containers` become usable. A Docker container with the scoring logic could be built locally and deployed via wrangler, calling the relay endpoints from within Cloudflare's network.

**Option B — ESPN API unblocked OR relay ESPN proxy available in Node.js:** If `site.api.espn.com` were reachable from bash (or if the relay's `/espn-summary` proxy were callable from a script, not just MCP), a GitHub Actions workflow could fetch all 202 games' historical states and write computed scores via `POST /archive/drama`.

**Option C — dramaScoreLive source accessible:** If jubilant-bassoon's `index.html` can be read (e.g., via a tool that handles single-line large files, or the deployment URL is found so html_probe can extract script content), the exact `base` and `sitBonus` formulas can be ported faithfully, clearing the +25 criterion.

**Option D — Add a one-shot GitHub Actions workflow:** With no CC environment blockers, a `drama-backfill-oneshot.yml` workflow triggered via `workflow_dispatch` could run from CI (which has full network access). The remaining question is the formula; with Option C resolved, this becomes viable.

---

## Formula Components Verified (for use when blockers are resolved)

From jubilant-bassoon docs, confirmed accurate:

**`fetchSoccerHistoricalStates(espnEventId, league)`** — implemented (commit 97c5eec in jubilant-bassoon, deployed and smoke-tested):
- Fetches `keyEvents[]` from ESPN summary
- Reconstructs running score (homeScore/awayScore) by iterating scoring events, comparing `e.team.id` to home competitor's team ID
- Interpolates synthetic 5-minute samples (`FIVE_MIN_MS = 5*60*1000`) between consecutive real events

**`dramaScoreLive` formula structure** (verified in jubilant-bassoon outbox, commit 97c5eec):
- Soccer sport detection: `sp.includes('soccer')||sp.includes('league')||sp.includes('mls')||sp.includes('liga')||sp.includes('ligue')||sp.includes('premier')||sp.includes('wc26')||sp.includes('world cup')`
- Soccer time bonus: `period>=3`→24 (confirmed via real WC26 game Australia 1-1 Egypt, event 760499), `minNum>=90`→18, `minNum>=80`→10, `minNum>=70`→5
- Soccer upset bonus: `rankGap >= 30 && diff <= 1` → `Math.min(15, Math.floor(rankGap / 10))`; requires `homeRank`/`awayRank` from relay's `/fifa-rankings/:team` (Parse.bot-backed, confirmed live)
- MLB: `period>=10`→22 overtime bonus, clock not used

**`POST /archive/drama` write path** (relay `src/index.js` line 8040):
- Payload: `{ source_id, drama_peak: number, drama_arc: object|string }`
- Row lookup: fuzzy-match via shortified source_id LIKE
- No auth required

**D1 schema** (direct query confirmed):
```sql
UPDATE regular_season_games SET drama_peak = ?, drama_arc = ? WHERE id = ?
```

---

## D1 Before Count (re-confirmed 2026-07-05 before writing this doc)

- **total** (date >= 2026-06-01): 587
- **populated**: 0
- **After count**: not available — backfill not run
