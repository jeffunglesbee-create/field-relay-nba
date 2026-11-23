#!/usr/bin/env node
// Rule 90 for scripts/bsd-next-goal-grade.mjs: the part of the grade that runs here, where the BSD token is.
//
// The grading RULE and its counts are field-laboratory's (scripts/check-bsd-next-goal-grade-core.mjs proves them). This proves the
// RUN: that the lab's module is loaded and shape-checked before a request is spent, that the population handed to it is the census's
// own, that a core which drops or double-counts a call stops the artifact advancing, that the token can never reach the committed
// file, and that the artifact ties its numbers to the code that made them. It starts a stub vendor and a stub relay on local ports,
// runs the real runner against them with the REAL lab core (BSD_BASE, RELAY_URL, LAB_CORE), and asserts from what the stubs
// RECEIVED and from the files the runner WROTE.
//
// WHAT IT DOES NOT COVER: the real vendor and relay (a live run is the only test of those), the laboratory checkout step in the
// workflow, and GitHub Actions.
// SAMPLE-COVERAGE-A (Rule 91): scenarios and assertions are printed; fewer than the minimum cannot pass.
//
// Usage: node scripts/check-bsd-next-goal-grade-run.mjs [--lab DIR] [--source scripts/bsd-next-goal-grade.mjs]
//   DIR is a field-laboratory checkout (default: lab, where the workflow puts it)

import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';

export const MIN_SCENARIOS = 15;
export const MIN_ASSERTIONS = 53;

const argv = process.argv.slice(2);
const flag = (name, dflt) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : dflt; };
const SOURCE = path.resolve(flag('--source', 'scripts/bsd-next-goal-grade.mjs'));
const LAB = path.resolve(flag('--lab', 'lab'));
const CORE = path.join(LAB, 'scripts/bsd-next-goal-grade-core.mjs');
const TOKEN = 'test-token-0123456789';

// The exit hook is registered BEFORE the imports below: the runner is imported, and a runner that exits at import time must
// not be able to end this check green.
let scenarios = 0, assertions = 0, failed = 0;
let finished = false;
process.on('exit', (code) => {
  if (!finished) { console.log(`FAIL  the check did not run to its end (exit ${code}, ${scenarios} scenarios, ${assertions} assertions)`); process.exitCode = 1; }
});
const stable = (v) => JSON.stringify(v, (k, val) => (val && typeof val === 'object' && !Array.isArray(val)
  ? Object.fromEntries(Object.entries(val).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) : val));
const eq = (label, got, want) => {
  assertions++;
  if (stable(got) !== stable(want)) { failed++; console.log(`FAIL  ${label}\n        got  ${stable(got)}\n        want ${stable(want)}`); }
};
const scenario = async (name, fn) => { scenarios++; try { await fn(); } catch (e) { failed++; console.log(`FAIL  ${name} threw: ${e.stack || e.message}`); } };

if (!fs.existsSync(CORE)) { console.log(`FAIL  no laboratory checkout at ${LAB} (looked for scripts/bsd-next-goal-grade-core.mjs); pass --lab DIR`); process.exit(1); }
const lab = await import(pathToFileURL(path.join(LAB, 'scripts/fixtures/bsd-next-goal-grade-synthetic.mjs')).href);
const realCore = await import(pathToFileURL(CORE).href);
const { call, key, listPage, ftRow, liveRow } = await import(pathToFileURL(path.resolve('scripts/fixtures/bsd-next-goal-census-synthetic.mjs')).href);
const { populationOf } = await import(pathToFileURL(SOURCE).href);

