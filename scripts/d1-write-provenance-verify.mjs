// TASK 3 OF CC-CMD-2026-09-02-d1-write-provenance: the census and the control.
//
// TWO PHASES, AND THE CONTROL IS THE ONE THAT GATES EVERYTHING.
//
// A. CENSUS — a falsification attempt against `idScheme`. The predicate that
//    separates the external writer's ids from ours was written from two observed
//    examples, and a predicate asserted only against strings that already pass is
//    not asserted at all. This runs it over EVERY id in both archive tables and
//    prints the buckets with examples, so an id the predicate misfiles is visible
//    rather than inferred. It does not write.
//
// B. CONTROL — the reason the CC-CMD exists in the shape it does. "No entries in
//    48 hours" and "the instrument never worked" produce identical output, and
//    the thing being watched fires about once a day at an unpredictable time. So
//    a deliberate write is issued through each instrumented site, carrying the
//    control header. Until that passes, no observation window has started and a
//    null result downstream means nothing.
//
//    The CC-CMD said "exactly one entry per path". The transport cannot deliver
//    that and the dataset says so in its own column — see WRITES_PER_REQUEST for
//    the measurement and for what the assertion became instead.
//
// C. READBACK — no writes, a wide window. It exists because "the instrument
//    dropped writes" and "Analytics Engine has not ingested them yet" look
//    identical at minute three, and only looking later separates them.
//
// THE ONE SITE THAT CANNOT BE CONTROLLED SYNTHETICALLY is reported as its own
// state rather than folded into a pass or a failure — see BEST_EFFORT below.
//
// Synthetic 2099 dates so no real slate is written to, and everything this
// script creates is deleted at the end with emptiness asserted, not assumed.
//
// Usage:  node scripts/d1-write-provenance-verify.mjs            both phases
//         node scripts/d1-write-provenance-verify.mjs --census   read-only
//         node scripts/d1-write-provenance-verify.mjs --control
//         node scripts/d1-write-provenance-verify.mjs --readback  read-only, wide window

import { idScheme, D1_WRITE_SITES, D1_WRITE_INDEX, CONTROL_HEADER } from '../src/d1-provenance.js';

const RELAY = 'https://field-relay-nba.jeffunglesbee.workers.dev';
const UA = 'field-relay-provenance-control/1';

// The variable, never the value — docs/exposed-secrets.sha256 and the ratchet
// that counts hard-coded uses. No default: an unset secret must be
// distinguishable from a set one before the relay 401s.
const RELAY_GATE = process.env.RELAY_SHARED_SECRET;
const MCP_SECRET = process.env.FIELD_MCP_SECRET;
const CF_TOKEN = process.env.CLOUDFLARE_API_TOKEN;
const CF_ACCOUNT = process.env.CLOUDFLARE_ACCOUNT_ID;

const DATE_REG = '2099-04-01';   // /archive/game:regular + writeMLBSeriesResult
const DATE_POST = '2099-04-02';  // /archive/game:postseason
const GHOST = 'PROVENANCE_CONTROL_2099_no_such_row';  // an id that matches nothing

let failed = 0;
const assert = (name, ok, detail) => {
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
    if (!ok) { failed++; if (detail) console.log(`      ${detail}`); }
};

const need = (v, name) => {
    if (!v) { console.error(`${name} is not set. This script will not guess it.`); process.exit(1); }
    return v;
};

async function d1(sql, params = []) {
    const r = await fetch(`${RELAY}/d1/execute`, {
        method: 'POST',
        headers: { 'X-FIELD-Relay': need(RELAY_GATE, 'RELAY_SHARED_SECRET'), 'Content-Type': 'application/json', 'User-Agent': UA },
        body: JSON.stringify({ sql, params }),
    });
    const t = await r.text();
    if (!r.ok) throw new Error(`HTTP ${r.status}: ${t.slice(0, 200)}`);
    const j = JSON.parse(t);
    if (j.ok === false) throw new Error(`relay error: ${j.error}`);
    return j.results || [];
}

