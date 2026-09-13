#!/usr/bin/env node
// Rule 90 for scripts/check-ambiguous-team-identity.mjs.
//
// N1 is the one that matters: it restores the old builder exactly as it shipped
// — last write wins — and must take `Tigers` back to hullcity.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';

const CHECK = 'scripts/check-ambiguous-team-identity.mjs';
const RESOLVER = 'src/identity-resolver.js';
const JOIN = 'src/odds-join.js';
const sh = (c, a, t = 120000) => execFileSync(c, a, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: t });

for (const f of [RESOLVER, JOIN]) {
  const dirty = sh('git', ['status', '--porcelain', '--', f]).trim();
  if (dirty) { console.error(`FAIL — ${f} is dirty; refusing to mutate.\n${dirty}`); process.exit(1); }
}

const MUTATIONS = [
  { file: RESOLVER,
    name: 'N1  the old builder returns — last write wins, Tigers is Hull again',
    anchor: `        if (k in strip && strip[k] !== v) {
            (ambiguous[k] || (ambiguous[k] = new Set([strip[k]]))).add(v);
            continue;
        }`,
    replace: '        // collision detection removed',
    expect: 'A tigers is recorded ambiguous' },
  { file: RESOLVER,
    name: 'N2  an ambiguous key stays in the map, so it silently names one club',
    anchor: '        delete strip[k];',
    replace: '        void 0;',
    expect: 'A an ambiguous name resolves to its own fold' },
  { file: RESOLVER,
    name: 'N3  the payload is ignored — context stops deciding',
    anchor: '    const present = options.filter(o => availableKeys.has(o));',
    replace: '    const present = options.slice(0, 1);',
    expect: 'B Tigers in a football payload is Hull' },
  { file: RESOLVER,
    name: 'N4  two present candidates pick the first instead of refusing',
    anchor: '    return present.length === 1 ? present[0] : resolveTeamKey(name);',
    replace: '    return present.length >= 1 ? present[0] : resolveTeamKey(name);',
    expect: 'B both present refuses to pick' },
  { file: JOIN,
    name: 'N5  the real join resolves a row without consulting the payload',
    anchor: `  const hk = resolveTeamKeyIn(home, index.vendorKeys);
  const ak = resolveTeamKeyIn(away, index.vendorKeys);`,
    replace: `  const hk = resolveTeamKey(home);
  const ak = resolveTeamKey(away);`,
    expect: 'C the real D1 row finds its own game' },
  { file: JOIN,
    name: 'N7  the vendor key set stops being collected, so context is empty',
    anchor: '    vendorKeys.add(hk); vendorKeys.add(ak);',
    replace: '    void hk; void ak;',
    expect: 'C the real D1 row finds its own game' },
  { file: RESOLVER,
    name: 'N6  a second team quietly changes meaning alongside the fix',
    anchor: "        ['Braves',                 'Atlanta Braves'],",
    replace: "        ['Braves',                 'Milwaukee Brewers'],",
    expect: 'D "Braves" is unchanged' },
];

let bad = 0;
for (const m of MUTATIONS) {
  const before = fs.readFileSync(m.file, 'utf8');
  const hits = before.split(m.anchor).length - 1;
  if (hits !== 1) {
    bad++; console.error(`  ANCHOR  ${m.name}\n          anchor occurs ${hits} time(s) in ${m.file}, expected 1.`
                       + ` NOTHING WAS MUTATED — harness defect, not a result.`);
    continue;
  }
  fs.writeFileSync(m.file, before.replace(m.anchor, m.replace));
  if (!fs.readFileSync(m.file, 'utf8').includes(m.replace)) {
    bad++; console.error(`  NOTAPPLIED  ${m.name}`); sh('git', ['checkout', '--', m.file]); continue;
  }

  let out = '', code = 0;
  try { out = sh('node', [CHECK], 30000); }
  catch (e) { code = e.status ?? 1; out = `${e.stdout || ''}${e.stderr || ''}`; }
  sh('git', ['checkout', '--', m.file]);

  if (code === 0) { bad++; console.error(`  NOT CAUGHT  ${m.name}\n          the check still passed.`); }
  else if (!(out.match(/^FAIL {2}.*$/gm) || []).some(l => l.includes(m.expect))) {
    bad++; console.error(`  WRONG REASON  ${m.name}\n          failed, but no FAIL line mentioned "${m.expect}". Output:\n${out.slice(0, 900)}`);
  } else {
    const n = (out.match(/^FAIL {2}/gm) || []).length;
    console.log(`  caught  ${m.name}\n          by "${m.expect}" (${n} assertion(s) went red)`);
  }
}

for (const f of [RESOLVER, JOIN]) {
  const post = sh('git', ['status', '--porcelain', '--', f]).trim();
  if (post) { console.error(`FAIL — ${f} not restored:\n${post}`); process.exit(1); }
}
console.log(`\nran ${MUTATIONS.length} mutation(s) against ${CHECK}; each asserted its anchor unique`
          + ` and its effect present before the verdict; both sources restored clean`);
if (bad) { console.error(`FAIL — ${bad} mutation(s) not caught or not applied.`); process.exit(1); }
console.log('PASS');
