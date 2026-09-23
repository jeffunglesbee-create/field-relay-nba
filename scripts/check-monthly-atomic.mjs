// THE MONTHLY CHARGE, EXECUTED AGAINST REAL SQLITE.
//
// The daily batch was verified this way on 2026-09-19 rather than reasoned
// about, and the reason holds here: the correctness argument is about what a
// transaction does under a ceiling predicate, and reading SQL cannot settle it.
//
// WHAT CHANGED. Until 2026-09-23 the monthly counter was get/parseInt/put on
// odds:credits:YYYY-MM with FOUR writers — index.js, wp-resolver.js,
// ambient-do.js and reconcile's loop. Concurrent isolates read the same value
// and the second put erased the first, so the monthly counter lost charges the
// (atomic since 09-19) daily counter kept. Measured over 09-20 and 09-21: daily
// summed 7599 against a monthly movement of 5037.
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const HELPERS = process.env.BUDGET_HELPERS_SRC || 'src/budget-helpers.js';
const src = readFileSync(HELPERS, 'utf8');

let bad = 0, n = 0;
const eq = (label, got, want) => { n++;
  if (JSON.stringify(got) === JSON.stringify(want)) console.log(`ok    ${label}`);
  else { bad++; console.log(`FAIL  ${label}\n        got  ${JSON.stringify(got)}\n        want ${JSON.stringify(want)}`); } };
const ok = (label, cond, why) => { n++;
  if (cond) console.log(`ok    ${label}`);
  else { bad++; console.log(`FAIL  ${label}\n        ${why}`); } };

// ── The SQL, pulled from the source so the test cannot drift from it ───────
const grab = (name) => {
  const m = new RegExp(`const ${name}\\s*=\\s*(\`[^\`]*\`|'[^']*')`).exec(src);
  return m ? m[1].slice(1, -1) : null;
};
const SEED = grab('SQL_MONTH_SEED'), CHARGE = grab('SQL_MONTH_CHARGE'), FIX = grab('SQL_FIX_MONTH');
ok('the month SQL is in the source', !!SEED && !!CHARGE && !!FIX,
  'the statements could not be read, so nothing below was executed against them');

const db = new DatabaseSync(':memory:');
db.exec('CREATE TABLE odds_budget_month (month TEXT PRIMARY KEY, used INTEGER NOT NULL DEFAULT 0)');

const LIMIT = 100, M = '2026-09';
// Mirrors chargeMonthlyOdds: seed then charge, the ceiling inside the UPDATE.
const charge = (units, carried = 0) => {
  db.prepare(SEED).run(M, carried);
  const rows = db.prepare(CHARGE).all(units, M, units, LIMIT);
  return rows.length ? rows[0].used : null;   // null = vetoed
};
const used = () => db.prepare('SELECT used FROM odds_budget_month WHERE month = ?').get(M)?.used ?? null;

eq('the first charge lands and RETURNING gives the post-charge total', charge(30), 30);
eq('the second', charge(30), 60);
eq('the third', charge(30), 90);
eq('THE CEILING BINDS: a charge that would exceed it returns no row', charge(30), null);
eq('...and moved nothing', used(), 90);
eq('a charge that exactly reaches the ceiling is allowed', charge(10), 100);
eq('and the next is refused', charge(1), null);

// ── THE SEED IS THE FINANCIALLY DANGEROUS PART ────────────────────────────
// odds:credits:2026-09 stood near 60,948 of 85,000 at cutover. A fresh row at 0
// would hand the month a SECOND full ceiling before the hard limit bound again.
{
  const d2 = new DatabaseSync(':memory:');
  d2.exec('CREATE TABLE odds_budget_month (month TEXT PRIMARY KEY, used INTEGER NOT NULL DEFAULT 0)');
  d2.prepare(SEED).run('2026-10', 95);
  const r = d2.prepare(CHARGE).all(10, '2026-10', 10, LIMIT);
  eq('a seeded month starts from the carried KV total, not from zero',
    d2.prepare('SELECT used FROM odds_budget_month WHERE month = ?').get('2026-10').used, 95);
  eq('...so a charge past the ceiling is refused on the FIRST call after cutover',
    r.length, 0);
  // A second isolate seeding the same month must not add the carry again.
  d2.prepare(SEED).run('2026-10', 95);
  eq('a second seed of the same month is a no-op, not a double count',
    d2.prepare('SELECT used FROM odds_budget_month WHERE month = ?').get('2026-10').used, 95);
}

// ── The correction carries no ceiling, and clamps at zero ─────────────────
{
  db.prepare(FIX).run(-40, M);
  eq('a refund applies even with the month at its ceiling', used(), 60);
  db.prepare(FIX).run(-1000, M);
  eq('a refund cannot drive the counter negative', used(), 0);
  db.prepare(FIX).run(25, M);
  eq('a positive correction applies too', used(), 25);
}

// ── The wiring: one implementation, three delegating call sites ───────────
const files = {
  'src/index.js': readFileSync(process.env.INDEX_SRC || 'src/index.js', 'utf8'),
  'src/wp-resolver.js': readFileSync('src/wp-resolver.js', 'utf8'),
  'src/ambient-do.js': readFileSync('src/ambient-do.js', 'utf8'),
};
for (const [f, text] of Object.entries(files)) {
  ok(`${f} delegates to chargeMonthlyOdds`, /return chargeMonthlyOdds\(env, units\);/.test(text),
    'this file still charges the month itself, which is the copy this change removed');
  ok(`${f} no longer writes the monthly key itself`,
    !/FIELD_JOURNALISM\.put\(key, String\((?:used \+ units|next)\)/.test(text),
    'a surviving read-modify-write reintroduces the lost update for every path through it');
}

ok('the threshold ladder survived the collapse',
  /const ODDS_THRESHOLDS = \[/.test(src) && /of monthly limit reached/.test(src),
  'index.js and wp-resolver.js each fired these; dropping them in a refactor is a silent behaviour change (Rule 69)');

ok('the hard limit has ONE definition',
  /export const ODDS_HARD_LIMIT = 85000;/.test(src),
  'it was written out four times, each with a comment asking the next person to sync it by hand');

console.log(`\n${n - bad} of ${n} passed.`);
console.log('COVERAGE: the month statements executed against real node:sqlite, plus the');
console.log('wiring of three call sites. It does NOT run in a Worker and says nothing');
console.log('about whether D1 supplies a transaction under concurrent isolates — that is');
console.log('the same unverified premise Task 2 left standing for the daily batch.');
process.exit(bad ? 1 : 0);
