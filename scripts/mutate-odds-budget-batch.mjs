#!/usr/bin/env node
/**
 * Rule 90 for check-odds-budget-batch.mjs.
 *
 * TWO KINDS OF MUTATION HERE, deliberately, as before 2026-10-28:
 *
 *   B1-B17 break the CHECK and assert its self-test goes red. Standard.
 *   E1-E9  break the SQL ITSELF and run it against real SQLite, asserting the
 *          counters diverge or the limits stop binding. A source check can prove
 *          the statements are in the right order; only execution can prove that
 *          order is the one that keeps daily, by-site and monthly equal.
 *
 * THE BEHAVIOURAL HALF WAS FIRST DELETED AND IS BACK. When the batch became eight
 * (nine since the refusal record of 2026-10-28; E10-E13 are that record's) statements with one that decides (Task 3 of
 * docs/CC-CMD-2026-09-16-odds-spend-attribution.md) this half was dropped on the
 * grounds that scripts/mutate-odds-site-caps.mjs breaks the real source in more
 * ways. That harness is stronger on the gate, but it did not carry what this half
 * knew: the three gap signs measured on 2026-09-19 (a charge ahead of its site
 * gives daily 90 / sum 60; an unguarded site write 90 / 150, the positive gap; an
 * unguarded charge 150 / 90, the negative one, the 2026-09-19 sign), the month
 * limit as a metric of its own (daily and month still agree when it stops binding,
 * so only a limit metric sees it), and E9, the change of 2026-10-18 itself
 * reverted: the day and site in one transaction and the month in a second, stopped
 * between them, which leaves the month short by exactly what the 2,766-credit
 * measurement found. They are re-expressed here on the new statements, each
 * mutant an anchored replacement on what was read from the source.
 *
 * THE SQL IS THE SOURCE'S, NOT A COPY. Until 2026-10-18 the behavioural half ran
 * its own literal copy of the day statements, so when the month joined the batch
 * it would have gone on certifying a transaction production no longer sent. The
 * statements and their order are read out of src/budget-helpers.js, and every E
 * mutant is an anchored replacement on what was read, asserted unique and applied.
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
  ['B1 the gate-before-charges order is not checked',
   "  return at('snapshot') < at('gate') && at('gate') < Math.min(...charges);",
   "  return true;",
   'THE ONE THAT MATTERS: a charge ahead of the gate passes, the gate reads a total a charge already moved, and a refused call moves a counter'],
  ['B2 an empty batch reads as clean',
   "  if (order.length === 0)  return 'no-batch-found';",
   "  if (order.length === 0)  return 'ok';",
   'rename the helper and the check goes green on nothing'],
  ['B3 a short batch passes',
   "  if (order.length !== EXPECTED_ORDER.length) return `batch-has-${order.length}-statements`;",
   "  if (order.length < 1) return `batch-has-${order.length}-statements`;",
   'dropping a statement is how a counter silently stops being written — and five is the pre-gate shape back'],
  ['B4 the gate\'s three limits are assumed',
   "      && g.includes(DAY_PREDICATE) && g.includes(MONTH_PREDICATE) && g.includes(SITE_PREDICATE);",
   "      && true;",
   'a gate without the site, the month or the day passes, and that limit stops binding'],
  ['B5 a charge that ignores the gate passes',
   "  return sqls.length === 3 && sqls.every((s) => norm(s).includes(GATE_PREDICATE));",
   "  return true;",
   'a refused call would still move the site, the month or the day'],
  ['B6 a charge with its own limit passes',
   "  return sqls.every((s) => !/<=\\s*\\?/.test(s));",
   "  return true;",
   'it would compare a total an earlier charge has already moved'],
  ['B7 a ceilinged correction passes',
   "  return stmts.every((x) => !/[<>]=?\\s*[?\\d]/.test(x));",
   "  return true;",
   'a refund refused on a capped day leaves the ledger permanently above the bill'],
  ['B8 a charge before the gate is not acted on',
   "  if (!decides)            return 'a-charge-runs-before-the-gate';",
   "  if (false)            return 'a-charge-runs-before-the-gate';",
   'the predicate computed and ignored — the branch, not the predicate'],
  ['B9 a gate that misses a limit is not acted on',
   "  if (!gate3)              return 'the-gate-misses-a-limit';",
   "  if (false)              return 'the-gate-misses-a-limit';",
   'the predicate computed and ignored — the branch, not the predicate'],
  ['B10 a charge that ignores the gate is not acted on',
   "  if (!obey)               return 'a-charge-ignores-the-gate';",
   "  if (false)               return 'a-charge-ignores-the-gate';",
   'the predicate computed and ignored — the branch, not the predicate'],
  ['B11 a charge that decides for itself is not acted on',
   "  if (!noLimit)            return 'a-charge-decides-for-itself';",
   "  if (false)            return 'a-charge-decides-for-itself';",
   'the predicate computed and ignored — the branch, not the predicate'],
  ['B12 a charge that is not last is not acted on',
   "  if (order.at(-1) !== 'charge') return 'charge-is-not-last';",
   "  if (false) return 'charge-is-not-last';",
   'chargedFromBatch reads the LAST statement as the verdict; with the charge elsewhere it reads the wrong one'],
  ['B13 the gate that never replaces its row passes',
   "  return /^INSERT OR REPLACE INTO odds_budget_gate \\(id, token\\) SELECT 1, \\? WHERE /.test(g)",
   "  return /^INSERT OR (?:REPLACE|IGNORE) INTO odds_budget_gate \\(id, token\\) SELECT 1, \\? WHERE /.test(g)",
   'INSERT OR IGNORE leaves the first token in the row, and every later call is refused'],
  ['B14 a correction that is not found passes',
   "  if (stmts.some((x) => typeof x !== 'string' || x.trim() === '')) return false;",
   "  if (false) return false;",
   "the day's correction was read as '' for its first day and the check answered true"],
  ['B15 the month correction is not checked for a ceiling',
   "  return stmts.every((x) => !/[<>]=?\\s*[?\\d]/.test(x));",
   "  return [fixDay, fixSite].every((x) => !/[<>]=?\\s*[?\\d]/.test(x));",
   'it had no assertion at all: a refund refused because the month is capped leaves the ledger above the bill'],
  ['B16 a literal ceiling on a correction is not recognised',
   "  return stmts.every((x) => !/[<>]=?\\s*[?\\d]/.test(x));",
   "  return stmts.every((x) => !/<=\\s*\\?/.test(x));",
   'a ceiling written as 3800 instead of a bound placeholder passes'],
  ['B17 the constant reader takes the template-literal form only',
   "  return m ? (m[1] ?? m[2] ?? '') : '';",
   "  return m ? (m[1] ?? '') : '';",
   "the day's fix is single-quoted: read as '' it carries no ceiling, so the vacuous check passes"],
  // THE REFUSAL RECORD (fix 3 E, 2026-10-28).
  ['B18 a refusal outside the gate-to-charges window passes',
   "  return at('gate') < at('refusal') && at('refusal') < Math.min(...charges);",
   "  return true;",
   'a record before the gate reads the previous call\'s token'],
  ['B19 a refusal record that is not conditional passes',
   "      && r.includes('WHERE NOT EXISTS (SELECT 1 FROM odds_budget_gate WHERE token = ?)')",
   "      && true",
   'every admitted call would be filed as a refusal'],
  ['B20 a refusal record that does not count repeats passes',
   "      && r.includes('ON CONFLICT(day, scope, site) DO UPDATE SET n = n + 1')",
   "      && true",
   'a caller retried 40 times would read as refused once'],
  ['B21 a refusal record that does not read its scope back passes',
   "      && /RETURNING scope$/.test(r)",
   "      && true",
   'chargeOdds could not compare the record with the reason'],
  ['B22 a refusal record that asks the month before the day passes',
   "      && r.indexOf(\"THEN 'day'\") < r.indexOf(\"THEN 'month'\") && r.indexOf(\"THEN 'month'\") < r.indexOf(\"ELSE 'site'\")",
   "      && true",
   'a day veto would be filed as a month veto, the defect the reason order was written against'],
  ['B23 a refusal outside its window is not acted on',
   "  if (!recordAfter)        return 'the-refusal-is-not-between-the-gate-and-the-charges';",
   "  if (false)        return 'the-refusal-is-not-between-the-gate-and-the-charges';",
   'the predicate computed and ignored — the branch, not the predicate'],
  ['B24 an unconditional refusal record is not acted on',
   "  if (!recordShape)        return 'the-refusal-record-is-not-conditional-on-the-gate';",
   "  if (false)        return 'the-refusal-record-is-not-conditional-on-the-gate';",
   'the predicate computed and ignored — the branch, not the predicate'],
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
const SQL = { seed: grab('SQL_SEED'), monthSeed: grab('SQL_MONTH_SEED'), siteSeed: grab('SQL_SITE_SEED'), snapshot: grab('SQL_SNAPSHOT'),
              gate: grab('SQL_GATE'), refusal: grab('SQL_REFUSAL'), siteCharge: grab('SQL_SITE_CHARGE'), monthCharge: grab('SQL_MONTH_CHARGE'), charge: grab('SQL_CHARGE') };
const om = /export const ODDS_CHARGE_ORDER\s*=\s*\[([^\]]*)\]/.exec(src);
const ORDER = om ? [...om[1].matchAll(/'([^']+)'/g)].map((x) => x[1]) : [];
if (Object.values(SQL).some((v) => !v) || ORDER.length !== 9 || ORDER.some((k) => !(k in SQL))) {
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
// Each replacement keeps the number of placeholders, so the binds still fit and
// the only thing that changes is that the predicate no longer binds.
const GATE_DAY = '(SELECT used FROM odds_budget WHERE day = ?) + ? <= ?';
const GATE_MONTH = '(SELECT used FROM odds_budget_month WHERE month = ?) + ? <= ?';
const GATE_SITE = '(SELECT used FROM odds_budget_site WHERE day = ? AND site = ?) + ? <= ?';
const NOT_NULL = (n) => Array(n).fill('? IS NOT NULL').join(' AND ');
const EXISTS = 'EXISTS (SELECT 1 FROM odds_budget_gate WHERE token = ?)';

/** Run a sequence of calls on real SQLite and report the three counters, how many
 *  calls charged, and each call's verdict.
 *  `split` models the pre-2026-10-18 shape in the new statements: everything up to
 *  and including the gate and the day's and site's charges in one transaction, then
 *  the month's charge in a second. `stopAt` stops call N where a cancellation can
 *  land: between the two transactions in the split shape, mid-batch (rolled back)
 *  in the single one. */
