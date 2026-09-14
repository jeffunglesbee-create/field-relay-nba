#!/usr/bin/env node
// CC-CMD-2026-09-13-archive-duplicate-rows, category B.
//
// Owner approval, 2026-09-14: "go, symmetric merge approved" — against a plan
// stated as 32 pairs, UPDATEs only, zero DELETEs.
//
// WHY THIS EXISTS RATHER THAN run-collision-cleanup.mjs WITH MERGES ON. That
// script's merge is one half of a delete: it fills the keeper so the stale row
// can be destroyed. These 32 pairs have no stale row. Each holds half the truth
// — one carries the odds, the other the ESPN anchor and the properly-formed
// team names — so every keeper choice destroys something real. Filling BOTH
// directions ends the disagreement without choosing.
//
// DRY RUN UNLESS --apply.
//
// THE PLAN IS RE-DERIVED FROM THE LIVE CENSUS, never from a committed artifact.
// A write gated on a file is gated on the past.
import { writeFileSync } from 'node:fs';
import { buildSymmetricPlan, mergeSql, mergeVerifySql } from './collision-cleanup-plan.mjs';

const RELAY = process.env.RELAY_BASE || 'https://field-relay-nba.jeffunglesbee.workers.dev';
const APPLY = process.argv.includes('--apply');
const GATE = process.env.RELAY_SHARED_SECRET;

// The count the owner approved, in PAIRS. A pair with gaps in both directions
// produces two UPDATEs, so the update count is not the approved number and
// gating on it would accept a different set.
const APPROVED_PAIRS = 32;

const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const log = [];
const say = (s) => { console.log(s); log.push(s); };
const stamp = () => new Date().toISOString().replace(/[:.]/g, '-');
const dump = (kind) => {
  const p = `outbox/symmetric-collision-merge-${kind}-${stamp()}.log`;
  writeFileSync(p, log.join('\n') + '\n');
  console.log(`\nwrote ${p}`);
  return p;
};

async function d1(sql, params = []) {
  if (!GATE) throw new Error('RELAY_SHARED_SECRET is not set; refusing to call /d1/execute');
  const res = await fetch(`${RELAY}/d1/execute`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-FIELD-Relay': GATE, 'User-Agent': UA },
    body: JSON.stringify({ sql, params }),
  });
  const b = await res.json().catch(() => ({}));
  if (!res.ok || b.success === false) throw new Error(`d1 HTTP ${res.status}: ${JSON.stringify(b).slice(0, 300)}`);
  return b.results || [];
}

async function census() {
  const r = await fetch(`${RELAY}/identity/substitution-census`, { headers: { 'User-Agent': UA } });
  const d = await r.json();
  if (!d.ok) throw new Error(`census not ok: ${d.error}`);
  if (!d.complete) throw new Error(`census incomplete: ${d.coverage}`);
  if (d.same_slate_pair_detail_error) throw new Error(`census detail error: ${d.same_slate_pair_detail_error}`);
  return d;
}

const chunk = (a, n) => Array.from({ length: Math.ceil(a.length / n) }, (_, i) => a.slice(i * n, i * n + n));
// A pair, not an update. The two directions of one pair carry keeper and stale
// swapped, so the ids are sorted before they identify anything.
const pairsOf = (merges) =>
  new Set(merges.map(m => [m.table, m.date, ...[m.keeper, m.stale].sort()].join('|'))).size;

