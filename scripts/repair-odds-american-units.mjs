#!/usr/bin/env node
// docs/CC-CMD-2026-10-19-odds-history-american-converted-twice.md TASKS 1 and 2:
// the SQL that puts odds_history in one unit and repairs the game rows the sync
// damaged. It WRITES NOTHING. It prints transactions, which are sent to D1 one
// call each, and the reads that show what they would touch and what they did.
//
//   node scripts/repair-odds-american-units.mjs --batches            how many
//   node scripts/repair-odds-american-units.mjs --batch=N            one transaction
//   node scripts/repair-odds-american-units.mjs --preview            guard matches today
//   node scripts/repair-odds-american-units.mjs --verify             the state after
//   node scripts/repair-odds-american-units.mjs --self-test
//
// THE DEFECT. scripts/targeted-odds-fill.mjs asked the vendor for American odds
// and stored them in odds_history, whose other writer stores decimal. The sync
// reads every odds_history price as decimal, so it converted these twice: 275
// became +27400, and -345 (at or below 1 as a "decimal") became null. It wrote
// that one blob to BOTH opening_odds and closing_odds of every game the fill
// priced: 211 games, 422 blobs (outbox/fixture-odds-american-targeted-2026-10-20.json).
//
// THE REPAIR, per game, under the owner's delegation of 2026-10-20 (TASK 1 (a),
// TASK 2 (a)):
//   1. each blob's moneyline is re-derived from its own history row, by team
//      (pricesByTeam, the sync's own reader), and nothing else in the blob
//      changes. Guarded on the blob still holding exactly the double-converted
//      values and the row's captured_at, so a blob any other writer has touched
//      since is left alone and shows up in --verify.
//   2. the history row is converted to decimal in place, guarded on it still
//      holding the American values. After this, odds_history is decimal
//      everywhere, and if any of these blobs is ever NULLed the sync rebuilds
//      the right price from it (the self-test proves that on all 211 rows).
// Every write is preceded by a change_log row that reads the value it replaces.

import { readFileSync } from 'node:fs';
import { pricesByTeam } from '../src/odds-name-match.js';
import { total } from './lib/summary-invariants.mjs';

const FIXTURE = 'outbox/fixture-odds-american-targeted-2026-10-20.json';
const SOURCE = 'american_odds_repair';
const DOC = 'docs/CC-CMD-2026-10-19-odds-history-american-converted-twice.md';
const PER_BATCH = 25;
const FIELDS = ['opening_odds', 'closing_odds'];

/** American to decimal, exactly: no rounding, so the sync's decimalToAmerican
 *  gives the American price back (proven on every real side in the self-test
 *  and in scripts/check-odds-history-units.mjs). */
export function americanToDecimal(a) {
  if (!Number.isFinite(a) || Math.abs(a) < 100) throw new Error(`not an American price: ${a}`);
  return a > 0 ? 1 + a / 100 : 1 + 100 / -a;
}

/** What the sync stored from an American price it took for decimal. */
const twice = (a) => (a == null ? null : a > 1 ? Math.round((a - 1) * 100) : null);

export function loadRows(path = FIXTURE) {
  const d = JSON.parse(readFileSync(path, 'utf8'));
  return d.rows.map(r => Object.fromEntries(d.columns.map((c, i) => [c, r[i]])));
}

// A literal goes into the SQL only if it matches a closed shape. The batch
// carries literals because D1 refuses params on a multi-statement call.
const ID = /^[A-Za-z0-9][A-Za-z0-9 _.-]*$/;
const lit = (s) => {
  if (typeof s !== 'string' || !ID.test(s)) throw new Error(`refusing to quote ${JSON.stringify(s)}`);
  return `'${s}'`;
};
const AT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;
const at = (s) => { if (!AT.test(s)) throw new Error(`not an instant: ${s}`); return `'${s}'`; };
const num = (x) => { if (!Number.isFinite(x)) throw new Error(`not a number: ${x}`); return String(x); };
const isv = (x) => (x == null ? 'NULL' : num(x));
/** A prose literal, quotes doubled. */
const text = (t) => `'${String(t).replace(/'/g, "''")}'`;

