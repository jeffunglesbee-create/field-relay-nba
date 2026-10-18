#!/usr/bin/env node
// CC-CMD-2026-10-16-cfl-archive-date-keying, TASK 3.
//
// The CFL archive writer stamped `date` with the UTC calendar day of kickoff.
// Every kickoff after 20:00 ET falls on the next UTC day, so those rows carry a
// date one day ahead, and because the date is embedded in the archive id each
// one is a wrong primary key, not just a wrong column. This renames them.
//
//   node scripts/migrate-cfl-date-keying.mjs --self-test
//   node scripts/migrate-cfl-date-keying.mjs                    dry run: reads, emits the SQL
//   node scripts/migrate-cfl-date-keying.mjs --verify --plan=<dry-run manifest>
//
// Env: RELAY_SHARED_SECRET. --out=<base> names the manifest (<base>.json) and,
// for a dry run, the transaction (<base>.sql). Default base:
// outbox/cfl-date-keying-migration-<mode>-<stamp>.
//
// THIS SCRIPT NEVER WRITES. It reads through the relay's /d1/execute, the path
// every CI reader of ARCHIVE_DB already uses, and it emits the write as text.
//
// The CC-CMD asks for "dry-run by default; applies only with --apply", and for
// "per row, in one batch". Those two cannot both be met from a runner today:
//
//   - /d1/execute prepares exactly one statement. The two UPDATEs below would
//     be two requests, and a failure between them would leave change_log
//     pointing at an id the games table does not have.
//   - The Cloudflare D1 REST /query endpoint takes several statements in one
//     call, but the repository's CLOUDFLARE_API_TOKEN cannot reach it: the
//     first runner dry run, 2026-10-18, got `7403: The given account is not
//     valid or is not authorized to access this service`
//     (outbox/cfl-date-keying-migration-dry-run-20261018T173443Z.log).
//     Granting it D1 is a secret-store change and the owner's.
//
// The batch requirement protects the data, and the --apply flag protects
// against an accidental write. So the batch wins, and there is no write path
// here at all, which is a stronger form of the second protection. The dry run
// EMITS the whole transaction as a .sql file; a holder of a D1-capable
// credential sends that exact text to /query; --verify reads the result back
// through /d1/execute and checks every row against the committed plan.
//
// Facts about that endpoint, measured 2026-10-18 against field-archive (through
// the session's Cloudflare connector, which calls it) rather than taken from
// documentation:
//
//   - params with more than one statement are refused, code 7400 "params with
//     multiple statements is not supported". So the batch carries literals, and
//     every literal is validated against a closed pattern before it is quoted
//     (lit() below). Single-statement reads keep their params.
//   - the call is ONE transaction. `UPDATE regular_season_games SET date =
//     '2026-10-09' WHERE id = 'CFL_2026-10-10_e13419744'; SELECT json('{')`
//     returned 7500 "malformed JSON", and the row still read 2026-10-10.
//   - changes() in a later statement of the same call sees the previous
//     UPDATE: 0 for an id that does not exist, 1 for one that does.
//
// That last fact is what lets the change counts be checked INSIDE the
// transaction rather than after it has committed. And because the whole set is
// ONE call, it is one transaction: every row renames, or none does. That is
// "per row, in one batch" with the run-level abort the CC-CMD asks for on a
// collision carried down to execution time. The CC-CMD: "A `changes`
// count that is not 1 per statement is a failure, not a warning." A failure
// discovered after commit is a report; a failure inside the batch is a
// rollback. Each guard fails with a distinct SQLite error so the message names
// which one fired:
//
//   change_log guard        json('{')                    "malformed JSON"
//   regular_season_games    abs(-9223372036854775807-1)  "integer overflow"
//   the row as written      json_extract('{}', 'bad-path') "bad JSON path"
//   an id that already exists                            "UNIQUE constraint"
//
// change_log's expected count is the number of rows the dry run read for that
// id (2 + 2 across the set on 2026-10-18), not 1: the CC-CMD's "1 per
// statement" is about the games row, which is one row by primary key.
//
// The games UPDATE matches on id AND sport AND the old date AND the start_time
// the new day was computed from, so a row that changed after the dry run, or a
// WHERE clause mistyped on its way to the endpoint, matches 0 rows and the
// guard rolls the whole transaction back.
//
// That alone does not cover the SET side: a mistyped new id or new date would
// still match, change 1 row and commit (found by review, 2026-10-18). So a third
// guard reads the row back AS WRITTEN and checks it against the old values
// rather than against the new literals: its date must be the old date minus
// one day, and its id must be 'CFL_' + that date + the old id's own tail. Every
// row this script plans has that shape, because a UTC day runs at most one day
// ahead of the ET day it should have been; planRow() skips and reports any row
// that does not.
//
// WHAT THIS DOES NOT DO, BY THE CC-CMD
//
//   - It touches no row whose date already agrees (29 CFL rows at filing).
//   - It writes nothing to briefs, game_thread_notes or odds_history. All three
//     must read 0 for the set; anything else aborts the run for a human.
//   - A row whose id does not start with 'CFL_' + its date is skipped and
//     reported, never rewritten by substitution.
//   - A target id that already exists aborts the WHOLE run. That would be a
//     merge, and a merge is not authorised.

