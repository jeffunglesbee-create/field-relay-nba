#!/usr/bin/env node
/**
 * The three routes that used to spend under a cron's label, executed.
 *
 *   GET  /identity/mismatches       -> 'identityMismatches'   (was fetchSportOddsLive)
 *   GET  /archive/odds-backfill     -> 'archiveOddsBackfill'  (was fetchSportOddsHistorical)
 *   POST /archive/game              -> 'archiveGameClosing'   (was fetchSportOddsHistorical)
 *
 * WHY THEY WERE SPLIT. The first two are reachable with no credential. While they
 * shared a label with a cron, an anonymous caller could spend that cron's whole
 * cap and the cron would be refused for the rest of the day. The third shares
 * fetchSportOddsHistorical's cap with the dead-hour backfill for the same reason.
 *
 * WHY THIS CHECK RUNS THE WORKER. check-odds-attribution and check-odds-site-caps
 * read the source: they prove the guard in fetchSportOddsLive and
 * fetchSportOddsHistorical maps each selector to its label, and that the label has
 * a cap. Neither can see whether a ROUTE passes the selector. A route that stops
 * passing it compiles, lints, passes every static gate, and quietly spends the
 * cron's cap again. That is read as execution, so this runs the route: the real
 * src/index.js default export, a node:sqlite D1, a Map KV, a pinned clock, and a
 * vendor stub that counts calls and returns a receipt.
 *
 * WHAT IS ASSERTED, per route:
 *   1. the vendor is called, and the credits land on the route's OWN site row,
 *      equal to the day's total, with no row under the cron's label;
 *   2. the reconcile ledger names the route's label and not the cron's;
 *   3. with the CRON's label already at its cap the route still runs, and with the
 *      ROUTE's label at its cap the vendor is not called and nothing moves;
 *   4. (archive routes) the other route's cap does not bind this one.
 *
 * AND THE DEBUG ROUTE THAT SENDS THE CHARGE'S STATEMENTS. POST /debug/odds-budget-latency
 * prepares the batch itself, and when the charge changed (the eight statements, then nine)
 * it kept preparing the old one and answered 500 with no gate noticing. It is run here
 * too, with its REFUSAL probe: two refused calls on the sentinel day file one cell with
 * n = 2, move nothing, and leave no sentinel row behind.
 *
 * WHAT IS NOT: /archive/game's other writes. The stub D1 runs the odds tables and
 * the games tables on sqlite and answers any other statement with an empty result,
 * because the thing under test is where the credits go, not the archive upsert.
 * COVERAGE is printed: the number of relabelled routes exercised against the number
 * of relabelled labels in SITE_CEILINGS.
 *
 * INDEX_SRC points the worker elsewhere; scripts/mutate-odds-label-split.mjs uses it.
 */
import { register } from 'node:module';
import { DatabaseSync } from 'node:sqlite';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { readFileSync } from 'node:fs';

register('data:text/javascript,' + encodeURIComponent(
  "export async function resolve(s, c, next) { if (s === '@cloudflare/puppeteer') return { url: 'data:text/javascript,export default {}', shortCircuit: true }; return next(s, c); }"));

const RealDate = Date;
const NOW = RealDate.parse('2026-11-05T15:00:00Z');
let clock = NOW;                          // a scenario may move it for the length of one run
const DAY = '2026-11-05';
const MONTH = '2026-11';
class PinnedDate extends RealDate {
  constructor(...a) { if (a.length) super(...a); else super(clock); }
  static now() { return clock; }
}
globalThis.Date = PinnedDate;

const INDEX = resolve(process.env.INDEX_SRC || 'src/index.js');
const HELPERS = resolve(process.env.BUDGET_HELPERS_SRC || 'src/budget-helpers.js');
const { SITE_CEILINGS, siteCeilingFor, ODDS_SITES } = await import(pathToFileURL(HELPERS).href);
const worker = (await import(pathToFileURL(INDEX).href)).default;

