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
    const got = [];
    for (const id of k.ids) {
      const rows = await d1(
        `SELECT id, home, away, home_score, away_score, espn_event_id, start_time, finalized_at,
                opening_odds, closing_odds
           FROM ${k.table} WHERE id = ?`, [id]);
      const g = rows[0] || {};
      got.push(g);
      say(`    ${g.id}`);
      say(`      ${g.home} ${g.home_score} - ${g.away_score} ${g.away}   espn=${g.espn_event_id ?? 'none'}`);
      say(`      start_time=${g.start_time ?? 'none'}  finalized_at=${g.finalized_at ?? 'none'}`);
      for (const col of k.columns) say(`      ${col}: ${g[col]}`);
    }

    // THE TEST THAT REPLACES CHOOSING A WRITER.
    //
    // A closing line is the last price BEFORE kickoff. That is not a preference
    // between two sources, it is what the column means, and it is decidable
    // from the row — so the question stops being "which line is right" and
    // becomes "is this a closing line at all".
    //
    // ONE ROW OF A COLLISION PAIR MAY CARRY NO start_time. That is exactly why
    // the pair exists: the two rows are the same match split across two
    // writers, so the twin's kickoff IS this row's kickoff. Taking it from the
    // twin is not an assumption; it is the definition of the pair.
    const kickoff = got.map(g => g.start_time).find(Boolean);
    if (!kickoff) {
      // Rule 99: neither row could be asked. That is not "both are fine".
      say(`      VERDICT: neither row carries start_time — the test cannot be run on this pair.`);
    } else {
      say(`      kickoff (from whichever row has it): ${kickoff}`);
      const norm = (t) => String(t).replace('T', ' ').replace('Z', '').replace('+00:00', '').slice(0, 19);
      const k0 = norm(kickoff);
      for (const g of got) {
        for (const col of k.columns) {
          let cap = null;
          try { cap = JSON.parse(g[col] || '{}').captured_at ?? null; } catch { cap = null; }
          if (!cap) { say(`      ${g.id} ${col}: no captured_at — cannot place it against kickoff`); continue; }
          const late = norm(cap) >= k0;
          say(`      ${g.id} ${col}: captured ${cap} -> ${late ? 'AFTER kickoff: an IN-PLAY price' : 'before kickoff: a closing price'}`);
        }
      }
    }
    say('');
  }
  const p = `outbox/collision-odds-conflicts-${new Date().toISOString().replace(/[:.]/g, '-')}.log`;
  writeFileSync(p, log.join('\n') + '\n');
  console.log(`wrote ${p}`);
})().catch(e => { console.error(`FAILED: ${e.message}`); process.exit(1); });
