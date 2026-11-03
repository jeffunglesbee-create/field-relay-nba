// CC-CMD-2026-11-03-drama-backfill-error-is-not-a-score TASK 2.
// One-shot: Bundesliga_2026-10-31_e401884754 (Bayern 2, Dortmund 2) holds drama_peak = 0 and
// drama_arc = 'null' because the backfill's catch block stored a 403 as a score (run 41235124610,
// 2026-10-31 19:38:00Z). /archive/drama-by-id writes only WHERE drama_peak IS NULL, so the 0 is final
// until the row is reset. This resets that ONE row to NULL so the next drama-backfill run scores it.
//
// It refuses (exit 1, nothing written) unless:
//   * the row exists and is exactly the stored refusal (drama_peak 0, drama_arc 'null', event 401884754);
//   * ESPN's summary for the event answers 200 with key events through the relay NOW (a reset that
//     would only be refused again is not done: no fallback, no retry loop here);
//   * the UPDATE changes exactly one row.
// Re-running after success finds the row already NULL and changes nothing.

const RELAY = process.env.RELAY_BASE || 'https://field-relay-nba.jeffunglesbee.workers.dev';
const SECRET = process.env.RELAY_SHARED_SECRET;
const ID = 'Bundesliga_2026-10-31_e401884754';
const EVENT = '401884754';

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

// The rows of a /d1/execute answer. An answer with no results array is an error, not an empty table.
function rowsOf(body) {
  if (!Array.isArray(body.results)) throw new Error(`d1 exec: no results array in the answer: ${JSON.stringify(body).slice(0, 300)}`);
  return body.results;
}

const SELECT = `SELECT id, sport, date, home, away, home_score, away_score, drama_peak, drama_arc, espn_event_id, finalized_at
                FROM regular_season_games WHERE id = ?`;

async function main() {
  console.log(`=== Reset the Drama row stored from a refused read: ${ID} ===\n`);

  const before = rowsOf(await d1(SELECT, [ID]));
  if (before.length !== 1) throw new Error(`expected exactly 1 row for ${ID}, found ${before.length}`);
  const row = before[0];
  console.log(`[before] ${JSON.stringify(row)}`);

  if (row.drama_peak === null && row.drama_arc === null) {
    console.log('\nAlready NULL / NULL: nothing to reset.');
    return;
  }
  if (row.drama_peak !== 0 || row.drama_arc !== 'null' || row.espn_event_id !== EVENT) {
    throw new Error('the row is not the stored refusal this script was written for (drama_peak 0, drama_arc "null", event ' + EVENT + '); refusing to touch it');
  }

  const url = `${RELAY}/espn-summary/sports/soccer/fifa.world/summary?event=${EVENT}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`ESPN summary for ${EVENT} answers HTTP ${res.status} through the relay: a reset now would only be refused again; not resetting`);
  const data = await res.json();
  const keyEvents = (data.keyEvents || []).length;
  if (keyEvents === 0) throw new Error(`ESPN summary for ${EVENT} answers 200 with no key events; not resetting`);
  console.log(`[proof] ESPN summary 200 through the relay, ${keyEvents} key events (final score in D1: ${row.home_score}-${row.away_score})`);

  const upd = await d1(
    'UPDATE regular_season_games SET drama_peak = NULL, drama_arc = NULL WHERE id = ? AND drama_peak = 0 AND drama_arc = ? AND espn_event_id = ?',
    [ID, 'null', EVENT]);
  const changes = upd.meta?.changes;
  console.log(`[reset] changes=${changes}`);
  if (changes !== 1) throw new Error(`the reset changed ${changes} rows, expected exactly 1`);

  const after = rowsOf(await d1(SELECT, [ID]));
  console.log(`[after]  ${JSON.stringify(after[0])}`);
  if (after.length !== 1 || after[0].drama_peak !== null || after[0].drama_arc !== null) {
    throw new Error('read back after the reset: the row is not NULL / NULL');
  }
  console.log('\nDone: the row is NULL / NULL and is listed by /archive/drama-missing.');
}

main().catch(e => { console.error('RESET ERROR:', e.message); process.exit(1); });
