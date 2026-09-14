#!/usr/bin/env node
// Verifies the keeper table's verdict on the 82 postseason MLS collisions:
//
//     "both scored with identical scores and neither carry an espn_event_id
//      — nothing distinguishes them"
//
// THAT WAS SAID FROM A PROJECTION, NOT FROM THE ROW. The census returns 19
// fields per row; the table has more. "Nothing distinguishes them" is a claim
// about the whole row, and it was made from a subset — the same source-versus-
// copy substitution this repo keeps finding.
//
// So this reads SELECT * for both sides of every pair and diffs every column,
// then reads change_log for the same ids. Read-only: SELECTs only, no verb here
// can write.
import { writeFileSync } from 'node:fs';

const RELAY = process.env.RELAY_BASE || 'https://field-relay-nba.jeffunglesbee.workers.dev';
const GATE = process.env.RELAY_SHARED_SECRET;
const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

async function d1(sql, params = []) {
  if (!GATE) throw new Error('RELAY_SHARED_SECRET is not set');
  if (!/^\s*SELECT\b/i.test(sql)) throw new Error('this probe issues SELECTs only');
  const r = await fetch(`${RELAY}/d1/execute`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-FIELD-Relay': GATE, 'User-Agent': UA },
    body: JSON.stringify({ sql, params }),
  });
  const b = await r.json().catch(() => ({}));
  if (!r.ok || b.success === false) throw new Error(`d1 HTTP ${r.status}: ${JSON.stringify(b).slice(0, 300)}`);
  return b.results || [];
}
const chunk = (a, n) => Array.from({ length: Math.ceil(a.length / n) }, (_, i) => a.slice(i * n, i * n + n));

(async () => {
  const res = await fetch(`${RELAY}/identity/substitution-census`, { headers: { 'User-Agent': UA } });
  const census = await res.json();
  if (!census.ok || !census.complete) throw new Error(`census not usable: ${census.coverage}`);

  const pairs = (census.same_slate_pair_colliding || [])
    .filter(c => c.table === 'postseason_games');
  console.log(`census: ${census.coverage}`);
  console.log(`postseason collisions: ${pairs.length}`);

  const ids = pairs.flatMap(p => p.games.map(g => g.id));
  const rowById = new Map();
  for (const c of chunk(ids, 50)) {
    for (const r of await d1(
      `SELECT * FROM postseason_games WHERE id IN (${c.map(() => '?').join(',')})`, c)) {
      rowById.set(r.id, r);
    }
  }
  console.log(`rows read: ${rowById.size} of ${ids.length}`);
  const missing = ids.filter(i => !rowById.has(i));
  if (missing.length) console.log(`MISSING: ${missing.length} — ${missing.slice(0, 5).join(', ')}`);

  // change_log, the only record of who wrote what and when.
  const logById = new Map();
  for (const c of chunk(ids, 50)) {
    for (const r of await d1(
      `SELECT game_id, source, field, ts FROM change_log WHERE game_id IN (${c.map(() => '?').join(',')})`, c)) {
      (logById.get(r.game_id) || logById.set(r.game_id, []).get(r.game_id)).push(r);
    }
  }

  const columns = new Set();
  for (const r of rowById.values()) for (const k of Object.keys(r)) columns.add(k);

  // Per column: in how many of the 82 pairs do the two rows differ?
  const differsIn = {}, bothNullIn = {}, sameIn = {};
  const detail = [];
  for (const p of pairs) {
    const [a, b] = p.games.map(g => rowById.get(g.id));
    if (!a || !b) continue;
    const diffs = [];
    for (const col of columns) {
      const av = a[col] ?? null, bv = b[col] ?? null;
      if (av === null && bv === null) { bothNullIn[col] = (bothNullIn[col] || 0) + 1; continue; }
      if (String(av) === String(bv)) { sameIn[col] = (sameIn[col] || 0) + 1; continue; }
      differsIn[col] = (differsIn[col] || 0) + 1;
      diffs.push({ col, a: av, b: bv });
    }
    detail.push({
      date: p.date, pair_key: p.pair_key,
      a: a.id, b: b.id,
      differing_columns: diffs.map(d => d.col),
      diffs,
      change_log: { [a.id]: (logById.get(a.id) || []).length, [b.id]: (logById.get(b.id) || []).length },
    });
  }

  console.log(`\ncolumns present: ${columns.size}`);
  console.log('\ncolumn'.padEnd(24) + 'differs  identical  both-null');
  for (const col of [...columns].sort((x, y) => (differsIn[y] || 0) - (differsIn[x] || 0))) {
    console.log(col.padEnd(24)
      + String(differsIn[col] || 0).padStart(7)
      + String(sameIn[col] || 0).padStart(11)
      + String(bothNullIn[col] || 0).padStart(11));
  }

  // A DISCRIMINATOR is a column that differs in EVERY pair. One that differs in
  // some is a tiebreak for those only, and is reported as such rather than as
  // an answer.
  const universal = [...columns].filter(c => (differsIn[c] || 0) === detail.length);
  const partial = [...columns].filter(c => (differsIn[c] || 0) > 0 && (differsIn[c] || 0) < detail.length);
  console.log(`\ndiffers in ALL ${detail.length} pairs: ${universal.join(', ') || 'NONE'}`);
  console.log(`differs in SOME:                ${partial.join(', ') || 'none'}`);
  const withLog = detail.filter(d => Object.values(d.change_log).some(n => n > 0)).length;
  console.log(`pairs with any change_log entry: ${withLog} of ${detail.length}`);

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const p = `outbox/postseason-escalation-verify-${stamp}.json`;
  writeFileSync(p, JSON.stringify({
    checked_at: new Date().toISOString(),
    census_coverage: census.coverage,
    pairs: detail.length,
    columns_present: [...columns].sort(),
    differs_in_all: universal, differs_in_some: partial,
    per_column: Object.fromEntries([...columns].sort().map(c =>
      [c, { differs: differsIn[c] || 0, identical: sameIn[c] || 0, both_null: bothNullIn[c] || 0 }])),
    pairs_with_change_log: withLog,
    detail,
  }, null, 2));
  console.log(`\nwrote ${p}`);
})().catch(e => { console.error(`FAILED: ${e.message}`); process.exit(1); });
