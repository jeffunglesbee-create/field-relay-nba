# Claude Code Command — Brief Freshness Guard (Lightweight)

git pull. Read CLAUDE.md.

Write all findings to outbox/cc-brief-freshness-guard-2026-06-21.md.

## CONTEXT

Journalism briefs are written to KV at ~9am UTC and live 18-24 hours.
If material facts change after publication (pitcher scratched, odds
flipped, game postponed), the brief confidently describes a reality
that no longer exists. No mechanism detects or flags this.

The Sync Reconciler (src/sync-reconciler.js, commit f66f0be) shipped
a change_log D1 table and getRecentChanges() query function. This
command builds the staleness detection layer on top of it.

Drive spec: 1tEru3BaKjaJgvpWO8DoQFM3Z5pJKs49bSJiGhMTdy5Q
Depends on: Sync Reconciler (SHIPPED), change_log table (LIVE in D1)

## ADR-002 STATUS: CLEAN

Staleness is a DATA INTEGRITY assessment, not a drama score. The
guard checks whether factual claims in the brief (pitcher name,
odds direction) still match current data. Each materiality check
is a named binary condition (starter_changed, favorite_flipped,
rain_risk_appeared). No composite interest level. RUWT compliant.

## PRE-BUILD PROBE (Rule 68 — PROBE-FIRST-A)

```bash
# 1. Verify change_log table exists and has entries
curl -s https://field-relay-nba.jeffunglesbee.workers.dev/d1/execute \
  -X POST -H "Content-Type: application/json" \
  -H "X-FIELD-Relay: field-relay-cron-2026" \
  -d '{"sql":"SELECT COUNT(*) as n FROM change_log"}' 2>/dev/null

# 2. Check current sync-reconciler.js exports
grep "^export" src/sync-reconciler.js

# 3. Find the /changelog/{date} endpoint CC shipped
grep -n "changelog" src/index.js | head -10

# 4. Find where briefs are stored in KV (key format + payload shape)
grep -n "journalism:" src/index.js | head -10

# 5. Find getRecentChanges import
grep "getRecentChanges" src/index.js | head -5

# 6. Check what game_id format change_log uses
# (must match brief game_id format for cross-reference)
curl -s https://field-relay-nba.jeffunglesbee.workers.dev/d1/execute \
  -X POST -H "Content-Type: application/json" \
  -H "X-FIELD-Relay: field-relay-cron-2026" \
  -d '{"sql":"SELECT game_id, source, field FROM change_log ORDER BY ts DESC LIMIT 5"}' 2>/dev/null
```

Write probe results to outbox BEFORE writing any code.

## TASK 1: Create src/brief-freshness.js (~80 lines)

```javascript
// src/brief-freshness.js
// Brief Freshness Guard — detects stale briefs via change_log cross-reference.
// Spec: Drive 1tEru3BaKjaJgvpWO8DoQFM3Z5pJKs49bSJiGhMTdy5Q
// RUWT: each check is a named binary condition, no composite interest score.

import { getRecentChanges } from './sync-reconciler.js';

/**
 * Materiality filter — determines if a changelog entry makes a brief stale.
 * Conservative: most changes don't trigger staleness. Only changes that
 * make the brief's factual claims wrong or misleading.
 *
 * Each case is a named binary condition (RUWT compliant):
 *   starter_changed, favorite_flipped, rain_risk_appeared, injury_mentioned
 *
 * @param {object} change - { source, field, old_value, new_value }
 * @param {object} brief  - { text, generated_at } (brief text for player name matching)
 * @returns {{ material: boolean, reason: string }}
 */
function isMaterialChange(change, brief) {
  // Implement cases per spec:
  //
  // 'odds' or 'odds_api' or 'odds_backfill' source:
  //   - field contains 'opening_odds' or 'closing_odds'
  //   - Parse old_value and new_value as JSON odds objects
  //   - Check if the favorite flipped (home_ml sign changed)
  //   - If old_value is null (first population), NOT material
  //   - If favorite flipped: material, reason 'favorite_flipped'
  //   Note: odds values are JSON strings, not simple numbers.
  //   A favorite flip means the team favored to win changed.
  //   Be defensive — if parsing fails, return not material.
  //
  // 'lineup' source:
  //   - field includes 'starter': material, reason 'starter_changed'
  //
  // 'weather' source:
  //   - field is 'rain_risk' or 'dome_flag': material, reason 'rain_risk_appeared'
  //
  // 'injury' source:
  //   - If brief.text exists and change.new_value contains a player name
  //     mentioned in the brief: material, reason 'injury_mentioned'
  //   - Without brief text, any injury change is material
  //
  // 'savant' source:
  //   - field includes 'starter' or 'xERA': material, reason 'starter_changed'
  //
  // Default: not material
}

/**
 * Cross-reference a set of briefs against the changelog to detect staleness.
 *
 * @param {object} env
 * @param {Array<{game_id: string, text: string, generated_at: string}>} briefs
 * @returns {Array<{game_id: string, stale: boolean, stale_reason: string|null, superseded_by: Array}>}
 */
async function checkBriefFreshness(env, briefs) {
  if (!briefs.length) return [];

  // 1. Find the earliest generated_at across all briefs
  //    (use as the 'since' parameter for getRecentChanges)
  // 2. Call getRecentChanges with since, gameIds = briefs.map(b => b.game_id)
  // 3. For each brief, filter changelog entries where ts > brief.generated_at
  // 4. Apply isMaterialChange to each filtered entry
  // 5. If any material change found, mark brief as stale with:
  //    { stale: true, stale_reason: first material reason, superseded_by: [...] }
  // 6. Return array of freshness results
}

export { isMaterialChange, checkBriefFreshness };
```

