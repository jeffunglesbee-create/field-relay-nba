# Claude Code Command — Budget Coordinator

git pull. Read CLAUDE.md.

Write all findings to outbox/cc-budget-coordinator-2026-06-21.md.

## CONTEXT

Three independent Odds API consumers exist with separate budget
tracking. None knows what the others are spending.

| Consumer | Location | Budget Tracking | Cost/call |
|----------|----------|----------------|-----------|
| snapshotCronOdds | src/index.js ~L3900 | Monthly KV counter + x-requests-remaining header | ~3 credits |
| AmbientDO live odds | src/ambient-do.js _fetchLiveOdds | Monthly KV guard (line 472) | ~1 credit |
| Closing odds capture | src/ambient-do.js _captureClosingOdds | In-memory _closingOddsToday cap (30/day) | ~1 credit |

The monthly KV counter (`odds:credits:YYYY-MM` in FIELD_JOURNALISM
KV) is shared between snapshotCronOdds and AmbientDO live odds.
The closing odds capture has its OWN in-memory daily cap (30/day)
that doesn't participate in the shared counter.

This means closing odds captures are invisible to the monthly
guard, and there's no daily coordination between consumers.

## PRE-BUILD PROBE

```bash
# 1. Read the monthly KV guard (odds-guard)
grep -n "odds.guard\|ODDS_HARD_LIMIT\|oddsMonthKey\|checkOddsBudget" src/index.js | head -10

# 2. Read the closing odds daily cap
grep -n "_closingOddsToday\|daily cap" src/ambient-do.js | head -5

# 3. Read the live odds budget check
grep -n "checkOddsBudget\|HARD_LIMIT\|credit.*guard" src/ambient-do.js | head -10

# 4. Check current monthly KV counter value
# (Probe this via relay if possible)
```

## TASK 1: Create shared daily budget key

Add a KV-backed daily counter alongside the existing monthly
counter. Key format: `odds:daily:YYYY-MM-DD` in FIELD_JOURNALISM.

In `src/index.js`, add a helper function:

```javascript
// Daily Odds API budget — shared across all consumers.
// Key: odds:daily:YYYY-MM-DD in FIELD_JOURNALISM KV.
// Consumers call incrementDailyOdds(env, credits) AFTER a
// successful fetch. checkDailyOdds(env, credits) returns true
// if the spend is within the daily ceiling.
const ODDS_DAILY_CEILING = 900;  // 20K/month ÷ 22 active days ≈ 900/day

async function checkDailyOdds(env, credits = 1) {
    if (!env?.FIELD_JOURNALISM) return true; // no KV → permissive
    const key = `odds:daily:${new Date().toISOString().slice(0, 10)}`;
    const used = parseInt(await env.FIELD_JOURNALISM.get(key) || '0', 10);
    return (used + credits) <= ODDS_DAILY_CEILING;
}

async function incrementDailyOdds(env, credits = 1) {
    if (!env?.FIELD_JOURNALISM) return;
    const key = `odds:daily:${new Date().toISOString().slice(0, 10)}`;
    const used = parseInt(await env.FIELD_JOURNALISM.get(key) || '0', 10);
    await env.FIELD_JOURNALISM.put(key, String(used + credits), {
        expirationTtl: 172800, // 48h — auto-cleanup
    });
}
```

Export these from index.js so ambient-do.js can import them.

## TASK 2: Wire into snapshotCronOdds

In the snapshotCronOdds function, after each successful
fetchSportOddsLive call:
1. Check `checkDailyOdds(env, 3)` before fetching
2. Call `incrementDailyOdds(env, 3)` after successful fetch

The existing monthly guard stays — daily is an ADDITIONAL layer.

## TASK 3: Wire into AmbientDO live odds

In `_fetchLiveOdds`, the monthly KV guard already exists
(line 472). Add the daily check alongside it:

```javascript
// Before the fetch:
const { checkDailyOdds, incrementDailyOdds } = await import('./budget-helpers.js');
if (!await checkDailyOdds(this.env, 1)) {
    console.warn('[ambient-odds] daily ceiling reached');
    return;
}
// After successful fetch:
await incrementDailyOdds(this.env, 1);
```

NOTE: dynamic import in a Durable Object is fine on Workers.
Alternatively, pass the helpers as a static import if
dynamic import causes issues.

## TASK 4: Wire into closing odds capture

Replace the in-memory `_closingOddsToday` counter with the
shared daily KV counter:

```javascript
// In _captureClosingOdds, replace the _closingOddsToday check:
if (!await checkDailyOdds(this.env, 1)) {
    console.warn('[closing-odds] daily ceiling reached');
    return;
}
// After successful capture:
await incrementDailyOdds(this.env, 1);
```

Remove `_closingOddsToday` and `_closingOddsDate` instance
variables — they're replaced by the KV counter.

## TASK 5: Budget probe endpoint

Add `GET /budget/odds` endpoint that returns current spend:

```javascript
// Response shape:
{
    "daily": {
        "date": "2026-06-21",
        "used": 47,
        "ceiling": 900,
        "remaining": 853
    },
    "monthly": {
        "month": "2026-06",
        "used": 1234,
        "limit": 18000,
        "remaining": 16766
    }
}
```

## ARCHITECTURE NOTE

The daily counter uses last-write-wins (no atomic increment).
For our use case this is fine — we're not billing, just guarding.
Two concurrent increments might both read "47" and write "48"
instead of "49". At worst we under-count by 1-2 credits per
burst. The ceiling has enough headroom (900 vs actual ~200-400
daily usage) that this race is irrelevant.

## SCOPE BOUNDARY

DO:
- Add checkDailyOdds / incrementDailyOdds helpers
- Wire into snapshotCronOdds, _fetchLiveOdds, _captureClosingOdds
- Remove _closingOddsToday in-memory counter
- Add /budget/odds probe endpoint
- Keep existing monthly guard unchanged

DO NOT:
- Modify the Odds API fetch logic
- Change the monthly ODDS_HARD_LIMIT or KV structure
- Touch any journalism prompt code
- Modify the identity resolver

## INSTRUCTIONS

1. Relay repo only (field-relay-nba).
2. Pre-build probes FIRST.
3. Helper functions can live in src/index.js (exported) or a
   new src/budget-helpers.js. CC decides based on import
   complexity. If ambient-do.js needs them, a separate file
   with static import is cleaner than dynamic import.
4. node --check all modified files.
5. Single commit: "feat: budget coordinator — shared KV daily
   ceiling across all Odds API consumers"
6. Deploy via wrangler deploy.
7. After deploy, hit /budget/odds to verify.
8. Write manifest to outbox.
