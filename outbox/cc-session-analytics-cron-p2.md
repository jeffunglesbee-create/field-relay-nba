# CC Session — Analytics Cron Engine, Prompt 2 (Morning Intelligence)

**Date**: 2026-06-20
**Repo**: field-relay-nba
**Branch**: claude/zealous-brahmagupta-tm92w3 → merged to main
**Session lead**: Claude Sonnet 4.6
**Spec**: Drive doc "FIELD — Analytics Cron Engine Spec (June 20 2026)"

## HEAD progression

| SHA | Subject |
|---|---|
| 345b1d9 | (pre) Merge analytics cron engine — Prompt 1 foundation |
| 9c29d6c | fix(analytics): Phase 11 KV status always written |
| a95d240 | feat(analytics): Phases 3/5/9 — Truth Is + Morning Report + FIELD's Pick |
| 4ac490b | chore(analytics): record phase11 in phases_completed status array |

3 commits to dev branch, all fast-forwarded to main.

Smoke delta: `src/analytics-engine.js` 289 → 720 lines (+431).
No other files touched beyond the small `/analytics/run` GET expansion
in `src/index.js` (commit 1).

## Per-commit summary

### 9c29d6c — Phase 11 KV fix

**Root cause analysis**: two latent failure modes in processDate could
leave `field:analytics:status` empty after a successful run:

1. An unexpected throw inside processDate (past the inner phase try/catch
   wrappers) would skip the writeRunStatus call entirely.
2. The "up-to-date" short-circuit in `analyticsEngine` returned before any
   status write, so a re-run for a date already in `analytics_runs` left
   KV at its previous value (or unset on the very first re-run scenario).

**Fix**:
- processDate wraps all phase bodies in a `try { ... } finally { ... }`
  with writeRunStatus inside the finally — Phase 11 ALWAYS runs.
- Added an `aiCallsMade` accumulator so the status record surfaces AI
  cost per run (used by Phases 3/5/9).
- The "up-to-date" branch in analyticsEngine now writes a fresh status
  row tagged `skipped: "up-to-date"` so every invocation refreshes
  /analytics/status.
- Expanded `/analytics/run` to accept GET `?date=YYYY-MM-DD` in addition
  to POST `{date}`, enabling sandbox verification via `probe_relay_route`
  (which cannot POST to *.workers.dev).

### a95d240 — Phases 3/5/9 morning intelligence layer

