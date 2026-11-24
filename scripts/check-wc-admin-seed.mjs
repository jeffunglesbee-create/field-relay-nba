#!/usr/bin/env node
// POST /wc/admin/seed completes: it writes the row, backfills bsd_event_id, recomputes the group and answers.
// docs/CC-CMD-2026-11-07-wc-results-club-contamination.md, "Also found, pre-existing".
//
// WHY. handleWCAdminSeed destructured seven names from the body and read an eighth, `bsd_event_id`, four statements later (after
// the INSERT): it was never bound, so every call threw `ReferenceError: bsd_event_id is not defined` AFTER the row was written. The
// standings recompute and the response never ran, and the caller got a 500 for a write that had landed. Found by two reviews that
// ran the real handler (2026-11-07); fixed here, with the check that holds it.
//
// WHAT THIS RUNS. The REAL worker (src/index.js default export) on POST /wc/admin/seed with a stub WC2026_DB that records every
// statement and its binds, in order. src/index.js imports @cloudflare/puppeteer, which this repo's CI does not install, so a resolve
// hook stubs that one package (the hook scripts/check-wc-tables-world-cup-only.mjs uses).
//
//   with bsd_event_id     200, ok, the group in the answer upper-cased; statements in THIS ORDER: the INSERT (every bind and the phase
//                         literal 'group'), `UPDATE wc_results SET bsd_event_id` bound to [String(id), game_id] (after the INSERT,
//                         which is REPLACE and would wipe it), the group recompute (DELETE FROM wc_group), the standings SELECT for
//                         the upper-cased group.
//   without bsd_event_id  the same without the UPDATE; a 0-0 body binds [0, 0], not a default.
//   gates                 no bearer, a wrong bearer, and no FIELD_MCP_SECRET bound at all: 401 each, and no statement of any kind.
//                         A body missing group_id, and a body that is not JSON: 400, and no statement.
//
// Coverage is printed with the result (Rule 91). NOT checked: the standings arithmetic (the stub records the recompute and returns
// canned rows), the real D1 schema (the stub never runs SQL), whether the caller's group_id names a real group (the handler does not),
// the 503 for an unbound WC2026_DB, and the team-name normalisation (the names used here resolveTeamName leaves unchanged).
//
//   node scripts/check-wc-admin-seed.mjs            # self-test
//   node scripts/check-wc-admin-seed.mjs --mutate   # Rule 90

import { register } from 'node:module';
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

register('data:text/javascript,' + encodeURIComponent(
  "export async function resolve(s, c, next) { if (s === '@cloudflare/puppeteer') return { url: 'data:text/javascript,export default {}', shortCircuit: true }; return next(s, c); }"));

const HERE = path.dirname(fileURLToPath(import.meta.url));
const INDEX = path.resolve(HERE, '../src/index.js');
const INDEX_MODULE = process.env.INDEX_MODULE || INDEX;
const SECRET = 'seed-check-secret';

const BODY = { game_id: 'manual:wc26_check_2026-06-20', group_id: 'e', home: 'Germany', away: 'Paraguay', home_score: 2, away_score: 1, match_date: '2026-06-20' };