Implement both functions fully per the spec. Key constraints:
- isMaterialChange must handle odds as JSON strings (parse defensively)
- old_value null means first population — NOT material (the brief
  was written before any odds existed, so it didn't reference them)
- checkBriefFreshness calls getRecentChanges with limit: 200
  to capture all changes, not just 20

## TASK 2: Add /freshness/{date} endpoint

Add a GET endpoint that returns staleness data for all briefs
on a given date. The client will poll this alongside the brief
content to annotate stale briefs.

```
GET /freshness/2026-06-21
→ {
    ok: true,
    date: "2026-06-21",
    results: [
      {
        game_id: "mlb_2026-06-21_newyorkyankees_bostonredsox",
        stale: true,
        stale_reason: "starter_changed",
        superseded_by: [
          { source: "lineup", field: "away_starter",
            old: "Cole", new: "Schmidt", ts: "2026-06-21T19:15:00Z" }
        ]
      },
      {
        game_id: "nba_2026-06-21_...",
        stale: false,
        stale_reason: null,
        superseded_by: []
      }
    ]
  }
```

Implementation:
1. Read all briefs for the date from D1 briefs table
   (SELECT game_id, brief_text, source FROM briefs WHERE date = ?)
2. Also read the slate brief's generated_at from KV
   (env.FIELD_JOURNALISM.get(`journalism:${date}`))
3. Call checkBriefFreshness with the brief list
4. Return the results

The brief's generated_at comes from the slate KV entry. For
per-game briefs that don't have a separate generated_at, use
the slate's generated_at as the baseline (they were written
during the same cron cycle).

Add this endpoint near the existing /changelog/{date} route.
Use the same CORS headers and auth pattern.

## TASK 3: Wire into existing /changelog/{date} response (optional)

If the existing /changelog/{date} endpoint already returns raw
changelog entries, consider adding a `freshness` field to its
response that includes the staleness cross-reference. This avoids
the client needing two separate calls.

Only do this if it doesn't complicate the existing endpoint.
If it does, skip — the separate /freshness/{date} endpoint is
sufficient.

## TASK 4: Verify

```bash
# Build check
node --check src/brief-freshness.js

# Deploy
wrangler deploy

# Health check
curl -s https://field-relay-nba.jeffunglesbee.workers.dev/health | grep "RELAY OK"

# Test the freshness endpoint (use today's date)
curl -s "https://field-relay-nba.jeffunglesbee.workers.dev/freshness/$(date -u +%Y-%m-%d)" \
  -H "X-FIELD-Relay: field-relay-cron-2026" 2>/dev/null | head -c 500
```

## SCOPE BOUNDARY (Rule 69 — TOUCH-ONLY-A)

DO:
- Create src/brief-freshness.js (new file)
- Add /freshness/{date} endpoint to src/index.js
- Import checkBriefFreshness + isMaterialChange
- Optionally enhance /changelog/{date} response

DO NOT:
- Modify sync-reconciler.js
- Modify the journalism prompt builder or context assembler
- Modify KV brief storage format (no schema changes)
- Add brief regeneration logic (that's the "heavy" upgrade, separate prompt)
- Touch any client code (jubilant-bassoon)
- Modify analytics-engine.js phases

## INSTRUCTIONS

1. Single-repo task: field-relay-nba only.
2. Pre-build probes FIRST. Write probe results to outbox.
3. Create src/brief-freshness.js with isMaterialChange + checkBriefFreshness.
4. Add /freshness/{date} endpoint with CORS.
5. node --check all modified files before commit.
6. Single commit: "feat: brief freshness guard — staleness detection via changelog"
7. Deploy via wrangler deploy.
8. Write manifest to outbox/cc-brief-freshness-guard-2026-06-21.md.

## KEY DESIGN NOTES

The odds values in change_log are JSON strings (serialized odds
objects with home_ml, away_ml, draw_ml fields), not simple numbers.
isMaterialChange must parse these defensively. A favorite flip
means the sign of home_ml changed between old and new.

old_value = null means first population. The brief was written
before ANY odds existed, so it couldn't have referenced them.
First population is NOT material.

The brief text is only available for per-game briefs stored in D1
(briefs table). The slate brief doesn't have per-game text
separation. For the initial implementation, only per-game briefs
support injury-name matching. The slate brief gets a simpler
staleness check (any material change for any game in the slate
marks the entire slate as potentially stale).
