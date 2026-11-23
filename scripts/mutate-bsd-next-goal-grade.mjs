#!/usr/bin/env node
// Rule 90 for scripts/check-bsd-next-goal-grade-run.mjs. HALF 1 breaks a temp copy of the REAL scripts/bsd-next-goal-grade.mjs the
// ways the population, the load of the laboratory module, the advance of latest or the artifact can be wrong, and requires the run
// check to go red on each. HALF 2 breaks the run check itself: mutations that must leave it BLIND on a broken runner, and mutations
// that tighten a gate and must turn it red on the real runner.
//
// Two controls come first, because the first version of this harness was vacuous and said "79 of 79 caught" (review, 2026-11-23): it
// rewrote the runner's two import specifiers in every mutant, the run check's last scenario reads the runner's source for the
// original specifiers, and so EVERY mutant, a comment-only one included, went red for that reason alone.
//   - the mutant copies now live in a directory that holds real copies of the probe and the census, so the specifiers are untouched;
//   - an unmodified copy and a comment-only copy of the runner must each pass the run check (exit 0), or no result below means anything.
//
// The same discipline as scripts/mutate-bsd-next-goal-census.mjs: each anchor occurs exactly once and the replacement differs; a
// mutant that does not parse is NOT APPLIED; CAUGHT needs exit 1 and a FAIL line in the check's own output; the baseline runs first;
// the real files are hashed before and after and must not move. The run check is run with --fail-fast: red or green is all this needs.
//
// Left out as EQUIVALENT, each for a stated reason:
//   `!cap.ok ||` in populationOf: covers() is false for a capture that did not parse, so the clause repeats it.
//   `|| rd.json === undefined` in populationOf: captureOf(undefined) does not parse, so the capture is dropped one line later.
//   `if (id === null) continue;`: reads.get(null) is undefined, so the read is dropped one line later.
//   `t.length >= 8` in redact: a real token is longer; the floor only stops an empty environment value from splitting every character.
//   the grading RULE: its mutants are field-laboratory's (scripts/mutate-bsd-next-goal-grade-core.mjs), not this runner's.
//
// Usage: node scripts/mutate-bsd-next-goal-grade.mjs [--lab DIR]   (DIR: a field-laboratory checkout, default lab)

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';

const argv = process.argv.slice(2);
const labIdx = argv.indexOf('--lab');
const LAB = path.resolve(labIdx >= 0 ? argv[labIdx + 1] : 'lab');
const SRC = 'scripts/bsd-next-goal-grade.mjs';
const RUN_CHECK = 'scripts/check-bsd-next-goal-grade-run.mjs';
const DEPS = ['scripts/bsd-next-goal-probe.mjs', 'scripts/bsd-next-goal-census.mjs'];
const REAL = [SRC, RUN_CHECK, ...DEPS];
const sha = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
const before = Object.fromEntries(REAL.map((f) => [f, sha(f)]));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mut-ngg-run-'));
// the runner's relative imports resolve here, to the real files
for (const f of DEPS) fs.copyFileSync(f, path.join(tmp, path.basename(f)));
const strays = () => (fs.existsSync('outbox') ? fs.readdirSync('outbox').filter((f) => /^bsd-next-goal-grade-/.test(f)) : []);
const strayBefore = new Set(strays());

