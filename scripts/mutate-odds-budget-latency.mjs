#!/usr/bin/env node
/**
 * Rule 90 for probe-odds-budget-latency.mjs.
 *
 * L1 is the one to keep. It lets the once-per-isolate cold number decide a
 * per-request comparison — the averaging this probe was built to avoid, and the
 * exact way a latency finding gets published backwards.
 *
 * Each mutation asserts its anchor is unique and applied before reporting a
 * verdict. NOT CAUGHT with nothing mutated is worse than no test.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const F = 'scripts/probe-odds-budget-latency.mjs';
const selfTestPasses = () => {
  try { execFileSync(process.execPath, [F, '--self-test'], { stdio: 'pipe' }); return true; }
  catch { return false; }
};

try { execFileSync('git', ['diff', '--quiet', '--', F], { stdio: 'pipe' }); }
catch { console.log(`NOTE — ${F} has uncommitted changes; they are restored byte-for-byte after each mutation.`); }
if (!selfTestPasses()) { console.log(`FAIL — ${F} --self-test is already red on clean source.`); process.exit(1); }
console.log(`baseline: ${F} --self-test passes on current source\n`);

const MUTATIONS = [
  ['L1 THE COLD NUMBER DECIDES THE PER-REQUEST VERDICT',
   "  if (m.d1_batch_warm < m.kv_four_ops) return 'warm-cheaper';",
   "  if (m.d1_batch_warm + m.d1_first_call_on_isolate < m.kv_four_ops) return 'warm-cheaper';",
   'THE ONE THAT MATTERS: a cost paid once per isolate is charged to every request, and Task 2 reads as dearer than it is'],

  ['L2 a missing series still yields a comparison',
   "  if (!m || need.some(k => typeof m[k] !== 'number')) return 'incomplete';",
   "  if (!m) return 'incomplete';",
   'two of three medians is not a comparison, and NaN compares false against everything so it would read as warm-cheaper'],

  ['L3 the cold series stops being required',
   "  const need = Object.keys(SERIES);",
   "  const need = ['kv_four_ops', 'd1_batch_warm'];",
   '"reported beside the verdict" quietly becomes "absent", and Task 6 loses the number that explains a cron spike'],

  ['L4 a dead heat is rounded into a win',
   "  if (m.d1_batch_warm > m.kv_four_ops) return 'warm-dearer';\n  return 'warm-equal';",
   "  return 'warm-dearer';",
   'equal stops being its own answer — the absence-collapse class (Rule 99) applied to a measurement'],

  ['L5 a negative median reads as a fast path',
   "  if (need.some(k => m[k] < 0)) return 'impossible';",
   "  if (false) return 'impossible';",
   'a clock going backwards would report warm-cheaper, which is the most flattering possible reading of a broken probe'],

  ['L6 an unknown state passes silently',
   "    default:\n      return 'unknown state';",
   "    default:\n      return 'Task 2 bought atomicity AND took latency off the per-request path.';",
   'a state nobody enumerated reports the answer the author hoped for'],
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
console.log('COVERAGE: the verdict function via --self-test. It does NOT re-run the');
console.log('live probe, the fetch path, the worker route, or the artifact write.');
process.exit(caught === MUTATIONS.length ? 0 : 1);