// ─── A. CENSUS ────────────────────────────────────────────────────────────────
async function census() {
    console.log('\n=== A. id-scheme census — every id in both archive tables ===');
    const buckets = new Map();
    for (const table of ['regular_season_games', 'postseason_games']) {
        const rows = await d1(`SELECT id FROM ${table}`);
        console.log(`  ${table}: ${rows.length} row(s)`);
        for (const r of rows) {
            const k = idScheme(r.id);
            if (!buckets.has(k)) buckets.set(k, []);
            buckets.get(k).push(r.id);
        }
    }
    const total = [...buckets.values()].reduce((a, b) => a + b.length, 0);
    console.log(`\n  ${total} id(s) classified:`);
    for (const [k, ids] of [...buckets.entries()].sort((a, b) => b[1].length - a[1].length))
        console.log(`    ${String(ids.length).padStart(5)}  ${k.padEnd(11)} e.g. ${ids.slice(0, 4).join(', ')}`);

    const n = (k) => (buckets.get(k) || []).length;

    // THE CENSUS IS A MEASUREMENT, AND ITS OWN CONTROL. A run that classified
    // nothing would print an empty table and look calm, so the first assertion is
    // that it saw rows at all.
    assert('the census read rows at all', total > 0, 'zero ids classified — nothing was measured');
    assert('our own scheme is present', n('underscore') > 0,
        'every id this repo builds carries a ${SPORT}_ prefix; none found means the predicate, '
        + 'not the data, is wrong');

    // The falsification surface. `other` is where a misfiled external id would
    // land, so it is printed in full rather than sampled.
    const other = buckets.get('other') || [];
    if (other.length) {
        console.log(`\n  ALL ${other.length} \`other\` id(s) — read these; a dash-scheme id misfiled here would`);
        console.log('  make the instrument blind to the exact write it exists to catch:');
        for (const id of other) console.log(`    ${id}`);
    } else {
        console.log('\n  no `other` ids — every id falls in a named scheme');
    }
    console.log(`\n  dash-scheme rows present in the archive right now: ${n('dash')}`);
    console.log('  (a count, not a verdict: these rows predate the instrumentation and');
    console.log('   carry no provenance entry — only writes AFTER the deploy are attributable)');
    return { buckets, total };
}

// ─── B. CONTROL ───────────────────────────────────────────────────────────────
const CONTROL_HEADERS = {
    'Content-Type': 'application/json',
    'User-Agent': UA,
    [CONTROL_HEADER]: '1',
};

async function post(path, body, extraHeaders = {}) {
    const r = await fetch(`${RELAY}${path}`, {
        method: 'POST',
        headers: { ...CONTROL_HEADERS, ...extraHeaders },
        body: JSON.stringify(body),
    });
    return { status: r.status, body: (await r.text()).slice(0, 220) };
}

async function ae(sql) {
    const r = await fetch(
        `https://api.cloudflare.com/client/v4/accounts/${need(CF_ACCOUNT, 'CLOUDFLARE_ACCOUNT_ID')}/analytics_engine/sql`,
        { method: 'POST', headers: { Authorization: `Bearer ${need(CF_TOKEN, 'CLOUDFLARE_API_TOKEN')}`, 'User-Agent': UA }, body: sql });
    if (!r.ok) throw new Error(`AE HTTP ${r.status}: ${(await r.text()).slice(0, 200)}`);
    return (await r.json()).data ?? [];
}

