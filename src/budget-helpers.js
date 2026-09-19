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

// A ONE-DAY GRANT THAT CANNOT OUTLIVE ITS DAY.
//
// The obvious way to spend an approved one-off is to raise the constant, use
// it, and lower it again. That leaves a permanently raised guard the moment
// anyone forgets the second deploy — and a budget guard that quietly stopped
// guarding is worse than none, because the number still looks deliberate.
//
// So the grant carries its own date. On any other date it contributes nothing
// and no action is required to expire it: the stale entry simply goes inert.
// Reverting is the default rather than a task someone has to remember.
//
// Granted by the account owner 2026-09-13 to complete an approved archive
// backfill (CC-CMD-2026-09-13-alias-table-silent-overwrite tranche 2, 11 dates,
// 2310 credits) after the day's normal ceiling was exhausted. Provider quota
// was not the constraint — 47,245 requests remained.
const ODDS_CEILING_GRANTS = [
    { date: '2026-09-13', extra: 2500, why: 'tranche 2 archive backfill, owner-approved' },
];

/** Today's ceiling: the standing one, plus any grant issued FOR TODAY. */
function _dailyCeiling(today = new Date().toISOString().slice(0, 10)) {
    const extra = ODDS_CEILING_GRANTS
        .filter(g => g.date === today)
        .reduce((n, g) => n + g.extra, 0);
    return ODDS_DAILY_CEILING + extra;
}

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
/** Every known site's spend for a date, plus any that appear unexpectedly.
 *  A site with 0 is LISTED — absent and zero are different answers. */
//
// ONE VOCABULARY, EXPORTED, because there were two. checkAndIncrementDailyOdds
// was passed 'ambientFetchLiveOdds' while reconcileOddsCredit at the SAME call
// site was passed '_fetchLiveOdds'; likewise '_captureClosingOdds',
// 'wp-resolver:fetchSportOddsLive' and 'odds-proxy'. Four of nine consumers had
// two names for one thing, which is why reconcile could not simply be pointed at
// the site key — it would have minted odds:site:_fetchLiveOdds:* that _readSites
// never reads. Exported so check-odds-attribution.mjs asks this list rather than
// keeping a copy of it.
export const ODDS_SITES = [
    'getWCPregameLambdas', 'handleWCOddsProbs', 'handleCFLOddsProbs',
    'fetchSportOddsLive', 'fetchSportOddsHistorical', 'wpResolver',
    'ambientFetchLiveOdds', 'ambientCaptureClosingOdds',
    // The PUBLIC /odds/* proxy. User-triggered spend, and the ninth call site —
    // I named eight from a grep and check-odds-attribution.mjs found this one on
    // its first live run.
    'oddsProxyRoute',
    'unattributed',
];

async function _readSites(env, date) {
    const out = {};
    for (const site of ODDS_SITES) {
        try {
            const raw = await env.FIELD_JOURNALISM.get(_siteKey(site, date));
            // An ABSENT key is a real zero: the counter is only written when a
            // site spends, so no key means no spend. A key holding something
            // unparseable is NOT a zero — it is a corrupt counter, and reading
            // it as 0 would hide spend rather than report it.
            if (raw === null || raw === undefined) { out[site] = 0; continue; }
            const n = parseInt(raw, 10);
            out[site] = Number.isFinite(n) ? n : null;
        } catch (_) {
            out[site] = null;   // unreadable is not zero
        }
    }
    return out;
}

/** Per-site daily spend. Same store and TTL as the counter it explains. */
function _siteKey(site, date = new Date().toISOString().slice(0, 10)) {
    // Bounded and predictable: a site string is code-supplied, never
    // user-supplied, but an unbounded key space in KV is still a liability.
    const safe = String(site || 'unattributed').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 40) || 'unattributed';
    return `odds:site:${safe}:${date}`;
}

