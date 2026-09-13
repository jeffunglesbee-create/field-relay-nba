#!/usr/bin/env node
// Rule 90 for the partial-read flag
// (CC-CMD-2026-09-12-route-provenance-truncation-invisible).
//
// The defect was a flag that was SET correctly and never READ. So the mutations
// break the wiring at each point it could break again — the scanner setting it,
// the builder carrying it, the builder emitting it — and each must turn
// check-route-provenance.mjs red on the partial-read assertion specifically.
//
// M1 is the one that matters: it shrinks the scan window so MORE routes
// truncate, which is a forced truncation rather than a deleted flag. If the
// manifest is regenerated the new ones must carry t: 1; if it is not, the gate's
// scanner-vs-manifest comparison must catch the disagreement. Either way the
// partial read cannot pass as a whole one.

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';

const sh = (c, a, timeout = 120000) =>
  execFileSync(c, a, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout });

const FILES = ['scripts/lib/route-scan.mjs', 'scripts/build-route-provenance.mjs', 'src/route-provenance.js'];
const dirty = sh('git', ['status', '--porcelain', '--', ...FILES]).trim();
if (dirty) { console.error(`FAIL — refusing to mutate, these are dirty:\n${dirty}`); process.exit(1); }

const ASSERTION = 'every partial read says so';

const MUTATIONS = [
  { file: 'scripts/lib/route-scan.mjs',
    name: 'M1  the window shrinks to 200 lines — many more routes truncate',
    anchor: '  const WINDOW = 1500;',
    replace: '  const WINDOW = 200;',
    why: 'a forced truncation, not a deleted flag: the manifest on disk now under-reports partial reads' },
  { file: 'scripts/lib/route-scan.mjs',
    name: 'M2  the scanner stops setting the flag',
    anchor: "             via: 'inline', resolved: true, truncated: true };",
    replace: "             via: 'inline', resolved: true };",
    why: 'the manifest still says t:1 for two routes the scanner now calls whole' },
  { file: 'scripts/build-route-provenance.mjs',
    name: 'M3  the builder stops carrying the flag through the merge',
    anchor: '    truncated: !!(prev && prev.truncated) || !!b.truncated,',
    replace: '    truncated: false,',
    why: 'set correctly, dropped in transit — the original defect exactly' },
  { file: 'scripts/build-route-provenance.mjs',
    name: 'M4  the builder stops emitting t: 1',
    anchor: "${v.match === 'prefix' ? ', p: 1' : ''}${v.truncated ? ', t: 1' : ''} },`",
    replace: "${v.match === 'prefix' ? ', p: 1' : ''} },`",
    why: 'carried all the way and then not written down' },
];

let bad = 0;
for (const m of MUTATIONS) {
  const before = fs.readFileSync(m.file, 'utf8');
  const hits = before.split(m.anchor).length - 1;
  if (hits !== 1) {
    bad++; console.error(`  ANCHOR  ${m.name}\n          anchor occurs ${hits} time(s) in ${m.file}, expected 1. NOTHING WAS MUTATED — harness defect, not a result.`);
    continue;
  }
  fs.writeFileSync(m.file, before.replace(m.anchor, m.replace));
  if (!fs.readFileSync(m.file, 'utf8').includes(m.replace)) {
    bad++; console.error(`  NOTAPPLIED  ${m.name}`); sh('git', ['checkout', '--', ...FILES]); continue;
  }

  // M3 and M4 only show up once the manifest is rebuilt from the mutated
  // builder; M1 and M2 show up against the manifest already on disk. Rebuild
  // for the builder mutations so each is tested where it actually bites.
  if (m.file === 'scripts/build-route-provenance.mjs') {
    try { sh('node', ['scripts/build-route-provenance.mjs']); } catch (_) { /* the gate reports it */ }
  }

  let out = '', code = 0;
  try { out = sh('node', ['scripts/check-route-provenance.mjs']); }
  catch (e) { code = e.status ?? 1; out = `${e.stdout || ''}${e.stderr || ''}`; }
  sh('git', ['checkout', '--', ...FILES]);

  if (code === 0) { bad++; console.error(`  NOT CAUGHT  ${m.name}\n          the gate still passed. ${m.why}`); }
  else if (!out.includes(ASSERTION)) {
    bad++; console.error(`  WRONG REASON  ${m.name}\n          failed, but not on "${ASSERTION}". Output:\n${out.slice(0, 1200)}`);
  } else {
    const red = (out.match(new RegExp(`^\\\\s*(FAIL|✗|x)\\\\s+.*${ASSERTION}.*$`, 'm')) || [])[0];
    console.log(`  caught  ${m.name}\n          by "${ASSERTION}"${red ? `\n          ${red.trim().slice(0, 150)}` : ''}`);
  }
}

// The manifest must be byte-identical to HEAD after all this, or a rebuild from
// a mutated builder leaked into the tree.
const post = sh('git', ['status', '--porcelain', '--', ...FILES]).trim();
if (post) { console.error(`FAIL — not restored:\n${post}`); process.exit(1); }

console.log(`\nran ${MUTATIONS.length} mutation(s) against scripts/check-route-provenance.mjs, breaking the `
          + `set / carry / emit wiring at each point; each asserted its anchor unique and its effect `
          + `present before the verdict; all ${FILES.length} files restored clean`);
if (bad) { console.error(`FAIL — ${bad} mutation(s) not caught or not applied.`); process.exit(1); }
console.log('PASS');