// ---- the world: nine ledger calls on four matches, built so every disposition happens once
const gcall = (o) => ({ ...call({ id: o.id, ev: o.ev, outcome: o.outcome, rm: o.rm, league: o.league }), side: o.side, score_at_call: o.score || { home: 0, away: 0 } });
const withRow = (cap, row) => { cap.incidents.unshift(row); return cap; };
const CAP = {
  201: withRow(lab.capture(lab.timeline([['home', 20], ['away', 55]])), ftRow(1, 1)),          // full time: home 20' (1-0), away 55' (1-1)
  202: withRow(lab.capture(lab.timeline([['home', 30]])), liveRow(88)),                         // in play: home 30' (1-0)
  203: { event_id: 0, incidents: [{ type: 'goal', minute: 10, is_home: true }] },                // a goal row with no running score
};
const worldCalls = () => [
  gcall({ id: 9, ev: 201, side: 'home', outcome: 'hit', rm: null }),                               // not gradeable: no resolved minute
  gcall({ id: 8, ev: 299, side: 'home', outcome: 'hit', rm: 20 }),                                 // not gradeable: no capture in R2
  gcall({ id: 7, ev: 201, side: 'home', outcome: 'nogoal', rm: null }),                            // not gradeable: no goal followed
  gcall({ id: 6, ev: 201, side: 'home', outcome: 'open', rm: null }),                              // not gradeable: still open
  gcall({ id: 5, ev: 203, side: 'home', outcome: 'hit', rm: 10 }),                                 // E: population; the capture has a goal row with no score
  gcall({ id: 4, ev: 202, side: 'away', outcome: 'miss', rm: 30, league: 2 }),                     // D: FIELD home, called away: miss; agree
  gcall({ id: 3, ev: 201, side: 'away', outcome: 'hit', rm: 70, score: { home: 1, away: 1 } }),    // C: full time, no third goal: not applicable
  gcall({ id: 2, ev: 201, side: 'home', outcome: 'hit', rm: 55, score: { home: 1, away: 0 } }),    // B: the away goal: FIELD miss, ledger hit: disagree
  gcall({ id: 1, ev: 201, side: 'home', outcome: 'hit', rm: 20 }),                                 // A: the home goal: hit; agree
];
const worldKeys = () => [key('epl', 201), key('mls', 202, 'incidents.json'), key('epl', 203)];
const worldReads = () => new Map([['201', { status: 200, json: CAP[201] }], ['202', { status: 200, json: CAP[202] }], ['203', { status: 200, json: CAP[203] }]]);

// ---- the stub vendor and the stub relay (the census run-check's, narrowed to what the grade needs)
function bsdStub({ rows = worldCalls(), fail = null } = {}) {
  const route = (u) => {
    if (fail) { const f = fail(u); if (f) return f; }
    if (u.pathname !== '/api/v2/next-goal/calls/') return [404, { detail: 'nf' }];
    const limit = Number(u.searchParams.get('limit')), offset = Number(u.searchParams.get('offset'));
    return [200, { count: rows.length, next: null, previous: null, results: rows.slice(offset, offset + limit) }];
  };
  return { route };
}
function relayStub({ keys = worldKeys(), reads = worldReads() } = {}) {
  const route = (u) => {
    if (u.pathname === '/bsd/r2/list') return [200, listPage(keys, {})];
    if (u.pathname === '/bsd/r2/read') {
      const k = String(u.searchParams.get('key'));
      const m = k.match(/^bsd\/[^/]+\/(\d+)\/incidents\.json$/);
      const r = m && reads.get(m[1]);
      return r ? [200, r.json] : [404, { error: 'not found' }];
    }
    return [404, { error: 'Unknown route' }];
  };
  return { route };
}
async function serve(route, log) {
  const server = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://stub');
    log.push({ key: u.pathname + u.search, auth: req.headers.authorization ?? null });
    const [status, body] = route(u);
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(typeof body === 'string' ? body : JSON.stringify(body));
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { server, base: `http://127.0.0.1:${server.address().port}` };
}