Adds three nightly features driven by `field-claude-proxy` (Gemini Flash
Lite primary, Haiku 4.5 fallback). Max 3 AI calls per run (graceful
fallbacks elide calls when there's nothing to write about).

**Phase 3 — The Truth Is** (rule-based anomaly detection)
- Inputs: `ctx.games.regular[]` + `ctx.games.postseason[]` (from Phase 1)
- Detection priorities:
  1. Upsets — winner closing ML ≥ +200 (rarity = 0.5 + ml/800, capped 0.95)
  2. Blowouts — margin ≥ sport-tuned threshold (NBA/WNBA 25, MLB 8, NHL 5,
     soccer 4)
  3. Rare events — walkoff / shutout / hat-trick / no-hitter regex over
     `game.note + game.drama_arc`
  4. Convergence — 3+ unusual on one night promotes the leader (rarity +0.1)
- Picks highest `rarity_score`; AI call generates the v4-voiced one-liner
- Quiet-night fallback: no AI call, fixed copy

**Phase 5 — Morning Report**
- Synthesises Phase 2 stars + Phase 3 truth + top 16 game recaps
- Prompt explicitly omits Jinx Counter (Phase 4 not built) and FIELD's
  Pick (yesterday's pick won't exist) per spec instruction
- Single AI call, max_tokens 250 (target paragraph: 80-120 words)
- Writes KV `field:morning_report:{date}` 48h TTL + analytics_output row

**Phase 9 — FIELD's Pick** (TODAY, not yesterday)
- Self-fetches `/v2/games?sport=<X>&date=<today>` for nba, nhl, mlb,
  wnba, wc26 (curated to limit api-sports spend)
- Scoring: playoff/elim +3, rivalry +1, tight line <3 +2, prime time
  (UTC 23-02) +1, national broadcast (ABC/ESPN/TNT/FOX/NBC/CBS/TBS/
  Apple/Amazon regex on streams) +0.5
- Top score ≤ 3 → pass-through line, no AI call
- No games today → skip entirely, no spend
- KV `field:pick:{today}` 48h TTL + analytics_output row with date=TODAY

All three phases independently try/catch wrapped; failure in one never
blocks others.

callProxy helper is a verbatim copy of the existing pattern at
src/index.js:4375 (handleJournalismCycle): POST to JOURNALISM_CLAUDE_PROXY
with `X-FIELD-Relay: field-relay-cron-2026` header, Anthropic-shaped
request body. No cf caching (POST is non-cacheable).

### 4ac490b — phase11 in phases_completed

Phase 11 was being pushed AFTER the status object serialized, so it
never appeared in the stored array. Moved the push earlier — the write
IS phase 11, so by the time the array is durable, the phase is done.

## End-to-end verification

All probes via `probe_relay_route` (sandbox cannot reach *.workers.dev
directly; `/analytics` was added to ALLOWED_PREFIX in Prompt 1).

### Phase 11 fix
```
GET /analytics/status (after delete + re-trigger)
→ {"ok":true,"status":{"last_run":"2026-06-20T23:05:50.820Z",
                       "phases_completed":["phase0","phase11"],
                       "skipped":"up-to-date", ...}}
```
PASS. KV no longer null; up-to-date branch writes status.

### Full processDate run (DELETE + re-trigger)
```
GET /analytics/run?date=2026-06-19
→ {"triggered":"analytics-engine","result":{"ok":true,"target":"2026-06-19",
   "processed":[{"date":"2026-06-19","ok":true,"features":4,"ms":2758}]}}
```

```
GET /analytics/status
→ phases_completed: ["phase0","phase1","phase2","phase3","phase5","phase9"]
                    (phase11 cosmetic added in 4ac490b)
   features_computed: 4
   ai_calls_made: 1 (only Phase 5 fired — see AI audit)
   duration_ms: 2758
   errors: ["phase1[1]: odds_history: D1_ERROR: no such table"]
   phases_failed: []
```

### Per-feature verification

| Feature | Endpoint | Result |
|---|---|---|
| night_stars | `/analytics/night_stars/2026-06-19` | 1/5 stars, totalGames=0 (degraded mode) |
| truth_is | `/analytics/truth_is/2026-06-19` | type=none, "Quiet night. The truth is, sometimes that's the story." |
| morning_report | `/analytics/morning_report/2026-06-19` | 113-word paragraph from AI (preview: "The truth is, sometimes a quiet night is the perfect canvas...") |
| field_pick | `/analytics/field_pick/2026-06-20` | type=pass, top score 1.0 ≤ 3.0 threshold → "Not every night has a must-watch." |

## AI call audit

| Phase | Called proxy? | Model requested | Reason |
|---|---|---|---|
| Phase 3 (Truth Is) | NO | n/a | Anomaly detector returned no findings (quiet night) → fixed-copy fallback |
| Phase 5 (Morning Report) | YES | claude-haiku-4-5-20251001 (proxy may route to Gemini Flash Lite) | Always runs when reachable |
| Phase 9 (FIELD's Pick) | NO | n/a | Top candidate scored 1.0 ≤ 3.0 threshold → pass-through |

Total AI calls this run: **1** (out of max 3). On a busy night with
upsets/walkoffs/prime-time games, all 3 would fire. This is correct
graceful behavior — no API spend when there's nothing to say.

## CI note

Deploy run 27886555167 (Phase 11 fix, `9c29d6c`) was marked **failure**
by CI but the worker DID deploy (step 6 success). The failing step was
`STRUCTURAL 6 — WOW 6 /journalism/generate e2e` (step 19) — curl exit
code 28, hit the `--max-time 20` ceiling. The /journalism/generate
flow includes the quality chain (up to 6 retries via proxy), so 20s
is tight under proxy contention. Pre-existing flake, unrelated to the
Phase 11 fix (which doesn't touch /journalism/generate). The Phases
3/5/9 deploy (a95d240) re-ran the same test and passed.

## Carry-forwards for Prompt 3

1. **CI flake on STRUCTURAL 6**: the `/journalism/generate` e2e curl
   timeout (`--max-time 20`) is tight for the full quality-chain round
   trip under proxy contention. Consider raising to 45s in
   `.github/workflows/deploy.yml`. NOT done in this session because it
   touches CI config beyond the analytics scope.

2. **odds_history table not yet bootstrapped**: Phase 1 logs the error
   gracefully (Promise.allSettled catches it; no impact on phases 2-9).
   The odds-backfill workflow creates the table on first scheduled run
   (next: 10:00 UTC daily). After that fires once, the error disappears.

3. **Phase 3 anomaly thresholds are static**. Blowout thresholds are
   sport-typed but not data-driven; +200 ML upset cutoff is conservative.
   Prompt 3 (Phase 4 Jinx Counter + Phase 7 Streak Board?) can feed
   historical rarity percentiles back through `prevStars`/`prevBriefs`
   already loaded in Phase 1.

4. **Phase 9 spread parsing**: `closing_odds` JSON shape varies by
   provider. Current code reads `odds.spread?.home / .away / .line` —
   not all providers populate this; on those, the "tight line +2" bonus
   never fires. When the odds-history backfill matures, audit the shape
   distribution and normalise.

5. **Phase 9 today-data dependency**: relies on /v2/games returning
   today's slate. If api-sports is rate-limited at the cron tick (5 AM
   ET = 9:00 UTC), the schedule fetch may return empty → Phase 9 skips.
   Could add a retry-with-backoff, but per Rule 78 that risks burning
   the api-sports quota.

6. **Morning Report prompt template**: omits Jinx Counter (Phase 4) and
   yesterday's FIELD's Pick accuracy (Phase 9 retro). When Prompts 3-4
   add those features, extend the prompt — but a fresh Day-0 Morning
   Report tomorrow will already include a yesterday-pick reference once
   data exists (today's pick → tomorrow's report).

7. **phases_completed semantics**: with the 4ac490b fix, phase11 is now
   pushed BEFORE the write completes. If writeRunStatus throws AFTER
   marking phase11 in the array, the OUTER catch logs but the in-memory
   array still claims phase11 (the array was already serialized in the
   thrown attempt). This is a paper inconsistency — the actual KV/D1
   write either happened or didn't, and the log message indicates which.

## Files touched

- `src/analytics-engine.js` (+431 lines net across 3 commits)
- `src/index.js` (+10 lines: /analytics/run GET expansion)
- `outbox/cc-session-analytics-cron-p2.md` (this doc)

## Rules touched

- **Rule 77 (PRIME DIRECTIVE / NO-RATIONALIZE-A)**: when CI step 19
  failed on deploy `9c29d6c`, pulled the job log before deciding it
  was unrelated. Diagnosed curl exit code 28 + 20s timeout, confirmed
  /journalism/generate code path is untouched by the Phase 11 fix.
- **Rule 47 / ADR-002 (RELAY-IS-DUMB)**: all three new phases store
  facts (anomalies, recap synthesis, candidate game). The browser/MCP
  consumer decides how to render or whether to surface.
- **Rule 5 (archive failure must not break primaries)**: each phase
  is try/catch wrapped; writeRunStatus runs in a finally; KV writes
  inside Phase 5/9 are individually try/caught so a KV outage doesn't
  fail the D1 write.
- **Rule 62 (follow existing conventions)**: callProxy is a verbatim
  copy of the handleJournalismCycle proxy pattern — same URL, headers,
  body shape, model field, error-treatment.
- **Rule 78 (API-COST-A)**: Phase 9 self-fetches /v2/games with
  `cf: { cacheTtl: 60, cacheEverything: true }`. Top-score gate (3.0)
  + skipped-when-empty path avoid AI calls when the slate doesn't
  warrant a recommendation.
- **Rule 79 (PROMPT-HEAD-A)**: pre-build probes confirmed schemas
  before writing code that reads from them (briefs, postseason_games,
  regular_season_games, /v2/games handler).
