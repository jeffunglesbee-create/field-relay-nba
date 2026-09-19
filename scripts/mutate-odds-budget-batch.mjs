#!/usr/bin/env node
/**
 * Rule 90 for check-odds-budget-batch.mjs, plus a behavioural half the source
 * check cannot reach.
 *
 * TWO KINDS OF MUTATION HERE, deliberately:
 *
 *   B1-B5 break the CHECK and assert its self-test goes red. Standard.
 *   E1-E3 break the SQL ITSELF and run it against real SQLite, asserting the
 *         counters diverge. A source check can prove the statements are in the
 *         right order; only execution can prove that order is the one that
 *         keeps daily and by-site equal.
 *
 * E1 is the one to keep. It swaps site and charge — a two-line reorder with no
 * syntax error, no failing source check unless B1 is doing its job, and no
 * symptom until a ceiling day. Run against SQLite it diverges immediately.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';

const F = 'scripts/check-odds-budget-batch.mjs';
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
   "  if (order.length !== 3)  return `batch-has-${order.length}-statements`;",
   "  if (order.length < 1)  return `batch-has-${order.length}-statements`;",
   'dropping the site write is how the split silently stops being written'],
  ['B4 an unguarded write passes',
   "  if (!guarded)            return 'a-write-escapes-the-ceiling';",
   "  if (false)            return 'a-write-escapes-the-ceiling';",
   'a vetoed call bumps the split and not the total — a positive gap, manufactured'],
  ['B5 a ceilinged correction passes',
   "  if (!corrections)        return 'a-correction-carries-the-ceiling';",
   "  if (false)        return 'a-correction-carries-the-ceiling';",
   'a refund refused on a capped day leaves the ledger permanently above the bill'],
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

// ── the behavioural half ────────────────────────────────────────────────────
const SEED   = 'INSERT OR IGNORE INTO odds_budget (day, used) VALUES (?, ?)';
const SITE   = `INSERT INTO odds_budget_site (day, site, used) SELECT ?, ?, ?
                 WHERE (SELECT used FROM odds_budget WHERE day = ?) + ? <= ?
                ON CONFLICT(day, site) DO UPDATE SET used = used + excluded.used`;
const CHARGE = `UPDATE odds_budget SET used = used + ? WHERE day = ? AND used + ? <= ? RETURNING used`;

/** Run a sequence of calls and report whether the two counters ever disagree. */
function diverges({ order = ['seed', 'site', 'charge'], siteSql = SITE, chargeSql = CHARGE, ceiling = 100, units = 30, calls = 5 } = {}) {
  const db = new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE odds_budget (day TEXT PRIMARY KEY, used INTEGER NOT NULL DEFAULT 0);
           CREATE TABLE odds_budget_site (day TEXT, site TEXT, used INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (day, site));`);
  const run = {
    seed:   () => db.prepare(SEED).run('D', 0),
    site:   () => db.prepare(siteSql).run('D', 'a', units, 'D', units, ceiling),
    charge: () => db.prepare(chargeSql).all(units, 'D', units, ceiling),
  };
  for (let i = 0; i < calls; i++) {
    db.exec('BEGIN');
    for (const k of order) run[k]();
    db.exec('COMMIT');
  }
  const daily = db.prepare('SELECT used FROM odds_budget WHERE day=?').get('D')?.used ?? 0;
  const sum = db.prepare('SELECT SUM(used) s FROM odds_budget_site WHERE day=?').get('D')?.s ?? 0;
  return { daily, sum, diverged: daily !== sum };
}

console.log('\n── executed against real SQLite, not read ──');
const control = diverges();
console.log(`${!control.diverged ? 'OK        ' : 'BROKEN    '} the shipped order  seed -> site -> charge   daily=${control.daily} sum=${control.sum}`);
if (control.diverged) { console.log('            the control diverged; nothing below is readable'); process.exit(1); }

const E = [
  ['E1 charge before site',
   diverges({ order: ['seed', 'charge', 'site'] }),
   'the site statement reads the POST-charge total, so at the boundary the charge lands and the split does not'],
  ['E2 the site write loses its ceiling',
   diverges({ siteSql: `INSERT INTO odds_budget_site (day, site, used) SELECT ?, ?, ? WHERE ? IS NOT NULL AND ? IS NOT NULL AND ? IS NOT NULL
                        ON CONFLICT(day, site) DO UPDATE SET used = used + excluded.used` }),
   'a vetoed call bumps the split and not the total — the positive gap, exactly'],
  ['E3 the charge loses its ceiling',
   diverges({ chargeSql: 'UPDATE odds_budget SET used = used + ? WHERE day = ? AND ? IS NOT NULL AND ? IS NOT NULL RETURNING used' }),
   'the total runs past the cap while the split stops at it — a negative gap, the 2026-09-19 sign'],
];
for (const [name, r, why] of E) {
  console.log(`${r.diverged ? 'CAUGHT    ' : 'NOT CAUGHT'} ${name}  daily=${r.daily} sum=${r.sum}\n            (${why})`);
  if (r.diverged) caught++;
}

const total = MUTATIONS.length + E.length;
console.log(`\n${caught} of ${total} mutations caught.`);
console.log('COVERAGE: the check\'s four predicates via --self-test, and the SQL\'s');
console.log('real behaviour via node:sqlite over a single-threaded sequence. It does');
console.log('NOT exercise D1, concurrency between isolates, or batch() atomicity —');
console.log('the transaction is Cloudflare\'s guarantee, asserted live by the');
console.log('odds_budget_charging staged verifier.');
process.exit(caught === total ? 0 : 1);
