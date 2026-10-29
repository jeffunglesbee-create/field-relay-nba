#!/usr/bin/env node
// Why CFB, NFL and Bundesliga carry ZERO odds -- ever.
//
// Measured 2026-09-11 (outbox/odds-api-probe-20260911T200607Z.json), whole
// season to date:
//
//   CFB        105 rows   0 opening   0 closing
//   NFL         50 rows   0 opening   0 closing
//   Bundesliga  19 rows   0 opening   0 closing
//   MLS        586 rows 180 opening 109 closing   <- partial, not zero
//   MLB       1116 rows 984 opening 941 closing
//
// The mapping hypothesis is DEAD for all three: archiveSportToOddsKey resolves
// 'CFB' -> americanfootball_ncaaf, 'NFL' -> americanfootball_nfl and
// 'Bundesliga' -> soccer_germany_bundesliga, all three present in
// ARCHIVE_SPORT_TO_ODDS_KEY. So is the timing hypothesis (H1): today's rows were
// created 10:01:13-10:01:27 and odds_api wrote at 10:01:39-10:01:43, after them.
//
// Zero-across-a-season also does not look like the quota short-circuit (H2):
// snapshotCronOdds' `return` on a low quota starves whichever sports fall late
// in D1's DISTINCT order, and that order varies day to day, so starvation
// produces PARTIAL coverage -- which is exactly MLS's 31%. An exact zero over
// 105 rows is structural.
//
// Two structural causes remain, and they need opposite fixes:
//
//   C1 VENDOR. fetchSportOddsLive returns ok:false -- the key is not served, or
//      not served right now. Then there is nothing to fix in our code and the
//      correct action is to stop listing the sport.
//
//   C2 IDENTITY JOIN. The fetch succeeds but every
//      `resolveTeamKey(home)|resolveTeamKey(away)` pair misses, so `if (!og)
//      continue` drops every row silently. CFB's ~130 schools are the obvious
//      candidate. Then the fix is the alias map, and the sport list is fine.
//
// /identity/mismatches distinguishes them in one call: it reports
// `error: 'Odds-API fetch failed'` for C1, and a matched/unmatched split with
// the actual unmatched names for C2. It uses the relay's OWN ODDS_API_KEY
// binding, so no key is needed here and none is read from env.
//
// COST: the relay's ledger estimate is oddsCreditCost 3 per fetchSportOddsLive call, so 12 per run for the four
// sports (the provider's actual bill is unmeasured; the call is edge-cached for 900 s). The route is hard-capped at
// 5 sports a call and charged to its own label, 'identityMismatches', cap 150 a day (Rule 78).
//
// CHANGED 2026-10-29 (docs/CC-CMD-2026-10-19-cfb-saturday-coverage-and-join-probe.md, B1(a) and B2):
//  - the route is behind FIELD_MCP_SECRET, so this script sends it and REFUSES to run without it;
//  - the route joins the way the relay's writers do and reports d1_rows and d1_priced, so a join that works
//    (every row already priced) is told apart from a date with no rows at all;
//  - there is no default date. The scheduled run starts hours after its cron time and used to probe the UTC
//    day that had just begun (all 7 scheduled artifacts, 2026-09-13 to 10-25, are dated Sundays). PROBE_DATE is required, and
//    EXPECT_WEEKDAY=6 refuses a date that is not a Saturday;
//  - a verdict that fails the run for CFB (a refusal: no rows at all though the feed lists the slate, an unreadable or
//    inconsistent denominator, the vendor or our guard answering instead; or C2_JOIN, upcoming unpriced rows and
//    nothing joined) exits non-zero, so the run is not green;
//  - the secret is redacted from every message this script writes: the artifact is committed to main.
// The reading of the report is scripts/lib/odds-join-probe.mjs, executed by scripts/check-odds-join-probe.mjs.

import { writeFileSync, mkdirSync } from 'node:fs';
import { SPORTS, REQUIRED, classify, isRefusal, failsRun, weekdayOf } from './lib/odds-join-probe.mjs';

// RELAY_URL and OUT_DIR are seams for scripts/check-odds-join-probe.mjs, which runs this file against a local server.
const RELAY = (process.env.RELAY_URL || 'https://field-relay-nba.jeffunglesbee.workers.dev').replace(/\/$/, '');
const OUT_DIR = process.env.OUT_DIR || 'outbox';
const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

