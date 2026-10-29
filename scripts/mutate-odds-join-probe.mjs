#!/usr/bin/env node
/**
 * Rule 90 for scripts/check-odds-join-probe.mjs.
 *
 * Each mutation changes ONE thing, either in a copy of the classifier (scripts/lib/odds-join-probe.mjs) or in a copy
 * of the probe script, and aims the check at the copy through LIB_UNDER_TEST / SCRIPT_UNDER_TEST. For a classifier
 * mutant the script copy is pointed at the mutated classifier too, so both layers of the check see the mutation. The
 * check must go red for every one. A mutant counts as CAUGHT only when an assertion failed ("N of M passed." with
 * N < M and a FAIL line): a crash or a syntax error proves nothing and is reported as a harness error.
 *
 * THE HARNESS'S OWN ANCHORS ARE ASSERTED. A mutation whose anchor is missing or not unique applies NOTHING, and a
 * check that is green on unmutated source would then print a pass for it.
 */
import { readFileSync, writeFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, resolve } from 'node:path';

const LIB = 'scripts/lib/odds-join-probe.mjs';
const SCRIPT = 'scripts/probe-odds-join.mjs';
const lib0 = readFileSync(LIB, 'utf8'), script0 = readFileSync(SCRIPT, 'utf8');
const born = [];
const put = (dir, text, tag) => {
  const p = join(dir, `.mutant-${tag}-${Math.random().toString(36).slice(2, 8)}.mjs`);
  writeFileSync(p, text); born.push(p); return p;
};
process.on('exit', () => { for (const p of born) rmSync(p, { force: true }); });
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => process.exit(130));

const IMPORT = "from './lib/odds-join-probe.mjs';";
if (script0.split(IMPORT).length !== 2) { console.log(`FAIL: the script's import of the classifier is not unique: ${IMPORT}`); process.exit(1); }

// 'pass' | 'red' (an assertion failed) | 'error' (anything else).
const run = (scriptPath, libPath) => {
  let out = '', code = 0;
  try {
    out = execFileSync(process.execPath, ['scripts/check-odds-join-probe.mjs'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, SCRIPT_UNDER_TEST: resolve(scriptPath), LIB_UNDER_TEST: resolve(libPath) } });
  } catch (e) { out = String(e.stdout || ''); code = e.status ?? 1; }
  const m = /^(\d+) of (\d+) passed\.$/m.exec(out);
  if (code === 0) return m && m[1] === m[2] ? 'pass' : 'error';
  return m && Number(m[1]) < Number(m[2]) && /^FAIL  /m.test(out) ? 'red' : 'error';
};

if (run(SCRIPT, LIB) !== 'pass') { console.log('FAIL: the check is already red on the real script and classifier.'); process.exit(1); }
{
  const l = put('scripts/lib', lib0, 'lib-control');
  const s = put('scripts', script0.replace(IMPORT, `from './lib/${l.split('/').pop()}';`), 'script-control');
  if (run(s, l) !== 'pass') { console.log('FAIL: UNMUTATED copies at the mutant locations are red, so no verdict below would mean anything.'); process.exit(1); }
}
console.log('baseline: the check passes on the real files and on unmutated copies at the mutant locations\n');