// The routes under test and the cron label each one used to share.
const ROUTES = [
  { label: 'identityMismatches',  cron: 'fetchSportOddsLive',
    call: () => new Request('https://x.test/identity/mismatches?sports=MLB'),
    seed: { games: false } },
  { label: 'archiveOddsBackfill', cron: 'fetchSportOddsHistorical',
    call: () => new Request('https://x.test/archive/odds-backfill?date=2026-10-01'),
    seed: { games: true } },
  { label: 'archiveGameClosing',  cron: 'fetchSportOddsHistorical',
    call: () => new Request('https://x.test/archive/game', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sport: 'MLB', league: 'MLB', date: '2026-10-01', home: 'Rays', away: 'Guardians',
        home_score: 3, away_score: 2, start_time: '2026-10-01T23:00:00Z' }) }),
    seed: { games: true, final: true } },
];

const results = [];
const check = (name, ok, detail = '') => { results.push([name, !!ok, detail]); };

const SCHEMA = `
CREATE TABLE regular_season_games (id TEXT PRIMARY KEY, sport TEXT, league TEXT, home TEXT, away TEXT, start_time TEXT, date TEXT,
  opening_odds TEXT, closing_odds TEXT, inplay_odds TEXT, finalized_at TEXT, home_score INTEGER, away_score INTEGER, series_key TEXT);
CREATE TABLE postseason_games (id TEXT PRIMARY KEY, sport TEXT, league TEXT, home TEXT, away TEXT, start_time TEXT, date TEXT,
  opening_odds TEXT, closing_odds TEXT, inplay_odds TEXT, finalized_at TEXT, home_score INTEGER, away_score INTEGER, series_key TEXT);
CREATE TABLE odds_budget (day TEXT PRIMARY KEY, used INTEGER NOT NULL DEFAULT 0);
CREATE TABLE odds_budget_site (day TEXT NOT NULL, site TEXT NOT NULL, used INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (day, site));
CREATE TABLE odds_budget_month (month TEXT PRIMARY KEY, used INTEGER NOT NULL DEFAULT 0);
CREATE TABLE odds_budget_gate (id INTEGER PRIMARY KEY, token TEXT NOT NULL);
CREATE TABLE odds_budget_refusal (day TEXT NOT NULL, scope TEXT NOT NULL, site TEXT NOT NULL, first_at TEXT NOT NULL, n INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (day, scope, site));
CREATE TABLE odds_reconcile_state (day TEXT NOT NULL, site TEXT NOT NULL, state TEXT NOT NULL, cache TEXT NOT NULL,
  n INTEGER NOT NULL DEFAULT 0, credits_kept INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (day, site, state, cache));
`;

