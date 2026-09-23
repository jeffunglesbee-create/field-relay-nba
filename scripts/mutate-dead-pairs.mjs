// Rule 90 for scripts/check-dead-pairs.mjs.
//
// This module decides what NOT to buy. Both ways of being wrong cost: re-buying
// a pair that cannot pay is 20 credits every run forever, and locking out a
// pair a matcher fix would recover is a game that never gets priced. So the
// expiry rules matter as much as the classification, and M4-M6 exist for them.
//
// Mutants are placed BESIDE the original and deleted on exit, and a POSITIVE
// CONTROL runs an unmutated copy at the mutant location first.
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, resolve, dirname } from 'node:path';

const SRC = 'scripts/lib/dead-pairs.cjs';
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
    execFileSync(process.execPath, ['scripts/check-dead-pairs.mjs'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, DEAD_PAIRS_MODULE: modulePath } });
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
  ['D1 priced-zero is filed as a vendor gap',
   "  'priced-zero':    'matcher',",
   "  'priced-zero':    'vendor',",
   'THE ONE THAT LOSES GAMES SILENTLY: 2026-09-12 cfb had 80 events in window and priced none — our reading failed, their data did not. As a vendor class it would survive every matcher fix and never be bought again. The first version of this mutation ADDED the class to a second set while leaving it in the first, changed nothing, and read as NOT CAUGHT — which is how the two-set shape was found and replaced with one mapping'],

  ['D2 the pool counts as exhausted while in-window events are still unused',
   '  if (inWindow <= priced) return \'pool-exhausted\';',
   '  if (inWindow >= priced) return \'pool-exhausted\';',
   'every partial pair would be declared dead, including 2026-09-05 cfb which is one game short of complete'],

  ['D3 a vendor with nothing is reported as a window problem',
   '  if (events === 0) return \'no-events\';',
   '  if (events === 0) return \'none-in-window\';',
   'the two expire differently — an empty vendor stays empty when our matcher changes, a window miss does not — so merging them makes the expiry wrong in one direction or the other'],

  ['D4 THE EXPIRY IS DROPPED: a matcher-dependent exclusion becomes permanent',
   "  if (kind === 'matcher' && row.matcher_fp !== now.matcher_fp) return false;",
   '  if (false) return false;',
   'this is the whole reason the ledger records the code it was measured under. Without it, fixing the matcher leaves the pairs it would have recovered locked out forever, with nothing saying why'],

  ['D5 a different request shape reuses the old answer',
   '  if (row.params_fp !== now.params_fp) return false;',
   '  if (false) return false;',
   'a run with different regions or markets is asking a different question; answering it from the old one skips pairs that were never tested under the new parameters'],

  ['D6 a partial pair is treated as dead',
   '  if (kind === null) return false;',
   '  if (false) return false;',
   'partial and complete rows would exclude their own pairs, so a pair one game short of done would never be finished'],

  ['D7 an unreadable attempt becomes a dead pair',
   "    if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) return 'unknown';",
   "    if (false) return 'unknown';",
   'a malformed row would classify by arithmetic on strings and undefined, and a pair could be excluded on a measurement that never happened (Rule 99)'],

  ['D8 the ledger key drops the date',
   'const pairKey = (sport, date) => `${String(date)}\\t${String(sport).toLowerCase()}`;',
   'const pairKey = (sport, date) => `${String(sport).toLowerCase()}`;',
   'one dead NFL date would exclude every NFL date, and the plan would lose whole sports at a time'],

  ['D9 the key stops normalising case',
   'const pairKey = (sport, date) => `${String(date)}\\t${String(sport).toLowerCase()}`;',
   'const pairKey = (sport, date) => `${String(date)}\\t${String(sport)}`;',
   'the plan lowercases its sport and the log does not, so the ledger would silently never match and every exclusion would be a no-op that still reads as working'],

  ['D10 completion is decided by equality instead of sufficiency',
   '  if (priced >= wanted) return \'complete\';',
   '  if (priced === wanted) return \'complete\';',
   'a pair that priced more than it wanted falls through to the dead branches and gets excluded for having done too well'],
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
console.log('COVERAGE: classifyPair, stillDead, excludeDead and pairKey — 4 functions,');
console.log('1 file. It does NOT cover the fill script that writes and reads the ledger.');
process.exit(caught === MUTATIONS.length ? 0 : 1);