function run({ order = ORDER, sql = {}, ceiling = 100, limit = 1000, siteCap = 1000, units = 30, calls = 5, split = false, stopAt = null } = {}) {
  const S = { ...SQL, ...sql };
  const db = new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE odds_budget (day TEXT PRIMARY KEY, used INTEGER NOT NULL DEFAULT 0);
           CREATE TABLE odds_budget_site (day TEXT, site TEXT, used INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (day, site));
           CREATE TABLE odds_budget_month (month TEXT PRIMARY KEY, used INTEGER NOT NULL DEFAULT 0);
           CREATE TABLE odds_budget_gate (id INTEGER PRIMARY KEY, token TEXT NOT NULL);
           CREATE TABLE odds_budget_refusal (day TEXT NOT NULL, scope TEXT NOT NULL, site TEXT NOT NULL, first_at TEXT NOT NULL,
                                             n INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (day, scope, site));`);
  const verdicts = [];
  for (let i = 0; i < calls; i++) {
    const tok = `call-${i}`;
    const R = {
      seed:        () => db.prepare(S.seed).run('D', 0),
      monthSeed:   () => db.prepare(S.monthSeed).run('M', 0),
      siteSeed:    () => db.prepare(S.siteSeed).run('D', 'a'),
      snapshot:    () => db.prepare(S.snapshot).all('D', 'M', 'D', 'a'),
      gate:        () => db.prepare(S.gate).run(tok, 'D', units, ceiling, 'M', units, limit, 'D', 'a', units, siteCap),
      refusal:     () => db.prepare(S.refusal).all('D', 'D', units, ceiling, 'M', units, limit, 'a', `2026-11-05T00:00:0${i}.000Z`, tok),
      siteCharge:  () => db.prepare(S.siteCharge).run(units, 'D', 'a', tok),
      monthCharge: () => db.prepare(S.monthCharge).all(units, 'M', tok),
      charge:      () => db.prepare(S.charge).all(units, 'D', tok),
    };
    const out = {};
    if (split) {
      db.exec('BEGIN');
      for (const k of order.filter((x) => x !== 'monthCharge')) out[k] = R[k]();
      db.exec('COMMIT');
      if (stopAt !== i) {
        db.exec('BEGIN');
        out.monthCharge = R.monthCharge();
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
    verdicts.push(!!(out.charge && out.charge.length));
  }
  const g = (q) => db.prepare(q).get()?.v ?? 0;
  const daily = g("SELECT used v FROM odds_budget WHERE day='D'");
  const sum   = g("SELECT SUM(used) v FROM odds_budget_site WHERE day='D'");
  const month = g("SELECT used v FROM odds_budget_month WHERE month='M'");
  // The refusal record: its rows by scope, with the call counts they hold. A call
  // that charged files nothing, a call that was refused files exactly one count.
  const recorded = {};
  for (const r of db.prepare('SELECT scope, SUM(n) AS n FROM odds_budget_refusal GROUP BY scope').all()) recorded[r.scope] = Number(r.n);
  const recordedN = Object.values(recorded).reduce((a, v) => a + v, 0);
  return { daily, sum, month, verdicts, charged: verdicts.filter(Boolean).length, diverged: daily !== sum || month !== daily, limit,
           recorded, recordedOk: recordedN === verdicts.filter((v) => !v).length };
}
const fmt = (r) => `daily=${r.daily} sum=${r.sum} month=${r.month} charged=${r.charged}/${r.verdicts.length} refused-on-record=${JSON.stringify(r.recorded)}`;

console.log('\n── executed against real SQLite, on the statements read from the source ──');
// Three metrics, because no one of them sees every defect: (A) the three counters
// agree; (B) the right NUMBER of calls charge when a limit binds, which is the only
// thing that sees a limit that stopped binding (daily and month still agree then);
// (C) a stop inside the one batch rolls back.
// A call refused by the MONTH or the SITE charges neither the day nor the site
// since 2026-10-28, so the counters stay level there as well.
const control   = run();
const ctlMonth  = run({ limit: 60, ceiling: 1000 });
const ctlSite   = run({ siteCap: 60, ceiling: 1000 });
const ctlStop   = run({ stopAt: 1 });
const ctlBoth   = run({ ceiling: 60, limit: 60 });
const levelAt = (r, n, total) => !r.diverged && r.charged === n && r.daily === total;
const controls = [
  ['the source order ' + ORDER.join(' -> '), control, levelAt(control, 3, 90)],
  ['the day ceiling binds (100 in units of 30: three charge)', control, control.charged === 3],
  ['the month limit binds, and a month veto charges neither the day nor the site (limit 60)', ctlMonth, levelAt(ctlMonth, 2, 60)],
  ['the site cap binds, and a site veto charges neither the day nor the month (cap 60)', ctlSite, levelAt(ctlSite, 2, 60)],
  ['a stop inside the one batch rolls back', ctlStop, !ctlStop.diverged],
  // The record: one count per refused call, under the limit that refused, day first.
  ['a day refusal is filed once per refused call, under the day', control, control.recordedOk && JSON.stringify(control.recorded) === '{"day":2}'],
  ['a month refusal is filed under the month', ctlMonth, ctlMonth.recordedOk && JSON.stringify(ctlMonth.recorded) === '{"month":3}'],
  ['a site refusal is filed under the site', ctlSite, ctlSite.recordedOk && JSON.stringify(ctlSite.recorded) === '{"site":3}'],
  ['the day is asked before the month when both are over', ctlBoth, ctlBoth.recordedOk && JSON.stringify(ctlBoth.recorded) === '{"day":3}'],
];
let controlsOk = true;
for (const [name, r, ok] of controls) {
  console.log(`${ok ? 'OK        ' : 'BROKEN    '} ${name}   ${fmt(r)}`);
  if (!ok) controlsOk = false;
}
if (!controlsOk) { console.log('            a control failed; nothing below is readable'); process.exit(1); }

const moveBefore = (order, k, before) => { const o = order.filter((x) => x !== k); o.splice(o.indexOf(before), 0, k); return o; };
let E;
try {
  E = [
    ['E1 the site charge runs before the gate',
     run({ order: moveBefore(ORDER, 'siteCharge', 'gate') }), (r) => r.diverged || r.charged !== 3,
     'it finds the PREVIOUS call\'s token, so the site never moves with the day: the split falls behind the total'],
    ['E2 the site charge ignores the gate',
     run({ sql: { siteCharge: mutate(SQL.siteCharge, EXISTS, '? IS NOT NULL') } }), (r) => r.diverged,
     'a vetoed call bumps the split and not the total — the positive gap (daily 90 / sum 150)'],
    ['E3 the day charge ignores the gate',
     run({ sql: { charge: mutate(SQL.charge, EXISTS, '? IS NOT NULL') } }), (r) => r.diverged,
     'the total runs past the cap while the split stops at it — the negative gap (daily 150 / sum 90), the 2026-09-19 sign'],
    ['E4 the month charge ignores the gate',
     run({ sql: { monthCharge: mutate(SQL.monthCharge, EXISTS, '? IS NOT NULL') } }), (r) => r.diverged,
     'a day-vetoed call charges the month — the month ahead of the day'],
    ['E5 the gate loses the day ceiling',
     run({ sql: { gate: mutate(SQL.gate, GATE_DAY, NOT_NULL(3)) } }), (r) => r.charged !== 3,
     'the day ceiling stops binding: all five calls charge. The counters still agree, so only the count sees it'],
    ['E6 the gate loses the month limit',
     run({ limit: 60, ceiling: 1000, sql: { gate: mutate(SQL.gate, GATE_MONTH, NOT_NULL(3)) } }), (r) => r.charged !== 2,
     'the 85,000 hard limit stops binding; daily and month still agree, so only the limit metric sees it'],
    ['E7 the gate loses the site cap',
     run({ siteCap: 60, ceiling: 1000, sql: { gate: mutate(SQL.gate, GATE_SITE, NOT_NULL(4)) } }), (r) => r.charged !== 2,
     'the cap stops binding and the consumer it exists to stop spends the whole day'],
    ['E8 the gate row is never replaced (INSERT OR IGNORE)',
     run({ sql: { gate: mutate(SQL.gate, 'INSERT OR REPLACE INTO odds_budget_gate', 'INSERT OR IGNORE INTO odds_budget_gate') } }), (r) => r.charged !== 3,
     'the first token stays in the row and every later call finds a token that is not its own: one call charges, then the guard refuses everything with room'],
    ['E9 the month charged in a SECOND transaction, stopped between them',
     run({ split: true, stopAt: 1 }), (r) => r.diverged,
     'THE CHANGE OF 2026-10-18, reverted: day and site commit, the month never runs — the "month short" its 2,766-credit measurement found'],
    // THE REFUSAL RECORD. Counters and charges are untouched by each of these, so
    // only the record metric (one count per refused call, under its limit) sees them.
    ['E10 the refusal is recorded on every call',
     run({ sql: { refusal: mutate(SQL.refusal, 'WHERE NOT EXISTS', 'WHERE EXISTS') } }), (r) => !r.recordedOk,
     'every admitted call files a refusal, and a day that refused nothing reads as one that did'],
    ['E11 the refusal is never recorded',
     run({ sql: { refusal: mutate(SQL.refusal, 'WHERE NOT EXISTS (SELECT 1 FROM odds_budget_gate WHERE token = ?)', 'WHERE NOT EXISTS (SELECT 1 FROM odds_budget_gate WHERE token = ? OR 1 = 1)') } }), (r) => !r.recordedOk,
     'a refusal is decided and not recorded: fix 3 E back, with the record that was meant to close it'],
    ['E12 the refusal\'s day and month LABELS are swapped (a day veto is filed as a month veto when both are over)',
     run({ ceiling: 60, limit: 60, sql: { refusal: mutate(mutate(mutate(SQL.refusal, "THEN 'day'", "THEN 'TMP'"), "THEN 'month'", "THEN 'day'"), "THEN 'TMP'", "THEN 'month'") } }),
     (r) => JSON.stringify(r.recorded) !== '{"day":3}',
     'the record and the reason (_vetoFromBatch asks the day first) would disagree, and chargeOdds would degrade open on every such call'],
    ['E13 repeats are not counted',
     run({ sql: { refusal: mutate(SQL.refusal, 'n = n + 1', 'n = 1') } }), (r) => !r.recordedOk,
     'a caller retried against a refusal reads as refused once'],
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
console.log("COVERAGE: the check's predicates via --self-test, and the SQL's real behaviour via");
console.log('node:sqlite over a single-threaded sequence of 5 calls, using the nine statements and the order read');
console.log(`from ${HELPERS}. It does NOT exercise D1, concurrency between isolates, or batch() atomicity — the`);
console.log("transaction is Cloudflare's guarantee. The real chargeOdds against a reference model is");
console.log('scripts/check-odds-site-caps.mjs, with its own mutants in scripts/mutate-odds-site-caps.mjs.');
process.exit(caught === total ? 0 : 1);
