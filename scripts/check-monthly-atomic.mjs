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
//
// AND THEN, 2026-10-18: ONE BATCH. The month was still a SECOND D1 batch, sent
// after the day's had returned, so anything that stopped between the two kept
// the day's charge and lost the month's — odds_budget_month read 2,766 short of
// the daily rows (outbox/odds-counter-internal-2026-10-18.md). chargeOdds now
// sends seed, monthSeed, site, monthCharge and charge as ONE batch, and this
// runs that batch: the statements and their order read from the source, every
// placeholder bound, inside one transaction. Then it runs chargeOdds ITSELF,
// imported from the source, against a D1 made of node:sqlite, because which
// veto key a refusal writes is decided by branch order, and SQL cannot see it.
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const HELPERS = process.env.BUDGET_HELPERS_SRC || 'src/budget-helpers.js';
const src = readFileSync(HELPERS, 'utf8');

let bad = 0, n = 0;
const eq = (label, got, want) => { n++;
  if (JSON.stringify(got) === JSON.stringify(want)) console.log(`ok    ${label}`);
  else { bad++; console.log(`FAIL  ${label}\n        got  ${JSON.stringify(got)}\n        want ${JSON.stringify(want)}`); } };
const ok = (label, cond, why) => { n++;
  if (cond) console.log(`ok    ${label}`);
  else { bad++; console.log(`FAIL  ${label}\n        ${why}`); } };

// ── The SQL and the order, pulled from the source so the test cannot drift ──
const grab = (name) => {
  const m = new RegExp(`const ${name}\\s*=\\s*(\`[^\`]*\`|'[^']*')`).exec(src);
  return m ? m[1].slice(1, -1) : null;
};
const SQL = { seed: grab('SQL_SEED'), monthSeed: grab('SQL_MONTH_SEED'), site: grab('SQL_SITE'),
              monthCharge: grab('SQL_MONTH_CHARGE'), charge: grab('SQL_CHARGE') };
const FIX = grab('SQL_FIX_MONTH');
const om = /export const ODDS_CHARGE_ORDER\s*=\s*\[([^\]]*)\]/.exec(src);
const ORDER = om ? [...om[1].matchAll(/'([^']+)'/g)].map((x) => x[1]) : [];
ok('the charge SQL and its order are in the source',
  Object.values(SQL).every(Boolean) && !!FIX && ORDER.length === 5 && ORDER.every((k) => k in SQL),
  `the statements or ODDS_CHARGE_ORDER could not be read (order ${JSON.stringify(ORDER)}), so nothing below was executed against them`);
if (bad) { console.log(`\n${n - bad} of ${n} passed.`); process.exit(1); }

const SCHEMA = `CREATE TABLE odds_budget (day TEXT PRIMARY KEY, used INTEGER NOT NULL DEFAULT 0);
  CREATE TABLE odds_budget_site (day TEXT NOT NULL, site TEXT NOT NULL, used INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (day, site));
  CREATE TABLE odds_budget_month (month TEXT PRIMARY KEY, used INTEGER NOT NULL DEFAULT 0);`;
const fresh = () => { const d = new DatabaseSync(':memory:'); d.exec(SCHEMA); return d; };

