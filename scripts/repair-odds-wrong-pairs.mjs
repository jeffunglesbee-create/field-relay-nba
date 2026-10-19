#!/usr/bin/env node
// docs/CC-CMD-2026-10-19-cfb-stage2-wrong-pair.md TASK 3: the SQL that repairs
// the rows TASK 0 found. It WRITES NOTHING. It prints one transaction, which is
// sent to D1 once the owner has ruled, and a preview SELECT that shows what each
// statement would touch.
//
//   node scripts/repair-odds-wrong-pairs.mjs --swapped=sync|direct|null [--preview]
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

/** The predicate "this column was written from this history row". */
const fromRow = (field, ohId) =>
  `json_extract(${field}, '$.captured_at') = (SELECT snapshot_time FROM odds_history WHERE id = ${lit(ohId)})`;

function nullBlobs(ohId, why) {
  const g = lit(gameOf(ohId));
  return FIELDS.flatMap(f => [
    `INSERT INTO change_log (game_id, source, field, old_value, new_value) ` +
      `SELECT id, '${SOURCE}', '${f}', ${f}, 'NULL: ${why} (${DOC})' ` +
      `FROM regular_season_games WHERE id = ${g} AND ${fromRow(f, ohId)};`,
    `UPDATE regular_season_games SET ${f} = NULL WHERE id = ${g} AND ${fromRow(f, ohId)};`,
  ]);
}

function deleteRow(ohId, why) {
  const o = lit(ohId);
  return [
    `INSERT INTO change_log (game_id, source, field, old_value, new_value) ` +
      `SELECT game_id, '${SOURCE}', 'odds_history_row_deleted', ` +
      `json_object('id', id, 'home_team', home_team, 'away_team', away_team, 'commence_time', commence_time, ` +
      `'home_ml', home_ml, 'away_ml', away_ml, 'bookmaker', bookmaker, 'snapshot_time', snapshot_time), ` +
      `'deleted: ${why} (${DOC})' FROM odds_history WHERE id = ${o};`,
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
        `SELECT id, '${SOURCE}', '${f}', ${f}, json_set(${f}, '$.moneyline.home', -1667, '$.moneyline.away', 870) ` +
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

/** One read showing, per row and column, whether the guard matches today.
 *  One row per (history row, column): 24 when all 12 history rows exist. D1
 *  refuses a 24-term UNION ("too many terms in compound SELECT"), so the two
 *  columns are a 2-term cross join instead. */
export function preview() {
  const ids = [...OTHER_GAME, SWAPPED].map(lit).join(', ');
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
  console.log(fails ? `${fails} FAILED` : 'self-test passed');
  process.exit(fails ? 1 : 0);
}

const arg = (k) => process.argv.find(a => a.startsWith(`--${k}=`))?.split('=')[1];
if (process.argv.includes('--self-test')) selfTest();
else if (process.argv.includes('--preview')) console.log(preview());
else if (arg('swapped')) console.log(plan(arg('swapped')).join('\n'));
else { console.error('usage: --swapped=sync|direct|null | --preview | --self-test'); process.exit(2); }