(async () => {
  say(`=== symmetric collision merge  relay=${RELAY}  apply=${APPLY}  utc=${new Date().toISOString()} ===`);

  // ── 0. Plan, from the live archive ──────────────────────────────────────
  const before = await census();
  say(`\n--- 0. live census: ${before.coverage}`);
  say(`    collisions ${before.same_slate_pair_collisions}, rows_total ${before.totals.rows_total}`);
  const plan = buildSymmetricPlan(before.same_slate_pair_colliding || []);
  const pairs = pairsOf(plan.merges);
  say(`    plan: ${plan.counts.merges} update(s) across ${pairs} pair(s), ${plan.counts.skipped} skipped`);

  // ── 0a. The structural guarantee, asserted rather than assumed ──────────
  // buildSymmetricPlan has no code path that emits a delete. This asserts it
  // anyway, here, at the only place where being wrong is irreversible.
  if (plan.deletes.length || plan.counts.deletes) {
    say(`\nSTOP: the plan contains ${plan.deletes.length} delete(s). This executor issues UPDATEs only.`);
    dump('refused'); process.exit(1);
  }
  if (pairs !== APPROVED_PAIRS) {
    say(`\nSTOP: the live plan touches ${pairs} pair(s); approval was for ${APPROVED_PAIRS}.`);
    say(`      A different set needs a new approval.`);
    dump('refused'); process.exit(1);
  }

  // ── 1. Enumerate before touching anything ───────────────────────────────
  say(`\n--- 1. the set, enumerated`);
  for (const m of plan.merges)
    say(`    FILL   ${m.table} ${m.date} ${m.sport}  ${m.stale} -> ${m.keeper}  [${m.columns.join(', ')}]  (${m.direction})`);
  const reasons = {};
  for (const s of plan.skipped) reasons[s.reason] = (reasons[s.reason] || 0) + 1;
  say(`\n    skipped (${plan.skipped.length}):`);
  for (const [r, n] of Object.entries(reasons).sort((a, b) => b[1] - a[1])) say(`      ${String(n).padStart(4)}  ${r}`);

  if (!APPLY) {
    say(`\nDRY RUN. Nothing was written. Re-run with --apply to execute.`);
    dump('dryrun'); process.exit(0);
  }

  // ── 2. Fill, verifying each one landed ──────────────────────────────────
  //
  // NO ORDERING HAZARD, AND THAT IS THE POINT OF THE SHAPE. Every statement is
  // `COALESCE(col, (SELECT col FROM t WHERE id = ?))`, which only ever writes
  // into a NULL. A->B cannot clobber what B->A just wrote, because by then the
  // target is no longer null. An interrupted run leaves a partially-agreeing
  // pair, which is the state it started in — never a lost value.
  say(`\n--- 2. updates (${plan.merges.length})`);
  const applied = [];
  for (const m of plan.merges) {
    const u = mergeSql(m);
    await d1(u.sql, u.params);
    const v = mergeVerifySql(m);
    const got = (await d1(v.sql, v.params))[0] || {};
    const missing = m.columns.filter(c => got[c] == null);
    if (missing.length) {
      say(`\nSTOP: fill into ${m.keeper} did not land: ${missing.join(', ')} still null.`);
      say(`      ${applied.length} update(s) already applied; they are gap-fills and are not reverted.`);
      dump('failed'); process.exit(1);
    }
    applied.push(m);
    say(`    filled ${m.columns.join(', ')}  ${m.stale} -> ${m.keeper}`);
  }

  // ── 3. change_log ───────────────────────────────────────────────────────
  // Schema read from the relay's own INSERT at HEAD:
  //   change_log (game_id, source, field, old_value, new_value, ts)
  // 16 rows per statement, DERIVED: D1 caps bound parameters at 100 per
  // statement and this binds 6 per row. The 2026-09-13 run died on 40x6=240
  // AFTER its deletes had committed.
  const D1_MAX_BOUND_PARAMS = 100, CHANGELOG_COLUMNS = 6;
  const LOG_CHUNK = Math.floor(D1_MAX_BOUND_PARAMS / CHANGELOG_COLUMNS);
  say(`\n--- 3. change_log`);
  let logged = 0;
  for (const c of chunk(applied, LOG_CHUNK)) {
    const values = c.map(() => '(?, ?, ?, ?, ?, ?)').join(', ');
    const params = [];
    for (const m of c)
      params.push(m.keeper, 'symmetric_collision_merge', 'gap_filled',
                  JSON.stringify({ table: m.table, date: m.date, sport: m.sport,
                                   columns: m.columns, were: 'null' }),
                  m.stale, new Date().toISOString());
    await d1(`INSERT INTO change_log (game_id, source, field, old_value, new_value, ts) VALUES ${values}`, params);
    logged += c.length;
  }
  say(`    ${logged} entries`);

  // ── 4. Done condition, measured from the source ─────────────────────────
  //
  // NOT "the updates succeeded" — that is the copy. The claim is that the 32
  // pairs no longer disagree, and the way to check it is to re-derive the plan
  // from a fresh census and find nothing left to fill.
  say(`\n--- 4. re-census`);
  const after = await census();
  const residual = buildSymmetricPlan(after.same_slate_pair_colliding || []);
  const dRows = before.totals.rows_total - after.totals.rows_total;
  say(`    rows_total ${before.totals.rows_total} -> ${after.totals.rows_total}  (delta ${dRows}, expected 0)`);
  say(`    collisions ${before.same_slate_pair_collisions} -> ${after.same_slate_pair_collisions}  (a fill does not remove a row)`);
  say(`    residual fills: ${residual.counts.merges} across ${pairsOf(residual.merges)} pair(s), expected 0`);
  for (const m of residual.merges)
    say(`      STILL OPEN  ${m.table} ${m.date} ${m.stale} -> ${m.keeper} [${m.columns.join(', ')}]`);
  const ok = dRows === 0 && residual.counts.merges === 0;
  say(ok ? `\nOK: every pair agrees on all six loss-bearing fields, and no row was removed.`
         : `\nMISMATCH: investigate before any further write.`);
  dump(ok ? 'applied' : 'mismatch');
  process.exit(ok ? 0 : 1);
})().catch(e => {
  console.error(`\nFAILED: ${e.message}`);
  log.push(`FAILED: ${e.message}`);
  dump('failed');
  process.exit(1);
});