/** One scenario: a fresh world, one request, then the readings. */
async function world(route, { siteUsed = {}, dayUsed = 100 } = {}, wantBody = false) {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(SCHEMA);
  sqlite.prepare('INSERT INTO odds_budget VALUES (?, ?)').run(DAY, dayUsed);
  sqlite.prepare('INSERT INTO odds_budget_month VALUES (?, ?)').run(MONTH, 5000);
  for (const [site, used] of Object.entries(siteUsed)) sqlite.prepare('INSERT INTO odds_budget_site VALUES (?, ?, ?)').run(DAY, site, used);
  if (route.seed.games) {
    sqlite.prepare(`INSERT INTO regular_season_games (id, sport, league, home, away, start_time, date, finalized_at)
                    VALUES (?, 'MLB', 'MLB', 'Rays', 'Guardians', '2026-10-01T23:00:00Z', '2026-10-01', ?)`)
      .run('MLB_2026-10-01_rays_guardians', route.seed.final ? '2026-10-02T02:00:00Z' : null);
  }
  if (route.seed.tonight) {
    // Tonight's slate: a game of today, opening odds not yet taken, not finished.
    sqlite.prepare(`INSERT INTO regular_season_games (id, sport, league, home, away, start_time, date, finalized_at)
                    VALUES ('MLB_2026-11-05_rays_guardians', 'MLB', 'MLB', 'Rays', 'Guardians', '2026-11-06T00:00:00Z', '2026-11-05', NULL)`).run();
  }
  const odds = /odds_budget|odds_reconcile/;
  const mk = (sql, args = []) => ({ sql, args, bind: (...a) => mk(sql, a),
    all: async () => { try { return { results: sqlite.prepare(sql).all(...args), success: true, meta: {} }; } catch (e) { if (odds.test(sql)) throw e; return { results: [], success: true, meta: {} }; } },
    first: async () => { try { return sqlite.prepare(sql).get(...args) ?? null; } catch (e) { if (odds.test(sql)) throw e; return null; } },
    run: async () => { try { const r = sqlite.prepare(sql).run(...args); return { success: true, results: [], meta: { changes: Number(r.changes) } }; } catch (e) { if (odds.test(sql)) throw e; return { success: true, results: [], meta: { changes: 0 } }; } } });
  const D1 = { prepare: (s) => mk(s),
    batch: async (list) => {
      sqlite.exec('BEGIN');
      try {
        const out = list.map(s => /^\s*(SELECT|WITH)/i.test(s.sql) || /RETURNING/i.test(s.sql)
          ? { results: sqlite.prepare(s.sql).all(...s.args), success: true, meta: {} }
          : { results: [], success: true, meta: { changes: Number(sqlite.prepare(s.sql).run(...s.args).changes) } });
        sqlite.exec('COMMIT'); return out;
      } catch (e) { sqlite.exec('ROLLBACK'); throw e; }
    } };
  const kv = new Map();
  const KV = { get: async (k) => kv.has(k) ? kv.get(k) : null, put: async (k, v) => { kv.set(k, v); }, delete: async (k) => { kv.delete(k); },
    list: async () => ({ keys: [] }) };

  let vendor = 0;
  globalThis.fetch = async (input) => {
    const url = String(input?.url ?? input);
    if (!url.includes('api.the-odds-api.com')) return new Response('{}', { status: 200 });
    vendor++;
    const historical = url.includes('/historical/');
    return new Response(historical ? '{"timestamp":"2026-10-01T12:00:00Z","data":[]}' : '[]',
      { status: 200, headers: { 'x-requests-last': historical ? '10' : '1', 'x-requests-remaining': '400000' } });
  };

  const rows = () => ({
    sites: Object.fromEntries(sqlite.prepare('SELECT site, used FROM odds_budget_site WHERE day = ?').all(DAY).map(r => [r.site, r.used])),
    day: sqlite.prepare('SELECT used FROM odds_budget WHERE day = ?').get(DAY)?.used ?? null,
    month: sqlite.prepare('SELECT used FROM odds_budget_month WHERE month = ?').get(MONTH)?.used ?? null,
    ledger: sqlite.prepare('SELECT site, state, n FROM odds_reconcile_state WHERE day = ? ORDER BY site, state').all(DAY).map(r => ({ ...r })),
  });
  const before = rows();
  const env = { FIELD_JOURNALISM: KV, ARCHIVE_DB: D1, ODDS_API_KEY: 'k', RELAY_SHARED_SECRET: 's' };
  const w = console.warn, l = console.log, e = console.error;
  console.warn = console.log = console.error = () => {};
  let status, body = null;
  try {
    if (route.tick) {
      // A scheduled tick, not a request: the cron paths that must charge the CRONS' labels.
      clock = RealDate.parse(route.tick.at);
      const pending = [], ctx = { waitUntil: (p) => pending.push(Promise.resolve(p)) };
      await worker.scheduled({ cron: route.tick.expr }, env, ctx);
      await Promise.allSettled(pending);
      status = 200;
    } else {
      const res = await worker.fetch(route.call(), env, { waitUntil() {} });
      status = res.status;
      if (wantBody) body = JSON.parse(await res.text());
    }
  }
  catch (err) { status = 'THROW ' + err.message; }
  finally { clock = NOW; console.warn = w; console.log = l; console.error = e; }
  const after = rows();
  after.sentinel = sqlite.prepare("SELECT COUNT(*) AS c FROM odds_budget_refusal WHERE day = '0000-00-00'").get().c;
  return { status, vendor, before, after, body };
}

// A row seeded at 0 by a refused or reconciled call moved nothing.
const nonZero = (sites) => Object.fromEntries(Object.entries(sites).filter(([, v]) => v !== 0));
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const unmoved = (r) => r.after.day === r.before.day && r.after.month === r.before.month
  && same(nonZero(r.after.sites), nonZero(r.before.sites)) && same(r.after.ledger, r.before.ledger);

