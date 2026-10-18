// THE GUARD'S VETO MUST BE VISIBLE FROM OUTSIDE THE WORKER.
//
// `used === ceiling` says the budget is exhausted. It does NOT say a fetch was
// ever refused, and those are different facts: a day that lands exactly on the
// cap at 23:58 turned nothing away, while 2026-09-19 sat at 3800 from before
// 19:39 until at least 22:32 and refused everything for hours
// (outbox/odds-site-drift-series.json, 29 samples).
//
// The charge (chargeOdds; checkAndIncrementDailyOdds until 2026-10-18) writes
// `odds:daily:<date>:warned` ONLY when the DAY vetoes. That key was a boolean
// nothing outside the worker could read. It now carries the moment of the first
// veto, and /budget/odds reports it.
//
// This checks the SOURCE, because the behaviour lives in a Worker that cannot
// be imported here: the writer stores a timestamp, the reader distinguishes the
// three states, and the field is on the response.
import { readFileSync } from 'node:fs';

const SRC = process.env.BUDGET_HELPERS_SRC || 'src/budget-helpers.js';
const whole = readFileSync(SRC, 'utf8');

// SCOPED TO THE DAILY GUARD'S BODY, and that is not tidiness.
//
// On 2026-09-23 chargeMonthlyOdds was added to this same file with its own
// once-per-period `warnedKey` block — same get/if(!already)/put shape, same
// ISO timestamp. Every regex below then matched the MONTHLY block, so mutating
// the DAILY one back to a boolean left the check green. C1 and C2 went from
// CAUGHT to NOT CAUGHT in one commit, and the check reported 7/7 while proving
// nothing about the code it names.
//
// The reader must be aimed at the function it is about. Slicing the body is the
// same technique declaredTables uses in check-odds-budget-schema.mjs.
//
// AND SINCE 2026-10-18, AT THE DAY'S VETO BLOCK, NOT THE FUNCTION. The day and
// the month are one batch in chargeOdds, so the month's hard-limit block — the
// same get / if (!already) / put(warnedKey, ISO timestamp) shape — lives in the
// same function. A function-wide slice would let that block satisfy C1 and C2
// again, which is the 2026-09-23 defect in a new place. The slice is the day's
// veto block: from its warned key to its `return false;`.
const _i = whole.indexOf('async function chargeOdds');
const _j = whole.indexOf('\n}\n', _i);
if (_i < 0 || _j < 0) {
  console.log('FAIL  chargeOdds was not found in the source — nothing below ran.');
  process.exit(1);
}
const fn = whole.slice(_i, _j);
const _bi = fn.indexOf('const warnedKey = `${key}:warned`;');
const _bj = fn.indexOf('return false;', _bi);
if (_bi < 0 || _bj < 0) {
  console.log('FAIL  the day veto block (const warnedKey = `${key}:warned`; ... return false;) was not found — nothing below ran.');
  process.exit(1);
}
const src = fn.slice(_bi, _bj);
// The reader half lives in peekDailyOdds, not in the guard, so it gets its own
// slice rather than being checked against the whole file.
const _pi = whole.indexOf('async function peekDailyOdds');
const _pj = whole.indexOf('\n}\n', _pi);
const reader = (_pi < 0 || _pj < 0) ? '' : whole.slice(_pi, _pj);

let bad = 0, n = 0;
const ok = (label, cond, why) => { n++;
  if (cond) console.log(`ok    ${label}`);
  else { bad++; console.log(`FAIL  ${label}\n        ${why}`); } };

ok('the veto writes a timestamp, not a boolean',
  /put\(warnedKey, new Date\(\)\.toISOString\(\)/.test(src),
  "the key still stores '1', so the hour a day started refusing requests is unrecoverable");

ok('it is still written only once per day',
  /const already = await env\.FIELD_JOURNALISM\.get\(warnedKey\);\s*\n\s*if \(!already\) \{/.test(src),
  'writing it on every veto would put a KV round trip on a hot path for hours');

ok('the reader reads the veto key, not the counter',
  /get\(`odds:daily:\$\{date\}:warned`\)/.test(reader),
  'inferring a veto from used === ceiling cannot tell an exhausted budget from one that turned requests away');

// THREE STATES. A timestamp, `true` (reached, hour unknown — a key written
// before this field existed), and null. Collapsing the middle one into either
// neighbour is the absence collapse: it would either lose a real veto or
// invent an hour for it.
ok('a timestamp is kept as the timestamp',
  /ceilingHit = \/\^\\d\{4\}-\\d\{2\}-\\d\{2\}T\/\.test\(raw\) \? raw : true/.test(reader),
  'the three states are not separated, so a legacy key and a dated one read alike');

ok('an absent key is null, never false',
  /let ceilingHit = null;/.test(reader) && !/ceilingHit = false/.test(reader),
  'false reads as "checked, no veto"; null is the only honest value for a read that found nothing');

ok('a failed read does not invent a veto',
  /catch \(_\) \{ ceilingHit = null; \}/.test(reader),
  'an unreadable KV must not report a ceiling that was never hit');

// THE SCOPE ITSELF IS ASSERTED. Without this, a future edit that widens either
// slice back to the whole file would silently restore the defect above — the
// check would pass by finding a DIFFERENT function's warn block.
ok('the guard slice does not contain the monthly guard',
  !/odds-month-guard/.test(src) && !/odds-credits/.test(src.replace(/odds:credits/g, 'odds-credits')),
  "the slice has widened past the day's veto block, so these regexes can be satisfied by the month veto block instead");

ok('the reader slice is peekDailyOdds, not the whole file',
  reader.length > 0 && reader.length < whole.length / 2 && !/odds-month-guard/.test(reader),
  'a reader assertion satisfied from outside peekDailyOdds proves nothing about what /budget/odds returns');

ok('the field is on the /budget/odds response',
  /ceiling_reached_at: ceilingHit,/.test(reader),
  'a value only the worker knows is not an artifact (Rule 90)');

console.log(`\n${n - bad} of ${n} passed.`);
console.log(`COVERAGE: source text in ${SRC} — one file, seven properties. It does NOT`);
console.log('run the worker, and it cannot say whether any veto has actually occurred;');
console.log('that is what the live /budget/odds reading is for.');
process.exit(bad ? 1 : 0);