// [name, anchor, replacement] or [name, [[anchor, replacement], ...]]
const SOURCE_MUTATIONS = [
  // ---- the population
  ['an open call is in the population', "if (r.outcome !== 'hit' && r.outcome !== 'miss') continue;", ''],
  ['only a hit is in the population', "if (r.outcome !== 'hit' && r.outcome !== 'miss') continue;", "if (r.outcome !== 'hit') continue;"],
  ['only a miss is in the population', "if (r.outcome !== 'hit' && r.outcome !== 'miss') continue;", "if (r.outcome !== 'miss') continue;"],
  ['a nogoal call is in the population', "if (r.outcome !== 'hit' && r.outcome !== 'miss') continue;", "if (r.outcome !== 'hit' && r.outcome !== 'miss' && r.outcome !== 'nogoal') continue;"],
  ['a call with no resolved minute is in', 'if (num(r.resolved_minute) === null) continue;', ''],
  ['a resolved minute of zero is out', 'if (num(r.resolved_minute) === null) continue;', 'if (!r.resolved_minute) continue;'],
  ['a text resolved minute is in', 'if (num(r.resolved_minute) === null) continue;', 'if (r.resolved_minute === null || r.resolved_minute === undefined) continue;'],
  ['a 404 read is in', 'if (!rd || rd.status !== 200 || rd.json === undefined) continue;', 'if (!rd || rd.json === undefined) continue;'],
  ['an unread event is in', 'if (!rd || rd.status !== 200 || rd.json === undefined) continue;', 'if (rd && (rd.status !== 200 || rd.json === undefined)) continue;'],
  ['a capture that does not cover is in', 'if (!cap.ok || !covers(r, cap)) continue;', 'if (!cap.ok) continue;'],
  ['every read capture is in', 'if (!cap.ok || !covers(r, cap)) continue;', ''],
  ['the event id is not text', 'String(r.event.id) : null;', 'r.event.id : null;'],
  ['an event id of zero is no id', 'r.event.id !== undefined && r.event.id !== null ? String(r.event.id) : null;', 'r.event.id ? String(r.event.id) : null;'],
  ['a row that is not an object is read', 'const id = isObj(r) && isObj(r.event) &&', 'const id = isObj(r.event) &&'],
  ['an event that is not an object is read', 'isObj(r) && isObj(r.event) &&', 'isObj(r) &&'],
  // ---- the tags
  ['the slug is not carried', '        slug: slugOf.get(id),\n', ''],
  ['the state is not carried', '        state: cap.state,\n', ''],
  ['the slug is the state', '        slug: slugOf.get(id),\n        state: cap.state,\n', '        slug: cap.state,\n        state: slugOf.get(id),\n'],
  ['VAR is never tagged', "var: rows2.some((x) => isObj(x) && x.type === 'varDecision') ? 'var rows' : 'no var rows',", "var: 'no var rows',"],
  ['VAR is always tagged', "var: rows2.some((x) => isObj(x) && x.type === 'varDecision') ? 'var rows' : 'no var rows',", "var: 'var rows',"],
  ['any row type is VAR', "isObj(x) && x.type === 'varDecision'", 'isObj(x) && x.type'],
  ['a row that is not an object is read for VAR', "isObj(x) && x.type === 'varDecision'", "x.type === 'varDecision'"],
  ['VAR is tagged with the wrong labels', "? 'var rows' : 'no var rows',", "? 'no var rows' : 'var rows',"],
  ['an absent capture event_id is a difference', "ownId === undefined || ownId === null ? 'absent'", "ownId === null ? 'absent'"],
  ['a null capture event_id is a difference', "ownId === undefined || ownId === null ? 'absent'", "ownId === undefined ? 'absent'"],
  ['the capture event_id is compared as it comes', "String(ownId) === id ? 'matches'", "ownId === id ? 'matches'"],
  ['a matching event_id is a difference', "String(ownId) === id ? 'matches' : 'differs'", "String(ownId) === id ? 'differs' : 'matches'"],
  ['the event_id is not tagged', "        eventId: ownId === undefined || ownId === null ? 'absent' : String(ownId) === id ? 'matches' : 'differs',\n", ''],
  ['extra time is never tagged', "extraTime: cap.periodTexts.some((x) => /^(extra|et)/i.test(x)) ? 'yes' : 'no',", "extraTime: 'no',"],
  ['extra time ignores an ET row', '/^(extra|et)/i.test(x)', '/^(extra)/i.test(x)'],
  ['extra time ignores an Extra time row', '/^(extra|et)/i.test(x)', '/^(et)/i.test(x)'],
  ['extra time is case sensitive', '/^(extra|et)/i.test(x)', '/^(extra|et)/.test(x)'],
  ['extra time may be anywhere in the text', '/^(extra|et)/i.test(x)', '/(extra|et)/i.test(x)'],
  ['the extra-time labels are swapped', "? 'yes' : 'no',\n      },", "? 'no' : 'yes',\n      },"],
  ['the capture handed over is the parse', 'capture: rd.json, key: id,', 'capture: cap, key: id,'],
  ['the call handed over is empty', 'call: r, capture', 'call: {}, capture'],
  ['every capture shares a key', 'key: id,\n      tags', "key: 'k',\n      tags"],
  // ---- the shape of a grade
  ['an empty object is a grade', 'return isObj(g) && isCount(g.population)', 'return isObj(g) || isCount(g.population)'],
  ['a missing population is a grade', '&& isCount(g.population) && isCount(g.graded)', '&& isCount(g.graded)'],
  ['a missing graded is a grade', '&& isCount(g.graded) && isCount(g.agree)', '&& isCount(g.agree)'],
  ['a missing agree is a grade', '&& isCount(g.agree) && isCount(g.disagree)', '&& isCount(g.disagree)'],
  ['a missing disagree is a grade', '&& isCount(g.disagree)\n    && isObj(g.notApplicable)', '\n    && isObj(g.notApplicable)'],
  ['a missing notApplicable is a grade', '    && isObj(g.notApplicable) && isCount(g.notApplicable.total)', '    && isCount(g.notApplicable.total)'],
  ['a missing notApplicable total is a grade', 'isObj(g.notApplicable) && isCount(g.notApplicable.total)', 'isObj(g.notApplicable)'],
  ['a missing rule version is a grade', " && typeof g.ruleVersion === 'string';", ';'],
  ['a negative count is a count', 'const isCount = (v) => Number.isInteger(v) && v >= 0;', 'const isCount = (v) => Number.isInteger(v);'],
  ['a fraction is a count', 'const isCount = (v) => Number.isInteger(v) && v >= 0;', 'const isCount = (v) => typeof v === \'number\' && v >= 0;'],
  ['text is a count', 'const isCount = (v) => Number.isInteger(v) && v >= 0;', 'const isCount = (v) => Number.isInteger(Number(v)) && v >= 0;'],
  ['the shape of the grade is not checked', "if (!validGrade(g)) throw new Error('the core returned a grade of the wrong shape');", ''],
  ['the coverage line is not checked', "if (typeof line !== 'string') throw new Error('the core returned a coverage line that is not text');", ''],
  ['the coverage line is computed outside the analysis', "      const line = core.coverageLine(g, analysis.calls);\n      if (typeof line !== 'string') throw new Error('the core returned a coverage line that is not text');\n      grade = g; gradeLine = line;", "      grade = g; gradeLine = null;"],
  // ---- loading the laboratory module before anything is spent
  ['a missing module is imported anyway', "if (!fs.existsSync(file)) throw new Error(`LAB_CORE ${corePath} does not exist: the laboratory was not checked out there`);", ''],
  ['gradeCalls is not required', "for (const name of ['gradeCalls', 'coverageLine'])", "for (const name of ['coverageLine'])"],
  ['coverageLine is not required', "for (const name of ['gradeCalls', 'coverageLine'])", "for (const name of ['gradeCalls'])"],
  ['an export that is not a function is accepted', "typeof core[name] !== 'function'", 'core[name] === undefined'],
  ['RULE_VERSION is not required', "if (typeof core.RULE_VERSION !== 'string') throw new Error('LAB_CORE does not export RULE_VERSION');", ''],
  ['the hash is of something else', "crypto.createHash('sha256').update(text).digest('hex')", "crypto.createHash('sha256').update('x').digest('hex')"],
  ['no LAB_CORE is a path', "if (typeof CORE_PATH !== 'string' || CORE_PATH === '') {", 'if (false) {'],
  ['an empty LAB_CORE is a path', "if (typeof CORE_PATH !== 'string' || CORE_PATH === '') {", "if (typeof CORE_PATH !== 'string') {"],
  ['the module is loaded after the spend', [['const { core, sha256 } = await loadCore(CORE_PATH);   // before anything is spent', 'let core, sha256;'], ["const { out, ledger, r2, reads, ctx, log, slugOf, TOKEN, TS, bsdCalls, stopped } = c;", "const loaded = await loadCore(CORE_PATH); core = loaded.core; sha256 = loaded.sha256;\n  const { out, ledger, r2, reads, ctx, log, slugOf, TOKEN, TS, bsdCalls, stopped } = c;"]]],
  // ---- the laboratory commit
  ['the laboratory commit is not read', "const LAB_SHA = typeof process.env.LAB_SHA === 'string' && process.env.LAB_SHA !== '' ? process.env.LAB_SHA : null;", 'const LAB_SHA = null;'],
  ['an unset laboratory commit is undefined', "const LAB_SHA = typeof process.env.LAB_SHA === 'string' && process.env.LAB_SHA !== '' ? process.env.LAB_SHA : null;", 'const LAB_SHA = process.env.LAB_SHA;'],
  ['an empty laboratory commit is recorded', "typeof process.env.LAB_SHA === 'string' && process.env.LAB_SHA !== '' ?", "typeof process.env.LAB_SHA === 'string' ?"],
  ['the laboratory commit is not required in Actions', "if (process.env.GITHUB_ACTIONS === 'true' && !/^[0-9a-f]{40}$/.test(LAB_SHA)) {", 'if (false) {'],
  ['Actions is mistyped', "process.env.GITHUB_ACTIONS === 'true'", "process.env.GITHUB_ACTIONS === 'True'"],
  ['any text is a commit in Actions', "!/^[0-9a-f]{40}$/.test(LAB_SHA)", 'LAB_SHA === null'],
  ['a 39-character commit is accepted', '/^[0-9a-f]{40}$/.test(LAB_SHA)', '/^[0-9a-f]{39,40}$/.test(LAB_SHA)'],
  ['a 41-character commit is accepted', '/^[0-9a-f]{40}$/.test(LAB_SHA)', '/^[0-9a-f]{40,41}$/.test(LAB_SHA)'],
  ['an upper-case commit is accepted', '/^[0-9a-f]{40}$/.test(LAB_SHA)', '/^[0-9a-fA-F]{40}$/.test(LAB_SHA)'],
  ['a commit with trailing text is accepted', '/^[0-9a-f]{40}$/.test(LAB_SHA)', '/^[0-9a-f]{40}/.test(LAB_SHA)'],
  ['a commit with leading text is accepted', '/^[0-9a-f]{40}$/.test(LAB_SHA)', '/[0-9a-f]{40}$/.test(LAB_SHA)'],
  ['a refused commit exits 0', "console.error('under GITHUB_ACTIONS LAB_SHA must be the full 40-hex laboratory commit the grader was checked out at'); process.exit(1);", "console.error('under GITHUB_ACTIONS LAB_SHA must be the full 40-hex laboratory commit the grader was checked out at'); process.exit(0);"],
  // ---- when to grade, and when latest may advance
  ['a partial census is graded', "if (analysis.calls.verdict !== 'ANSWERED') notGraded =", 'if (false) notGraded ='],
  ['only an unknown census is not graded', "if (analysis.calls.verdict !== 'ANSWERED') notGraded =", "if (analysis.calls.verdict === 'UNKNOWN') notGraded ="],
  ['a partial census gives no reason', "(analysis.calls.partialBecause || [analysis.calls.why]).join('; ')", "''"],
  ['the census verdict is not in the reason', 'notGraded = `the census is ${analysis.calls.verdict}: ', 'notGraded = `the census is: '],
  ['a throw is not recorded', "analysisError = String(e && e.stack ? e.stack : e).split('\\n').slice(0, 4).join(' | ');", 'analysisError = null;'],
  ['a throw leaves no analysis', "analysis = analysis || { calls: {}, coverageLine: `ANALYSIS FAILED: ${analysisError.slice(0, 160)}` };", ''],
  ['a throw is caught nowhere', '  } catch (e) {\n    analysisError', '  } catch (e) {\n    throw e;\n    analysisError'],
  ['the population is not compared with the census', 'const reached = partitions && grade.population === census.gradeable && grade.population > 0;', 'const reached = partitions && grade.population > 0;'],
  ['the partition is not checked', 'const reached = partitions && grade.population === census.gradeable && grade.population > 0;', 'const reached = grade !== null && grade.population === census.gradeable && grade.population > 0;'],
  ['an empty population is reached', 'const reached = partitions && grade.population === census.gradeable && grade.population > 0;', 'const reached = partitions && grade.population === census.gradeable;'],
  ['an empty population is not reached by a different test', 'grade.population === census.gradeable && grade.population > 0;', 'grade.population === census.gradeable && grade.population >= 0;'],
  ['graded and not applicable need not sum to the population', 'grade.graded + grade.notApplicable.total === grade.population && grade.agree', 'grade.graded + grade.notApplicable.total >= grade.population && grade.agree'],
  ['graded and not applicable may fall short of the population', 'grade.graded + grade.notApplicable.total === grade.population && grade.agree', 'grade.graded + grade.notApplicable.total <= grade.population && grade.agree'],
  ['agree and disagree may exceed graded', 'grade.agree + grade.disagree === grade.graded;', 'grade.agree + grade.disagree <= grade.graded;'],
  ['agree and disagree may fall short of graded', 'grade.agree + grade.disagree === grade.graded;', 'grade.agree + grade.disagree >= grade.graded;'],
  ['a null grade is a partition', 'const partitions = grade !== null && ', 'const partitions = '],
  ['a throw has no reason', "const why = analysisError !== null ? 'the analysis threw'", 'const why = analysisError !== null ? null'],
  ['a partition failure has no reason', ": !partitions ? 'the core did not place every call exactly once'", ': !partitions ? null'],
  ['a drop has no reason', "grade.population !== census.gradeable ? `the core's population ${grade.population} is not the census's gradeable count ${census.gradeable}`", 'grade.population !== census.gradeable ? null'],
  ['an empty population has no reason', ": grade.population === 0 ? 'the census found no gradeable calls' : null;", ': null;'],
  ['the reasons are checked in another order', ": !partitions ? 'the core did not place every call exactly once'\n        : grade.population !== census.gradeable ?", ": grade.population !== census.gradeable ? 'x'\n        : !partitions ?"],
  ['reached is always true', 'reachedTarget: reached, notReachedBecause: why,', 'reachedTarget: true, notReachedBecause: why,'],
  ['the reason is not recorded', 'reachedTarget: reached, notReachedBecause: why,', 'reachedTarget: reached,'],
  // ---- what the artifact says
  ['the module hash is not recorded', 'core: { path: CORE_PATH, sha256, labSha: LAB_SHA,', 'core: { path: CORE_PATH, labSha: LAB_SHA,'],
  ['the module path is not recorded', 'core: { path: CORE_PATH, sha256, labSha: LAB_SHA,', 'core: { sha256, labSha: LAB_SHA,'],
  ['the laboratory commit is not in the artifact', 'core: { path: CORE_PATH, sha256, labSha: LAB_SHA,', 'core: { path: CORE_PATH, sha256,'],
  ['the rule version is not recorded', ', ruleVersion: core.RULE_VERSION },', ' },'],
  ['the same-source caveat is lost', '    note: NOTE,\n', ''],
  ['the coverage line is not the module\'s', "coverageLine: grade !== null ? gradeLine : `not graded: ${why}`,", "coverageLine: grade !== null ? 'graded' : `not graded: ${why}`,"],
  ['an ungraded line does not say so', '`not graded: ${why}`,', '`${why}`,'],
  ['the census line is lost', 'censusCoverageLine: analysis.coverageLine,', ''],
  ['the census verdict is lost', 'census: { verdict: census.verdict, ', 'census: { '],
  ['the census gradeable count is lost', 'gradeable: census.gradeable, gradeableBy', 'gradeableBy'],
  ['the census call count is lost', 'uniqueCalls: census.uniqueCalls, ', ''],
  ['the census funnel is lost', 'inTrackedLeague: census.inTrackedLeague, withIncidentsKey: census.withIncidentsKey, ', ''],
  ['the census split is lost', 'gradeableBy: census.gradeableBy, notGradeableBecause', 'notGradeableBecause'],
  ['the census reasons are lost', ', notGradeableBecause: census.notGradeableBecause }', ' }'],
  ['the census partial reasons are lost', 'partialBecause: census.partialBecause, ', ''],
  ['the grade is not in the artifact', '    grade, bsdLog: log,', '    bsdLog: log,'],
  ['the call log is not in the artifact', '    grade, bsdLog: log,', '    grade,'],
  ['the log label is the census', "await collect('bsd-next-goal-grade')", "await collect('bsd-next-goal-census')"],
  ['the result line omits the counts', '`graded ${grade.graded} of ${grade.population} | agree ${grade.agree} | disagree ${grade.disagree} | not applicable ${grade.notApplicable.total}`', "'graded'"],
  ['the coverage is not printed', "console.log('\\n=== COVERAGE ===\\n' + out.coverageLine);", ''],
  ['an analysis error is not printed', '${analysisError ? ` | ANALYSIS_ERROR ${analysisError.slice(0, 120)}` : \'\'}', ''],
  ['the bsd call count is not recorded', 'bsdCallsMade: bsdCalls, stopped,', 'stopped,'],
  ['the stop reason is not recorded', 'bsdCallsMade: bsdCalls, stopped,', 'bsdCallsMade: bsdCalls,'],
  // ---- the committed file and the log
  ['the token is not refused', 'refuseIfTokenInside(body, TOKEN);', ''],
  ['the wrong secret is refused', 'refuseIfTokenInside(body, TOKEN);', "refuseIfTokenInside(body, 'not-the-token');"],
  ['the token is not redacted from an error', "console.error('bsd-next-goal-grade failed:', redact(e.stack || e.message));", "console.error('bsd-next-goal-grade failed:', e.stack || e.message);"],
  ['only the raw token is redacted', '.reduce((s, t) => (typeof t === \'string\' && t.length >= 8 ? s.split(t).join(\'[redacted]\') : s), String(text));', '.slice(0, 1).reduce((s, t) => (typeof t === \'string\' && t.length >= 8 ? s.split(t).join(\'[redacted]\') : s), String(text));'],
  ['the token is not removed from the message', "s.split(t).join('[redacted]')", 's'],
  ['the outbox directory is not made', "fs.mkdirSync('outbox', { recursive: true });", ''],
  ['the stamped file is not written', 'fs.writeFileSync(`outbox/bsd-next-goal-grade-${stamp}.json`, body);', ''],
  ['latest is always written', 'if (out.reachedTarget) {', 'if (true) {'],
  ['latest is never written', 'if (out.reachedTarget) {', 'if (false) {'],
  ['latest has another name', "fs.writeFileSync('outbox/bsd-next-goal-grade-latest.json', body);", "fs.writeFileSync('outbox/bsd-next-goal-grade-last.json', body);"],
  ['the stamp has another prefix', 'fs.writeFileSync(`outbox/bsd-next-goal-grade-${stamp}.json`, body);', 'fs.writeFileSync(`outbox/bsd-next-goal-census-${stamp}.json`, body);'],
  // ---- running
  ['importing the runner runs it', 'if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {', 'if (true) {'],
  ['a failure exits 0', "redact(e.stack || e.message)); process.exit(1);", "redact(e.stack || e.message)); process.exit(0);"],
  ['a success exits 1', 'main().then(() => process.exit(0))', 'main().then(() => process.exit(1))'],
]