async function runGrade({ bsd = bsdStub(), relay = relayStub(), token = TOKEN, core = CORE, labSha = 'abc1234', readCap = '' } = {}) {
  const bsdLog = [], relayLog = [];
  const b = await serve(bsd.route, bsdLog), r = await serve(relay.route, relayLog);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ngg-run-'));
  fs.mkdirSync(path.join(dir, 'src'));
  fs.writeFileSync(path.join(dir, 'src', 'index.js'), 'x = { bsdLeagueId: 1 }; y = { bsdLeagueId: 2 };');
  const env = { ...process.env, BSD_BASE: b.base, RELAY_URL: r.base, READ_CAP: readCap, CALL_BUDGET: '', RUN_DEADLINE_SECONDS: '' };
  if (token === null) delete env.BSD_API_TOKEN; else env.BSD_API_TOKEN = token;
  if (core === null) delete env.LAB_CORE; else env.LAB_CORE = core;
  if (labSha === null) delete env.LAB_SHA; else env.LAB_SHA = labSha;
  const child = spawn(process.execPath, [SOURCE], { cwd: dir, env });
  let stdout = '', stderr = '';
  child.stdout.on('data', (d) => { stdout += d; });
  child.stderr.on('data', (d) => { stderr += d; });
  const code = await new Promise((res) => child.on('close', res));
  await new Promise((res) => b.server.close(res)); await new Promise((res) => r.server.close(res));
  const out = path.join(dir, 'outbox');
  const files = fs.existsSync(out) ? fs.readdirSync(out) : [];
  const read = (f) => JSON.parse(fs.readFileSync(path.join(out, f), 'utf8'));
  const stamped = files.filter((f) => /^bsd-next-goal-grade-2.*\.json$/.test(f));
  const result = { code, stdout, stderr, bsdLog, relayLog, files, stamped, stampedFirst: stamped.length ? read(stamped[0]) : null,
    latest: files.includes('bsd-next-goal-grade-latest.json') ? read('bsd-next-goal-grade-latest.json') : null,
    raw: files.map((f) => fs.readFileSync(path.join(out, f), 'utf8')).join('\n') };
  fs.rmSync(dir, { recursive: true, force: true });
  return result;
}
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ngg-cores-'));
const writeCore = (name, text) => { const f = path.join(tmpDir, name); fs.writeFileSync(f, text); return f; };
const realUrl = JSON.stringify(pathToFileURL(CORE).href);
const reads = (log) => log.filter((x) => x.key.startsWith('/bsd/r2/read')).map((x) => decodeURIComponent(x.key.split('key=')[1])).sort();
const nothingSpent = (r) => [r.bsdLog.length, r.relayLog.length];

