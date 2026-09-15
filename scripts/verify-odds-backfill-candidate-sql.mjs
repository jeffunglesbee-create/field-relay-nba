#!/usr/bin/env node
// READ-ONLY. Does the backfill's candidate query — as edited on 2026-09-15 —
// actually run against live D1, and do its three new columns say what the loop
// assumes?
//
// The loop that consumes them runs unattended at `cron: '0 10 * * *'`. A SQL
// error there is a silent no-op day; a column that comes back in an unexpected
// shape is worse, because `!!row.opening_is_null` turns any truthy value into
// "empty" and the writer starts skipping real work or logging phantom writes
// again.
//
// The query is read FROM THE SCRIPT, not retyped: a verifier that restates its
// subject verifies the copy.
//
// NO WRITE PATH. SELECT only, enforced.
import { readFileSync, writeFileSync } from 'node:fs';

const RELAY = process.env.RELAY_BASE || 'https://field-relay-nba.jeffunglesbee.workers.dev';
const GATE = process.env.RELAY_SHARED_SECRET;
const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const log = [];
const say = (s) => { console.log(s); log.push(s); };

async function d1(sql, params = []) {
  if (!GATE) throw new Error('RELAY_SHARED_SECRET is not set');
  if (!/^\s*SELECT\b/i.test(sql)) throw new Error('this script issues SELECT only');
  const res = await fetch(`${RELAY}/d1/execute`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-FIELD-Relay': GATE, 'User-Agent': UA },
    body: JSON.stringify({ sql, params }),
  });
  const b = await res.json().catch(() => ({}));
  if (!res.ok || b.success === false) throw new Error(`d1 HTTP ${res.status}: ${JSON.stringify(b).slice(0, 500)}`);
  return b.results || [];
}

// Lift the literal out of the script itself.
const SRC = readFileSync('.github/scripts/odds-backfill.js', 'utf8');
const start = SRC.indexOf('`SELECT oh.game_id, oh.sport');
const end = SRC.indexOf('GROUP BY oh.game_id`', start);
if (start < 0 || end < 0) { console.error('FAIL: could not locate the candidate query in the script'); process.exit(1); }
const SQL = SRC.slice(start + 1, end + 'GROUP BY oh.game_id'.length);
if (SQL.includes('${')) { console.error('FAIL: the candidate query interpolates; this verifier cannot run it verbatim'); process.exit(1); }

let fails = 0;
const check = (ok, why) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${why}`); log.push(`${ok ? 'PASS' : 'FAIL'}  ${why}`); if (!ok) fails++; };

(async () => {
  say(`=== backfill candidate SQL  relay=${RELAY}  utc=${new Date().toISOString()} ===`);
  say(`\n--- the query, lifted from .github/scripts/odds-backfill.js (${SQL.length} chars)`);

  let rows;
  try { rows = await d1(SQL); }
  catch (e) { check(false, `the candidate query runs against live D1 — ${e.message}`); process.exit(1); }
  check(true, 'the candidate query runs against live D1');
  say(`    ${rows.length} candidate row(s)`);

  if (!rows.length) {
    say('\n    No candidates today, so the column shapes below cannot be checked.');
    say('    That is a real state, not a pass: reported as UNVERIFIED rather than green.');
    check(false, 'at least one candidate row exists to check the new columns against');
  } else {
    const keys = Object.keys(rows[0]);
    for (const col of ['game_table', 'opening_is_null', 'closing_is_null'])
      check(keys.includes(col), `the query returns ${col}`);

    const tables = new Set(rows.map(r => r.game_table));
    check([...tables].every(t => t === null || t === 'regular_season_games' || t === 'postseason_games'),
      `game_table is a real table name or null (saw: ${[...tables].join(', ')})`);

    const flags = new Set(rows.flatMap(r => [r.opening_is_null, r.closing_is_null]));
    check([...flags].every(v => v === 0 || v === 1 || v === null),
      `the emptiness flags are 0/1/null, which !! reads correctly (saw: ${[...flags].join(', ')})`);

    // The flags must agree with the tables they describe, or the loop skips
    // real work. Cross-checked against the games rows themselves.
    let agreed = 0, disagreed = 0;
    for (const r of rows.slice(0, 25)) {
      if (!r.game_table) continue;
      const [truth] = await d1(
        `SELECT opening_odds IS NULL AS o, closing_odds IS NULL AS c FROM ${r.game_table} WHERE id = ?`,
        [r.game_id]);
      if (!truth) continue;
      if (truth.o === r.opening_is_null && truth.c === r.closing_is_null) agreed++;
      else {
        disagreed++;
        say(`      DISAGREE ${r.game_id}: query says ${r.opening_is_null}/${r.closing_is_null}, row says ${truth.o}/${truth.c}`);
      }
    }
    check(disagreed === 0, `the flags match the games row they describe (${agreed} checked, ${disagreed} disagreed)`);
    say(`\n    coverage: flags cross-checked on ${agreed + disagreed} of ${rows.length} candidate row(s)`
      + ` — capped at 25, one extra SELECT each.`);

    for (const r of rows.slice(0, 5))
      say(`      ${r.game_id}  table=${r.game_table}  open_null=${r.opening_is_null}  close_null=${r.closing_is_null}  date=${r.game_date}`);
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  writeFileSync(`outbox/backfill-candidate-sql-${stamp}.log`, log.join('\n') + '\n');
  console.log(`\nwrote outbox/backfill-candidate-sql-${stamp}.log`);
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error('FAIL:', e.message); process.exit(1); });
