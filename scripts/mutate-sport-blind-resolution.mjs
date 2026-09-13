#!/usr/bin/env node
// Rule 90 for scripts/check-sport-blind-resolution.mjs.
//
// S1 restores the defect exactly as it shipped — the alias returned whether or
// not the payload contains it — and must put an MLS club back into a CFB join.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';

const CHECK = 'scripts/check-sport-blind-resolution.mjs';
const RESOLVER = 'src/identity-resolver.js';
const sh = (c, a, t = 60000) => execFileSync(c, a, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: t });

const d = sh('git', ['status', '--porcelain', '--', RESOLVER]).trim();
if (d) { console.error(`FAIL — ${RESOLVER} is dirty; refusing to mutate.\n${d}`); process.exit(1); }

const MUTATIONS = [
  { file: RESOLVER,
    name: 'S1  the defect returns — the alias is used regardless of the payload',
    anchor: `    const alias = resolveTeamKey(name);
    if (availableKeys.has(alias)) return alias;
    return foldTeamName(name);`,
    replace: '    return resolveTeamKey(name);',
    expect: 'A Colorado in an NCAAF payload is a place' },
  { file: RESOLVER,
    name: 'S2  the fallback names a club instead of the row\'s own text',
    anchor: '    return foldTeamName(name);\n}',
    replace: '    return resolveTeamKey(name);\n}',
    expect: 'C no MLS or WNBA key reaches an NCAAF join' },
  { file: RESOLVER,
    name: 'S3  the payload check is inverted — the club is used only when absent',
    anchor: '    if (availableKeys.has(alias)) return alias;',
    replace: '    if (!availableKeys.has(alias)) return alias;',
    expect: 'B Colorado is coloradorapids in MLS' },
  { file: RESOLVER,
    name: 'S4  the standalone resolver is changed too, breaking the bridging callers',
    anchor: "function resolveTeamKey(name) {\n    return resolveEntity('team', name);",
    replace: "function resolveTeamKey(name) {\n    return foldTeamName(name);",
    expect: 'E resolveTeamKey is untouched for a bare form' },
  // S5 WAS HERE AND IS DELIBERATELY GONE: "the join stops passing the payload".
  // This check cannot discriminate it. Its MLS fixture is a payload where the
  // alias is CORRECT, so dropping the payload still yields coloradorapids and
  // the lookup still succeeds; the CFB fixture misses either way. A mutation
  // that cannot go red here would need a contrived assertion to make it, and an
  // assertion written to satisfy a mutation tests the mutation, not the code.
  //
  // It is covered where the fixture discriminates: N5 and N7 in
  // scripts/mutate-ambiguous-team-identity.mjs, whose payloads are baseball
  // against football, both verified caught 2026-09-13.
];

let bad = 0;
for (const m of MUTATIONS) {
  const before = fs.readFileSync(m.file, 'utf8');
  const hits = before.split(m.anchor).length - 1;
  if (hits !== 1) {
    bad++; console.error(`  ANCHOR  ${m.name}\n          anchor occurs ${hits} time(s) in ${m.file}, expected 1. NOTHING WAS MUTATED.`);
    continue;
  }
  fs.writeFileSync(m.file, before.replace(m.anchor, m.replace));
  if (!fs.readFileSync(m.file, 'utf8').includes(m.replace)) {
    bad++; console.error(`  NOTAPPLIED  ${m.name}`); sh('git', ['checkout', '--', m.file]); continue;
  }
  let out = '', code = 0;
  try { out = sh('node', [CHECK]); }
  catch (e) { code = e.status ?? 1; out = `${e.stdout || ''}${e.stderr || ''}`; }
  sh('git', ['checkout', '--', m.file]);

  if (code === 0) { bad++; console.error(`  NOT CAUGHT  ${m.name}\n          the check still passed.`); }
  else if (!(out.match(/^FAIL {2}.*$/gm) || []).some(l => l.includes(m.expect))) {
    bad++; console.error(`  WRONG REASON  ${m.name}\n          failed, but no FAIL line mentioned "${m.expect}".\n${out.slice(0, 600)}`);
  } else {
    const n = (out.match(/^FAIL {2}/gm) || []).length;
    console.log(`  caught  ${m.name}\n          by "${m.expect}" (${n} assertion(s) red)`);
  }
}

const post = sh('git', ['status', '--porcelain', '--', RESOLVER]).trim();
if (post) { console.error(`FAIL — ${RESOLVER} not restored:\n${post}`); process.exit(1); }
console.log(`\nran ${MUTATIONS.length} mutation(s) against ${CHECK}; ${RESOLVER} restored clean`);
if (bad) { console.error(`FAIL — ${bad} mutation(s) not caught.`); process.exit(1); }
console.log('PASS');
