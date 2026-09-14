#!/usr/bin/env node
// READ-ONLY. Prints both closing lines for every collision pair the symmetric
// merge refused, so the conflict can be decided by a human on the values rather
// than on two hashes.
//
// WHY IT EXISTS: the census serves an FNV digest, not the blob — deliberately,
// the blobs are large and nothing downstream reads them. A digest proves two
// rows differ; it cannot say which line is right. That decision needs the
// prices, and this repo does not correct or invent odds.
//
// NO WRITE PATH. The only SQL here is SELECT.
import { writeFileSync } from 'node:fs';
import { buildSymmetricPlan } from './collision-cleanup-plan.mjs';

const RELAY = process.env.RELAY_BASE || 'https://field-relay-nba.jeffunglesbee.workers.dev';
const GATE = process.env.RELAY_SHARED_SECRET;
const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const log = [];
const say = (s) => { console.log(s); log.push(s); };

async function d1(sql, params = []) {
  if (!GATE) throw new Error('RELAY_SHARED_SECRET is not set');
  if (!/^\s*SELECT\b/i.test(sql)) throw new Error('this probe issues SELECT only');
  const res = await fetch(`${RELAY}/d1/execute`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-FIELD-Relay': GATE, 'User-Agent': UA },
    body: JSON.stringify({ sql, params }),
  });
  const b = await res.json().catch(() => ({}));
  if (!res.ok || b.success === false) throw new Error(`d1 HTTP ${res.status}: ${JSON.stringify(b).slice(0, 300)}`);
  return b.results || [];
}

(async () => {
  const r = await fetch(`${RELAY}/identity/substitution-census`, { headers: { 'User-Agent': UA } });
  const d = await r.json();
  if (!d.ok) throw new Error(`census not ok: ${d.error}`);
  if (d.same_slate_pair_detail_error) throw new Error(`census detail error: ${d.same_slate_pair_detail_error}`);
  const { conflicts } = buildSymmetricPlan(d.same_slate_pair_colliding || []);
  say(`=== collision odds conflicts  ${new Date().toISOString()} ===`);
  say(`${conflicts.length} conflicting pair(s) of ${d.same_slate_pair_collisions} collisions\n`);

  for (const k of conflicts) {
    say(`--- ${k.table} ${k.date} ${k.sport}  [${k.columns.join(', ')}]`);
    for (const id of k.ids) {
      const rows = await d1(
        `SELECT id, home, away, home_score, away_score, espn_event_id, finalized_at,
                opening_odds, closing_odds
           FROM ${k.table} WHERE id = ?`, [id]);
      const g = rows[0] || {};
      say(`    ${g.id}`);
      say(`      ${g.home} ${g.home_score} - ${g.away_score} ${g.away}   espn=${g.espn_event_id ?? 'none'}  finalized=${g.finalized_at ?? 'none'}`);
      for (const col of k.columns) say(`      ${col}: ${g[col]}`);
    }
    say('');
  }
  const p = `outbox/collision-odds-conflicts-${new Date().toISOString().replace(/[:.]/g, '-')}.log`;
  writeFileSync(p, log.join('\n') + '\n');
  console.log(`wrote ${p}`);
})().catch(e => { console.error(`FAILED: ${e.message}`); process.exit(1); });