async function _bumpSite(env, site, units) {
    try {
        const key = _siteKey(site);
        const raw = await env.FIELD_JOURNALISM.get(key);
        const cur = raw ? parseInt(raw, 10) || 0 : 0;
        // Clamped because reconcileOddsCredit calls this with a NEGATIVE delta
        // when the provider billed less than the estimate. A lost read-modify-
        // write race must not drive a site counter below zero and make the split
        // hand back spend that happened.
        await env.FIELD_JOURNALISM.put(key, String(Math.max(0, cur + units)), { expirationTtl: 172800 });
    } catch (_) {
        // Attribution must never fail a fetch. The daily counter above already
        // succeeded, so the total stays correct even when the split does not.
    }
}

/** Credits that got through because a guard degraded OPEN.
 *
 *  WHY THIS EXISTS, from an elimination rather than a hunch. On 2026-09-17 the
 *  integrity watch found 427 credits at the vendor that no counter saw. The
 *  obvious candidate — CI spending outside the ledger — was measured and ruled
 *  out: in that window odds-backfill spent 80, provenance-census only names
 *  ODDS_BASE in comments, none of the six dispatch-only vendor workflows ran,
 *  and the other three repos hold no scheduled vendor caller at all. 347
 *  credits had no remaining explanation except a guard falling open, and
 *  nothing counted that.
 *
 *  BOTH DEGRADE PATHS ARE DELIBERATE AND ONLY ONE CAN BE COUNTED:
 *
 *    (1) `!env.FIELD_JOURNALISM` — the binding is absent, so there is nowhere
 *        in KV to record it. Not a gap in this instrument: /budget/odds already
 *        answers 503 "FIELD_JOURNALISM KV not bound" in that state, and the
 *        watch treats an unreachable budget route as a failure. Visible, just
 *        not here.
 *
 *    (2) the catch below — KV threw mid-operation. The call proceeds and spends
 *        at the vendor while odds:daily:* never moves. THIS is the one with no
 *        witness, and a later write may well succeed because the error is
 *        transient, so it can record itself.
 *
 *  BEST EFFORT, AND SILENT WHEN IT FAILS. If KV is still throwing, this throws
 *  too and nothing is recorded — which is honest: the outer symptom (credits at
 *  the vendor, not in the ledger) is exactly what the watch already reports. A
 *  counter that could itself break a fetch would be worse than no counter.
 */
function _degradeKey(date = new Date().toISOString().slice(0, 10)) {
    return `odds:degraded:${date}`;
}

async function _countDegradeOpen(env, units) {
    try {
        const key = _degradeKey();
        const raw = await env.FIELD_JOURNALISM.get(key);
        const cur = raw ? JSON.parse(raw) : { events: 0, credits: 0 };
        await env.FIELD_JOURNALISM.put(key, JSON.stringify({
            events: (Number(cur.events) || 0) + 1,
            // Credits, not just events: one degraded historical call is 30 and
            // one degraded live call is 1. An event count would make those look
            // the same and could not be compared against an escape figure.
            credits: (Number(cur.credits) || 0) + (Number(units) || 0),
            last: new Date().toISOString(),
        }), { expirationTtl: 172800 });
    } catch (_) {
        // Deliberately empty. See BEST EFFORT above.
    }
}

// Seeded once per isolate per day, from the day's KV total, so the cutover can
// happen at ANY hour rather than only at a UTC midnight.
//
// Task 4 specified a day boundary for one reason: a fresh D1 row starting at 0
// beside a KV counter already at, say, 1014 would hand the day a second full
// ceiling. Carrying the KV total into the seed removes that, and `INSERT OR
// IGNORE` means it can only ever apply to the day's first row — a second isolate
// seeding the same day is a no-op, not a double count.
let _seededDay = null;

async function _seedFromKv(env, date) {
    if (_seededDay === date) return 0;
    let carried = 0;
    try {
        const raw = await env.FIELD_JOURNALISM.get(`odds:daily:${date}`);
        carried = raw ? parseInt(raw, 10) || 0 : 0;
    } catch (_) { /* a KV read failure seeds 0; the ceiling is then generous for
                     one day rather than the guard failing shut on a read */ }
    _seededDay = date;
    return carried;
}

