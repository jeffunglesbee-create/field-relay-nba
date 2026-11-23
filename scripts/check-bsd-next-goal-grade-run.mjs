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

export const MIN_SCENARIOS = 20;
export const MIN_ASSERTIONS = 96;

const argv = process.argv.slice(2);
const FAIL_FAST = argv.includes('--fail-fast');   // stop at the first failing assertion: the mutation harness needs red or green, not the whole list
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
  if (stable(got) !== stable(want)) {
    failed++; console.log(`FAIL  ${label}\n        got  ${stable(got)}\n        want ${stable(want)}`);
    if (FAIL_FAST) { finished = true; process.exit(1); }
  }
};
const scenario = async (name, fn) => { scenarios++; try { await fn(); } catch (e) { failed++; console.log(`FAIL  ${name} threw: ${e.stack || e.message}`); } };

if (!fs.existsSync(CORE)) { console.log(`FAIL  no laboratory checkout at ${LAB} (looked for scripts/bsd-next-goal-grade-core.mjs); pass --lab DIR`); process.exit(1); }
const lab = await import(pathToFileURL(path.join(LAB, 'scripts/fixtures/bsd-next-goal-grade-synthetic.mjs')).href);
const realCore = await import(pathToFileURL(CORE).href);
const { call, key, listPage, ftRow, liveRow } = await import(pathToFileURL(path.resolve('scripts/fixtures/bsd-next-goal-census-synthetic.mjs')).href);
const { populationOf, validGrade, NOTE } = await import(pathToFileURL(SOURCE).href);
const { analyseCensus } = await import(pathToFileURL(path.resolve('scripts/bsd-next-goal-census.mjs')).href);

