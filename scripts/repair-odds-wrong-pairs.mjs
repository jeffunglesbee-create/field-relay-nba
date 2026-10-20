#!/usr/bin/env node
// docs/CC-CMD-2026-10-19-cfb-stage2-wrong-pair.md TASK 3: the SQL that repairs
// the rows TASK 0 found. It WRITES NOTHING. It prints one transaction, which is
// sent to D1 once the owner has ruled, and a preview SELECT that shows what each
// statement would touch.
//
//   node scripts/repair-odds-wrong-pairs.mjs --swapped=sync|direct|null [--preview]
//   node scripts/repair-odds-wrong-pairs.mjs --set=stage1 [--preview]
//   node scripts/repair-odds-wrong-pairs.mjs --self-test
//
// THE 11 OTHER-GAME PAIRS. Each odds_history row priced a game from another
// game's event, so nothing in it is true of its game. The row is deleted, and
// every game-table column the sync wrote FROM it goes back to NULL. "Wrote from
// it" is a predicate, not a list: the blob's captured_at equals the row's
// snapshot_time, which only the sync stamps (every other writer stamps its own
// clock to the millisecond). 5 of the 11 games were filled by another writer
// first, so those games keep their blobs and lose only the history row.
//
// The history row MUST go. The sync fills any NULL column from odds_history
// every day at 10:00Z, so NULLing a blob and leaving its row would have the
// same wrong price back the next morning.
//
// THE SWAPPED PAIR, CFB_2026-09-19_e401856802. Its history row is right; the
// sync wrote it by position. Three choices, which are the owner's:
//   sync    NULL both blobs; the next 10:00Z backfill, running the fixed sync,
//           writes them by team. No credits: the date is already processed, so
//           only the sync touches it. That run is the production proof of
//           TASK 2.
//   direct  exchange the two moneylines in both blobs now, guarded on the
//           blob still holding the positional values.
//   null    NULL both blobs AND delete the history row, so they stay NULL.
//
// Every write is guarded on the state measured on 2026-10-19, so a row that has
// changed since is left alone and shows up in the verify read.

const OTHER_GAME = [
  'CFB_2026-09-19_e401856686_draftkings_close',
  'MLB_2026-09-16_e401816961_fanduel_close',
  'MLB_2026-09-17_e401816975_fanduel_close',
  'MLB_2026-09-20_e401817020_fanduel_close',
  'MLB_2026-09-20_e401817021_fanduel_close',
  'MLB_2026-09-24_e401817063_fanduel_close',
  'MLB_2026-09-24_e401817065_fanduel_close',
  'MLB_2026-09-24_e401817067_fanduel_close',
  'NHL_2026-10-04_e401892442_draftkings_close',
  'NHL_2026-10-10_e401892470_draftkings_close',
  'NHL_2026-10-12_e401892485_draftkings_close',
];
const SWAPPED = 'CFB_2026-09-19_e401856802_draftkings_close';
const SOURCE = 'stage2_wrong_pair_repair';
const DOC = 'docs/CC-CMD-2026-10-19-cfb-stage2-wrong-pair.md';
const FIELDS = ['opening_odds', 'closing_odds'];

