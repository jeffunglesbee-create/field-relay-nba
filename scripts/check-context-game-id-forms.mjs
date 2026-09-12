#!/usr/bin/env node
// Rule 90 (MUTATE-FIRST-A) / Rule 99 (DISTINGUISHABILITY-A).
//
// classifyContextGameId decides whether /context/game answers a lookup at all.
// Get it wrong in the permissive direction and an unresolvable id is answered
// with a LIKE-matched coincidence — the defect this check exists for. Get it
// wrong in the strict direction and a real archived game stops resolving.
//
// So the cases are enumerated, both directions are covered, and the check
// reports its own coverage (Rule 91) rather than a bare PASS.
//
// The function is read from src/index.js rather than re-typed here. A copy
// would pass while the shipped source was broken — this file's whole subject.

import fs from 'node:fs';

const SRC = 'src/index.js';
const src = fs.readFileSync(SRC, 'utf8');

const START = 'function classifyContextGameId(id, game) {';
const occurrences = src.split(START).length - 1;
if (occurrences !== 1) {
  console.error(`FAIL — anchor "${START}" occurs ${occurrences} times in ${SRC}; `
              + `expected exactly 1. Nothing was checked.`);
  process.exit(1);
}
const from = src.indexOf(START);
const end  = src.indexOf('\n}\n', from);
if (end === -1) { console.error('FAIL — could not find the end of the function body.'); process.exit(1); }
const body = src.slice(from, end + 2);

// eslint-disable-next-line no-new-func
const classify = new Function(`${body}\nreturn classifyContextGameId;`)();

const ROW = {}; // any truthy object stands for "findGame returned a row"

const CASES = [
  // id,                              game, expected
  ['espn:401816899',                  ROW,  'resolved'],
  ['g19',                             ROW,  'resolved'],      // a row wins over the form
  ['espn:401816899',                  null, 'unresolved'],
  ['apisports:12345',                 null, 'unresolved'],
  ['MLB_2026-09-11_e401816899',       null, 'unresolved'],
  ['MLB_CHC_PIT_20260911',            null, 'unresolved'],
  ['nba_finals_2026_g4',              null, 'unresolved'],    // docs/CC-CMD-context-graph.md
  ['golf_travelers_2026',             null, 'unresolved'],
  ['g19',                             null, 'unrecognized'],  // the live defect
  ['g30',                             null, 'unrecognized'],
  ['',                                null, 'unrecognized'],
  ['undefined',                       null, 'unrecognized'],
];

let failed = 0;
for (const [id, game, want] of CASES) {
  const got = classify(id, game);
  if (got !== want) {
    failed++;
    console.error(`  MISMATCH  id=${JSON.stringify(id)} game=${game ? 'row' : 'null'} `
                + `→ ${got}, expected ${want}`);
  }
}

console.log(`checked ${CASES.length} of ${CASES.length} enumerated id forms `
          + `(${CASES.filter(c => c[2] === 'unrecognized').length} must be refused, `
          + `${CASES.filter(c => c[2] === 'unresolved').length} must be looked up, `
          + `${CASES.filter(c => c[2] === 'resolved').length} already resolved)`);

if (failed) { console.error(`FAIL — ${failed} of ${CASES.length} mismatched.`); process.exit(1); }
console.log('PASS');
