#!/usr/bin/env node
/**
 * Rule 90 for check-odds-budget-batch.mjs, plus a behavioural half the source
 * check cannot reach.
 *
 * TWO KINDS OF MUTATION HERE, deliberately:
 *
 *   B1-B10 break the CHECK and assert its self-test goes red. Standard.
 *   E1-E7  break the SQL ITSELF and run it against real SQLite, asserting the
 *          counters diverge. A source check can prove the statements are in the
 *          right order; only execution can prove that order is the one that
 *          keeps daily, by-site and monthly equal.
 *
 * E1 is the one to keep. It swaps site and charge — a two-line reorder with no
 * syntax error, no failing source check unless B1 is doing its job, and no
 * symptom until a ceiling day. Run against SQLite it diverges immediately.
 *
 * THE SQL IS THE SOURCE'S, NOT A COPY. Until 2026-10-18 the behavioural half
 * ran its own literal copy of the three day statements, so when the month
 * joined the batch it would have gone on certifying a transaction production no
 * longer sends. The statements and their order are now read out of
 * src/budget-helpers.js, and every E mutant is an anchored replacement on what
 * was read, asserted unique and applied.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';

const F = 'scripts/check-odds-budget-batch.mjs';
const HELPERS = 'src/budget-helpers.js';
const green = () => { try { execFileSync(process.execPath, [F, '--self-test'], { stdio: 'pipe' }); return true; } catch { return false; } };

try { execFileSync('git', ['diff', '--quiet', '--', F], { stdio: 'pipe' }); }
catch { console.log(`FAIL — ${F} has unstaged changes.`); process.exit(1); }
if (!green()) { console.log(`FAIL — ${F} --self-test already red on clean source.`); process.exit(1); }
console.log(`baseline: ${F} --self-test passes on clean source\n`);

const MUTATIONS = [
  ['B1 order is not checked',
   "  return s !== -1 && c !== -1 && s < c;",
   "  return s !== -1 && c !== -1;",
   'THE ONE THAT MATTERS: charge-then-site passes, the site reads the POST-charge total, and the counters differ by `units` at every boundary'],
  ['B2 an empty batch reads as clean',
   "  if (order.length === 0)  return 'no-batch-found';",
   "  if (order.length === 0)  return 'ok';",
   'rename the helper and the check goes green on nothing'],
  ['B3 a short batch passes',
   "  if (order.length !== 5)  return `batch-has-${order.length}-statements`;",
   "  if (order.length < 1)  return `batch-has-${order.length}-statements`;",
   'dropping a write is how a counter silently stops being written — and three statements is the split shape back'],
  ['B4 an unguarded write passes',
   "  if (!guarded)            return 'a-write-escapes-the-ceiling';",
   "  if (false)            return 'a-write-escapes-the-ceiling';",
   'a vetoed call bumps the split and not the total — a positive gap, manufactured'],
  ['B5 a ceilinged correction passes',
   "  if (!corrections)        return 'a-correction-carries-the-ceiling';",
   "  if (false)        return 'a-correction-carries-the-ceiling';",
   'a refund refused on a capped day leaves the ledger permanently above the bill'],
  ['B6 the month\'s order is not checked',
   "  return m !== -1 && c !== -1 && m < c;",
   "  return m !== -1 && c !== -1;",
   'charge-then-month passes, the month reads the POST-charge day total, and at the boundary the day charges while the month refuses'],
  ['B7 the month\'s day predicate is assumed',
   "  return s.includes(DAY_PREDICATE) && m.includes(DAY_PREDICATE)\n      && m.replace(DAY_PREDICATE, '').includes('used + ? <= ?');",
   "  return true;",
   'a month statement without the day predicate passes, and a day-vetoed call charges the month'],
  ['B8 a month reading post-charge is not acted on',
   "  if (!monthPre)           return 'month-reads-post-charge';",
   "  if (false)           return 'month-reads-post-charge';",
   'the predicate computed and ignored — the branch, not the predicate'],
  ['B9 a month escaping the day ceiling is not acted on',
   "  if (!monthDay)           return 'the-month-escapes-the-day-ceiling';",
   "  if (false)           return 'the-month-escapes-the-day-ceiling';",
   'the predicate computed and ignored — the branch, not the predicate'],
  ['B10 a charge that is not last is not acted on',
   "  if (order.at(-1) !== 'charge') return 'charge-is-not-last';",
   "  if (false) return 'charge-is-not-last';",
   'chargedFromBatch reads the LAST statement as the verdict; with the charge elsewhere it reads the wrong one'],
];

let caught = 0;
const original = readFileSync(F, 'utf8');
for (const [name, anchor, repl, why] of MUTATIONS) {
  const hits = original.split(anchor).length - 1;
  if (hits !== 1) { console.log(`FAIL       ${name}\n            anchor matched ${hits} times, expected 1 — NOTHING MUTATED.`); continue; }
  writeFileSync(F, original.replace(anchor, repl));
  const red = !green();
  writeFileSync(F, original);
  console.log(`${red ? 'CAUGHT    ' : 'NOT CAUGHT'} ${name}\n            (${why})`);
  if (red) caught++;
}

// ── the behavioural half, on the source's own statements ────────────────────
const src = readFileSync(HELPERS, 'utf8');
const grab = (name) => {
  const m = new RegExp(`const ${name}\\s*=\\s*(\`[^\`]*\`|'[^']*')`).exec(src);
  return m ? m[1].slice(1, -1) : null;
};
const SQL = { seed: grab('SQL_SEED'), monthSeed: grab('SQL_MONTH_SEED'), site: grab('SQL_SITE'),
              monthCharge: grab('SQL_MONTH_CHARGE'), charge: grab('SQL_CHARGE') };
const om = /export const ODDS_CHARGE_ORDER\s*=\s*\[([^\]]*)\]/.exec(src);
const ORDER = om ? [...om[1].matchAll(/'([^']+)'/g)].map((x) => x[1]) : [];
if (Object.values(SQL).some((v) => !v) || ORDER.length !== 5) {
  console.log(`\nFAIL — the statements or ODDS_CHARGE_ORDER could not be read from ${HELPERS}; nothing below would be about the source.`);
  console.log(`       read: ${JSON.stringify(Object.fromEntries(Object.entries(SQL).map(([k, v]) => [k, !!v])))} order=${JSON.stringify(ORDER)}`);
  process.exit(1);
}

/** An anchored replacement on one pulled statement: the anchor must occur
 *  exactly once and the replacement must change the text, or there is no mutant. */
