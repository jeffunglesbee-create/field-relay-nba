#!/usr/bin/env node
// The odds writers that join a vendor payload to archive rows, run for real.
// docs/CC-CMD-2026-10-21-historical-closing-join-misses-four-sports.md.
//
// WHAT IT RUNS. The REAL snapshotCronOdds and runOddsBackfillForDate, and
// extractOddsForGame with the constants they read, text-extracted from
// src/index.js (every anchor asserted to occur exactly once) and built with
// new Function, as scripts/check-archive-date-keying.mjs does. Their imports
// are the real modules: the join, kickoffMark, the odds shape helpers and
// reconcile. Only the vendor is stubbed, and the archive is node:sqlite behind
// a D1-shaped adapter, so every SELECT, UPDATE and change_log row is the
// writer's own SQL.
//
// THE PRICES NAME THEIR SOURCE. Each stub event carries a sentinel moneyline
// per side (100000+i home, 200000+i away), so a written blob says which event
// and which side it came from, and a wrong game or a swapped price is visible.
//
//   node scripts/check-odds-join-shared.mjs
//   INDEX_SRC=<copy of src/index.js> ...   runs the writers from that text
//   (scripts/mutate-odds-join-shared.mjs uses it; the tree is never mutated)

import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const INDEX = process.env.INDEX_SRC || path.join(ROOT, 'src/index.js');
const SRC = fs.readFileSync(INDEX, 'utf8');
const imp = (f) => import(pathToFileURL(path.join(ROOT, 'src', f)).href);
const { indexOddsByPair, findOddsForRow } = await imp('odds-join.js');
const { stampKickoff, kickoffMark } = await imp('odds-kickoff.js');
const { drawPriceFrom, spreadFrom } = await imp('odds-shape.js');
const { reconcile } = await imp('sync-reconciler.js');
const { archiveSportToOddsKey } = await imp('odds-sport-keys.js');

// ── extraction ──────────────────────────────────────────────────────────────
const once = (anchor) => {
  const n = SRC.split(anchor).length - 1;
  if (n !== 1) throw new Error(`ANCHOR ${JSON.stringify(anchor.slice(0, 70))} occurs ${n} times in ${INDEX}`);
  return SRC.indexOf(anchor);
};
// From a signature to its matching close brace, skipping strings, template
// literals and comments.
function balanced(from) {
  let i = SRC.indexOf('{', from), depth = 0, q = null;
  for (; i < SRC.length; i++) {
    const c = SRC[i], n = SRC[i + 1];
    if (q) { if (c === '\\') { i++; continue; } if (c === q) q = null; continue; }
    if (c === '/' && n === '/') { i = SRC.indexOf('\n', i); continue; }
    if (c === '/' && n === '*') { i = SRC.indexOf('*/', i) + 1; continue; }
    if (c === '"' || c === "'" || c === '`') { q = c; continue; }
    if (c === '{') depth++;
    else if (c === '}' && --depth === 0) return SRC.slice(from, i + 1);
  }
  throw new Error(`unbalanced body from offset ${from}`);
}
const fnText = (sig) => balanced(once(sig));
const constLine = (a) => { const i = once(a); return SRC.slice(i, SRC.indexOf('\n', i)); };
const PRELUDE = [constLine('const ODDS_QUOTA_FLOOR = '), constLine('const ODDS_PREFERRED_BOOK = '),
  fnText('function extractOddsForGame(oddsGame,')].join('\n');
const DEPS = ['indexOddsByPair', 'findOddsForRow', 'stampKickoff', 'kickoffMark', 'drawPriceFrom', 'spreadFrom',
  'reconcile', 'archiveSportToOddsKey', 'fetchSportOddsLive', 'fetchSportOddsHistorical', '_oddsPrimaryKey'];
