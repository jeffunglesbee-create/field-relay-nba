#!/usr/bin/env node
// OWNER DECISION 2026-09-14: "Relabel".
//
// Two collision pairs each hold two DIFFERENT prices in one odds column. Placed
// against the twin's start_time (23:30Z) both were captured AFTER kickoff — +11
// and +25 minutes. Neither is a closing line, so there was nothing to choose
// between them, and choosing would have enshrined an in-play price as the close.
//
// This moves each blob from its odds column into `inplay_odds` and leaves the
// odds column NULL. The observation survives; the claim it was making does not.
//
// DRY RUN UNLESS --apply. Plan re-derived from the LIVE census, never a file.
import { writeFileSync } from 'node:fs';
import { buildRelabelPlan, relabelSql, relabelVerifySql } from './collision-cleanup-plan.mjs';

const RELAY = process.env.RELAY_BASE || 'https://field-relay-nba.jeffunglesbee.workers.dev';
const APPLY = process.argv.includes('--apply');
const GATE = process.env.RELAY_SHARED_SECRET;

// Two pairs, two rows each, one clashing column each.
const APPROVED_MOVES = 4;

const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const log = [];
const say = (s) => { console.log(s); log.push(s); };
const dump = (kind) => {
  const p = `outbox/inplay-relabel-${kind}-${new Date().toISOString().replace(/[:.]/g, '-')}.log`;
  writeFileSync(p, log.join('\n') + '\n');
  console.log(`\nwrote ${p}`);
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

(async () => {
  say(`=== in-play relabel  relay=${RELAY}  apply=${APPLY}  utc=${new Date().toISOString()} ===`);

  const before = await census();
  say(`\n--- 0. live census: ${before.coverage}`);
  say(`    collisions ${before.same_slate_pair_collisions}, rows_total ${before.totals.rows_total}`);
  say(`    odds_disagree ${before.same_slate_pair_collisions_odds_disagree}`);
  const plan = buildRelabelPlan(before.same_slate_pair_colliding || []);
  say(`    plan: ${plan.counts.moves} move(s), ${plan.counts.skipped} skipped`);
  for (const s of plan.skipped) say(`    SKIP ${s.table} ${s.date} ${s.reason}`);

  // THE CENSUS MUST BE SERVING has_inplay_odds, or this run cannot tell a
  // relabelled row from one that never had a line (Rule 99). Absent is not
  // false.
  const anyGame = (before.same_slate_pair_colliding || [])[0]?.games?.[0];
  if (anyGame && !('has_inplay_odds' in anyGame)) {
    say(`\nSTOP: the census serves no has_inplay_odds — the deploy carrying it has not landed.`);
    dump('refused'); process.exit(1);
  }
  if (plan.deletes.length || plan.counts.deletes) {
    say(`\nSTOP: the plan contains ${plan.deletes.length} delete(s). This executor moves values; it removes none.`);
    dump('refused'); process.exit(1);
  }
  if (plan.counts.moves !== APPROVED_MOVES) {
    say(`\nSTOP: the live plan is ${plan.counts.moves} move(s); approval was for ${APPROVED_MOVES}.`);
    dump('refused'); process.exit(1);
  }

  say(`\n--- 1. the set, enumerated`);
  for (const m of plan.moves) say(`    MOVE  ${m.table} ${m.date} ${m.sport}  ${m.id}  ${m.column} -> inplay_odds`);

  if (!APPLY) { say(`\nDRY RUN. Nothing was written. Re-run with --apply to execute.`); dump('dryrun'); process.exit(0); }

  // ── 2. Move, verifying each one landed ──────────────────────────────────
  say(`\n--- 2. moves (${plan.moves.length})`);
  const applied = [];
  for (const m of plan.moves) {
    // The old value is read BEFORE the move. Once the column is NULL the only
    // record of what it held is change_log, and a change_log entry written from
    // a value nobody read is a record of nothing.
    const was = (await d1(`SELECT ${m.column} AS v FROM ${m.table} WHERE id = ?`, [m.id]))[0]?.v ?? null;
    if (was == null) {
      say(`\nSTOP: ${m.id}.${m.column} is already NULL — the plan and the archive disagree.`);
      dump('failed'); process.exit(1);
    }
    const u = relabelSql(m);
    await d1(u.sql, u.params);
    const v = relabelVerifySql(m);
    const got = (await d1(v.sql, v.params))[0] || {};
    if (got.src != null || got.dst == null) {
      say(`\nSTOP: ${m.id}.${m.column} did not move (src=${got.src == null ? 'null' : 'still set'}, dst=${got.dst == null ? 'null' : 'set'}).`);
      dump('failed'); process.exit(1);
    }
    applied.push({ ...m, was });
    say(`    moved ${m.id} ${m.column} -> inplay_odds`);
  }

  // ── 3. change_log ───────────────────────────────────────────────────────
  // 16 rows per statement, DERIVED rather than chosen. D1 caps bound parameters
  // at 100 per statement; this binds one per column. The 2026-09-13 cleanup
  // picked 40 by hand, bound 240, and died AFTER its deletes had committed.
  say(`\n--- 3. change_log`);
  const D1_MAX_BOUND_PARAMS = 100;
  const CHANGELOG_COLUMNS = 6;
  const LOG_CHUNK = Math.floor(D1_MAX_BOUND_PARAMS / CHANGELOG_COLUMNS);
  for (let i = 0; i < applied.length; i += LOG_CHUNK) {
    const c = applied.slice(i, i + LOG_CHUNK);
    const params = [];
    for (const m of c)
      params.push(m.id, 'inplay_relabel', m.column, m.was, 'moved to inplay_odds', new Date().toISOString());
    await d1(`INSERT INTO change_log (game_id, source, field, old_value, new_value, ts) VALUES `
           + c.map(() => '(?, ?, ?, ?, ?, ?)').join(', '), params);
  }
  say(`    ${applied.length} entries, each carrying the blob that was moved`);

  // ── 4. Done condition, from the relay's own count ───────────────────────
  //
  // NOT this script's re-derivation — that is the copy, and on 2026-09-14 it
  // reported success while the watch read two pairs open.
  say(`\n--- 4. re-census`);
  const after = await census();
  const disagree = after.same_slate_pair_collisions_odds_disagree;
  const relabelled = (after.same_slate_pair_colliding || [])
    .flatMap(c => c.games).filter(g => g.has_inplay_odds).length;
  const residual = buildRelabelPlan(after.same_slate_pair_colliding || []);
  say(`    rows_total ${before.totals.rows_total} -> ${after.totals.rows_total}  (expected unchanged)`);
  say(`    relay says odds_disagree = ${disagree === undefined ? 'ABSENT' : disagree}  (expected 0)`);
  say(`    rows now carrying inplay_odds: ${relabelled}  (expected ${APPROVED_MOVES})`);
  say(`    residual moves: ${residual.counts.moves}  (expected 0)`);
  const ok = disagree === 0 && residual.counts.moves === 0
          && relabelled === APPROVED_MOVES
          && after.totals.rows_total === before.totals.rows_total;
  say(ok ? `\nOK: no collision's rows disagree about odds, ${APPROVED_MOVES} row(s) carry a relabelled in-play price, and no row was removed.`
         : `\nMISMATCH: investigate before any further write.`);
  dump(ok ? 'applied' : 'mismatch');
  process.exit(ok ? 0 : 1);
})().catch(e => {
  console.error(`\nFAILED: ${e.message}`);
  log.push(`FAILED: ${e.message}`);
  dump('failed');
  process.exit(1);
});
