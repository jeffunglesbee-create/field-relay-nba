// docs/CC-CMD-2026-11-16-golf-tee-times.md, "2026-11-24 13:00Z": the owner's GO of 2026-11-24 ("Replace with
// one R4 row", with "Separate playoff row" as the playoff rule). One-shot. The RSM Classic final round was
// archived twice as "R5" (golf_2026-11-23_thersmclassic_r5, golf_2026-11-24_thersmclassic_r5): start 19:09Z,
// "Marco Penge -17". From ESPN's final leaderboard (outbox/golf-leaderboard-rsm-final-2026-11-24.json):
//   round 4  first tee 2026-11-23T12:20Z, Marco Penge -16 (official scoreToPar)
//   playoff  start 2026-11-23T19:09Z, Penge -1 over Michael Thorbjornsen, Haotong Li, Max Greyserman
// Writes golf_2026-11-23_thersmclassic_r4 and golf_2026-11-23_thersmclassic_po (copying every other column
// from the 11-23 R5 row, so nothing it carried is lost), then deletes both R5 rows.
//
// It refuses (exit 1) unless both R5 rows exist exactly as read on 2026-11-24 and neither target id exists.
// Each write must change one row; the read-back must show the two new rows and no R5 row. Re-running after
// success finds the target rows and no R5 rows, and changes nothing.
const RELAY = process.env.RELAY_BASE || 'https://field-relay-nba.jeffunglesbee.workers.dev';
const SECRET = process.env.RELAY_SHARED_SECRET;
const R5 = ['golf_2026-11-23_thersmclassic_r5', 'golf_2026-11-24_thersmclassic_r5'];
const R4 = 'golf_2026-11-23_thersmclassic_r4';
const PO = 'golf_2026-11-23_thersmclassic_po';

async function d1(sql, params) {
  if (!SECRET) throw new Error('RELAY_SHARED_SECRET is not set');
  const res = await fetch(`${RELAY}/d1/execute`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-FIELD-Relay': SECRET }, body: JSON.stringify({ sql, params }) });
  const text = await res.text();
  let body;
  try { body = JSON.parse(text); } catch { throw new Error(`d1 exec failed: HTTP ${res.status}, the body is not JSON: ${text.slice(0, 300)}`); }
  if (!res.ok || body.success === false) throw new Error(`d1 exec failed: HTTP ${res.status} ${JSON.stringify(body).slice(0, 300)}`);
  return body;
}
function rowsOf(body) {
  if (!Array.isArray(body.results)) throw new Error(`d1 exec: no results array: ${JSON.stringify(body).slice(0, 300)}`);
  return body.results;
}
const read = async () => rowsOf(await d1(`SELECT id, away, start_time, home_score, note FROM regular_season_games WHERE id IN (?, ?, ?, ?) ORDER BY id`, [...R5, R4, PO]));

async function main() {
  const before = await read();
  for (const r of before) console.log(`[before] ${r.id} ${r.away} start=${r.start_time} score=${r.home_score} note=${r.note}`);
  const ids = before.map(r => r.id);
  if (ids.includes(R4) && ids.includes(PO) && !R5.some(i => ids.includes(i))) { console.log('\nAlready applied: R4 and PO rows exist and no R5 row. Nothing to do.'); return; }
  for (const i of R5) {
    const r = before.find(x => x.id === i);
    if (!r) throw new Error(`${i} is missing; refusing`);
    if (r.away !== 'R5' || r.start_time !== '2026-11-23T19:09:00.000Z' || Number(r.home_score) !== -17 || r.note !== 'Marco Penge -17') throw new Error(`${i} is not the row read on 2026-11-24 (${JSON.stringify(r)}); refusing`);
  }
  if (ids.includes(R4) || ids.includes(PO)) throw new Error('a target row already exists beside the R5 rows; refusing');

  const full = rowsOf(await d1('SELECT * FROM regular_season_games WHERE id = ?', [R5[0]]));
  if (full.length !== 1) throw new Error('could not read the 11-23 R5 row in full');
  const names = Object.keys(full[0]);
  if (!names.includes('espn_event_id') || !names.includes('date')) throw new Error(`unexpected columns: ${names.join(', ')}`);
  const set = { id: null, away: null, start_time: null, home_score: null, note: null };
  const copyCols = names.filter(n => !(n in set));
  const insert = async (id, away, start, score, note) => {
    const sql = `INSERT INTO regular_season_games (id, away, start_time, home_score, note, ${copyCols.join(', ')}) SELECT ?, ?, ?, ?, ?, ${copyCols.join(', ')} FROM regular_season_games WHERE id = ?`;
    const r = await d1(sql, [id, away, start, score, note, R5[0]]);
    console.log(`[insert] ${id} changes=${r.meta?.changes}`);
    if (r.meta?.changes !== 1) throw new Error(`insert of ${id} changed ${r.meta?.changes} rows, expected exactly 1; nothing is deleted`);
  };
  await insert(R4, 'R4', '2026-11-23T12:20:00.000Z', -16, 'Marco Penge -16');
  await insert(PO, 'PO', '2026-11-23T19:09:00.000Z', -1, 'Marco Penge won the playoff over Max Greyserman, Michael Thorbjornsen, Haotong Li');
  for (const i of R5) {
    const r = await d1("DELETE FROM regular_season_games WHERE id = ? AND away = 'R5'", [i]);
    console.log(`[delete] ${i} changes=${r.meta?.changes}`);
    if (r.meta?.changes !== 1) throw new Error(`delete of ${i} changed ${r.meta?.changes} rows, expected exactly 1`);
  }
  const after = await read();
  for (const r of after) console.log(`[after]  ${r.id} ${r.away} start=${r.start_time} score=${r.home_score} note=${r.note}`);
  const a = Object.fromEntries(after.map(r => [r.id, r]));
  if (after.length !== 2 || a[R4]?.start_time !== '2026-11-23T12:20:00.000Z' || a[PO]?.start_time !== '2026-11-23T19:09:00.000Z') throw new Error('read back: not exactly the R4 and PO rows as written');
  console.log('\nDone: the RSM final is one R4 row and one PO row; no R5 row.');
}
main().catch(e => { console.error('FIX ERROR:', e.message); process.exit(1); });