for (const route of ROUTES) {
  const { label, cron } = route;
  const cap = siteCeilingFor(label, DAY);
  const cronCap = siteCeilingFor(cron, DAY);
  const tag = `${label}`;

  check(`${tag}: the label is declared and capped`,
    ODDS_SITES.includes(label) && Number.isInteger(SITE_CEILINGS[label]) && SITE_CEILINGS[label] > 0, `cap ${SITE_CEILINGS[label]}`);

  // 1 + 2. Spends under its own label.
  const a = await world(route);
  const charged = a.after.sites[label] ?? 0;
  check(`${tag}: ${a.status === 200 ? 'answers 200' : 'status ' + a.status}`, a.status === 200, String(a.status));
  check(`${tag}: calls the vendor`, a.vendor >= 1, `${a.vendor} calls`);
  check(`${tag}: credits land on its own site row`, charged > 0, `${label}=${charged}`);
  check(`${tag}: nothing lands on ${cron}`, (a.after.sites[cron] ?? 0) === 0, `${cron}=${a.after.sites[cron] ?? 'absent'}`);
  check(`${tag}: the day moved by exactly what the site row did`, a.after.day - a.before.day === charged, `day +${a.after.day - a.before.day}, site ${charged}`);
  check(`${tag}: the reconcile ledger names ${label}`, a.after.ledger.some(r => r.site === label), JSON.stringify(a.after.ledger));
  check(`${tag}: the reconcile ledger never names ${cron}`, !a.after.ledger.some(r => r.site === cron), JSON.stringify(a.after.ledger));

  // 3a. The cron's label at its cap does not stop the route.
  const b = await world(route, { siteUsed: { [cron]: cronCap } });
  check(`${tag}: ${cron} at its cap (${cronCap}) does not stop it`, b.vendor >= 1 && (b.after.sites[label] ?? 0) > 0,
    `${b.vendor} calls, ${label}=${b.after.sites[label] ?? 'absent'}`);

  // 3b. Its own label at the cap stops the vendor call and moves nothing.
  const c = await world(route, { siteUsed: { [label]: cap - 1 } });
  check(`${tag}: at ${cap - 1}/${cap} the vendor is not called`, c.vendor === 0, `${c.vendor} calls`);
  check(`${tag}: at the cap no counter and no ledger row moves`, unmoved(c), JSON.stringify({ before: c.before, after: c.after }));
  check(`${tag}: at the cap ${cron} is left alone`, (c.after.sites[cron] ?? 0) === 0, `${cron}=${c.after.sites[cron] ?? 'absent'}`);

  // 4. A sibling route's cap does not bind this one.
  for (const other of ROUTES.filter(r => r.label !== label)) {
    const d = await world(route, { siteUsed: { [other.label]: siteCeilingFor(other.label, DAY) } });
    check(`${tag}: ${other.label} at its cap does not stop it`, d.vendor >= 1 && (d.after.sites[label] ?? 0) > 0,
      `${d.vendor} calls, ${label}=${d.after.sites[label] ?? 'absent'}`);
  }
}

// ── A REFUSAL BY OUR OWN GUARD IS NOT A VENDOR FAULT ─────────────────────────
// /identity/mismatches used to report any non-ok fetch as 'Odds-API fetch failed', and the Saturday
// probe classifies that as the vendor not serving (C1). With a cap of its own the route now meets
// our guard far more often than the vendor failing, so the report says which.
{
  const cap = siteCeilingFor('identityMismatches', DAY);
  const g = await world(ROUTES[0], { siteUsed: { identityMismatches: cap - 1 } }, true);
  const mlb = g.body && g.body.sports && g.body.sports.MLB;
  check('identity route: a call our guard declined is reported as guarded, not as a vendor failure',
    !!mlb && mlb.guarded === true && /guard/.test(String(mlb.error)) && g.vendor === 0, JSON.stringify(mlb));
}

