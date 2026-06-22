// src/budget-helpers.js
// Shared daily Odds-API budget counter. The existing monthly counter
// (`odds:credits:YYYY-MM` in FIELD_JOURNALISM KV, ceiling 18000) is left
// untouched — this is an ADDITIONAL daily layer so a single
// snapshotCronOdds run or runaway AmbientDO poll can't burn the monthly
// quota in one day.
//
// Three consumers participate:
//   - snapshotCronOdds  (src/index.js → consumeOddsCredit)
//   - _fetchLiveOdds    (src/ambient-do.js → _consumeAmbientOddsCredit)
//   - _captureClosingOdds (src/ambient-do.js, in-memory cap replaced)
//
// Concurrency: read-then-write, not atomic. Two concurrent callers can
// under-count by `units`. With ~900 daily headroom vs observed
// ~200-400 daily spend the race is benign — same trade-off
// consumeOddsCredit / _consumeAmbientOddsCredit already make.

const ODDS_DAILY_CEILING = 900; // 20K/month ÷ ~22 active days

function _dailyKey() {
    return `odds:daily:${new Date().toISOString().slice(0, 10)}`;
}

/**
 * Check the daily ceiling AND increment if the call would pass. Returns
 * true when the increment happened (caller should proceed with the
 * Odds-API fetch); false when the daily ceiling would be exceeded.
 *
 * Degrade-open on missing binding / KV error: returns true so a KV blip
 * doesn't kill live coverage. The monthly counter still acts as the
 * hard ceiling in that case.
 */
async function checkAndIncrementDailyOdds(env, units = 1) {
    if (!env || !env.FIELD_JOURNALISM) return true;
    try {
        const key = _dailyKey();
        const raw = await env.FIELD_JOURNALISM.get(key);
        const used = raw ? parseInt(raw, 10) || 0 : 0;
        if (used + units > ODDS_DAILY_CEILING) {
            // One warn per day per ceiling-hit isolate. The monthly guard
            // emits its own warn separately.
            const warnedKey = `${key}:warned`;
            const already = await env.FIELD_JOURNALISM.get(warnedKey);
            if (!already) {
                console.warn(`[odds-daily-guard] daily ceiling reached — used=${used} + ${units} > ${ODDS_DAILY_CEILING}; suppressing further fetches`);
                await env.FIELD_JOURNALISM.put(warnedKey, '1', { expirationTtl: 86400 });
            }
            return false;
        }
        await env.FIELD_JOURNALISM.put(key, String(used + units), {
            expirationTtl: 172800, // 48h — auto-cleanup
        });
        return true;
    } catch (_) {
        return true; // degrade-open
    }
}

/**
 * Read-only snapshot of today's daily counter. Used by /budget/odds.
 * Returns null when FIELD_JOURNALISM isn't bound so the caller can
 * surface "binding unavailable" rather than a fake zero.
 */
async function peekDailyOdds(env) {
    if (!env || !env.FIELD_JOURNALISM) return null;
    try {
        const date = new Date().toISOString().slice(0, 10);
        const key = `odds:daily:${date}`;
        const raw = await env.FIELD_JOURNALISM.get(key);
        const used = raw ? parseInt(raw, 10) || 0 : 0;
        return {
            date,
            used,
            ceiling: ODDS_DAILY_CEILING,
            remaining: Math.max(0, ODDS_DAILY_CEILING - used),
        };
    } catch (_) {
        return null;
    }
}

/**
 * Read-only snapshot of this month's monthly counter. Mirrors the key
 * format consumeOddsCredit and _consumeAmbientOddsCredit write to.
 * Limit is hard-coded (matches src/index.js ODDS_HARD_LIMIT) so the
 * peek doesn't have to import from there.
 */
async function peekMonthlyOdds(env) {
    if (!env || !env.FIELD_JOURNALISM) return null;
    try {
        const d = new Date();
        const month = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
        const raw = await env.FIELD_JOURNALISM.get(`odds:credits:${month}`);
        const used = raw ? parseInt(raw, 10) || 0 : 0;
        const limit = 18000;
        return { month, used, limit, remaining: Math.max(0, limit - used) };
    } catch (_) {
        return null;
    }
}

export {
    ODDS_DAILY_CEILING,
    checkAndIncrementDailyOdds,
    peekDailyOdds,
    peekMonthlyOdds,
};