// [name, where, anchor, replacement]
const SHAPE = 'mt === null || un === null || ev === null || miss === null';
const INCONSISTENT = 'counts.some(v => !Number.isInteger(v) || v < 0) || rows - priced !== miss || mt + un.length !== miss || late > priced || pr > mt';
const MUTANTS = [
  // THE CLASSIFIER.
  ['P1 "all priced" is read as "no rows" (the original conflation)', 'lib', '`ALL_PRICED: ${priced}', '`NO_ROWS_AT_ALL: ${priced}'],
  ['P2 a date with no rows at all is no longer told apart', 'lib', 'if (rows === 0) {', 'if (false) {'],
  ['P3 "no rows, but the feed lists the slate" is no longer told from "nothing on the date"', 'lib', 'return win > 0', 'return true'],
  ['P4 a missing or null denominator is read as a number', 'lib', 'if (absent.length) return', 'if (false) return'],
  ['P5 a negative or fractional count is accepted', 'lib', INCONSISTENT, INCONSISTENT.replace('counts.some(v => !Number.isInteger(v) || v < 0) || ', '')],
  ['P6 rows - priced need not equal d1_missing', 'lib', INCONSISTENT, INCONSISTENT.replace('rows - priced !== miss', 'false')],
  ['P7 matched + unmatched need not equal d1_missing', 'lib', INCONSISTENT, INCONSISTENT.replace('mt + un.length !== miss', 'false')],
  ['P8 more late than priced is accepted', 'lib', INCONSISTENT, INCONSISTENT.replace('late > priced', 'false')],
  ['P9 more priceable than matched is accepted', 'lib', INCONSISTENT, INCONSISTENT.replace('pr > mt', 'false')],
  ['P10 a priced slate captured after kickoff is called ALL_PRICED', 'lib', 'return late === 0', 'return true'],
  ['P11 an empty feed beats "all priced" (the check order)', 'lib', 'if (miss === 0) {', 'if (ev === 0) return `C1_VENDOR: moved`;\n  if (miss === 0) {'],
  ['P12 an empty feed with unpriced rows is no longer a vendor refusal', 'lib', 'if (ev === 0) return `C1_VENDOR', 'if (false) return `C1_VENDOR'],
  ['P13 a game that has started counts as a join suspect', 'lib', 'Date.parse(u.start_time) > nowMs', 'Date.parse(u.start_time) < nowMs'],
  ['P14 a finalized unmatched row counts as a join suspect', 'lib', 'u && u.finalized === false && Number.isFinite', 'u && Number.isFinite'],
  ['P15 "no join evidence" is lost: finished games read as a failed join', 'lib', 'if (mt === 0 && q === 0)', 'if (mt === 0 && false)'],
  ['P16 nothing joined is read as covered', 'lib', 'if (mt === 0)\n    return `C2_JOIN', 'if (false)\n    return `C2_JOIN'],
  ['P17 C2_JOIN needs the slate matcher to fail too', 'lib', 'if (mt === 0)\n    return `C2_JOIN', 'if (mt === 0 && sm === 0)\n    return `C2_JOIN'],
  ['P18 COVERED reports its two counts the wrong way round', 'lib', '`COVERED: ${mt} of ${miss} unpriced', '`COVERED: ${miss} of ${mt} unpriced'],
  ['P19 our own guard is read as a vendor fault', 'lib', 'if (e.guarded === true) return `C0_GUARDED: ${e.error}`;', ''],
  ['P20 the matched guard is gone', 'lib', SHAPE, SHAPE.replace('mt === null || ', '')],
  ['P21 the unmatched guard is gone', 'lib', SHAPE, SHAPE.replace('un === null || ', '')],
  ['P22 the odds_events guard is gone', 'lib', SHAPE, SHAPE.replace('ev === null || ', '')],
  ['P23 the d1_missing guard is gone', 'lib', SHAPE, SHAPE.replace(' || miss === null', '')],
  ['P24 NO_ROWS_AT_ALL stops being a refusal', 'lib', "'NO_ROWS_AT_ALL', 'C0_GUARDED'", "'C0_GUARDED'"],
  ['P25 C2_JOIN stops failing the run', 'lib', "const FINDINGS = ['C2_JOIN'];", 'const FINDINGS = [];'],
  ['P26 no sport is required', 'lib', "export const REQUIRED = ['CFB'];", 'export const REQUIRED = [];'],
  ['P27 the weekday is off by one', 'lib', 'return Number.isFinite(t) ? new Date(t).getUTCDay() : null;', 'return Number.isFinite(t) ? (new Date(t).getUTCDay() + 1) % 7 : null;'],
  ['P28 the sport list drops a sport', 'lib', "export const SPORTS = ['CFB', 'NFL', 'Bundesliga', 'MLS'];", "export const SPORTS = ['CFB', 'NFL', 'Bundesliga'];"],
  // THE SCRIPT.
  ['S1 the credential is not sent', 'script', "headers: { 'User-Agent': UA, Authorization: `Bearer ${SECRET}` }", "headers: { 'User-Agent': UA }"],
  ['S2 a failing verdict no longer fails the run', 'script', 'if (m.failed.length) {', 'if (false) {'],
  ['S3 the date defaults to the UTC day (the original defect)', 'script', "const DATE = envText('PROBE_DATE');", "const DATE = envText('PROBE_DATE') || new Date().toISOString().slice(0, 10);"],
  ['S4 the weekday is not enforced', 'script', "if (WANT_DAY !== '' && weekdayOf(DATE) !== Number(WANT_DAY))", 'if (false)'],
  ['S5 the script runs without the secret', 'script', 'if (!SECRET) fail(', 'if (false) fail('],
  ['S6 a 401 is not recognised', 'script', "if (r.status === 401) m.error =", 'if (false) m.error ='],
  ['S7 a body that does not echo the date is accepted', 'script', 'if (j.date !== DATE) {', 'if (false) {'],
  ['S8 every sport is required, not only CFB', 'script', 'm.failed = REQUIRED.filter(', 'm.failed = SPORTS.filter('],
  ['S9 a non-JSON body is no longer an error', 'script', 'm.error = `non-JSON body (${t.length} bytes): ${t.slice(0, 200)}`;', 'void 0;'],
  ['S10 a JSON body that is not an object is skipped silently (the original exit-0 path)', 'script', 'if (!m.error) m.error = `body is not a JSON object', 'if (false) m.error = `body is not a JSON object'],
  ['S11 a non-200 status is not an error by itself', 'script', 'else if (r.status !== 200) m.error =', 'else if (false) m.error ='],
  ['S12 a thrown fetch is swallowed', 'script', '} catch (e) { m.error = redact(e.message || e); }', '} catch (e) { }'],
  ['S13 the secret is not redacted from an error', 'script', "const redact = (text) => String(text).split(SECRET).join('[redacted]');", 'const redact = (text) => String(text);'],
  ['S14 the raw report is not kept in the artifact', 'script', 'm.report = j;', 'void 0;'],
  ['S15 the classifier is given the clock as 0', 'script', 'const now = Date.now();', 'const now = 0;'],
  ['S16 the date pattern is not anchored', 'script', '/^\\d{4}-\\d{2}-\\d{2}$/.test(DATE)', '/\\d{4}-\\d{2}-\\d{2}/.test(DATE)'],
  ['S17 "answered" is the length of the request list', 'script', 'm.report && m.report.sports && m.report.sports[sp] !== undefined', 'true'],
  ['S18 "measured" is the length of the request list', 'script', 'm.verdict[sp] !== undefined && !isRefusal(m.verdict[sp])', 'true'],
  ['S19 a measured join failure no longer fails the run (refusals only)', 'script', 'REQUIRED.filter(sp => failsRun(m.verdict[sp]))', 'REQUIRED.filter(sp => isRefusal(m.verdict[sp]))'],
];

