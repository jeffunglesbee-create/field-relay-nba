#!/usr/bin/env node
/**
 * TASK 3 of docs/CC-CMD-2026-09-16-odds-spend-attribution.md. Per-site caps on
 * the odds guard, and the month veto charging neither the day nor the site.
 *
 * THE REAL chargeOdds, AGAINST A REFERENCE MODEL.
 * The model is four lines: a call is allowed when the day, the month and the
 * site each have room over their PRE-charge totals; if allowed all three move by
 * `units`, if not none does. chargeOdds is imported from the source and run on a
 * D1 made of node:sqlite, over thousands of random sequences whose starting
 * totals sit within a few credits of a limit, so the boundary is crossed on
 * nearly every sequence. Verdict, all three totals and the veto stamps are
 * compared after EVERY call.
 *
 * WHY A MODEL AND NOT A SHAPE CHECK. The 2026-10-23 premise test copied the
 * day's predicate onto a site statement: 398 of 400 sequences disagreed with the
 * model, because the later statements read totals the earlier ones had already
 * moved. A statement-by-statement reading of that SQL looks correct. Only
 * running it shows the difference, which is why this file runs it.
 *
 * THE CLOCK IS PINNED for the whole run (2026-10-28T12:00:00Z, a day with no grant),
 * because chargeOdds reads the clock on every call: a run that straddled 00:00 UTC
 * or a month end went red on its own, and in deploy.yml that blocks a deploy. The
 * day ceiling is a LITERAL here (3,800, and 6,300 on the granted 2026-09-13), not
 * read back from the module, so a change to the ceiling or to the grant's expiry
 * is a red check and not a model that follows the code.
 *
 * Rule 90: scripts/mutate-odds-site-caps.mjs breaks the source in each way that
 * matters and requires this file to go red.
 */
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const HELPERS = process.env.BUDGET_HELPERS_SRC || 'src/budget-helpers.js';
const SEQUENCES = Number(process.env.SITE_CAP_SEQUENCES || 2000);
const CALLS = 25;

// ── The clock, pinned. See the header. ──────────────────────────────────────
const RealDate = Date;
let clock = 0;
class PinnedDate extends RealDate {
  constructor(...a) { if (a.length) super(...a); else super(clock); }
  static now() { return clock; }
}
globalThis.Date = PinnedDate;
let D, M, DAY_STAMP, MONTH_STAMP;
function useDay(iso) {
  clock = RealDate.parse(`${iso}T12:00:00Z`);
  D = iso; M = iso.slice(0, 7);
  DAY_STAMP = `odds:daily:${D}:warned`; MONTH_STAMP = `odds:credits:${M}:warned:limit`;
}
useDay('2026-10-28');

let bad = 0, n = 0;
const eq = (label, got, want) => { n++;
  if (JSON.stringify(got) === JSON.stringify(want)) console.log(`ok    ${label}`);
  else { bad++; console.log(`FAIL  ${label}\n        got  ${JSON.stringify(got)}\n        want ${JSON.stringify(want)}`); } };
const ok = (label, cond, why) => { n++;
  if (cond) console.log(`ok    ${label}`);
  else { bad++; console.log(`FAIL  ${label}\n        ${why}`); } };

// ── The caps, pinned HERE as well as in the source. A cap changed in one place
//    only is a decision made by accident; the two must move together. ─────────
const EXPECT_CAPS = {
  ambientCaptureClosingOdds: 400,
  fetchSportOddsLive: 2000,
  fetchSportOddsHistorical: 1800,
  getWCPregameLambdas: 300,
};
const UNCAPPED = ['handleCFLOddsProbs', 'handleWCOddsProbs', 'ambientFetchLiveOdds', 'oddsProxyRoute', 'wpResolver', 'unattributed'];
const SITES = [...Object.keys(EXPECT_CAPS), ...UNCAPPED.slice(0, 2)];

