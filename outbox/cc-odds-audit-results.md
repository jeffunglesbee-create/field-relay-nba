# Odds API Quota Audit — Diagnosis Results

**Date:** 2026-06-16
**Spec:** docs/CC-CMD-2026-06-16-odds-quota-audit.md
**Quota at start:** 19,999 / 20,000 (effectively exhausted; next reset June 19)
**Commit base:** post-`a1c4d74` (the snapshotCronOdds + odds-backfill commits from earlier today)

---

## D1 — Credit consumption audit

### Every `fetch()` to `api.the-odds-api.com` in the codebase

| # | Site | File:Line | Endpoint | cf cacheTtl | cacheEverything | Cost / call |
|---|------|-----------|----------|-------------|------------------|-------------|
| 1 | `_fetchLiveOdds()` | `src/ambient-do.js:417` | `/v4/sports/{key}/odds-live` | **20 s** | ✅ | 1 credit |
| 2 | `getWCPregameLambdas()` | `src/index.js:823` | `/v4/sports/soccer_fifa_world_cup/odds` | 300 s | ✅ | 2 credits (markets=h2h,totals) |
| 3 | `handleWCOddsProbs()` | `src/index.js:1509` | `/v4/sports/soccer_fifa_world_cup/odds` | 300 s | ✅ | 2 credits |
| 4 | `handleCFLOddsProbs()` | `src/index.js:1617` | `/v4/sports/americanfootball_cfl/odds` | 300 s | ✅ | 3 credits (h2h,spreads,totals) |
| 5 | `handleWCWPVerify()` | `src/index.js:1684` | `/v4/sports` (sports list) | 3600 s | ✅ | 0 credits (list endpoint is free) |
| 6 | **`fetchSportOddsLive()`** ⚠️ | `src/index.js:3007` | `/v4/sports/{key}/odds` | 300 s | **❌ MISSING** | 3 credits |
| 7 | **`fetchSportOddsHistorical()`** ⚠️ | `src/index.js:3083` | `/v4/historical/sports/{key}/odds` | 86400 s | **❌ MISSING** | **10–30 credits** (historical 10× cost × N markets) |
| 8 | `/odds/*` proxy (`relayFetch`) | `src/index.js:5037` | passthrough | per-path (3600 s default) | ✅ | varies |

### Callers of each fetch

- **`_fetchLiveOdds()`** — called by `_poll()` at `src/ambient-do.js:373` **every poll cycle** whenever `totalLive > 0` and `ODDS_API_KEY` is set. NOT gated by score-change. Per-sport throttling via `_oddsLastFetch[sport]` cooldown.
- **`snapshotCronOdds()` → `fetchSportOddsLive`** — called by `handleJournalismCycle` on every cron tick during live hours (`*/15 * * * *`). One call per sport that has at least one archive row with `opening_odds IS NULL` on today's date.
- **`runOddsBackfillForDate()` → `fetchSportOddsHistorical`** — called by:
  - `GET /archive/odds-backfill?date=…` (manual)
  - The dead-hour journalism cron (UTC 2:00–10:00) via `pickNextOddsBackfillDate` — **runs every 15 min independently of brief backfill**.
- **`getWCPregameLambdas()`** — called from `handleV2Games` for `sport === 'wc26'` (every `/v2/games?sport=wc26` request). Has its own module-level 5-min `_wcLambdaCache`. Effective rate: 1 fetch / 5 min as long as a request flows through.
- **`handleWCOddsProbs()`** — `GET /wc/odds-probs` from the browser. Cached upstream + at edge.
- **`handleCFLOddsProbs()`** — `GET /cfl/odds-probs`.
- **`handleWCWPVerify()`** — `GET /wc/wp/verify` diagnostic (sports list — 0-cost endpoint).

### Cooldown enforcement

`src/ambient-do.js:580 _getOddsCooldown()` returns:
- **high** = 30 s (WC knockout, NBA/NHL Finals)
- **medium** = 60 s (default — WC group stage, regular season)
- **low** = 180 s (MLS, WNBA)

Cooldowns are **stored only in-memory** (`this._oddsLastFetch = {}` at line 133). **NOT persisted to DO storage**. Every DO cold-start resets cooldowns to zero → first poll after restart can burn one credit per live sport at once. This is recoverable but is a non-zero loss on each isolate cycle.

### Poll cadence

- `POLL_LIVE_MS = 15_000` (`src/ambient-do.js:56`) — live games → poll every 15 s.
- `POLL_IDLE_MS = 60_000` — no live games → poll every 60 s.
- `alarm()` always calls `_poll()` and reschedules.
- `_poll()` calls `_fetchLiveOdds()` **every cycle** when live games exist (gated only by `totalLive > 0 && ODDS_API_KEY`, then per-sport cooldown inside).

### Other callers checked

- ✅ `wc-tournament-projections.js` — no odds calls.
- ✅ `game-do.js` — no odds calls (final-state archive hook uses internal POST only).
- ✅ `bracket-do.js`, `user-do.js`, `soccer-wp.js`, `finals-context.js`, `mcp-oauth.js` — no odds calls.
- ✅ Dead-hour cron — **does call odds backfill** via `runOddsBackfillForDate(env, pickNextOddsBackfillDate(env))` (see leak below).

---

## D2 — Estimated actual vs budgeted consumption

### Per-call rates

