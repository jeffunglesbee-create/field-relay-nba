#!/usr/bin/env node
// CC-CMD-2026-10-16-cfl-archive-date-keying, TASK 4.
//
// Every archived row that carries a `start_time` has a `date` equal to the
// America/New_York calendar day of that instant. Exits 1 on any row where it is
// not, naming every one. Rows with no start_time cannot be checked this way;
// each run prints how many there are per table, beside the rows it did check.
//
//   node scripts/check-archive-date-keying.mjs --self-test   fixtures only
//   node scripts/check-archive-date-keying.mjs               fixtures, then the live tables
//
// Env for the live run: RELAY_SHARED_SECRET (reads through /d1/execute).
//
// WHY THE EXISTING CHECK COULD NOT CATCH THIS
//
// Desk.fs's ZONE-PROOF note measured that across a live slate "8 games start on
// a LATER UTC day than their `date` and none start earlier", and read that as
// ET keying. A UTC-keyed row scores EQUAL, not earlier, and equal is also what
// ET keying gives every game that does not cross UTC midnight. So the test
// could not separate the two, and 13 CFL rows keyed on the UTC day sat inside a
// result that looked like confirmation. This check compares each row against
// the ET candidate itself rather than testing an inequality's direction.
//
// BASELINE, measured, never hardcoded below:
//   before the TASK 3 migration (2026-10-18, migration dry run on runner
//     39150937368 and a census query over both tables): 13 rows off their ET
//     day, all CFL, over 3,399 rows with a start_time (3,392 regular, 7
//     postseason); 14 PGA Tour rows exempt, 5 of which would have mismatched.
//   after: recorded in outbox/cc-session-2026-10-18-cfl-archive-date-keying.md
//     with the run that measured it.
//
// TWO LABELS ARE EXEMPT, BY EXACT MATCH, AND THE REASON IS STRUCTURAL:
// 'golf' and 'PGA Tour'. For golf, start_time is the TOURNAMENT start and
// `date` is the ROUND date, so they are different quantities and comparing them
// means nothing. Measured 2026-10-18: espn_event_id 401850916 has six PGA Tour
// rows, and five of them share one start_time, 2026-10-08T04:00Z, while their
// date steps 2026-10-08, -09, -10, -11, -12. (The CC-CMD counted four, the
// mismatching ones.) Rows labelled 'golf' carry no start_time at all today, so
// they never reach the comparison; the label is exempt for when they do. That
// is the per-tournament convention documented beside the archive id builder in
// src/index.js ("`golf_401811962` is a per-TOURNAMENT synthetic key covering
// R1..R4"). Exact strings, not a pattern: 'PGA Tour' does not contain 'golf',
// and a future 'LPGA' label needs its own entry and its own reason rather than
// inheriting one. Exempt rows are counted and printed, never silently dropped.
//
// THE CHECK FAILS ON PURPOSE EVERY RUN (MUTATE-FIRST-A, CLAUDE.md Rule 90).
// After the live comparison, the same live rows go through evaluate() again,
// the function whose result IS the exit code, with one passing row moved by a
// day. Unless that run would exit 1 and names exactly that row as one more
// mismatch, this run fails, because a guard that cannot fail is documentation.
// (The first version only re-ran classify() on the moved row, which the
// fixtures already cover; review caught it, 2026-10-18.)

import fs from 'node:fs';

// RELAY_BASE overrides for a local stand-in, as scripts/archive-gap-probe.mjs does.
const RELAY = process.env.RELAY_BASE || 'https://field-relay-nba.jeffunglesbee.workers.dev';
const SELF_TEST_ONLY = process.argv.includes('--self-test');

const EXEMPT = new Set(['golf', 'PGA Tour']);

// The guard's own Intl call, independent of the writer's helper on purpose: an
// oracle that imports what it checks agrees with it by construction. The
// writer's fieldDayOfInstant() is then run through the same fixtures below.
function etDay(value) {
    if (value === null || value === undefined || value === '') return null;
    const t = Date.parse(value);
    if (Number.isNaN(t)) return null;
    return new Date(t).toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
}

