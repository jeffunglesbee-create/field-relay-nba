#!/usr/bin/env node
// CC-CMD-2026-10-16-cfl-archive-date-keying, TASK 3.
//
// The CFL archive writer stamped `date` with the UTC calendar day of kickoff.
// Every kickoff after 20:00 ET falls on the next UTC day, so those rows carry a
// date one day ahead, and because the date is embedded in the archive id each
// one is a wrong primary key, not just a wrong column. This renames them.
//
//   node scripts/migrate-cfl-date-keying.mjs --self-test
//   node scripts/migrate-cfl-date-keying.mjs                    dry run: reads only
//   node scripts/migrate-cfl-date-keying.mjs --apply --expect=N  writes
//
// Env: CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID. --out=<path> writes the
// manifest (default outbox/cfl-date-keying-migration-<mode>-<stamp>.json).
//
// WHY THE CLOUDFLARE D1 REST API AND NOT /d1/execute
//
// The CC-CMD says "per row, in one batch". /d1/execute prepares exactly one
// statement, so the two UPDATEs below would be two requests and a failure
// between them would leave change_log pointing at an id the games table does
// not have. The REST /query endpoint takes several statements in one call.
// Measured 2026-10-18 against field-archive, not taken from documentation:
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
// transaction rather than after it has committed. The CC-CMD: "A `changes`
// count that is not 1 per statement is a failure, not a warning." A failure
// discovered after commit is a report; a failure inside the batch is a
// rollback. Each guard fails with a distinct SQLite error so the message names
// which one fired:
//
//   change_log guard        json('{')                    "malformed JSON"
//   regular_season_games    abs(-9223372036854775807-1)  "integer overflow"
//   an id that already exists                            "UNIQUE constraint"
//
// change_log's expected count is the number of rows read for that id moments
// earlier (2 + 2 across the set on 2026-10-18), not 1: the CC-CMD's "1 per
// statement" is about the games row, which is one row by primary key.
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
const APPLY = ARGS.includes('--apply');
const EXPECT = (ARGS.find(a => a.startsWith('--expect=')) || '').slice('--expect='.length);
const OUT_ARG = (ARGS.find(a => a.startsWith('--out=')) || '').slice('--out='.length);

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

// A literal for the multi-statement batch. Closed patterns only: nothing that
// could carry a quote, a semicolon or whitespace reaches the SQL text.
function lit(value, kind) {
    const re = kind === 'date' ? DATE_RE : kind === 'id' ? ID_RE : null;
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
    const new_id = `CFL_${new_date}${old_id.slice(prefix.length)}`;
    return { old_id, old_date, new_date, new_id, start_time: row.start_time };
}

// The per-row transaction. Order matters only for the guards: each SELECT
// reads changes() of the statement immediately before it.
function rowBatchSql(p, changeLogCount) {
    return [
        `UPDATE change_log SET game_id = ${lit(p.new_id, 'id')} WHERE game_id = ${lit(p.old_id, 'id')}`,
        `SELECT CASE WHEN changes() = ${intLit(changeLogCount)} THEN 'ok' ELSE json('{') END AS change_log_guard`,
        `UPDATE regular_season_games SET id = ${lit(p.new_id, 'id')}, date = ${lit(p.new_date, 'date')} `
            + `WHERE id = ${lit(p.old_id, 'id')} AND sport = 'CFL' AND date = ${lit(p.old_date, 'date')}`,
        `SELECT CASE WHEN changes() = 1 THEN 'ok' ELSE abs(-9223372036854775807 - 1) END AS games_guard`,
    ].join(';\n');
}

function whichGuard(message) {
    if (/malformed JSON/i.test(message)) return 'change_log count differed from the count read before the batch';
    if (/integer overflow/i.test(message)) return 'regular_season_games UPDATE did not change exactly 1 row';
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
          new_id: 'CFL_2026-10-09_e13419744', start_time: '2026-10-10T02:12:00+00:00' });
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

    // The batch carries both guards, each after the statement it reads.
    const sql = rowBatchSql({ old_id: 'CFL_2026-09-13_e13419731', old_date: '2026-09-13',
                              new_date: '2026-09-12', new_id: 'CFL_2026-09-12_e13419731' }, 2);
    const stmts = sql.split(';\n');
    eq('batch statements', stmts.length, 4);
    eq('change_log first', /^UPDATE change_log/.test(stmts[0]), true);
    eq('change_log guard count', /changes\(\) = 2 THEN/.test(stmts[1]), true);
    eq('games second', /^UPDATE regular_season_games SET id = 'CFL_2026-09-12_e13419731', date = '2026-09-12' WHERE id = 'CFL_2026-09-13_e13419731' AND sport = 'CFL' AND date = '2026-09-13'$/.test(stmts[2]), true);
    eq('games guard is 1', /changes\(\) = 1 THEN/.test(stmts[3]), true);
    eq('guard names', [whichGuard('malformed JSON: SQLITE_ERROR'), whichGuard('integer overflow: SQLITE_ERROR'),
                       whichGuard('UNIQUE constraint failed: regular_season_games.id')].map(s => s.split(' ')[0]),
        ['change_log', 'regular_season_games', 'the']);

    if (fails.length) {
        console.error(`SELF-TEST FAILED (${fails.length}):`);
        for (const f of fails) console.error(`  ${f}`);
        process.exit(1);
    }
    console.log('self-test: all cases pass');
}

