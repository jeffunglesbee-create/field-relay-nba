#!/usr/bin/env node
/**
 * Rule 90 for probe-d1-returning.mjs.
 *
 * R2 is the one to keep. It drops the C control, which turns "B failed" from a
 * finding into a guess — the exact defect the three-statement design exists to
 * prevent. A probe that reads a verdict off one failing query cannot tell
 * RETURNING from a missing table, a wrong column or a 403.
 *
 * Each mutation asserts its anchor is unique and applied before reporting a
 * verdict. NOT CAUGHT with nothing mutated is worse than no test.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const F = 'scripts/probe-d1-returning.mjs';
const selfTestPasses = () => {
  try { execFileSync(process.execPath, [F, '--self-test'], { stdio: 'pipe' }); return true; }
  catch { return false; }
};

try { execFileSync('git', ['diff', '--quiet', '--', F], { stdio: 'pipe' }); }
catch { console.log(`FAIL — ${F} has unstaged changes; restore would lose them.`); process.exit(1); }
if (!selfTestPasses()) { console.log(`FAIL — ${F} --self-test is already red on clean source.`); process.exit(1); }
console.log(`baseline: ${F} --self-test passes on clean source\n`);

const MUTATIONS = [
  ['R1 a failed control still yields a verdict',
   "  if (!a) return 'route-unreachable';",
   "  if (!a) return 'returning-supported';",
   'nothing reached D1 and the probe reports the answer it hoped for'],

  ['R2 the discriminator is dropped',
   "  if (!c && !b) return 'update-path-blocked';\n  if (!c && b) return 'inconsistent';\n  if (c && !b) return 'no-returning';",
   "  if (!b) return 'no-returning';",
   'THE ONE THAT MATTERS: "B failed" becomes the verdict, so a missing table, a wrong column or a 403 all read as "no RETURNING"'],

  ['R3 B and C stop differing by one clause',
   "  B: `UPDATE ${TABLE} SET ${COL} = ${COL} WHERE 1 = 0 RETURNING ${KEY}`,",
   "  B: `UPDATE ${TABLE} SET ${COL} = 1 WHERE ${KEY} IS NOT NULL RETURNING ${KEY}`,",
   'the two queries now differ in three ways, so the comparison measures nothing — and this one would also WRITE to every row'],

  ['R4 the zero-row guard is removed',
   "  C: `UPDATE ${TABLE} SET ${COL} = ${COL} WHERE 1 = 0`,",
   "  C: `UPDATE ${TABLE} SET ${COL} = ${COL}`,",
   'a probe against a live archive database that can touch rows'],

  ['R5 an unknown state passes silently',
   "    default:\n      return 'unknown state';",
   "    default:\n      return 'Task 2 stands as written.';",
   'a state nobody enumerated reports the happy answer'],

  ['R6 the table is one the route rejects',
   "const TABLE = 'odds_backfill_progress';  // in the route's ALLOWED_TABLES",
   "const TABLE = 'odds_budget';  // in the route's ALLOWED_TABLES",
   'every statement returns 403 "table not allowed" and the run reports a D1 property from an auth failure'],
];

const original = readFileSync(F, 'utf8');
let caught = 0;
for (const [name, anchor, repl, why] of MUTATIONS) {
  const hits = original.split(anchor).length - 1;
  if (hits !== 1) { console.log(`FAIL       ${name}\n            anchor matched ${hits} times, expected 1 — NOTHING MUTATED.`); continue; }
  const mutated = original.replace(anchor, repl);
  if (mutated === original) { console.log(`FAIL       ${name}\n            file unchanged — NOTHING MUTATED.`); continue; }
  writeFileSync(F, mutated);
  const red = !selfTestPasses();
  writeFileSync(F, original);
  console.log(`${red ? 'CAUGHT    ' : 'NOT CAUGHT'} ${name}\n            (${why})`);
  if (red) caught++;
}

console.log(`\n${caught} of ${MUTATIONS.length} mutations caught.`);
console.log('COVERAGE: the classifier and the SQL shape, via --self-test. It does NOT');
console.log('re-run the live probe, the fetch path, or the artifact write.');
process.exit(caught === MUTATIONS.length ? 0 : 1);
