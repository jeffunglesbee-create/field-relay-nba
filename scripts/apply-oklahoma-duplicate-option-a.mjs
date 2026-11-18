// docs/CC-CMD-2026-10-16-cfl-archive-date-keying.md, the owner's GO for option A (2026-11-18,
// "Go with claudes best recommendations"; repeated 2026-11-18 as "Option A").
//
// One-shot, one pair: Oklahoma v Ole Miss, ESPN event 401856887, archived twice.
//   CFB_2026-11-14_e401856887  date 2026-11-14, start 2026-11-15T18:00Z, unscored, carries the opening line
//   CFB_2026-11-15_e401856887  date 2026-11-15, the final (24-17), opening_odds NULL
// Option A: copy the old row's opening_odds into the new row, then delete the old row. The one
// odds_history row keyed to the old id is NOT touched (its over and under prices exist nowhere else).
// No Odds API call.
//
// It refuses (exit 1) unless, read first:
//   * the event has exactly these two rows, the old one unscored and dated 2026-11-14, the new one
//     scored and dated 2026-11-15;
//   * the new row's opening_odds is NULL and the old row's is not.
// Each write must change exactly one row, and the read-back must show one row for the event, scored,
// carrying the copied line byte for byte. Re-running after success finds one row and changes nothing.

const RELAY = process.env.RELAY_BASE || 'https://field-relay-nba.jeffunglesbee.workers.dev';
const SECRET = process.env.RELAY_SHARED_SECRET;
const EVENT = '401856887';
const OLD = 'CFB_2026-11-14_e401856887';
const NEW = 'CFB_2026-11-15_e401856887';

async function d1(sql, params) {
  if (!SECRET) throw new Error('RELAY_SHARED_SECRET is not set');
  const res = await fetch(`${RELAY}/d1/execute`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-FIELD-Relay': SECRET },
    body: JSON.stringify({ sql, params }),
  });
  const text = await res.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    throw new Error(`d1 exec failed: HTTP ${res.status}, the body is not JSON: ${text.slice(0, 300)}`);
  }
  if (!res.ok || body.success === false) throw new Error(`d1 exec failed: HTTP ${res.status} ${JSON.stringify(body).slice(0, 300)}`);
  return body;
}

function rowsOf(body) {
  if (!Array.isArray(body.results)) throw new Error(`d1 exec: no results array in the answer: ${JSON.stringify(body).slice(0, 300)}`);
  return body.results;
}

const SELECT = `SELECT id, date, start_time, home_score, away_score, opening_odds, finalized_at
                FROM regular_season_games WHERE espn_event_id = ? ORDER BY date`;

async function main() {
  console.log(`=== Option A for event ${EVENT}: copy the opening line into ${NEW}, delete ${OLD} ===\n`);
  const before = rowsOf(await d1(SELECT, [EVENT]));
  for (const r of before) console.log(`[before] ${r.id} date=${r.date} score=${r.home_score}-${r.away_score} opening=${r.opening_odds ? 'present' : 'NULL'}`);

  if (before.length === 1 && before[0].id === NEW && before[0].opening_odds) {
    console.log('\nAlready applied: one row, the scored one, carrying an opening line. Nothing to do.');
    return;
  }
  const oldRow = before.find(r => r.id === OLD);
  const newRow = before.find(r => r.id === NEW);
  if (before.length !== 2 || !oldRow || !newRow) throw new Error(`expected exactly the two rows ${OLD} and ${NEW}, found ${before.map(r => r.id).join(', ')}`);
  if (oldRow.date !== '2026-11-14' || oldRow.home_score !== null) throw new Error(`${OLD} is not the unscored 2026-11-14 row this was written for; refusing`);
  if (newRow.date !== '2026-11-15' || newRow.home_score === null) throw new Error(`${NEW} is not the scored 2026-11-15 row this was written for; refusing`);
  if (newRow.opening_odds !== null) throw new Error(`${NEW} already has an opening line; option A's copy would overwrite it; refusing`);
  if (!oldRow.opening_odds) throw new Error(`${OLD} has no opening line to copy; refusing`);

  const copy = await d1(
    'UPDATE regular_season_games SET opening_odds = (SELECT opening_odds FROM regular_season_games WHERE id = ?) WHERE id = ? AND opening_odds IS NULL',
    [OLD, NEW]);
  console.log(`[copy] changes=${copy.meta?.changes}`);
  if (copy.meta?.changes !== 1) throw new Error(`the copy changed ${copy.meta?.changes} rows, expected exactly 1; the delete is not run`);

  const del = await d1(
    "DELETE FROM regular_season_games WHERE id = ? AND date = '2026-11-14' AND home_score IS NULL AND espn_event_id = ?",
    [OLD, EVENT]);
  console.log(`[delete] changes=${del.meta?.changes}`);
  if (del.meta?.changes !== 1) throw new Error(`the delete changed ${del.meta?.changes} rows, expected exactly 1`);

  const after = rowsOf(await d1(SELECT, [EVENT]));
  for (const r of after) console.log(`[after]  ${r.id} date=${r.date} score=${r.home_score}-${r.away_score} opening=${r.opening_odds ? 'present' : 'NULL'}`);
  if (after.length !== 1 || after[0].id !== NEW || after[0].opening_odds !== oldRow.opening_odds || after[0].home_score === null) {
    throw new Error('read back: the event is not one scored row carrying the copied opening line');
  }
  const hist = rowsOf(await d1('SELECT id FROM odds_history WHERE game_id = ?', [OLD]));
  console.log(`[kept] odds_history rows keyed to ${OLD}: ${hist.length} (left in place by the plan)`);
  console.log('\nDone: one row for the event, scored and carrying its opening line.');
}

main().catch(e => { console.error('OPTION A ERROR:', e.message); process.exit(1); });
