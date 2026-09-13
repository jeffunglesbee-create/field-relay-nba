#!/usr/bin/env node
// CC-CMD-2026-09-13-archive-duplicate-rows Task 3.
//
// Owner approval, 2026-09-13: "Task 3 approved, 82 deletes and 32 merges."
//
// DRY RUN UNLESS --apply. Nothing here writes without that flag.
//
// EVERY GATE RUNS HERE, AGAINST THE STATE IT IS ABOUT TO ACT ON. The keeper
// table was produced from a 22:08Z artifact; the archive has taken writes since.
// A delete gated on a file is gated on the past.
import { writeFileSync } from 'node:fs';
import { buildPlan, mergeSql, mergeVerifySql, deleteSql } from './collision-cleanup-plan.mjs';

const RELAY = process.env.RELAY_BASE || 'https://field-relay-nba.jeffunglesbee.workers.dev';
const APPLY = process.argv.includes('--apply');
// No compiled-in fallback. The secret comes from the environment or the script
// does not run.
const GATE = process.env.RELAY_SHARED_SECRET;

// The counts the owner approved. A plan that does not match them is a different
// plan and does not have approval — so it stops rather than proceeding with
// whatever it happens to find.
const APPROVED = { deletes: 114, merges: 32 };

const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const log = [];
const say = (s) => { console.log(s); log.push(s); };

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

