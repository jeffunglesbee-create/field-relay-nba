// docs/CC-CMD-2026-11-16-golf-tee-times.md, "Reads 2 and 3": the owner's GO of 2026-11-20 ("Correct both
// to 13:30Z"). One-shot, two rows: the RSM Classic round-1 archive rows were written with start_time
// 2026-11-19T13:41Z by the status-based tee-time reader (fixed in 3cbe458); the round's first tee was
// 2026-11-19T13:30Z (147 of 147 linescores, outbox/golf-leaderboard-rsm-r2-2026-11-20.json).
//
// It refuses (exit 1) unless each row exists and still reads 13:41Z. Each UPDATE must change exactly one
// row, and the read-back must show 13:30Z on both. Re-running after success finds 13:30Z and changes
// nothing. No other column is touched.
const RELAY = process.env.RELAY_BASE || 'https://field-relay-nba.jeffunglesbee.workers.dev';
const SECRET = process.env.RELAY_SHARED_SECRET;
const IDS = ['golf_2026-11-19_thersmclassic_r1', 'golf_2026-11-20_thersmclassic_r1'];
const WRONG = '2026-11-19T13:41:00.000Z';
const RIGHT = '2026-11-19T13:30:00.000Z';

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
const read = async () => rowsOf(await d1(`SELECT id, start_time FROM regular_season_games WHERE id IN (?, ?) ORDER BY id`, IDS));

async function main() {
  const before = await read();
  for (const r of before) console.log(`[before] ${r.id} start_time=${r.start_time}`);
  if (before.length !== 2) throw new Error(`expected the two rows ${IDS.join(', ')}, found ${before.map(r => r.id).join(', ') || 'none'}`);
  if (before.every(r => r.start_time === RIGHT)) { console.log('\nAlready applied: both rows read 13:30Z. Nothing to do.'); return; }
  for (const r of before) if (r.start_time !== WRONG && r.start_time !== RIGHT) throw new Error(`${r.id} reads ${r.start_time}, neither the wrong ${WRONG} nor ${RIGHT}; refusing`);
  for (const r of before.filter(x => x.start_time === WRONG)) {
    const u = await d1('UPDATE regular_season_games SET start_time = ? WHERE id = ? AND start_time = ?', [RIGHT, r.id, WRONG]);
    console.log(`[update] ${r.id} changes=${u.meta?.changes}`);
    if (u.meta?.changes !== 1) throw new Error(`the update of ${r.id} changed ${u.meta?.changes} rows, expected exactly 1`);
  }
  const after = await read();
  for (const r of after) console.log(`[after]  ${r.id} start_time=${r.start_time}`);
  if (after.length !== 2 || !after.every(r => r.start_time === RIGHT)) throw new Error('read back: the two rows do not both read 13:30Z');
  console.log('\nDone: both RSM round-1 rows carry the round\'s first tee, 13:30Z.');
}
main().catch(e => { console.error('FIX ERROR:', e.message); process.exit(1); });