// ── A D1 and a KV made of node:sqlite and a Map ───────────────────────────
const db = new DatabaseSync(':memory:');
function stmt(sql, args = []) {
  return {
    sql, args,
    bind: (...a) => stmt(sql, a),
    first: async () => db.prepare(sql).get(...args) ?? null,
    all: async () => ({ results: db.prepare(sql).all(...args) }),
    run: async () => { db.prepare(sql).run(...args); return { success: true }; },
  };
}
let throwOnBatch = null;
let tamperSnapshot = null;               // a function that rewrites the snapshot's row
const d1 = {
  prepare: (sql) => stmt(sql),
  batch: async (stmts) => {
    if (throwOnBatch && stmts.length > 3) throw new Error(throwOnBatch);
    db.exec('BEGIN');
    try {
      const out = stmts.map((s) => ({ results: db.prepare(s.sql).all(...s.args), success: true }));
      db.exec('COMMIT');
      if (tamperSnapshot && stmts.length > 3) {
        const i = stmts.findIndex((s) => /AS day_used/.test(s.sql));
        if (i >= 0) out[i] = { results: [tamperSnapshot(out[i].results[0])], success: true };
      }
      return out;
    } catch (e) { db.exec('ROLLBACK'); throw e; }
  },
};
const kvMap = new Map(), kvPuts = [];
// failKv: { op: 'get' | 'put' | 'unprintable', re } makes reads or writes of a key
// matching `re` throw, as a KV 429 does on the first refusal of a day;
// 'unprintable' rejects with a value String() cannot convert.
let failKv = null;
const kvFails = (k, ops) => failKv && failKv.re.test(k) && ops.includes(failKv.op);
const kv = {
  get: async (k) => {
    if (kvFails(k, ['get', 'unprintable'])) throw failKv.op === 'unprintable' ? Object.create(null) : new Error('KV GET failed: 429 Too Many Requests');
    return kvMap.has(k) ? kvMap.get(k) : null;
  },
  put: async (k, v) => {
    if (kvFails(k, ['put'])) throw new Error('KV PUT failed: 429 Too Many Requests');
    kvMap.set(k, String(v)); kvPuts.push(k);
  },
};
const env = { FIELD_JOURNALISM: kv, ARCHIVE_DB: d1 };

const mod = await import(`${pathToFileURL(resolve(HELPERS)).href}?site-caps`);
const { chargeOdds, ODDS_HARD_LIMIT, ODDS_DAILY_CEILING } = mod;
const CEIL = 3800, GRANTED_CEIL = 6300;    // literals: the standing ceiling, and 2026-09-13's (3,800 + 2,500)
const capOf = (site) => (site in EXPECT_CAPS ? EXPECT_CAPS[site] : Infinity);

const SITE_STAMP = (s) => `odds:daily:${D}:warned:site:${s}`;
const isVetoStamp = (k) => k === DAY_STAMP || k === MONTH_STAMP || k.startsWith(`odds:daily:${D}:warned:site:`);

async function quietly(fn) { const w = console.warn; console.warn = () => {}; try { return await fn(); } finally { console.warn = w; } }
// A throw out of chargeOdds is a result to assert on, not a crash of the check: the
// mutation harness counts a mutant as caught only on a failed assertion.
async function attempt(fn) { try { return await quietly(fn); } catch (e) { return `THREW: ${typeof e?.message === 'string' ? e.message : 'an unprintable rejection'}`; } }

// The first call creates the tables through ensureOddsBudgetTables; do it once so
// the resets below have tables to reset.
await quietly(() => chargeOdds(env, 1, 'unattributed'));
function reset() {
  for (const t of ['odds_budget', 'odds_budget_site', 'odds_budget_month', 'odds_budget_gate']) {
    try { db.exec(`DELETE FROM ${t}`); } catch { /* the gate table does not exist before this change */ }
  }
  kvMap.clear(); kvPuts.length = 0; throwOnBatch = null; tamperSnapshot = null; failKv = null;
}
function seed({ day = 0, month = 0, sites = {} } = {}) {
  db.prepare('INSERT OR REPLACE INTO odds_budget (day, used) VALUES (?, ?)').run(D, day);
  db.prepare('INSERT OR REPLACE INTO odds_budget_month (month, used) VALUES (?, ?)').run(M, month);
  for (const [s, u] of Object.entries(sites)) db.prepare('INSERT OR REPLACE INTO odds_budget_site (day, site, used) VALUES (?, ?, ?)').run(D, s, u);
}
const totals = () => ({
  day: db.prepare('SELECT used FROM odds_budget WHERE day = ?').get(D)?.used ?? 0,
  month: db.prepare('SELECT used FROM odds_budget_month WHERE month = ?').get(M)?.used ?? 0,
  site: Object.fromEntries(db.prepare('SELECT site, used FROM odds_budget_site WHERE day = ?').all(D).map((r) => [r.site, r.used])),
});
const stamps = () => new Set(kvPuts.filter(isVetoStamp));

