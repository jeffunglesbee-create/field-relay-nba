#!/usr/bin/env node
// Rule 90 for scripts/check-bsd-next-goal-grade-run.mjs. HALF 1 breaks a temp copy of the REAL scripts/bsd-next-goal-grade.mjs the
// ways the population, the load of the laboratory module, the advance of latest or the artifact can be wrong, and requires the run
// check to go red on each. HALF 2 breaks the run check itself: mutations that must leave it BLIND on a broken runner, and mutations
// that tighten a gate and must turn it red on the real runner.
//
// The same discipline as scripts/mutate-bsd-next-goal-census.mjs: each anchor occurs exactly once and the replacement differs; a
// mutant that does not parse is NOT APPLIED; CAUGHT needs exit 1 and a FAIL line in the check's own output; the baseline runs first;
// the real files are hashed before and after and must not move. The runner imports the probe and the census by relative paths; a
// mutant copy lives in a temp directory, so those specifiers are made absolute.
//
// Left out as EQUIVALENT, each for a stated reason:
//   `!cap.ok ||` in populationOf: covers() is false for a capture that did not parse, so the clause repeats it.
//   `|| rd.json === undefined` in populationOf: captureOf(undefined) does not parse, so the capture is dropped one line later.
//   `if (id === null) continue;`: reads.get(null) is undefined, so the read is dropped one line later.
//   the grading RULE: its mutants are field-laboratory's (scripts/mutate-bsd-next-goal-grade-core.mjs), not this runner's.
//
// Usage: node scripts/mutate-bsd-next-goal-grade.mjs [--lab DIR]   (DIR: a field-laboratory checkout, default lab)

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const argv = process.argv.slice(2);
const labIdx = argv.indexOf('--lab');
const LAB = path.resolve(labIdx >= 0 ? argv[labIdx + 1] : 'lab');
const SRC = 'scripts/bsd-next-goal-grade.mjs';
const RUN_CHECK = 'scripts/check-bsd-next-goal-grade-run.mjs';
const REAL = [SRC, RUN_CHECK];
const PROBE_URL = JSON.stringify(pathToFileURL(path.resolve('scripts/bsd-next-goal-probe.mjs')).href);
const CENSUS_URL = JSON.stringify(pathToFileURL(path.resolve('scripts/bsd-next-goal-census.mjs')).href);
const sha = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
const before = Object.fromEntries(REAL.map((f) => [f, sha(f)]));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mut-ngg-run-'));
const strays = () => (fs.existsSync('outbox') ? fs.readdirSync('outbox').filter((f) => /^bsd-next-goal-grade-/.test(f)) : []);
const strayBefore = new Set(strays());
const absolute = (text) => text.replace("'./bsd-next-goal-probe.mjs'", PROBE_URL).replace("'./bsd-next-goal-census.mjs'", CENSUS_URL);

