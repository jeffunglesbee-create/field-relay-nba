#!/usr/bin/env node
/**
 * Rule 90 for probe-whoop-tokens.mjs.
 *
 * W1 and W4 are the two to keep. W1 makes a permission failure report as
 * "nothing to drop" — the probe would close an open question by not having been
 * allowed to look at it. W4 puts an OAuth token column into a log this workflow
 * commits to a public repo.
 *
 * Each mutation asserts its anchor is unique and applied before reporting a
 * verdict. NOT CAUGHT with nothing mutated is worse than no test.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const F = 'scripts/probe-whoop-tokens.mjs';
const selfTestPasses = () => {
  try { execFileSync(process.execPath, [F, '--self-test'], { stdio: 'pipe' }); return true; }
  catch { return false; }
};

try { execFileSync('git', ['diff', '--quiet', '--', F], { stdio: 'pipe' }); }
catch { console.log(`NOTE — ${F} has uncommitted changes; they are restored byte-for-byte after each mutation.`); }
if (!selfTestPasses()) { console.log(`FAIL — ${F} --self-test is already red on clean source.`); process.exit(1); }
console.log(`baseline: ${F} --self-test passes on current source\n`);

const MUTATIONS = [
  ['W1 a failed control still yields a verdict',
   "  if (!controlOk) return 'unreadable';",
   "  if (!controlOk) return 'absent';",
   'THE ONE THAT MATTERS: the API token cannot read the database, and the probe closes the question with "nothing to drop"'],

  ['W2 zero rows collapses into absent',
   "  if (!listed) return 'absent';",
   "  if (!listed || rows === 0) return 'absent';",
   'Rule 99: "the table is not there" and "the table is empty" stop being different answers, and one of them is a write'],

  ['W3 a failed count reads as empty',
   "  if (rows === null) return 'present-uncounted';",
   "  if (rows === null) return 'empty';",
   'COUNT(*) errored and the probe reports the table holds nothing'],

  ['W4 THE SUBJECT QUERY NAMES A TOKEN COLUMN',
   "  B: `SELECT COUNT(*) AS n FROM ${TABLE}`,",
   "  B: `SELECT access_token FROM ${TABLE}`,",
   'THE OTHER ONE THAT MATTERS: a live OAuth token in a log this workflow commits to a public repo'],

  ['W5 the subject query selects rows rather than counting',
   "  B: `SELECT COUNT(*) AS n FROM ${TABLE}`,",
   "  B: `SELECT * FROM ${TABLE}`,",
   'same exposure as W4 without naming a column — the shape guard has to catch it on its own'],

  ['W6 a write slips into the control',
   "  A: \"SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name\",",
   "  A: \"DELETE FROM whoop_tokens WHERE 1 = 0\",",
   'a run advertised as needing no approval acquires a statement that needs one'],

  ['W7 the wrong database is queried',
   "export const DB_ID   = 'f26669de-e772-4b56-a6d1-f8fdea08a4d4';",
   "export const DB_ID   = 'cc49101c-0569-4d41-8e7a-be139cde4f26';",
   'field-archive never held whoop_tokens, so "absent" would be true and would answer a different question'],

  ['W8 an unknown state passes silently',
   "    default:\n      return 'unknown state';",
   "    default:\n      return 'NOTHING TO DROP. The table was never created.';",
   'a state nobody enumerated reports the answer that closes the question'],
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
console.log('COVERAGE: the classifier, the SQL shape and the credential guard, via');
console.log('--self-test. It does NOT re-run the live probe, the fetch path, the');
console.log('sqlite_master parsing, or the artifact write.');
process.exit(caught === MUTATIONS.length ? 0 : 1);
