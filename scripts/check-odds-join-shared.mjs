#!/usr/bin/env node
// The odds writers that join a vendor payload to archive rows, run for real.
// docs/CC-CMD-2026-10-21-historical-closing-join-misses-four-sports.md.
//
// WHAT IT RUNS. The REAL snapshotCronOdds, runOddsBackfillForDate and the
// /archive/game closing block, and extractOddsForGame with the constants they
// read, text-extracted from
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
//   JOIN_SRC=<copy of src/odds-join.js placed in src/> ...   uses that join
//   (scripts/mutate-odds-join-shared.mjs uses both; tracked files are never
//   mutated)

import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const INDEX = process.env.INDEX_SRC || path.join(ROOT, 'src/index.js');
const SRC = fs.readFileSync(INDEX, 'utf8');
const imp = (f) => import(pathToFileURL(path.join(ROOT, 'src', f)).href);
const { indexOddsByPair, findOddsForRow } = await import(pathToFileURL(process.env.JOIN_SRC || path.join(ROOT, 'src/odds-join.js')).href);
const { stampKickoff, kickoffMark } = await imp('odds-kickoff.js');
const { drawPriceFrom, spreadFrom } = await imp('odds-shape.js');
const { reconcile } = await imp('sync-reconciler.js');
const { archiveSportToOddsKey } = await imp('odds-sport-keys.js');
const { pairOrientation, matchSlate } = await imp('odds-name-match.js');

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
  'reconcile', 'archiveSportToOddsKey', 'fetchSportOddsLive', 'fetchSportOddsHistorical', '_oddsPrimaryKey',
  'ensureInPlayOddsColumn'];
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
const mkCron = build(fnText('async function snapshotCronOdds('), 'snapshotCronOdds');
const mkBackfill = build(fnText('async function runOddsBackfillForDate('), 'runOddsBackfillForDate');
// The /archive/game closing block, from its banner to its catch, run with the
// route's own variables as parameters.
const CLOSING = (() => {
  const a = once('                // ── Closing-odds capture ──'), b = once('closing-odds capture failed:');
  return SRC.slice(a, SRC.indexOf('\n', b));
})();
const AsyncFunction = (async () => {}).constructor;
const CALLED_TEXT = [PRELUDE, fnText('async function snapshotCronOdds('), fnText('async function runOddsBackfillForDate('), CLOSING].join('\n');
const UNSUPPLIED = DEPS.filter((n) => new RegExp(`\\b${n}\\s*\\(`).test(CALLED_TEXT) && !IMPORTED.has(n) && !DEFINED(n));
const mkClosing = () => new AsyncFunction('env', 'id', 'sport', 'date', 'home', 'away', 'start_time', 'series_key', ...DEPS,
  `${PRELUDE}\n${CLOSING}`);

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
    () => 'k', async () => {}];
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