// ---- the world: nine ledger calls on four matches, built so every disposition happens once
const gcall = (o) => ({ ...call({ id: o.id, ev: o.ev, outcome: o.outcome, rm: o.rm, league: o.league }), side: o.side, score_at_call: o.score || { home: 0, away: 0 } });
const withRow = (cap, row) => { cap.incidents.unshift(row); return cap; };
const CAP = {
  201: withRow(lab.capture(lab.timeline([['home', 20], ['away', 55]]), { eventId: 201 }), ftRow(1, 1)),   // full time: home 20' (1-0), away 55' (1-1)
  202: withRow(lab.capture(lab.timeline([['home', 30]]), { eventId: 202 }), liveRow(88)),                  // in play: home 30' (1-0)
  203: { event_id: 203, incidents: [{ type: 'goal', minute: 10, is_home: true }] },                         // a goal row with no running score
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
function relayStub({ keys = worldKeys(), reads = worldReads(), failList = false, slowList = 0 } = {}) {
  const route = (u) => {
    if (u.pathname === '/bsd/r2/list') return failList ? [500, { error: 'boom' }] : slowList ? [200, listPage(keys, {}), {}, slowList] : [200, listPage(keys, {})];
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
    const out = route(u);
    const send = () => { res.writeHead(out[0], { 'content-type': 'application/json' }); res.end(typeof out[1] === 'string' ? out[1] : JSON.stringify(out[1])); };
    if (out[3]) setTimeout(send, out[3]); else send();
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { server, base: `http://127.0.0.1:${server.address().port}` };
}

async function runGrade({ bsd = bsdStub(), relay = relayStub(), token = TOKEN, core = CORE, labSha = 'abc1234', readCap = '', deadline = '', actions = false, labCopy = false } = {}) {
  const bsdLog = [], relayLog = [];
  const b = await serve(bsd.route, bsdLog), r = await serve(relay.route, relayLog);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ngg-run-'));
  fs.mkdirSync(path.join(dir, 'src'));
  fs.writeFileSync(path.join(dir, 'src', 'index.js'), 'x = { bsdLeagueId: 1 }; y = { bsdLeagueId: 2 };');
  const env = { ...process.env, BSD_BASE: b.base, RELAY_URL: r.base, READ_CAP: readCap, CALL_BUDGET: '', RUN_DEADLINE_SECONDS: deadline, FETCH_TIMEOUT_SECONDS: '' };
  if (actions) env.GITHUB_ACTIONS = 'true'; else delete env.GITHUB_ACTIONS;
  if (labCopy) { fs.mkdirSync(path.join(dir, 'lab/scripts'), { recursive: true }); fs.copyFileSync(CORE, path.join(dir, 'lab/scripts/bsd-next-goal-grade-core.mjs')); core = 'lab/scripts/bsd-next-goal-grade-core.mjs'; }
  if (token === null) delete env.BSD_API_TOKEN; else env.BSD_API_TOKEN = token;
  if (core === null) delete env.LAB_CORE; else env.LAB_CORE = core;
  if (labSha === null) delete env.LAB_SHA; else env.LAB_SHA = labSha;
  const child = spawn(process.execPath, [SOURCE], { cwd: dir, env });
  let stdout = '', stderr = '';
  child.stdout.on('data', (d) => { stdout += d; });
  child.stderr.on('data', (d) => { stderr += d; });
  const code = await new Promise((res) => child.on('close', res));
  b.server.closeAllConnections(); r.server.closeAllConnections();
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
  eq('by the three tags the runner adds: no VAR rows, the capture\'s own event_id is the ledger\'s, no extra time (the same three, five calls)', [g.byTag.var, g.byTag.eventId, g.byTag.extraTime], [{ 'no var rows': { graded: 3, agree: 2, disagree: 1, notApplicable: 2 } }, { matches: { graded: 3, agree: 2, disagree: 1, notApplicable: 2 } }, { no: { graded: 3, agree: 2, disagree: 1, notApplicable: 2 } }]);
  eq('the two not-applicable reasons by slug', g.notApplicable.byTagAndReason.slug, { epl: { [realCore.REASONS.none]: 1, [realCore.REASONS.noScore]: 1 } });
  eq('agree and disagree by distance: all three resolve on a goal at the ledger\'s minute', g.resolvedMinuteDistance, { 0: { graded: 3, agree: 2, disagree: 1 } });
  eq('three distinct goals, one with a disagreeing call', g.distinctGoals, { graded: 3, withADisagreeingCall: 1 });
  eq('premises: three captures, one with a goal row lacking a score, one call on it; every totals sequence is 1..n; every call has a minute', [g.premises.distinctCaptures, g.premises.distinctCapturesWithAGoalRowLackingAScore, g.premises.callsOnCapturesWithAGoalRowLackingAScore, g.premises.distinctCapturesWhoseTotalsAreNotOneToN, g.premises.callsWithoutAMinute], [3, 1, 1, 0, 0]);
  eq('the full-time score against the last goal: the full-time capture matches, the live one has no full-time row, the broken one is not evaluated', g.premises.fullTimeScoreVersusLastGoal, { calls: { matches: 3, 'no full-time score': 1, 'not evaluated': 1 }, distinctCaptures: { matches: 1, 'no full-time score': 1, 'not evaluated': 1 } });
  eq('the artifact carries the same-source caveat and the census reasons for the calls it did not grade', [r.latest.note === NOTE, /same feed|one feed/.test(r.latest.note), r.latest.census.notGradeableBecause], [true, true, { 'no resolved_minute': 1, 'no incidents.json in R2 for the event': 1, 'outcome is nogoal': 1, 'outcome is open': 1 }]);
  eq('the artifact records its own spend: three BSD requests of a cap of 16, three reads of a cap of 1500', [r.latest.bsdCallsMade, r.latest.callBudget, r.latest.readsMade, r.latest.readCap], [3, 16, 3, 1500]);
  eq('the census block agrees with the grade population', [r.latest.census.verdict, r.latest.census.gradeable, r.latest.census.uniqueCalls, r.latest.census.partialBecause], ['ANSWERED', 5, 9, []]);
  eq('and carries the funnel: nine calls in tracked leagues, eight with a capture, three covered by full time and two by a goal', [r.latest.census.inTrackedLeague, r.latest.census.withIncidentsKey, r.latest.census.gradeableBy], [9, 8, { 'full time': 3, 'a goal within 1 minute': 2 }]);
  eq('the log names this run and prints the result line', [r.stdout.includes('=== bsd-next-goal-grade  base='), /graded 3 of 5 \| agree 2 \| disagree 1 \| not applicable 2/.test(r.stdout)], [true, true]);
  const sha = crypto.createHash('sha256').update(fs.readFileSync(CORE)).digest('hex');
  eq('the artifact names the code that made it: path, sha256, laboratory commit, rule version', [r.latest.core.path === CORE, r.latest.core.sha256 === sha, r.latest.core.labSha, r.latest.core.ruleVersion], [true, true, 'abc1234', realCore.RULE_VERSION]);
  eq('reached, with no reason it did not', [r.latest.reachedTarget, r.latest.notReachedBecause, r.latest.analysisError, r.latest.stopped, r.latest.tokenPresent], [true, null, null, null, true]);
  eq('the coverage line carries every denominator, in the artifact and in the log', [r.latest.coverageLine, r.stdout.includes(r.latest.coverageLine), r.stdout.includes('=== COVERAGE ===')], [`graded 3 of 5 gradeable calls (census: 5 gradeable of 9) | agree 2, disagree 1, not applicable 2 | resolving goal at the ledger's resolved_minute for 3 of 3 graded | rule ${realCore.RULE_VERSION}`, true, true]);
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
  const notFn = await runGrade({ core: writeCore('not-fn.mjs', "export const RULE_VERSION = 'x'\nexport const coverageLine = () => ''\nexport const gradeCalls = 5\n") });
  eq('gradeCalls that is not a function', [notFn.code, nothingSpent(notFn), /does not export gradeCalls\(\)/.test(notFn.stderr)], [1, [0, 0], true]);
  const lineNotFn = await runGrade({ core: writeCore('line-not-fn.mjs', "export const RULE_VERSION = 'x'\nexport const coverageLine = 'text'\nexport const gradeCalls = () => ({})\n") });
  eq('coverageLine that is not a function', [lineNotFn.code, nothingSpent(lineNotFn), /does not export coverageLine\(\)/.test(lineNotFn.stderr)], [1, [0, 0], true]);
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
  const viaError = await runGrade({ core: writeCore('leaks-error.mjs', `import * as real from ${realUrl}\nexport const RULE_VERSION = real.RULE_VERSION\nexport const coverageLine = real.coverageLine\nexport const gradeCalls = () => { throw new Error('boom ' + process.env.BSD_API_TOKEN) }\n`) });
  eq('a core that throws with the token in its message: nothing written, and the token is in neither stream', [viaError.code, viaError.files, viaError.stdout.includes(TOKEN), viaError.stderr.includes(TOKEN)], [1, [], false, false]);
  const atImport = await runGrade({ core: writeCore('throws-at-import.mjs', "export const RULE_VERSION = 'x'\nexport const coverageLine = () => ''\nexport const gradeCalls = () => ({})\nthrow new Error('import boom ' + process.env.BSD_API_TOKEN)\n") });
  eq('a core that throws at import with the token in its message: nothing spent, nothing written, the token redacted from the log', [atImport.code, nothingSpent(atImport), atImport.files, atImport.stdout.includes(TOKEN), atImport.stderr.includes(TOKEN), atImport.stderr.includes('[redacted]')], [1, [0, 0], [], false, false, true]);
  const trimmed = await runGrade({ token: `${TOKEN}\n`, core: writeCore('throws-trimmed.mjs', "export const RULE_VERSION = 'x'\nexport const coverageLine = () => ''\nexport const gradeCalls = () => ({})\nthrow new Error('trimmed boom ' + process.env.BSD_API_TOKEN.trim() + ' end')\n") });
  eq('the same with a token that carries a trailing newline in the environment: the trimmed form is redacted too', [trimmed.code, trimmed.stderr.includes(TOKEN), trimmed.stderr.includes('[redacted]')], [1, false, true]);
  const viaField = await runGrade({ core: writeCore('leaks-field.mjs', `import * as real from ${realUrl}\nexport const RULE_VERSION = real.RULE_VERSION\nexport const coverageLine = real.coverageLine\nexport const gradeCalls = (items) => { const g = real.gradeCalls(items); g.extra = process.env.BSD_API_TOKEN; return g }\n`) });
  eq('a reached run whose grade carries the token in a field: nothing written', [viaField.code, viaField.files, viaField.stdout.includes(TOKEN), viaField.stderr.includes(TOKEN)], [1, [], false, false]);
  const viaVersion = await runGrade({ core: writeCore('leaks-version.mjs', `import * as real from ${realUrl}\nexport const RULE_VERSION = 'v-' + process.env.BSD_API_TOKEN\nexport const coverageLine = real.coverageLine\nexport const gradeCalls = real.gradeCalls\n`) });
  eq('a rule version that is the token, which the artifact records: nothing written', [viaVersion.code, viaVersion.files, viaVersion.stdout.includes(TOKEN), viaVersion.stderr.includes(TOKEN)], [1, [], false, false]);
});

await scenario('11 populationOf selects exactly the census\'s gradeable calls, with the tags the core tallies by', () => {
  const mkFt = (id, goals = [['home', 20]], final = [1, 0]) => { const c = lab.capture(lab.timeline(goals), { eventId: id }); c.incidents.unshift(ftRow(...final)); return c; };
  const mkLive = (id, goals = [['home', 20]]) => { const c = lab.capture(lab.timeline(goals), { eventId: id }); c.incidents.unshift(liveRow(88)); return c; };
  const ft = mkFt(1), live = mkLive(2);
  const rd = (json, status = 200) => ({ status, json });
  const reads = new Map([['1', rd(ft)], ['2', rd(live)], ['3', rd(live)], ['4', rd(undefined)], ['5', rd(ft, 404)], ['6', rd({ incidents: 5 })], ['7', rd(live)], ['8', rd(ft)], ['0', rd(mkFt(0))], ['9', rd(live)]]);
  const slugOf = new Map([['1', 'epl'], ['2', 'mls'], ['3', 'epl'], ['7', 'epl'], ['8', 'epl'], ['0', 'epl'], ['9', 'epl']]);
  const row = (id, ev, extra = {}) => ({ ...gcall({ id, ev, side: 'home', outcome: 'hit', rm: 20 }), ...extra });
  const rows = [
    row(1, 1), // full time: in
    row(2, 2), // in play, a goal at 20 and rm 20: in
    row(3, 3, { resolved_minute: 50 }), // in play, no goal near 50: out (the capture does not cover it)
    row(4, 4), // read with no body: out
    row(5, 5), // read answered 404: out
    row(6, 6), // not parseable: out
    row(7, 7, { outcome: 'open' }), // not hit or miss: out
    row(8, 8, { resolved_minute: null }), // no resolved minute: out
    row(9, 99), // never read: out
    { ...row(10, 1), event: {} }, // no event id: out
    null, // not a row: out
    row(11, 1, { resolved_minute: '20' }), // a resolved minute that is text: out
    row(12, 1, { outcome: 'nogoal' }), // out
    row(13, 1, { resolved_minute: 0 }), // a resolved minute of 0 on a full-time capture: in
    row(14, 1, { resolved_minute: -5 }), // negative, on a full-time capture: in
    row(15, 9, { resolved_minute: 21 }), // in play, the goal one minute away: in (the tolerance is one)
    row(16, 9, { resolved_minute: 22 }), // in play, two away: out
    row(17, 9, { resolved_minute: 19 }), // in play, one before: in
    row(18, 9, { outcome: 'miss' }), // a miss at the goal's minute: in
    row(19, 0), // an event whose id is the number 0: in
    row(20, 1, { event: null }), // an event that is null: out
    row(21, 1, { event: 'x' }), // an event that is text: out
    row(22, 1, { event: 7 }), // an event that is a number: out
  ];
  const items = populationOf({ rows, reads, slugOf });
  eq('the calls that are in', items.map((i) => i.call.id), [1, 2, 13, 14, 15, 17, 18, 19]);
  // the property that matters: the census, asked about each row on its own, says gradeable exactly when populationOf takes it
  const censusSays = (r) => {
    const id = r && r.event && r.event.id !== undefined ? String(r.event.id) : null;
    const keys = id !== null && reads.has(id) ? [key('epl', id)] : [];
    return analyseCensus({ ledger: { rows: [r], duplicates: 0, noId: 0, pages: 1, reportedFirst: 1, reportedLast: 1, complete: true, why: null }, r2: { keys, pages: 1, complete: true, why: null }, reads, ctx: { trackedLeagueIds: null, capped: false } }).calls.gradeable;
  };
  eq('populationOf and the census agree on every one of the twenty-two rows, one at a time', rows.map((r) => populationOf({ rows: [r], reads, slugOf }).length), rows.map((r) => censusSays(r)));
  eq('and together: the census\'s gradeable count is the population\'s size', [analyseCensus({ ledger: { rows, duplicates: 0, noId: 0, pages: 1, reportedFirst: rows.length, reportedLast: rows.length, complete: true, why: null }, r2: { keys: [...reads.keys()].map((id) => key('epl', id)), pages: 1, complete: true, why: null }, reads, ctx: { trackedLeagueIds: null, capped: false } }).calls.gradeable], [items.length]);
  eq('each carries its capture, its slug and capture state, and an opaque key', items.slice(0, 2).map((i) => [i.tags.slug, i.tags.state, i.key, i.capture === (i.key === '1' ? ft : live)]), [['epl', 'full-time', '1', true], ['mls', 'in-play', '2', true]]);
  eq('rows and reads that are not there give no items and no throw', [populationOf({ rows: [], reads: new Map(), slugOf: new Map() }).length, populationOf({ rows: [row(1, 1)], reads: new Map(), slugOf: new Map() }).length], [0, 0]);
  // the tags
  const tagsOf = (json, id = '5') => populationOf({ rows: [row(1, Number(id))], reads: new Map([[id, rd(json)]]), slugOf: new Map([[id, 'epl']]) })[0].tags;
  const base = (extra = {}) => { const c = mkFt(5); return { ...c, ...extra }; };
  eq('event_id: the capture\'s own id equals the ledger\'s, differs, is absent or null', [tagsOf(mkFt(5)).eventId, tagsOf(mkFt(6)).eventId, tagsOf(base({ event_id: undefined })).eventId, tagsOf(base({ event_id: null })).eventId], ['matches', 'differs', 'absent', 'absent']);
  eq('event_id: a text id equal to the number matches', tagsOf(base({ event_id: '5' })).eventId, 'matches');
  const withRowAdded = (r) => { const c = mkFt(5); c.incidents.push(r); return c; };
  eq('VAR: a varDecision row anywhere in the capture, and a row of another type, and a row that is not an object', [tagsOf(withRowAdded({ type: 'varDecision', minute: 51 })).var, tagsOf(withRowAdded({ type: 'card', minute: 51 })).var, tagsOf(withRowAdded(null)).var], ['var rows', 'no var rows', 'no var rows']);
  const withPeriod = (text) => { const c = mkFt(5); c.incidents.push({ type: 'period', text, minute: 105, is_live: text === 'Extra time', home_score: 1, away_score: 0 }); return c; };
  eq('extra time: an Extra time row or an ET row; not Second half, Penalties, or text that only contains the letters', [tagsOf(withPeriod('Extra time')).extraTime, tagsOf(withPeriod('ET')).extraTime, tagsOf(withPeriod('Second half')).extraTime, tagsOf(withPeriod('Penalties')).extraTime, tagsOf(withPeriod('Competition')).extraTime, tagsOf(withPeriod('Set')).extraTime], ['yes', 'yes', 'no', 'no', 'no', 'no']);
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
  const SHA = 'a'.repeat(40);
  const inActions = await runGrade({ labSha: SHA, actions: true });
  eq('under GITHUB_ACTIONS a 40-hex commit is accepted and recorded', [inActions.code, inActions.latest.core.labSha], [0, SHA]);
  const refused = await Promise.all([null, '', 'abc1234', 'A'.repeat(40), 'a'.repeat(39), 'a'.repeat(41), `${'a'.repeat(39)}g`].map((labSha) => runGrade({ labSha, actions: true })));
  eq('under GITHUB_ACTIONS no commit, an empty one, a short one, upper case, 39, 41 and non-hex characters are each refused before anything is spent', refused.map((x) => [x.code, nothingSpent(x), x.files.length, /LAB_SHA must be the full 40-hex/.test(x.stderr)]), Array(7).fill([1, [0, 0], 0, true]));
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

await scenario('16 a census with nothing gradeable is not a result: a grade of zero calls does not advance latest', async () => {
  const r = await runGrade({ bsd: bsdStub({ rows: [gcall({ id: 1, ev: 201, side: 'home', outcome: 'open', rm: null })] }) });
  const a = r.stampedFirst;
  eq('exit 0 and a stamped artifact, no latest, not reached, and the reason says why', [r.code, r.stamped.length, r.latest, a.reachedTarget, a.notReachedBecause], [0, 1, null, false, 'the census found no gradeable calls']);
  eq('the grade of nothing is kept in the artifact, and the census says ANSWERED with none', [a.grade.population, a.census.verdict, a.census.gradeable], [0, 'ANSWERED', 0]);
});

await scenario('17 a core that returns the wrong thing leaves the evidence of the spend and a result that is not reached', async () => {
  const mk = (name, body) => writeCore(name, `import * as real from ${realUrl}\nexport const RULE_VERSION = real.RULE_VERSION\n${body}\n`);
  const cases = [
    ['an empty object', mk('empty.mjs', 'export const coverageLine = real.coverageLine\nexport const gradeCalls = () => ({})'), /the core returned a grade of the wrong shape/],
    ['null', mk('null.mjs', 'export const coverageLine = real.coverageLine\nexport const gradeCalls = () => null'), /the core returned a grade of the wrong shape/],
    ['a grade with a missing count', mk('nocount.mjs', 'export const coverageLine = real.coverageLine\nexport const gradeCalls = (items) => { const g = real.gradeCalls(items); delete g.notApplicable; return g }'), /the core returned a grade of the wrong shape/],
    ['a count that is text', mk('text.mjs', "export const coverageLine = real.coverageLine\nexport const gradeCalls = (items) => { const g = real.gradeCalls(items); g.graded = '3'; return g }"), /the core returned a grade of the wrong shape/],
    ['a coverageLine that throws', mk('lineThrows.mjs', "export const coverageLine = () => { throw new Error('line boom') }\nexport const gradeCalls = real.gradeCalls"), /line boom/],
    ['a coverageLine that is not text', mk('lineNumber.mjs', 'export const coverageLine = () => 7\nexport const gradeCalls = real.gradeCalls'), /the core returned a coverage line that is not text/],
  ];
  const runs = await Promise.all(cases.map(([, core]) => runGrade({ core })));
  for (let i = 0; i < cases.length; i++) {
    const r = runs[i], a = r.stampedFirst;
    eq(`${cases[i][0]}: exit 0, one stamped artifact, no latest, grade null, the log kept, the reason recorded`, [r.code, r.stamped.length, r.latest, a.grade, a.bsdLog.length, a.reachedTarget, cases[i][2].test(a.analysisError), a.notReachedBecause], [0, 1, null, null, 3, false, true, 'the analysis threw']);
  }
  eq('validGrade: a whole grade is valid, and each missing or mistyped part is not', [validGrade(realCore.gradeCalls([])), validGrade(null), validGrade([]), validGrade({}), validGrade({ ...realCore.gradeCalls([]), population: -1 }), validGrade({ ...realCore.gradeCalls([]), graded: 1.5 }), validGrade({ ...realCore.gradeCalls([]), agree: '0' }), validGrade({ ...realCore.gradeCalls([]), disagree: undefined }), validGrade({ ...realCore.gradeCalls([]), notApplicable: null }), validGrade({ ...realCore.gradeCalls([]), notApplicable: { total: 'x' } }), validGrade({ ...realCore.gradeCalls([]), ruleVersion: 2 })], [true, false, false, false, false, false, false, false, false, false, false]);
});

await scenario('18 the workflow\'s own invocation: a relative LAB_CORE, from a working directory that holds lab/', async () => {
  const r = await runGrade({ labCopy: true });
  const sha = crypto.createHash('sha256').update(fs.readFileSync(CORE)).digest('hex');
  eq('exit 0, reached, graded 3 of 5, and the artifact records the relative path and the hash of the file that ran', [r.code, r.latest.reachedTarget, r.latest.grade.graded, r.latest.grade.population, r.latest.core.path, r.latest.core.sha256 === sha], [0, true, 3, 5, 'lab/scripts/bsd-next-goal-grade-core.mjs', true]);
});

await scenario('19 a census that is partial for any reason grades nothing: a failed R2 listing, and reads blocked by the deadline', async () => {
  const [listing, deadline] = await Promise.all([
    runGrade({ relay: relayStub({ failList: true }) }),
    runGrade({ relay: relayStub({ slowList: 1500 }), deadline: '1' }),
  ]);
  eq('a listing that answered 500: grade null, not reached, no latest, and the census names the listing', [listing.stampedFirst.grade, listing.stampedFirst.reachedTarget, listing.latest, /the R2 listing is partial/.test(listing.stampedFirst.notReachedBecause)], [null, false, null, true]);
  eq('reads that the 1 s deadline blocked: grade null, not reached, no latest, and the census names the deadline', [deadline.stampedFirst.grade, deadline.stampedFirst.reachedTarget, deadline.latest, /reads were blocked by the run deadline/.test(deadline.stampedFirst.notReachedBecause)], [null, false, null, true]);
});

await scenario('20 every way a core can fail to account for the census\'s population stops latest, with its own reason', async () => {
  const mk = (name, expr) => writeCore(name, `import * as real from ${realUrl}\nexport const RULE_VERSION = real.RULE_VERSION\nexport const coverageLine = real.coverageLine\nexport const gradeCalls = (items) => { ${expr} }\n`);
  const PLACED = 'the core did not place every call exactly once';
  const cases = [
    ['a population doubled', mk('double.mjs', 'return real.gradeCalls([...items, ...items])'), "the core's population 10 is not the census's gradeable count 5"],
    ['a population halved', mk('half.mjs', 'return real.gradeCalls(items.slice(0, 2))'), "the core's population 2 is not the census's gradeable count 5"],
    ['one graded call too few', mk('graded-1.mjs', 'const g = real.gradeCalls(items); g.graded -= 1; return g'), PLACED],
    ['one not-applicable call too few', mk('na-1.mjs', 'const g = real.gradeCalls(items); g.notApplicable.total -= 1; return g'), PLACED],
    ['one not-applicable call too many', mk('na+1.mjs', 'const g = real.gradeCalls(items); g.notApplicable.total += 1; return g'), PLACED],
    ['one agreeing call too few', mk('agree-1.mjs', 'const g = real.gradeCalls(items); g.agree -= 1; return g'), PLACED],
    ['one disagreeing call too few', mk('disagree-1.mjs', 'const g = real.gradeCalls(items); g.disagree -= 1; return g'), PLACED],
    ['one disagreeing call too many', mk('disagree+1.mjs', 'const g = real.gradeCalls(items); g.disagree += 1; return g'), PLACED],
  ];
  const runs = await Promise.all(cases.map(([, core]) => runGrade({ core })));
  for (let i = 0; i < cases.length; i++) {
    eq(`${cases[i][0]}: no latest, not reached, a stamped artifact that keeps the grade it was given, and the exact reason`, [runs[i].latest, runs[i].stampedFirst.reachedTarget, runs[i].stamped.length, runs[i].stampedFirst.grade !== null, runs[i].stampedFirst.notReachedBecause], [null, false, 1, true, cases[i][2]]);
  }
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