// THE STAGE-1 SET (docs/CC-CMD-2026-10-19-odds-stage1-wrong-game.md TASK 2,
// owner approved 2026-10-20: "NULL 5 blobs, delete 15 rows"). Both team names
// right, the game wrong: 12 took the same teams' next game (1141-1740 min),
// 3 took their doubleheader twin's event (206-301 min). The two moved starts
// (+121, +235) are the right game and are not here. The 5 columns are a
// predicate, as above: the closing_odds of e401817001, 002, 004, 035, 907992.
export const STAGE1_WRONG = [
  'MLB_2026-09-19_e401817001_fanduel_close', 'MLB_2026-09-19_e401817002_fanduel_close',
  'MLB_2026-09-19_e401817004_fanduel_close', 'MLB_2026-09-22_e401817035_fanduel_close',
  'MLB_2026-09-26_e401817087_draftkings_close', 'MLB_2026-09-26_e401817090_fanduel_close',
  'MLB_2026-09-26_e401817091_draftkings_close', 'MLB_2026-09-26_e401817092_draftkings_close',
  'MLB_2026-09-29_e401907965_fanduel_close', 'MLB_2026-09-30_e401907972_draftkings_close',
  'MLB_2026-10-07_e401907992_draftkings_close', 'MLB_2026-10-15_e401908025_draftkings_close',
  'MLB_2026-09-23_e401923610_fanduel_close', 'MLB_2026-09-25_e401817088_fanduel_close',
  'MLB_2026-09-25_e401817104_fanduel_close',
];
const S1_SOURCE = 'stage1_wrong_game_repair';
const S1_DOC = 'docs/CC-CMD-2026-10-19-odds-stage1-wrong-game.md';

// A literal goes into the SQL only if it matches this closed shape. The batch
// carries literals because D1 refuses params on a multi-statement call (7400,
// measured 2026-10-18 by migrate-cfl-date-keying.mjs).
// Two shapes: an odds_history id, and the game id it carries.
const ID = /^(CFB|MLB|NHL)_\d{4}-\d{2}-\d{2}_e\d{9}(_(draftkings|fanduel)_close)?$/;
export function lit(id) {
  if (!ID.test(id)) throw new Error(`refusing to quote ${JSON.stringify(id)}: not a known odds_history or game id shape`);
  return `'${id}'`;
}
const gameOf = (ohId) => ohId.replace(/_(draftkings|fanduel)_close$/, '');
/** A prose literal. Quotes are doubled, so "game's" cannot end the string early:
 *  the first version of this file wrote it bare, and the self-test now runs the
 *  SQL in SQLite precisely so that such a slip fails here, not in D1. */
const text = (t) => `'${String(t).replace(/'/g, "''")}'`;

/** The predicate "this column was written from this history row". */
const fromRow = (field, ohId) =>
  `json_extract(${field}, '$.captured_at') = (SELECT snapshot_time FROM odds_history WHERE id = ${lit(ohId)})`;

function nullBlobs(ohId, why, src = SOURCE, doc = DOC) {
  const g = lit(gameOf(ohId));
  return FIELDS.flatMap(f => [
    `INSERT INTO change_log (game_id, source, field, old_value, new_value) ` +
      `SELECT id, ${text(src)}, ${text(f)}, ${f}, ${text(`NULL: ${why} (${doc})`)} ` +
      `FROM regular_season_games WHERE id = ${g} AND ${fromRow(f, ohId)};`,
    `UPDATE regular_season_games SET ${f} = NULL WHERE id = ${g} AND ${fromRow(f, ohId)};`,
  ]);
}

function deleteRow(ohId, why, src = SOURCE, doc = DOC) {
  const o = lit(ohId);
  return [
    `INSERT INTO change_log (game_id, source, field, old_value, new_value) ` +
      `SELECT game_id, ${text(src)}, 'odds_history_row_deleted', ` +
      `json_object('id', id, 'home_team', home_team, 'away_team', away_team, 'commence_time', commence_time, ` +
      `'home_ml', home_ml, 'away_ml', away_ml, 'bookmaker', bookmaker, 'snapshot_time', snapshot_time), ` +
      `${text(`deleted: ${why} (${doc})`)} FROM odds_history WHERE id = ${o};`,
    `DELETE FROM odds_history WHERE id = ${o};`,
  ];
}