import fs from 'node:fs';

// wrangler.toml, [[d1_databases]] binding = "ARCHIVE_DB".
const DB_ID = 'cc49101c-0569-4d41-8e7a-be139cde4f26';
const SPORT = 'CFL';

const ARGS = process.argv.slice(2);
const SELF_TEST_ONLY = ARGS.includes('--self-test');
const VERIFY = ARGS.includes('--verify');
const arg = name => (ARGS.find(a => a.startsWith(`--${name}=`)) || '').slice(name.length + 3);
const OUT_ARG = arg('out');
const PLAN_ARG = arg('plan');
// RELAY_BASE overrides for a local stand-in, as scripts/archive-gap-probe.mjs does.
const RELAY = process.env.RELAY_BASE || 'https://field-relay-nba.jeffunglesbee.workers.dev';

// The same call as fieldDayOfInstant() in src/index.js (TASK 1), deliberately
// re-typed here rather than imported: this script runs before that commit is
// deployed, and the CC-CMD asks for "the same Intl call", from each row's own
// start_time. NOT `date(start_time, '-4 hours')` in SQL, which is right for
// every row in today's set and wrong for an evening game after 2026-11-01.
function fieldDayOfInstant(value) {
    if (value === null || value === undefined || value === '') return null;
    const t = Date.parse(value);
    if (Number.isNaN(t)) return null;
    return new Date(t).toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const ID_RE = /^CFL_\d{4}-\d{2}-\d{2}_[A-Za-z0-9_-]+$/;
// Both forms the table carries: `2026-10-10T02:12:00+00:00` and `2026-05-23T02:00Z`.
const INSTANT_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/;
const TAIL_RE = /^_[A-Za-z0-9_-]+$/;

// A literal for the multi-statement batch. Closed patterns only: nothing that
// could carry a quote, a semicolon or whitespace reaches the SQL text.
function lit(value, kind) {
    const re = { date: DATE_RE, id: ID_RE, instant: INSTANT_RE, tail: TAIL_RE }[kind];
    if (!re) throw new Error(`lit(): unknown kind ${kind}`);
    if (typeof value !== 'string' || !re.test(value)) {
        throw new Error(`lit(): refusing ${JSON.stringify(value)} as ${kind}`);
    }
    return `'${value}'`;
}

function intLit(n) {
    if (!Number.isInteger(n) || n < 0) throw new Error(`intLit(): refusing ${JSON.stringify(n)}`);
    return String(n);
}

// One row's plan, or the reason it is skipped. Pure, so the self-test can
// exercise every branch without a database.
function planRow(row) {
    const old_id = row.id;
    const old_date = row.date;
    const new_date = fieldDayOfInstant(row.start_time);
    if (new_date === null) return { old_id, old_date, start_time: row.start_time, skip: 'unparseable start_time' };
    if (new_date === old_date) return null; // agrees: not this script's row
    const prefix = `CFL_${old_date}`;
    // By assertion, not substitution. A blind replace(old_date, new_date) would
    // also rewrite a date appearing later in the id.
    if (typeof old_id !== 'string' || !old_id.startsWith(prefix)) {
        return { old_id, old_date, new_date, start_time: row.start_time, skip: `id does not start with ${prefix}` };
    }
    const dayBefore = new Date(Date.parse(`${old_date}T12:00:00Z`) - 86400000).toISOString().slice(0, 10);
    if (new_date !== dayBefore) {
        return { old_id, old_date, new_date, start_time: row.start_time, skip: `ET day ${new_date} is not the day before ${old_date}` };
    }
    const tail = old_id.slice(prefix.length);
    const new_id = `CFL_${new_date}${tail}`;
    return { old_id, old_date, new_date, new_id, tail, start_time: row.start_time };
}

// One row's five statements. Order matters for the guards: the first two
// SELECTs read changes() of the statement immediately before them, and the
// last reads the row the UPDATE left behind.
function rowStatements(p, changeLogCount) {
    return [
        `UPDATE change_log SET game_id = ${lit(p.new_id, 'id')} WHERE game_id = ${lit(p.old_id, 'id')}`,
        `SELECT CASE WHEN changes() = ${intLit(changeLogCount)} THEN 'ok' ELSE json('{') END AS change_log_guard`,
        `UPDATE regular_season_games SET id = ${lit(p.new_id, 'id')}, date = ${lit(p.new_date, 'date')} `
            + `WHERE id = ${lit(p.old_id, 'id')} AND sport = 'CFL' AND date = ${lit(p.old_date, 'date')} `
            + `AND start_time = ${lit(p.start_time, 'instant')}`,
        `SELECT CASE WHEN changes() = 1 THEN 'ok' ELSE abs(-9223372036854775807 - 1) END AS games_guard`,
        `SELECT CASE WHEN (SELECT COUNT(*) FROM regular_season_games WHERE sport = 'CFL' `
            + `AND start_time = ${lit(p.start_time, 'instant')} AND date = date(${lit(p.old_date, 'date')}, '-1 day') `
            + `AND id = 'CFL_' || date || ${lit(p.tail, 'tail')}) = 1 THEN 'ok' ELSE json_extract('{}', 'bad-path') END AS written_row_guard`,
    ];
}

const STATEMENTS_PER_ROW = 5;

// The whole set as ONE call, so ONE transaction.
function migrationSql(plan) {
    return plan.flatMap(p => rowStatements(p, p.change_log_rows)).join(';\n') + '\n';
}

function whichGuard(message) {
    if (/malformed JSON/i.test(message)) return 'change_log count differed from the count read before the batch';
    if (/integer overflow/i.test(message)) return 'regular_season_games UPDATE did not change exactly 1 row';
    if (/bad JSON path/i.test(message)) return 'the renamed row is not the old date minus one day under the old id tail';
    if (/UNIQUE constraint/i.test(message)) return 'the target id already exists';
    return 'unclassified';
}

function selfTest() {
    const fails = [];
    const eq = (name, got, want) => {
        const g = JSON.stringify(got), w = JSON.stringify(want);
        if (g !== w) fails.push(`${name}: got ${g}, expected ${w}`);
    };
    // The two that fail a fixed offset in opposite directions (CC-CMD TASK 4).
    eq('EST evening', fieldDayOfInstant('2026-11-10T04:30:00Z'), '2026-11-09');
    eq('EDT after midnight', fieldDayOfInstant('2026-07-10T04:30:00Z'), '2026-07-10');
    eq('empty', fieldDayOfInstant(''), null);
    eq('garbage', fieldDayOfInstant('not a time'), null);

    // Real rows from the set, 2026-10-18.
    eq('plan e13419744', planRow({ id: 'CFL_2026-10-10_e13419744', date: '2026-10-10', start_time: '2026-10-10T02:12:00+00:00' }),
        { old_id: 'CFL_2026-10-10_e13419744', old_date: '2026-10-10', new_date: '2026-10-09',
          new_id: 'CFL_2026-10-09_e13419744', tail: '_e13419744', start_time: '2026-10-10T02:12:00+00:00' });
    // A day two back is not this defect's shape: skipped and reported, never renamed.
    eq('two days back skipped', planRow({ id: 'CFL_2026-10-11_e1', date: '2026-10-11', start_time: '2026-10-10T02:00:00Z' }).skip,
        'ET day 2026-10-09 is not the day before 2026-10-11');
    eq('plan slug id', planRow({ id: 'CFL_2026-08-23_torontoargonauts_hamiltontigercats', date: '2026-08-23', start_time: '2026-08-23T00:06:00+00:00' }).new_id,
        'CFL_2026-08-22_torontoargonauts_hamiltontigercats');
    // One of the 29 that agree: untouched.
    eq('agrees', planRow({ id: 'CFL_2026-10-17_e13419750', date: '2026-10-17', start_time: '2026-10-17T23:00:00+00:00' }), null);
    // Only the prefix is rebuilt, never a later occurrence of the date.
    eq('later date kept', planRow({ id: 'CFL_2026-10-10_x_2026-10-10', date: '2026-10-10', start_time: '2026-10-10T02:00:00Z' }).new_id,
        'CFL_2026-10-09_x_2026-10-10');
    eq('prefix mismatch skipped', planRow({ id: 'CFL_2026-10-11_e1', date: '2026-10-10', start_time: '2026-10-10T02:00:00Z' }).skip,
        'id does not start with CFL_2026-10-10');
    eq('unparseable skipped', planRow({ id: 'CFL_2026-10-10_e1', date: '2026-10-10', start_time: 'garbage' }).skip,
        'unparseable start_time');

    // lit() refuses anything that could break out of a literal.
    for (const bad of ["CFL_2026-10-10_x'; DROP TABLE briefs; --", 'CFL_2026-10-10_a b', '2026-10-10', '', null]) {
        let threw = false;
        try { lit(bad, 'id'); } catch (e) { threw = /refusing/.test(e.message); }
        if (!threw) fails.push(`lit accepted ${JSON.stringify(bad)} as id`);
    }
    eq('lit date', lit('2026-10-09', 'date'), "'2026-10-09'");

    eq('lit instant +00:00', lit('2026-10-10T02:12:00+00:00', 'instant'), "'2026-10-10T02:12:00+00:00'");
    eq('lit instant Z', lit('2026-05-23T02:00Z', 'instant'), "'2026-05-23T02:00Z'");
    for (const bad of ["2026-10-10T02:12:00+00:00' OR '1'='1", '2026-10-10 02:12:00', 'garbage']) {
        let threw = false;
        try { lit(bad, 'instant'); } catch (e) { threw = /refusing/.test(e.message); }
        if (!threw) fails.push(`lit accepted ${JSON.stringify(bad)} as instant`);
    }

    // Each row's guards sit after the statement they read, and the games
    // UPDATE matches on everything the new day was derived from.
    const r1 = { old_id: 'CFL_2026-09-13_e13419731', old_date: '2026-09-13', new_date: '2026-09-12',
                 new_id: 'CFL_2026-09-12_e13419731', tail: '_e13419731', start_time: '2026-09-13T02:14:00+00:00', change_log_rows: 2 };
    const r2 = { old_id: 'CFL_2026-10-10_e13419744', old_date: '2026-10-10', new_date: '2026-10-09',
                 new_id: 'CFL_2026-10-09_e13419744', tail: '_e13419744', start_time: '2026-10-10T02:12:00+00:00', change_log_rows: 0 };
    const stmts = migrationSql([r1, r2]).trimEnd().split(';\n');
    eq('two rows, five statements each, one call', stmts.length, 10);
    eq('change_log first', /^UPDATE change_log SET game_id = 'CFL_2026-09-12_e13419731' WHERE game_id = 'CFL_2026-09-13_e13419731'$/.test(stmts[0]), true);
    eq('change_log guard reads the counted rows', /changes\(\) = 2 THEN 'ok' ELSE json\('\{'\)/.test(stmts[1]), true);
    eq('games matches id, sport, old date and start_time',
       stmts[2], "UPDATE regular_season_games SET id = 'CFL_2026-09-12_e13419731', date = '2026-09-12' "
               + "WHERE id = 'CFL_2026-09-13_e13419731' AND sport = 'CFL' AND date = '2026-09-13' AND start_time = '2026-09-13T02:14:00+00:00'");
    eq('games guard is exactly 1', /changes\(\) = 1 THEN 'ok' ELSE abs\(/.test(stmts[3]), true);
    eq('written row read back against the OLD date and tail',
       stmts[4], "SELECT CASE WHEN (SELECT COUNT(*) FROM regular_season_games WHERE sport = 'CFL' AND start_time = '2026-09-13T02:14:00+00:00' "
               + "AND date = date('2026-09-13', '-1 day') AND id = 'CFL_' || date || '_e13419731') = 1 THEN 'ok' ELSE json_extract('{}', 'bad-path') END AS written_row_guard");
    eq('second row guards a zero change_log count', /changes\(\) = 0 THEN/.test(stmts[6]), true);
    eq('guard names', [whichGuard('malformed JSON: SQLITE_ERROR'), whichGuard('integer overflow: SQLITE_ERROR'),
                       whichGuard("bad JSON path: 'bad-path': SQLITE_ERROR"),
                       whichGuard('UNIQUE constraint failed: regular_season_games.id')],
        ['change_log count differed from the count read before the batch', 'regular_season_games UPDATE did not change exactly 1 row',
         'the renamed row is not the old date minus one day under the old id tail', 'the target id already exists']);

    if (fails.length) {
        console.error(`SELF-TEST FAILED (${fails.length}):`);
        for (const f of fails) console.error(`  ${f}`);
        process.exit(1);
    }
    console.log('self-test: all cases pass');
}

// READS: /d1/execute, one statement, params bound by the worker.
async function relayRead(sql, params = []) {
    const secret = process.env.RELAY_SHARED_SECRET;
    if (!secret) throw new Error('RELAY_SHARED_SECRET must be set for reads');
    const r = await fetch(`${RELAY}/d1/execute`, {
        method: 'POST',
        headers: { 'X-FIELD-Relay': secret, 'Content-Type': 'application/json' },
        body: JSON.stringify({ sql, params }),
    });
    const text = await r.text();
    let j;
    try { j = JSON.parse(text); } catch (e) { throw new Error(`/d1/execute HTTP ${r.status}, not JSON (${e.message}): ${text.slice(0, 200)}`); }
    if (!r.ok || j.success !== true || !Array.isArray(j.results)) {
        throw new Error(`/d1/execute HTTP ${r.status}: ${j.error || text.slice(0, 200)}`);
    }
    return j.results;
}

const placeholders = n => Array.from({ length: n }, (_, i) => `?${i + 1}`).join(', ');

async function countBy(table, ids) {
    const out = Object.fromEntries(ids.map(id => [id, 0]));
    if (!ids.length) return out;
    const got = await relayRead(`SELECT game_id, COUNT(*) AS n FROM ${table} WHERE game_id IN (${placeholders(ids.length)}) GROUP BY game_id`, ids);
    for (const r of got) out[r.game_id] = r.n;
    return out;
}

const sum = o => Object.values(o).reduce((a, b) => a + b, 0);

function table(rows, cols) {
    const w = cols.map(c => Math.max(c.length, ...rows.map(p => String(p[c] ?? '').length)));
    const line = vals => vals.map((v, i) => String(v ?? '').padEnd(w[i])).join('  ');
    return [line(cols), line(w.map(n => '-'.repeat(n))), ...rows.map(p => line(cols.map(c => p[c])))].join('\n');
}

// Plan and every precondition, from the live tables.
async function buildPlan(manifest) {
    // CFL rows in postseason_games would be outside this script's UPDATEs. The
    // writer sends no series_key, so there should be none; measured, not assumed.
    const post = await relayRead(`SELECT COUNT(*) AS n FROM postseason_games WHERE sport = ?1`, [SPORT]);
    manifest.cfl_postseason_rows = post[0].n;
    if (post[0].n !== 0) return { abort: `${post[0].n} CFL row(s) in postseason_games; this script only renames regular_season_games` };

    const cfl = await relayRead(`SELECT id, date, start_time FROM regular_season_games WHERE sport = ?1 AND start_time IS NOT NULL AND start_time != '' ORDER BY start_time`, [SPORT]);
    const noStart = await relayRead(`SELECT COUNT(*) AS n FROM regular_season_games WHERE sport = ?1 AND (start_time IS NULL OR start_time = '')`, [SPORT]);
    const planned = cfl.map(planRow).filter(Boolean);
    const plan = planned.filter(p => !p.skip);
    const skipped = planned.filter(p => p.skip);
    manifest.cfl_rows_with_start_time = cfl.length;
    manifest.cfl_rows_without_start_time = noStart[0].n;
    manifest.agreeing = cfl.length - planned.length;
    manifest.planned = plan.length;
    manifest.skipped = skipped;
    console.log(`CFL rows with a start_time: ${cfl.length}; without: ${noStart[0].n}`);
    console.log(`  already keyed on the ET day, untouched: ${manifest.agreeing}`);
    console.log(`  keyed on another day, planned: ${plan.length}`);
    console.log(`  skipped and reported: ${skipped.length}`);
    for (const x of skipped) console.log(`    SKIP ${x.old_id}: ${x.skip}`);

    // Collisions at every target id, games and change_log.
    const newIds = plan.map(p => p.new_id);
    const oldIds = plan.map(p => p.old_id);
    const collide = newIds.length
        ? await relayRead(`SELECT id FROM regular_season_games WHERE id IN (${placeholders(newIds.length)})`, newIds) : [];
    const clOnNew = await countBy('change_log', newIds);
    manifest.collisions = collide.map(r => r.id);
    manifest.change_log_already_on_new_ids = sum(clOnNew);

    // References. The code comment at the id builder names briefs; the
    // referencing surface measured at filing is four tables.
    const refs = {
        briefs: await countBy('briefs', oldIds),
        change_log: await countBy('change_log', oldIds),
        game_thread_notes: await countBy('game_thread_notes', oldIds),
        odds_history: await countBy('odds_history', oldIds),
    };
    manifest.references = Object.fromEntries(Object.entries(refs).map(([t, o]) => [t, sum(o)]));
    for (const p of plan) p.change_log_rows = refs.change_log[p.old_id];

    console.log('\n' + table(plan, ['old_id', 'start_time', 'old_date', 'new_date', 'new_id', 'change_log_rows']));
    console.log(`\ncollisions at target ids: ${collide.length}${collide.length ? ` (${manifest.collisions.join(', ')})` : ''}`);
    console.log(`change_log rows already on target ids: ${manifest.change_log_already_on_new_ids}`);
    console.log(`references to the old ids: briefs ${manifest.references.briefs}, change_log ${manifest.references.change_log}, `
              + `game_thread_notes ${manifest.references.game_thread_notes}, odds_history ${manifest.references.odds_history}`);
    manifest.plan = plan.map(p => ({ ...p }));

    if (collide.length) return { abort: `${collide.length} target id(s) already exist; that is a merge, which is not authorised` };
    if (manifest.change_log_already_on_new_ids) return { abort: 'change_log already has rows on a target id; that is a merge' };
    for (const t of ['briefs', 'game_thread_notes', 'odds_history']) {
        if (manifest.references[t]) return { abort: `${manifest.references[t]} ${t} row(s) reference an old id; the CC-CMD says stop and report` };
    }
    return { plan };
}

// The consumer's view: GET /context/date/<day>, games.regular. Fresh per run.
async function contextDay(date, stamp) {
    const r = await fetch(`${RELAY}/context/date/${date}?verify=${stamp}`);
    const text = await r.text();
    let j;
    try { j = JSON.parse(text); } catch (e) { throw new Error(`/context/date/${date} HTTP ${r.status}, not JSON (${e.message})`); }
    if (!r.ok || j.ok !== true || !j.games || !Array.isArray(j.games.regular)) {
        throw new Error(`/context/date/${date} HTTP ${r.status}: ${j.error || text.slice(0, 200)}`);
    }
    if (Array.isArray(j._errors) && j._errors.length) throw new Error(`/context/date/${date} reported ${JSON.stringify(j._errors)}`);
    return j.games.regular;
}

// Read back by id, from the tables themselves, against a committed plan.
async function verify(manifest, plan) {
    const oldIds = plan.map(p => p.old_id);
    const newIds = plan.map(p => p.new_id);
    const nowOld = await relayRead(`SELECT id FROM regular_season_games WHERE id IN (${placeholders(oldIds.length)})`, oldIds);
    const nowNew = await relayRead(`SELECT id, date, start_time, home, away FROM regular_season_games WHERE id IN (${placeholders(newIds.length)})`, newIds);
    const clOld = await countBy('change_log', oldIds);
    const clNew = await countBy('change_log', newIds);
    const byNew = Object.fromEntries(nowNew.map(r => [r.id, r]));
    manifest.after = plan.map(p => ({
        old_id: p.old_id, old_exists: nowOld.some(r => r.id === p.old_id),
        new_id: p.new_id, new_exists: p.new_id in byNew,
        new_date: p.new_id in byNew ? byNew[p.new_id].date : 'absent',
        change_log_old: clOld[p.old_id], change_log_new: clNew[p.new_id],
    }));
    console.log('\n' + table(manifest.after, ['old_id', 'old_exists', 'new_id', 'new_exists', 'new_date', 'change_log_old', 'change_log_new']));
    const bad = plan.filter((p, i) => {
        const a = manifest.after[i];
        return a.old_exists || !a.new_exists || a.new_date !== p.new_date
            || byNew[p.new_id].start_time !== p.start_time
            || a.change_log_old !== 0 || a.change_log_new !== p.change_log_rows;
    });
    // And the whole sport, not only the planned rows: nothing left on another day.
    const cfl = await relayRead(`SELECT id, date, start_time FROM regular_season_games WHERE sport = ?1 AND start_time IS NOT NULL AND start_time != ''`, [SPORT]);
    const still = cfl.map(planRow).filter(Boolean);
    manifest.cfl_rows_checked = cfl.length;
    manifest.cfl_still_off_day = still.map(x => x.old_id);
    console.log(`\nCFL rows still keyed on another day: ${still.length} of ${cfl.length} checked`);

    // TASK 5.5 names one game (BC Lions v Ottawa RedBlacks on 10-09, not 10-10).
    // Every planned row gets the same test through the same consumer: listed on
    // its new day under its new id, and nothing with its teams and start_time
    // left on its old day.
    const stamp = Date.now();
    const days = {};
    for (const d of new Set(plan.flatMap(p => [p.new_date, p.old_date]))) days[d] = await contextDay(d, stamp);
    const consumer = plan.map(p => {
        const row = byNew[p.new_id];
        const onNew = days[p.new_date].some(g => g.id === p.new_id);
        const onOld = row ? days[p.old_date].some(g => g.home === row.home && g.away === row.away && g.start_time === p.start_time) : null;
        return { new_id: p.new_id, game: row ? `${row.home} v ${row.away}` : 'absent', on_new_day: onNew, still_on_old_day: onOld };
    });
    manifest.context_date = consumer;
    const consumerBad = consumer.filter(c => !c.on_new_day || c.still_on_old_day !== false);
    console.log('\n' + table(consumer, ['new_id', 'game', 'on_new_day', 'still_on_old_day']));
    console.log(`\n/context/date: ${consumer.length - consumerBad.length} of ${consumer.length} planned rows listed on their new day and gone from their old one`);
    return { bad: [...bad, ...consumerBad.filter(c => !bad.some(b => b.new_id === c.new_id)).map(c => plan.find(p => p.new_id === c.new_id))], still };
}

async function main() {
    selfTest();
    if (SELF_TEST_ONLY) return 0;

    const mode = VERIFY ? 'verify' : 'dry-run';
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const base = OUT_ARG || `outbox/cfl-date-keying-migration-${mode}-${stamp}`;
    const manifest = { cc_cmd: 'CC-CMD-2026-10-16-cfl-archive-date-keying', task: 3, mode, started_at: new Date().toISOString(),
                       db: DB_ID, verdict: null, reason: null };
    const finish = (code, verdict, reason) => {
        manifest.verdict = verdict;
        manifest.reason = reason;
        manifest.finished_at = new Date().toISOString();
        fs.writeFileSync(`${base}.json`, JSON.stringify(manifest, null, 2) + '\n');
        console.log(`\nverdict: ${verdict}${reason ? ` — ${reason}` : ''}`);
        console.log(`manifest: ${base}.json`);
        return code;
    };

    if (VERIFY) {
        if (!PLAN_ARG) return finish(1, 'ABORT', '--verify needs --plan=<the dry-run manifest whose SQL was applied>');
        const planned = JSON.parse(fs.readFileSync(PLAN_ARG, 'utf8'));
        if (planned.verdict !== 'DRY-RUN' || !Array.isArray(planned.plan) || !planned.plan.length) {
            return finish(1, 'ABORT', `${PLAN_ARG} is not a dry-run manifest with a plan`);
        }
        manifest.plan_from = PLAN_ARG;
        const { bad, still } = await verify(manifest, planned.plan);
        if (bad.length) return finish(1, 'FAILED', `read-back or /context/date disagrees for ${bad.length} of ${planned.plan.length}: ${bad.map(b => b.old_id).join(', ')}`);
        if (still.length) return finish(1, 'FAILED', `${still.length} CFL row(s) still keyed on another day: ${still.map(x => x.old_id).join(', ')}`);
        return finish(0, 'VERIFIED', `${planned.plan.length} of ${planned.plan.length} renamed, read back, and listed by /context/date on their new day only; 0 CFL rows off their ET day`);
    }

    const built = await buildPlan(manifest);
    if (built.abort) return finish(1, 'ABORT', built.abort);
    const { plan } = built;
    if (!plan.length && manifest.skipped.length) {
        return finish(1, 'SKIPPED-ONLY', `${manifest.skipped.length} CFL row(s) are off their ET day and every one was skipped; nothing is planned and nothing is fixed`);
    }
    if (!plan.length) return finish(0, 'NOTHING-TO-DO', 'every CFL row already carries its ET day');
    const sql = migrationSql(plan);

    fs.writeFileSync(`${base}.sql`, sql);
    manifest.sql_file = `${base}.sql`;
    manifest.statements = plan.length * STATEMENTS_PER_ROW;
    console.log(`\nthe transaction, ${plan.length * STATEMENTS_PER_ROW} statements, one call: ${base}.sql`);
    return finish(0, 'DRY-RUN', `${plan.length} row(s) would be renamed; nothing was written`
        + (manifest.skipped.length ? `; ${manifest.skipped.length} more off-day row(s) skipped and listed above` : ''));
}

main().then(code => process.exit(code), e => { console.error(`ERROR: ${e.message}`); process.exit(1); });