/** One game's plan: the values it holds, the values it should hold, or why not. */
export function planRow(r) {
  const byTeam = pricesByTeam({ home: r.a_home, away: r.a_away },
    { home_team: r.v_home, away_team: r.v_away, home_ml: r.home_ml, away_ml: r.away_ml });
  if (!byTeam) return { r, refused: 'the pairing direction cannot be read from the names' };
  const bad = { home: twice(r.home_ml), away: twice(r.away_ml), draw: twice(r.draw_ml) };
  const good = { home: byTeam.home, away: byTeam.away, draw: r.draw_ml };
  const dec = { home: americanToDecimal(r.home_ml), away: americanToDecimal(r.away_ml),
                draw: r.draw_ml == null ? null : americanToDecimal(r.draw_ml) };
  return { r, bad, good, dec, orientation: byTeam.orientation };
}

function statements(p) {
  const { r, bad, good, dec } = p;
  const g = lit(r.game_id), o = lit(r.id);
  const out = [];
  for (const f of FIELDS) {
    const guard = `id = ${g} AND json_extract(${f}, '$.captured_at') = ${at(r.snapshot_time)}`
      + ` AND json_extract(${f}, '$.moneyline.home') IS ${isv(bad.home)}`
      + ` AND json_extract(${f}, '$.moneyline.away') IS ${isv(bad.away)}`
      + (r.draw_ml == null ? '' : ` AND json_extract(${f}, '$.moneyline.draw') IS ${isv(bad.draw)}`);
    const set = `json_set(${f}, '$.moneyline.home', ${num(good.home)}, '$.moneyline.away', ${num(good.away)}`
      + (r.draw_ml == null ? '' : `, '$.moneyline.draw', ${num(good.draw)}`) + ')';
    out.push(`INSERT INTO change_log (game_id, source, field, old_value, new_value) `
      + `SELECT id, ${text(SOURCE)}, ${text(f)}, ${f}, ${set} FROM regular_season_games WHERE ${guard};`);
    out.push(`UPDATE regular_season_games SET ${f} = ${set} WHERE ${guard};`);
  }
  const ohGuard = `id = ${o} AND home_ml = ${num(r.home_ml)} AND away_ml = ${num(r.away_ml)} AND draw_ml IS ${isv(r.draw_ml)}`;
  out.push(`INSERT INTO change_log (game_id, source, field, old_value, new_value) `
    + `SELECT game_id, ${text(SOURCE)}, 'odds_history_units', `
    + `json_object('id', id, 'home_ml', home_ml, 'away_ml', away_ml, 'draw_ml', draw_ml), `
    + `${text(`decimal ${dec.home}/${dec.away}${dec.draw == null ? '' : `/${dec.draw}`}: the fill had asked for American odds (${DOC})`)} `
    + `FROM odds_history WHERE ${ohGuard};`);
  out.push(`UPDATE odds_history SET home_ml = ${num(dec.home)}, away_ml = ${num(dec.away)}, draw_ml = ${isv(dec.draw)} WHERE ${ohGuard};`);
  return out;
}

export function plans(rows = loadRows()) { return rows.map(planRow); }
export function batches(ps = plans()) {
  const ok = ps.filter(p => !p.refused);
  const out = [];
  for (let i = 0; i < ok.length; i += PER_BATCH) out.push(ok.slice(i, i + PER_BATCH).flatMap(statements));
  return out;
}

const TARGETED = `FROM odds_history oh JOIN regular_season_games g ON g.id = oh.game_id WHERE oh.id LIKE '%\\_targeted' ESCAPE '\\'`;
// The expected value of SQL's SUM(COALESCE(x, 0)): an absent price adds
// nothing on both sides. total() skips it out loud rather than as a zero.
const sumOf = (xs) => total(xs.map(v => ({ v })), 'v').sum;

/** Right before the write: the state still equals the fixture's. Aggregates,
 *  because one compact read is what can be sent by hand; each write is
 *  guarded on exact values anyway, so a drifted row is a no-op, not a wrong write. */
