// The generator must bump GENERATED_AT when the provenance CHANGES, and leave
// it alone when it does not.
//
// Both halves matter and they fail in opposite directions:
//   always bump  -> a timestamp-only diff on a deploy-trigger path, committed
//                   with the skip directive, so the deploy never runs. Measured
//                   2026-09-22: undeployed-src-watch red 29.2h over two such
//                   commits, and the watch itself filed as a NEW dead cron.
//   never bump   -> a real manifest change ships under the previous stamp, and
//                   X-FIELD-Manifest stops identifying which manifest answered.
//
// END TO END, against the real script, on a COPY of the tree's file. It does not
// re-implement the generator's logic — a check that re-derives its subject
// verifies the copy.
import { readFileSync, writeFileSync, copyFileSync, unlinkSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const F = 'src/route-provenance.js';
const BAK = '/tmp/.provenance-stability-backup.js';
const STAMP = /^export const ROUTE_PROVENANCE_GENERATED_AT = "(.*)";$/m;

let bad = 0, n = 0;
const check = (label, cond, detail = '') => { n++;
  if (cond) console.log(`ok    ${label}`);
  else { bad++; console.log(`FAIL  ${label}${detail ? `\n        ${detail}` : ''}`); } };

const gen = () => execFileSync(process.execPath, ['scripts/build-route-provenance.mjs'],
  { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
const stampOf = () => (readFileSync(F, 'utf8').match(STAMP) || [])[1] || null;

copyFileSync(F, BAK);
try {
  const before = stampOf();
  check('the committed file carries a readable stamp', before !== null, `no stamp matched in ${F}`);

  gen();
  check('REGENERATING UNCHANGED PROVENANCE KEEPS THE STAMP', stampOf() === before,
    `was ${before}, now ${stampOf()} — this is the timestamp-only diff that bumps a deploy path`);
  check('...and leaves the file byte-identical',
    readFileSync(F, 'utf8') === readFileSync(BAK, 'utf8'));

  // Now make the provenance genuinely different and require a new stamp. The
  // edit is to the MANIFEST BODY, not the stamp line, so only a real content
  // change is being tested.
  const doctored = readFileSync(BAK, 'utf8').replace(
    /export const ROUTE_PROVENANCE = \{\n/,
    'export const ROUTE_PROVENANCE = {\n  "/__stability_probe__": { k: "probe", s: null },\n');
  check('the doctored fixture really differs from the committed file',
    doctored !== readFileSync(BAK, 'utf8'), 'the anchor did not match — NOTHING WAS CHANGED');
  writeFileSync(F, doctored);

  gen();
  check('A REAL CHANGE BUMPS THE STAMP', stampOf() !== before,
    `stamp stayed ${stampOf()} across a content change — X-FIELD-Manifest would stop identifying the manifest`);
  check('...and the probe entry is gone, so the regenerated file is the real one',
    !readFileSync(F, 'utf8').includes('__stability_probe__'));
} finally {
  copyFileSync(BAK, F);
  try { unlinkSync(BAK); } catch (_e) {}
}

console.log(`\n${n - bad}/${n} checks passed`);
console.log('COVERAGE: the stamp’s stability and its bump, end to end against the real');
console.log('generator. It does NOT check what the manifest CONTAINS — check-route-');
console.log('provenance.mjs is the gate for that — and it restores the file either way.');
process.exit(bad ? 1 : 0);