**AmbientDO** (`_fetchLiveOdds`)
- Cache TTL = 20 s; cooldown floor = 30 s. **Cache always cold when cooldown unblocks** → CF cache is structurally useless for this path.
- WC group stage = medium tier (60 s cooldown). 1 WC sport active during typical WC kickoff windows:
  - 60 calls/hr/sport × 1 credit = **60 credits/hr/sport**
  - Active live window ≈ 6 hr/day (group-stage kickoffs span ~16:00–01:00 UTC, ≤ ~6 hr concurrent live):
  - 60 × 6 × 30 = **10,800 credits/month — WC alone, _fetchLiveOdds**

Add NBA/NHL Finals window (high tier, 30 s cooldown) for the days both leagues are live concurrently in June:
- 120 calls/hr × 4 hr × 14 days = ~6,720 credits in June alone.

**`snapshotCronOdds` (June 16 — me)**
- Runs once per 15-min cron tick during live hours (~16 hr / day).
- Per cron tick: one fetch per sport that still has at least one `opening_odds IS NULL` row for today's date.
- **NO `cacheEverything: true`** → every call hits upstream.
- Persistent unmatched team-name rows (e.g. WNBA "Washington Mystics" vs Odds API's variant) keep the sport in NULL state indefinitely → 64 calls/day/sport that never converges.
- 64 × 3 credits × N persistently-mismatched sports × 30 days = ≥ ~5,760/mo if just one sport stays unmatched.

**`runOddsBackfillForDate` from dead-hour cron (June 16 — me)**
- 32 dead-hour ticks/day × 1 date × N sports per date × **10 credits per historical call** (1 sport-call covers 1 date in the historical endpoint).
- 5 archive dates × 3 sports × 10 credits = ~150 credits per dead-hour cycle if it walks fresh dates.
- **NO `cacheEverything: true`** on historical fetch → no edge caching at all.
- If the SAME date with persistent unmatched names keeps being picked, dead-hour cron burns ~30 credits/tick × 32 ticks = **~960 credits/day on a single un-finishable date**. Over 28 days the leak alone = ~26,880 credits — easily explains the burn from ~7,000 (this morning 02:00 UTC) to 19,999.

### Match to observed burn

- Quota at 02:00 UTC (this morning, post-deploy `a1c4d74`): 7,093 remaining (≈ 12,907 used)
- Quota at 20:30 UTC (now, ~18.5 hr later): 19,999 used
- Burn in 18.5 hr: **~7,092 credits**
- That is consistent with the cron paths above firing uncached + a never-converging backfill date (~250 credits/hr sustained).

### Comparison to June-14 spec budget

- June 14 spec projected ≤ 10,680 credits/month at full load with cooldowns AND caching working.
- The dominant excess is the **uncached new snapshot/backfill helpers I added at `a1c4d74` this morning**. The pre-`a1c4d74` system had been running for 28 days under budget; the spike started today.

---

## D3 — Edge cache verification

| Site | Issue | Effect |
|------|-------|--------|
| `_fetchLiveOdds` | `cacheTtl: 20` < cooldown floor (30 s) | Cache always cold when the next call is allowed — caching adds no value |
| `fetchSportOddsLive` (NEW) | Missing `cacheEverything: true` | Upstream `Cache-Control: private` defeats Workers cache → **uncached** |
| `fetchSportOddsHistorical` (NEW) | Missing `cacheEverything: true` | Same — historical calls (10× cost) hit upstream every time |
| `getWCPregameLambdas` / `handleWCOddsProbs` / `handleCFLOddsProbs` / `/odds/*` | Have `cacheEverything: true` | Correctly cached |

No POST traffic anywhere — all GETs.

---

## Root cause summary

Two new helpers landed in commit `a1c4d74` (today, 01:54 UTC):

1. **`fetchSportOddsLive`** (`src/index.js:3003`) — missing `cacheEverything: true` AND short cf TTL relative to its cron cadence.
2. **`fetchSportOddsHistorical`** (`src/index.js:3074`) — missing `cacheEverything: true` AND used by a **dead-hour cron that picks the same date again and again** whenever team-name normalization misses any row in that date. Each repeat costs ~10× standard credits.

Pre-existing contributing issues:

3. **AmbientDO cache TTL (20 s) is shorter than the cooldown floor (30 s)** — cache never serves a hit. Burning ~10,800 credits/month for WC alone.
4. **No global credit guard** — the system has no circuit breaker. Once the leak started, nothing stopped it before quota exhaustion.

Burn timeline matches: pre-`a1c4d74` was within budget; post-`a1c4d74` burns ~7K credits in ~19 hr.

---

## Planned fixes

- **F1** — KV-backed monthly credit guard (`odds:credits:YYYY-MM`) wrapping every odds-API call; hard stop at 18 K (2 K buffer). Per-threshold (50/75/90 %) warn-once logging.
- **F2** — Root-cause patches:
  - Add `cacheEverything: true` + bump TTL (≥ 900 s) on `fetchSportOddsLive`.
  - Add `cacheEverything: true` + 24 h TTL on `fetchSportOddsHistorical`.
  - Bump `_fetchLiveOdds` cf TTL ≥ medium-tier cooldown (60 s).
  - Track failed/converged dates in KV `odds:backfill:tried:{date}` so the dead-hour cron skips dates with no further progress to make.
- **F3** — Starter-key fallback via `env.ODDS_API_KEY_FALLBACK` (Cloudflare dashboard var). On 401/429 from the primary key, retry once with the fallback for WC-only / live-only paths. Replace the hard-coded fallback constant (`de44fdf870b3a4b5ee9d46993b2e1038` — the already-exhausted key).