// [name, anchor, replacement] or [name, [[anchor, replacement], ...]]
const SOURCE_MUTATIONS = [
  // ---- the population
  ['an open call is in the population', "if (r.outcome !== 'hit' && r.outcome !== 'miss') continue;", ''],
  ['only a hit is in the population', "if (r.outcome !== 'hit' && r.outcome !== 'miss') continue;", "if (r.outcome !== 'hit') continue;"],
  ['only a miss is in the population', "if (r.outcome !== 'hit' && r.outcome !== 'miss') continue;", "if (r.outcome !== 'miss') continue;"],
  ['a call with no resolved minute is in', 'if (num(r.resolved_minute) === null) continue;', ''],
  ['a 404 read is in', 'if (!rd || rd.status !== 200 || rd.json === undefined) continue;', 'if (!rd || rd.json === undefined) continue;'],
  ['an unread event is in', 'if (!rd || rd.status !== 200 || rd.json === undefined) continue;', 'if (rd && (rd.status !== 200 || rd.json === undefined)) continue;'],
  ['a capture that does not cover is in', 'if (!cap.ok || !covers(r, cap)) continue;', 'if (!cap.ok) continue;'],
  ['every read capture is in', 'if (!cap.ok || !covers(r, cap)) continue;', ''],
  ['the event id is not text', 'String(r.event.id) : null;', 'r.event.id : null;'],
  ['a row that is not an object is read', 'const id = isObj(r) && isObj(r.event) &&', 'const id = isObj(r.event) &&'],
  ['an event that is not an object is read', 'isObj(r) && isObj(r.event) &&', 'isObj(r) &&'],
  ['the slug is not carried', 'tags: { slug: slugOf.get(id), state: cap.state } });', 'tags: { state: cap.state } });'],
  ['the state is not carried', 'tags: { slug: slugOf.get(id), state: cap.state } });', 'tags: { slug: slugOf.get(id) } });'],
  ['the slug is the state', 'tags: { slug: slugOf.get(id), state: cap.state } });', 'tags: { slug: cap.state, state: slugOf.get(id) } });'],
  ['every capture shares a key', 'key: id, tags', "key: 'k', tags"],
  ['the capture handed over is the parse', 'capture: rd.json, key: id', 'capture: cap, key: id'],
  ['the call handed over is empty', 'items.push({ call: r, capture', 'items.push({ call: {}, capture'],
  // ---- loading the laboratory module before anything is spent
  ['a missing module is imported anyway', "if (!fs.existsSync(file)) throw new Error(`LAB_CORE ${corePath} does not exist: the laboratory was not checked out there`);", ''],
  ['gradeCalls is not required', "for (const name of ['gradeCalls', 'coverageLine'])", "for (const name of ['coverageLine'])"],
  ['coverageLine is not required', "for (const name of ['gradeCalls', 'coverageLine'])", "for (const name of ['gradeCalls'])"],
  ['RULE_VERSION is not required', "if (typeof core.RULE_VERSION !== 'string') throw new Error('LAB_CORE does not export RULE_VERSION');", ''],
  ['the hash is of something else', "crypto.createHash('sha256').update(text).digest('hex')", "crypto.createHash('sha256').update('x').digest('hex')"],
  ['no LAB_CORE is a path', "if (typeof CORE_PATH !== 'string' || CORE_PATH === '') {", 'if (false) {'],
  ['an empty LAB_CORE is a path', "if (typeof CORE_PATH !== 'string' || CORE_PATH === '') {", "if (typeof CORE_PATH !== 'string') {"],
  ['the module is loaded after the spend', [['const { core, sha256 } = await loadCore(CORE_PATH);   // before anything is spent', 'let core, sha256;'], ["const { out, ledger, r2, reads, ctx, log, slugOf, TOKEN, TS, bsdCalls, stopped } = c;", "const loaded = await loadCore(CORE_PATH); core = loaded.core; sha256 = loaded.sha256;\n  const { out, ledger, r2, reads, ctx, log, slugOf, TOKEN, TS, bsdCalls, stopped } = c;"]]],
  // ---- when to grade, and when latest may advance
  ['a partial census is graded', "if (analysis.calls.verdict !== 'ANSWERED') notGraded =", 'if (false) notGraded ='],
  ['only an unknown census is not graded', "if (analysis.calls.verdict !== 'ANSWERED') notGraded =", "if (analysis.calls.verdict === 'UNKNOWN') notGraded ="],
  ['a partial census gives no reason', "(analysis.calls.partialBecause || [analysis.calls.why]).join('; ')", "''"],
  ['a throw is not recorded', "analysisError = String(e && e.stack ? e.stack : e).split('\\n').slice(0, 4).join(' | ');", 'analysisError = null;'],
  ['a throw leaves no analysis', "analysis = analysis || { calls: {}, coverageLine: `ANALYSIS FAILED: ${analysisError.slice(0, 160)}` };", ''],
  ['a throw is caught nowhere', '  } catch (e) {\n    analysisError', '  } catch (e) {\n    throw e;\n    analysisError'],
  ['the population is not compared with the census', 'const reached = partitions && grade.population === census.gradeable;', 'const reached = partitions;'],
  ['the partition is not checked', 'const reached = partitions && grade.population === census.gradeable;', 'const reached = grade !== null && grade.population === census.gradeable;'],
  ['graded and not applicable need not sum to the population', 'grade.graded + grade.notApplicable.total === grade.population && grade.agree', 'grade.graded + grade.notApplicable.total >= grade.population && grade.agree'],
  ['agree and disagree need not sum to graded', 'grade.agree + grade.disagree === grade.graded;', 'grade.agree + grade.disagree >= grade.graded;'],
  ['a null grade is a partition', 'const partitions = grade !== null && ', 'const partitions = '],
  ['a throw has no reason', "const why = analysisError !== null ? 'the analysis threw'", 'const why = analysisError !== null ? null'],
  ['a drop has the wrong reason', "grade.population !== census.gradeable ? `the core's population", "grade.population === census.gradeable ? `the core's population"],
  ['a partition failure has no reason', ": !partitions ? 'the core did not place every call exactly once' : null;", ': null;'],
  ['reached is always true', 'reachedTarget: reached, notReachedBecause: why,', 'reachedTarget: true, notReachedBecause: why,'],
  ['the reason is not recorded', 'reachedTarget: reached, notReachedBecause: why,', 'reachedTarget: reached,'],
  // ---- what the artifact says
  ['the laboratory commit is not recorded', "labSha: typeof process.env.LAB_SHA === 'string' && process.env.LAB_SHA !== '' ? process.env.LAB_SHA : null,", 'labSha: null,'],
  ['an unset laboratory commit is undefined', "labSha: typeof process.env.LAB_SHA === 'string' && process.env.LAB_SHA !== '' ? process.env.LAB_SHA : null,", 'labSha: process.env.LAB_SHA,'],
  ['an empty laboratory commit is recorded', "typeof process.env.LAB_SHA === 'string' && process.env.LAB_SHA !== '' ?", "typeof process.env.LAB_SHA === 'string' ?"],
  ['the module hash is not recorded', 'core: { path: CORE_PATH, sha256, labSha', 'core: { path: CORE_PATH, labSha'],
  ['the module path is not recorded', 'core: { path: CORE_PATH, sha256, labSha', 'core: { sha256, labSha'],
  ['the rule version is not recorded', ', ruleVersion: core.RULE_VERSION },', ' },'],
  ['the coverage line is not the module\'s', 'coverageLine: grade !== null ? core.coverageLine(grade, census) : `not graded: ${why}`,', "coverageLine: grade !== null ? 'graded' : `not graded: ${why}`,"],
  ['an ungraded line does not say so', '`not graded: ${why}`,', '`${why}`,'],
  ['the census line is lost', 'censusCoverageLine: analysis.coverageLine,', ''],
  ['the census verdict is lost', 'census: { verdict: census.verdict, ', 'census: { '],
  ['the census gradeable count is lost', 'gradeable: census.gradeable, gradeableBy', 'gradeableBy'],
  ['the census call count is lost', 'uniqueCalls: census.uniqueCalls, ', ''],
  ['the census funnel is lost', 'inTrackedLeague: census.inTrackedLeague, withIncidentsKey: census.withIncidentsKey, ', ''],
  ['the census split is lost', ', gradeableBy: census.gradeableBy }', ' }'],
  ['the census partial reasons are lost', 'partialBecause: census.partialBecause, ', ''],
  ['the grade is not in the artifact', '    grade, bsdLog: log,', '    bsdLog: log,'],
  ['the call log is not in the artifact', '    grade, bsdLog: log,', '    grade,'],
  ['the log label is the census', "await collect('bsd-next-goal-grade')", "await collect('bsd-next-goal-census')"],
  ['the result line omits the counts', '`graded ${grade.graded} of ${grade.population} | agree ${grade.agree} | disagree ${grade.disagree} | not applicable ${grade.notApplicable.total}`', "'graded'"],
  ['the coverage is not printed', "console.log('\\n=== COVERAGE ===\\n' + out.coverageLine);", ''],
  ['an analysis error is not printed', '${analysisError ? ` | ANALYSIS_ERROR ${analysisError.slice(0, 120)}` : \'\'}', ''],
  // ---- the committed file
  ['the token is not refused', 'refuseIfTokenInside(body, TOKEN);', ''],
  ['the wrong secret is refused', 'refuseIfTokenInside(body, TOKEN);', "refuseIfTokenInside(body, 'not-the-token');"],
  ['the outbox directory is not made', "fs.mkdirSync('outbox', { recursive: true });", ''],
  ['the stamped file is not written', 'fs.writeFileSync(`outbox/bsd-next-goal-grade-${stamp}.json`, body);', ''],
  ['latest is always written', 'if (out.reachedTarget) {', 'if (true) {'],
  ['latest is never written', 'if (out.reachedTarget) {', 'if (false) {'],
  ['latest has another name', "fs.writeFileSync('outbox/bsd-next-goal-grade-latest.json', body);", "fs.writeFileSync('outbox/bsd-next-goal-grade-last.json', body);"],
  ['the stamp has another prefix', 'fs.writeFileSync(`outbox/bsd-next-goal-grade-${stamp}.json`, body);', 'fs.writeFileSync(`outbox/bsd-next-goal-census-${stamp}.json`, body);'],
  // ---- running
  ['importing the runner runs it', 'if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {', 'if (true) {'],
  ['a failure exits 0', "console.error('bsd-next-goal-grade failed:', e.stack || e.message); process.exit(1);", "console.error('bsd-next-goal-grade failed:', e.stack || e.message); process.exit(0);"],
  ['the BSD call count is not recorded', 'bsdCallsMade: bsdCalls, stopped,', 'stopped,'],
  ['the stop reason is not recorded', 'bsdCallsMade: bsdCalls, stopped,', 'bsdCallsMade: bsdCalls,'],
];