// ── The model ──────────────────────────────────────────────────────────────
function modelCall(st, site, units) {
  const room = {
    day: st.day + units <= CEIL,
    month: st.month + units <= ODDS_HARD_LIMIT,
    site: (st.site[site] ?? 0) + units <= capOf(site),
  };
  if (room.day && room.month && room.site) {
    st.day += units; st.month += units; st.site[site] = (st.site[site] ?? 0) + units;
    return { charged: true, stamp: null };
  }
  // The day is asked first, then the month, then the site.
  return { charged: false, stamp: !room.day ? DAY_STAMP : !room.month ? MONTH_STAMP : SITE_STAMP(site) };
}

// ── The caps are what the CC-CMD says they are ────────────────────────────
{
  const caps = mod.SITE_CEILINGS || {};
  eq('the capped sites and their caps are the ones the CC-CMD records', caps, EXPECT_CAPS);
  ok('the CFL route and the sites with no measured demand carry no cap',
    UNCAPPED.every((s) => !(s in caps)), `a cap on a site whose charged spend is not its kept spend would bind on credits never billed: ${JSON.stringify(caps)}`);
}

// ── THE DAY CEILING AND ITS GRANT, pinned to literals ─────────────────────
// Before this, the day's ceiling here was read back from the module, so a change
// to it (or a grant that stopped expiring) moved the model with the code and every
// check stayed green.
{
  const peek = async (date) => (await mod.peekDailyOdds({ FIELD_JOURNALISM: { get: async () => null } }, date)).ceiling;
  eq('the standing day ceiling is 3,800', await peek('2026-10-28'), CEIL);
  eq('...the day before the grant', await peek('2026-09-12'), CEIL);
  eq('...the granted day carries the extra', await peek('2026-09-13'), GRANTED_CEIL);
  eq('...and the grant is gone the day after', await peek('2026-09-14'), CEIL);
}

// ── THE CAPPED SITES ARE THE LABELS THE CALL SITES PASS ─────────────────────
// A cap is keyed by a string; a caller passes a string. check-odds-attribution
// catches one side renamed. A CONSISTENT rename (the charge and the reconcile
// label both moved to another declared site) passes it, and the consumer is then
// uncapped with every check green. So: every capped key must be a declared site
// and must be passed as a charge label by a real call site.
{
  const text = ['INDEX_SRC', 'AMBIENT_DO_SRC', 'WP_RESOLVER_SRC']
    .map((e, i) => readFileSync(process.env[e] || ['src/index.js', 'src/ambient-do.js', 'src/wp-resolver.js'][i], 'utf8')).join('\n');
  const labels = (re) => new Set([...text.matchAll(re)].map((m) => m[1]));
  const charged = labels(/(?:_consumeAmbientOddsCredit|consumeOddsCredit)\(.*,\s*'([A-Za-z0-9_]+)'\)/g);
  const reconciled = labels(/reconcileOddsCredit\(.*,\s*'([A-Za-z0-9_]+)'\)/g);
  const declared = new Set(mod.ODDS_SITES);
  for (const k of Object.keys(mod.SITE_CEILINGS)) {
    ok(`${k} is a declared site`, declared.has(k), 'a cap on a name ODDS_SITES does not list is never read by /budget/odds');
    ok(`${k} is passed to the charger by a call site`, charged.has(k), `no consumeOddsCredit(..., '${k}') in src/index.js, src/ambient-do.js or src/wp-resolver.js: the cap is dead and the consumer is uncapped`);
  }
  ok('the sweep found the call sites at all', charged.size >= 8 && reconciled.size >= 6,
    `${charged.size} charge labels and ${reconciled.size} reconcile labels found: the pattern no longer matches how the call sites are written`);
  console.log(`        ${charged.size} charge labels, ${reconciled.size} reconcile labels read from the three files`);
}