// Which event and side a written blob came from, judged against the event the
// row truly belongs to and pairOrientation (the join's own code is not used to
// judge it).
//
// BOTH PRICES. Each must come from the true event, the home price from the
// side that is the row's home team and the away price from the other: reading
// only the home price let a blob carrying one team's price twice pass.
function judge(row, blob, evs, truth) {
  if (!blob) return 'none';
  const ph = blob.moneyline?.home, pa = blob.moneyline?.away;
  if (typeof ph !== 'number' || typeof pa !== 'number') return 'unreadable';
  const src = (p) => ({ e: evs[p % 100000], side: p >= 200000 ? 'away' : 'home' });
  const h = src(ph), a = src(pa);
  const isTruth = (e) => !!truth && !!e && e.home_team === truth.home_team && e.away_team === truth.away_team
    && e.commence_time === truth.commence_time;
  if (!isTruth(h.e) || !isTruth(a.e)) return 'wrong-event';
  const swapped = pairOrientation(row, truth) === 'swapped';
  return h.side === (swapped ? 'away' : 'home') && a.side === (swapped ? 'home' : 'away') ? 'right' : 'wrong-side';
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

// ── J: the per-team join, through the real writers ──────────────────────────
// J1. The opening cron over recorded names: each sport-date's rows, with the
// payload that sport-date's recorded vendor events make, at 10:00Z (the cron's
// first tick, before every kickoff in the fixture). Measured 2026-10-23 with
// the join before this change: the four sports 0 of 112, MLS 40 of 43, the
// other controls as now. MLS gains 'Columbus' v 'Charlotte', a row with a
// kickoff; the two it still misses are rows without one, as before.
const FIX = JSON.parse(fs.readFileSync(path.join(ROOT, 'outbox/fixture-odds-join-shared-2026-10-23.json'), 'utf8'));
let fixtureRows = 0;
{
  const groups = new Map();
  for (const r of FIX.rows) {
    const k = `${r[1]}|${r[2]}`;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(r);
  }
  const tally = {};
  for (const [k, rs] of groups) {
    const [sport, date] = k.split('|');
    const { db, d1 } = makeDb();
    seed(db, rs.map((r) => ({ id: r[0], sport, date, home: r[3], away: r[4], start_time: r[5] })));
    const seen = new Map();
    for (const r of rs) seen.set(`${r[6]}|${r[7]}|${r[8]}`, { home_team: r[6], away_team: r[7], commence_time: r[8] });
    const evs = priced([...seen.values()]);
    await at(`${date}T10:00:00Z`, () => mkCron(...deps({ live: { [archiveSportToOddsKey(sport)]: evs } }))({ ARCHIVE_DB: d1 }, date));
    if (!tally[sport]) tally[sport] = { rows: 0, right: 0, none: 0, wrong: 0 };
    for (const r of rs) {
      fixtureRows++;
      const t = tally[sport]; t.rows++;
      const v = judge({ home: r[3], away: r[4] }, blobOf(db, r[0], 'opening_odds'), evs, { home_team: r[6], away_team: r[7], commence_time: r[8] });
      if (v === 'right') t.right++; else if (v === 'none') t.none++; else t.wrong++;
    }
  }
  let fourRight = 0, fourRows = 0, wrong = 0;
  for (const [sport, t] of Object.entries(tally)) {
    wrong += t.wrong;
    if (['NHL', 'NBA', 'NFL', 'CFB'].includes(sport)) { fourRight += t.right; fourRows += t.rows; }
  }
  const ctl = (s) => tally[s] ? `${tally[s].right}/${tally[s].rows}` : 'absent';
  ok('J1 the opening cron writes NHL, NBA, NFL and CFB from recorded names, and no wrong line anywhere',
    fourRight === 110 && fourRows === 112 && wrong === 0 && ctl('MLB') === '6/6' && ctl('CFL') === '2/2' && ctl('WNBA') === '2/2' && ctl('MLS') === '41/43',
    `four sports ${fourRight} of ${fourRows} right, wrong ${wrong} (all sports); MLB ${ctl('MLB')}, CFL ${ctl('CFL')}, WNBA ${ctl('WNBA')}, MLS ${ctl('MLS')}; checked ${fixtureRows} of ${FIX.rows.length} fixture rows, games some matcher had already paired, each payload only the recorded events`);
}
{
  // J3. The vendor lists the pairing reversed (the one recorded case, Virginia
  // v West Virginia): not accepted, so no row decided alone can take another
  // row's game. The CI backfill's matcher, which sees the whole slate, fills it.
  const row = { id: 'CFB_2026-09-19_e401856802', sport: 'CFB', date: '2026-09-19', home: 'Virginia', away: 'West Virginia', start_time: '2026-09-19T23:30Z' };
  const blob = await cronOne(row, [{ home_team: 'West Virginia Mountaineers', away_team: 'Virginia Cavaliers', commence_time: '2026-09-19T23:35:29Z' }], '2026-09-19T12:00:00Z');
  ok('J3 a reversed listing is not accepted', !blob, `written ${!!blob}`);
}
{
  // J12. A split squad, from the archive: the same two clubs, the same
  // instant, one game in each city (NHL preseason 2026-09-19). With only one
  // game listed, only its own row is written; with both listed, each row gets
  // its own game.
  const A = { id: 'NHL_2026-09-19_e401881922', sport: 'NHL', date: '2026-09-19', home: 'Maple Leafs', away: 'Canadiens', start_time: '2026-09-19T23:00Z' };
  const B = { id: 'NHL_2026-09-19_e401881923', sport: 'NHL', date: '2026-09-19', home: 'Canadiens', away: 'Maple Leafs', start_time: '2026-09-19T23:00Z' };
  const gA = { home_team: 'Toronto Maple Leafs', away_team: 'Montréal Canadiens', commence_time: '2026-09-19T23:00:00Z' };
  const gB = { home_team: 'Montréal Canadiens', away_team: 'Toronto Maple Leafs', commence_time: '2026-09-19T23:00:00Z' };
  const run = async (events) => {
    const { db, d1 } = makeDb(); seed(db, [A, B]);
    const evs = priced(events);
    await at('2026-09-19T12:00:00Z', () => mkCron(...deps({ live: { icehockey_nhl: evs } }))({ ARCHIVE_DB: d1 }, '2026-09-19'));
    return { a: judge(A, blobOf(db, A.id, 'opening_odds'), evs, gA), b: judge(B, blobOf(db, B.id, 'opening_odds'), evs, gB) };
  };
  const one = await run([gA]), both = await run([gB, gA]);
  ok('J12 a split squad: one listing writes only its own row; two listings write each row its own game',
    one.a === 'right' && one.b === 'none' && both.a === 'right' && both.b === 'right',
    `one listing: A ${one.a}, B ${one.b}; both: A ${both.a}, B ${both.b}`);
}
{
  // J4. The row's own game is absent; the same teams' doubleheader twin starts
  // 206 minutes later. It is not this game.
  const row = { id: 'MLB_2026-09-25_e401817088', sport: 'MLB', date: '2026-09-25', home: 'Yankees', away: 'Orioles', start_time: '2026-09-25T20:05Z' };
  const blob = await cronOne(row, [{ home_team: 'New York Yankees', away_team: 'Baltimore Orioles', commence_time: '2026-09-25T23:31:12Z' }], '2026-09-25T12:00:00Z');
  ok('J4 a doubleheader twin 206 minutes off is not this game', !blob, `written ${!!blob}`);
  // J4b. The same doubleheader from game 2's row: only game 1, 206 minutes
  // EARLIER, is listed. The window is on both sides.
  const row2 = { ...row, id: 'MLB_2026-09-25_e401817089', start_time: '2026-09-25T23:31Z' };
  const blob2 = await cronOne(row2, [{ home_team: 'New York Yankees', away_team: 'Baltimore Orioles', commence_time: '2026-09-25T20:05:00Z' }], '2026-09-25T12:00:00Z');
  ok('J4b a doubleheader twin 206 minutes earlier is not this game', !blob2, `written ${!!blob2}`);
}
{
  // J6. No kickoff on the row, and only the reverse fixture listed (a two-legged
  // tie): not accepted. J6b, A3: no kickoff, and only a league fixture of the
  // same clubs under longer names: name tokens are not used without a kickoff.
  const r6 = { id: 'MLS_x_semis_2026-09-15', sport: 'MLS', date: '2026-09-15', home: 'CF Montréal', away: 'Vancouver Whitecaps FC', start_time: null };
  const b6 = await cronOne(r6, [{ home_team: 'Vancouver Whitecaps FC', away_team: 'CF Montréal', commence_time: '2026-09-16T02:30:00Z' }], '2026-09-15T12:00:00Z');
  ok('J6 without a kickoff a reversed listing is not accepted', !b6, `written ${!!b6}`);
  const ra = { id: 'MLS_MLS-COM-00002U_SF-01_semifinal_2026-09-16', sport: 'MLS', date: '2026-09-16', home: 'Columbus Crew', away: 'Orlando City', start_time: null };
  const ba = await cronOne(ra, [{ home_team: 'Columbus Crew SC', away_team: 'Orlando City SC', commence_time: '2026-09-27T23:30:00Z' }], '2026-09-16T12:00:00Z');
  ok('A3 a cup row with no kickoff is not priced from a league fixture of the same clubs', !ba, `written ${!!ba}`);
}
{
  // J10. No kickoff, two listings of the same pairing: refused, never the last one.
  const row = { id: '2026-10-14-mls-stl-van', sport: 'MLS', date: '2026-10-14', home: 'St. Louis CITY SC', away: 'Vancouver Whitecaps FC', start_time: null };
  const blob = await cronOne(row, [{ home_team: 'St. Louis City SC', away_team: 'Vancouver Whitecaps FC', commence_time: '2026-10-15T00:30:00Z' },
    { home_team: 'St. Louis City SC', away_team: 'Vancouver Whitecaps FC', commence_time: '2026-10-18T00:30:00Z' }], '2026-10-14T12:00:00Z');
  ok('J10 two candidate listings write nothing', !blob, `written ${!!blob}`);
  // J10b. The same with a kickoff: two listings of the pairing inside the
  // 90-minute window are ambiguous too.
  const rk = { id: 'MLB_2026-09-27_e401817200', sport: 'MLB', date: '2026-09-27', home: 'Rays', away: 'Athletics', start_time: '2026-09-27T17:10Z' };
  const bk = await cronOne(rk, [{ home_team: 'Tampa Bay Rays', away_team: 'Athletics', commence_time: '2026-09-27T17:10:00Z' },
    { home_team: 'Tampa Bay Rays', away_team: 'Athletics', commence_time: '2026-09-27T18:20:00Z' }], '2026-09-27T12:00:00Z');
  ok('J10b with a kickoff, two listings inside the window write nothing', !bk, `written ${!!bk}`);
}
{
  // J7. The worker backfill on the 2026-09-12 CFB full feed (80 rows, 95
  // events), judged against matchSlate's pairing.
  const fx = JSON.parse(fs.readFileSync(path.join(ROOT, 'outbox/fixture-cfb-2026-09-12.json'), 'utf8'));
  const truth = matchSlate(fx.archive, fx.vendor, fx.date).byGameId;
  const { db, d1 } = makeDb();
  seed(db, fx.archive.map((a) => ({ ...a, sport: 'CFB', date: fx.date })));
  const evs = priced(fx.vendor);
  const res = await at('2026-10-23T05:00:00Z', () => mkBackfill(...deps({ hist: { [`americanfootball_ncaaf|${fx.date}`]: evs },
    snapshotAt: fx.snapshot_timestamp }))({ ARCHIVE_DB: d1, ODDS_API_KEY: 'k' }, fx.date));
  let right = 0, wrong = 0;
  const stamps = new Set();
  for (const a of fx.archive) {
    const b = blobOf(db, a.id, 'opening_odds');
    if (!b) continue;
    stamps.add(b.captured_at);
    const v = judge(a, b, evs, truth.get(a.id)?.event);
    if (v === 'right') right++; else wrong++;
  }
  ok('J7 the backfill writes CFB from the historical snapshot, stamped with it',
    right === 73 && wrong === 0 && stamps.size === 1 && stamps.has(fx.snapshot_timestamp),
    `right ${right}, wrong ${wrong}, of ${fx.archive.length} rows; stamps ${[...stamps].join(',')}; odds_populated ${res.odds_populated}`);
}
{
  // J7b. The backfill, a snapshot listing this game and the next meeting of the
  // same teams: the kickoff picks this one.
  const row = { id: 'NHL_2026-10-20_e401892543', sport: 'NHL', date: '2026-10-20', home: 'Blue Jackets', away: 'Maple Leafs', start_time: '2026-10-20T23:00Z' };
  const truth = { home_team: 'Columbus Blue Jackets', away_team: 'Toronto Maple Leafs', commence_time: '2026-10-20T23:00:00Z' };
  const evs = [truth, { home_team: 'Columbus Blue Jackets', away_team: 'Toronto Maple Leafs', commence_time: '2026-10-22T23:00:00Z' }];
  const { blob } = await backfillOne(row, evs, '2026-10-20T11:55:36Z');
  const v = judge(row, blob, priced(evs), truth);
  ok('J7b the backfill picks this game, not the next meeting', v === 'right', `verdict ${v}`);
}
{
  // J11. The one D1 row a kickoff-blind backfill would newly mis-write
  // (critic, 2026-10-23): an NBA tip at 10:00Z, the noon snapshot at
  // 11:55:36Z. The join now matches it; the refusal must stop it.
  const row = { id: 'NBA_2026-10-11_e401898400', sport: 'NBA', date: '2026-10-11', home: 'Rockets', away: 'Mavericks', start_time: '2026-10-11T10:00Z' };
  const { blob } = await backfillOne(row, [{ home_team: 'Houston Rockets', away_team: 'Dallas Mavericks', commence_time: '2026-10-11T10:00:00Z' }], '2026-10-11T11:55:36Z');
  ok('J11 an NBA game in progress at the snapshot gets no opening line', !blob, `written ${!!blob}`);
}
{
  // J8. The /archive/game closing block for an NHL final: a pre-kickoff line,
  // verified, one change_log row. The snapshot also lists the next meeting.
  const row = { id: 'NHL_2026-10-20_e401892543', sport: 'NHL', date: '2026-10-20', home: 'Blue Jackets', away: 'Maple Leafs', start_time: '2026-10-20T23:00Z', finalized_at: '2026-10-21 01:40:00' };
  const truth = { home_team: 'Columbus Blue Jackets', away_team: 'Toronto Maple Leafs', commence_time: '2026-10-20T23:00:00Z' };
  const evs = priced([truth, { home_team: 'Columbus Blue Jackets', away_team: 'Toronto Maple Leafs', commence_time: '2026-10-22T23:00:00Z' }]);
  const { db, d1 } = makeDb(); seed(db, [row]);
  const warn = console.warn; console.warn = () => {};
  try {
    await mkClosing()({ ARCHIVE_DB: d1, FIELD_JOURNALISM: {} }, row.id, 'NHL', row.date, row.home, row.away, row.start_time, null,
      ...deps({ hist: { [`icehockey_nhl|${row.date}`]: evs }, snapshotAt: '2026-10-20T11:55:36Z' }));
  } finally { console.warn = warn; }
  const blob = blobOf(db, row.id, 'closing_odds');
  const log = db.prepare('SELECT source FROM change_log WHERE game_id = ?').all(row.id).map((r) => r.source);
  const v = judge(row, blob, evs, truth);
  ok('J8 the closing write lands for an NHL final: this game, before kickoff, logged once',
    v === 'right' && blob?._kickoff?.verified === true && log.length === 1 && log[0] === 'archive_game_closing',
    `verdict ${v}, verified ${blob?._kickoff?.verified}, change_log ${JSON.stringify(log)}`);
}

console.log(failed ? `\nFAILED: ${failed}` : '\nall scenarios pass');
console.log(`COVERAGE: the REAL snapshotCronOdds, runOddsBackfillForDate and /archive/game closing block from`);
console.log(`${path.relative(ROOT, INDEX) || INDEX}, on node:sqlite with a stubbed vendor: ${scenarios} scenarios. J1 checked ${fixtureRows} of`);
console.log(`${FIX.rows.length} rows of outbox/fixture-odds-join-shared-2026-10-23.json; J7 the 80 rows of fixture-cfb-2026-09-12.`);
console.log('It does not run the live vendor or any deployed worker.');
process.exit(failed ? 1 : 0);
