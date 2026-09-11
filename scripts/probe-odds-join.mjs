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
// COST: 1 Odds-API credit per sport, hard-capped at 5 by the route. Four sports
// probed = 4 credits against a 20,000 plan (Rule 78). The route's own
// consumeOddsCredit guard still applies.

import { writeFileSync } from 'node:fs';

const RELAY = 'https://field-relay-nba.jeffunglesbee.workers.dev';
const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

// The four competitions the census showed at zero, plus MLS -- which is the
// control: it is partial rather than zero, so it must come back with a nonzero
// matched count. If MLS reads as a total miss too, the probe is measuring
// itself rather than the data.
const SPORTS = ['CFB', 'NFL', 'Bundesliga', 'MLS'];

const DATE = (process.env.PROBE_DATE || new Date().toISOString().slice(0, 10)).trim();
if (!/^\d{4}-\d{2}-\d{2}$/.test(DATE)) {
    console.error(`PROBE_DATE must be YYYY-MM-DD, got ${JSON.stringify(DATE)}`);
    process.exit(1);
}

// Field names read from src/index.js:14935-14942, not assumed: `matched` is a
// COUNT (matched.length), `unmatched` is the ARRAY, alongside odds_events and
// d1_missing. An earlier draft of this probe read `matched` as an array; it
// would have reported every sport as a shape failure.
export function classify(e, date) {
    if (!e) return 'ABSENT_FROM_REPORT';
    if (e.error) return `C1_VENDOR: ${e.error}`;
    const mt = typeof e.matched === 'number' ? e.matched : null;
    const un = Array.isArray(e.unmatched) ? e.unmatched.length : null;
    const ev = typeof e.odds_events === 'number' ? e.odds_events : null;
    const d1 = typeof e.d1_missing === 'number' ? e.d1_missing : null;
    if (mt === null || un === null || ev === null || d1 === null)
        return `SHAPE_UNEXPECTED: ${JSON.stringify(Object.keys(e))}`;
    if (d1 === 0) return `NO_ROWS: no NULL-opening rows on ${date} (vendor had ${ev} events)`;
    if (ev === 0) return `C1_VENDOR: fetch ok but 0 events served for ${e.sport_key}`;
    if (mt === 0) return `C2_JOIN: ${d1} D1 rows, ${ev} vendor events, 0 matched`;
    return `COVERED: ${mt} matched of ${d1} rows (${ev} vendor events, ${un} unmatched)`;
}

// Rule 90: the classifier is what turns numbers into a CAUSE, so it is the part
// most able to be confidently wrong. Each fixture targets a distinct verdict; a
// classifier collapsed onto one branch fails here rather than in the write-up.
// Runs every invocation -- no network, no cost.
const FIXTURES = [
    [{ error: 'Odds-API fetch failed', sport_key: 'americanfootball_ncaaf' },                 'C1_VENDOR'],
    [{ sport_key: 'x', odds_events: 0,  d1_missing: 5, matched: 0, unmatched: [] },           'C1_VENDOR'],
    [{ sport_key: 'x', odds_events: 12, d1_missing: 5, matched: 0, unmatched: [1,2,3,4,5] },  'C2_JOIN'],
    [{ sport_key: 'x', odds_events: 12, d1_missing: 5, matched: 4, unmatched: [1] },          'COVERED'],
    [{ sport_key: 'x', odds_events: 12, d1_missing: 0, matched: 0, unmatched: [] },           'NO_ROWS'],
    [{ sport_key: 'x', odds_events: 12, d1_missing: 5, matched: [4], unmatched: [1] },        'SHAPE_UNEXPECTED'],
    [undefined,                                                                               'ABSENT_FROM_REPORT'],
];
{
    const bad = FIXTURES.filter(([f, want]) => !classify(f, '2026-01-01').startsWith(want));
    if (bad.length) {
        console.error('CLASSIFIER SELF-TEST FAILED:');
        for (const [f, want] of bad) console.error(`  wanted ${want}, got ${classify(f, '2026-01-01')}`);
        process.exit(1);
    }
    const distinct = new Set(FIXTURES.map(([f]) => classify(f, '2026-01-01').split(':')[0]));
    if (distinct.size < 5) {
        console.error(`CLASSIFIER COLLAPSED: ${FIXTURES.length} fixtures gave only ${distinct.size} verdicts`);
        process.exit(1);
    }
    console.log(`classifier self-test: ${FIXTURES.length}/${FIXTURES.length} fixtures, ${distinct.size} distinct verdicts`);
}

const m = {
    probed_at: new Date().toISOString(),
    probe_date: DATE,
    sports_requested: SPORTS,
    http: null,
    report: null,
    verdict: {},          // per sport: C1_VENDOR | C2_JOIN | COVERED | NO_ROWS
    error: null,
};

const url = `${RELAY}/identity/mismatches?date=${DATE}&sports=${encodeURIComponent(SPORTS.join(','))}`;
try {
    const r = await fetch(url, { headers: { 'User-Agent': UA } });
    m.http = r.status;
    const t = await r.text();
    // The sandbox proxy answers 403 with an HTML body that JSON.parse would
    // reject anyway, but a proxy page that happened to parse must not be read
    // as a relay answer: require the response to echo the date we asked for.
    let j = null;
    try { j = JSON.parse(t); } catch (_) {
        m.error = `non-JSON body (${t.length} bytes): ${t.slice(0, 200)}`;
    }
    if (j) {
        if (j.date !== DATE) {
            m.error = `body did not echo the requested date (got ${JSON.stringify(j.date)}) — not a relay answer`;
        } else {
            m.report = j;
            for (const sp of SPORTS) m.verdict[sp] = classify(j.sports?.[sp], DATE);
        }
    }
} catch (e) { m.error = String(e.message || e); }

const stamp = m.probed_at.replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
const out = `outbox/odds-join-probe-${stamp}.json`;
writeFileSync(out, JSON.stringify(m, null, 2) + '\n');
console.log(JSON.stringify(m, null, 2));
console.log(`\nwrote ${out}`);
console.log(`\nprobed ${SPORTS.length} of ${SPORTS.length} requested sports on ${DATE} (Rule 91)`);
if (m.error) { console.error(`PROBE FAILED: ${m.error}`); process.exit(1); }