// ── The boundary, site by site, through chargeOdds's OWN binds ─────────────
for (const [site, cap] of Object.entries(EXPECT_CAPS)) {
  for (const u of [1, 3, 30]) {
    reset(); seed({ sites: { [site]: cap - u } });
    const lo = await quietly(() => chargeOdds(env, u, site));
    eq(`${site} units=${u}, pre-site = cap - units: charged`, lo, true);
    eq(`${site} units=${u} ...day, month and site all moved by units`, [totals().day, totals().month, totals().site[site]], [u, u, cap]);
    reset(); seed({ sites: { [site]: cap - u + 1 } });
    const before = totals();
    const hi = await quietly(() => chargeOdds(env, u, site));
    eq(`${site} units=${u}, pre-site = cap - units + 1: refused`, hi, false);
    eq(`${site} units=${u} ...and day, month and site are all unmoved`, totals(), before);
    eq(`${site} units=${u} ...filed as the SITE veto only`, [...stamps()], [SITE_STAMP(site)]);
  }
}

// ── A site with no cap is not capped ───────────────────────────────────────
{
  reset(); seed({ sites: { handleCFLOddsProbs: 100000 } });
  eq('an uncapped site far above any cap still charges', await quietly(() => chargeOdds(env, 6, 'handleCFLOddsProbs')), true);
  eq('...and a site the vocabulary has never seen charges too', await quietly(() => chargeOdds(env, 3, 'a-new-site')), true);
}

// ── THE MONTH VETO CHARGES NEITHER THE DAY NOR THE SITE ───────────────────
// Until this change the day and the site kept their charge and the call was
// refused: under a month veto a retrying caller added up to 3 a poll to both with
// no vendor call (docs/CC-CMD-2026-10-23-odds-guard-accounting-edges.md, item 1).
{
  reset(); seed({ day: 100, month: ODDS_HARD_LIMIT - 2, sites: { fetchSportOddsLive: 50 } });
  const r = await quietly(() => chargeOdds(env, 3, 'fetchSportOddsLive'));
  eq('B  a month veto: chargeOdds returns false', r, false);
  eq('B  ...and the day, the month and the site are all unmoved', [totals().day, totals().month, totals().site.fetchSportOddsLive], [100, ODDS_HARD_LIMIT - 2, 50]);
  eq("B  ...and only the month's limit stamp is written", [...stamps()], [MONTH_STAMP]);
}

// ── Precedence: the day is read before the month, the month before the site ─
{
  reset(); seed({ day: CEIL, month: ODDS_HARD_LIMIT, sites: { ambientCaptureClosingOdds: 400 } });
  await quietly(() => chargeOdds(env, 3, 'ambientCaptureClosingOdds'));
  eq('P  day, month and site all over: only the DAY stamp', [...stamps()], [DAY_STAMP]);
  reset(); seed({ day: 0, month: ODDS_HARD_LIMIT, sites: { ambientCaptureClosingOdds: 400 } });
  await quietly(() => chargeOdds(env, 3, 'ambientCaptureClosingOdds'));
  eq('P  month and site over: only the MONTH stamp', [...stamps()], [MONTH_STAMP]);
  reset(); seed({ day: CEIL, month: 0 });
  await quietly(() => chargeOdds(env, 3, 'handleCFLOddsProbs'));
  eq('P  a day veto on an uncapped site: only the DAY stamp', [...stamps()], [DAY_STAMP]);
}

// ── A refusal is not a degrade-open, and a throw still is ───────────────────
{
  reset(); seed({ sites: { getWCPregameLambdas: 300 } });
  await quietly(() => chargeOdds(env, 4, 'getWCPregameLambdas'));
  ok('a site veto is not counted as a degrade-open', ![...kvMap.keys()].some((k) => /^odds:degraded:/.test(k)), JSON.stringify([...kvMap.keys()]));
  reset(); seed();
  throwOnBatch = 'D1_ERROR: D1 DB is overloaded.';
  const r = await quietly(() => chargeOdds(env, 3, 'ambientCaptureClosingOdds'));
  throwOnBatch = null;
  eq('a thrown batch still degrades open', r, true);
  eq('...and charges nothing', totals(), { day: 0, month: 0, site: {} });
}

