#!/usr/bin/env node
// Rule 90 for scripts/run-odds-backfill-capped.mjs, judged by its --self-test, on a COPY (the tracked file is never written).
//
// The runner spends billed Odds credits and WRITES, so the mutations that matter are the ones that would spend more than the owner
// stated: R1 raises the cap, R3 stops enforcing the approved number, R9 lets a date be attempted twice, R11 lets a failure carry on, R28 and R29 skip or fool the preflight (a relay that ignores ?sport= would fetch every sport). Each must go red by a NAMED check, and the harness
// asserts its own anchor is unique and applied before it reports anything: NOT CAUGHT with nothing mutated is worse than no test.
import { readFileSync, writeFileSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const F = 'scripts/run-odds-backfill-capped.mjs';
const TALLY = /^([1-9]\d*)\/\1 checks passed$/m;
const run = (at) => {
  let out;
  try { out = execFileSync(process.execPath, [at, '--self-test'], { stdio: 'pipe', encoding: 'utf8', timeout: 120000 }); }
  catch (e) { out = String(e.stdout === undefined ? '' : e.stdout); }
  return { pass: TALLY.test(out), out };
};

const FINAL = "const text = redact(JSON.stringify(rec, null, 2)) + '\\n';";
const FINAL_OFF = "const text = JSON.stringify(rec, null, 2) + '\\n';";
const ONE_PLACE = 'if (rec.error !== null) rec.error = redact(rec.error);';
// R26 of the first version ("a body that is not JSON is read as a result") was removed: judge() rejects a null body on its own, so
// the mutant behaved the same and only changed a message. An equivalent mutant proves nothing (a second review, 2026-11-22).
const MUTATIONS = [
  ['R1 the cap is raised to ninety sport-dates', 'export const CALL_CAP = 9;', 'export const CALL_CAP = 90;', 'S5'],
  ['R2 a call is priced at 3 credits, not 30', 'export const CREDITS_PER_CALL = 30;', 'export const CREDITS_PER_CALL = 3;', 'S3'],
  ['R3 the approved number is not enforced', 'if (cost > approved) return', 'if (false) return', 'S11'],
  ['R4 a non-numeric approval is accepted', "if (!/^[1-9]\\d*$/.test(approvedText))", 'if (false)', 'S13'],
  ['R5 a date named twice is allowed', 'if (new Set(dates).size !== dates.length)', 'if (false)', 'S6'],
  ['R7 no secret is allowed', "if (secret === '')", 'if (false)', 'S8'],
  ['R8 a date that is not on the calendar is allowed', 'if (Number.isNaN(t.getTime()) || t.toISOString().slice(0, 10) !== d)', 'if (false)', 'S9'],
  ['R9 a date already attempted is attempted again', 'if (repeats.length > 0) {', 'if (false) {', 'S14'],
  ['R11 a failure does not end the run', 'stoppedBecause = `${date}: ${rec.error}`; break; }', 'stoppedBecause = `${date}: ${rec.error}`; }', 'S17'],
  ['R12 the final redaction pass over the record is removed', FINAL, FINAL_OFF, 'S31'],
  ['R13 neither the one place that redacts an error nor the final pass', [[ONE_PLACE, ''], [FINAL, FINAL_OFF]], null, 'S19'],
  ['R14 a redirect is followed', "redirect: 'manual', ", '', 'S21'],
  ['R15 a 200 with ok false is read as a result', 'if (j.ok !== true) return', 'if (false) return', 'S23'],
  ['R16 the date echo is not checked', 'if (j.date !== date) return', 'if (false) return', 'S24'],
  ['R17 the sport echo is not checked', 'if (j.sport !== sport) return', 'if (false) return', 'S25'],
  ['R18 a route that stopped itself is read as a result', 'if (j.stopped !== undefined) return', 'if (false) return', 'S26'],
  ['R19 games found and none populated does not end the run', 'if (j.games_found > 0 && j.odds_populated === 0) return', 'if (false) return', 'S27'],
  ['R20 a date with no games found is charged', '&& rec.result.games_found > 0 && !(rec.result.guarded > 0)) charged', '&& !(rec.result.guarded > 0)) charged', 'S28'],
  ['R21 the answer is not echoed to the run log', 'log(`--- ${file}\\n${text}`);', '', 'S4'],
  ['R22 the error path no longer redacts (the final pass over the file still does): the log and the returned reason leak', [[ONE_PLACE, '']], null, 'S40'],
  ['R23 the denominator is the request list, not the calls made', 'called ${attempted} of', 'called ${p.dates.length} of', 'S18'],
  ['R24 a stopped run does not say it stopped', 'if (stoppedBecause !== null) log(', 'if (false) log(', 'S18'],
  ['R25 the ledger does not recognise a result file', "n.endsWith('.json'))", "n.endsWith('.jsonx'))", 'S14'],
  ['R26 the sport is not sent', '&sport=${encodeURIComponent(sport)}`', '`', 'S2'],
  ['R27 the credential is not sent', 'Authorization: `Bearer ${secret}`', "Authorization: 'none'", 'S2'],
  ['R28 the preflight is skipped', 'const refusedByPreflight = await preflight({ relay, secret: p.secret, fetchImpl, redact, timeoutMs });', 'const refusedByPreflight = null;', 'S36'],
  ['R29 the preflight takes a 200 (a relay that ignores ?sport=) as the filter working', "if (r.status === 400 && /unknown \\?sport=/.test(text)) return null;", 'if (r.status === 400 || r.status === 200) return null;', 'S36'],
  ['R30 the preflight takes any answer as the filter working', "if (r.status === 400 && /unknown \\?sport=/.test(text)) return null;", 'return null;', 'S37'],
  ['R31 the attempt is not written before the request', "writeFileSync(file, JSON.stringify({ ...rec, pending: true }, null, 2) + '\\n');", '', 'S45'],
  ['R32 the request has no timeout', 'signal: AbortSignal.timeout(timeoutMs), ', '', 'S46'],
  ['R33 a call with no clean answer is not counted', 'if (rec.result === null) noAnswer++;', '', 'S46'],
  ['R34 a credit-guard refusal is read as a spend that wrote nothing', "if (typeof j.guarded === 'number' && j.guarded > 0) return", 'if (false) return', 'S38'],
  ['R35 a credit-guard refusal is charged to the estimate', '&& rec.result.games_found > 0 && !(rec.result.guarded > 0)) charged', '&& rec.result.games_found > 0) charged', 'S38'],
  ['R36 an answer without counts is read as a result', "if (typeof j.games_found !== 'number' || typeof j.odds_populated !== 'number') return", 'if (false) return', 'S39'],
  ['R37 a sport label may carry a slash, dots or a comma (a list of sports)', "if (!/^[A-Za-z][A-Za-z0-9 ]{0,31}$/.test(sport))", 'if (false)', 'S7'],
  ['R38 the ledger is per spelling of the label, not per sport', ".toLowerCase().replace(/ /g, '-');", ';', 'S14'],
  ['R39 a space in the label is not dashed in the file name', ".replace(/ /g, '-');", ';', 'S44'],
  ['R43 PREFLIGHT_ONLY is ignored: the "free check" goes on to spend', "if (envText(env, 'PREFLIGHT_ONLY') === '1') {", 'if (false) {', 'S49'],
  ['R41 the JSON-escaped form of the secret is not redacted', 'JSON.stringify(p.secret).slice(1, -1)])', ']) ', 'S41'],
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