/** One POST /wc/admin/seed. `bearer` null sends none; `secret` false leaves FIELD_MCP_SECRET unbound; `raw` sends the body as given. */
async function seed(worker, body, { bearer = SECRET, secret = true, raw = null } = {}) {
  const stmts = [], other = [];
  const mk = (sql) => {
    const rec = { sql, binds: null };
    stmts.push(rec);
    const s = { run: async () => ({ meta: { changes: 1 } }), first: async () => null, all: async () => ({ results: [{ group_id: 'E', team: 'Germany', played: 1, points: 3 }] }), bind: (...a) => { rec.binds = a; return s; } };
    return s;
  };
  // Any member other than prepare (exec, batch, ...) is recorded: a write the stub could not see would otherwise pass as "nothing written".
  const db = new Proxy({ prepare: mk }, { get(t, k) { if (k in t) return t[k]; other.push(String(k)); return undefined; } });
  const env = { WC2026_DB: db, ...(secret ? { FIELD_MCP_SECRET: SECRET } : {}) };
  const headers = { 'Content-Type': 'application/json', ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}) };
  const waits = [];
  const ctx = { waitUntil: p => waits.push(p), passThroughOnException() {} };
  let r, thrown = null;
  const err = console.error; console.error = () => {};
  try { r = await worker.fetch(new Request('http://relay.test/wc/admin/seed', { method: 'POST', headers, body: raw ?? JSON.stringify(body) }), env, ctx); }
  catch (e) { thrown = String(e && e.message || e); } finally { console.error = err; }
  await Promise.allSettled(waits);
  let json = null;
  try { json = r ? await r.json() : null; } catch (_) { /* not JSON */ }
  // The statements, in the order they ran, by kind. A statement of an unknown kind is its own entry, so it cannot hide.
  const order = stmts.map(s => /INSERT\s+OR\s+REPLACE\s+INTO\s+wc_results/i.test(s.sql) ? 'insert'
    : /UPDATE\s+wc_results\s+SET\s+bsd_event_id/i.test(s.sql) ? 'bsd'
    : /DELETE FROM wc_group/.test(s.sql) ? 'recompute'
    : /INSERT\s+INTO\s+wc_group/.test(s.sql) ? 'recompute-insert'
    : /^\s*SELECT \* FROM wc_group WHERE group_id = \?/.test(s.sql) ? 'select' : `other:${s.sql.trim().slice(0, 30)}`);
  const by = (k) => stmts.filter((_, i) => order[i] === k);
  return { status: r ? r.status : null, thrown, json, order, other, statements: stmts.length,
    insert: by('insert').map(s => ({ binds: s.binds, phaseIsGroup: /VALUES\s*\(\?, \?, \?, \?, \?, \?, 'group', \?\)/.test(s.sql) })),
    bsd: by('bsd').map(s => s.binds), recomputeBinds: by('recompute').map(s => s.binds), selectBinds: by('select').map(s => s.binds) };
}