// ── A verdict and a reason that disagree are not guessed at ─────────────────
// The gate charged, but the snapshot claims the day was already full. Believing
// the snapshot would refuse a call that was charged; believing the verdict would
// file no veto for a refusal the snapshot saw. Neither is known, so it degrades
// open and is counted, as any batch shape this code has never seen does.
{
  reset(); seed();
  tamperSnapshot = (row) => ({ ...row, day_used: 1e9 });
  const r = await quietly(() => chargeOdds(env, 3, 'ambientCaptureClosingOdds'));
  tamperSnapshot = null;
  eq('V  a charge whose snapshot says the day was full degrades open', r, true);
  const deg = [...kvMap.entries()].find(([k]) => /^odds:degraded:/.test(k));
  const v = deg ? JSON.parse(deg[1]) : null;
  ok('V  ...and is counted once, under charge:', !!v && v.events === 1 && Object.keys(v.reasons || {})[0]?.startsWith('charge:'), JSON.stringify(v));
  ok('V  ...and files no veto stamp', stamps().size === 0, JSON.stringify([...stamps()]));
}

// The other direction: the gate REFUSED (the day is full) but the snapshot says
// there was room on all three. Interleaved batches would look exactly like this.
// Believing the verdict would refuse silently, believing the snapshot would let a
// refused call through; neither is known, so it is counted.
{
  reset(); seed({ day: CEIL });
  tamperSnapshot = () => ({ day_used: 0, month_used: 0, site_used: 0 });
  const r = await quietly(() => chargeOdds(env, 3, 'ambientCaptureClosingOdds'));
  tamperSnapshot = null;
  eq('V  a refusal whose snapshot says there was room degrades open', r, true);
  const deg = [...kvMap.entries()].find(([k]) => /^odds:degraded:/.test(k));
  const v = deg ? JSON.parse(deg[1]) : null;
  ok('V  ...and is counted once, under charge:', !!v && v.events === 1 && Object.keys(v.reasons || {})[0]?.startsWith('charge:'), JSON.stringify(v));
  ok('V  ...and files no veto stamp, and charges nothing', stamps().size === 0 && totals().day === CEIL, JSON.stringify([...stamps()]));
}

// ── A CALL THE CALLERS CANNOT PRODUCE IS COUNTED, NOT REFUSED BY ACCIDENT ────
// NaN binds as SQL NULL, so the gate refuses while the JS reason says there is room;
// '3' is charged by SQL and compared as text by JS. Both used to land on a path
// that was either a silent refusal or a charge counted as escaped.
for (const [label, units, site] of [['units NaN', NaN, 'fetchSportOddsLive'], ['units null', null, 'fetchSportOddsLive'], ["units '3'", '3', 'fetchSportOddsLive'],
                                    ['units -1', -1, 'fetchSportOddsLive'], ['units Infinity', Infinity, 'fetchSportOddsLive'],
                                    ['site null', 3, null], ["site ''", 3, ''], ['site 5', 3, 5]]) {
  reset(); seed({ day: 10 });
  const r = await attempt(() => chargeOdds(env, units, site));
  const deg = [...kvMap.entries()].find(([k]) => /^odds:degraded:/.test(k));
  const v = deg ? JSON.parse(deg[1]) : null;
  ok(`I  ${label}: degrades open, counted once under charge: odds charge`,
    r === true && !!v && v.events === 1 && Object.keys(v.reasons || {})[0]?.startsWith('charge: odds charge:'), `returned ${r}, degraded ${JSON.stringify(v)}`);
  ok(`I  ${label}: charges nothing and files no stamp`, totals().day === 10 && totals().month === 0 && stamps().size === 0, JSON.stringify(totals()));
}

// ── A SITE VETO WHOSE STAMP CANNOT BE RECORDED IS STILL A VETO ───────────────
// The day's and the month's catches are pinned in check-monthly-atomic (cases H);
// this branch had none. A catch that rethrows reaches the outer degrade-open and
// lets a call the cap refused spend.
for (const op of ['get', 'put', 'unprintable']) {
  reset(); seed({ sites: { ambientCaptureClosingOdds: 400 } });
  failKv = { op, re: /:warned:site:/ };
  const r = await attempt(() => chargeOdds(env, 3, 'ambientCaptureClosingOdds'));
  failKv = null;
  eq(`K  a site veto with the stamp ${op} throwing: chargeOdds returns false`, r, false);
  ok(`K  ...is not counted as a degrade-open`, ![...kvMap.keys()].some((k) => /^odds:degraded:/.test(k)), JSON.stringify([...kvMap.keys()]));
  eq(`K  ...and charges nothing`, [totals().day, totals().month, totals().site.ambientCaptureClosingOdds], [0, 0, 400]);
}