// The swapped row's blobs hold the positional conversion: home +870 (West
// Virginia's 9.7), away -1667 (Virginia's 1.06). Exchanging them IS the by-team
// conversion, and the guard refuses any blob that no longer holds those values.
function exchange(ohId) {
  const g = lit(gameOf(ohId));
  return FIELDS.flatMap(f => {
    const guard = `id = ${g} AND ${fromRow(f, ohId)} AND json_extract(${f}, '$.moneyline.home') = 870 ` +
      `AND json_extract(${f}, '$.moneyline.away') = -1667`;
    return [
      `INSERT INTO change_log (game_id, source, field, old_value, new_value) ` +
        `SELECT id, ${text(SOURCE)}, ${text(f)}, ${f}, json_set(${f}, '$.moneyline.home', -1667, '$.moneyline.away', 870) ` +
        `FROM regular_season_games WHERE ${guard};`,
      `UPDATE regular_season_games SET ${f} = json_set(${f}, '$.moneyline.home', -1667, '$.moneyline.away', 870) WHERE ${guard};`,
    ];
  });
}

export function plan(swapped) {
  const s = [];
  for (const id of OTHER_GAME) {
    s.push(...nullBlobs(id, 'priced from another game\'s event by stage 2'));
    s.push(...deleteRow(id, 'another game\'s event, paired by stage 2'));
  }
  if (swapped === 'sync') s.push(...nullBlobs(SWAPPED, 'written by position from a swapped pairing; the sync rewrites it by team'));
  else if (swapped === 'direct') s.push(...exchange(SWAPPED));
  else if (swapped === 'null') {
    s.push(...nullBlobs(SWAPPED, 'written by position from a swapped pairing'));
    s.push(...deleteRow(SWAPPED, 'removed so the sync cannot rewrite the column'));
  } else throw new Error(`--swapped must be sync, direct or null, got ${JSON.stringify(swapped)}`);
  return s;
}

export function planStage1() {
  return STAGE1_WRONG.flatMap(id => [
    ...nullBlobs(id, 'the same teams\' other game: next day or a doubleheader twin', S1_SOURCE, S1_DOC),
    ...deleteRow(id, 'the same teams\' other game: next day or a doubleheader twin', S1_SOURCE, S1_DOC),
  ]);
}

/** One read showing, per row and column, whether the guard matches today.
 *  One row per (history row, column): 24 when all 12 history rows exist. D1
 *  refuses a 24-term UNION ("too many terms in compound SELECT"), so the two
 *  columns are a 2-term cross join instead. */
export function preview(list = [...OTHER_GAME, SWAPPED]) {
  const ids = list.map(lit).join(', ');
  return `SELECT oh.id AS oh_id, f.field,
  CASE f.field WHEN 'opening_odds' THEN json_extract(g.opening_odds, '$.captured_at')
               ELSE json_extract(g.closing_odds, '$.captured_at') END = oh.snapshot_time AS written_from_row,
  CASE f.field WHEN 'opening_odds' THEN json_extract(g.opening_odds, '$.moneyline.home') || '/' || json_extract(g.opening_odds, '$.moneyline.away')
               ELSE json_extract(g.closing_odds, '$.moneyline.home') || '/' || json_extract(g.closing_odds, '$.moneyline.away') END AS moneyline
FROM odds_history oh JOIN regular_season_games g ON g.id = oh.game_id
CROSS JOIN (SELECT 'opening_odds' AS field UNION ALL SELECT 'closing_odds') f
WHERE oh.id IN (${ids})
ORDER BY oh.id, f.field DESC;`;
}