async function selfTest() {
  let failed = 0;
  const eq = (name, got, want) => {
    const ok = JSON.stringify(got) === JSON.stringify(want);
    if (!ok) failed++;
    console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name}${ok ? '' : `\n         got  ${JSON.stringify(got)}\n         want ${JSON.stringify(want)}`}`);
  };
  const worker = (await import(pathToFileURL(INDEX_MODULE).href)).default;

  const a = await seed(worker, { ...BODY, bsd_event_id: 8361 });
  eq('with bsd_event_id: 200, ok, no throw, group upper-cased, standings returned', [a.status, a.thrown, a.json?.ok, a.json?.group, Array.isArray(a.json?.standings)], [200, null, true, 'E', true]);
  eq('with bsd_event_id: the statements run in order: INSERT, backfill, recompute (delete, insert), standings SELECT; nothing else', [a.order, a.other], [['insert', 'bsd', 'recompute', 'recompute-insert', 'select'], []]);
  eq('with bsd_event_id: the row is written whole: id, upper-cased group, home, away, scores, date, phase \'group\'', a.insert, [{ binds: [BODY.game_id, 'E', 'Germany', 'Paraguay', 2, 1, '2026-06-20'], phaseIsGroup: true }]);
  eq('with bsd_event_id: the id is backfilled as a string, bound to the game', a.bsd, [['8361', BODY.game_id]]);
  eq('with bsd_event_id: the group is recomputed and read back under the upper-cased group', [a.recomputeBinds, a.selectBinds], [[['E']], [['E']]]);

  const b = await seed(worker, BODY);
  eq('without bsd_event_id: 200, ok, standings returned', [b.status, b.thrown, b.json?.ok, Array.isArray(b.json?.standings)], [200, null, true, true]);
  eq('without bsd_event_id: INSERT, recompute, standings SELECT; no backfill; nothing else', [b.order, b.other], [['insert', 'recompute', 'recompute-insert', 'select'], []]);

  const z = await seed(worker, { ...BODY, home_score: 0, away_score: 0 });
  eq('a 0-0 body binds [0, 0] (not a default)', z.insert.map(i => i.binds.slice(4, 6)), [[0, 0]]);
  const z2 = await seed(worker, { game_id: BODY.game_id, group_id: 'E', home: 'Germany', away: 'Paraguay' });
  eq('a body with no scores and no date binds [0, 0] and writes a date', [z2.insert.map(i => i.binds.slice(4, 6)), /^\d{4}-\d\d-\d\d$/.test(String(z2.insert[0]?.binds?.[6]))], [[[0, 0]], true]);

  const none = { status: 401, statements: 0, other: [] };
  const c = await seed(worker, { ...BODY, bsd_event_id: 8361 }, { bearer: null });
  eq('gate: no bearer is refused and nothing is touched', { status: c.status, statements: c.statements, other: c.other }, none);
  const d = await seed(worker, { ...BODY, bsd_event_id: 8361 }, { bearer: 'not-the-secret' });
  eq('gate: a wrong bearer is refused and nothing is touched', { status: d.status, statements: d.statements, other: d.other }, none);
  const e = await seed(worker, { ...BODY, bsd_event_id: 8361 }, { bearer: null, secret: false });
  eq('gate: with FIELD_MCP_SECRET unbound and no bearer the route stays CLOSED', { status: e.status, statements: e.statements, other: e.other }, none);
  const f = await seed(worker, { ...BODY, group_id: undefined });
  eq('a body missing group_id is 400 and nothing is touched', { status: f.status, statements: f.statements, other: f.other }, { status: 400, statements: 0, other: [] });
  const g = await seed(worker, null, { raw: 'not json' });
  eq('a body that is not JSON is 400 and nothing is touched', { status: g.status, statements: g.statements, other: g.other }, { status: 400, statements: 0, other: [] });

  console.log(`\nCOVERAGE: 9 requests against the real worker (${path.relative(HERE, INDEX_MODULE) || INDEX_MODULE}): with and without bsd_event_id, a 0-0 body, a body with no scores, three gates (no bearer, a wrong one, no secret bound), a missing field, and a body that is not JSON. NOT checked: the standings arithmetic (the stub records the recompute and returns canned rows), the real D1 schema, the 503 for an unbound WC2026_DB, whether group_id names a real group, and team-name normalisation.`);
  console.log(failed ? `SELF-TEST FAILED: ${failed}` : 'self-test passed');
  return failed;
}

// [name, [[from, to], ...]]. Every anchor must occur exactly once, or the mutation is not run and the gate fails
// (Rule 90's corollary: NOT CAUGHT with nothing applied is worse than no test).
const GATE = "if (auth !== env.FIELD_MCP_SECRET)\n        return new Response('Unauthorized', { status: 401, headers: CORS });\n    if (!env.WC2026_DB)\n        return new Response('WC2026_DB not bound'";
const INSERT_BLOCK = "    await env.WC2026_DB.prepare(`\n      INSERT OR REPLACE INTO wc_results";
const BACKFILL = "    // Backfill bsd_event_id when provided in POST body\n    if (bsd_event_id) {\n        await env.WC2026_DB.prepare(\n            'UPDATE wc_results SET bsd_event_id = ? WHERE game_id = ?'\n        ).bind(String(bsd_event_id), game_id).run();\n    }\n";
const RECOMPUTE = "    await recomputeGroupStandings(env.WC2026_DB, group_id.toUpperCase());\n";
const MUTATIONS = [
  ['bsd_event_id is not bound again (the original defect)', [["const { game_id, group_id, home, away, home_score, away_score, match_date, bsd_event_id } = body || {};", "const { game_id, group_id, home, away, home_score, away_score, match_date } = body || {};"]]],
  ['the id is backfilled onto the wrong game', [[".bind(String(bsd_event_id), game_id).run();", ".bind(String(bsd_event_id), home).run();"]]],
  ['the id is backfilled unconditionally (even when absent)', [["if (bsd_event_id) {", "if (true) {"]]],
  ['the id is backfilled BEFORE the row it belongs to (the REPLACE then wipes it)', [[BACKFILL, ""], [INSERT_BLOCK, BACKFILL + INSERT_BLOCK]]],
  ['the group is recomputed BEFORE the row is written (the table is empty)', [[RECOMPUTE, ""], [INSERT_BLOCK, RECOMPUTE + INSERT_BLOCK]]],
  ['the group is not recomputed', [["await recomputeGroupStandings(env.WC2026_DB, group_id.toUpperCase());\n    const { results }", "const { results }"]]],
  ['the standings are read back under the un-uppercased group', [[").bind(group_id.toUpperCase()).all();", ").bind(group_id).all();"]]],
  ['the answer carries no standings', [["standings: results }", "standings: null }"]]],
  ['the seed row is written with another phase', [["VALUES (?, ?, ?, ?, ?, ?, 'group', ?)\n    `).bind(game_id, group_id.toUpperCase(), homeFixed, awayFixed,", "VALUES (?, ?, ?, ?, ?, ?, 'final', ?)\n    `).bind(game_id, group_id.toUpperCase(), homeFixed, awayFixed,"]]],
  ['the seed row swaps home and away', [[".bind(game_id, group_id.toUpperCase(), homeFixed, awayFixed,", ".bind(game_id, group_id.toUpperCase(), awayFixed, homeFixed,"]]],
  ['the seed row drops the scores', [["parseInt(home_score)||0, parseInt(away_score)||0,", "0, 0,"]]],
  ['a zero score falls back to 1', [["parseInt(home_score)||0, parseInt(away_score)||0,", "parseInt(home_score)||1, parseInt(away_score)||1,"]]],
  ['the bearer gate accepts any non-empty bearer', [[GATE, GATE.replace("if (auth !== env.FIELD_MCP_SECRET)", "if (!auth)")]]],
  ['the bearer gate fails OPEN when the secret is unbound', [[GATE, GATE.replace("if (auth !== env.FIELD_MCP_SECRET)", "if (env.FIELD_MCP_SECRET && auth !== env.FIELD_MCP_SECRET)")]]],
  ['the bearer gate is gone', [[GATE, GATE.replace("if (auth !== env.FIELD_MCP_SECRET)", "if (false)")]]],
  ['a missing group_id is no longer refused', [["if (!game_id || !group_id || !home || !away)", "if (false)"]]],
  ['the backfill goes through db.exec', [["await env.WC2026_DB.prepare(\n            'UPDATE wc_results SET bsd_event_id = ? WHERE game_id = ?'\n        ).bind(String(bsd_event_id), game_id).run();", "await env.WC2026_DB.exec('UPDATE wc_results SET bsd_event_id = 1');"]]],
];

function mutate() {
  const base = spawnSync(process.execPath, [fileURLToPath(import.meta.url)], { encoding: 'utf8', timeout: 120000 });
  if (base.status !== 0) { console.log('BASELINE RED: mutations not run.\n' + base.stdout + base.stderr); return 1; }
  let bad = 0;
  for (const [name, edits] of MUTATIONS) {
    let text = readFileSync(INDEX, 'latin1'), why = null;
    for (const [from, to] of edits) {
      const at = text.indexOf(from);
      if (at < 0 || text.indexOf(from, at + 1) >= 0) { why = at < 0 ? 'missing' : 'not unique'; break; }
      text = text.slice(0, at) + to + text.slice(at + from.length);
    }
    if (why) { console.log(`  ANCHOR     ${name} (${why}): not run`); bad++; continue; }
    const mutant = path.join(path.dirname(INDEX), `.mutant-${process.pid}-wc-admin-seed-index.js`);
    writeFileSync(mutant, text, 'latin1');
    try {
      const r = spawnSync(process.execPath, [fileURLToPath(import.meta.url)], { encoding: 'utf8', timeout: 120000, env: { ...process.env, INDEX_MODULE: mutant } });
      const fails = (r.stdout.match(/^  FAIL (.*)$/gm) || []).map(l => l.slice(7));
      if (r.status !== 0 && /SELF-TEST FAILED/.test(r.stdout) && fails.length) {
        console.log(`  CAUGHT     ${name}\n               by: ${fails.slice(0, 3).join(' | ')}${fails.length > 3 ? ` | (+${fails.length - 3} more)` : ''}`);
      } else if (r.status === 0) {
        console.log(`  NOT CAUGHT ${name}`); bad++;
      } else {
        console.log(`  HARNESS ERROR ${name} (exit ${r.status}, no failing assertion)\n${(r.stderr || '').slice(0, 400)}`); bad++;
      }
    } finally { unlinkSync(mutant); }
  }
  console.log(`\nmutations: ${MUTATIONS.length - bad} of ${MUTATIONS.length} caught`);
  return bad ? 1 : 0;
}

if (process.argv.includes('--mutate')) process.exit(mutate());
else process.exit(await selfTest() ? 1 : 0);