// ── THE GRANTED DAY, RUN THROUGH chargeOdds ───────────────────────────────────
// Until this, no check ran the charger on a granted date, so the wiring that gives
// the gate and the veto classification the GRANTED ceiling (and not the standing
// 3,800) was a source regex only. A charged call above 3,800 on 09-13 whose reason
// is computed against 3,800 reads as a day veto, disagrees with the verdict, and is
// counted as a degrade-open; a month veto there would be filed under the day.
{
  useDay('2026-09-13');
  reset(); seed({ day: 4000 });
  const a = await quietly(() => chargeOdds(env, 3, 'handleCFLOddsProbs'));
  eq('GR a charge above the standing ceiling on the granted day: charged', a, true);
  eq('GR ...to 4,003, with no degrade-open and no stamp', [totals().day, [...kvMap.keys()].some((k) => /^odds:degraded:/.test(k)), stamps().size], [4003, false, 0]);
  reset(); seed({ day: GRANTED_CEIL - 3 });
  eq('GR pre-day = granted ceiling - units: charged', await quietly(() => chargeOdds(env, 3, 'handleCFLOddsProbs')), true);
  reset(); seed({ day: GRANTED_CEIL - 2 });
  eq('GR pre-day = granted ceiling - units + 1: refused', await quietly(() => chargeOdds(env, 3, 'handleCFLOddsProbs')), false);
  eq('GR ...as the DAY veto', [...stamps()], [DAY_STAMP]);
  reset(); seed({ day: 4000, month: ODDS_HARD_LIMIT });
  eq('GR a month veto on the granted day: refused', await quietly(() => chargeOdds(env, 3, 'handleCFLOddsProbs')), false);
  eq('GR ...filed as the MONTH veto, not the day', [...stamps()], [MONTH_STAMP]);
  useDay('2026-10-28');
}

// ── A CORRECTION IS NOT A CHARGE: it lands on a capped day, a capped month and a capped site
{
  reset(); seed({ day: CEIL, month: ODDS_HARD_LIMIT, sites: { ambientCaptureClosingOdds: 400 } });
  const sql = mod.ODDS_BUDGET_SQL;
  db.prepare(sql.fixDay).run(-3, D);
  db.prepare(sql.fixSite).run(D, 'ambientCaptureClosingOdds', -3, -3);
  db.prepare(sql.fixMonth).run(-3, M);
  eq('R  a refund lands at the day, the month and the site caps', [totals().day, totals().month, totals().site.ambientCaptureClosingOdds], [CEIL - 3, ODDS_HARD_LIMIT - 3, 397]);
  db.prepare(sql.fixDay).run(10, D);
  db.prepare(sql.fixSite).run(D, 'ambientCaptureClosingOdds', 10, 10);
  db.prepare(sql.fixMonth).run(10, M);
  eq('R  ...and a positive correction lands ABOVE a cap, because it is not a charge', [totals().day, totals().month, totals().site.ambientCaptureClosingOdds], [CEIL + 7, ODDS_HARD_LIMIT + 7, 407]);
}

// ── Grants keep expiring by inaction, for sites too ─────────────────────────
{
  const fn = mod.siteCeilingFor;
  ok('siteCeilingFor is exported, so a grant can be tested without a clock', typeof fn === 'function', 'export siteCeilingFor(site, date, grants)');
  if (typeof fn === 'function') {
    const grants = [{ date: '2026-12-01', extra: 100, siteExtra: { fetchSportOddsHistorical: 900 }, why: 'x' },
                    { date: '2026-12-02', extra: 100, why: 'no site extra' }];
    eq('a grant raises the site cap on its own date', fn('fetchSportOddsHistorical', '2026-12-01', grants), 1800 + 900);
    eq('...and on no other date', fn('fetchSportOddsHistorical', '2026-12-03', grants), 1800);
    eq('...and not another site', fn('fetchSportOddsLive', '2026-12-01', grants), 2000);
    eq('a grant with no siteExtra leaves every cap alone', fn('fetchSportOddsHistorical', '2026-12-02', grants), 1800);
    eq('an uncapped site stays uncapped on a grant day', fn('handleCFLOddsProbs', '2026-12-01', grants) >= Number.MAX_SAFE_INTEGER, true);
    const two = [{ date: '2026-12-04', extra: 0, siteExtra: { fetchSportOddsLive: 100 }, why: 'a' }, { date: '2026-12-04', extra: 0, siteExtra: { fetchSportOddsLive: 200 }, why: 'b' }];
    eq('two grants for one site and date SUM, not last-wins', fn('fetchSportOddsLive', '2026-12-04', two), 2000 + 300);
  }
}

