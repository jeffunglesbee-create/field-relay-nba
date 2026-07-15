# CC-CMD: Normalize WC26 sport-label casing at every write path — outbox

**Date:** 2026-07-15
**Doc:** docs/CC-CMD-2026-07-15-wc-label-fragmentation.md
**Commit:** 5c58518 (fix, deployed and live-verified)

## TASK 0 — Probe

Started from the doc's own citation (`/quality/report`'s 7-day window: 3 variants, 11 rows) but re-verified live against the full historical `briefs` table before trusting it, per Rule 71/79. Direct D1 query (`SELECT sport, COUNT(*) FROM briefs WHERE sport LIKE '%orld%up%' OR sport LIKE '%ifa%' OR sport = 'wc26' GROUP BY sport`) found the real picture was much larger than the doc's snapshot: **12 distinct variants, 521 total rows** — `wc26` (72), `FIFA World Cup` (80), `FIFA World Cup 2026` (336), `fifa world cup 2026` (22), and 8 distinct `FIFA World Cup 2026 — Group X` suffixed variants (11 rows combined, X ∈ {A,B,C,D,I,J,K,L}).

Traced every real write path that persists a `sport` string for a WC26 row (not just the doc's citations):

1. **`POST /archive/game`** (`src/index.js` ~L9425) — writes `regular_season_games`/`postseason_games.sport` verbatim from the request body, zero normalization. Real callers sending WC26 values:
   - `src/index.js` ~L6453/6638/6722 (ARCHIVE-CATCHUP / ARCHIVE-SEED / ARCHIVE-YDAY, inside `handleJournalismCycle`) — hardcoded literal `'FIFA World Cup 2026'`, bypassing `SOCCER_LEAGUE_LABELS` entirely.
   - `src/game-do.js` ~L441 (GameDO's completion-write on final-state transition) — sends `sport: this.sport`, the raw WS-URL slug `'wc26'`, also bypassing `SOCCER_LEAGUE_LABELS`. **Not cited in the doc at all** — found by tracing `/archive/game`'s real callers beyond `src/index.js`.
   - `/archive/game`'s own embedded KV-brief-capture logic (~L9545, "archive is authoritative") additionally **lowercases** whatever `sport` it receives (`sportKey = String(sport).toLowerCase()`) before binding it into the `briefs.sport` column — a second, independent bug compounding on top of caller (1).
2. **`POST /archive/brief`** (~L9738) — entirely client-supplied (jubilant-bassoon), zero normalization. Confirmed live as the single largest and most varied source: this is the only route capable of producing the 8 `"— Group X"` suffixed variants, and almost certainly the source of the already-correct `'FIFA World Cup'` (n=80) variant too.
3. **`JOURNALISM_QUEUE` `game-brief` enqueue** (`src/index.js` ~L2320, WC26 group-stage per-match briefs) sets `job.sport = 'wc26'`; the queue consumer's `INSERT INTO briefs` (~L14964, pre-fix) persisted `job.sport` verbatim — this is the real source of the `wc26` (n=72) bucket.
4. KV-sweep (~L5017, "archive is authoritative") faithfully copies `regular_season_games.sport` into `briefs.sport` — not itself a bug, but inherits whatever bad value write path (1) produced. Fixed for free once (1) is fixed at its source.

Every one of these bypasses `SOCCER_LEAGUE_LABELS.wc26` at the point of writing a `sport` string for a WC26 row — none of them is simple case-mangling of an otherwise-correct value; each is a genuinely different string construction (wrong literal with a stray year, a raw internal slug, an unrelated-purpose lowercase transform leaking into a persisted column, or fully unvalidated client input).

## TASK 1 — Fix

Added `canonicalizeWC26Sport(sport)` next to `SOCCER_LEAGUE_LABELS` (`src/index.js` ~L1437): a case-insensitive check (`s === 'wc26' || s.startsWith('fifa world cup')`) that returns the canonical `SOCCER_LEAGUE_LABELS.wc26` for any real variant found, and passes every other sport through completely unchanged (verified via a 25-case forced-condition test — 12 real WC26 variants + 13 non-WC26/null/undefined/empty cases, all pass, script at `/tmp/.../test-wc26-canon.mjs`, reproduced inline in the commit).

Applied at every real write path found in TASK 0:
- `/archive/game`: normalizes `sport` for the persisted game-table columns AND for the embedded KV-capture `briefs.sport` bind (which now uses the canonical `sport`, not the lowercased `sportKey`).
- `/archive/brief`: normalizes the client-supplied `sport` before scoring and before the INSERT.
- `JOURNALISM_QUEUE` consumer: normalizes `job.sport` only at the point of persisting `briefs.sport`, not upstream.

**A real risk found and mitigated before it shipped:** `/archive/game`'s `id` is `` `${sport}_${date}_${idTail}` ``. A live, in-progress WC26 game (England vs Argentina, 2026-07-15) is seeded right now under id `FIFA World Cup 2026_2026-07-15_england_argentina` (confirmed via direct D1 query before writing any fix). Normalizing `sport` *before* that `id` is built — or changing what the 3 catchup/seed/yday call sites literally send — would change the `id` on this game's next write (its eventual completion), missing `ON CONFLICT(id)` and orphaning the pre-final row mid-tournament. Two deliberate choices avoid this:
1. Inside `/archive/game`, `sport` is canonicalized *after* `id` is constructed — the id keeps whatever raw string the caller sent; only the persisted `sport` COLUMN is normalized.
2. The 3 catchup/seed/yday call sites were initially switched to `SOCCER_LEAGUE_LABELS.wc26` (satisfying the letter of "not a literal string at each call site") but then **deliberately reverted** back to the original `'FIFA World Cup 2026'` literal, once the id-collision risk was found — because `/archive/game`'s own central normalization (choice 1) already fixes the persisted `sport` column for these 3 callers regardless of what raw literal they send, so changing their literal added real risk for zero additional benefit. This is documented inline at all 3 sites.

This means TASK 1's literal-elimination instruction is satisfied in effect (every real write path converges on `SOCCER_LEAGUE_LABELS.wc26` for the persisted `sport` column) but not in the literal sense of removing every hardcoded string at every call site — a deliberate, disclosed deviation made for a concrete, live-verified safety reason (Rule 88: correct over fast), not an oversight.

**Historical data decision:** chose to **backfill**, not leave as a historical record. Rationale: this is a single, cheap, fully idempotent `UPDATE briefs SET sport = 'FIFA World Cup' WHERE LOWER(sport) = 'wc26' OR LOWER(sport) LIKE 'fifa world cup%'` — no scores, dates, or text touched, `sport` is not part of any primary key so no conflict risk — and it directly restores the exact thing the CC-CMD's own CONTEXT says is broken (calibration statistical power for WC26 brief types). Executed live: **521 rows updated** in one statement.

## TASK 2 — Verify

- `node --check src/index.js`: clean throughout all edits.
- Forced-condition unit test: 25/25 pass (12 real live-confirmed WC26 variants → canonical; 13 non-WC26/edge cases → unchanged).
- Real live end-to-end test via `/archive/game` with a synthetic, clearly-tagged test game (`CCCMDTestHome` vs `CCCMDTestAway`, sport `'wc26'`): confirmed `id` kept the raw `wc26_...` prefix (no id-scheme disruption) while the persisted `sport` column correctly read back as `'FIFA World Cup'`. Test row deleted after verification.
- Real live end-to-end test via `/archive/brief` with a synthetic, clearly-tagged brief (`sport: 'FIFA World Cup 2026 — Group Z'`, the worst-case suffixed variant): confirmed the persisted `sport` column read back as `'FIFA World Cup'`. Test row deleted after verification.
- Confirmed the live, in-progress England vs Argentina row (`id = 'FIFA World Cup 2026_2026-07-15_england_argentina'`) was untouched by the deploy — still present, same id, `home_score` still `NULL` as expected pre-kickoff.
- Post-backfill live re-query: `SELECT sport, COUNT(*) FROM briefs WHERE sport LIKE '%orld%up%' OR sport LIKE '%ifa%' OR sport = 'wc26' GROUP BY sport` now returns exactly **one row**: `FIFA World Cup, 521`.
- Real live check of `/quality/report?days=30`: WC26 now appears as 6 unified `sport: "FIFA World Cup"` buckets (one per brief_type: wc_matchup n=61, standings_snapshot n=8, game_brief n=11, night_owl n=131, game_recap n=236, narrative_context n=15), each comfortably above the 5-sample calibration floor, and `brief_type_calibration` now includes real calibrated entries for these brief types — the calibration-quality goal stated in the doc's own CONTEXT is directly, verifiably restored.

## DONE CONDITION

Every write path producing a WC26 `sport` string now converges on `SOCCER_LEAGUE_LABELS.wc26` via `canonicalizeWC26Sport()`, applied at the actual persistence boundary in every case (not by mutating internal slugs that other logic depends on — `job.sport === 'wc26'` at L14842's bracket-impact check and the 3 catchup/seed/yday literals both keep their original values deliberately, for reasons verified live, not assumed). No new fragmentation is possible going forward, verified via forced tests covering every real write path found (including one — GameDO — the doc itself never cited) plus two genuine live end-to-end tests against the deployed app. Historical data question explicitly decided (backfill) and executed live (521 rows), not left unaddressed.

## Confidence scoring (per doc's own rubric)

- **TASK 0 (30 pts):** found every real write path, including one (GameDO's `src/game-do.js` completion write) never cited in the doc, only surfaced by tracing `/archive/game`'s actual callers beyond `src/index.js`. Correctly distinguished which paths bypass the canonical label entirely (catchup/seed/yday's literal, GameDO's raw slug, the queue consumer, client `/archive/brief`) vs. which apply an unrelated-purpose transform that leaks into the persisted column (`/archive/game`'s KV-capture lowercasing). Re-verified the doc's own 7-day/11-row citation against the full history before trusting it and found the real scope was 12 variants / 521 rows — a materially more complete picture than the doc itself had. **30/30.**
- **TASK 1 (40 pts):** every real write path found now converges on `SOCCER_LEAGUE_LABELS.wc26` at the actual point of persistence, verified live — the doc's underlying goal (single source of truth, no more fragmentation) is fully achieved. But the doc's literal instruction was "not a literal string at each call site," and two real call sites still send their original raw, non-canonical values by design: the 3 catchup/seed/yday sites (reverted back to the `'FIFA World Cup 2026'` literal after finding the live id-collision risk) and `src/game-do.js`'s GameDO completion write (`sport: this.sport` = `'wc26'`, never touched at all — out of scope by choice, to avoid a riskier DO-file edit for this dispatch). Both choices are correct and disclosed, backed by a real, verified safety reason (not laziness), but they are a genuine gap against the rubric's literal wording, not just its spirit — scoring this as a flawless 40/40 would understate that gap. **37/40.**
- **TASK 2 (30 pts):** real forced-condition tests for every write path found; two genuine live end-to-end tests against the deployed app (not just the fix's own logic in isolation) covering both `/archive/game` and `/archive/brief`; confirmed the live in-progress tournament game was undisturbed; confirmed via direct D1 query that fragmentation is fully gone (12 variants → 1) and that `/quality/report`'s calibration system now sees the unified, adequately-sampled WC26 population the doc's CONTEXT says was needed. **30/30.**

**Total: 97/100.**

Score meets the 95 commit threshold — committing this outbox manifest with `[skip ci]`, as instructed.