// Mirrors chargeOdds's binds, BY NAME. node:sqlite binds a missing parameter as
// NULL without a word, and a NULL in a ceiling predicate reads as a veto — so a
// short bind list would turn every charge into a refusal and every "a veto
// moves nothing" assertion into a pass. The count is asserted, not trusted.
const D = '2026-10-18', M = '2026-10', BIG = 1e9;
function batch(db, { units = 30, carried = 0, carriedMonth = 0, ceiling = BIG, limit = BIG, site = 'a' } = {}) {
  const binds = {
    seed: [D, carried], monthSeed: [M, carriedMonth],
    site: [D, site, units, D, units, ceiling],
    monthCharge: [units, M, units, limit, D, units, ceiling],
    charge: [units, D, units, ceiling],
  };
  const out = {};
  db.exec('BEGIN');
  try {
    for (const k of ORDER) {
      const want = (SQL[k].match(/\?/g) || []).length;
      if (want !== binds[k].length) throw new Error(`${k} has ${want} placeholders and ${binds[k].length} binds`);
      out[k] = db.prepare(SQL[k]).all(...binds[k]);
    }
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
  return {
    day: out.charge.length ? out.charge[0].used : null,       // null = vetoed
    month: out.monthCharge.length ? out.monthCharge[0].used : null,
  };
}
const counters = (db) => ({
  day:   db.prepare('SELECT used FROM odds_budget WHERE day = ?').get(D)?.used ?? null,
  site:  db.prepare('SELECT SUM(used) s FROM odds_budget_site WHERE day = ?').get(D)?.s ?? null,
  month: db.prepare('SELECT used FROM odds_budget_month WHERE month = ?').get(M)?.used ?? null,
});

// ── The month's ceiling, through the real batch. The DAY ceiling is set out of
//    reach so the month's own limit is the predicate that binds. ─────────────
{
  const db = fresh();
  const LIMIT = 100;
  const charge = (units, o = {}) => batch(db, { units, limit: LIMIT, ...o }).month;
  eq('the first charge lands and RETURNING gives the post-charge total', charge(30), 30);
  eq('the second', charge(30), 60);
  eq('the third', charge(30), 90);
  eq('THE CEILING BINDS: a charge that would exceed it returns no row', charge(30), null);
  eq('...and moved nothing', counters(db).month, 90);
  eq('a charge that exactly reaches the ceiling is allowed', charge(10), 100);
  eq('and the next is refused', charge(1), null);
}

// ── THE SEED IS THE FINANCIALLY DANGEROUS PART ────────────────────────────
// odds:credits:2026-09 stood near 60,948 of 85,000 at cutover. A fresh row at 0
// would hand the month a SECOND full ceiling before the hard limit bound again.
{
  const d2 = fresh();
  const r = batch(d2, { units: 10, carriedMonth: 95, limit: 100 });
  eq('a seeded month starts from the carried KV total, not from zero', counters(d2).month, 95);
  eq('...so a charge past the ceiling is refused on the FIRST call after cutover', r.month, null);
  // A second isolate seeding the same month must not add the carry again.
  d2.prepare(SQL.monthSeed).run(M, 95);
  eq('a second seed of the same month is a no-op, not a double count', counters(d2).month, 95);
}

// ── The correction carries no ceiling, and clamps at zero ─────────────────
{
  const db = fresh();
  for (let i = 0; i < 3; i++) batch(db, { units: 30, limit: 100 });
  batch(db, { units: 10, limit: 100 });                     // the month at its ceiling, 100
  db.prepare(FIX).run(-40, M);
  eq('a refund applies even with the month at its ceiling', counters(db).month, 60);
  db.prepare(FIX).run(-1000, M);
  eq('a refund cannot drive the counter negative', counters(db).month, 0);
  db.prepare(FIX).run(25, M);
  eq('a positive correction applies too', counters(db).month, 25);
}

// ── ONE BATCH: the day and the month move together or not at all ──────────
{
  // (A) A DAY VETO MOVES NOTHING. The month statement carries the day's
  // predicate, so it refuses on the same condition the day does — what the
  // two-batch code got by never sending the month batch after a day veto.
  const db = fresh();
  for (let i = 0; i < 3; i++) batch(db, { units: 30, ceiling: 100 });
  const before = counters(db);
  const r = batch(db, { units: 30, ceiling: 100 });
  eq('A  a day veto: the day returns no row', r.day, null);
  eq('A  ...and the month returns no row either', r.month, null);
  eq('A  ...and day, site and month are all unmoved', counters(db), before);
}
{
  // (B) THE DAY CHARGES, THE MONTH REFUSES. Day and site keep the charge and
  // the call is refused — today's behaviour, pinned, because the two-batch
  // code's day batch had committed before its month batch ran.
  const db = fresh();
  batch(db, { units: 30, limit: 60 }); batch(db, { units: 30, limit: 60 });
  const r = batch(db, { units: 30, limit: 60 });
  eq('B  day ok, month at its limit: the day charges', r.day, 90);
  eq('B  ...the month returns no row', r.month, null);
  eq('B  ...day and site moved, the month did not', counters(db), { day: 90, site: 90, month: 60 });
  eq('B  ...and the verdict is a refusal', r.day !== null && r.month !== null, false);
}
{
  // (C) THE EXACT DAY BOUNDARY. A pre-charge day at ceiling minus units charges
  // in all three. A month statement that read the POST-charge day total (it ran
  // after charge), or a site statement that did, would refuse here alone.
  const db = fresh();
  const r = batch(db, { units: 30, carried: 70, ceiling: 100 });
  eq('C  the day lands exactly on its ceiling', r.day, 100);
  eq('C  ...and the site and the month charge with it', counters(db), { day: 100, site: 30, month: 30 });
}
{
  // (D) A FRESH DAY AND MONTH. Both seeds run before anything reads them, so
  // the first call of a day lands in all three, starting from the carried KV
  // totals. A seed after its reader leaves that reader comparing against NULL.
  const db = fresh();
  const r = batch(db, { units: 3, carried: 5, carriedMonth: 7, ceiling: 100, limit: 100 });
  eq('D  the first charge of a fresh day and month lands', [r.day, r.month], [8, 10]);
  eq('D  ...in all three counters, from the carried totals', counters(db), { day: 8, site: 3, month: 10 });
}

// ── chargeOdds ITSELF, against a D1 made of node:sqlite ────────────────────
// The verdict and the veto key are decided by code, not SQL: which result is
// read as the month's, and which veto is asked about first. Each case imports a
// fresh copy of the module (its seeds and table flag are per-isolate state).
let caseNo = 0;
async function charger() {
  return import(`${pathToFileURL(resolve(HELPERS)).href}?case=${++caseNo}`);
}
function fakeD1(db, { throwOnCharge = null } = {}) {
  const stmt = (sql, args = []) => ({ sql, args, bind: (...a) => stmt(sql, a) });
  return {
    prepare: (sql) => stmt(sql),
    batch: async (stmts) => {
      db.exec('BEGIN');
      try {
        const out = stmts.map((s, i) => {
          if (throwOnCharge && stmts.length === ORDER.length && i === 3) throw new Error(throwOnCharge);
          return { results: db.prepare(s.sql).all(...s.args), success: true };
        });
        db.exec('COMMIT');
        return out;
      } catch (e) { db.exec('ROLLBACK'); throw e; }
    },
  };
}
// KV by PATTERN, so the case does not depend on predicting the worker's clock:
// the day's and the month's carried totals answer for whatever date it reads.
// `failVeto` makes KV refuse the veto's warned key, as a 429 does when
// concurrent isolates write that key inside one second on the first ceiling hit.
// 'get' / 'put' fail the day's AND the month's veto key; a '-day' suffix fails
// only the day's, so a day-veto error that falls through to the month block is
// visible. 'unprintable' rejects with a value String() cannot convert.
function fakeKV({ day = null, month = null, failVeto = null } = {}) {
  const m = new Map(), puts = [];
  const veto = (k) => failVeto && (failVeto.endsWith('-day') ? DAY_KEY.test(k) : /:warned(?::limit)?$/.test(k));
  return {
    get: async (k) => {
      if (veto(k) && failVeto.startsWith('get')) throw new Error('KV GET failed: 429 Too Many Requests');
      if (veto(k) && failVeto === 'unprintable') throw Object.create(null);
      return m.has(k) ? m.get(k)
        : /^odds:daily:\d{4}-\d{2}-\d{2}$/.test(k) ? day
        : /^odds:credits:\d{4}-\d{2}$/.test(k) ? month : null;
    },
    put: async (k, v) => {
      if (veto(k) && failVeto.startsWith('put')) throw new Error('KV PUT failed: 429 Too Many Requests');
      m.set(k, String(v)); puts.push([k, String(v)]);
    },
    puts,
  };
}
async function call({ day = null, month = null, units = 3, throwOnCharge = null, failVeto = null } = {}) {
  const mod = await charger();
  const db = new DatabaseSync(':memory:');               // ensureOddsBudgetTables makes the tables
  const kv = fakeKV({ day, month, failVeto });
  const warn = console.warn; console.warn = () => {};
  let r;
  try { r = await mod.chargeOdds({ FIELD_JOURNALISM: kv, ARCHIVE_DB: fakeD1(db, { throwOnCharge }) }, units, 'probe'); }
  finally { console.warn = warn; }
  const one = (q) => { try { return db.prepare(q).get()?.v ?? null; } catch { return null; } };
  return { r, puts: kv.puts.map(([k]) => k), vals: Object.fromEntries(kv.puts),
           day: one('SELECT SUM(used) v FROM odds_budget'), site: one('SELECT SUM(used) v FROM odds_budget_site'),
           month: one('SELECT SUM(used) v FROM odds_budget_month') };
}
const DAY_KEY = /^odds:daily:\d{4}-\d{2}-\d{2}:warned$/, LIMIT_KEY = /^odds:credits:\d{4}-\d{2}:warned:limit$/;
{
  const c = await call();
  eq('F  both charge: chargeOdds returns true', c.r, true);
  eq('F  ...day, site and month each +3', [c.day, c.site, c.month], [3, 3, 3]);
  ok('F  ...and no veto key is written', !c.puts.some((k) => DAY_KEY.test(k) || LIMIT_KEY.test(k)), JSON.stringify(c.puts));
}
{
  // THE DAY VETO IS ASKED FIRST. monthCharge returns no row on a day veto too,
  // so code that asked about the month first would write the month's limit key
  // and never the day's — and /budget/odds would say no ceiling was reached on
  // a day that refused calls.
  const c = await call({ day: String(BIG) });
  eq('F  a day veto: chargeOdds returns false', c.r, false);
  ok("F  ...writes the day's warned key, as an ISO timestamp",
    c.puts.some((k) => DAY_KEY.test(k) && /^\d{4}-\d{2}-\d{2}T/.test(c.vals[k])), JSON.stringify(c.vals));
  ok("F  ...and NOT the month's limit key", !c.puts.some((k) => LIMIT_KEY.test(k)), JSON.stringify(c.puts));
  eq('F  ...and moves nothing', [c.day, c.site, c.month], [BIG, null, 0]);
}
{
  // AT THE DAY BOUNDARY, through chargeOdds's OWN binds. The day veto above uses
  // a pre-day of 1e9, past every ceiling, so it cannot tell a right bind in the
  // month's day predicate from a wrong one. Here the pre-day sits one credit
  // either side of ceiling - units. The ceiling is read from the module, so a
  // grant day does not move the boundary out from under the case.
  const CEIL = (await (await charger()).peekDailyOdds({ FIELD_JOURNALISM: fakeKV() })).ceiling;
  // SEVERAL UNIT SIZES. With units = 3 only, a literal 3 in a day-predicate
  // bind is indistinguishable from `units`; real costs are markets x regions,
  // x10 for /v4/historical/.
  for (const u of [1, 3, 30]) {
    const lo = await call({ day: String(CEIL - u), month: '1000', units: u });
    eq(`G  units=${u}, pre-day = ceiling - units: chargeOdds returns true`, lo.r, true);
    eq(`G  units=${u} ...day, site and month all move by units`, [lo.day, lo.site, lo.month], [CEIL, u, 1000 + u]);
    const hi = await call({ day: String(CEIL - u + 1), month: '1000', units: u });
    eq(`G  units=${u}, pre-day = ceiling - units + 1: chargeOdds returns false`, hi.r, false);
    eq(`G  units=${u} ...and day, site and month are all unmoved`, [hi.day, hi.site, hi.month], [CEIL - u + 1, null, 1000]);
    ok(`G  units=${u} ...filed as the DAY veto`, hi.puts.some((k) => DAY_KEY.test(k)) && !hi.puts.some((k) => LIMIT_KEY.test(k)), JSON.stringify(hi.puts));
  }
}
{
  // (H) A VETO STAYS A VETO WHEN ITS WARNING CANNOT BE RECORDED. The batch has
  // committed its verdict; a KV throw on the warned key reaching the outer
  // catch would degrade open, let the call spend, and leave the month limit
  // unasked. Found by the 2026-10-18 review with a differential harness.
  // 'unprintable': the catch's own warning must not throw on into the outer
  // catch, which would degrade open.
  for (const op of ['get', 'put', 'unprintable']) {
    const d = await call({ day: String(BIG), month: '84999', failVeto: op });
    eq(`H  a day veto with the warned-key ${op} throwing: chargeOdds returns false`, d.r, false);
    ok(`H  ...and is not counted as a degrade-open`, !d.puts.some((k) => /^odds:degraded:/.test(k)), JSON.stringify(d.puts));
    if (op !== 'unprintable') {
      // Only the DAY's key failing, the month far from its limit: a day-veto
      // error must not fall through and file the month's hard limit, whose key
      // gates a once-a-month warning for 60 days.
      const d2 = await call({ day: String(BIG), month: '1000', failVeto: `${op}-day` });
      eq(`H  a day veto with ONLY the day's warned-key ${op} throwing: chargeOdds returns false`, d2.r, false);
      ok(`H  ...and is NOT filed as the month's hard limit`, !d2.puts.some((k) => LIMIT_KEY.test(k)), JSON.stringify(d2.puts));
    }
    const mo = await call({ month: '84999', failVeto: op });
    eq(`H  a month veto with the limit-key ${op} throwing: chargeOdds returns false`, mo.r, false);
    ok(`H  ...and is not counted as a degrade-open`, !mo.puts.some((k) => /^odds:degraded:/.test(k)), JSON.stringify(mo.puts));
  }
}
{
  const c = await call({ month: '84999' });
  eq('F  a month veto: chargeOdds returns false', c.r, false);
  ok("F  ...writes the month's limit key", c.puts.some((k) => LIMIT_KEY.test(k)), JSON.stringify(c.puts));
  ok("F  ...and NOT the day's warned key — the day did not veto", !c.puts.some((k) => DAY_KEY.test(k)), JSON.stringify(c.puts));
  eq('F  ...day and site charged, the month did not', [c.day, c.site, c.month], [3, 3, 84999]);
}
{
  // (E) THE LADDER READS THE MONTH'S OWN ROW. The day's charge is the LAST
  // result now; read from there, a month crossing 50% would compare a day's
  // total of 3 against 42,500 and stay silent.
  const c = await call({ month: '42499' });
  eq('E  a charge across 50% of the month returns true', c.r, true);
  ok('E  ...and writes the 50% warning, read from the month\'s RETURNING',
    c.puts.some((k) => /^odds:credits:\d{4}-\d{2}:warned:50$/.test(k)), JSON.stringify(c.puts));
}
{
  // THE ONE SEMANTIC CHANGE, on the failure path: a throw charges neither and
  // is counted once, under the new `charge:` prefix.
  const c = await call({ throwOnCharge: 'D1_ERROR: D1 DB is overloaded. Requests queued for too long.' });
  eq('F  a thrown batch degrades open: chargeOdds returns true', c.r, true);
  eq('F  ...nothing was charged', [c.day, c.site, c.month], [null, null, null]);
  const deg = Object.entries(c.vals).find(([k]) => /^odds:degraded:\d{4}-\d{2}-\d{2}$/.test(k));
  const v = deg ? JSON.parse(deg[1]) : null;
  ok('F  ...and it is counted ONCE, under charge:',
    !!v && v.events === 1 && v.credits === 3 && Object.keys(v.reasons || {}).length === 1
      && Object.keys(v.reasons)[0].startsWith('charge: D1_ERROR'),
    JSON.stringify(v));
}

// ── The wiring: one implementation, three delegating call sites ───────────
// THE VERDICT MUST BE RETURNED, IN ANY EQUIVALENT SPELLING. Exact text
// (`return chargeOdds(env, units, site);`) failed `const charged = await
// chargeOdds(env, units, site); return charged;`, which behaves identically,
// so wiring this into deploy.yml would have blocked a deploy on correct code
// (docs/CC-CMD-2026-10-18-odds-gate-reads-wrapper-bodies.md, TASK 0.4).
// Accepted:
//   return [await] chargeOdds(env, units, site);
//   const x = await chargeOdds(env, units, site);  ...  return x;
// A verdict that is computed and then dropped (`return true;`) is not.
function returnsChargeVerdict(text) {
  // Whole-line comments out first, so a commented-out return is not a return.
  const body = text.replace(/^[ \t]*\/\/.*$/gm, '');
  if (/\breturn\s+(?:await\s+)?chargeOdds\(\s*env\s*,\s*units\s*,\s*site\s*\)\s*;/.test(body)) return true;
  const m = /\b(?:const|let)\s+([A-Za-z_$][\w$]*)\s*=\s*await\s+chargeOdds\(\s*env\s*,\s*units\s*,\s*site\s*\)\s*;/.exec(body);
  if (!m) return false;
  const after = body.slice(m.index + m[0].length);
  return new RegExp(`\\breturn\\s+${m[1].replace(/\$/g, '\\$')}\\s*;`).test(after);
}
const files = {
  'src/index.js':       [readFileSync(process.env.INDEX_SRC || 'src/index.js', 'utf8'), 'consumeOddsCredit'],
  'src/wp-resolver.js': [readFileSync(process.env.WP_RESOLVER_SRC || 'src/wp-resolver.js', 'utf8'), 'consumeOddsCredit'],
  'src/ambient-do.js':  [readFileSync(process.env.AMBIENT_DO_SRC || 'src/ambient-do.js', 'utf8'), '_consumeAmbientOddsCredit'],
};
for (const [f, [text, name]] of Object.entries(files)) {
  const i = text.indexOf(`async function ${name}(`);
  const j = i < 0 ? -1 : text.indexOf('\n}\n', i);
  const body = (i < 0 || j < 0) ? '' : text.slice(i, j);
  ok(`${f} ${name} delegates to chargeOdds, with its site`, returnsChargeVerdict(body),
    body ? 'the wrapper no longer returns the one batch\'s verdict, site included: a refusal would not stop the call' : `${name} was not found`);
  ok(`${f} ${name} references neither removed charger`, !!body && !/checkAndIncrementDailyOdds\(|chargeMonthlyOdds\(/.test(body),
    'the day and the month charged in two calls is the split this change removed');
  ok(`${f} imports neither removed charger`,
    !/import \{[^}]*\b(?:checkAndIncrementDailyOdds|chargeMonthlyOdds)\b[^}]*\} from '\.\/budget-helpers\.js'/.test(text),
    'budget-helpers.js no longer exports them, so the bundle would fail with "No matching export" — and check-imports-resolve does not see a stale import');
  ok(`${f} no longer writes the monthly key itself`,
    !/FIELD_JOURNALISM\.put\(key, String\((?:used \+ units|next)\)/.test(text),
    'a surviving read-modify-write reintroduces the lost update for every path through it');
}
{
  const i = src.indexOf('async function chargeOdds(');
  const j = i < 0 ? -1 : src.indexOf('\n}\n', i);
  const body = (i < 0 || j < 0) ? '' : src.slice(i, j);
  eq('chargeOdds sends exactly ONE batch', body.split('db.batch([').length - 1, 1);
}

ok('the threshold ladder survived the collapse',
  /const ODDS_THRESHOLDS = \[/.test(src) && /of monthly limit reached/.test(src),
  'index.js and wp-resolver.js each fired these; dropping them in a refactor is a silent behaviour change (Rule 69)');

ok('the hard limit has ONE definition',
  /export const ODDS_HARD_LIMIT = 85000;/.test(src),
  'it was written out four times, each with a comment asking the next person to sync it by hand');

console.log(`\n${n - bad} of ${n} passed.`);
console.log('COVERAGE: the five charge statements executed in their source order against');
console.log('real node:sqlite, chargeOdds itself run against a node:sqlite D1 and a fake KV,');
console.log('and the wiring of three call sites. It does NOT run in a Worker and says nothing');
console.log('about whether D1 supplies a transaction under concurrent isolates — that is');
console.log('the same unverified premise Task 2 left standing for the daily batch.');
process.exit(bad ? 1 : 0);
