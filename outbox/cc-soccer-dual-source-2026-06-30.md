# CC Session — Soccer Stats Dual-Source

**Date:** 2026-06-30
**CC-CMD:** docs/CC-CMD-2026-06-30-soccer-stats-dual-source.md (jubilant-bassoon)
**Repo (code changes):** field-relay-nba
**Channel:** chat (direct execution — see note below)

---

## Note on execution path

This CC-CMD was originally dispatched to a Claude Code session opened against
field-relay-nba. CC correctly identified the doc doesn't exist in that repo
(it lives in jubilant-bassoon per the two-repo separation rule — spec files
live in jubilant-bassoon regardless of target repo) and asked for clarification
rather than fabricating. Rather than re-route through another CC round-trip,
chat executed the CC-CMD directly (same class of relay-only JS edit as the
MLS_STATS_BASE and identity-resolver fixes earlier this session).

**Process gap identified:** the one-liner handed to CC didn't specify the
cross-repo routing (spec in jubilant-bassoon, code target in field-relay-nba).
Future one-liners for cross-repo CC-CMDs should state both explicitly.

---

## Probe 3 Result — CRITICAL DEPENDENCY CHECK

**STOP CONDITION DID NOT TRIGGER.**

Traced all 4 `assembleContext(` call sites in src/index.js:
- Line 4852: backfill path (`game.source_id`, `briefs WHERE game_id` skip-check) — sourceId only, no eventId/espnLeague
- **Line 5949: confirmed as the live cron** — inside `handleJournalismCycle` (starts line 5259)
- Line 8572: per-game backfill brief path — sourceId only, no eventId/espnLeague
- Line 9615: `/journalism/context-probe` debug endpoint — has eventId/espnLeague but is a verification tool, not the live path

`handleJournalismCycle`'s `LEAGUES` array (line 5533) includes
`{sport:'soccer', league:'usa.1', label:'MLS'}` alongside EPL/La Liga/Serie A/
Bundesliga/Ligue 1/WC. `gameMeta.push()` (line 5571) unconditionally sets
`eventId: String(ev.id || '')` and `espnLeague: league` for every game from
every league in this array — no soccer-specific gap, no MLS exclusion.

**Distinction clarified:** the `espn_event_id IS NULL` finding from earlier
this session (regular_season_games D1 column) belongs to a *different*
pipeline — the D1-backed schedule data used for backfill/season-form team-ID
lookups. The live cron fetches fresh from ESPN's scoreboard every cycle and
never depends on that column. These are two genuinely separate paths; the
STOP CONDITION was scoped correctly to the live path, which is clean.

---

## Probes 1, 2, 4, 5, 6 — all matched doc exactly, no drift

Re-verified live before editing: XG_FIELDS/extractXG location (lines
10378-10398), buildSoccerXGContext gate (context-assembler.js:275-337),
`/statistics/` blocked pre-fix (403 confirmed), MLS_STATS_ALLOWED_PREFIXES
state, CONTEXT_SOURCES soccer_xg entry (priority 7, budget 150). Zero
discrepancy from doc assumptions — safe to proceed with patches as specified.

---

## Tasks 1, 2a, 2b, 2c — Shipped

Two commits (GitHub Contents API is single-file-per-commit; both pushed
back-to-back, no gap):
- `ea84747d` — src/index.js: widened `/soccer/xg` extraction
  (XG_FIELDS + new MATCH_FIELDS → `extractStats()`, replaces `extractXG()`),
  `/statistics/` allowlist + TTL, new `/soccer/season-form` route
- `4daaf058` — src/context-assembler.js: `buildSoccerSeasonFormContext`
  builder + CONTEXT_SOURCES entry (priority 8) + export

**Process error caught and fixed:** both commit messages included `[skip ci]`,
copied reflexively from earlier doc-only commits this session. This suppressed
the automatic deploy for actual runtime code changes — caught via direct probe
(`/soccer/season-form` returned the OLD code's generic "Path not allowed" 403,
not the new route's `team_id required` logic) before claiming anything worked.
Fixed by manually dispatching `deploy.yml` via `workflow_dispatch` (confirmed
in the workflow file as a valid trigger independent of `[skip ci]`, which only
suppresses the `push` trigger). Deploy run 28471269377 completed successfully —
all 8 structural gates passed (health, NBA/NHL/FPL/FD whitelist, CORS, WOW 6
journalism e2e, BSD R2 pitch map, silent-build-failure bundle sentinel check).

---

## Task 4 — Verify end-to-end: ALL PASSED (live, post-deploy)

```
1. /soccer/xg?league=usa.1&event=761644
   _hasXG: False | _hasMatchStats: True
   home (St. Louis CITY SC): possession 46.7%, 16 shots, 6 on target, 458 passes
   away (Austin FC): possession 53.3%, 8 shots, 2 on target, 523 passes
   → MLS games that previously got ZERO soccer context (hard-gated on xG,
     which MLS doesn't have) now get real per-match context.

2. /soccer/season-form?team_id=MLS-CLU-000008 (Inter Miami CF)
   _hasForm: true, matches_played: 15, xG: 34.484, xG_efficiency: 4.516,
   goals: 39, clean_sheets: 3, possession_ratio: 56.29, conversion rates present

3. /mls/stats/statistics/clubs/competitions/MLS-COM-000001/seasons/MLS-SEA-0001KA
   200 (was 403 pre-fix)
```

**Task 3 note:** field-relay-nba has no smoke.js (confirmed 404) — the four
A-SOCCER-DUAL assertions in the doc were a spec/comment block, not literal
code for a file that doesn't exist in this repo. All four conditions verified
directly instead: _hasMatchStats present ✅, season-form numeric xG ✅,
/statistics/ 200 ✅, CONTEXT_SOURCES soccer_season_form entry confirmed via
direct grep on live-pulled source (line 890, exact match) ✅.

---

## Known gap carried forward (Task 2c, documented not solved per CC-CMD scope)

`buildSoccerSeasonFormContext` returns `''` for every game today —
`game.mlsHomeTeamId`/`game.mlsAwayTeamId` don't exist on any game object yet.
A follow-up CC-CMD is needed: extend `identity-resolver.js` (already expanded
to all 30 MLS clubs by name this session) with a parallel name → `MLS-CLU-
xxxxxx` ID mapping, then wire it into the `gameMeta` construction at line
5571 (same call site confirmed clean for Probe 3) so soccer games carry both
ESPN's numeric id (already working) and stats-api's club id (needed for this
builder to ever fire). Out of scope here — needs its own spec per the
original CC-CMD's explicit DO NOT list.

---

## Final state

field-relay-nba HEAD: 4daaf05807b1cf44c51165fb9c633fcd4acb0a1b
Deploy: confirmed live, all structural gates passed