await scenario('1 a whole run: the population the census calls gradeable is graded, once, and the artifact says what made it', async () => {
  const r = await runGrade();
  eq('exit 0', r.code, 0);
  eq('three BSD requests (a count, one page, a closing count), each with the token', [r.bsdLog.map((x) => x.key), r.bsdLog.every((x) => x.auth === `Token ${TOKEN}`)], [['/api/v2/next-goal/calls/?limit=1', '/api/v2/next-goal/calls/?limit=200&offset=0', '/api/v2/next-goal/calls/?limit=1'], true]);
  eq('incidents.json was read for the three ledger events that have one, and for no other', reads(r.relayLog), ['bsd/epl/201/incidents.json', 'bsd/epl/203/incidents.json', 'bsd/mls/202/incidents.json']);
  eq('relay requests carry no token', r.relayLog.every((x) => x.auth === null), true);
  eq('one stamped artifact and a latest, and they are the same', [r.stamped.length, r.latest !== null, stable(r.latest) === stable(r.stampedFirst)], [1, true, true]);
  const g = r.latest.grade;
  eq('five gradeable, three graded: two agree, one disagrees; two not applicable', [g.population, g.graded, g.agree, g.disagree, g.notApplicable.total], [5, 3, 2, 1, 2]);
  eq('the two reasons: no third goal at full time, and a goal row with no running score', g.notApplicable.byReason, { [realCore.REASONS.none]: 1, [realCore.REASONS.noScore]: 1 });
  eq('the confusion matrix', g.confusion, { 'ledger hit, FIELD hit': 1, 'ledger hit, FIELD miss': 1, 'ledger miss, FIELD miss': 1 });
  eq('by slug, from the R2 directory', g.byTag.slug, { epl: { graded: 2, agree: 1, disagree: 1, notApplicable: 2 }, mls: { graded: 1, agree: 1, disagree: 0, notApplicable: 0 } });
  eq('by capture state, from the census', g.byTag.state, { 'full-time': { graded: 2, agree: 1, disagree: 1, notApplicable: 1 }, 'in-play': { graded: 1, agree: 1, disagree: 0, notApplicable: 0 }, unmarked: { graded: 0, agree: 0, disagree: 0, notApplicable: 1 } });
  eq('the census block agrees with the grade population', [r.latest.census.verdict, r.latest.census.gradeable, r.latest.census.uniqueCalls, r.latest.census.partialBecause], ['ANSWERED', 5, 9, []]);
  eq('and carries the funnel: nine calls in tracked leagues, eight with a capture, three covered by full time and two by a goal', [r.latest.census.inTrackedLeague, r.latest.census.withIncidentsKey, r.latest.census.gradeableBy], [9, 8, { 'full time': 3, 'a goal within 1 minute': 2 }]);
  eq('the log names this run and prints the result line', [r.stdout.includes('=== bsd-next-goal-grade  base='), /graded 3 of 5 \| agree 2 \| disagree 1 \| not applicable 2/.test(r.stdout)], [true, true]);
  const sha = crypto.createHash('sha256').update(fs.readFileSync(CORE)).digest('hex');
  eq('the artifact names the code that made it: path, sha256, laboratory commit, rule version', [r.latest.core.path === CORE, r.latest.core.sha256 === sha, r.latest.core.labSha, r.latest.core.ruleVersion], [true, true, 'abc1234', realCore.RULE_VERSION]);
  eq('reached, with no reason it did not', [r.latest.reachedTarget, r.latest.notReachedBecause, r.latest.analysisError, r.latest.stopped, r.latest.tokenPresent], [true, null, null, null, true]);
  eq('the coverage line carries every denominator, in the artifact and in the log', [r.latest.coverageLine, r.stdout.includes(r.latest.coverageLine), r.stdout.includes('=== COVERAGE ===')], [`graded 3 of 5 gradeable calls (census: 5 gradeable of 9) | agree 2, disagree 1, not applicable 2 | rule ${realCore.RULE_VERSION}`, true, true]);
  eq('the census line is kept beside it', r.latest.censusCoverageLine.includes('calls: 5 gradeable of 9'), true);
  eq('the artifact holds counts: no event id, team, player or ledger row, and never the token', [/Alpha|Beta|"player"|"team"|event_date|score_at_call|"201"|"event_id"|"id":/.test(r.raw), r.raw.includes(TOKEN), r.stdout.includes(TOKEN), r.stderr.includes(TOKEN)], [false, false, false, false]);
  eq('the BSD log has no response bodies', r.latest.bsdLog.every((c) => !('json' in c)), true);
});

await scenario('2 no module named: nothing is spent', async () => {
  const r = await runGrade({ core: null });
  eq('exit 1, no request to either stub, no artifact, and it says why', [r.code, nothingSpent(r), r.files, /LAB_CORE is not set/.test(r.stderr)], [1, [0, 0], [], true]);
  const e = await runGrade({ core: '' });
  eq('an empty name is no name', [e.code, nothingSpent(e), /LAB_CORE is not set/.test(e.stderr)], [1, [0, 0], true]);
});

await scenario('3 a module that is not there: nothing is spent', async () => {
  const r = await runGrade({ core: path.join(tmpDir, 'absent.mjs') });
  eq('exit 1, no request, no artifact, and it says the laboratory was not checked out there', [r.code, nothingSpent(r), r.files, /does not exist: the laboratory was not checked out there/.test(r.stderr)], [1, [0, 0], [], true]);
});