async function d1(sql, params) {
    const token = process.env.CLOUDFLARE_API_TOKEN;
    const account = process.env.CLOUDFLARE_ACCOUNT_ID;
    if (!token || !account) throw new Error('CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID must both be set');
    const body = params && params.length ? { sql, params } : { sql };
    const r = await fetch(`https://api.cloudflare.com/client/v4/accounts/${account}/d1/database/${DB_ID}/query`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });
    const text = await r.text();
    let j;
    try { j = JSON.parse(text); } catch (e) { throw new Error(`HTTP ${r.status}, body is not JSON (${e.message}): ${text.slice(0, 200)}`); }
    if (!r.ok || j.success !== true) {
        const msg = Array.isArray(j.errors) && j.errors.length
            ? j.errors.map(e => `${e.code}: ${e.message}`).join('; ')
            : `HTTP ${r.status}`;
        throw new Error(msg);
    }
    if (!Array.isArray(j.result)) throw new Error(`HTTP ${r.status}, success but no result array`);
    return j.result;
}

async function rows(sql, params) {
    const res = await d1(sql, params);
    if (res.length !== 1 || !Array.isArray(res[0].results)) throw new Error(`expected one result set, got ${res.length}`);
    return res[0].results;
}

const placeholders = n => Array.from({ length: n }, (_, i) => `?${i + 1}`).join(', ');

async function countBy(table, ids) {
    const out = Object.fromEntries(ids.map(id => [id, 0]));
    if (!ids.length) return out;
    const got = await rows(`SELECT game_id, COUNT(*) AS n FROM ${table} WHERE game_id IN (${placeholders(ids.length)}) GROUP BY game_id`, ids);
    for (const r of got) out[r.game_id] = r.n;
    return out;
}

const sum = o => Object.values(o).reduce((a, b) => a + b, 0);

function table(plan, cols) {
    const w = cols.map(c => Math.max(c.length, ...plan.map(p => String(p[c] ?? '').length)));
    const line = vals => vals.map((v, i) => String(v ?? '').padEnd(w[i])).join('  ');
    return [line(cols), line(w.map(n => '-'.repeat(n))), ...plan.map(p => line(cols.map(c => p[c])))].join('\n');
}