async function checkAndIncrementDailyOdds(env, units = 1, site = 'unattributed') {
    if (!env || !env.FIELD_JOURNALISM) return true;
    try {
        const key = _dailyKey();
        const date = key.slice('odds:daily:'.length);
        const ceiling = _dailyCeiling();

        // ONE BATCH, FOUR KV ROUND TRIPS REPLACED BY ONE D1 CALL. The previous
        // form did get + put on odds:daily:* and then get + put on odds:site:*
        // inside _bumpSite -- four non-atomic operations from concurrent
        // isolates, which is why the two counters disagreed in BOTH directions
        // and no single root cause was ever found. They are now written in one
        // transaction and cannot diverge for any reason, including ones nobody
        // has thought of. That argument does not depend on the diagnosis being
        // right, which is why it survived the diagnosis being wrong twice.
        if (!(await ensureOddsBudgetTables(env))) throw new Error('ARCHIVE_DB unavailable');
        const carried = await _seedFromKv(env, date);
        const db = env.ARCHIVE_DB;
        const results = await db.batch([
            db.prepare(ODDS_BUDGET_SQL.seed).bind(date, carried),
            db.prepare(ODDS_BUDGET_SQL.site).bind(date, site, units, date, units, ceiling),
            db.prepare(ODDS_BUDGET_SQL.charge).bind(units, date, units, ceiling),
        ]);
        if (chargedFromBatch(results)) return true;

        // Vetoed. Nothing was written -- the site statement carries the same
        // predicate over the same pre-charge total, so there is no compensating
        // write to make and no window in which the split is ahead of the total.
        {
            // One warn per day per ceiling-hit isolate. The monthly guard
            // emits its own warn separately.
            const warnedKey = `${key}:warned`;
            const already = await env.FIELD_JOURNALISM.get(warnedKey);
            if (!already) {
                console.warn(`[odds-daily-guard] daily ceiling reached — +${units} would exceed ${ceiling}; suppressing further fetches`);
                await env.FIELD_JOURNALISM.put(warnedKey, '1', { expirationTtl: 86400 });
            }
            return false;
        }
    } catch (_) {
        // DEGRADE-OPEN, AND NOW WITNESSED. The call is about to spend at the
        // vendor while odds:daily:* did not move; without this line the only
        // evidence is a discrepancy nobody can attribute, which is what cost a
        // day of elimination on 2026-09-17.
        await _countDegradeOpen(env, units);
        return true; // degrade-open
    }
}

/**
 * Read-only snapshot of today's daily counter. Used by /budget/odds.
 * Returns null when FIELD_JOURNALISM isn't bound so the caller can
 * surface "binding unavailable" rather than a fake zero.
 */
//
// `forDate` READS A CLOSED DAY, and it exists because of a measurement rather
// than a preference. GitHub's scheduled-run delay in this repo is 104 to 405
// minutes (25 scheduled runs across 7 workflows, measured 2026-09-16 via the
// Actions API; artifact: outbox/gha-cron-delay-2026-09-16.json). A watch
// scheduled at 23:30 UTC to read "the whole of today" therefore fires between
// 01:14 and 06:15 the NEXT day and reads the new day's near-empty counters.
// Asking for an explicit date makes the reader delay-immune: yesterday is a
// complete day whenever the runner happens to wake up.
//
// Bounded to the TTL that actually exists. odds:site:* is written with
// expirationTtl 172800 (2 days), so a date older than that returns zeros for
// every site while odds:daily:* (60 days) still has a total — a split that
// would read as "nothing named itself" rather than "the evidence expired".
// SITE_TTL_DAYS is the honest limit and the route refuses past it.
export const SITE_TTL_DAYS = 2;