// One row -> its verdict. Empty and garbage both give etDay() === null, so they
// are told apart HERE, from the input, not from the result.
function classify(row) {
    const st = row.start_time;
    if (st === null || st === undefined || st === '') return 'no_start';
    if (EXEMPT.has(row.sport)) return 'exempt';
    const day = etDay(st);
    if (day === null) return 'unparseable';
    return day === row.date ? 'ok' : 'mismatch';
}

function tally(rows) {
    const out = { ok: [], mismatch: [], unparseable: [], exempt: [], no_start: [] };
    for (const r of rows) out[classify(r)].push(r);
    return out;
}

const FIXTURES = [
    // The pair that fails a fixed-offset implementation in opposite directions.
    // A -4 implementation calls the first 2026-11-10; a -5 one calls the second
    // 2026-07-09. Neither offset passes both.
    { name: 'EST evening, keyed on the ET day', row: { sport: 'NBA', date: '2026-11-09', start_time: '2026-11-10T04:30:00Z' }, want: 'ok' },
    { name: 'EST evening, keyed on the UTC day', row: { sport: 'NBA', date: '2026-11-10', start_time: '2026-11-10T04:30:00Z' }, want: 'mismatch' },
    { name: 'EDT after midnight, keyed on the ET day', row: { sport: 'MLB', date: '2026-07-10', start_time: '2026-07-10T04:30:00Z' }, want: 'ok' },
    { name: 'EDT after midnight, keyed a day early', row: { sport: 'MLB', date: '2026-07-09', start_time: '2026-07-10T04:30:00Z' }, want: 'mismatch' },
    // A real UTC-keyed row, as it stood before TASK 3.
    { name: 'CFL e13419744 as the UTC writer stored it', row: { sport: 'CFL', date: '2026-10-10', start_time: '2026-10-10T02:12:00+00:00' }, want: 'mismatch' },
    { name: 'CFL e13419744 as migrated', row: { sport: 'CFL', date: '2026-10-09', start_time: '2026-10-10T02:12:00+00:00' }, want: 'ok' },
    // Golf: skipped, not passed.
    { name: 'golf round row', row: { sport: 'golf', date: '2026-10-11', start_time: '2026-10-08T04:00Z' }, want: 'exempt' },
    { name: 'PGA Tour round row', row: { sport: 'PGA Tour', date: '2026-10-12', start_time: '2026-10-08T04:00Z' }, want: 'exempt' },
    // Exact match only.
    { name: "'Golf' is not 'golf'", row: { sport: 'Golf', date: '2026-10-11', start_time: '2026-10-08T04:00Z' }, want: 'mismatch' },
    { name: "'LPGA' is not exempt", row: { sport: 'LPGA', date: '2026-10-11', start_time: '2026-10-08T04:00Z' }, want: 'mismatch' },
    { name: "'disc golf' contains 'golf' and is not exempt", row: { sport: 'disc golf', date: '2026-10-11', start_time: '2026-10-08T04:00Z' }, want: 'mismatch' },
    { name: "'PGA Tour Champions' contains 'PGA Tour' and is not exempt", row: { sport: 'PGA Tour Champions', date: '2026-10-11', start_time: '2026-10-08T04:00Z' }, want: 'mismatch' },
    // Empty is skipped; garbage is reported. etDay() returns null for both.
    { name: 'empty start_time', row: { sport: 'NFL', date: '2026-10-11', start_time: '' }, want: 'no_start' },
    { name: 'null start_time', row: { sport: 'NFL', date: '2026-10-11', start_time: null }, want: 'no_start' },
    { name: 'garbage start_time', row: { sport: 'NFL', date: '2026-10-11', start_time: 'TBD' }, want: 'unparseable' },
];

