#!/usr/bin/env node
// Rule 90. The first mutation restores the raw counter — the defect exactly as
// it shipped — and must take /archive/ back to truncated.

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';

const SRC = 'scripts/lib/route-scan.mjs';
const sh = (c, a, t = 120000) => execFileSync(c, a, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: t });
const dirty = sh('git', ['status', '--porcelain', '--', SRC]).trim();
if (dirty) { console.error(`FAIL — ${SRC} is dirty; refusing to mutate.\n${dirty}`); process.exit(1); }

const MUTATIONS = [
  { name: 'B1  the raw counter returns — braces in prose count as syntax',
    anchor: '    const stripped = stripNonCode(line, inBlockComment);\n    inBlockComment = stripped.inBlockComment;\n    for (const ch of stripped.code) {',
    replace: '    for (const ch of line) {',
    expect: '/archive/ parses whole' },
  { name: 'B2  line comments are no longer skipped',
    anchor: "      if (c === '/' && n === '/') break;                       // rest of line is comment",
    replace: "      if (false) break;",
    expect: 'REAL 11978' },
  { name: 'B3  single quotes stop being string delimiters',
    anchor: `      if (c === '"' || c === "'" || c === '\`') { quote = c; i++; continue; }`,
    replace: `      if (c === '"' || c === '\`') { quote = c; i++; continue; }`,
    expect: 'REAL 12879' },
  { name: 'B4  block-comment state stops carrying across lines',
    anchor: '  return { code, inBlockComment: blk };',
    replace: '  return { code, inBlockComment: false };',
    expect: 'block comment spanning 3 lines' },
  { name: 'B5  the escape pair is not skipped — a quote inside a string ends it',
    anchor: "    if (c === '\\\\') { i += 2; continue; }                      // escape: skip the pair",
    replace: '    if (false) { i += 2; continue; }',
    expect: 'escaped quote does not end the string' },
];

let bad = 0;
for (const m of MUTATIONS) {
  const before = fs.readFileSync(SRC, 'utf8');
  const hits = before.split(m.anchor).length - 1;
  if (hits !== 1) {
    bad++; console.error(`  ANCHOR  ${m.name}\n          anchor occurs ${hits} time(s), expected 1. NOTHING WAS MUTATED — harness defect, not a result.`);
    continue;
  }
  fs.writeFileSync(SRC, before.replace(m.anchor, m.replace));
  if (!fs.readFileSync(SRC, 'utf8').includes(m.replace)) {
    bad++; console.error(`  NOTAPPLIED  ${m.name}`); sh('git', ['checkout', '--', SRC]); continue;
  }

  let out = '', code = 0;
  try { out = sh('node', ['scripts/check-brace-balance.mjs']); }
  catch (e) { code = e.status ?? 1; out = `${e.stdout || ''}${e.stderr || ''}`; }
  sh('git', ['checkout', '--', SRC]);

  if (code === 0) { bad++; console.error(`  NOT CAUGHT  ${m.name}\n          the check still passed.`); }
  else if (!(out.match(/^ {2}FAIL {2}.*$/gm) || []).some(l => l.includes(m.expect))) {
    bad++; console.error(`  WRONG REASON  ${m.name}\n          failed, but no FAIL line mentioned "${m.expect}". Output:\n${out.slice(0, 900)}`);
  } else {
    const n = (out.match(/^ {2}FAIL {2}/gm) || []).length;
    console.log(`  caught  ${m.name}\n          by "${m.expect}" (${n} case(s) went red)`);
  }
}

const post = sh('git', ['status', '--porcelain', '--', SRC]).trim();
if (post) { console.error(`FAIL — ${SRC} not restored:\n${post}`); process.exit(1); }
console.log(`\nran ${MUTATIONS.length} mutation(s) against scripts/check-brace-balance.mjs; each asserted its `
          + `anchor unique and its effect present before the verdict; ${SRC} restored clean`);
if (bad) { console.error(`FAIL — ${bad} mutation(s) not caught or not applied.`); process.exit(1); }
console.log('PASS');