// WHAT THE CONTROL CAN PROVE, AND WHY IT IS NOT "ONE ROW PER SITE".
//
// The CC-CMD asked for exactly one entry per instrumented path. The transport
// cannot deliver that, and the dataset says so in its own column. MEASURED
// 2026-09-03, run 33712204759 and its readback 33712493470: each request that
// issued TWO provenance writes produced ONE row carrying `_sample_interval = 2`;
// the one request that issued a single write produced a row with 1. Analytics
// Engine keeps a subset of the data points written in one Worker invocation and
// records, per surviving row, how many it stands for. Latency was ruled out —
// the readback five minutes later found the same five rows.
//
// So the assertion moves to the quantity the transport does preserve:
// `sum(_sample_interval)` across the run must equal the number of writes actually
// issued. That is per-site proof in aggregate — remove any single call site and
// the total drops by one — and it is paired with the static wiring check in
// scripts/d1-provenance-check.mjs, which proves each site individually by reading
// the source with mutation-proven teeth.
//
// WHAT IS GENUINELY LOST is which of two doors inside ONE request. Nothing else:
// both writes in every pair target the same row id, so they carry the same
// blob1, and the scheme — the column the whole CC-CMD turns on — survives
// sampling intact.
const WRITES_PER_REQUEST = [
    ['R1 /archive/game (MLB, clinching)', 2, ['/archive/game:regular', 'writeMLBSeriesResult:regular']],
    ['R2 /archive/game (series_key)', 1, ['/archive/game:postseason']],
    ['R3 /archive/score-by-id (espn)', 2, ['/archive/score-by-id:regular-espn', '/archive/score-by-id:postseason-espn']],
    ['R4 /archive/score-by-id (no espn)', 2, ['/archive/score-by-id:regular', '/archive/score-by-id:postseason']],
    ['R5 /archive/drama-by-id', 2, ['/archive/drama-by-id:regular', '/archive/drama-by-id:postseason']],
];
const EXPECTED_SI = WRITES_PER_REQUEST.reduce((a, [, n]) => a + n, 0);       // 9
const EXPECTED_ROWS = WRITES_PER_REQUEST.length;                              // 5
// The only request that writes exactly one point, so the only site guaranteed
// its own unsampled row. Everything else is provable in aggregate, not by name.
const UNSAMPLED_SITE = '/archive/game:postseason';
const BEST_EFFORT = '/admin/archive/backfill-went-to-ot:regular';