const BROKEN_FOR_RUN = ['if (out.reachedTarget) {', 'if (true) {'];
const BROKEN_EXITS_AT_IMPORT = ["const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);", "process.exit(0);\nconst isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);"];

const CHECK_MUTATIONS = [
  ['blind', 'eq never fails', 'if (stable(got) !== stable(want)) {', 'if (false) {', BROKEN_FOR_RUN],
  ['blind', 'the exit code ignores failures', 'finished = true;\nprocess.exit(failed === 0 ? 0 : 1);', 'finished = true;\nprocess.exit(0);', BROKEN_FOR_RUN],
  ['blind', 'an early exit is not noticed', "process.on('exit', (code) => {", "process.on('never', (code) => {", BROKEN_EXITS_AT_IMPORT],
  ['red', 'MIN_SCENARIOS is one above the real count', 'export const MIN_SCENARIOS = 15;', 'export const MIN_SCENARIOS = 16;'],
  ['red', 'MIN_ASSERTIONS is one above the real count', 'export const MIN_ASSERTIONS = 53;', 'export const MIN_ASSERTIONS = 54;'],
];

const applyEdits = (text, edits, label) => {
  let out = text;
  for (const [anchor, replacement] of edits) {
    const n = out.split(anchor).length - 1;
    if (n !== 1) return { error: `NOT APPLIED: anchor matched ${n} times, not 1 (${label}): ${JSON.stringify(anchor.slice(0, 70))}` };
    if (anchor === replacement) return { error: `NOT APPLIED: replacement equals anchor (${label})` };
    out = out.replace(anchor, () => replacement);
  }
  return { text: out };
};
const exec = (checkFile, srcFile) => new Promise((resolve) => {
  const c = spawn(process.execPath, [checkFile, '--source', srcFile, '--lab', LAB]);
  let stdout = '';
  c.stdout.on('data', (d) => { stdout += d; });
  c.stderr.on('data', () => {});
  const timer = setTimeout(() => c.kill('SIGKILL'), 150000);
  c.on('close', (status, signal) => { clearTimeout(timer); resolve({ status, signal, stdout }); });
});
const red = (r) => r.status === 1 && /^FAIL/m.test(r.stdout);
const parses = (file) => spawnSync(process.execPath, ['--check', file]).status === 0;
async function pool(items, n, fn) {
  const results = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: n }, async () => { while (next < items.length) { const i = next++; results[i] = await fn(items[i], i); } }));
  return results;
}