await scenario('4 a module with the wrong shape: nothing is spent', async () => {
  const noGrade = await runGrade({ core: writeCore('no-grade.mjs', "export const RULE_VERSION = 'x'\nexport const coverageLine = () => ''\n") });
  eq('no gradeCalls', [noGrade.code, nothingSpent(noGrade), /does not export gradeCalls\(\)/.test(noGrade.stderr)], [1, [0, 0], true]);
  const noLine = await runGrade({ core: writeCore('no-line.mjs', "export const RULE_VERSION = 'x'\nexport const gradeCalls = () => ({})\n") });
  eq('no coverageLine', [noLine.code, nothingSpent(noLine), /does not export coverageLine\(\)/.test(noLine.stderr)], [1, [0, 0], true]);
  const noVersion = await runGrade({ core: writeCore('no-version.mjs', 'export const gradeCalls = () => ({})\nexport const coverageLine = () => \'\'\n') });
  eq('no RULE_VERSION', [noVersion.code, nothingSpent(noVersion), /does not export RULE_VERSION/.test(noVersion.stderr)], [1, [0, 0], true]);
  const broken = await runGrade({ core: writeCore('syntax.mjs', 'export const = \n') });
  eq('a module that does not parse', [broken.code, nothingSpent(broken)], [1, [0, 0]]);
});

await scenario('5 a census that left something out grades nothing and does not advance latest', async () => {
  const r = await runGrade({ readCap: '2' });
  eq('exit 0 and one stamped artifact, no latest', [r.code, r.stamped.length, r.latest], [0, 1, null]);
  const a = r.stampedFirst;
  eq('not reached, grade null, and the reason names the census and the cap', [a.reachedTarget, a.grade, /the census is PARTIAL: the read cap was reached/.test(a.notReachedBecause)], [false, null, true]);
  eq('the line says it did not grade', a.coverageLine.startsWith('not graded: the census is PARTIAL'), true);
  eq('the call log is kept', a.bsdLog.length, 3);
});

await scenario('6 no token: no vendor request, no grade', async () => {
  const r = await runGrade({ token: null });
  eq('exit 0, no BSD request, an artifact that says the token was absent, no latest', [r.code, r.bsdLog.length, r.stampedFirst.tokenPresent, r.latest], [0, 0, false, null]);
  eq('grade null and not reached', [r.stampedFirst.grade, r.stampedFirst.reachedTarget], [null, false]);
});

await scenario('7 a module that throws: the evidence of the spend is kept, the result is not trusted', async () => {
  const r = await runGrade({ core: writeCore('throws.mjs', "export const RULE_VERSION = 't'\nexport const coverageLine = () => ''\nexport const gradeCalls = () => { throw new Error('boom') }\n") });
  eq('exit 0, a stamped artifact, no latest', [r.code, r.stamped.length, r.latest], [0, 1, null]);
  const a = r.stampedFirst;
  eq('the error is recorded and the call log kept', [/boom/.test(a.analysisError), a.reachedTarget, a.bsdLog.length, a.notReachedBecause], [true, false, 3, 'the analysis threw']);
  eq('the log says so', /ANALYSIS_ERROR/.test(r.stdout), true);
});

await scenario('8 a module that drops a call, or counts one twice, cannot advance latest', async () => {
  const drops = await runGrade({ core: writeCore('drops.mjs', `import * as real from ${realUrl}\nexport const RULE_VERSION = real.RULE_VERSION\nexport const coverageLine = real.coverageLine\nexport const gradeCalls = (items) => real.gradeCalls(items.slice(1))\n`) });
  eq('a population of 4 against the census\'s 5', [drops.latest, drops.stampedFirst.reachedTarget, drops.stampedFirst.notReachedBecause], [null, false, "the core's population 4 is not the census's gradeable count 5"]);
  const twice = await runGrade({ core: writeCore('twice.mjs', `import * as real from ${realUrl}\nexport const RULE_VERSION = real.RULE_VERSION\nexport const coverageLine = real.coverageLine\nexport const gradeCalls = (items) => { const g = real.gradeCalls(items); g.graded += 1; return g }\n`) });
  eq('a call placed twice', [twice.latest, twice.stampedFirst.reachedTarget, twice.stampedFirst.notReachedBecause], [null, false, 'the core did not place every call exactly once']);
  const agree = await runGrade({ core: writeCore('agree.mjs', `import * as real from ${realUrl}\nexport const RULE_VERSION = real.RULE_VERSION\nexport const coverageLine = real.coverageLine\nexport const gradeCalls = (items) => { const g = real.gradeCalls(items); g.agree += 1; return g }\n`) });
  eq('agree and disagree that do not sum to graded', [agree.latest, agree.stampedFirst.reachedTarget], [null, false]);
  eq('each still leaves a stamped artifact', [drops.stamped.length, twice.stamped.length, agree.stamped.length], [1, 1, 1]);
});

