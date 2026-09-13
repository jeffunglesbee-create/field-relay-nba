#!/usr/bin/env node
// Repair for the 2026-09-13 collision cleanup run that deleted 82 rows and then
// failed before writing change_log.
//
// WHAT HAPPENED. run-collision-cleanup.mjs batched change_log inserts 40 rows at
// a time, 6 bound parameters each — 240 against D1's cap of 100. The statement
// threw AFTER the deletes had committed, so the archive changed and the record
// of it did not. The delete chunk of 50 survived only because it binds one
// parameter per row.
//
// WHAT THIS DOES. Reconstructs the 82 entries from two COMMITTED artifacts —
// the run's own failure log for the ids, the keeper table for the display names
// those rows carried — and writes them. It re-reads the archive first and
// refuses any id that still exists, because an entry saying a row was deleted
// when it was not is worse than no entry.
//
// Read-only except for INSERTs into change_log. It cannot delete.
import { readFileSync, writeFileSync } from 'node:fs';

const RELAY = process.env.RELAY_BASE || 'https://field-relay-nba.jeffunglesbee.workers.dev';
const APPLY = process.argv.includes('--apply');
const GATE = process.env.RELAY_SHARED_SECRET;
const LOG = process.argv[2];
const KEEPER = process.argv[3];
if (!LOG || !KEEPER) {
  console.error('usage: repair-collision-cleanup-changelog.mjs <failure.log> <keeper-table.json> [--apply]');
  process.exit(2);
}

const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const out = [];
const say = (s) => { console.log(s); out.push(s); };

async function d1(sql, params = []) {
  if (!GATE) throw new Error('RELAY_SHARED_SECRET is not set');
  const res = await fetch(`${RELAY}/d1/execute`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-FIELD-Relay': GATE, 'User-Agent': UA },
    body: JSON.stringify({ sql, params }),
  });
  const b = await res.json().catch(() => ({}));
  if (!res.ok || b.success === false) throw new Error(`d1 HTTP ${res.status}: ${JSON.stringify(b).slice(0, 300)}`);
  return b.results || [];
}
const chunk = (a, n) => Array.from({ length: Math.ceil(a.length / n) }, (_, i) => a.slice(i * n, i * n + n));

(async () => {
  say(`=== changelog repair  apply=${APPLY}  utc=${new Date().toISOString()} ===`);

  const deleted = [...readFileSync(LOG, 'utf8').matchAll(
    /DELETE (\S+) (\S+) (\S+)\s+(\S.*?)\s+\(keeper (.+?)\)\s*$/gm)]
    .map(m => ({ table: m[1], date: m[2], sport: m[3], id: m[4], keeper: m[5] }));
  say(`\n--- parsed ${deleted.length} DELETE line(s) from ${LOG}`);

  // Names come from the keeper table, which was captured BEFORE the delete.
  const kt = JSON.parse(readFileSync(KEEPER, 'utf8'));
  const nameById = new Map();
  for (const d of kt.decisions) for (const g of d.rows) nameById.set(g.id, { home: g.home, away: g.away });
  const missingNames = deleted.filter(d => !nameById.has(d.id));
  say(`    names recovered for ${deleted.length - missingNames.length} of ${deleted.length}`);
  if (missingNames.length) {
    say(`STOP: no captured names for ${missingNames.length} id(s); the entry would be incomplete.`);
    process.exit(1);
  }

  // Refuse any id that still exists. An entry claiming a deletion that did not
  // happen is worse than a missing entry.
  say(`\n--- confirming every id is actually gone`);
  let stillThere = [];
  for (const c of chunk(deleted, 50)) {
    const r = await d1(`SELECT id FROM regular_season_games WHERE id IN (${c.map(() => '?').join(',')})`,
                       c.map(d => d.id));
    stillThere.push(...r.map(x => x.id));
  }
  say(`    still present: ${stillThere.length}`);
  if (stillThere.length) {
    say(`STOP: ${stillThere.length} id(s) still exist — ${stillThere.slice(0, 5).join(', ')}`);
    process.exit(1);
  }

  // And refuse to double-write if a previous repair already landed.
  const already = (await d1(
    `SELECT COUNT(*) n FROM change_log WHERE source = 'collision_cleanup'`))[0]?.n ?? 0;
  say(`    change_log entries already present for this source: ${already}`);
  if (already > 0) { say('STOP: entries already exist; refusing to duplicate.'); process.exit(1); }

  if (!APPLY) {
    say(`\nDRY RUN. ${deleted.length} entries would be written. Re-run with --apply.`);
  } else {
    const D1_MAX_BOUND_PARAMS = 100, COLUMNS = 6;
    const size = Math.floor(D1_MAX_BOUND_PARAMS / COLUMNS);
    let n = 0;
    for (const c of chunk(deleted, size)) {
      const params = [];
      for (const d of c) {
        const nm = nameById.get(d.id);
        params.push(d.id, 'collision_cleanup', 'row_deleted',
                    JSON.stringify({ table: d.table, date: d.date, sport: d.sport, home: nm.home, away: nm.away }),
                    d.keeper, new Date().toISOString());
      }
      await d1(`INSERT INTO change_log (game_id, source, field, old_value, new_value, ts) VALUES ${
        c.map(() => '(?, ?, ?, ?, ?, ?)').join(', ')}`, params);
      n += c.length;
    }
    say(`\n--- wrote ${n} change_log entries in chunks of ${size}`);
    const check = (await d1(`SELECT COUNT(*) n FROM change_log WHERE source = 'collision_cleanup'`))[0]?.n;
    say(`    change_log now holds ${check} entries for this source`);
    if (check !== deleted.length) { say(`MISMATCH: expected ${deleted.length}`); process.exit(1); }
  }

  const p = `outbox/changelog-repair-${new Date().toISOString().replace(/[:.]/g, '-')}.log`;
  writeFileSync(p, out.join('\n') + '\n');
  console.log(`\nwrote ${p}`);
})().catch(e => {
  console.error(`\nFAILED: ${e.message}`);
  writeFileSync(`outbox/changelog-repair-failed-${Date.now()}.log`, out.concat(`FAILED: ${e.message}`).join('\n') + '\n');
  process.exit(1);
});