const build = (body, name) => new Function(...DEPS, `${PRELUDE}\n${body}\nreturn ${name};`);
// THE HARNESS SUPPLIES THE WRITERS' IMPORTS, so it must prove index.js supplies
// them too: every DEPS name the extracted code calls is imported by one of
// index.js's own import lines or defined in it. Without this, deleting
// kickoffMark from index.js's import left every scenario green (review,
// 2026-10-24) while the deployed worker would throw on its first late line.
const IMPORTED = new Set();
for (const m of SRC.matchAll(/^import\s*\{([^}]*)\}\s*from\s*['"][^'"]+['"]/gm)) {
  for (const part of m[1].split(',')) { const n = part.trim().split(/\s+as\s+/).pop(); if (n) IMPORTED.add(n); }
}
const DEFINED = (n) => new RegExp(`^(?:export\\s+)?(?:async\\s+)?function\\s+${n}\\s*\\(`, 'm').test(SRC);
const CALLED_TEXT = [PRELUDE, fnText('async function snapshotCronOdds('), fnText('async function runOddsBackfillForDate(')].join('\n');
const UNSUPPLIED = DEPS.filter((n) => new RegExp(`\\b${n}\\s*\\(`).test(CALLED_TEXT) && !IMPORTED.has(n) && !DEFINED(n));
const mkCron = build(fnText('async function snapshotCronOdds('), 'snapshotCronOdds');
const mkBackfill = build(fnText('async function runOddsBackfillForDate('), 'runOddsBackfillForDate');

// ── the archive, on SQLite ──────────────────────────────────────────────────
function makeDb() {
  const db = new DatabaseSync(':memory:');
  for (const t of ['regular_season_games', 'postseason_games']) {
    db.exec(`CREATE TABLE ${t} (id TEXT PRIMARY KEY, sport TEXT, league TEXT, date TEXT, home TEXT, away TEXT,
      start_time TEXT, series_key TEXT, opening_odds TEXT, closing_odds TEXT, inplay_odds TEXT, finalized_at TEXT)`);
  }
  db.exec(`CREATE TABLE change_log (id INTEGER PRIMARY KEY AUTOINCREMENT, game_id TEXT NOT NULL, source TEXT NOT NULL,
    field TEXT NOT NULL, old_value TEXT, new_value TEXT NOT NULL, ts TEXT NOT NULL DEFAULT (datetime('now')), consumed INTEGER DEFAULT 0)`);
  const stmt = (sql, p = []) => ({
    bind: (...a) => stmt(sql, a),
    all: async () => ({ results: db.prepare(sql).all(...p) }),
    first: async () => db.prepare(sql).get(...p) ?? null,
    run: async () => ({ success: true, meta: { changes: Number(db.prepare(sql).run(...p).changes) } }),
    now: () => db.prepare(sql).run(...p),
  });
  const batch = async (list) => {
    db.exec('BEGIN');
    try { const out = list.map((s) => ({ success: true, meta: { changes: Number(s.now().changes) } })); db.exec('COMMIT'); return out; }
    catch (e) { db.exec('ROLLBACK'); throw e; }
  };
  return { db, d1: { prepare: (sql) => stmt(sql), batch } };
}
function seed(db, rows, table = 'regular_season_games') {
  const ins = db.prepare(`INSERT INTO ${table} (id, sport, date, home, away, start_time, finalized_at) VALUES (?,?,?,?,?,?,?)`);
  for (const r of rows) ins.run(r.id, r.sport, r.date, r.home, r.away, r.start_time ?? null, r.finalized_at ?? null);
}
const blobOf = (db, id, col, table = 'regular_season_games') => {
  const r = db.prepare(`SELECT ${col} FROM ${table} WHERE id = ?`).get(id);
  return r && r[col] ? JSON.parse(r[col]) : null;
};

// ── the vendor and the clock ────────────────────────────────────────────────
const priced = (evs) => evs.map((e, i) => ({ ...e, bookmakers: [{ key: 'draftkings', markets: [{ key: 'h2h', outcomes: [
  { name: e.home_team, price: 100000 + i }, { name: e.away_team, price: 200000 + i }] }] }] }));