// The writer's helper, read from src/index.js rather than re-typed, so the
// helper that stamps the rows is held to the same fixtures as this oracle. And
// the CFL writer's use of it: the stamped value has to come from it, or the
// helper agreeing with this oracle says nothing about the rows.
const WRITER_USE = 'const gameDate = fieldDayOfInstant(t.date);';
function writerHelper() {
    const src = fs.readFileSync('src/index.js', 'utf8');
    const uses = src.split(WRITER_USE).length - 1;
    if (uses !== 1) throw new Error(`"${WRITER_USE}" occurs ${uses} times in src/index.js; expected exactly 1, in the CFL archive writer`);
    const START = 'function fieldDayOfInstant(value) {';
    const n = src.split(START).length - 1;
    if (n !== 1) throw new Error(`anchor "${START}" occurs ${n} times in src/index.js; expected exactly 1`);
    const from = src.indexOf(START);
    const end = src.indexOf('\n}\n', from);
    if (end === -1) throw new Error('could not find the end of fieldDayOfInstant in src/index.js');
    // eslint-disable-next-line no-new-func
    return new Function(`${src.slice(from, end + 2)}\nreturn fieldDayOfInstant;`)();
}

function selfTest() {
    const fails = [];
    for (const f of FIXTURES) {
        const got = classify(f.row);
        if (got !== f.want) fails.push(`${f.name}: ${got}, expected ${f.want}`);
    }
    let helper;
    try { helper = writerHelper(); } catch (e) { fails.push(`writer helper: ${e.message}`); }
    const instants = [...new Set(FIXTURES.map(f => f.row.start_time))];
    if (helper) {
        for (const st of instants) {
            const a = etDay(st), b = helper(st);
            if (a !== b) fails.push(`writer's fieldDayOfInstant(${JSON.stringify(st)}) = ${b}, this oracle says ${a}`);
        }
    }
    if (fails.length) {
        console.error(`SELF-TEST FAILED (${fails.length}):`);
        for (const f of fails) console.error(`  ${f}`);
        process.exit(1);
    }
    console.log(`self-test: ${FIXTURES.length} of ${FIXTURES.length} fixtures classify as expected; the writer's `
              + `fieldDayOfInstant agrees with this oracle on all ${instants.length} distinct start_time values, `
              + `and the CFL writer stamps its date from it`);
}

async function relayRead(sql) {
    const secret = process.env.RELAY_SHARED_SECRET;
    if (!secret) throw new Error('RELAY_SHARED_SECRET must be set; a guard that cannot read does not pass');
    const r = await fetch(`${RELAY}/d1/execute`, {
        method: 'POST',
        headers: { 'X-FIELD-Relay': secret, 'Content-Type': 'application/json' },
        body: JSON.stringify({ sql, params: [] }),
    });
    const text = await r.text();
    let j;
    try { j = JSON.parse(text); } catch (e) { throw new Error(`/d1/execute HTTP ${r.status}, not JSON (${e.message}): ${text.slice(0, 200)}`); }
    if (!r.ok || j.success !== true || !Array.isArray(j.results)) {
        throw new Error(`/d1/execute HTTP ${r.status}: ${j.error || text.slice(0, 200)}`);
    }
    return j.results;
}

const nextDay = d => new Date(Date.parse(`${d}T12:00:00Z`) + 86400000).toISOString().slice(0, 10);

// The verdict, from rows alone. Its `code` is the process exit code.
function evaluate(rows) {
    const t = tally(rows);
    const compared = t.ok.length + t.mismatch.length + t.unparseable.length;
    const bad = t.mismatch.length + t.unparseable.length;
    return { t, compared, bad, code: bad ? 1 : 0 };
}

const TABLES = ['regular_season_games', 'postseason_games'];