const fail = (msg) => { console.error(`PROBE REFUSED: ${msg}`); process.exit(1); };
// An unset variable reads as the empty string, said once here (a collapse written inline is what the absence-collapse
// ratchet counts); every caller below treats the empty string as "not given" and refuses.
const envText = (name) => (typeof process.env[name] === 'string' ? process.env[name].trim() : '');

const DATE = envText('PROBE_DATE');
if (!/^\d{4}-\d{2}-\d{2}$/.test(DATE)) fail(`PROBE_DATE must be YYYY-MM-DD and has no default, got ${JSON.stringify(DATE)}`);
const WANT_DAY = envText('EXPECT_WEEKDAY');
if (WANT_DAY !== '' && weekdayOf(DATE) !== Number(WANT_DAY))
    fail(`PROBE_DATE ${DATE} is weekday ${weekdayOf(DATE)}, this run expects ${WANT_DAY} (0 = Sunday)`);
const SECRET = envText('FIELD_MCP_SECRET');
if (!SECRET) fail('FIELD_MCP_SECRET is not set: /identity/mismatches is gated and a probe without it measures nothing');

const m = {
    probed_at: new Date().toISOString(),
    probe_date: DATE,
    sports_requested: SPORTS,
    http: null,
    report: null,
    verdict: {},          // per sport: CODE: detail (see scripts/lib/odds-join-probe.mjs)
    failed: [],           // the REQUIRED sports whose verdict fails the run (a refusal, or C2_JOIN)
    error: null,
};

// Node's header validation error quotes the whole Authorization value, and the artifact is committed to main.
const redact = (text) => String(text).split(SECRET).join('[redacted]');

const url = `${RELAY}/identity/mismatches?date=${DATE}&sports=${encodeURIComponent(SPORTS.join(','))}`;
try {
    const r = await fetch(url, { headers: { 'User-Agent': UA, Authorization: `Bearer ${SECRET}` } });
    m.http = r.status;
    const t = await r.text();
    if (r.status === 401) m.error = 'HTTP 401: FIELD_MCP_SECRET did not match the relay\'s';
    else if (r.status !== 200) m.error = `HTTP ${r.status}: ${t.slice(0, 200)}`;
    else {
        // The sandbox proxy answers 403 with an HTML body that JSON.parse would
        // reject anyway, but a proxy page that happened to parse must not be read
        // as a relay answer: require the response to echo the date we asked for.
        let j = null;
        try { j = JSON.parse(t); } catch (_) {
            m.error = `non-JSON body (${t.length} bytes): ${t.slice(0, 200)}`;
        }
        // JSON null, false and 0 parse without error and are not a report: they used to skip this block and exit 0.
        if (j === null || typeof j !== 'object') {
            if (!m.error) m.error = `body is not a JSON object (${t.length} bytes): ${t.slice(0, 120)}`;
        } else {
            if (j.date !== DATE) {
                m.error = `body did not echo the requested date (got ${JSON.stringify(j.date)}) — not a relay answer`;
            } else {
                m.report = j;
                const now = Date.now();
                for (const sp of SPORTS) m.verdict[sp] = classify(j.sports?.[sp], DATE, now);
                m.failed = REQUIRED.filter(sp => failsRun(m.verdict[sp]));
            }
        }
    }
} catch (e) { m.error = redact(e.message || e); }

const stamp = m.probed_at.replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
mkdirSync(OUT_DIR, { recursive: true });
const out = `${OUT_DIR}/odds-join-probe-${stamp}.json`;
writeFileSync(out, JSON.stringify(m, null, 2) + '\n');
console.log(JSON.stringify(m, null, 2));
console.log(`\nwrote ${out}`);
// Rule 91: the denominators are COUNTS of what happened, not the length of the request list.
const answered = SPORTS.filter(sp => m.report && m.report.sports && m.report.sports[sp] !== undefined).length;
const measured = SPORTS.filter(sp => m.verdict[sp] !== undefined && !isRefusal(m.verdict[sp])).length;
console.log(`\nrelay answered for ${answered} of ${SPORTS.length} requested sports on ${DATE}; ${measured} of them measured (verdict is not a refusal) (Rule 91)`);
if (m.error) { console.error(`PROBE FAILED: ${m.error}`); process.exit(1); }
if (m.failed.length) {
    for (const sp of m.failed) console.error(`PROBE FAILED for ${sp}: ${m.verdict[sp]}`);
    process.exit(1);
}