async function peekDailyOdds(env, forDate = null) {
    if (!env || !env.FIELD_JOURNALISM) return null;
    try {
        const date = forDate || new Date().toISOString().slice(0, 10);
        const key = `odds:daily:${date}`;
        const raw = await env.FIELD_JOURNALISM.get(key);
        const kvUsed = raw ? parseInt(raw, 10) || 0 : 0;
        // THE REPORT MUST MATCH THE GUARD. Reporting the standing ceiling while
        // the guard enforces a granted one would show 0 remaining on a day when
        // 2500 more are allowed — a budget readout that disagrees with the
        // budget is worse than none, because it is the number people act on.
        const ceiling = _dailyCeiling(date);
        // THE READER FOLLOWS THE WRITER, AND SAYS WHICH ONE IT READ.
        //
        // This ships in the same commit as the guard's move to D1 because it has
        // to: a guard charging D1 while /budget/odds reads KV would report 0 used
        // on a day with real spend, and every watch built on this route --
        // attribution-gap, site-drift, daily-vs-vendor, the ceiling readout --
        // would read that zero as a finding.
        //
        // ONE fallback level, not a chain (Rule 76). D1 is authoritative for any
        // day it has a row for; KV answers for days before the cutover, which
        // still exist inside odds:daily:*'s TTL. A day with no row in either is
        // genuinely zero.
        //
        // `source` is in the response because "0 used" and "read the wrong store"
        // are indistinguishable otherwise, and this route is the one people act
        // on. Absent is not zero (Rule 99), and neither is asking the wrong
        // question.
        let used = kvUsed, sites = await _readSites(env, date), source = 'kv';
        try {
            if (env.ARCHIVE_DB) {
                const row = await env.ARCHIVE_DB
                    .prepare('SELECT used FROM odds_budget WHERE day = ?').bind(date).first();
                if (row && row.used !== null && row.used !== undefined) {
                    used = Number(row.used) || 0;
                    const siteRows = await env.ARCHIVE_DB
                        .prepare('SELECT site, used FROM odds_budget_site WHERE day = ?').bind(date).all();
                    const d1Sites = {};
                    for (const s of (siteRows?.results || [])) d1Sites[s.site] = Number(s.used) || 0;
                    // Every declared site appears, at 0 if it did not spend, so a
                    // site that fell out of the vocabulary stays distinguishable
                    // from one that simply had a quiet day.
                    for (const s of ODDS_SITES) if (!(s in d1Sites)) d1Sites[s] = 0;
                    sites = d1Sites;
                    source = 'd1';
                }
            }
        } catch (_) {
            // A D1 read failure leaves the KV answer standing and says so via
            // `source`, rather than reporting a zero nobody can tell from a
            // quiet day.
            source = 'kv-d1-unreadable';
        }
        // `(Number(v) || 0)` here would sum the readable sites and publish the
        // result as the total, making an unreadable counter indistinguishable
        // from a site that spent nothing — the exact substitution that shipped
        // `briefs_counted: 0` from 48 nulls on 2026-08-22. If any site is
        // unreadable the sum is not known, and neither is the gap.
        // A guard that fell open is the one thing that explains credits at the
        // vendor with no counter movement. Reported as an OBJECT or null —
        // never as 0 — because "no degradation today" and "the degrade counter
        // could not be read" are different answers and only one is good news.
        let degraded = null;
        try {
            const raw = await env.FIELD_JOURNALISM.get(_degradeKey(date));
            degraded = raw ? JSON.parse(raw) : { events: 0, credits: 0, last: null };
        } catch (_) {
            degraded = null;
        }
        const unreadable = Object.keys(sites).filter(k => sites[k] === null);
        const sum = unreadable.length
            ? null
            : Object.values(sites).reduce((a, v) => a + v, 0);
        const grants = ODDS_CEILING_GRANTS.filter(g => g.date === date);
        return {
            date,
            // A reader that asked for a date must be able to tell whether it
            // got one. Without this, a caller cannot distinguish "yesterday's
            // closed day" from "today, because the parameter was ignored".
            requested_date: forDate,
            is_today: date === new Date().toISOString().slice(0, 10),
            used,
            source,          // 'd1' | 'kv' | 'kv-d1-unreadable'
            kv_used: kvUsed, // the other store, always, so a divergence shows in
                             // one response rather than needing two calls
            ceiling,
            remaining: Math.max(0, ceiling - used),
            // Present and null on an ordinary day, so an unusual ceiling always
            // carries its own explanation rather than looking like drift.
            standing_ceiling: ODDS_DAILY_CEILING,
            // WHO spent it. Absent until 2026-09-16: the daily total could not
            // be split by consumer, so "3,557/day" was one opaque number and a
            // per-consumer ceiling was unspeccable. A site present with 0 is
            // different from a site absent, so every KNOWN site is listed.
            by_site: sites,
            // The sum is reported SEPARATELY from `used` rather than assumed
            // equal. They can legitimately diverge — a site write can fail
            // while the total succeeds — and a reader must see that, not infer
            // it. `unaccounted` is the gap, named.
            by_site_sum: sum,
            unaccounted: sum === null ? null : used - sum,
            // Named, so a null above has a reason attached to it rather than
            // being a bare unknown the reader has to go looking for.
            unreadable_sites: unreadable.length ? unreadable : null,
            // null means the counter could not be read, NOT that nothing
            // degraded. The binding-absent path cannot write here at all — that
            // state surfaces as this route returning 503 instead.
            degraded_open: degraded,
            grant_today: grants.length ? grants : null,
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

// ---------------------------------------------------------------------------
// Task 1 of docs/CC-CMD-2026-09-18-atomic-odds-counter.md — the D1 schema that
// replaces the two non-atomic KV counters.
//
// STAGED — called by checkAndIncrementDailyOdds in Task 2. It has no caller
// today and must not acquire one outside that task (Rule 63). Unblock criteria
// per Rule 74 are in outbox/2026-09-19-odds-budget-schema.md.
//
// ARCHIVE_DB, AND THE CC-CMD SAID OTHERWISE. Task 1 as written specified
// "`DB` (field-d1), not `ARCHIVE_DB` (game archive)". Four measurements say
// that is wrong:
//
//   1. wrangler.toml gives `DB` and `WC2026_DB` the SAME database_id
//      (f26669de-...). They are two bindings onto one database, so "field-d1"
//      is the World Cup database under another name. The CC-CMD's own
//      "not WC2026_DB" and its "use DB" are the same instruction.
//   2. `env.DB` has FOUR references in the whole worker, all of them Whoop
//      OAuth tokens (src/index.js ~11311-11376, table `whoop_tokens`).
//      `env.ARCHIVE_DB` has 347.
//   3. Every runtime CREATE TABLE here is on ARCHIVE_DB — briefs,
//      codex_history, jq_retry_telemetry, change_log, analytics_runs,
//      analytics_output. None is on DB.
//   4. The odds tables that ALREADY exist — odds_history,
//      odds_backfill_progress — are in ARCHIVE_DB.
//
// Putting the odds budget in DB would have put it in the World Cup database,
// beside a fitness API's OAuth tokens, away from every other odds table.
//
// The shape follows ensureBriefsTable: idempotent, a module-level ready flag so
// the DDL runs once per isolate rather than on every guarded call, and a
// missing binding returns rather than throwing.
let _oddsBudgetReady = false;

// ---------------------------------------------------------------------------
// Task 2 — the three statements, exported so they can be read and mutated
// without a database.
//
// THE CC-CMD'S OWN SPEC WAS SELF-CONTRADICTORY, and this is the resolution.
// Task 2 said "All three in one env.DB.batch([...])" AND "Statement 3 runs only
// if statement 2 returned a row." Both cannot hold: a batch is submitted as a
// unit, so nothing can read statement 2's result and then decide whether to
// include statement 3. Taking the second sentence literally means two round
// trips and no transaction, which destroys the entire point of the change.
//
// THE FIX IS THE ORDER. Bump the site FIRST, reading the PRE-charge total, then
// charge the day. Both statements carry the same ceiling predicate over the same
// pre-charge value, so inside one transaction they either both apply or neither
// does — and no result needs inspecting. The daily UPDATE's RETURNING still
// gives the verdict, because it is last.
//
// Verified against real SQLite (node:sqlite, 2026-09-19) rather than reasoned
// about: ceiling 100 charged in units of 30 gave CHARGED/CHARGED/CHARGED/VETOED
// with daily and by-site equal at every step, and a vetoed call moved neither
// counter. Both statements parse — the INSERT..SELECT..WHERE..ON CONFLICT form
// is the one SQLite documents as ambiguous without a WHERE, and it has one.
const SQL_SEED   = 'INSERT OR IGNORE INTO odds_budget (day, used) VALUES (?, ?)';
const SQL_SITE   = `INSERT INTO odds_budget_site (day, site, used)
              SELECT ?, ?, ?
               WHERE (SELECT used FROM odds_budget WHERE day = ?) + ? <= ?
            ON CONFLICT(day, site) DO UPDATE SET used = used + excluded.used`;
const SQL_CHARGE = `UPDATE odds_budget SET used = used + ?
             WHERE day = ? AND used + ? <= ?
            RETURNING used`;

/** The batch, in order. Exported so a check can assert the ORDER, which is the
 *  whole correctness argument and is invisible from either statement alone. */
// A CORRECTION IS NOT A CHARGE, so neither statement carries the ceiling.
// reconcileOddsCredit applies the difference between the estimate and the
// vendor's receipt, and that difference must land whether or not the day is
// capped -- refusing a refund because the ceiling is reached would leave the
// ledger permanently above the bill. Clamped at zero on both arms, matching the
// KV behaviour it replaces and for the stated reason: a lost race must never
// drive a counter negative and hand back headroom that was genuinely spent.
const SQL_FIX_DAY  = 'UPDATE odds_budget SET used = MAX(0, used + ?) WHERE day = ?';
const SQL_FIX_SITE = `INSERT INTO odds_budget_site (day, site, used) VALUES (?, ?, MAX(0, ?))
            ON CONFLICT(day, site) DO UPDATE SET used = MAX(0, used + ?)`;

export const ODDS_BUDGET_SQL = { seed: SQL_SEED, site: SQL_SITE, charge: SQL_CHARGE,
                                 fixDay: SQL_FIX_DAY, fixSite: SQL_FIX_SITE };
export const ODDS_BUDGET_ORDER = ['seed', 'site', 'charge'];

/** Did the batch charge? The daily UPDATE returns its row only when the ceiling
 *  allowed it, so zero rows is a veto and not an error. Absent results (a shape
 *  this code has never seen) are NOT read as a veto: that would silently stop
 *  every odds call, so it throws to the degrade path where it is counted. */
export function chargedFromBatch(results) {
  if (!Array.isArray(results) || results.length !== 3) {
    throw new Error(`odds budget batch returned ${Array.isArray(results) ? results.length : typeof results} result(s), expected 3`);
  }
  const charge = results[2];
  if (!charge || !Array.isArray(charge.results)) {
    throw new Error('odds budget batch: the charge statement returned no results array');
  }
  return charge.results.length > 0;
}

async function ensureOddsBudgetTables(env) {
    if (_oddsBudgetReady) return true;
    if (!env || !env.ARCHIVE_DB) return false;
    await env.ARCHIVE_DB.batch([
        env.ARCHIVE_DB.prepare(`
            CREATE TABLE IF NOT EXISTS odds_budget (
              day  TEXT PRIMARY KEY,
              used INTEGER NOT NULL DEFAULT 0
            )`),
        // NOT a single `used` column keyed by day alone: the split is what lets
        // /budget/odds answer "by whom", which is the question odds:site:* was
        // added for. Composite PK so ON CONFLICT(day, site) DO UPDATE works.
        env.ARCHIVE_DB.prepare(`
            CREATE TABLE IF NOT EXISTS odds_budget_site (
              day  TEXT NOT NULL,
              site TEXT NOT NULL,
              used INTEGER NOT NULL DEFAULT 0,
              PRIMARY KEY (day, site)
            )`),
    ]);
    _oddsBudgetReady = true;
    return true;
}

// The table names, exported so a check can assert they are readable from CI
// rather than hardcoding a second copy of the list. Task 0b found that
// /d1/execute refuses any table outside its ALLOWED_TABLES with a 403 — which
// reads identically to a D1 failure from outside, so a probe against an
// unlisted table reports a database property it never measured.
export const ODDS_BUDGET_TABLES = ['odds_budget', 'odds_budget_site'];

export {
    ODDS_DAILY_CEILING,
    checkAndIncrementDailyOdds,
    peekDailyOdds,
    peekMonthlyOdds,
    ensureOddsBudgetTables,
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

        // All THREE layers, since all three were charged the estimate. Read-
        // modify-write, non-atomic, exactly as the counters they adjust already
        // are -- and clamped at zero so a lost race can never drive a ledger
        // negative and hand back headroom that was genuinely spent.
        //
        // THE SITE LAYER WAS MISSING UNTIL 2026-09-16 AND THAT IS MEASURABLE.
        // odds:site:* accumulated the pre-charge ESTIMATE while odds:daily:*
        // accumulated the estimate PLUS this correction, so the two counted
        // different things. Live, 19:04Z to 19:17Z: used +446, by_site_sum +549.
        // `unaccounted` read 209 then 106 and was on its way negative -- it was
        // never unnamed spend, it was the net refund, wearing the name of a gap.
        const day   = `odds:daily:${new Date().toISOString().slice(0, 10)}`;
        const d     = new Date();
        const month = `odds:credits:${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
        // THE CORRECTION FOLLOWS THE CHARGE INTO D1. Leaving this on KV while
        // checkAndIncrementDailyOdds charges D1 would recreate the exact defect
        // the comment above describes, one layer down: the two stores would
        // disagree by every reconciliation, and the disagreement would again
        // wear the name of a gap.
        //
        // One batch, so the day and the site cannot take a correction singly.
        try {
            if (await ensureOddsBudgetTables(env)) {
                const db = env.ARCHIVE_DB;
                await db.batch([
                    db.prepare(ODDS_BUDGET_SQL.fixDay).bind(out.delta, out.day || day.slice('odds:daily:'.length)),
                    db.prepare(ODDS_BUDGET_SQL.fixSite).bind(day.slice('odds:daily:'.length), site, out.delta, out.delta),
                ]);
            }
        } catch (e) {
            // A failed correction must not fail the fetch that already happened.
            // It is recorded rather than swallowed: an uncorrected estimate is a
            // known overcount, and a silent one is the 2026-09-16 defect again.
            console.warn(`[odds-reconcile] D1 correction failed for ${site} delta=${out.delta}: ${String(e.message || e).slice(0, 120)}`);
        }
        await _bumpSite(env, site, out.delta);
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

// ── Rule 99 (DISTINGUISHABILITY-A) ──────────────────────────────────────────
// Read the vendor's remaining-credit header as `number | null`, where null means
// "the vendor did not tell us" -- a SIBLING of the number, never a member of it.
//
// Why this exists. Every odds fetcher runs with `cacheEverything: true`, and a
// Cloudflare edge cache hit returns the body WITHOUT `x-requests-remaining`.
// The previous form, `parseInt(h || '0', 10) || 0`, mapped that onto 0, which
// then read as "no credits left" at the quota floor. Measured 2026-09-11: MLS
// 0/17 rows, Bundesliga 0/2, CFB 0/4, NFL 0/1 across two dates, while the
// account sat at 44,235 of 100,000 credits used. Nothing was exhausted.
//
// An unparseable value is null too, for the same reason: it is not a reading.
// Callers must gate on `typeof q === 'number'`, never on truthiness -- a
// genuine 0 IS a reading and must stop the loop.
export function readQuotaHeader(res) {
    const raw = res && res.headers ? res.headers.get('x-requests-remaining') : null;
    if (raw === null || raw === undefined || String(raw).trim() === '') return null;
    const n = parseInt(String(raw), 10);
    return Number.isFinite(n) ? n : null;
}

