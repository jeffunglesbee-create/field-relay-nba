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
//    control header, and each must produce exactly one Analytics Engine entry
//    naming that site. Until that passes, no observation window has started and a
//    null result downstream means nothing.
//
// THE ONE SITE THAT CANNOT BE CONTROLLED SYNTHETICALLY is reported as its own
// state rather than folded into a pass or a failure — see EXPECTED below.
//
// Synthetic 2099 dates so no real slate is written to, and everything this
// script creates is deleted at the end with emptiness asserted, not assumed.
//
// Usage:  node scripts/d1-write-provenance-verify.mjs            both phases
//         node scripts/d1-write-provenance-verify.mjs --census   read-only
//         node scripts/d1-write-provenance-verify.mjs --control

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

// How many entries each site must produce from the requests below. The one at
// zero is NOT a pass and NOT a failure: /admin/archive/backfill-went-to-ot only
// writes when a real MLB/WNBA row with a NULL went_to_ot matches a real
// /v2/games entry for its date, which a synthetic 2099 row can never do. It is
// reported as its own state.
const EXPECTED = {
    'writeMLBSeriesResult:regular': 1,
    '/archive/game:regular': 1,
    '/archive/game:postseason': 1,
    '/archive/score-by-id:regular-espn': 1,
    '/archive/score-by-id:postseason-espn': 1,
    '/archive/score-by-id:regular': 1,
    '/archive/score-by-id:postseason': 1,
    '/archive/drama-by-id:regular': 1,
    '/archive/drama-by-id:postseason': 1,
};
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
    const q = `SELECT blob1 AS scheme, blob2 AS site, blob5 AS ua, blob6 AS country, blob7 AS asn, count() AS n
               FROM field_jq_analytics
               WHERE index1 = '${D1_WRITE_INDEX}' AND timestamp > toDateTime('${since.slice(0, 19).replace('T', ' ')}')
               GROUP BY scheme, site, ua, country, asn
               ORDER BY site FORMAT JSON`;
    let rows = [];
    for (let attempt = 1; attempt <= 12; attempt++) {
        rows = await ae(q);
        const sites = new Set(rows.map(r => r.site));
        if (Object.keys(EXPECTED).every(s => sites.has(s))) break;
        console.log(`  attempt ${attempt}: ${sites.size}/${Object.keys(EXPECTED).length} site(s) visible, waiting 15s`);
        await new Promise(r => setTimeout(r, 15_000));
    }

    console.log('\n  Analytics Engine, index1=d1-write, last 60s:');
    if (!rows.length) console.log('    (no rows)');
    for (const r of rows)
        console.log(`    ${String(r.n).padStart(3)}  ${String(r.site).padEnd(38)} scheme=${r.scheme} country=${r.country} asn=${r.asn} ua=${r.ua}`);

    const count = new Map();
    for (const r of rows) count.set(r.site, (count.get(r.site) ?? 0) + Number(r.n));

    for (const [site, want] of Object.entries(EXPECTED))
        assert(`${site}: exactly ${want} entry`, (count.get(site) ?? 0) === want,
            `saw ${count.get(site) ?? 0}`);

    // Three states, and the middle one is not a pass.
    const best = count.get(BEST_EFFORT) ?? 0;
    if (best > 0) console.log(`PASS  ${BEST_EFFORT}: ${best} entry — a real row resolved`);
    else console.log(`NOT OBSERVABLE  ${BEST_EFFORT}: 0 entries. Not a failure and not a pass — the route\n`
        + '      writes only when a real MLB/WNBA row with a NULL went_to_ot matches a live\n'
        + '      /v2/games entry for its date, and no synthetic row can produce that. It is an\n'
        + '      UPDATE, so it cannot create a row of any scheme; its silence does not weaken\n'
        + '      the finding, and this line says so rather than omitting the site.');

    assert('every control entry carries scheme=control', rows.every(r => r.scheme === 'control'),
        `schemes seen: ${[...new Set(rows.map(r => r.scheme))].join(', ')}`);

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
    const missing = Object.keys(EXPECTED).filter(s => !seen.has(s));
    if (missing.length) {
        console.log(`\n  STILL ABSENT after the wider window: ${missing.join(', ')}`);
        console.log('  Latency is ruled out at this range; these writes did not reach the dataset.');
    } else {
        console.log('\n  every controllable site is present — the control run\'s 3-minute poll was short,');
        console.log('  not the instrument short of writes.');
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
