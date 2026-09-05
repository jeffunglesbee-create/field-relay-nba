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

const ODDS_DAILY_CEILING = 3800; // 85K/month ÷ ~22 active days ≈ 3864/day

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
 * Limit kept in sync with src/index.js ODDS_HARD_LIMIT (85 000 — the
 * 100 K paid plan minus 15 K reserved for special projects, per
 * commit 0f39fdf).
 */
async function peekMonthlyOdds(env) {
    if (!env || !env.FIELD_JOURNALISM) return null;
    try {
        const d = new Date();
        const month = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
        const raw = await env.FIELD_JOURNALISM.get(`odds:credits:${month}`);
        const used = raw ? parseInt(raw, 10) || 0 : 0;
        const limit = 85000;
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

// Derives a call's credit cost from the URL it is about to fetch, so the cost
// and the request can never drift apart. Every guarded site passes the same
// string to this and to fetch().
//
// THE MODEL IS THIS REPO'S OWN, NOT A NUMBER I BROUGHT WITH ME. Two sites were
// already guarded and both state it in their comments: fetchSportOddsLive says
// "3 markets (h2h,spreads,totals) -> ~3 credits/call" and charges 3;
// fetchSportOddsHistorical says "10 quota units per historical call (vs 1 for
// current)" and charges 30. Markets multiply, historical is 10x. This function
// reproduces both exactly, which is the check that it did not invent anything.
//
// AND THE REGIONS FACTOR IS MEASURED, which it was not when this was written.
// The original text here said plainly that whether `regions` also multiplies was
// unknown, that nothing in this repository had ever asserted it, and that the
// helper would therefore not add it until something measured it. Something did:
// scripts/odds-cost-model-probe.mjs, 2026-09-05T01:59Z. Regions multiply.
//
// So a us,eu call is twice the price of the same markets over us alone, and
// three of the sites this ledger now watches were charging half. The two sites
// that were already guarded both send regions=us, which is why their numbers
// (3 and 30) are unchanged by the finding and why nothing in this repo had ever
// had cause to notice the factor.
//
// The instrument stays wired: /wc/odds-probs and /cfl/odds-probs still return
// `cost` from X-Requests-Last beside `charged`, so a future change to the
// provider's pricing shows up as those two disagreeing rather than as a slow
// drift nobody sees.
// MEASURED 2026-09-05T01:59:12Z, not assumed. outbox/odds-cost-model-probe-
// 2026-09-05T01-59-10.json: /cfl/odds-probs sent 3 markets over regions=us,eu
// and the provider's X-Requests-Last came back 6. Corroborated independently by
// X-Requests-Remaining falling exactly 6 across the two calls (76381 -> 76375),
// so 6 was that call's price and not concurrent traffic.
//
// Regions multiply. The comment block above is left standing as written because
// it was the honest state before the measurement, and the point of writing it
// that way was that one line changes when the answer arrives. This is that line.
export const ODDS_REGIONS_MULTIPLY = true;
export function oddsCreditCost(url) {
    let markets = 1, regions = 1;
    try {
        const q = new URL(url).searchParams;
        const m = (q.get('markets') || '').split(',').filter(Boolean);
        const r = (q.get('regions') || '').split(',').filter(Boolean);
        if (m.length) markets = m.length;
        if (r.length) regions = r.length;
    } catch (_) {
        // An unparseable URL must not charge zero. Fall through to the
        // 1-market floor below, which is the cheapest a real call can be.
    }
    const base = markets * (ODDS_REGIONS_MULTIPLY ? regions : 1);
    // /v4/historical/* is 10x per the provider, per fetchSportOddsHistorical.
    const mult = url.includes('/v4/historical/') ? 10 : 1;
    return Math.max(1, base * mult);
}

// ── Reconcile: the estimate is what the guard needs, the receipt is the truth ──
//
// oddsCreditCost has to answer BEFORE the call -- that is the whole point of a
// circuit breaker. But the provider tells us afterwards exactly what the call
// cost, in X-Requests-Last, and until now we threw that away and kept the guess.
//
// MEASURED 2026-09-05T03:26:20Z, which is why this exists: /wc/odds-probs
// reported provider cost "0" against charged 4. The World Cup has no listed
// events, the request returned nothing, the provider billed nothing, and our
// ledger recorded four credits of spend that never happened.
//
// That is the mirror image of this morning's defect. Then the ledger UNDER-
// counted and let real spend go unrecorded; now it OVER-counts and consumes
// headroom nothing used. Both make ODDS_HARD_LIMIT mean something other than
// what it says, and a floor you cannot trust in either direction is not a floor.
//
// A CACHE HIT IS THE CASE THAT MAKES THIS SUBTLE. Every odds fetch here sets
// cacheEverything, and a hit replays the ORIGINAL response's headers -- so
// X-Requests-Last comes back saying what the first call cost, while this call
// cost nothing. Reconciling to the header would charge full price for a free
// request. cf-cache-status distinguishes them, and its absence is a third state
// rather than an assumption either way.
//
// Returns a report instead of a boolean, because "we could not tell" and "it
// cost zero" are different answers and this session has now produced four
// confident falsehoods from collapsing exactly that distinction.
export async function reconcileOddsCredit(env, estimated, resp, site = '') {
    const out = { site, estimated, actual: null, delta: 0, state: 'unresolved' };
    try {
        if (!env || !env.FIELD_JOURNALISM) { out.state = 'no-kv'; return out; }
        if (!resp || !resp.headers)        { out.state = 'no-response'; return out; }

        const cache = resp.headers.get('cf-cache-status');
        const last  = resp.headers.get('x-requests-last');

        if (cache === 'HIT') {
            // Served from the edge. The provider was never contacted, so the
            // replayed header describes a different call than this one.
            out.actual = 0;
            out.state  = 'cache-hit';
        } else if (last === null) {
            // No receipt. Keep the estimate rather than invent a correction --
            // an unreconciled charge is safe, a wrong one is not.
            out.state = 'no-header';
            return out;
        } else {
            const n = parseInt(last, 10);
            if (!Number.isFinite(n) || n < 0) { out.state = 'bad-header'; return out; }
            out.actual = n;
            out.state  = 'reconciled';
        }

        out.delta = out.actual - estimated;
        if (out.delta === 0) return out;

        // Both layers, since both were charged the estimate. Read-modify-write,
        // non-atomic, exactly as the counters they adjust already are -- and
        // clamped at zero so a lost race can never drive a ledger negative and
        // hand back headroom that was genuinely spent.
        const day   = `odds:daily:${new Date().toISOString().slice(0, 10)}`;
        const d     = new Date();
        const month = `odds:credits:${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
        for (const key of [day, month]) {
            const raw = await env.FIELD_JOURNALISM.get(key);
            const cur = raw ? parseInt(raw, 10) || 0 : 0;
            const next = Math.max(0, cur + out.delta);
            await env.FIELD_JOURNALISM.put(key, String(next), { expirationTtl: 60 * 86400 });
        }
        return out;
    } catch (e) {
        // A reconciliation failure must never surface as a request failure. The
        // charge stands at the estimate, which is the safe direction.
        out.state = 'error';
        out.note  = String(e && e.message || e);
        return out;
    }
}