async function control() {
    console.log('\n=== B. control — one deliberate write through each instrumented site ===');

    // Pre-check: a leftover row would let a later assertion pass for the wrong
    // reason, and would make /archive/game an UPDATE rather than the INSERT the
    // site name claims.
    for (const d of [DATE_REG, DATE_POST]) {
        const pre = await d1(`SELECT id FROM regular_season_games WHERE date = ?`, [d]);
        const preP = await d1(`SELECT id FROM postseason_games WHERE date = ?`, [d]);
        if (pre.length || preP.length) {
            console.log(`  clearing ${pre.length + preP.length} leftover row(s) on ${d}`);
            await d1(`DELETE FROM regular_season_games WHERE date = ?`, [d]);
            await d1(`DELETE FROM postseason_games WHERE date = ?`, [d]);
        }
    }

    const since = new Date(Date.now() - 60_000).toISOString();

    // R1 — /archive/game:regular AND writeMLBSeriesResult:regular. series_record
    // '3-0' with the home side winning is what detectMLBSeriesOutcome reads as a
    // clinching sweep, which is the only way to reach that function.
    console.log('  R1 /archive/game (MLB, clinching series_record) →',
        JSON.stringify(await post('/archive/game', {
            sport: 'MLB', date: DATE_REG, home: 'Provenance Home', away: 'Provenance Away',
            home_score: 5, away_score: 3, series_record: '3-0',
        })));

    // R2 — /archive/game:postseason. series_key routes to the other table.
    console.log('  R2 /archive/game (series_key) →',
        JSON.stringify(await post('/archive/game', {
            sport: 'MLB', date: DATE_POST, series_key: 'PROVENANCE_CONTROL_SERIES',
            round: 'CTRL', game_number: 1, home: 'Provenance Home', away: 'Provenance Away',
            home_score: 2, away_score: 1,
        })));

    // R3/R4 — /archive/score-by-id, both branches. A GHOST id matches nothing, so
    // the regular UPDATE changes 0 rows and the postseason UPDATE runs after it:
    // both sites fire from one request, which is exactly the pairing the site
    // names exist to keep apart.
    console.log('  R3 /archive/score-by-id (with espn_event_id) →',
        JSON.stringify(await post('/archive/score-by-id',
            { id: GHOST, home_score: 1, away_score: 0, espn_event_id: '999000222' })));
    console.log('  R4 /archive/score-by-id (no espn_event_id) →',
        JSON.stringify(await post('/archive/score-by-id',
            { id: GHOST, home_score: 1, away_score: 0 })));

    // R5 — /archive/drama-by-id, both branches, same GHOST reasoning.
    console.log('  R5 /archive/drama-by-id →',
        JSON.stringify(await post('/archive/drama-by-id',
            { id: GHOST, drama_peak: 1, drama_arc: 'control' })));

    // R6 — the best-effort one. Auth is real; the data condition may not hold.
    if (MCP_SECRET) {
        console.log('  R6 /admin/archive/backfill-went-to-ot (limit 1) →',
            JSON.stringify(await post('/admin/archive/backfill-went-to-ot', { limit: 1 },
                { Authorization: `Bearer ${MCP_SECRET}` })));
    } else {
        console.log('  R6 SKIPPED — FIELD_MCP_SECRET not set');
    }

    // ── read back ────────────────────────────────────────────────────────────
    // Analytics Engine ingests asynchronously. Poll rather than sleep once and
    // conclude: a single early read would report zero and look exactly like a
    // dead instrument, which is the failure mode this whole task is about.
    const q = `SELECT blob1 AS scheme, blob2 AS site, blob3 AS verb, blob4 AS tbl,
                      blob5 AS ua, blob6 AS country, blob7 AS asn, _sample_interval AS si
               FROM field_jq_analytics
               WHERE index1 = '${D1_WRITE_INDEX}' AND timestamp > toDateTime('${since.slice(0, 19).replace('T', ' ')}')
               ORDER BY site FORMAT JSON`;
    // Analytics Engine ingests asynchronously. Poll rather than read once and
    // conclude: a single early read would report zero and look exactly like a
    // dead instrument, which is the failure mode this whole task is about. The
    // stop condition is the sample-interval total, not a site count, for the
    // reason set out above WRITES_PER_REQUEST.
    let rows = [];
    const siOf = (rs) => rs.reduce((a, r) => a + Number(r.si ?? 1), 0);
    for (let attempt = 1; attempt <= 12; attempt++) {
        rows = await ae(q);
        if (siOf(rows) >= EXPECTED_SI) break;
        console.log(`  attempt ${attempt}: ${siOf(rows)}/${EXPECTED_SI} write(s) visible, waiting 15s`);
        await new Promise(r => setTimeout(r, 15_000));
    }

    console.log('\n  Analytics Engine, index1=d1-write, since this run began:');
    if (!rows.length) console.log('    (no rows)');
    for (const r of rows)
        console.log(`    si=${r.si}  ${String(r.site).padEnd(38)} scheme=${r.scheme} ${r.verb} ${r.tbl} ${r.country}/${r.asn} ${r.ua}`);

    console.log('\n  requests issued, and the writes each made:');
    for (const [label, n, sites] of WRITES_PER_REQUEST)
        console.log(`    ${n}  ${label.padEnd(36)} ${sites.join(', ')}`);

    // THE ASSERTION THAT REPLACES "one entry per site". Falsifiable per site:
    // delete any one recordD1Write call and this total is 8, not 9.
    assert(`every one of the ${EXPECTED_SI} control writes reached the dataset`,
        siOf(rows) === EXPECTED_SI,
        `sum(_sample_interval) = ${siOf(rows)}. Below ${EXPECTED_SI} means a call site did not `
        + `execute; above means an unaccounted write path fired.`);

    assert(`${EXPECTED_ROWS} surviving row(s) — one per request`, rows.length === EXPECTED_ROWS,
        `saw ${rows.length}; each Worker invocation keeps one point`);

    assert(`${UNSAMPLED_SITE} is present by name`,
        rows.some(r => r.site === UNSAMPLED_SITE),
        'this is the only request that writes a single point, so it is the only site '
        + 'whose row cannot be sampled away — if it is missing, the loss is not sampling');

    assert('every surviving site is one this build declares',
        rows.every(r => D1_WRITE_SITES.includes(r.site)),
        `undeclared: ${rows.map(r => r.site).filter(x => !D1_WRITE_SITES.includes(x)).join(', ')}`);

    assert('every control entry carries scheme=control', rows.every(r => r.scheme === 'control'),
        `schemes seen: ${[...new Set(rows.map(r => r.scheme))].join(', ')}`);

    assert('every control entry carries a country and an ASN, and no more',
        rows.every(r => r.country && r.asn && r.ua && !/\d+\.\d+\.\d+\.\d+/.test(String(r.ua))),
        'country/asn answer "which system"; an IP would identify a machine and must never appear');

    // Three states, and the middle one is not a pass.
    const best = rows.filter(r => r.site === BEST_EFFORT).length;
    if (best > 0) console.log(`PASS  ${BEST_EFFORT}: present — a real row resolved`);
    else console.log(`NOT OBSERVABLE  ${BEST_EFFORT}: absent. Not a failure and not a pass — the route\n`
        + '      writes only when a real MLB/WNBA row with a NULL went_to_ot matches a live\n'
        + '      /v2/games entry for its date, and no synthetic row can produce that (the run\n'
        + '      above reports `no v2/games match` for the 2099 row it was handed). It is an\n'
        + '      UPDATE, so it cannot create a row of any scheme; its silence does not weaken\n'
        + '      the finding, and this line says so rather than omitting the site.');

    // ── cleanup ──────────────────────────────────────────────────────────────
    console.log('\n=== cleanup ===');
    for (const d of [DATE_REG, DATE_POST]) {
        await d1(`DELETE FROM regular_season_games WHERE date = ?`, [d]);
        await d1(`DELETE FROM postseason_games WHERE date = ?`, [d]);
        const l = (await d1(`SELECT id FROM regular_season_games WHERE date = ?`, [d])).length
                + (await d1(`SELECT id FROM postseason_games WHERE date = ?`, [d])).length;
        assert(`cleanup: ${d} is empty`, l === 0, `${l} row(s) remain`);
    }
    // writeMLBSeriesResult also inserts a brief; it is this script's row too.
    await d1(`DELETE FROM briefs WHERE date = ? AND brief_type = 'mlb_series_result'`, [DATE_REG]);
    const leftBriefs = await d1(`SELECT id FROM briefs WHERE date = ?`, [DATE_REG]);
    assert('cleanup: the control brief is gone', leftBriefs.length === 0,
        `${leftBriefs.length} brief(s) remain`);
}