export function preview(rows = loadRows()) {
  const expect = { n: rows.length, s_home: sumOf(rows.map(r => r.home_ml)), s_away: sumOf(rows.map(r => r.away_ml)),
    s_draw: sumOf(rows.map(r => r.draw_ml)), s_oh: sumOf(rows.map(r => r.blob_home)), s_oa: sumOf(rows.map(r => r.blob_away)),
    s_od: sumOf(rows.map(r => r.blob_draw)), s_ch: sumOf(rows.map(r => r.blob_home)), s_ca: sumOf(rows.map(r => r.blob_away)),
    s_cd: sumOf(rows.map(r => r.blob_draw)), cap: rows.length, same: rows.length, other_history: 0 };
  const sql = `SELECT COUNT(*) AS n, SUM(oh.home_ml) AS s_home, SUM(oh.away_ml) AS s_away, SUM(COALESCE(oh.draw_ml, 0)) AS s_draw,
  SUM(COALESCE(json_extract(g.opening_odds, '$.moneyline.home'), 0)) AS s_oh, SUM(COALESCE(json_extract(g.opening_odds, '$.moneyline.away'), 0)) AS s_oa,
  SUM(COALESCE(json_extract(g.opening_odds, '$.moneyline.draw'), 0)) AS s_od, SUM(COALESCE(json_extract(g.closing_odds, '$.moneyline.home'), 0)) AS s_ch,
  SUM(COALESCE(json_extract(g.closing_odds, '$.moneyline.away'), 0)) AS s_ca, SUM(COALESCE(json_extract(g.closing_odds, '$.moneyline.draw'), 0)) AS s_cd,
  SUM(json_extract(g.opening_odds, '$.captured_at') = oh.snapshot_time AND json_extract(g.closing_odds, '$.captured_at') = oh.snapshot_time) AS cap,
  SUM(g.opening_odds = g.closing_odds) AS same,
  SUM((SELECT COUNT(*) FROM odds_history x WHERE x.game_id = oh.game_id AND x.id <> oh.id)) AS other_history
${TARGETED};`;
  return { sql, expect };
}

/** After the write: every row decimal, and every blob equal to what the sync's
 *  own conversion makes of its row, computed in SQL on what D1 now holds. */
export function verify(ps = plans()) {
  const ok = ps.filter(p => !p.refused);
  const back = (c) => `CAST(CASE WHEN oh.${c} >= 2 THEN ROUND((oh.${c} - 1) * 100) ELSE ROUND(-100 / (oh.${c} - 1)) END AS INTEGER)`;
  const synced = (f) => `json_extract(g.${f}, '$.moneyline.home') = ${back('home_ml')} AND json_extract(g.${f}, '$.moneyline.away') = ${back('away_ml')}`
    + ` AND (oh.draw_ml IS NULL OR json_extract(g.${f}, '$.moneyline.draw') = ${back('draw_ml')})`;
  const expect = { n: ok.length, history_decimal: ok.length, opening_synced: ok.length, closing_synced: ok.length,
    s_oh: sumOf(ok.map(p => p.good.home)), s_oa: sumOf(ok.map(p => p.good.away)), s_od: sumOf(ok.map(p => p.good.draw)),
    s_ch: sumOf(ok.map(p => p.good.home)), s_ca: sumOf(ok.map(p => p.good.away)), s_cd: sumOf(ok.map(p => p.good.draw)),
    change_log_rows: ok.length * 3 };
  const sql = `SELECT COUNT(*) AS n, SUM(oh.home_ml > 1 AND oh.home_ml < 100 AND oh.away_ml > 1 AND oh.away_ml < 100 AND (oh.draw_ml IS NULL OR oh.draw_ml < 100)) AS history_decimal,
  SUM(${synced('opening_odds')}) AS opening_synced, SUM(${synced('closing_odds')}) AS closing_synced,
  SUM(COALESCE(json_extract(g.opening_odds, '$.moneyline.home'), 0)) AS s_oh, SUM(COALESCE(json_extract(g.opening_odds, '$.moneyline.away'), 0)) AS s_oa,
  SUM(COALESCE(json_extract(g.opening_odds, '$.moneyline.draw'), 0)) AS s_od, SUM(COALESCE(json_extract(g.closing_odds, '$.moneyline.home'), 0)) AS s_ch,
  SUM(COALESCE(json_extract(g.closing_odds, '$.moneyline.away'), 0)) AS s_ca, SUM(COALESCE(json_extract(g.closing_odds, '$.moneyline.draw'), 0)) AS s_cd,
  (SELECT COUNT(*) FROM change_log c WHERE c.source = ${text(SOURCE)}) AS change_log_rows
${TARGETED};`;
  return { sql, expect };
}