await scenario('9 the vendor throttles: the run stops and grades nothing', async () => {
  const r = await runGrade({ bsd: bsdStub({ fail: (u) => (u.searchParams.get('limit') === '200' ? [429, { detail: 'slow' }] : null) }) });
  eq('stopped on 429, not reached, no latest, no grade', [r.stampedFirst.stopped, r.stampedFirst.reachedTarget, r.latest, r.stampedFirst.grade], ['429', false, null, null]);
  eq('no request after the 429: a count and the one page', r.bsdLog.length, 2);
});

await scenario('10 a token that reaches the artifact stops the write', async () => {
  const r = await runGrade({ core: writeCore('leaks.mjs', `import * as real from ${realUrl}\nexport const RULE_VERSION = real.RULE_VERSION\nexport const gradeCalls = real.gradeCalls\nexport const coverageLine = () => process.env.BSD_API_TOKEN\n`) });
  eq('exit 1 and nothing written', [r.code, r.files], [1, []]);
  eq('the refusal does not print the token', [r.stdout.includes(TOKEN), r.stderr.includes(TOKEN)], [false, false]);
});

await scenario('11 populationOf selects exactly the census\'s gradeable calls', () => {
  const ft = lab.capture(lab.timeline([['home', 20]])); ft.incidents.unshift(ftRow(1, 0));
  const live = lab.capture(lab.timeline([['home', 20]])); live.incidents.unshift(liveRow(88));
  const ok = (id, ev, extra = {}) => ({ ...gcall({ id, ev, side: 'home', outcome: 'hit', rm: 20 }), ...extra });
  const rd = (json, status = 200) => ({ status, json });
  const reads = new Map([['1', rd(ft)], ['2', rd(live)], ['3', rd(live)], ['4', rd(undefined)], ['5', rd(ft, 404)], ['6', rd({ incidents: 5 })], ['7', rd(live)], ['8', rd(ft)]]);
  const slugOf = new Map([['1', 'epl'], ['2', 'mls'], ['3', 'epl'], ['7', 'epl'], ['8', 'epl']]);
  const items = populationOf({ rows: [
    ok(1, 1), // full time: in
    ok(2, 2), // in play, a goal at 20 and rm 20: in
    ok(3, 3, { resolved_minute: 50 }), // in play, no goal near 50: out (the capture does not cover it)
    ok(4, 4), // read with no body: out
    ok(5, 5), // read answered 404: out
    ok(6, 6), // not parseable: out
    ok(7, 7, { outcome: 'open' }), // not hit or miss: out
    ok(8, 8, { resolved_minute: null }), // no resolved minute: out
    ok(9, 9), // never read: out
    { ...ok(10, 1), event: {} }, // no event id: out
    null, // not a row: out
    ok(11, 1, { resolved_minute: '20' }), // a resolved minute that is text: out
    ok(12, 1, { outcome: 'nogoal' }), // out
  ], reads, slugOf });
  eq('two calls are in', items.map((i) => i.call.id), [1, 2]);
  eq('each carries its slug and capture state, its capture, and an opaque key', items.map((i) => [i.tags, i.key, i.capture === (i.key === '1' ? ft : live)]), [[{ slug: 'epl', state: 'full-time' }, '1', true], [{ slug: 'mls', state: 'in-play' }, '2', true]]);
  eq('rows and reads that are not there give no items and no throw', [populationOf({ rows: [], reads: new Map(), slugOf: new Map() }).length, populationOf({ rows: [ok(1, 1)], reads: new Map(), slugOf: new Map() }).length], [0, 0]);
});