// ── The reference model, over random sequences near a limit ─────────────────
{
  let rngState = 12345;
  const rng = () => (rngState = (rngState * 1664525 + 1013904223) >>> 0) / 2 ** 32;
  const pick = (a) => a[Math.floor(rng() * a.length)];
  const UNITS = [1, 3, 3, 3, 6, 30];
  let disagree = 0, first = null, calls = 0, vetoes = { day: 0, month: 0, site: 0 };
  for (let q = 0; q < SEQUENCES; q++) {
    reset();
    // Near its limit with probability 0.4, otherwise far from it, so the day and the
    // month do not shadow the site's veto on nearly every sequence.
    const near = (limit, p = 0.4) => (rng() < p ? Math.max(0, limit - Math.floor(rng() * 90)) : Math.floor(rng() * limit * 0.5));
    const start = { day: near(CEIL), month: near(ODDS_HARD_LIMIT), sites: {} };
    for (const s of SITES) start.sites[s] = capOf(s) === Infinity ? Math.floor(rng() * 400) : near(capOf(s), 0.6);
    seed(start);
    const st = totals();
    for (const s of SITES) st.site[s] = st.site[s] ?? 0;
    const want = new Set();
    let bad2 = false;
    for (let i = 0; i < CALLS && !bad2; i++) {
      const site = pick(SITES), units = pick(UNITS);
      const m = modelCall(st, site, units);
      if (m.stamp) { want.add(m.stamp); vetoes[m.stamp === DAY_STAMP ? 'day' : m.stamp === MONTH_STAMP ? 'month' : 'site']++; }
      const got = await quietly(() => chargeOdds(env, units, site));
      calls++;
      const t = totals();
      const sameSites = SITES.every((s) => (t.site[s] ?? 0) === st.site[s]);
      const gotStamps = [...stamps()].sort(), wantStamps = [...want].sort();
      // A degrade-open inside a sequence is a failure of its own: the guard threw
      // and the call went through unrecorded, which can leave the totals and the
      // verdict looking right.
      const degraded = [...kvMap.keys()].some((k) => /^odds:degraded:/.test(k));
      if (got !== m.charged || t.day !== st.day || t.month !== st.month || !sameSites || degraded
          || JSON.stringify(gotStamps) !== JSON.stringify(wantStamps)) {
        bad2 = true;
        if (!first) first = { sequence: q, call: i, site, units, model: { charged: m.charged, day: st.day, month: st.month, site: st.site[site] },
                              got: { charged: got, day: t.day, month: t.month, site: t.site[site] ?? 0 }, wantStamps, gotStamps };
      }
    }
    if (bad2) disagree++;
  }
  eq(`the real chargeOdds agrees with the reference model on ${SEQUENCES} random sequences`, disagree, 0);
  if (first) console.log(`        first disagreement: ${JSON.stringify(first)}`);
  ok('the sequences cross every kind of limit, so agreement is not vacuous',
    vetoes.day >= SEQUENCES / 10 && vetoes.month >= SEQUENCES / 10 && vetoes.site >= SEQUENCES / 10, `vetoes by kind: ${JSON.stringify(vetoes)} over ${calls} calls`);
  console.log(`        ${calls} calls; vetoes by kind ${JSON.stringify(vetoes)}`);
}

console.log(`\n${n - bad} of ${n} passed.`);
console.log(`COVERAGE: chargeOdds itself, ${SEQUENCES} sequences of ${CALLS} calls against a four-line model, on node:sqlite as D1`);
console.log('and a Map as KV, with the clock pinned to 2026-10-28; the boundary of every capped site at units 1, 3 and 30; the granted day');
console.log('2026-09-13; the site veto with its stamp read, written and printed failing; units and sites no caller can produce; the two');
console.log('directions of a verdict that disagrees with its reason; corrections at a cap; and the cap names against the three call sites');
console.log('by source text. It does NOT run in a Worker, says nothing about concurrent isolates (that D1 serialises a batch is the premise');
console.log('the daily batch has always rested on), and cannot exercise a siteExtra grant through chargeOdds because none exists yet.');
process.exit(bad ? 1 : 0);