async function main() {
    selfTest();
    if (SELF_TEST_ONLY) return 0;

    const mode = APPLY ? 'apply' : 'dry-run';
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const outPath = OUT_ARG || `outbox/cfl-date-keying-migration-${mode}-${stamp}.json`;
    const manifest = { cc_cmd: 'CC-CMD-2026-10-16-cfl-archive-date-keying', task: 3, mode, started_at: new Date().toISOString(),
                       db: DB_ID, verdict: null, reason: null };
    const finish = (code, verdict, reason) => {
        manifest.verdict = verdict;
        manifest.reason = reason;
        manifest.finished_at = new Date().toISOString();
        fs.writeFileSync(outPath, JSON.stringify(manifest, null, 2) + '\n');
        console.log(`\nverdict: ${verdict}${reason ? ` — ${reason}` : ''}`);
        console.log(`manifest: ${outPath}`);
        return code;
    };

    // CFL rows in postseason_games would be outside this script's two UPDATEs.
    // The writer sends no series_key, so there should be none; measured, not assumed.
    const post = await rows(`SELECT COUNT(*) AS n FROM postseason_games WHERE sport = ?1`, [SPORT]);
    manifest.cfl_postseason_rows = post[0].n;
    if (post[0].n !== 0) return finish(1, 'ABORT', `${post[0].n} CFL row(s) in postseason_games; this script only renames regular_season_games`);

    const cfl = await rows(`SELECT id, date, start_time FROM regular_season_games WHERE sport = ?1 AND start_time IS NOT NULL AND start_time != '' ORDER BY start_time`, [SPORT]);
    const noStart = await rows(`SELECT COUNT(*) AS n FROM regular_season_games WHERE sport = ?1 AND (start_time IS NULL OR start_time = '')`, [SPORT]);
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
    for (const s of skipped) console.log(`    SKIP ${s.old_id}: ${s.skip}`);

    // Collisions, at runtime, at every target id: games and change_log.
    const newIds = plan.map(p => p.new_id);
    const oldIds = plan.map(p => p.old_id);
    const collide = newIds.length
        ? await rows(`SELECT id FROM regular_season_games WHERE id IN (${placeholders(newIds.length)})`, newIds) : [];
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

    if (collide.length) return finish(1, 'ABORT', `${collide.length} target id(s) already exist; that is a merge, which is not authorised`);
    if (manifest.change_log_already_on_new_ids) return finish(1, 'ABORT', 'change_log already has rows on a target id; that is a merge');
    for (const t of ['briefs', 'game_thread_notes', 'odds_history']) {
        if (manifest.references[t]) return finish(1, 'ABORT', `${manifest.references[t]} ${t} row(s) reference an old id; the CC-CMD says stop and report`);
    }

    if (!APPLY) return finish(0, 'DRY-RUN', `${plan.length} row(s) would be renamed; nothing was written`);

    if (String(plan.length) !== EXPECT) {
        return finish(1, 'ABORT', `--expect=${EXPECT || '(missing)'} but the plan has ${plan.length}; read the dry run and pass its count`);
    }

    manifest.applied = [];
    for (const p of plan) {
        const sql = rowBatchSql(p, p.change_log_rows);
        let res;
        try {
            res = await d1(sql);
        } catch (e) {
            manifest.failed = { old_id: p.old_id, error: e.message, guard: whichGuard(e.message) };
            console.log(`  FAIL ${p.old_id}: ${e.message} — ${whichGuard(e.message)}; this row rolled back, rows before it stay applied`);
            return finish(1, 'FAILED', `${manifest.applied.length} of ${plan.length} applied before ${p.old_id} failed`);
        }
        const changes = res.map(r => r.meta && r.meta.changes);
        const guards = [res[1].results[0].change_log_guard, res[3].results[0].games_guard];
        manifest.applied.push({ old_id: p.old_id, new_id: p.new_id, change_log_changes: changes[0], games_changes: changes[2], guards });
        console.log(`  OK   ${p.old_id} -> ${p.new_id}  change_log ${changes[0]}  regular_season_games ${changes[2]}`);
        // Belt and braces: the guards already enforced both inside the transaction.
        if (changes[0] !== p.change_log_rows || changes[2] !== 1) {
            return finish(1, 'FAILED', `${p.old_id} committed with change counts ${changes[0]}/${changes[2]}, expected ${p.change_log_rows}/1`);
        }
    }

    // Read back, by id, from the table itself.
    const nowOld = await rows(`SELECT id FROM regular_season_games WHERE id IN (${placeholders(oldIds.length)})`, oldIds);
    const nowNew = await rows(`SELECT id, date FROM regular_season_games WHERE id IN (${placeholders(newIds.length)})`, newIds);
    const clOld = await countBy('change_log', oldIds);
    const clNew = await countBy('change_log', newIds);
    const newDate = Object.fromEntries(nowNew.map(r => [r.id, r.date]));
    manifest.after = plan.map(p => ({ old_id: p.old_id, old_exists: nowOld.some(r => r.id === p.old_id),
                                      new_id: p.new_id, new_exists: p.new_id in newDate, new_date: newDate[p.new_id] ?? null,
                                      change_log_old: clOld[p.old_id], change_log_new: clNew[p.new_id] }));
    console.log('\n' + table(manifest.after, ['old_id', 'old_exists', 'new_id', 'new_exists', 'new_date', 'change_log_old', 'change_log_new']));
    const bad = manifest.after.filter((a, i) => a.old_exists || !a.new_exists || a.new_date !== plan[i].new_date
                                                || a.change_log_old !== 0 || a.change_log_new !== plan[i].change_log_rows);
    if (bad.length) return finish(1, 'FAILED', `read-back disagrees for ${bad.length} row(s): ${bad.map(b => b.old_id).join(', ')}`);
    return finish(0, 'APPLIED', `${plan.length} of ${plan.length} renamed; read-back agrees on every row`);
}

main().then(code => process.exit(code), e => { console.error(`ERROR: ${e.message}`); process.exit(1); });