await scenario('12 importing the runner does not run it', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ngg-import-'));
  const child = spawn(process.execPath, ['--input-type=module', '-e', `await import(${JSON.stringify(pathToFileURL(SOURCE).href)})`], { cwd: dir, env: { ...process.env, LAB_CORE: CORE, BSD_API_TOKEN: TOKEN } });
  let out = '';
  child.stdout.on('data', (d) => { out += d; }); child.stderr.on('data', (d) => { out += d; });
  const code = await new Promise((res) => child.on('close', res));
  eq('exit 0, no output, no outbox', [code, out, fs.existsSync(path.join(dir, 'outbox'))], [0, '', false]);
  fs.rmSync(dir, { recursive: true, force: true });
});

await scenario('13 the laboratory commit is recorded when there is one, and as null when there is not', async () => {
  const none = await runGrade({ labSha: null });
  const empty = await runGrade({ labSha: '' });
  eq('unset and empty are both null, and neither stops the run', [none.latest.core.labSha, empty.latest.core.labSha, none.latest.reachedTarget, empty.latest.reachedTarget], [null, null, true, true]);
});

await scenario('14 an analysis that throws still leaves the call log (a capture of 200,000 goals overflows the spread in goalDistance)', async () => {
  // If this stops throwing because the census gained a loop, find another way to make analyseCensus throw: the try/catch in the
  // runner needs a test, since a throw there would erase every request the run made.
  const huge = `{"incidents":[${'{"type":"goal","minute":1},'.repeat(200000)}{"type":"goal","minute":2}]}`;
  const reads = worldReads(); reads.set('201', { status: 200, json: huge });
  const r = await runGrade({ relay: relayStub({ reads }) });
  eq('exit 0, a stamped artifact, no latest', [r.code, r.stamped.length, r.latest], [0, 1, null]);
  const a = r.stampedFirst;
  eq('the error is recorded, the log kept, the line says it did not grade', [typeof a.analysisError, a.bsdLog.length, a.coverageLine, a.notReachedBecause, a.grade, a.reachedTarget], ['string', 3, 'not graded: the analysis threw', 'the analysis threw', null, false]);
  eq('the census block is empty rather than invented', a.census.verdict, undefined);
});

await scenario('15 the source declares what a live run depends on', () => {
  const text = fs.readFileSync(SOURCE, 'utf8');
  eq('it reuses the census\'s collect, and loads the core before collecting', [/import \{ collect, analyseCensus, captureOf, covers \} from '\.\/bsd-next-goal-census\.mjs'/.test(text), text.indexOf('await loadCore(CORE_PATH)') > 0 && text.indexOf('await loadCore(CORE_PATH)') < text.indexOf("await collect('bsd-next-goal-grade')")], [true, true]);
  eq('the main guard, and no copy of the paging or the budget', [text.includes('if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {'), /offset=\$\{|CALL_BUDGET|count_first/.test(text)], [true, false]);
});

fs.rmSync(tmpDir, { recursive: true, force: true });
if (scenarios < MIN_SCENARIOS) { console.log(`FAIL  only ${scenarios} scenarios ran; MIN_SCENARIOS is ${MIN_SCENARIOS}`); failed++; }
if (assertions < MIN_ASSERTIONS) { console.log(`FAIL  only ${assertions} assertions ran; MIN_ASSERTIONS is ${MIN_ASSERTIONS}`); failed++; }
console.log(`\nscenarios ${scenarios}, assertions ${assertions}, failed ${failed}   (source: ${path.relative(process.cwd(), SOURCE)}, lab: ${LAB})`);
finished = true;
process.exit(failed === 0 ? 0 : 1);
