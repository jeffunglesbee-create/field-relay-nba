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
// The postseason control row R2 creates. R3/R4/R5 target it ON PURPOSE rather
// than a nonexistent id: the regular UPDATE then changes 0 rows, the postseason
// UPDATE changes 1, and the route's OWN RESPONSE reports `changes: 1`. That is a
// per-site execution proof that owes nothing to Analytics Engine — see PROOFS.
const POST_ID = `MLB_PROVENANCE_CONTROL_SERIES_ctrl_${DATE_POST}`;
const REG_ID = `MLB_${DATE_REG}_provenancehome_provenanceaway`;

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
// cannot deliver that, and it took two runs to learn what it CAN deliver — the
// first reading was wrong and is recorded here because the wrong model is the
// instructive part.
//
// RUN 33712204759, nine writes across five requests: five rows. Every request
// that issued two writes produced one row with `_sample_interval = 2`; the one
// request that issued a single write produced a row with 1. Readback
// 33712493470, five minutes later over six hours, found the same five rows, so
// latency was ruled out rather than assumed. The obvious model — Analytics
// Engine keeps ONE data point per Worker invocation — fits that run exactly.
//
// RUN 33712779159, the same nine writes: SEVEN rows, and the model was wrong.
// `/archive/game:postseason`, the single-write request that cannot be sampled
// under a per-invocation rule, was absent entirely; one two-write request
// produced two rows. Which rows survive is not determined by the request that
// wrote them.
//
// WHAT HELD BOTH TIMES, EXACTLY: `sum(_sample_interval)` = 9, the number of
// writes issued. 5 rows summing to 9 and 7 rows summing to 9. AE samples the
// stream and the interval it stamps on each survivor makes the total exact.
//
// So the control asserts two things and neither is a row count:
//
//   1. `sum(_sample_interval)` equals the writes issued. Falsifiable per site —
//      delete any one recordD1Write call and the total is short by one round.
//   2. Every declared site EXECUTED — proven from the routes' own responses and
//      from D1, not from Analytics Engine. Run 33712991908 settled why: 90 writes
//      issued, AE's total exact at 90, and one site still zero rows across ten
//      rounds while its sibling in the same request had two. `_sample_interval`
//      came back 12 and 13 on two sites and 1 on two others, so it is a
//      stream-level rate stamped at ingest, not a per-site count. Per-site
//      survival cannot carry a claim; the routes' own output can. See PROOFS.
//
// WHAT IS GENUINELY LOST is which of two doors inside ONE request. Nothing the
// CC-CMD turns on: both writes in every pair target the same row id, so they
// carry the same blob1, and a dash-scheme write cannot be sampled into another
// scheme.
const WRITES_PER_REQUEST = [
    ['R1 /archive/game (MLB, clinching)', 2, ['/archive/game:regular', 'writeMLBSeriesResult:regular']],
    ['R2 /archive/game (series_key)', 1, ['/archive/game:postseason']],
    ['R3 /archive/score-by-id (espn)', 2, ['/archive/score-by-id:regular-espn', '/archive/score-by-id:postseason-espn']],
    ['R4 /archive/score-by-id (no espn)', 2, ['/archive/score-by-id:regular', '/archive/score-by-id:postseason']],
    ['R5 /archive/drama-by-id', 2, ['/archive/drama-by-id:regular', '/archive/drama-by-id:postseason']],
];
const WRITES_PER_ROUND = WRITES_PER_REQUEST.reduce((a, [, n]) => a + n, 0);   // 9
const CONTROLLABLE = WRITES_PER_REQUEST.flatMap(([, , sites]) => sites);      // 9 names
const ROUNDS = 10;
// The one site no synthetic request can reach — reported as its own state.
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

    // ONE ROUND: the five requests that reach the nine controllable sites.
    // R1's series_record '3-0' with the home side winning is what
    // detectMLBSeriesOutcome reads as a clinching sweep — the only way to reach
    // writeMLBSeriesResult. R3/R4/R5 address POST_ID, the postseason row R2
    // creates earlier in the same round: the regular UPDATE changes 0 rows and
    // the postseason one runs after it, so both sites fire from one request AND
    // the route reports `changes: 1`, which is the per-site execution proof.
    const seenResponses = {};
    const round = async (verbose) => {
        const say = (...a) => verbose && console.log(...a);
        const keep = (k, r) => { if (!(k in seenResponses)) seenResponses[k] = r; return r; };
        say('  R1 /archive/game (MLB, clinching series_record) →',
            JSON.stringify(keep('R1', await post('/archive/game', {
                sport: 'MLB', date: DATE_REG, home: 'Provenance Home', away: 'Provenance Away',
                home_score: 5, away_score: 3, series_record: '3-0',
            }))));
        say('  R2 /archive/game (series_key) →',
            JSON.stringify(keep('R2', await post('/archive/game', {
                sport: 'MLB', date: DATE_POST, series_key: 'PROVENANCE_CONTROL_SERIES',
                round: 'CTRL', game_number: 1, home: 'Provenance Home', away: 'Provenance Away',
                home_score: 2, away_score: 1,
            }))));
        say('  R3 /archive/score-by-id (with espn_event_id) →',
            JSON.stringify(keep('R3', await post('/archive/score-by-id',
                { id: POST_ID, home_score: 1, away_score: 0, espn_event_id: '999000222' }))));
        say('  R4 /archive/score-by-id (no espn_event_id) →',
            JSON.stringify(keep('R4', await post('/archive/score-by-id',
                { id: POST_ID, home_score: 1, away_score: 0 }))));
        say('  R5 /archive/drama-by-id →',
            JSON.stringify(keep('R5', await post('/archive/drama-by-id',
                { id: POST_ID, drama_peak: 1, drama_arc: 'control' }))));
    };

    await round(true);
    for (let r = 2; r <= ROUNDS; r++) await round(false);
    console.log(`  ...and ${ROUNDS - 1} more round(s) of the same five requests — ${ROUNDS * WRITES_PER_ROUND} writes in all.`);
    console.log('  Rounds exist because survivor identity is not determined; see the note above WRITES_PER_REQUEST.');

    // R6 — the best-effort one, issued ONCE. Auth is real; the data condition may
    // not hold, and it touches real rows, so it is not repeated.
    if (MCP_SECRET) {
        console.log('  R6 /admin/archive/backfill-went-to-ot (limit 1, once) →',
            JSON.stringify(await post('/admin/archive/backfill-went-to-ot', { limit: 1 },
                { Authorization: `Bearer ${MCP_SECRET}` })));
    } else {
        console.log('  R6 SKIPPED — FIELD_MCP_SECRET not set');
    }

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
    const WANT_SI = ROUNDS * WRITES_PER_ROUND;
    for (let attempt = 1; attempt <= 14; attempt++) {
        rows = await ae(q);
        if (siOf(rows) >= WANT_SI) break;
        console.log(`  attempt ${attempt}: ${siOf(rows)}/${WANT_SI} write(s) visible, waiting 15s`);
        await new Promise(r => setTimeout(r, 15_000));
    }

    const bySite = new Map();
    for (const r of rows) {
        const e = bySite.get(r.site) || { rows: 0, si: 0, verb: r.verb, tbl: r.tbl };
        e.rows++; e.si += Number(r.si ?? 1);
        bySite.set(r.site, e);
    }
    console.log('\n  Analytics Engine, index1=d1-write, since this run began:');
    for (const site of [...CONTROLLABLE, BEST_EFFORT]) {
        const e = bySite.get(site);
        console.log(e
            ? `    rows=${String(e.rows).padStart(2)} si=${String(e.si).padStart(2)}  ${site.padEnd(38)} ${e.verb} ${e.tbl}`
            : `    rows= 0 si= 0  ${site.padEnd(38)} —`);
    }
    console.log(`\n  total rows ${rows.length}, sum(_sample_interval) ${siOf(rows)}, writes issued ${WANT_SI}`);

    // 1. THE TOTAL. Falsifiable per site: delete any one recordD1Write call and
    //    this is short by exactly ROUNDS.
    assert(`all ${WANT_SI} control writes reached the dataset`, siOf(rows) === WANT_SI,
        `sum(_sample_interval) = ${siOf(rows)}. Short means a call site did not execute `
        + `(by ${ROUNDS} per missing site); over means an unaccounted write path fired.`);

    // 2. PER-SITE EXECUTION PROOF, OWING NOTHING TO ANALYTICS ENGINE.
    //
    // The previous version asserted every site appears by name in the dataset.
    // Run 33712991908 issued 90 writes, AE's total came back exact at 90, and
    // `/archive/score-by-id:postseason` still surfaced zero rows across ten
    // rounds while its sibling in the SAME request surfaced two. Per-site
    // survival is too noisy to carry a claim — `_sample_interval` came back as
    // 12 and 13 on two sites and 1 on two others, so it is a stream-level rate
    // stamped at ingest, not a per-site count.
    //
    // So the per-site claim moves off AE entirely and onto artifacts the routes
    // produce themselves. R3/R4/R5 address the postseason control row rather
    // than a nonexistent id, so the regular UPDATE changes 0 rows, the
    // postseason UPDATE changes 1, and `changes: 1` in the response proves BOTH
    // branches ran — the second is only reached when the first returns zero.
    const body = (k) => { try { return JSON.parse(seenResponses[k]?.body ?? '{}'); } catch { return {}; } };
    const importance = (await d1(`SELECT importance FROM regular_season_games WHERE id = ?`, [REG_ID]))[0]?.importance;
    const PROOFS = [
        ['/archive/game:regular', body('R1').ok === true && body('R1').table === 'regular_season_games',
            `R1 response table=${body('R1').table}`],
        ['writeMLBSeriesResult:regular', importance === 'sweep',
            `regular_season_games.importance for the control row = ${importance ?? 'NULL'}; `
            + 'only writeMLBSeriesResult sets it'],
        ['/archive/game:postseason', body('R2').ok === true && body('R2').table === 'postseason_games',
            `R2 response table=${body('R2').table}`],
        ['/archive/score-by-id:regular-espn', body('R3').changes === 1,
            `R3 changes=${body('R3').changes} — the postseason UPDATE is only reached when this one returns 0`],
        ['/archive/score-by-id:postseason-espn', body('R3').changes === 1,
            `R3 changes=${body('R3').changes} — 1 means the postseason UPDATE matched the control row`],
        ['/archive/score-by-id:regular', body('R4').changes === 1, `R4 changes=${body('R4').changes}`],
        ['/archive/score-by-id:postseason', body('R4').changes === 1, `R4 changes=${body('R4').changes}`],
        ['/archive/drama-by-id:regular', body('R5').changes === 1, `R5 changes=${body('R5').changes} (round 1)`],
        ['/archive/drama-by-id:postseason', body('R5').changes === 1, `R5 changes=${body('R5').changes} (round 1)`],
    ];
    console.log('\n  per-site execution proof, from the routes\' own responses:');
    for (const [site, ok, why] of PROOFS)
        console.log(`    ${ok ? 'ok  ' : 'MISS'}  ${site.padEnd(38)} ${why}`);
    assert(`all ${PROOFS.length} controllable sites are proven to have executed`,
        PROOFS.every(([, ok]) => ok),
        `unproven: ${PROOFS.filter(([, ok]) => !ok).map(([s2]) => s2).join(', ')}`);

    // Site names that survived sampling — REPORTED, never asserted, for the
    // reason above. A site absent here after 90 writes is not evidence.
    const unseen = CONTROLLABLE.filter(x => !bySite.has(x));
    console.log(unseen.length
        ? `\n  survived sampling by name: ${CONTROLLABLE.length - unseen.length}/${CONTROLLABLE.length}. `
          + `Absent this run: ${unseen.join(', ')} — sampling, not silence; see the proofs above.`
        : `\n  survived sampling by name: all ${CONTROLLABLE.length}.`);

    // 3. THE SHAPE. A site wired to the wrong table would pass 1 and 2.
    const DECLARED = Object.fromEntries(
        [...WRITES_PER_REQUEST.flatMap(([, , sites]) => sites)].map(site => [site,
            site.startsWith('/archive/game') ? 'INSERT' : 'UPDATE']));
    const wrongVerb = [...bySite.entries()].filter(([site, e]) => DECLARED[site] && e.verb !== DECLARED[site]);
    assert('every site records the verb its statement uses', wrongVerb.length === 0,
        wrongVerb.map(([s2, e]) => `${s2} recorded ${e.verb}, expected ${DECLARED[s2]}`).join('; '));
    const wrongTable = [...bySite.entries()].filter(([site, e]) =>
        (site.includes(':postseason') ? 'postseason_games' : 'regular_season_games') !== e.tbl);
    assert('every site records the table its name claims', wrongTable.length === 0,
        wrongTable.map(([s2, e]) => `${s2} recorded ${e.tbl}`).join('; '));

    assert('every surviving site is one this build declares',
        rows.every(r => D1_WRITE_SITES.includes(r.site)),
        `undeclared: ${[...new Set(rows.map(r => r.site).filter(x => !D1_WRITE_SITES.includes(x)))].join(', ')}`);

    assert('every control entry carries scheme=control', rows.every(r => r.scheme === 'control'),
        `schemes seen: ${[...new Set(rows.map(r => r.scheme))].join(', ')}`);

    assert('country and ASN travel; an IP never does',
        rows.every(r => r.country && r.asn && r.ua && !/\d+\.\d+\.\d+\.\d+/.test(String(r.ua))),
        'country/asn answer "which system"; an IP would identify a machine');

    // Three states, and the middle one is not a pass.
    const best = bySite.get(BEST_EFFORT)?.rows ?? 0;
    if (best > 0) console.log(`PASS  ${BEST_EFFORT}: present — a real row resolved`);
    else console.log(`NOT OBSERVABLE  ${BEST_EFFORT}: absent. Not a failure and not a pass — the route\n`
        + '      writes only when a real MLB/WNBA row with a NULL went_to_ot matches a live\n'
        + '      /v2/games entry for its date, and no synthetic row can produce that (the run\n'
        + '      above reports `no v2/games match` for the 2099 row it was handed), and it is\n      issued ONCE rather than per round because it touches real rows. It is an\n'
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