const srcText = fs.readFileSync(SRC, 'utf8');
let caught = 0, notCaught = 0, notApplied = 0;

const b = await exec(RUN_CHECK, SRC);
console.log(`baseline: the run check on the real runner exits ${b.status}`);
if (b.status !== 0) { console.log('FAIL  the check is already red; every mutation would be "caught" for the wrong reason'); process.exit(1); }

console.log(`\nHALF 1: the runner, broken (${SOURCE_MUTATIONS.length} mutations)`);
const lines = [];
await pool(SOURCE_MUTATIONS, 3, async ([name, a, rep], i) => {
  const r = applyEdits(srcText, Array.isArray(a) ? a : [[a, rep]], name);
  if (r.error) { notApplied++; lines[i] = `  ${r.error}  [${name}]`; return; }
  const f = path.join(tmp, `runner-${i}.mjs`);
  fs.writeFileSync(f, absolute(r.text));
  if (!parses(f)) { notApplied++; lines[i] = `  NOT APPLIED: the mutant does not parse  [${name}]`; return; }
  const x = await exec(RUN_CHECK, f);
  if (red(x)) { caught++; lines[i] = `  caught       ${name}`; } else { notCaught++; lines[i] = `  NOT CAUGHT   ${name}  (exit ${x.status})`; }
});
console.log(lines.join('\n'));

