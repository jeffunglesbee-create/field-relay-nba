// THE GUARD'S VETO MUST BE VISIBLE FROM OUTSIDE THE WORKER.
//
// `used === ceiling` says the budget is exhausted. It does NOT say a fetch was
// ever refused, and those are different facts: a day that lands exactly on the
// cap at 23:58 turned nothing away, while 2026-09-19 sat at 3800 from before
// 19:39 until at least 22:32 and refused everything for hours
// (outbox/odds-site-drift-series.json, 29 samples).
//
// checkAndIncrementDailyOdds writes `odds:daily:<date>:warned` ONLY when it
// vetoes. That key was a boolean nothing outside the worker could read. It now
// carries the moment of the first veto, and /budget/odds reports it.
//
// This checks the SOURCE, because the behaviour lives in a Worker that cannot
// be imported here: the writer stores a timestamp, the reader distinguishes the
// three states, and the field is on the response.
import { readFileSync } from 'node:fs';

const SRC = process.env.BUDGET_HELPERS_SRC || 'src/budget-helpers.js';
const src = readFileSync(SRC, 'utf8');

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
  /get\(`odds:daily:\$\{date\}:warned`\)/.test(src),
  'inferring a veto from used === ceiling cannot tell an exhausted budget from one that turned requests away');

// THREE STATES. A timestamp, `true` (reached, hour unknown — a key written
// before this field existed), and null. Collapsing the middle one into either
// neighbour is the absence collapse: it would either lose a real veto or
// invent an hour for it.
ok('a timestamp is kept as the timestamp',
  /ceilingHit = \/\^\\d\{4\}-\\d\{2\}-\\d\{2\}T\/\.test\(raw\) \? raw : true/.test(src),
  'the three states are not separated, so a legacy key and a dated one read alike');

ok('an absent key is null, never false',
  /let ceilingHit = null;/.test(src) && !/ceilingHit = false/.test(src),
  'false reads as "checked, no veto"; null is the only honest value for a read that found nothing');

ok('a failed read does not invent a veto',
  /catch \(_\) \{ ceilingHit = null; \}/.test(src),
  'an unreadable KV must not report a ceiling that was never hit');

ok('the field is on the /budget/odds response',
  /ceiling_reached_at: ceilingHit,/.test(src),
  'a value only the worker knows is not an artifact (Rule 90)');

console.log(`\n${n - bad} of ${n} passed.`);
console.log(`COVERAGE: source text in ${SRC} — one file, seven properties. It does NOT`);
console.log('run the worker, and it cannot say whether any veto has actually occurred;');
console.log('that is what the live /budget/odds reading is for.');
process.exit(bad ? 1 : 0);
