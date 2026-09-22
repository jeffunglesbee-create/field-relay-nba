// Rule 90 for scripts/check-provenance-stamp-stability.mjs.
//
// The subject is the GENERATOR, and the check runs it by path — so mutants are
// written beside it and removed on exit, and a POSITIVE CONTROL runs an
// unmutated copy at the mutant location before any verdict is accepted. A
// harness that cannot run its subject reports every mutation as caught.
import { readFileSync, writeFileSync, unlinkSync, copyFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';

const SRC = 'scripts/build-route-provenance.mjs';
const CHECK = 'scripts/check-provenance-stamp-stability.mjs';
const original = readFileSync(SRC, 'utf8');
const checkSrc = readFileSync(CHECK, 'utf8');
const DIR = dirname(SRC);
const born = [];
process.on('exit', () => { for (const p of born) { try { unlinkSync(p); } catch (_e) {} } });

// The check invokes the generator by a hard-coded path, so a mutant has to take
// that path's place. The original is restored in `finally`, always.
const withMutant = (text, fn) => {
  const bak = join(DIR, `.provgen-backup-${Math.random().toString(36).slice(2, 8)}.mjs`);
  born.push(bak);
  copyFileSync(SRC, bak);
  try { writeFileSync(SRC, text); return fn(); }
  finally { copyFileSync(bak, SRC); }
};

const runCheck = () => {
  try { execFileSync(process.execPath, [CHECK], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }); return true; }
  catch { return false; }
};

if (!runCheck()) { console.log('FAIL — the check is already red on clean source.'); process.exit(1); }
if (!withMutant(original, runCheck)) {
  console.log('FAIL — an UNMUTATED copy written to the generator path is red, so no verdict below would mean anything.');
  process.exit(1);
}
console.log('baseline: the check passes on current source, and on an unmutated copy written to the same path\n');

const MUTATIONS = [
  ['P1 the stamp is regenerated every run — the shipped behaviour',
   '    if (keep) {',
   '    if (false) {',
   'THE DEFECT THIS FIXES: a timestamp-only diff on src/**, committed with the skip directive, so the deploy it triggers never runs. 29.2h of red across two commits, and the watch itself filed as a new dead cron'],

  ['P2 the stamp is frozen even when the provenance changes',
   '  if (committed !== null && stripStamp(committed) === stripStamp(out)) {',
   '  if (committed !== null) {',
   'THE OPPOSITE FAILURE: a real manifest change ships under the previous stamp and X-FIELD-Manifest stops identifying which manifest answered'],

  ['P3 the comparison includes the stamp, so nothing ever matches',
   '  const stripStamp = t => t.replace(/^export const ROUTE_PROVENANCE_GENERATED_AT = .*$/m, \'\');',
   '  const stripStamp = t => t;',
   'the old and new text always differ by the stamp itself, so the guard never fires and the bump returns — the checker strips it for exactly this reason'],
];

let caught = 0;
for (const [name, anchor, repl, why] of MUTATIONS) {
  const hits = original.split(anchor).length - 1;
  if (hits !== 1) { console.log(`FAIL       ${name}\n            anchor matched ${hits} times, expected 1 — NOTHING MUTATED.`); continue; }
  const mutated = original.replace(anchor, repl);
  if (mutated === original) { console.log(`FAIL       ${name}\n            file unchanged — NOTHING MUTATED.`); continue; }
  const red = !withMutant(mutated, runCheck);
  console.log(`${red ? 'CAUGHT    ' : 'NOT CAUGHT'} ${name}\n            (${why})`);
  if (red) caught++;
}

// The generator must be back exactly as it started, or this harness has done
// what it warns about.
const restored = readFileSync(SRC, 'utf8') === original;
console.log(`\n${caught} of ${MUTATIONS.length} mutations caught.`);
console.log(restored ? 'generator restored byte-for-byte' : 'FAIL — the generator was NOT restored');
console.log('COVERAGE: the keep-or-bump decision in the generator. It does NOT cover the');
console.log('manifest scan, the routes it finds, or what check-route-provenance.mjs gates.');
process.exit(caught === MUTATIONS.length && restored ? 0 : 1);