(async () => {
  say(`=== collision cleanup  relay=${RELAY}  apply=${APPLY}  utc=${new Date().toISOString()} ===`);

  // ── 0. Re-derive the plan from the LIVE archive ─────────────────────────
  const before = await census();
  say(`\n--- 0. live census: ${before.coverage}`);
  say(`    collisions ${before.same_slate_pair_collisions}, rows_total ${before.totals.rows_total}`);
  const plan = buildPlan(before.same_slate_pair_colliding || []);
  say(`    plan: ${plan.counts.deletes} delete(s), ${plan.counts.merges} merge(s), ${plan.counts.skipped} skipped`);

  if (plan.counts.deletes !== APPROVED.deletes || plan.counts.merges !== APPROVED.merges) {
    say(`\nSTOP: the live plan is ${plan.counts.deletes} deletes / ${plan.counts.merges} merges;`);
    say(`      approval was for ${APPROVED.deletes} / ${APPROVED.merges}. A different set needs a new approval.`);
    writeFileSync(`outbox/collision-cleanup-${Date.now()}.log`, log.join('\n') + '\n');
    process.exit(1);
  }

  // ── 1. Join safety, re-run against the ids about to be removed ──────────
  const deleteIds = plan.deletes.map(d => d.id);
  say(`\n--- 1. briefs referencing any row in the delete set`);
  let refs = 0;
  if (GATE) {
    for (const c of chunk(deleteIds, 100)) {
      const r = await d1(`SELECT COUNT(*) n FROM briefs WHERE game_id IN (${c.map(() => '?').join(',')})`, c);
      refs += r[0]?.n ?? 0;
    }
    say(`    referenced rows in the delete set: ${refs}`);
    if (refs !== 0) {
      say('\nSTOP: a brief references a row about to be deleted. No write issued.');
      writeFileSync(`outbox/collision-cleanup-${Date.now()}.log`, log.join('\n') + '\n');
      process.exit(1);
    }
  } else {
    say('    (skipped: no RELAY_SHARED_SECRET — dry run cannot query D1)');
  }

  // ── 2. Enumerate before touching anything ───────────────────────────────
  say(`\n--- 2. the set, enumerated`);
  for (const m of plan.merges) say(`    MERGE  ${m.table} ${m.date} ${m.sport}  ${m.stale} -> ${m.keeper}  [${m.columns.join(', ')}]`);
  for (const d of plan.deletes) say(`    DELETE ${d.table} ${d.date} ${d.sport}  ${d.id}  (keeper ${d.keeper})`);
  say(`\n    skipped (${plan.skipped.length}):`);
  const reasons = {};
  for (const s of plan.skipped) reasons[s.reason] = (reasons[s.reason] || 0) + 1;
  for (const [r, n] of Object.entries(reasons).sort((a, b) => b[1] - a[1])) say(`      ${String(n).padStart(4)}  ${r}`);

  if (!APPLY) {
    say(`\nDRY RUN. Nothing was written. Re-run with --apply to execute.`);
    const p = `outbox/collision-cleanup-dryrun-${new Date().toISOString().replace(/[:.]/g, '-')}.log`;
    writeFileSync(p, log.join('\n') + '\n');
    console.log(`\nwrote ${p}`);
    process.exit(0);
  }

  // ── 3. Merge first. A delete before its merge is the data loss. ─────────
  say(`\n--- 3. merges (${plan.merges.length})`);
  for (const m of plan.merges) {
    const u = mergeSql(m);
    await d1(u.sql, u.params);
    const v = mergeVerifySql(m);
    const got = (await d1(v.sql, v.params))[0] || {};
    const missing = m.columns.filter(c => got[c] == null);
    if (missing.length) {
      say(`\nSTOP: merge into ${m.keeper} did not land: ${missing.join(', ')} still null. No delete issued for ${m.stale}.`);
      writeFileSync(`outbox/collision-cleanup-${Date.now()}.log`, log.join('\n') + '\n');
      process.exit(1);
    }
    say(`    merged ${m.columns.join(', ')}  ${m.stale} -> ${m.keeper}`);
  }

  // ── 4. Delete, by id, per table ─────────────────────────────────────────
  say(`\n--- 4. deletes (${plan.deletes.length})`);
  let deleted = 0;
  for (const table of ['regular_season_games', 'postseason_games']) {
    const ids = plan.deletes.filter(d => d.table === table).map(d => d.id);
    if (!ids.length) continue;
    for (const c of chunk(ids, 50)) {
      const q = deleteSql(table, c);
      await d1(q.sql, q.params);
      deleted += c.length;
    }
    say(`    ${table}: ${ids.length} row(s)`);
  }

  // ── 4b. change_log, so the deletion is not invisible afterwards ─────────
  //
  // Schema read from the relay's own INSERT at HEAD, not guessed:
  //   change_log (game_id, source, field, old_value, new_value, ts)
  // The deleted row's id IS the record — once the row is gone, `game_id` is the
  // only handle anyone has on what used to be there, so the keeper it was
  // folded into goes in new_value.
  say(`\n--- 4b. change_log`);
  let logged = 0;
  for (const c of chunk(plan.deletes, 40)) {
    const values = c.map(() => '(?, ?, ?, ?, ?, ?)').join(', ');
    const params = [];
    for (const d of c) {
      params.push(d.id, 'collision_cleanup', 'row_deleted', d.table, d.keeper, new Date().toISOString());
    }
    await d1(`INSERT INTO change_log (game_id, source, field, old_value, new_value, ts) VALUES ${values}`, params);
    logged += c.length;
  }
  say(`    ${logged} entries`);

  // ── 5. Done condition, measured, not assumed ────────────────────────────
  say(`\n--- 5. re-census`);
  const after = await census();
  const dRows = before.totals.rows_total - after.totals.rows_total;
  const dColl = before.same_slate_pair_collisions - after.same_slate_pair_collisions;
  say(`    rows_total ${before.totals.rows_total} -> ${after.totals.rows_total}  (-${dRows}, expected -${plan.deletes.length})`);
  say(`    collisions ${before.same_slate_pair_collisions} -> ${after.same_slate_pair_collisions}  (-${dColl})`);
  const ok = dRows === plan.deletes.length;
  say(ok ? `\nOK: exactly the enumerated rows are gone.`
         : `\nMISMATCH: ${dRows} rows removed, ${plan.deletes.length} enumerated. Investigate before any further write.`);

  const p = `outbox/collision-cleanup-${new Date().toISOString().replace(/[:.]/g, '-')}.log`;
  writeFileSync(p, log.join('\n') + '\n');
  console.log(`\nwrote ${p}`);
  process.exit(ok ? 0 : 1);
})().catch(e => {
  console.error(`\nFAILED: ${e.message}`);
  writeFileSync(`outbox/collision-cleanup-failed-${Date.now()}.log`, log.concat(`FAILED: ${e.message}`).join('\n') + '\n');
  process.exit(1);
});
