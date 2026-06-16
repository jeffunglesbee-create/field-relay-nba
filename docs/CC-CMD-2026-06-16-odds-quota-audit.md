# CC COMMAND: Odds API Quota Audit + Fix

## PRIORITY: P0 — BLOCKING LIVE WC COVERAGE

## PROBLEM
The Odds API ($30/month, 20K credits) is exhausted at 19,999/20,000.
The credit budget analysis (June 14 spec) projected max 53% usage (10,680 credits)
even with all sports active. Actual consumption hit 100% in 28 days.
Result: /wc/odds-probs returns 401. All WP bars show stale data.
Next reset: June 19 (3 days). Must fix root cause before reset or it repeats.

## SCOPE: field-relay-nba repo (src/ambient-do.js)

## DIAGNOSIS TASKS (read-only, no code changes yet)

### D1: Credit consumption audit
- Read `_fetchLiveOdds()` in ambient-do.js end to end
- Count every `fetch()` call to api.the-odds-api.com
- Map each call to its credit cost (1 credit per request per the-odds-api docs)
- Identify: are per-sport cooldowns (ODDS_PRIORITY tiers) enforced?
- Identify: is the CF edge cache (20s TTL) actually set on these requests?
- Identify: does _poll() call _fetchLiveOdds() every cycle or only on scoreChanged?
- Identify: are there any other callers of the odds API outside AmbientDO?
  - Check: /wc/odds-probs handler, /wc/bracket cron, any cron alarm handler
  - Check: dead-hour cron — does it poll odds when no games are live?

### D2: Estimate actual vs budgeted consumption
- Calculate: if _poll() runs every 30s, how many odds calls per hour per sport?
- Calculate: with N sports active simultaneously, how many calls per day?
- Calculate: with WC (48 group games over 16 days) + MLB (~15 games/day), total monthly credits
- Compare to the 6,480 (WC) / 7,560 (peak) / 10,680 (all) budget from June 14 spec

### D3: Edge cache verification
- Check if odds API fetch uses `cf: { cacheTtl: 20 }` or equivalent
- Check if the cache key includes query params that defeat caching
- Check if POST requests are used (POST bypasses CF cache)

## FIX TASKS (after diagnosis, single-concern commits)

### F1: Hard credit guard
Add a monthly credit counter to DO storage:
- Key: `odds:credits:YYYY-MM` 
- Increment on every odds API fetch
- Hard stop at configurable limit (e.g. 18,000 — leaves 2K buffer)
- Log warning at 50%, 75%, 90% thresholds
- When limit hit: skip odds fetch, log, continue without WP data

### F2: Fix whatever D1-D3 reveal
- If cooldowns not enforced: fix cooldown logic
- If edge cache missing: add `cf: { cacheTtl }` with sport-appropriate TTL
- If dead-hour cron polls odds: gate behind live game check
- If multiple callers: consolidate to single cached path

### F3: Starter key fallback
- Add env var `ODDS_API_KEY_FALLBACK` with Starter key (8452c3ac6e226ca6eff8b087391d3c76)
- When primary key returns 401/429, switch to fallback key
- Fallback has 500 credits — WC-only, live-only, 180s minimum cooldown
- Log every fallback usage

## COMMIT DISCIPLINE
- One commit per fix (F1, F2, F3 separate)
- No SW_VERSION bump (relay changes)
- Smoke must pass after each commit
- Write diagnosis results to outbox/cc-odds-audit-results.md before any fixes

## DO NOT
- Do not change the client (jubilant-bassoon)
- Do not modify the credit budget math — fix the implementation to match the budget
- Do not remove the odds system — fix the leak
- Do not guess — read the code, count the calls, show the math
