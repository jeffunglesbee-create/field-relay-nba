# CC-CMD: Signature-event detection — known-dates calendar + missing-entry alert — outbox

**Date:** 2026-07-14
**Doc:** docs/CC-CMD-2026-07-14-signature-event-detection.md
**Commit:** 7caee16 (feat: signature-event known-dates calendar + missing-entry detection)
**Deploy:** run 29371859915, conclusion success

## TASK 0 — Probe (real, current mechanisms confirmed, none invented)

- `SIGNATURE_EVENTS` (`src/analytics-engine.js`) confirmed at its real current shape — one entry, `'2026-07-13'`, matching the shipping CC-CMD from earlier tonight.
- Confirmed the real daily-sweep cron pattern the doc referenced: `wrangler.toml`'s real cron list (`*/5 * * * *`, `*/15 * * * *`, `0 9 * * *`, `0 * * * *`), then traced `runDegradedPhaseSweep`'s real call site — it fires inside `scheduled()`'s `if (event.cron === '0 9 * * *')` branch, alongside `analyticsEngine(env)`. This is the exact, real, "same one PURE_FEATURES self-heals against" trigger the doc named.
- Found the real, existing codex/incident alerting mechanism rather than inventing a new one: `checkIncidentThresholds` (hourly `0 * * * *` watcher) and, more directly relevant, the `open_incidents` query already live inside the `/mcp` `session_health` handler (`src/index.js:13666-13674`) — `SELECT key, title FROM codex WHERE category = 'incident' AND (status IS NULL OR status != 'resolved')`. Writing a `codex` row with `category='incident'` automatically surfaces through this existing, already-used-tonight read path — no new alerting surface was built.
- Confirmed the real `codex` table schema live against production (`PRAGMA table_info(codex)`): `key` (PK), `category`/`title`/`content` (NOT NULL), `drive_refs`, `created_at`, `updated_at`, `status` (DEFAULT `'open'`) — matches the code written exactly.

## TASK 1 — Known-dates calendar (real, source-verified, narrow)

Added `KNOWN_SIGNATURE_EVENT_DATES` with exactly **one** entry: `{ date: '2026-07-13', label: 'Home Run Derby' }`. Verified via a fresh, independent `WebSearch` (not reused from memory or an earlier session's own internal check): mlb.com, espn.com, and foxsports.com all confirm the 2026 Home Run Derby was July 13, 2026, at Citizens Bank Park — Jordan Walker defeated Kyle Schwarber. This matches `SIGNATURE_EVENTS['2026-07-13']` exactly. Started narrow per the doc's own instruction — no other 2026 signature events were added since none are independently confirmed.

## TASK 2 — Daily detection + alert (reuses existing mechanism, self-heals)

`checkSignatureEventCalendar(env)` (`src/analytics-engine.js`), wired into the existing `0 9 * * *` cron branch in `src/index.js`, same `ctx.waitUntil(...).catch(...)` isolation pattern as its sibling calls (`analyticsEngine`, `runDegradedPhaseSweep`) — one phase's failure never blocks another. For every known date that has passed: if `SIGNATURE_EVENTS[date]` is missing, opens (or keeps open) a `codex` row (`key: signature-event-missing/{date}`, `category: 'incident'`, `status: 'open'`) — this is the real, established incident mechanism, not a new one. If the entry is present, resolves any previously-open incident for that date (`status: 'resolved'`) — an explicit self-heal, since `codex` has no implicit recompute-and-overwrite path the way `analytics_output` does for `PURE_FEATURES`.

## TASK 3 — Verify

- `node --check src/analytics-engine.js` (and `src/index.js`): clean.
- Real forced-condition tests, run against the **actual exported production function** (via a legitimate `datesOverride` testability parameter, not a parallel reimplementation), using an in-memory D1-shaped mock matching the real, live-verified `codex` schema:
  - **Missing, past**: `{date:'2026-01-01', label:'Test Missing Event'}` → `opened:1`, incident row `status:'open'`. ✓
  - **Present, past (real date)**: `{date:'2026-07-13', label:'Home Run Derby'}` (the real entry) → `opened:0, resolved:0`, no incident row created. ✓
  - **Present, self-heal**: same real date, but a stale `status:'open'` row pre-seeded → `resolved:1`, row transitions to `status:'resolved'`. ✓ (exceeds the doc's ask — proves the self-heal transition explicitly, not just its absence)
  - **Future**: `{date:'2026-12-25', label:'Test Future Event'}` → `checked:0, opened:0`, no row at all (skipped entirely, not due yet). ✓
- Confirmed zero effect on Night Stars' own scoring: reviewed the full diff — `computeNightStars`, `computeSignatureEventScore`, `SIGNATURE_EVENTS`, `recomputeNightStars`, and `processDate`'s Phase 2 call site are entirely untouched. The change is purely additive (one new const, one new function, one new `ctx.waitUntil` call).
- Live production sanity check before deploying: confirmed via `/d1/execute` that no stray `signature-event-missing/*` rows exist yet in the real `codex` table (clean baseline) and that the real schema matches the code's assumptions exactly.

## Explicitly not attempted (real follow-on, flagged not built)

Draft-generation — a scheduled workflow that does multi-source web verification the day after a detected-missing date and proposes a `SIGNATURE_EVENTS` entry for human review — is a separate, future CC-CMD, exactly as the doc scoped. This CC-CMD only builds detection.

## Confidence scoring (per doc's own rubric)

- TASK 0 (20 pts): real current registry shape confirmed, real existing cron mechanism traced to its actual call site (not guessed), real existing incident-alerting mechanism found and reused — **20/20**
- TASK 1 (30 pts): one real, freshly source-verified date (independent WebSearch, three sources), starts narrow as instructed — **30/30**
- TASK 2 (25 pts): reuses the exact existing codex/incident mechanism (verified via reading its real, already-live read path) and the exact existing daily cron trigger — no new alerting surface, no new schedule — **25/25**
- TASK 3 (25 pts): real forced tests for all three required cases plus an extra self-heal proof, all against the real production function; zero Night Stars scoring impact confirmed via direct diff review — **25/25**

**Total: 100/100.**
