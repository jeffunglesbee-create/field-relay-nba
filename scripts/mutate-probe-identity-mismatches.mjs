#!/usr/bin/env node
// Rule 90 for scripts/probe-identity-mismatches.mjs, judged by its --self-test, on a COPY (the tracked file is never written).
//
// The probe spends billed Odds credits, so the mutations that matter are the ones that would spend more than was approved:
// M1 raises the cap, M5 lets a failure carry on, M9 retries every date. Each must go red by a NAMED check, and the harness
// asserts its own anchor is unique and applied before it reports anything: NOT CAUGHT with nothing mutated is worse than no test.
import { readFileSync, writeFileSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const F = 'scripts/probe-identity-mismatches.mjs';
const TALLY = /^([1-9]\d*)\/\1 checks passed$/m;
const run = (at) => {
  let out;
  try { out = execFileSync(process.execPath, [at, '--self-test'], { stdio: 'pipe', encoding: 'utf8' }); }
  catch (e) { out = String(e.stdout === undefined ? '' : e.stdout); }
  return { pass: TALLY.test(out), out };
};

const MUTATIONS = [
  ['M1 the cap is raised to thirty calls', 'export const CALL_CAP = 3;', 'export const CALL_CAP = 30;', 'S4'],
  ['M2 a date named twice is allowed', 'if (new Set(dates).size !== dates.length)', 'if (false)', 'S5'],
  ['M3 several sports are allowed in one call', "if (sport.includes(','))", 'if (false)', 'S6'],
  ['M4 no secret is allowed', "if (secret === '')", 'if (false)', 'S7'],
  ['M5 a malformed date is allowed', 'if (!/^\\d{4}-\\d{2}-\\d{2}$/.test(d))', 'if (false)', 'S8'],
  ['M6 a failure does not end the run', 'stoppedBecause = `${date}: ${rec.error}`; break; }', 'stoppedBecause = `${date}: ${rec.error}`; }', 'S9'],
  ['M7 the secret is not redacted', "const redact = (text) => String(text).split(p.secret).join('[redacted]');", 'const redact = (text) => String(text);', 'S10'],
  ['M8 a body that does not echo the date is read as a report', 'else if (j.date !== date)', 'else if (false)', 'S12'],
  ['M9 every date is requested twice (a retry)', 'for (const date of p.dates) {', 'for (const date of p.dates.flatMap(d => [d, d])) {', 'S1'],
  ['M10 a body that is not JSON is read as a report', 'if (rec.error === null) {', 'if (true) {', 'S13'],
  ['M11 the request names two sports', '&sports=${encodeURIComponent(p.sport)}`', '&sports=${encodeURIComponent(p.sport)},MLS`', 'S2'],
  ['M12 the credential is not sent', 'Authorization: `Bearer ${p.secret}`', "Authorization: 'none'", 'S2'],
  ['M13 the denominator is the request list, not the calls made', 'called ${attempted} of', 'called ${p.dates.length} of', 'S16'],
  ['M14 a stopped run does not say it stopped', 'if (stoppedBecause !== null) log(', 'if (false) log(', 'S16'],
];

const TMP = realpathSync(mkdtempSync(join(tmpdir(), 'mutate-probe-idm-')));
process.on('exit', () => rmSync(TMP, { recursive: true, force: true }));
const COPY = join(TMP, 'probe.mjs');
const ORIG = readFileSync(F, 'utf8');
writeFileSync(COPY, ORIG);
if (!run(COPY).pass) { console.log(`FAIL: the UNMUTATED copy of ${F} is red`); process.exit(1); }
console.log('positive control: the unmutated copy passes\n');

let failed = 0;
for (const [name, from, to, expect] of MUTATIONS) {
  const n = ORIG.split(from).length - 1;
  if (n !== 1) { console.log(`FAIL  ${name}: anchor found ${n} times, must be exactly once, nothing mutated`); failed++; continue; }
  const mutated = ORIG.replace(from, () => to);
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