const RealDate = Date;
let clock = 0;
class PinnedDate extends RealDate {
  constructor(...a) { if (a.length) super(...a); else super(clock); }
  static now() { return clock; }
}
async function at(iso, fn) {
  clock = RealDate.parse(iso); globalThis.Date = PinnedDate;
  try { return await fn(); } finally { globalThis.Date = RealDate; }
}
function deps(world) {
  return [indexOddsByPair, findOddsForRow, stampKickoff, kickoffMark, drawPriceFrom, spreadFrom, reconcile, archiveSportToOddsKey,
    async (env, key) => ({ games: world.live?.[key] || [], quotaRemaining: 10000, ok: true }),
    async (env, key, iso) => ({ games: world.hist?.[`${key}|${iso}`] || [], quotaRemaining: 10000, ok: true, snapshotAt: world.snapshotAt }),
    () => 'k'];
}
async function cronOne(row, events, now) {
  const { db, d1 } = makeDb(); seed(db, [row]);
  const evs = priced(events);
  await at(now, () => mkCron(...deps({ live: { [archiveSportToOddsKey(row.sport)]: evs } }))({ ARCHIVE_DB: d1 }, row.date));
  return blobOf(db, row.id, 'opening_odds');
}
async function backfillOne(row, events, snapshotAt, table = 'regular_season_games') {
  const { db, d1 } = makeDb(); seed(db, [row], table);
  const evs = priced(events);
  const res = await at('2026-10-23T05:00:00Z', () => mkBackfill(...deps({
    hist: { [`${archiveSportToOddsKey(row.sport)}|${row.date}`]: evs }, snapshotAt }))({ ARCHIVE_DB: d1, ODDS_API_KEY: 'k' }, row.date));
  return { blob: blobOf(db, row.id, 'opening_odds', table), res };
}

let failed = 0, scenarios = 0;
const ok = (name, cond, detail) => { scenarios++; if (!cond) failed++; console.log(`${cond ? 'ok  ' : 'FAIL'}  ${name}  — ${detail}`); };

ok('I0 every helper the writers call is imported or defined by index.js itself', UNSUPPLIED.length === 0,
  UNSUPPLIED.length ? `not supplied by index.js: ${UNSUPPLIED.join(', ')}` : `${DEPS.length} names checked`);