// ── THE CRON PATHS: the other direction of the isolation ─────────────────────
// The routes above prove an anonymous caller spends its OWN label. This proves the crons still
// spend theirs: a default moved onto a route's label would let the first anonymous GETs starve
// the cron with every route check green.
for (const c of [
  { name: 'the dead-hour odds backfill (the same tick at 04:00Z)', tick: { at: '2026-11-05T04:00:00Z', expr: '*/15 * * * *' },
    seed: { games: true }, label: 'fetchSportOddsHistorical', others: ['identityMismatches', 'archiveOddsBackfill', 'archiveGameClosing', 'fetchSportOddsLive'], path: '/v4/historical/' },
]) {
  const w = await world({ tick: c.tick, seed: c.seed });
  check(`cron: ${c.name}: reaches the vendor`, w.vendor >= 1, `${w.vendor} calls`);
  check(`cron: ...and its credits land on ${c.label}`, (w.after.sites[c.label] ?? 0) > 0, JSON.stringify(w.after.sites));
  check(`cron: ...and on none of the other four labels`, c.others.every((o) => (w.after.sites[o] ?? 0) === 0), JSON.stringify(w.after.sites));
  check(`cron: ...and the reconcile ledger names ${c.label} only`, w.after.ledger.length > 0 && w.after.ledger.every((r) => r.site === c.label), JSON.stringify(w.after.ledger));
  const cap = siteCeilingFor(c.label, DAY);
  const at = await world({ tick: c.tick, seed: c.seed }, { siteUsed: { [c.label]: cap - 1 } });
  check(`cron: ...and ${c.label} at its own cap stops it (the cap binds the cron it belongs to)`, at.vendor === 0, `${at.vendor} calls`);
  const routeCapsFull = await world({ tick: c.tick, seed: c.seed }, { siteUsed: Object.fromEntries(['identityMismatches', 'archiveOddsBackfill', 'archiveGameClosing'].map((s) => [s, siteCeilingFor(s, DAY)])) });
  check(`cron: ...and the three route labels at their caps do not stop it`, routeCapsFull.vendor >= 1 && (routeCapsFull.after.sites[c.label] ?? 0) > 0, `${routeCapsFull.vendor} calls`);
}

// THE OPENING-ODDS SNAPSHOT is reached only through a full journalism cycle (it needs an ESPN
// slate to get that far), so it is run from the SOURCE of the two functions, with their free
// names stubbed, as check-monthly-atomic does for the wrappers: the snapshot's call must not
// pass a route's selector, and the real fetchSportOddsLive with no selector must charge and
// reconcile as fetchSportOddsLive. Every function is cut out by name; a name that is missing
// fails here instead of passing on nothing.
{
  const text = readFileSync(INDEX, 'utf8');
  const slice = (name) => {
    const i = text.indexOf(`async function ${name}(`);
    const j = i < 0 ? -1 : text.indexOf('\n}\n', i);
    return i < 0 || j < 0 ? null : text.slice(i, j + 2);
  };
  const live = slice('fetchSportOddsLive'), snap = slice('snapshotCronOdds');
  check('cron: fetchSportOddsLive and snapshotCronOdds are found in the source', !!live && !!snap, `live ${!!live}, snapshot ${!!snap}`);
  if (live && snap) {
    const seen = { consume: [], reconcile: [] };
    const stubs = {
      consumeOddsCredit: async (_env, _units, label) => { seen.consume.push(label); return true; },
      reconcileOddsCredit: async (_env, _est, _resp, label) => { seen.reconcile.push(label); },
      fetch: async () => ({ ok: true, headers: { get: () => null }, json: async () => [] }),
      _oddsPrimaryKey: () => 'k', ODDS_BASE: 'https://x.test', oddsCreditCost: () => 3, readQuotaHeader: () => null,
    };
    const names = Object.keys(stubs);
    const liveFn = new Function(...names, `${live}\nreturn fetchSportOddsLive;`)(...names.map((n) => stubs[n]));
    await liveFn({}, 'baseball_mlb');
    check('cron: fetchSportOddsLive with no selector charges AND reconciles as fetchSportOddsLive',
      JSON.stringify(seen.consume) === '["fetchSportOddsLive"]' && JSON.stringify(seen.reconcile) === '["fetchSportOddsLive"]', JSON.stringify(seen));
    seen.consume.length = 0; seen.reconcile.length = 0;
    await liveFn({}, 'baseball_mlb', 'identityMismatches');
    check('cron: ...and with the identity selector, as identityMismatches (the selector is what moves it)',
      JSON.stringify(seen.consume) === '["identityMismatches"]' && JSON.stringify(seen.reconcile) === '["identityMismatches"]', JSON.stringify(seen));
    const calls = [];
    const snapEnv = { ARCHIVE_DB: { prepare: () => ({ bind: () => ({ all: async () => ({ results: [{ sport: 'MLB' }] }) }) }) } };
    const snapStubs = { archiveSportToOddsKey: () => 'baseball_mlb', ODDS_QUOTA_FLOOR: 0,
      fetchSportOddsLive: async (...a) => { calls.push(a); return { games: [], quotaRemaining: null, ok: false }; } };
    const sn = Object.keys(snapStubs);
    try {
      await new Function(...sn, `${snap}\nreturn snapshotCronOdds;`)(...sn.map((n) => snapStubs[n]))(snapEnv, '2026-11-05');
      check('cron: snapshotCronOdds calls fetchSportOddsLive once per sport', calls.length === 1, `${calls.length} calls`);
      check('cron: ...passing no selector, so the cron keeps fetchSportOddsLive', calls.length === 1 && calls[0].length === 2, `args ${JSON.stringify(calls[0] && calls[0].length)}`);
    } catch (err) {
      check('cron: snapshotCronOdds runs on its own with the stubs', false, String(err && err.message || err));
    }
  }
}

