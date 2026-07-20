# FIELD Relay — HANDOFF

## SESSION CLOSE-OUT — 2026-07-20 (amnesty-leaderboard-relay)

**HEAD:** eb1e1bb
**Branch:** main
**Session doc:** outbox/amnesty-leaderboard-relay-2026-07-16.md

### Commits this session
- eb1e1bb — feat: add /archive/drama/leaderboard and /archive/drama/percentile endpoints

### Verified live
- `/archive/drama/leaderboard?sport=MLB&limit=5` — top 5 MLB games by drama_peak, all 74
- `/archive/drama/leaderboard?sport=AFL&limit=3` — Collingwood–Hawthorn 93-93 tie at #1
- `/archive/drama/percentile?sport=MLB&score=70` — 92.8% (hand-checked: 349/376)
- `/archive/drama/percentile?sport=AFL&score=60` — 84.8% (hand-checked: 117/138)
- `/archive/drama/percentile?sport=MLS&score=70` — sparse:true, sample_size:10 ✓

### Carry-forwards
- None from this session. MCP allow-list updated in same commit.

### Pre-existing failures (not caused by this session)
- `post-deploy-live-verify.yml` — failing since before 30746bd; pre-existing

---

## SESSION CLOSE-OUT — 2026-07-20 (MLS novel metrics)

**HEAD:** bcfd579
**Branch:** main
**Session doc:** outbox/cc-session-2026-07-20-mls-novel-metrics.md

### Commits this session
- 2e09fc0 — feat: add /mls/stats/team-metrics route for season-aggregate novel metrics
- bcfd579 — feat: extend /soccer/xg with accurateCrosses and crossAccuracy

### Verified live
- `/mls/stats/team-metrics` — 30 MLS teams with secondAssistShare, insideBoxShotShare, counterAttacksPerGame, shotBodyPartSplit
- `/soccer/xg` — now includes accurateCrosses + crossAccuracy (verified hand-math)

### Carry-forwards
- **CLIENT TASK 3 (jubilant-bassoon)** — Wire `/mls/stats/team-metrics` into `renderStatsSection()` MLS block. See CC-CMD-2026-07-19-mls-novel-metrics.md TASK 3 for full spec. Sequencing note: check whether sibling CC-CMDs (mls-sub-impact-metric Task 4, bottom-sheet-stats-reconciliation Task 1) have already modified `renderStatsSection()` before starting.

### Pre-existing failures (not caused by this session)
- `post-deploy-live-verify.yml` — failing since before 30746bd; pre-existing, unrelated to novel metrics work

---

## Prior state (from 2026-07-20 mls-journalism-xg-fix audit)

HEAD before this session: 12e3f0c
Session doc: outbox/cc-session-2026-07-20-mls-journalism-xg-fix.md
Result: No code change needed — MLS xG journalism path already wired correctly.