// ── R: no opening line once the game has started ────────────────────────────
// A game in progress is not finalised, so the cron's finalized_at IS NULL lets
// it through, and the live feed still lists it. Measured: 7 of 191 opening
// writes since 10-01 were captured after kickoff.
{
  // The feed restamps a game in progress (commence +8 min here), so only the
  // row's own kickoff can refuse it: each clock is tested alone.
  const row = { id: 'MLB_2026-09-15_e401816943', sport: 'MLB', date: '2026-09-15', home: 'Rays', away: 'Athletics', start_time: '2026-09-15T22:40Z' };
  const ev = [{ id: 'e', home_team: 'Tampa Bay Rays', away_team: 'Athletics', commence_time: '2026-09-15T22:48:00Z' }];
  const late = await cronOne(row, ev, '2026-09-15T22:45:00Z');
  const atKick = await cronOne(row, ev, '2026-09-15T22:40:00Z');
  const early = await cronOne(row, ev, '2026-09-15T22:39:59Z');
  ok('R1 the cron writes before the row\'s kickoff and refuses at and after it', !late && !atKick && !!early,
    `5 min after kickoff written ${!!late}; at the kickoff instant ${!!atKick}; one second before ${!!early}`);
}
{
  // No kickoff on the row: the vendor's commence is the clock.
  const row = { id: '2026-10-14-mls-stl-van', sport: 'MLS', date: '2026-10-14', home: 'St. Louis CITY SC', away: 'Vancouver Whitecaps FC', start_time: null };
  const ev = [{ id: 'e', home_team: 'St. Louis City SC', away_team: 'Vancouver Whitecaps FC', commence_time: '2026-10-15T00:30:00Z' }];
  const late = await cronOne(row, ev, '2026-10-15T00:40:00Z');
  const early = await cronOne(row, ev, '2026-10-14T20:00:00Z');
  ok('R2 a row with no kickoff is refused after the vendor\'s commence, written before it', !late && !!early,
    `after commence written ${!!late}; before ${!!early}`);
}
{
  // The worker backfill stamps the noon snapshot; a game that started before
  // it was in play. The row's own clock.
  // The snapshot lists it restamped after the snapshot, so only the row's
  // kickoff can refuse it.
  const row = { id: 'MLB_2026-09-20_e401816990', sport: 'MLB', date: '2026-09-20', home: 'Rays', away: 'Athletics', start_time: '2026-09-20T11:05Z' };
  const ev = [{ id: 'e', home_team: 'Tampa Bay Rays', away_team: 'Athletics', commence_time: '2026-09-20T12:05:00Z' }];
  const late = await backfillOne(row, ev, '2026-09-20T11:55:36Z');
  const atKick = await backfillOne({ ...row, start_time: '2026-09-20T11:55:36Z' }, ev, '2026-09-20T11:55:36Z');
  const early = await backfillOne({ ...row, start_time: '2026-09-20T17:05Z' },
    [{ ...ev[0], commence_time: '2026-09-20T17:05:00Z' }], '2026-09-20T11:55:36Z');
  ok('R3 the backfill refuses a snapshot taken at or after the row\'s kickoff, writes one before it',
    !late.blob && !atKick.blob && !!early.blob && late.res.odds_populated === 0 && early.blob.captured_at === '2026-09-20T11:55:36Z',
    `after written ${!!late.blob} (odds_populated ${late.res.odds_populated}); at the kickoff instant ${!!atKick.blob}; before ${!!early.blob}, stamped ${early.blob?.captured_at}`);
}
{
  // The vendor's commence, for a backfill row with no kickoff.
  const row = { id: '2026-09-20-mls-stl-van', sport: 'MLS', date: '2026-09-20', home: 'St. Louis CITY SC', away: 'Vancouver Whitecaps FC', start_time: null };
  const late = await backfillOne(row, [{ id: 'e', home_team: 'St. Louis City SC', away_team: 'Vancouver Whitecaps FC', commence_time: '2026-09-20T11:00:00Z' }], '2026-09-20T11:55:36Z');
  const early = await backfillOne(row, [{ id: 'e', home_team: 'St. Louis City SC', away_team: 'Vancouver Whitecaps FC', commence_time: '2026-09-21T00:30:00Z' }], '2026-09-20T11:55:36Z');
  ok('R4 a backfill row with no kickoff is refused after the vendor\'s commence, written before it', !late.blob && !!early.blob,
    `after commence written ${!!late.blob}; before ${!!early.blob}`);
}

{
  // The same, for a postseason row: the backfill reads that table separately.
  const row = { id: 'MLB_MLB-WC-TB-OAK_G1_2026-09-29', sport: 'MLB', date: '2026-09-29', home: 'Rays', away: 'Athletics', start_time: '2026-09-29T11:05Z' };
  const ev = [{ id: 'e', home_team: 'Tampa Bay Rays', away_team: 'Athletics', commence_time: '2026-09-29T12:05:00Z' }];
  const late = await backfillOne(row, ev, '2026-09-29T11:55:36Z', 'postseason_games');
  const early = await backfillOne({ ...row, start_time: '2026-09-29T17:05Z' },
    [{ ...ev[0], commence_time: '2026-09-29T17:05:00Z' }], '2026-09-29T11:55:36Z', 'postseason_games');
  ok('R5 the backfill refuses a postseason row the same way', !late.blob && !!early.blob,
    `after written ${!!late.blob}; before ${!!early.blob}`);
}

console.log(failed ? `\nFAILED: ${failed}` : '\nall scenarios pass');
console.log(`COVERAGE: the REAL snapshotCronOdds and runOddsBackfillForDate from ${path.relative(ROOT, INDEX) || INDEX},`);
console.log(`on node:sqlite with a stubbed vendor: ${scenarios} scenarios, each a single row. It does not run the`);
console.log('/archive/game closing write, the live vendor, or any deployed worker.');
process.exit(failed ? 1 : 0);