async function main() {
    selfTest();
    if (SELF_TEST_ONLY) return 0;

    const rows = [];
    const census = {};
    for (const table of TABLES) {
        const [c] = await relayRead(`SELECT COUNT(*) AS total, SUM(start_time IS NULL OR start_time = '') AS without FROM ${table}`);
        const got = await relayRead(`SELECT id, sport, date, start_time FROM ${table} WHERE start_time IS NOT NULL AND start_time != ''`);
        if (!c) {
            console.error(`FAIL — the count query on ${table} returned no row. An empty read is not a pass.`);
            return 1;
        }
        census[table] = { total: c.total, without: c.without, read: got.length };
        // A floor per table, and the two reads must agree: a truncated or empty
        // read is not a pass.
        if (!c.total) {
            console.error(`FAIL — ${table} reports 0 rows. An empty table read is not a pass.`);
            return 1;
        }
        if (got.length !== c.total - c.without) {
            console.error(`FAIL — ${table}: read ${got.length} rows with a start_time, but its count says ${c.total - c.without} (${c.total} total, ${c.without} without).`);
            return 1;
        }
        rows.push(...got.map(r => ({ ...r, table })));
    }
    if (!rows.length) {
        console.error('FAIL — 0 rows with a start_time came back. An empty read is not a pass.');
        return 1;
    }

    const { t, compared, bad, code } = evaluate(rows);
    const exemptBy = {};
    for (const r of t.exempt) exemptBy[r.sport] = (exemptBy[r.sport] || 0) + 1;
    console.log('');
    for (const table of TABLES) {
        const c = census[table];
        console.log(`${table}: ${c.total} rows; ${c.read} with a start_time, checked; ${c.without} without, not checkable this way`);
    }
    console.log(`checked ${rows.length} rows with a start_time`);
    console.log(`  exempt by exact label: ${t.exempt.length}${t.exempt.length ? ` (${Object.entries(exemptBy).map(([k, v]) => `${k} ${v}`).join(', ')})` : ''}`);
    console.log(`  compared against their ET day: ${compared}`);
    console.log(`  off their ET day: ${t.mismatch.length}`);
    console.log(`  start_time unparseable: ${t.unparseable.length}`);
    for (const r of t.mismatch) {
        console.log(`    MISMATCH  ${r.table}  ${r.id}  sport=${r.sport}  date=${r.date}  start_time=${r.start_time}  ET day=${etDay(r.start_time)}`);
    }
    for (const r of t.unparseable) {
        console.log(`    UNPARSEABLE  ${r.table}  ${r.id}  sport=${r.sport}  start_time=${JSON.stringify(r.start_time)}`);
    }

    // Fail on purpose, through the same verdict path: the live rows with one
    // passing row moved a day must exit 1 and name exactly that row as the one
    // extra mismatch.
    if (!t.ok.length) {
        console.error('FAIL — no row passed, so the mutation has nothing to move.');
        return 1;
    }
    const victim = t.ok[0];
    const moved = { ...victim, date: nextDay(victim.date) };
    const m = evaluate(rows.map(r => (r === victim ? moved : r)));
    const caught = m.code === 1
        && m.t.mismatch.length === t.mismatch.length + 1
        && m.t.mismatch.some(r => r.id === victim.id && r.date === moved.date);
    console.log(`\nmutation: ${victim.id} date ${victim.date} -> ${moved.date}; the same verdict path then exits ${m.code} `
              + `with ${m.t.mismatch.length} mismatch(es): ${caught ? 'CAUGHT' : 'NOT CAUGHT'}`);
    if (!caught) {
        console.error('FAIL — moving a passing row by a day did not turn the verdict. This guard cannot fail.');
        return 1;
    }

    console.log(bad
        ? `\nFAIL — ${t.mismatch.length} mismatch(es) and ${t.unparseable.length} unparseable over ${compared} compared rows`
        : `\nPASS — 0 mismatches over ${compared} compared rows (${t.exempt.length} exempt, ${rows.length} checked, `
          + `${TABLES.reduce((n, tb) => n + census[tb].without, 0)} without a start_time not checkable)`);
    return code;
}

main().then(code => process.exit(code), e => { console.error(`ERROR: ${e.message}`); process.exit(1); });
