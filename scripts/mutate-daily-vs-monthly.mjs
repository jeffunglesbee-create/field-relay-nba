// Rule 90 for scripts/check-daily-vs-monthly.mjs.
//
// Mutants are placed BESIDE the original and deleted on exit, and a POSITIVE
// CONTROL runs an unmutated copy at the mutant location first — a harness in
// this project once wrote mutants to /tmp, where a relative import did not
// resolve, and read six dead imports as six caught mutations.
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, resolve, dirname } from 'node:path';

const SRC = 'scripts/lib/daily-vs-monthly.cjs';
const original = readFileSync(SRC, 'utf8');
const DIR = dirname(SRC);
const born = [];
const place = (text, tag) => {
  const p = join(DIR, `.mutant-${tag}-${Math.random().toString(36).slice(2, 8)}.cjs`);
  writeFileSync(p, text); born.push(p); return resolve(p);
};
process.on('exit', () => { for (const p of born) { try { unlinkSync(p); } catch (_e) {} } });

const run = (modulePath) => {
  try {
    execFileSync(process.execPath, ['scripts/check-daily-vs-monthly.mjs'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, DVM_MODULE: modulePath } });
    return true;
  } catch { return false; }
};

if (!run(resolve(SRC))) { console.log('FAIL — the self-test is already red on clean source.'); process.exit(1); }
if (!run(place(original, 'control'))) {
  console.log('FAIL — an UNMUTATED copy at the mutant location is red, so no verdict below would mean anything.');
  process.exit(1);
}
console.log('baseline: the self-test passes on current source and on an unmutated copy at the mutant location\n');

const MUTATIONS = [
  ['M1 partial edge days are counted, so the sum covers hours the window does not',
   '    return s !== null && s >= fromMs && s + DAY_MS <= toMs;',
   '    return s !== null;',
   'THE WHOLE POINT: 2026-09-18 opens before the first reading. Counting it adds a day of spend the monthly delta never saw, and manufactures an excess out of the window offset — the two-window substitution this module exists to avoid'],

  ['M2 the containment test drops its closing half',
   '    return s !== null && s >= fromMs && s + DAY_MS <= toMs;',
   '    return s !== null && s >= fromMs;',
   'a day that has not finished inside the span contributes a full day_used against a delta that stops mid-day'],

  ['M3 the check becomes two-sided',
   '  if (excess > FLOOR) return { ...base, verdict: \'daily-exceeds-monthly\' };',
   '  if (Math.abs(excess) > FLOOR) return { ...base, verdict: \'daily-exceeds-monthly\' };',
   'monthlyDelta > dailySum is EXPECTED — the delta holds the partial edge hours the contained days leave out — so a two-sided test is red on every healthy run and gets disabled'],

  ['M4 a missing monthly figure is coerced to zero',
   '  if (typeof m0 !== \'number\' || typeof m1 !== \'number\')',
   '  if (false)',
   'Number(null) is 0, so an unreadable reading would report the entire daily sum as excess — a fabricated maximum finding from an absent input (Rule 99)'],

  ['M5 a month reset reads as a colossal excess',
   '  if (monthlyDelta < 0)',
   '  if (false)',
   'the monthly key is per calendar month; on the 1st the delta is hugely negative and the excess would be the whole previous month, reported as a defect'],

  ['M6 an empty contained-day set sums to zero and passes as consistent',
   '  if (!days.length)',
   '  if (false)',
   'zero contained days would give dailySum 0, excess negative, verdict consistent — a green produced by measuring nothing at all'],

  ['M7 a too-short series is judged anyway',
   '  if (!Array.isArray(readings) || readings.length < 2)',
   '  if (!Array.isArray(readings) || readings.length < 0)',
   'one reading has no delta; judging it compares a day against a counter that never moved'],

  ['M8 out-of-order readings are accepted',
   '  if (!Number.isFinite(fromMs) || !Number.isFinite(toMs) || toMs <= fromMs)',
   '  if (!Number.isFinite(fromMs) || !Number.isFinite(toMs))',
   'a reversed span makes the monthly delta negative and the contained-day test nonsensical; it must be refused, not scored'],
];

let caught = 0;
for (const [name, anchor, repl, why] of MUTATIONS) {
  const hits = original.split(anchor).length - 1;
  if (hits !== 1) { console.log(`FAIL       ${name}\n            anchor matched ${hits} times, expected 1 — NOTHING MUTATED.`); continue; }
  const mutated = original.replace(anchor, repl);
  if (mutated === original) { console.log(`FAIL       ${name}\n            file unchanged — NOTHING MUTATED.`); continue; }
  const path = place(mutated, 'm');
  if (readFileSync(path, 'utf8') === original) { console.log(`FAIL       ${name}\n            the written copy is identical — NOTHING MUTATED.`); continue; }
  const red = !run(path);
  console.log(`${red ? 'CAUGHT    ' : 'NOT CAUGHT'} ${name}\n            (${why})`);
  if (red) caught++;
}

console.log(`\n${caught} of ${MUTATIONS.length} mutations caught.`);
console.log('COVERAGE: dailyVsMonthly and containedDays — 2 functions, 1 file. It does');
console.log('NOT cover the watch script that reads the relay, nor whether the counters');
console.log('it compares are themselves correct.');
process.exit(caught === MUTATIONS.length ? 0 : 1);
