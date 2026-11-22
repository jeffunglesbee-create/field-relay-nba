#!/usr/bin/env node
// Rule 90 for scripts/run-odds-backfill-capped.mjs, judged by its --self-test, on a COPY (the tracked file is never written).
//
// The runner spends billed Odds credits and WRITES, so the mutations that matter are the ones that would spend more than the owner
// stated: R1 raises the cap, R3 stops enforcing the approved number, R9 lets a date be attempted twice, R11 lets a failure carry on. Each must go red by a NAMED check, and the harness
// asserts its own anchor is unique and applied before it reports anything: NOT CAUGHT with nothing mutated is worse than no test.
import { readFileSync, writeFileSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const F = 'scripts/run-odds-backfill-capped.mjs';
const TALLY = /^([1-9]\d*)\/\1 checks passed$/m;
const run = (at) => {
  let out;
  try { out = execFileSync(process.execPath, [at, '--self-test'], { stdio: 'pipe', encoding: 'utf8' }); }
  catch (e) { out = String(e.stdout === undefined ? '' : e.stdout); }
  return { pass: TALLY.test(out), out };
};

const FINAL = "const text = redact(JSON.stringify(rec, null, 2)) + '\\n';";
const FINAL_OFF = "const text = JSON.stringify(rec, null, 2) + '\\n';";
const MUTATIONS = [
  ['R1 the cap is raised to ninety sport-dates', 'export const CALL_CAP = 9;', 'export const CALL_CAP = 90;', 'S5'],
  ['R2 a call is priced at 3 credits, not 30', 'export const CREDITS_PER_CALL = 30;', 'export const CREDITS_PER_CALL = 3;', 'S33'],
  ['R3 the approved number is not enforced', 'if (cost > approved) return', 'if (false) return', 'S11'],
  ['R4 a non-numeric approval is accepted', "if (!/^[1-9]\\d*$/.test(approvedText))", 'if (false)', 'S13'],
  ['R5 a date named twice is allowed', 'if (new Set(dates).size !== dates.length)', 'if (false)', 'S6'],
  ['R6 several sports are allowed in one run', "if (sport.includes(','))", 'if (false)', 'S7'],
  ['R7 no secret is allowed', "if (secret === '')", 'if (false)', 'S8'],
  ['R8 a date that is not on the calendar is allowed', 'if (Number.isNaN(t.getTime()) || t.toISOString().slice(0, 10) !== d)', 'if (false)', 'S9'],
  ['R9 a date already attempted is attempted again', 'if (repeats.length > 0) {', 'if (false) {', 'S14'],
  ['R10 the cap does not count the dates already attempted', 'if (done.length + p.dates.length > CALL_CAP) {', 'if (false) {', 'S15'],
  ['R11 a failure does not end the run', 'stoppedBecause = `${date}: ${rec.error}`; break; }', 'stoppedBecause = `${date}: ${rec.error}`; }', 'S17'],
  ['R12 the final redaction pass over the record is removed', FINAL, FINAL_OFF, 'S31'],
  ['R13 neither the non-200 path nor the final pass redacts', [['`HTTP ${r.status}: ${redact(text).slice(0, 200)}`', '`HTTP ${r.status}: ${text.slice(0, 200)}`'], [FINAL, FINAL_OFF]], null, 'S19'],
  ['R14 a redirect is followed', "redirect: 'manual', ", '', 'S21'],
  ['R15 a 200 with ok false is read as a result', 'if (j.ok !== true) return', 'if (false) return', 'S23'],
  ['R16 the date echo is not checked', 'if (j.date !== date) return', 'if (false) return', 'S24'],
  ['R17 the sport echo is not checked', 'if (j.sport !== sport) return', 'if (false) return', 'S25'],
  ['R18 a route that stopped itself is read as a result', 'if (j.stopped !== undefined) return', 'if (false) return', 'S26'],
  ['R19 games found and none populated does not end the run', 'if (j.games_found > 0 && j.odds_populated === 0) return', 'if (false) return', 'S27'],
  ['R20 a date with no games found is charged', '&& rec.result.games_found > 0) charged', ') charged', 'S28'],
  ['R21 the answer is not echoed to the run log', 'log(`--- ${file}\\n${text}`);', '', 'S4'],
  ['R22 neither a thrown fetch error nor the final pass redacts', [['catch (e) { rec.error = redact(e.message === undefined ? e : e.message); }', 'catch (e) { rec.error = e.message === undefined ? e : e.message; }'], [FINAL, FINAL_OFF]], null, 'S30'],
  ['R23 the denominator is the request list, not the calls made', 'called ${attempted} of', 'called ${p.dates.length} of', 'S18'],
  ['R24 a stopped run does not say it stopped', 'if (stoppedBecause !== null) log(', 'if (false) log(', 'S18'],
  ['R25 the ledger does not recognise a result file', "n.endsWith('.json'))", "n.endsWith('.jsonx'))", 'S14'],
  ['R26 a body that is not JSON is read as a result', 'if (rec.error === null) {', 'if (true) {', 'S22'],
  ['R27 the sport is not sent', '&sport=${encodeURIComponent(p.sport)}`', '`', 'S2'],
  ['R28 the credential is not sent', 'Authorization: `Bearer ${p.secret}`', "Authorization: 'none'", 'S2'],
];

const TMP = realpathSync(mkdtempSync(join(tmpdir(), 'mutate-run-backfill-')));
process.on('exit', () => rmSync(TMP, { recursive: true, force: true }));
const COPY = join(TMP, 'runner.mjs');
const ORIG = readFileSync(F, 'utf8');
writeFileSync(COPY, ORIG);
if (!run(COPY).pass) { console.log(`FAIL: the UNMUTATED copy of ${F} is red`); process.exit(1); }
console.log('positive control: the unmutated copy passes\n');

let failed = 0;
for (const [name, from, to, expect] of MUTATIONS) {
  const pairs = Array.isArray(from) ? from : [[from, to]];
  const counts = pairs.map(([f]) => ORIG.split(f).length - 1);
  if (counts.some(n => n !== 1)) { console.log(`FAIL  ${name}: anchor found ${counts.join('/')} times, must be exactly once each, nothing mutated`); failed++; continue; }
  let mutated = ORIG;
  for (const [f, t] of pairs) mutated = mutated.replace(f, () => t);
  if (mutated === ORIG) { console.log(`FAIL  ${name}: replacement changed nothing`); failed++; continue; }
  writeFileSync(COPY, mutated);
  const r = run(COPY);
  const named = new RegExp(`^FAIL  ${expect} `, 'm').test(r.out);
  if (r.pass) { console.log(`FAIL  ${name}: NOT CAUGHT`); failed++; }
  else if (!named) { console.log(`FAIL  ${name}: red, but not by ${expect}`); failed++; }
  else console.log(`ok    ${name}: caught by ${expect}`);
  writeFileSync(COPY, ORIG);
}
console.log(`\n${MUTATIONS.length - failed} of ${MUTATIONS.length} mutations caught, each by its named check`);
process.exit(failed ? 1 : 0);