const BROKEN_FOR_RUN = ['if (out.reachedTarget) {', 'if (true) {']
const BROKEN_EXITS_AT_IMPORT = ["const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);", "process.exit(0);\nconst isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);"]

const CHECK_MUTATIONS = [
  ['blind', 'eq never fails', 'if (stable(got) !== stable(want)) {', 'if (false) {', BROKEN_FOR_RUN],
  ['blind', 'the exit code ignores failures', 'finished = true;\nprocess.exit(failed === 0 ? 0 : 1);', 'finished = true;\nprocess.exit(0);', BROKEN_FOR_RUN],
  ['blind', 'an early exit is not noticed', "process.on('exit', (code) => {", "process.on('never', (code) => {", BROKEN_EXITS_AT_IMPORT],
  ['red', 'MIN_SCENARIOS is one above the real count', 'export const MIN_SCENARIOS = 20;', 'export const MIN_SCENARIOS = 21;'],
  ['red', 'MIN_ASSERTIONS is one above the real count', 'export const MIN_ASSERTIONS = 96;', 'export const MIN_ASSERTIONS = 97;'],
]

const applyEdits = (text, edits, label) => {
  let out = text
  for (const [anchor, replacement] of edits) {
    const n = out.split(anchor).length - 1
    if (n !== 1) return { error: `NOT APPLIED: anchor matched ${n} times, not 1 (${label}): ${JSON.stringify(anchor.slice(0, 70))}` }
    if (anchor === replacement) return { error: `NOT APPLIED: replacement equals anchor (${label})` }
    out = out.replace(anchor, () => replacement)
  }
  return { text: out }
}
const exec = (checkFile, srcFile, failFast = true) => new Promise((resolve) => {
  const c = spawn(process.execPath, [checkFile, '--source', srcFile, '--lab', LAB, ...(failFast ? ['--fail-fast'] : [])])
  let stdout = ''
  c.stdout.on('data', (d) => { stdout += d })
  c.stderr.on('data', () => {})
  const timer = setTimeout(() => c.kill('SIGKILL'), 240000)
  c.on('close', (status, signal) => { clearTimeout(timer); resolve({ status, signal, stdout }) })
})
const red = (r) => r.status === 1 && /^FAIL/m.test(r.stdout)
const parses = (file) => spawnSync(process.execPath, ['--check', file]).status === 0
async function pool (items, n, fn) {
  const results = new Array(items.length)
  let next = 0
  await Promise.all(Array.from({ length: n }, async () => { while (next < items.length) { const i = next++; results[i] = await fn(items[i], i) } }))
  return results
}