const mutate = (sql, anchor, repl) => {
  const hits = sql.split(anchor).length - 1;
  if (hits !== 1) throw new Error(`E-anchor matched ${hits} times, expected 1 — NOTHING MUTATED: ${anchor}`);
  const out = sql.replace(anchor, repl);
  if (out === sql) throw new Error(`E-anchor replaced to the same text — NOTHING MUTATED: ${anchor}`);
  return out;
};
const DAY_PRED = '(SELECT used FROM odds_budget WHERE day = ?) + ? <= ?';
const NO_DAY_PRED = '? IS NOT NULL AND ? IS NOT NULL AND ? IS NOT NULL';   // same three binds
const LIMIT = 'AND used + ? <= ?', NO_LIMIT = 'AND ? IS NOT NULL AND ? IS NOT NULL';  // same two binds

/** Run a sequence of calls; report the three counters and each call's verdicts.
 *  `split` models the pre-2026-10-18 shape: the day's three statements in one
 *  transaction, then — only if the day charged — the month's two in a second.
 *  `stopAt` stops call N at the point a cancellation can land: between the two
 *  transactions in the split shape, mid-batch (rolled back) in the single one. */
function run({ order = ORDER, sql = {}, ceiling = 100, limit = 1000, units = 30, calls = 5, split = false, stopAt = null } = {}) {
  const S = { ...SQL, ...sql };
  const db = new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE odds_budget (day TEXT PRIMARY KEY, used INTEGER NOT NULL DEFAULT 0);
           CREATE TABLE odds_budget_site (day TEXT, site TEXT, used INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (day, site));
           CREATE TABLE odds_budget_month (month TEXT PRIMARY KEY, used INTEGER NOT NULL DEFAULT 0);`);
  const R = {
    seed:        () => db.prepare(S.seed).run('D', 0),
    monthSeed:   () => db.prepare(S.monthSeed).run('M', 0),
    site:        () => db.prepare(S.site).run('D', 'a', units, 'D', units, ceiling),
    monthCharge: () => db.prepare(S.monthCharge).all(units, 'M', units, limit, 'D', units, ceiling),
    charge:      () => db.prepare(S.charge).all(units, 'D', units, ceiling),
  };
  const verdicts = [];
  for (let i = 0; i < calls; i++) {
    const out = {};
    if (split) {
      db.exec('BEGIN');
      for (const k of ['seed', 'site', 'charge']) out[k] = R[k]();
      db.exec('COMMIT');
      if (stopAt !== i && out.charge.length) {
        db.exec('BEGIN');
        for (const k of ['monthSeed', 'monthCharge']) out[k] = R[k]();
        db.exec('COMMIT');
      }
    } else {
      db.exec('BEGIN');
      for (const [j, k] of order.entries()) {
        out[k] = R[k]();
        if (stopAt === i && j === order.length - 2) break;   // stopped before the last statement
      }
      db.exec(stopAt === i ? 'ROLLBACK' : 'COMMIT');
    }
    verdicts.push([!!(out.charge && out.charge.length), !!(out.monthCharge && out.monthCharge.length)]);
  }
  const g = (q) => db.prepare(q).get()?.v ?? 0;
  const daily = g("SELECT used v FROM odds_budget WHERE day='D'");
  const sum   = g("SELECT SUM(used) v FROM odds_budget_site WHERE day='D'");
  const month = g("SELECT used v FROM odds_budget_month WHERE month='M'");
  return { daily, sum, month, verdicts, diverged: daily !== sum || month !== daily, limit };
}
const fmt = (r) => `daily=${r.daily} sum=${r.sum} month=${r.month}`;

console.log('\n── executed against real SQLite, on the statements read from the source ──');
// Metric A: the three counters agree. Metric B, with the month limit binding:
// the month never passes its limit, and a day charge with a month veto still
// happens — the day keeps its charge, which is what the two-batch code did.
const control = run();
const ctlLimit = run({ limit: 60, ceiling: 1000 });
const ctlStop = run({ stopAt: 1 });
const limitHolds = (r) => r.month <= r.limit && r.verdicts.some(([d, m]) => d && !m);
console.log(`${!control.diverged ? 'OK        ' : 'BROKEN    '} the source order ${ORDER.join(' -> ')}   ${fmt(control)}`);
console.log(`${limitHolds(ctlLimit) ? 'OK        ' : 'BROKEN    '} the month limit binds (limit 60)   ${fmt(ctlLimit)}`);
console.log(`${!ctlStop.diverged ? 'OK        ' : 'BROKEN    '} a stop inside the one batch rolls back   ${fmt(ctlStop)}`);
if (control.diverged || !limitHolds(ctlLimit) || ctlStop.diverged) {
  console.log('            a control failed; nothing below is readable'); process.exit(1);
}

const swap = (a, x, y) => a.map((k) => (k === x ? y : k === y ? x : k));
let E;
try {
  E = [
    ['E1 charge before site',
     run({ order: ['seed', 'monthSeed', 'monthCharge', 'charge', 'site'] }), (r) => r.diverged,
     'the site statement reads the POST-charge total, so at the boundary the charge lands and the split does not'],
    ['E2 the site write loses its ceiling',
     run({ sql: { site: mutate(SQL.site, DAY_PRED, NO_DAY_PRED) } }), (r) => r.diverged,
     'a vetoed call bumps the split and not the total — the positive gap, exactly'],
    ['E3 the charge loses its ceiling',
     run({ sql: { charge: mutate(SQL.charge, LIMIT, NO_LIMIT) } }), (r) => r.diverged,
     'the total runs past the cap while the split stops at it — a negative gap, the 2026-09-19 sign'],
    ['E4 monthCharge after charge',
     run({ order: swap(ORDER, 'monthCharge', 'charge') }), (r) => r.diverged,
     'the month reads the POST-charge day total: at the boundary the day charges and the month refuses — the month short'],
    ['E5 monthCharge loses the day predicate',
     run({ sql: { monthCharge: mutate(SQL.monthCharge, DAY_PRED, NO_DAY_PRED) } }), (r) => r.diverged,
     'a day-vetoed call charges the month — the month ahead of the day'],
    ['E6 monthCharge loses its month limit',
     run({ limit: 60, ceiling: 1000, sql: { monthCharge: mutate(SQL.monthCharge, LIMIT, NO_LIMIT) } }), (r) => !limitHolds(r),
     'the 85,000 hard limit stops binding; daily and month still agree, so only the limit metric sees it'],
    ['E7 the charge split back into two transactions, stopped between them',
     run({ split: true, stopAt: 1, sql: { monthCharge: mutate(SQL.monthCharge, DAY_PRED, NO_DAY_PRED) } }), (r) => r.diverged,
     'THE CHANGE ITSELF, reverted: day and site commit, the month never runs — the "month short" the 2026-10-18 measurement found'],
  ];
} catch (e) {
  console.log(`FAIL — ${e.message}`);
  process.exit(1);
}
for (const [name, r, isCaught, why] of E) {
  const c = isCaught(r);
  console.log(`${c ? 'CAUGHT    ' : 'NOT CAUGHT'} ${name}  ${fmt(r)}\n            (${why})`);
  if (c) caught++;
}

const total = MUTATIONS.length + E.length;
console.log(`\n${caught} of ${total} mutations caught.`);
console.log('COVERAGE: the check\'s predicates via --self-test, and the SQL\'s real');
console.log('behaviour via node:sqlite over a single-threaded sequence, using the five');
console.log(`statements and the order read from ${HELPERS}. It does NOT exercise D1,`);
console.log('concurrency between isolates, or batch() atomicity — the transaction is');
console.log('Cloudflare\'s guarantee, asserted live by the odds_budget_charging staged');
console.log('verifier.');
process.exit(caught === total ? 0 : 1);