console.log('\nHALF 2: the run check, broken');
const brokenFiles = new Map();
const brokenFile = (spec) => {
  if (!brokenFiles.has(spec[0])) {
    const r = applyEdits(srcText, [spec], 'broken runner');
    if (r.error) { console.log(`  ${r.error}`); process.exit(1); }
    const f = path.join(tmp, `broken-${brokenFiles.size}.mjs`);
    fs.writeFileSync(f, absolute(r.text));
    brokenFiles.set(spec[0], f);
  }
  return brokenFiles.get(spec[0]);
};
const checkText = fs.readFileSync(RUN_CHECK, 'utf8');
const half2 = [];
await pool(CHECK_MUTATIONS, 2, async ([kind, name, a, rep, broken], i) => {
  const r = applyEdits(checkText, [[a, rep]], name);
  if (r.error) { notApplied++; half2[i] = `  ${r.error}  [${name}]`; return; }
  const f = path.join(tmp, `check-${i}.mjs`);
  fs.writeFileSync(f, r.text);
  if (!parses(f)) { notApplied++; half2[i] = `  NOT APPLIED: the mutant does not parse  [${name}]`; return; }
  let ok, shown;
  if (kind === 'blind') {
    const real = await exec(RUN_CHECK, brokenFile(broken));
    const mutated = await exec(f, brokenFile(broken));
    ok = red(real) && mutated.status === 0 && !red(mutated);
    shown = `real check exit ${real.status}, mutated check exit ${mutated.status} on the broken runner`;
  } else {
    const mutated = await exec(f, SRC);
    ok = red(mutated);
    shown = `mutated check exit ${mutated.status} on the real runner`;
  }
  if (ok) { caught++; half2[i] = `  caught       ${name}  (${kind}: ${shown})`; } else { notCaught++; half2[i] = `  NOT CAUGHT   ${name}  (${kind}: ${shown})`; }
});
console.log(half2.join('\n'));

const moved = REAL.filter((f) => sha(f) !== before[f]);
const leftover = strays().filter((f) => !strayBefore.has(f));
for (const f of leftover) fs.rmSync(path.join('outbox', f), { force: true });
fs.rmSync(tmp, { recursive: true, force: true });
const total = SOURCE_MUTATIONS.length + CHECK_MUTATIONS.length;
console.log(`\nmutations ${total}: caught ${caught}, NOT CAUGHT ${notCaught}, NOT APPLIED ${notApplied}; real files moved: ${moved.length}; stray artifacts removed: ${leftover.length}`);
if (moved.length) console.log(`FAIL  the real file(s) changed: ${moved.join(', ')}`);
process.exit(notCaught === 0 && notApplied === 0 && moved.length === 0 ? 0 : 1);