let missed = 0, nothing = 0, errored = 0;
for (const [name, where, anchor, repl] of MUTANTS) {
  const src = where === 'lib' ? lib0 : script0;
  const count = src.split(anchor).length - 1;
  if (count !== 1) {
    nothing++;
    console.log(`NOTHING MUTATED  ${name}\n        the anchor occurs ${count} times in the ${where}, not once`);
    continue;
  }
  const tag = name.slice(0, 3).trim();
  let verdict;
  if (where === 'lib') {
    const l = put('scripts/lib', src.replace(anchor, () => repl), tag);
    const s = put('scripts', script0.replace(IMPORT, `from './lib/${l.split('/').pop()}';`), `${tag}s`);
    verdict = run(s, l);
  } else {
    const s = put('scripts', src.replace(anchor, () => repl), tag);
    verdict = run(s, LIB);
  }
  const label = verdict === 'red' ? 'CAUGHT    ' : verdict === 'pass' ? 'NOT CAUGHT' : 'HARNESS ERROR (no assertion failed; a crash is not a catch)';
  console.log(`${label}  ${name}`);
  if (verdict === 'pass') missed++;
  if (verdict === 'error') errored++;
}
const caughtN = MUTANTS.length - missed - nothing - errored;
console.log(`\nmutations: ${caughtN} of ${MUTANTS.length} caught${missed ? `, ${missed} SURVIVED` : ''}${errored ? `, ${errored} harness error(s)` : ''}${nothing ? `, ${nothing} not applied` : ''}`);
console.log('COVERAGE: the classifier (every branch, every shape and arithmetic guard), the exit rule, the weekday, and the script\'s credential, date, weekday, secret, redaction, status, body, clock and coverage handling.');
console.log('NOT mutated: the workflows that call the script (scripts/check-saturday-probe-workflow.mjs reads them).');
process.exit(missed || nothing || errored ? 1 : 0);
