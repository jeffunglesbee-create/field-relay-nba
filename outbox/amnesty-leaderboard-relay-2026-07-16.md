# Amnesty Leaderboard Relay — field-relay-nba
**Date executed:** 2026-07-20
**CC-CMD:** docs/CC-CMD-2026-07-16-amnesty-leaderboard-relay.md
**HEAD start:** a8e3b0e
**HEAD end:** eb1e1bb
**Commit:** eb1e1bb — feat: add /archive/drama/leaderboard and /archive/drama/percentile endpoints

---

## TASK 1 — D1 Schema Probe ✅ VERIFIED

Database: `field-archive` (uuid `cc49101c-0569-4d41-8e7a-be139cde4f26`)

### Tables confirmed
- `regular_season_games` — columns: `id TEXT PK`, `sport TEXT`, `league TEXT`, `date TEXT`, `home`, `away`, `home_score`, `away_score`, `venue`, `streams`, `note`, `tags`, `crew`, `local_note`, `created_at`, `opening_odds TEXT`, `closing_odds TEXT`, **`drama_peak REAL`**, **`drama_arc TEXT`**, `espn_event_id TEXT`, `went_to_ot INTEGER`, `finalized_at TEXT`
- `postseason_games` — same columns plus: `series_key TEXT`, `round TEXT`, `game_number INTEGER`

No `source_id` column — CC-CMD mentioned it as a potential name, real PK is `id`. Write path uses `id` for row lookup.

### Per-sport drama coverage (queried live 2026-07-20)

**regular_season_games:**
| sport | total | with_drama | drama range |
|-------|-------|-----------|-------------|
| MLB | 379 | 376 | 0–74 |
| AFL | 138 | 138 | 0–74 |
| FIFA World Cup | 109 | 108 | 52–81 |
| WNBA | 103 | 88 | 0–74 |
| EPL | 26 | 26 | 52–70 |
| golf | 28 | 28 | 0–0 (all zeros — drama scoring not active for golf) |
| MLS | 462 | 10 | 52–78 (SPARSE) |
| PGA Tour | 8 | 8 | 0–0 (all zeros) |

**postseason_games:**
| sport | total | with_drama |
|-------|-------|-----------|
| NBA | 15 | 7 (SPARSE) |
| MLS | 288 | 0 |
| NHL | 15 | 0 |

### Cross-sport comparability
Drama scores are client-computed on the same 0–100 scale regardless of sport. However, golf/PGA Tour entries all have drama_peak=0 — drama pipeline either not active for golf or golf games scored before the pipeline was wired. Cross-sport comparison is technically valid on the scale but practically misleading if golf is always 0.

### Season boundary
No explicit season year column. `date TEXT` (YYYY-MM-DD) used. All drama-scored data is 2026. Leaderboard uses `strftime('%Y', date) = currentYear` for scoping.

---

## TASK 2 — /archive/drama/leaderboard ✅ VERIFIED LIVE

Route: `GET /archive/drama/leaderboard?sport=X&limit=N`

- Combines `regular_season_games` + `postseason_games`, current year only
- Sorted by `drama_peak DESC`, sliced to `limit` (max 50, default 10)
- Returns: `{ ok, sport, season, limit, games[] }` where each game has `id, sport, date, home, away, home_score, away_score, drama_peak, drama_arc, game_type`
- Cache: `public, max-age=300`

**Live probe (2026-07-20):**
```
GET /archive/drama/leaderboard?sport=MLB&limit=5
→ ok:true, sport:MLB, season:2026, 5 games all drama_peak:74
  Top: Baltimore Orioles 9 – Tampa Bay Rays 7 (2026-05-25) ✓

GET /archive/drama/leaderboard?sport=AFL&limit=3
→ ok:true, sport:AFL, season:2026
  #1: Collingwood 93 – Hawthorn 93 (tie!), drama_peak:74 ✓
  #2/#3: drama_peak:65 ✓
```

---

## TASK 3 — /archive/drama/percentile ✅ VERIFIED LIVE

Route: `GET /archive/drama/percentile?sport=X&score=N`

- Queries both tables across all time (all years) for maximum sample
- Sparse threshold: `< 20` rows → returns `{ ok, sport, score, percentile:null, sparse:true, sample_size, note }`
- Dense: returns `{ ok, sport, score, percentile (0–100.0), sample_size }`
- Cache: `public, max-age=300`

**Live probes (2026-07-20):**
```
GET /archive/drama/percentile?sport=MLB&score=70
→ { ok:true, score:70, percentile:92.8, sample_size:376 }
D1 direct: 349/376 = 92.819...% → 92.8% ✓

GET /archive/drama/percentile?sport=AFL&score=60
→ { ok:true, score:60, percentile:84.8, sample_size:138 }
D1 direct: 117/138 = 84.782...% → 84.8% ✓

GET /archive/drama/percentile?sport=MLS&score=70
→ { ok:true, percentile:null, sparse:true, sample_size:10,
    note:"Only 10 scored games for MLS — insufficient for a meaningful percentile (need ≥20)" } ✓
```

---

## TASK 4 — Verification ✅ COMPLETE

| Check | Result |
|-------|--------|
| MLB leaderboard live | ✓ top 5 drama_peak:74, correct teams/dates |
| AFL leaderboard live | ✓ Collingwood–Hawthorn tie at top |
| MLB percentile hand-math | ✓ 349/376 = 92.8% |
| AFL percentile hand-math | ✓ 117/138 = 84.8% |
| MLS sparse correctly reported | ✓ sample_size:10, percentile:null |
| Routes in MCP allow-list | ✓ added alongside commit |
| ADR-002 compliance | ✓ relay reads stored facts only; no drama computation |

## Sparse data findings (honest disclosure)
- MLS regular: 10 drama-scored / 462 total — percentile returns sparse, leaderboard returns only 10 games (many from 2026-03 — may be incomplete)
- NBA postseason: 7 drama-scored — percentile returns sparse
- NHL postseason: 0 drama-scored
- golf / PGA Tour: all drama_peak = 0 — percentile numerically valid but misleading

## Confidence score
- TASK 1 (30 pts): real D1 schema, not assumed. All column names confirmed. Sparse cases identified. 30/30
- TASK 2 (25 pts): leaderboard live, correct rankings, year-scoped, follows existing route conventions. 25/25
- TASK 3 (25 pts): percentile live, hand-checked math for 2 sports, sparse cases correctly handled. 25/25
- TASK 4 (20 pts): live verification with direct D1 cross-check for 2 sports. 20/20
**Total: 100/100**