/** The sync's own decimalToAmerican, read from its source, not copied. */
export function syncDecimalToAmerican() {
  const src = readFileSync('.github/scripts/odds-backfill.js', 'utf8');
  const start = src.indexOf('function decimalToAmerican(');
  if (start < 0) throw new Error('decimalToAmerican not found in odds-backfill.js');
  let depth = 0, i = src.indexOf('{', start);
  for (; i < src.length; i++) { if (src[i] === '{') depth++; else if (src[i] === '}' && --depth === 0) break; }
  return new Function(`${src.slice(start, i + 1)}\nreturn decimalToAmerican;`)();
}

async function selfTest() {
  let fails = 0;
  const t = (c, m) => { if (!c) { fails++; console.log(`FAIL  ${m}`); } else console.log(`PASS  ${m}`); };
  const rows = loadRows(), ps = plans(rows), B = batches(ps);
  const refused = ps.filter(p => p.refused);
  t(rows.length === 211 && new Set(rows.map(r => r.id)).size === 211, '211 distinct _targeted rows in the fixture');
  t(refused.length === 0, `every row's direction reads from the names (${refused.length} refused)`);
  t(ps.every(p => p.refused || p.orientation === 'straight'), 'all 211 are straight, so the stored blobs were positional AND by team');
  t(rows.every(r => r.blob_home === twice(r.home_ml) && r.blob_away === twice(r.away_ml) && r.blob_draw === twice(r.draw_ml)),
    'the stored blob is the double conversion of its row on all 211 (the measured mechanism)');
  t(B.length === Math.ceil(211 / PER_BATCH) && B.flat().length === 211 * 6, `${B.length} batches, ${B.flat().length} statements (6 per game)`);
  let threw = false; try { lit("x'); DROP TABLE odds_history; --"); } catch { threw = true; }
  t(threw, 'an id outside the closed shape is refused, not quoted');
  const s = B.flat();
  t(s.every((x, i) => !/^(UPDATE)/.test(x) || s[i - 1]?.startsWith('INSERT INTO change_log')),
    'each write is preceded by its change_log insert, which reads the old value');
  t(s.filter(x => x.startsWith('UPDATE regular_season_games')).every(u => /captured_at'\) = '[^']+' AND json_extract\(\w+, '\$\.moneyline\.home'\) IS /.test(u)),
    'every blob UPDATE is guarded on captured_at and the double-converted values');
  t(s.filter(x => x.startsWith('UPDATE odds_history')).every(u => / WHERE id = '[^']+_targeted' AND home_ml = -?\d+ AND away_ml = -?\d+ AND draw_ml IS /.test(u)),
    'every history UPDATE is guarded on the row still holding its American values');
  await engine(t, rows, ps, B);
  console.log(fails ? `${fails} FAILED` : 'self-test passed');
  process.exit(fails ? 1 : 0);
}

// THE SQL RUN IN SQLITE (D1 is SQLite) on all 211 real rows, seeded as the sync
// wrote them: one blob, in the sync's shape, in both columns.
async function engine(t, rows, ps, B) {
  const { DatabaseSync } = await import('node:sqlite');
  const d2a = syncDecimalToAmerican();
  const blob = (r) => JSON.stringify({ source: r.bookmaker, captured_at: r.snapshot_time,
    moneyline: { home: twice(r.home_ml), away: twice(r.away_ml), ...(r.draw_ml != null ? { draw: twice(r.draw_ml) } : {}) },
    _kickoff: { at: null, verified: false, late_minutes: null } });
  const seed = () => {
    const db = new DatabaseSync(':memory:');
    db.exec(`CREATE TABLE regular_season_games (id TEXT PRIMARY KEY, opening_odds TEXT, closing_odds TEXT);
      CREATE TABLE odds_history (id TEXT PRIMARY KEY, game_id TEXT, home_team TEXT, away_team TEXT,
        home_ml REAL, away_ml REAL, draw_ml REAL, bookmaker TEXT, snapshot_time TEXT);
      CREATE TABLE change_log (id INTEGER PRIMARY KEY AUTOINCREMENT, game_id TEXT NOT NULL, source TEXT NOT NULL,
        field TEXT NOT NULL, old_value TEXT, new_value TEXT NOT NULL, ts TEXT NOT NULL DEFAULT (datetime('now')));`);
    const g = db.prepare('INSERT INTO regular_season_games VALUES (?, ?, ?)');
    const h = db.prepare('INSERT INTO odds_history VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)');
    for (const r of rows) {
      g.run(r.game_id, blob(r), blob(r));
      h.run(r.id, r.game_id, r.v_home, r.v_away, r.home_ml, r.away_ml, r.draw_ml, r.bookmaker, r.snapshot_time);
    }
    return db;
  };
  const run = (db, sql) => { db.exec('BEGIN'); try { db.exec(sql); db.exec('COMMIT'); return null; } catch (e) { db.exec('ROLLBACK'); return e.message; } };
  const game = (db, id) => db.prepare('SELECT opening_odds AS o, closing_odds AS c FROM regular_season_games WHERE id = ?').get(id);
  const hrow = (db, id) => db.prepare('SELECT home_ml, away_ml, draw_ml FROM odds_history WHERE id = ?').get(id);
  const nlogs = (db) => db.prepare('SELECT COUNT(*) AS n FROM change_log').get().n;

  const db = seed();
  // Two states the plan must leave alone: a blob another writer replaced after
  // the export, and a blob already NULL.
  const moved = rows[5], nulled = rows[7];
  const other = JSON.stringify({ source: 'draftkings', captured_at: '2026-10-20T00:00:00.000Z', moneyline: { home: -150, away: 130 } });
  db.prepare('UPDATE regular_season_games SET opening_odds = ? WHERE id = ?').run(other, moved.game_id);
  db.prepare('UPDATE regular_season_games SET closing_odds = NULL WHERE id = ?').run(nulled.game_id);

  const errs = B.map(b => run(db, b.join('\n'))).filter(Boolean);
  t(errs.length === 0, `all ${B.length} transactions run in SQLite${errs.length ? ` (${errs[0]})` : ''}`);
  let blobsOk = 0, restOk = 0, histOk = 0, syncOk = 0, sides = 0;
  for (const p of ps) {
    const { r, good, dec } = p;
    const G = game(db, r.game_id), H = hrow(db, r.id);
    for (const [f, v] of [['o', G.o], ['c', G.c]]) {
      if ((r === moved && f === 'o') || (r === nulled && f === 'c')) continue;
      const b = JSON.parse(v);
      if (b.moneyline.home === good.home && b.moneyline.away === good.away && (b.moneyline.draw ?? null) === good.draw) blobsOk++;
      if (b.source === r.bookmaker && b.captured_at === r.snapshot_time && JSON.stringify(b._kickoff) === JSON.stringify({ at: null, verified: false, late_minutes: null })) restOk++;
    }
    if (H.home_ml === dec.home && H.away_ml === dec.away && H.draw_ml === dec.draw) histOk++;
    for (const [d, a] of [[H.home_ml, r.home_ml], [H.away_ml, r.away_ml], [H.draw_ml, r.draw_ml]]) {
      if (a == null) continue;
      sides++;
      if (d2a(d) === a) syncOk++;
    }
  }
  t(blobsOk === 420, `${blobsOk} of 420 blobs carry the row's own American prices, by team, draw included`);
  t(restOk === 420, `${restOk} of 420 blobs keep source, captured_at and _kickoff exactly`);
  t(histOk === 211, `${histOk} of 211 history rows are decimal now`);
  t(syncOk === sides && sides === 211 * 2 + 47, `the sync's own decimalToAmerican turns the converted rows back into the American price on ${syncOk} of ${sides} sides`);
  t(game(db, moved.game_id).o === other, 'a blob another writer replaced since the export is untouched');
  t(game(db, nulled.game_id).c === null, 'a blob already NULL stays NULL (the sync refills it from the decimal row)');
  const L = db.prepare('SELECT field, old_value, new_value FROM change_log ORDER BY id').all();
  t(L.length === 420 + 211, `${L.length} change_log rows, ${420 + 211} expected (one per write that matched)`);
  t(L.filter(x => x.field !== 'odds_history_units').every(x => JSON.parse(x.old_value).moneyline && JSON.parse(x.new_value).moneyline),
    'every blob change_log row carries the blob it replaced and the blob it wrote');
  t(L.filter(x => x.field === 'odds_history_units').every(x => Math.abs(JSON.parse(x.old_value).home_ml) >= 100),
    'every history change_log row carries the American prices it replaced');
  const before = nlogs(db);
  const again = B.map(b => run(db, b.join('\n'))).filter(Boolean);
  t(again.length === 0 && nlogs(db) === before, 'a second run changes nothing and logs nothing');
  // The two reads sent to D1 around the write, run here on a clean copy: the
  // preview must equal its expectation on the seeded state, and the verify must
  // FAIL there and pass after the batches.
  {
    const db2 = seed();
    const same = (got, want) => Object.entries(want).filter(([k, v]) => got[k] !== v).map(([k, v]) => `${k} ${got[k]}≠${v}`);
    const pv = preview(rows), vf = verify(ps);
    const p0 = same(db2.prepare(pv.sql).get(), pv.expect);
    t(p0.length === 0, `--preview equals its expectation on the state as exported${p0.length ? ` (${p0.join(', ')})` : ''}`);
    const v0 = same(db2.prepare(vf.sql).get(), vf.expect);
    t(v0.length > 0, `--verify fails on the unrepaired state (${v0.length} of ${Object.keys(vf.expect).length} fields differ)`);
    B.forEach(b => run(db2, b.join('\n')));
    const v1 = same(db2.prepare(vf.sql).get(), vf.expect);
    t(v1.length === 0, `--verify equals its expectation after the batches${v1.length ? ` (${v1.join(', ')})` : ''}`);
  }
  const e = db.prepare(`SELECT opening_odds FROM regular_season_games WHERE id = 'EFL Cup_2026-08-08_cambridge_barnet'`).get();
  t(JSON.parse(e.opening_odds).moneyline.home === -105 && JSON.parse(e.opening_odds).moneyline.draw === 240,
    'EFL Cup Cambridge v Barnet reads home -105, draw +240 (was null and +23900)');
  const c = db.prepare(`SELECT opening_odds FROM regular_season_games WHERE id = 'CFB_2026-08-29_emichigan_sacramentost'`).get();
  t(JSON.parse(c.opening_odds).moneyline.home === -345 && JSON.parse(c.opening_odds).moneyline.away === 275,
    'CFB E Michigan v Sacramento St reads -345 / +275 (was null / +27400)');
}

const arg = (k) => process.argv.find(a => a.startsWith(`--${k}=`))?.split('=')[1];
if (import.meta.url === `file://${process.argv[1]}`) {
  if (process.argv.includes('--self-test')) await selfTest();
  else if (process.argv.includes('--batches')) console.log(batches().length);
  else if (arg('batch')) { const b = batches()[Number(arg('batch')) - 1]; if (!b) { console.error('no such batch'); process.exit(2); } console.log(b.join('\n')); }
  else if (process.argv.includes('--preview')) { const v = preview(); console.log(`-- expect ${JSON.stringify(v.expect)}\n${v.sql}`); }
  else if (process.argv.includes('--verify')) { const v = verify(); console.log(`-- expect ${JSON.stringify(v.expect)}\n${v.sql}`); }
  else { console.error('usage: --batches | --batch=N | --preview | --verify | --self-test'); process.exit(2); }
}
