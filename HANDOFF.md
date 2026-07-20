# FIELD Relay — HANDOFF

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