const srcText = fs.readFileSync(SRC, 'utf8')
let caught = 0
let notCaught = 0
let notApplied = 0

const b = await exec(RUN_CHECK, SRC)
console.log(`baseline: the run check on the real runner exits ${b.status}`)
if (b.status !== 0) { console.log('FAIL  the check is already red; every mutation would be "caught" for the wrong reason'); process.exit(1) }

// the controls: a copy that changed nothing, and a copy that changed only a comment, must PASS the run check from this directory
const identity = path.join(tmp, 'runner-identity.mjs')
fs.writeFileSync(identity, srcText)
const noop = path.join(tmp, 'runner-noop.mjs')
fs.writeFileSync(noop, `${srcText}\n// a comment: no behaviour change\n`)
const [c1, c2] = await Promise.all([exec(RUN_CHECK, identity), exec(RUN_CHECK, noop)])
console.log(`control: an unmodified copy exits ${c1.status}, a comment-only copy exits ${c2.status} (both must be 0)`)
if (c1.status !== 0 || c2.status !== 0) { console.log('FAIL  an unmodified copy is red from the mutant directory: every mutant below would be "caught" for the wrong reason'); console.log(c1.stdout.split('\n').filter((l) => /^FAIL/.test(l)).slice(0, 3).join('\n')); process.exit(1) }