function selfTest() {
  let fails = 0;
  const t = (c, m) => { if (!c) { fails++; console.log(`FAIL  ${m}`); } else console.log(`PASS  ${m}`); };
  t(OTHER_GAME.length === 11 && new Set(OTHER_GAME).size === 11, '11 distinct other-game rows');
  t(!OTHER_GAME.includes(SWAPPED), 'the swapped row is not among them');
  let threw = false; try { lit("x'); DROP TABLE odds_history; --"); } catch { threw = true; }
  t(threw, 'an id outside the closed shape is refused, not quoted');
  for (const m of ['sync', 'direct', 'null']) {
    const s = plan(m);
    const updates = s.filter(x => x.startsWith('UPDATE')), logs = s.filter(x => x.startsWith('INSERT INTO change_log'));
    const deletes = s.filter(x => x.startsWith('DELETE'));
    t(updates.every(u => /captured_at'\) = \(SELECT snapshot_time FROM odds_history WHERE id = /.test(u)),
      `${m}: every UPDATE is guarded on the column having been written from the history row`);
    t(logs.length === updates.length + deletes.length, `${m}: one change_log insert per write (${logs.length})`);
    t(s.every((x, i) => !x.startsWith('UPDATE') && !x.startsWith('DELETE') || s[i - 1]?.startsWith('INSERT INTO change_log')),
      `${m}: each write is preceded by its change_log insert, which reads the old value`);
    t(deletes.length === (m === 'null' ? 12 : 11), `${m}: ${deletes.length} history rows deleted`);
  }
  t(!plan('sync').some(x => x.includes(SWAPPED) && x.startsWith('DELETE')), 'sync keeps the swapped history row the sync needs');
  let bad = false; try { plan('maybe'); } catch { bad = true; }
  t(bad, 'an unknown --swapped value is refused');
  t(STAGE1_WRONG.length === 15 && new Set(STAGE1_WRONG).size === 15, 'stage 1: 15 distinct rows');
  t(!STAGE1_WRONG.some(id => OTHER_GAME.includes(id) || id === SWAPPED), 'stage 1: disjoint from the stage-2 set');
  t(!STAGE1_WRONG.some(id => /e401817019|e401817097/.test(id)), 'stage 1: the two moved starts (right game) are not in it');
  const p1 = planStage1();
  t(p1.filter(x => x.startsWith('DELETE')).length === 15 && p1.filter(x => x.startsWith('UPDATE')).length === 30,
    'stage 1: 15 deletes and 30 guarded column UPDATEs');
  t(p1.every(x => !x.includes('stage2_wrong_pair_repair') && !x.includes('cfb-stage2-wrong-pair.md')),
    'stage 1: change_log names the stage-1 source and document');
  return engine(t).then(() => {
    console.log(fails ? `${fails} FAILED` : 'self-test passed');
    process.exit(fails ? 1 : 0);
  });
}

// THE SQL RUN IN SQLITE (D1 is SQLite). A seeded database with the four states
// the preview measured on 2026-10-19: a game whose two columns came from its
// wrong row (CFB e401856686), one whose columns came from another writer (MLB
// e401816961), one with one of each (MLB e401817020), and the swapped game.
// Ids in the plan that are not seeded must match nothing and raise nothing.
async function engine(t) {
  const { DatabaseSync } = await import('node:sqlite');
  const SNAP = '2026-09-19T23:55:18Z', OTHER = '2026-09-16T10:02:13.597Z';
  const blob = (at, h, a) => JSON.stringify({ source: 'draftkings', captured_at: at, moneyline: { home: h, away: a }, total: { over: 50.5, under: 50.5 } });
  const seed = () => {
    const db = new DatabaseSync(':memory:');
    db.exec(`CREATE TABLE regular_season_games (id TEXT PRIMARY KEY, opening_odds TEXT, closing_odds TEXT);
      CREATE TABLE odds_history (id TEXT PRIMARY KEY, game_id TEXT, home_team TEXT, away_team TEXT, commence_time TEXT,
        home_ml REAL, away_ml REAL, bookmaker TEXT, snapshot_time TEXT);
      CREATE TABLE change_log (id INTEGER PRIMARY KEY AUTOINCREMENT, game_id TEXT NOT NULL, source TEXT NOT NULL,
        field TEXT NOT NULL, old_value TEXT, new_value TEXT NOT NULL, ts TEXT NOT NULL DEFAULT (datetime('now')));`);
    const g = db.prepare('INSERT INTO regular_season_games VALUES (?, ?, ?)');
    const h = db.prepare('INSERT INTO odds_history VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)');
    g.run('CFB_2026-09-19_e401856686', blob(SNAP, 311, -435), blob(SNAP, 311, -435));
    h.run('CFB_2026-09-19_e401856686_draftkings_close', 'CFB_2026-09-19_e401856686', 'Jacksonville State Gamecocks', 'Georgia Southern Eagles', '2026-09-19T23:02:23Z', 4.11, 1.23, 'draftkings', SNAP);
    g.run('MLB_2026-09-16_e401816961', blob(OTHER, -127, 105), blob(OTHER, -127, 105));
    h.run('MLB_2026-09-16_e401816961_fanduel_close', 'MLB_2026-09-16_e401816961', 'Chicago White Sox', 'Detroit Tigers', '2026-09-17T23:41:00Z', 1.79, 2.08, 'fanduel', SNAP);
    g.run('MLB_2026-09-20_e401817020', blob(OTHER, -163, 135), blob(SNAP, -112, -104));
    h.run('MLB_2026-09-20_e401817020_fanduel_close', 'MLB_2026-09-20_e401817020', 'Baltimore Orioles', 'Toronto Blue Jays', '2026-09-21T22:36:00Z', 1.89, 1.96, 'fanduel', SNAP);
    g.run('CFB_2026-09-19_e401856802', blob(SNAP, 870, -1667), blob(SNAP, 870, -1667));
    h.run(SWAPPED, 'CFB_2026-09-19_e401856802', 'West Virginia Mountaineers', 'Virginia Cavaliers', '2026-09-19T23:35:29Z', 9.7, 1.06, 'draftkings', SNAP);
    return db;
  };
  const run = (db, sql) => { db.exec('BEGIN'); try { db.exec(sql); db.exec('COMMIT'); return null; } catch (e) { db.exec('ROLLBACK'); return e.message; } };
  const game = (db, id) => db.prepare('SELECT opening_odds AS o, closing_odds AS c FROM regular_season_games WHERE id = ?').get(id);
  const hist = (db, id) => db.prepare('SELECT COUNT(*) AS n FROM odds_history WHERE id = ?').get(id).n;
  const logs = (db) => db.prepare('SELECT game_id, field, old_value, new_value FROM change_log ORDER BY id').all();

  for (const m of ['sync', 'direct', 'null']) {
    const db = seed();
    const err = run(db, plan(m).join('\n'));
    t(err === null, `${m}: the whole transaction runs in SQLite${err ? ` (${err})` : ''}`);
    if (err) continue;
    const A = game(db, 'CFB_2026-09-19_e401856686'), B = game(db, 'MLB_2026-09-16_e401816961'), C = game(db, 'MLB_2026-09-20_e401817020');
    t(A.o === null && A.c === null, `${m}: both columns written from the wrong row go to NULL`);
    t(B.o === blob(OTHER, -127, 105) && B.c === blob(OTHER, -127, 105), `${m}: columns another writer filled are untouched`);
    t(C.o === blob(OTHER, -163, 135) && C.c === null, `${m}: a game with one of each loses only the one from the row`);
    t(['CFB_2026-09-19_e401856686_draftkings_close', 'MLB_2026-09-16_e401816961_fanduel_close', 'MLB_2026-09-20_e401817020_fanduel_close']
      .every(id => hist(db, id) === 0), `${m}: the seeded other-game history rows are deleted`);
    const W = game(db, 'CFB_2026-09-19_e401856802');
    if (m === 'direct') {
      const o = JSON.parse(W.o), c = JSON.parse(W.c);
      t(o.moneyline.home === -1667 && o.moneyline.away === 870 && c.moneyline.home === -1667 && c.moneyline.away === 870 && o.total.over === 50.5,
        'direct: Virginia -1667, West Virginia +870, the rest of the blob kept');
    } else t(W.o === null && W.c === null, `${m}: the swapped game's columns go to NULL`);
    t(hist(db, SWAPPED) === (m === 'null' ? 0 : 1), `${m}: the swapped history row is ${m === 'null' ? 'deleted' : 'kept for the sync'}`);
    const L = logs(db);
    const want = 3 /* A x2, C closing */ + 3 /* history rows */ + (m === 'null' ? 3 : 2);
    t(L.length === want, `${m}: ${L.length} change_log rows, ${want} expected (one per write that matched)`);
    t(L.every(r => r.field === 'odds_history_row_deleted' ? !!JSON.parse(r.old_value).id : !!r.old_value?.includes('captured_at')),
      `${m}: every change_log row carries the value it replaced`);
    t(L.some(r => /another game's event/.test(r.new_value)), `${m}: prose with an apostrophe survives quoting intact`);
    const again = run(db, plan(m).join('\n'));
    t(again === null && logs(db).length === L.length, `${m}: a second run changes nothing and logs nothing`);
  }

  // Stage 1 on the measured shapes: e401817001's closing came from its wrong
  // row and its opening from another writer; e401817088's two came from others.
  {
    const db = seed();
    const SNAP1 = '2026-09-19T23:55:19Z', SNAP2 = '2026-09-25T23:55:23Z';
    db.prepare('INSERT INTO regular_season_games VALUES (?, ?, ?)').run('MLB_2026-09-19_e401817001', blob(OTHER, 109, -132), blob(SNAP1, 172, -204));
    db.prepare('INSERT INTO odds_history VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run('MLB_2026-09-19_e401817001_fanduel_close', 'MLB_2026-09-19_e401817001', 'Baltimore Orioles', 'Milwaukee Brewers', '2026-09-20T23:21:00Z', 2.72, 1.49, 'fanduel', SNAP1);
    db.prepare('INSERT INTO regular_season_games VALUES (?, ?, ?)').run('MLB_2026-09-25_e401817088', blob(OTHER, -162, 136), blob(OTHER, -142, 118));
    db.prepare('INSERT INTO odds_history VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run('MLB_2026-09-25_e401817088_fanduel_close', 'MLB_2026-09-25_e401817088', 'New York Yankees', 'Baltimore Orioles', '2026-09-25T23:31:12Z', 1.82, 1.96, 'fanduel', SNAP2);
    const before = logs(db).length;
    const err = run(db, planStage1().join('\n'));
    t(err === null, `stage 1: the whole transaction runs in SQLite${err ? ` (${err})` : ''}`);
    const a = game(db, 'MLB_2026-09-19_e401817001'), b = game(db, 'MLB_2026-09-25_e401817088');
    t(a.o === blob(OTHER, 109, -132) && a.c === null, 'stage 1: only the column written from the wrong row goes NULL');
    t(b.o === blob(OTHER, -162, 136) && b.c === blob(OTHER, -142, 118), 'stage 1: columns other writers filled are untouched');
    t(hist(db, 'MLB_2026-09-19_e401817001_fanduel_close') === 0 && hist(db, 'MLB_2026-09-25_e401817088_fanduel_close') === 0,
      'stage 1: both history rows deleted');
    const L1 = logs(db).slice(before);
    t(L1.length === 3 && L1.every(r => r.new_value.includes('odds-stage1-wrong-game.md')),
      `stage 1: ${L1.length} change_log rows naming the stage-1 document, 3 expected`);
    t(seedUntouched(db), 'stage 1: the stage-2 rows in the same database are not touched');
    const again = run(db, planStage1().join('\n'));
    t(again === null && logs(db).length === before + 3, 'stage 1: a second run changes nothing and logs nothing');
  }
  function seedUntouched(db) {
    return hist(db, SWAPPED) === 1 && game(db, 'CFB_2026-09-19_e401856686').o === blob(SNAP, 311, -435);
  }
}

const arg = (k) => process.argv.find(a => a.startsWith(`--${k}=`))?.split('=')[1];
if (process.argv.includes('--self-test')) await selfTest();
else if (arg('set') === 'stage1') console.log(process.argv.includes('--preview') ? preview(STAGE1_WRONG) : planStage1().join('\n'));
else if (process.argv.includes('--preview')) console.log(preview());
else if (arg('swapped')) console.log(plan(arg('swapped')).join('\n'));
else { console.error('usage: --swapped=sync|direct|null | --set=stage1 [--preview] | --preview | --self-test'); process.exit(2); }