// ── The debug route, executed ────────────────────────────────────────────────
{
  const debugRoute = { seed: { games: false },
    call: () => new Request('https://x.test/debug/odds-budget-latency', { method: 'POST', headers: { 'X-FIELD-Relay': 's' } }) };
  const w = await world(debugRoute, { dayUsed: 0 }, true);
  const body = w.body || {};
  check('debug latency: answers 200 and ok', w.status === 200 && body.ok === true, `status ${w.status}, error ${body.error ?? 'none'}`);
  check('debug latency: PREPARES the statements the charger declares, in its order (read back from the builder, not from the constant)',
    Array.isArray(body.statement_order_sent) && JSON.stringify(body.statement_order_sent) === JSON.stringify(body.statement_order)
      && body.statement_order_sent.length === 9 && body.statement_order_sent[5] === 'refusal', JSON.stringify({ sent: body.statement_order_sent, declared: body.statement_order }));
  const rp = body.refusal_path || {};
  check('debug latency: two refused calls return the day scope both times (insert, then conflict update)',
    JSON.stringify(rp.scopes_returned) === '[["day"],["day"]]', JSON.stringify(rp.scopes_returned));
  check('debug latency: ...and file one cell, counted twice, under the probe caller',
    JSON.stringify(rp.cells) === '[{"scope":"day","site":"latency-probe","n":2}]', JSON.stringify(rp.cells));
  check('debug latency: ...and move no counter', typeof rp.day_used_before === 'number' && rp.day_used_before === rp.day_used_after, JSON.stringify(rp));
  check('debug latency: the sentinel rows are gone afterwards', w.after.sentinel === 0, `${w.after.sentinel} refusal row(s) left for the sentinel day`);
}

const labels = ROUTES.map(r => r.label);
const declared = Object.keys(SITE_CEILINGS).filter(s => labels.includes(s));
check('every relabelled label in SITE_CEILINGS has a route here', declared.length === labels.length && ODDS_SITES.filter(s => labels.includes(s)).length === labels.length,
  `${declared.length} of ${labels.length}`);

let failed = 0;
for (const [name, ok, detail] of results) {
  if (!ok) { failed++; console.log(`FAIL  ${name}${detail ? '  [' + detail + ']' : ''}`); }
}
console.log(`checked ${ROUTES.length} of ${labels.length} relabelled routes, each against its own cap, its cron's cap and its siblings'.`);
console.log(`${results.length - failed} of ${results.length} passed.`);
process.exit(failed ? 1 : 0);
