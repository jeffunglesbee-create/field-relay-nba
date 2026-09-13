#!/usr/bin/env node
// Rule 90 for scripts/check-identity-table-collisions.mjs.
//
// P1 is the one that matters. The whole point of a census over a curated list is
// that it finds a collision nobody anticipated — so the mutation introduces one
// in a table that has never had one, in a sport unrelated to the bug that
// prompted this, and the check must find it without being told.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';

const CHECK = 'scripts/check-identity-table-collisions.mjs';
const RESOLVER = 'src/identity-resolver.js';
const sh = (c, a, t = 60000) => execFileSync(c, a, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: t });

const dirty = sh('git', ['status', '--porcelain', '--', RESOLVER]).trim();
if (dirty) { console.error(`FAIL — ${RESOLVER} is dirty; refusing to mutate.\n${dirty}`); process.exit(1); }

const MUTATIONS = [
  { name: 'P1  a brand-new collision in the MLS club table, unrelated to Tigers',
    anchor: "        ['Austin FC',                   'MLS-CLU-000003'],",
    replace: "        ['Austin FC',                   'MLS-CLU-000003'],\n        ['LA Galaxy',                   'MLS-CLU-999999'],",
    expect: 'lagalaxy' },
  { name: 'P2  a second MLB nickname collides',
    anchor: "        ['Braves',                 'Atlanta Braves'],",
    replace: "        ['Braves',                 'Atlanta Braves'],\n        ['Braves',                 'Milwaukee Brewers'],",
    expect: 'braves' },
  { name: 'P3  the allow-list stops excusing only the recorded key',
    file: CHECK,
    anchor: "const ALLOWED = new Set(['tigers']);",
    replace: "const ALLOWED = new Set(['tigers', 'braves']);",
    expect: null,   // must NOT go red on clean source — see below
    expectPass: true },
];

let bad = 0;
for (const m of MUTATIONS) {
  const file = m.file || RESOLVER;
  const before = fs.readFileSync(file, 'utf8');
  const hits = before.split(m.anchor).length - 1;
  if (hits !== 1) {
    bad++; console.error(`  ANCHOR  ${m.name}\n          anchor occurs ${hits} time(s) in ${file}, expected 1.`
                       + ` NOTHING WAS MUTATED — harness defect, not a result.`);
    continue;
  }
  fs.writeFileSync(file, before.replace(m.anchor, m.replace));
  if (!fs.readFileSync(file, 'utf8').includes(m.replace)) {
    bad++; console.error(`  NOTAPPLIED  ${m.name}`); sh('git', ['checkout', '--', file]); continue;
  }

  let out = '', code = 0;
  try { out = sh('node', [CHECK]); }
  catch (e) { code = e.status ?? 1; out = `${e.stdout || ''}${e.stderr || ''}`; }
  sh('git', ['checkout', '--', file]);

  if (m.expectPass) {
    // Widening the allow-list alone must NOT go red: a collision that is not
    // there cannot be excused. If this went red the check would be asserting on
    // its own configuration rather than on the tables.
    if (code === 0) console.log(`  caught  ${m.name}\n          stayed green, as it must — an unused allowance is not a defect`);
    else { bad++; console.error(`  NOT CAUGHT  ${m.name}\n          went red on clean source.`); }
    continue;
  }
  if (code === 0) { bad++; console.error(`  NOT CAUGHT  ${m.name}\n          the check still passed.`); }
  else if (!out.includes(m.expect)) {
    bad++; console.error(`  WRONG REASON  ${m.name}\n          failed, but never named "${m.expect}". Output:\n${out.slice(0, 700)}`);
  } else {
    console.log(`  caught  ${m.name}\n          by naming "${m.expect}" as a SILENT OVERWRITE`);
  }
}

const post = sh('git', ['status', '--porcelain', '--', RESOLVER]).trim();
if (post) { console.error(`FAIL — ${RESOLVER} not restored:\n${post}`); process.exit(1); }
console.log(`\nran ${MUTATIONS.length} mutation(s) against ${CHECK}; each asserted its anchor unique`
          + ` and its effect present before the verdict; ${RESOLVER} restored clean`);
if (bad) { console.error(`FAIL — ${bad} mutation(s) not caught or not applied.`); process.exit(1); }
console.log('PASS');