// ─── READBACK ─────────────────────────────────────────────────────────────────
// Read what Analytics Engine actually holds, with no writes and a wide window.
//
// WHY THIS IS ITS OWN MODE. The first control run saw 5 of 9 sites and plateaued
// there for eight consecutive polls, which has two readings that produce
// identical output at minute three: the instrument dropped four writes, or AE had
// not ingested them yet. Polling harder inside the same run cannot separate
// those — only looking later can, and a mode that does nothing but look keeps the
// second reading testable without issuing more writes to confuse the count.
async function readback() {
    console.log('\n=== readback — every d1-write entry in the last 6 hours, ungrouped ===');
    const rows = await ae(`SELECT timestamp, blob1 AS scheme, blob2 AS site, blob3 AS verb, blob4 AS tbl,
                                  blob5 AS ua, blob6 AS country, blob7 AS asn, _sample_interval AS si
                           FROM field_jq_analytics
                           WHERE index1 = '${D1_WRITE_INDEX}' AND timestamp > NOW() - INTERVAL '6' HOUR
                           ORDER BY timestamp FORMAT JSON`);
    console.log(`  ${rows.length} entr(ies)`);
    for (const r of rows)
        console.log(`    ${r.timestamp}  ${String(r.site).padEnd(38)} ${r.scheme.padEnd(10)} ${r.verb} ${r.tbl} si=${r.si} ${r.country}/${r.asn}`);

    const seen = new Set(rows.map(r => r.site));
    console.log('');
    for (const site of D1_WRITE_SITES) {
        const n = rows.filter(r => r.site === site).length;
        console.log(`    ${String(n).padStart(3)}  ${site}`);
    }
    const si = rows.reduce((a, r) => a + Number(r.si ?? 1), 0);
    console.log(`\n  rows ${rows.length}, sum(_sample_interval) ${si}`);
    const missing = D1_WRITE_SITES.filter(s => !seen.has(s) && s !== BEST_EFFORT);
    if (missing.length) {
        console.log(`  absent BY NAME: ${missing.join(', ')}`);
        console.log('  A site absent by name is NOT proof its call did not run: Analytics Engine keeps');
        console.log('  one point per Worker invocation and reports the rest through _sample_interval.');
        console.log('  Read the sum above against the writes the run issued — that is the measurement.');
    } else {
        console.log('  every declared site appears by name.');
    }
    return rows;
}

const only = process.argv.find(a => a === '--census' || a === '--control' || a === '--readback');
if (only === '--readback') { await readback(); }
else {
    if (only !== '--control') await census();
    if (only !== '--census') await control();
}

console.log(`\n${failed === 0 ? 'ALL ASSERTIONS PASSED' : `${failed} ASSERTION(S) FAILED`}`);
process.exit(failed === 0 ? 0 : 1);