console.log(`\nHALF 1: the runner, broken (${SOURCE_MUTATIONS.length} mutations)`)
const lines = []
await pool(SOURCE_MUTATIONS, 4, async ([name, a, rep], i) => {
  const r = applyEdits(srcText, Array.isArray(a) ? a : [[a, rep]], name)
  if (r.error) { notApplied++; lines[i] = `  ${r.error}  [${name}]`; return }
  const f = path.join(tmp, `runner-${i}.mjs`)
  fs.writeFileSync(f, r.text)
  if (!parses(f)) { notApplied++; lines[i] = `  NOT APPLIED: the mutant does not parse  [${name}]`; return }
  const x = await exec(RUN_CHECK, f)
  if (red(x)) { caught++; lines[i] = `  caught       ${name}` } else { notCaught++; lines[i] = `  NOT CAUGHT   ${name}  (exit ${x.status})` }
})
console.log(lines.join('\n'))

console.log('\nHALF 2: the run check, broken')
const brokenFiles = new Map()
const brokenFile = (spec) => {
  if (!brokenFiles.has(spec[0])) {
    const r = applyEdits(srcText, [spec], 'broken runner')
    if (r.error) { console.log(`  ${r.error}`); process.exit(1) }
    const f = path.join(tmp, `broken-${brokenFiles.size}.mjs`)
    fs.writeFileSync(f, r.text)
    brokenFiles.set(spec[0], f)
  }
  return brokenFiles.get(spec[0])
}
const checkText = fs.readFileSync(RUN_CHECK, 'utf8')
const half2 = []
await pool(CHECK_MUTATIONS, 2, async ([kind, name, a, rep, broken], i) => {
  const r = applyEdits(checkText, [[a, rep]], name)
  if (r.error) { notApplied++; half2[i] = `  ${r.error}  [${name}]`; return }
  const f = path.join(tmp, `check-${i}.mjs`)
  fs.writeFileSync(f, r.text)
  if (!parses(f)) { notApplied++; half2[i] = `  NOT APPLIED: the mutant does not parse  [${name}]`; return }
  let ok
  let shown
  if (kind === 'blind') {
    const real = await exec(RUN_CHECK, brokenFile(broken), false)
    const mutated = await exec(f, brokenFile(broken), false)
    ok = red(real) && mutated.status === 0 && !red(mutated)
    shown = `real check exit ${real.status}, mutated check exit ${mutated.status} on the broken runner`
  } else {
    const mutated = await exec(f, SRC, false)
    ok = red(mutated)
    shown = `mutated check exit ${mutated.status} on the real runner`
  }
  if (ok) { caught++; half2[i] = `  caught       ${name}  (${kind}: ${shown})` } else { notCaught++; half2[i] = `  NOT CAUGHT   ${name}  (${kind}: ${shown})` }
})
console.log(half2.join('\n'))

const moved = REAL.filter((f) => sha(f) !== before[f])
const leftover = strays().filter((f) => !strayBefore.has(f))
for (const f of leftover) fs.rmSync(path.join('outbox', f), { force: true })
fs.rmSync(tmp, { recursive: true, force: true })
const total = SOURCE_MUTATIONS.length + CHECK_MUTATIONS.length
console.log(`\nmutations ${total}: caught ${caught}, NOT CAUGHT ${notCaught}, NOT APPLIED ${notApplied}; controls passed; real files moved: ${moved.length}; stray artifacts removed: ${leftover.length}`)
if (moved.length) console.log(`FAIL  the real file(s) changed: ${moved.join(', ')}`)
process.exit(notCaught === 0 && notApplied === 0 && moved.length === 0 ? 0 : 1)
