// CC-CMD-2026-08-06-apply-soccer-league-label-fix.
//
// Single, mode-driven probe covering Tasks 2, 3 and 4. Lives in this repo
// (not field-playground) because a relay data probe belongs in the relay's
// own repo, and because Task 3/4 both require regenerating the scope fresh
// rather than trusting a staged, possibly-stale file.
//
// THE SELF-EVIDENCING SIGNAL (no heuristic, no guessing):
// handleJournalismCycle's three archive-write sites send
//   sport:  gm.sport === 'soccer' ? 'FIFA World Cup 2026' : gm.league   <- BUGGY
//   league: gm.league                                                   <- CORRECT
// Both land in the same row. So the `league` column already holds the true
// competition for every mislabeled row, written by the same call that wrote
// the wrong `sport`. A row is definitively mislabeled iff its `sport` is a
// WC-family label while its `league` says otherwise -- and the correction
// value is simply that row's own `league`. Verified against the real
// INSERT statements at src/index.js (regular_season_games + postseason_games).
//
// `id` is deliberately NEVER rewritten: src/analytics-engine.js really does
// JOIN briefs.game_id against g.id (lines ~999/1005/1411/1417), so renaming
// ids would silently break those joins. Label-only correction.

const RELAY = process.env.RELAY_BASE || 'https://field-relay-nba.jeffunglesbee.workers.dev';
const MODE  = process.env.PROBE_MODE || 'scope';   // scope | slate | verify

async function d1(sql, params) {
  const res = await fetch(`${RELAY}/d1/execute`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-FIELD-Relay': 'field-relay-cron-2026' },
    body: JSON.stringify({ sql, params }),
  });
  const body = await res.json();
  if (!res.ok || body.success === false) {
    throw new Error(`d1 exec failed: HTTP ${res.status} ${JSON.stringify(body).slice(0, 400)}`);
  }
  return body;
}

// A WC-family sport label, matching canonicalizeWC26Sport's own real rule
// (s === 'wc26' || s.startsWith('fifa world cup')) expressed in SQL.
const WC_FAMILY = `(LOWER(sport) = 'wc26' OR LOWER(sport) LIKE 'fifa world cup%')`;
// Mislabeled iff WC-family sport but league disagrees and league is real.
const MISLABELED = `${WC_FAMILY} AND league IS NOT NULL AND league != '' AND LOWER(league) NOT LIKE 'fifa world cup%' AND LOWER(league) != 'wc26'`;

// ── Task 2: the real scheduling hazard ───────────────────────────────────
// A game seeded pre-game under the OLD id and finalized AFTER the fix
// deploys writes under a NEW id, misses ON CONFLICT, and inserts a
// duplicate instead of updating the seed. The exposed row is one that is
// (a) soccer, (b) still null-score, (c) already kicked off.
async function slateCheck() {
  const today = new Date().toISOString().slice(0, 10);
  console.log(`=== TASK 2: slate safety check (today=${today} UTC, now=${new Date().toISOString()}) ===`);

  for (const table of ['regular_season_games', 'postseason_games']) {
    const r = await d1(
      `SELECT id, sport, league, date, home, away, home_score, start_time, espn_event_id
         FROM ${table}
        WHERE date = ? AND home_score IS NULL
          AND (LOWER(sport) LIKE 'fifa world cup%' OR LOWER(sport) = 'wc26'
               OR league IN ('EPL','MLS','La Liga','Serie A','Bundesliga','Ligue 1','FIFA World Cup'))
        ORDER BY start_time`, [today]);
    const rows = r.results || [];
    console.log(`\n--- ${table}: ${rows.length} null-score soccer row(s) dated today ---`);
    let exposed = 0;
    for (const row of rows) {
      const kicked = row.start_time ? (new Date(row.start_time) <= new Date()) : null;
      if (kicked === true) exposed++;
      console.log(`  ${kicked === true ? 'EXPOSED ' : kicked === false ? 'upcoming' : 'unknown '} | ${row.home} vs ${row.away} | sport=${row.sport} league=${row.league} start=${row.start_time} event=${row.espn_event_id}`);
    }
    console.log(`  EXPOSED (kicked off, still null-score) in ${table}: ${exposed}`);
    if (exposed > 0) console.log(`  >>> NOT SAFE TO DEPLOY: ${exposed} in-flight soccer row(s) would duplicate on finalization.`);
  }
  console.log('\n=== slate check done ===');
}

// ── Task 3: measure real scope + emit the correction SQL ─────────────────
async function scope() {
  console.log('=== TASK 3: real mislabel scope measurement ===');
  const lines = [];
  lines.push('-- CC-CMD-2026-08-06-apply-soccer-league-label-fix');
  lines.push('-- Regenerated fresh in field-relay-nba from a real measured run.');
  lines.push(`-- Generated: ${new Date().toISOString()}`);
  lines.push('-- Corrects the `sport` column ONLY, scoped by espn_event_id, using each');
  lines.push('-- row\'s own already-correct `league` value. `id` deliberately untouched');
  lines.push('-- (analytics-engine.js JOINs briefs.game_id against g.id).');
  lines.push('');

  let grandTotal = 0;
  for (const table of ['regular_season_games', 'postseason_games']) {
    const tot = await d1(`SELECT COUNT(*) AS n FROM ${table} WHERE ${WC_FAMILY}`);
    const mis = await d1(
      `SELECT id, sport, league, date, home, away, espn_event_id
         FROM ${table} WHERE ${MISLABELED} ORDER BY date DESC`);
    const rows = mis.results || [];
    const wcTotal = tot.results?.[0]?.n ?? 0;
    grandTotal += rows.length;

    console.log(`\n--- ${table} ---`);
    console.log(`  rows with a WC-family sport label : ${wcTotal}`);
    console.log(`  of those, definitively MISLABELED : ${rows.length}` +
      (wcTotal ? ` (${(rows.length / wcTotal * 100).toFixed(1)}%)` : ''));

    const byLeague = {};
    rows.forEach(r => { byLeague[r.league] = (byLeague[r.league] || 0) + 1; });
    console.log(`  true competition breakdown       :`, JSON.stringify(byLeague));
    rows.slice(0, 15).forEach(r =>
      console.log(`    ${r.date} ${r.home} vs ${r.away} | sport='${r.sport}' -> '${r.league}' | event=${r.espn_event_id}`));
    if (rows.length > 15) console.log(`    ... and ${rows.length - 15} more`);

    if (rows.length) {
      const ids = rows.map(r => `'${String(r.espn_event_id).replace(/'/g, "''")}'`).join(', ');
      lines.push(`-- ${table}: ${rows.length} row(s)`);
      lines.push(`UPDATE ${table} SET sport = league`);
      lines.push(`  WHERE espn_event_id IN (${ids})`);
      lines.push(`    AND ${MISLABELED};`);
      lines.push('');
    } else {
      lines.push(`-- ${table}: 0 rows, nothing to correct`);
      lines.push('');
    }
  }

  console.log(`\n=== TOTAL mislabeled rows: ${grandTotal} ===`);
  const fs = await import('node:fs');
  const path = `outbox/soccer-league-mislabel-scope-${new Date().toISOString().replace(/[:.]/g, '-')}.sql`;
  fs.writeFileSync(path, lines.join('\n'));
  console.log(`Correction SQL written: ${path}`);
  console.log('\n' + lines.join('\n'));
}

// ── Task 3 execution + Task 4 verification ───────────────────────────────
async function verify() {
  console.log('=== TASK 4: post-correction verification ===');
  let remaining = 0;
  for (const table of ['regular_season_games', 'postseason_games']) {
    const r = await d1(`SELECT COUNT(*) AS n FROM ${table} WHERE ${MISLABELED}`);
    const n = r.results?.[0]?.n ?? 0;
    remaining += n;
    console.log(`  ${table}: ${n} mislabeled row(s) remaining`);

    const dist = await d1(
      `SELECT sport, COUNT(*) AS n FROM ${table}
        WHERE league IN ('EPL','MLS','La Liga','Serie A','Bundesliga','Ligue 1','FIFA World Cup')
        GROUP BY sport ORDER BY n DESC`);
    console.log(`  ${table} sport-label distribution for soccer rows:`,
      JSON.stringify(dist.results || []));
  }
  console.log(`\nTOTAL REMAINING MISLABELED: ${remaining}`);
  console.log(remaining === 0 ? 'PASS: zero mismatches.' : 'FAIL: mismatches remain.');
  if (remaining !== 0) process.exit(1);
}

// ── Task 3 execution: apply the correction ───────────────────────────────
// Uses the identical MISLABELED predicate the scope step measured and the
// emitted .sql encodes -- same rule, one source of truth, no drift between
// what was measured, what was reviewed, and what actually runs.
// Per the CC-CMD's explicit instruction: scope the UPDATE by the real,
// measured espn_event_id list -- never a bare LIKE that could sweep in a
// genuine World Cup fixture. The predicate is retained as a second,
// belt-and-braces guard, but the id list is what bounds the write.
async function apply() {
  console.log('=== TASK 3: applying label correction (sport = league) ===');
  let total = 0;
  for (const table of ['regular_season_games', 'postseason_games']) {
    const mis = await d1(
      `SELECT id, sport, league, date, home, away, espn_event_id
         FROM ${table} WHERE ${MISLABELED} ORDER BY date DESC`);
    const rows = (mis.results || []).filter(r => r.espn_event_id);
    const skipped = (mis.results || []).length - rows.length;
    console.log(`\n--- ${table}: ${rows.length} row(s) to correct` +
      (skipped ? ` (${skipped} skipped: no espn_event_id to scope by)` : '') + ' ---');
    if (rows.length === 0) { console.log('  nothing to do'); continue; }

    rows.forEach(r => console.log(`  ${r.date} ${r.home} vs ${r.away} | '${r.sport}' -> '${r.league}' | event=${r.espn_event_id}`));

    const ids = rows.map(r => String(r.espn_event_id));
    const placeholders = ids.map(() => '?').join(', ');
    const res = await d1(
      `UPDATE ${table} SET sport = league
        WHERE espn_event_id IN (${placeholders}) AND ${MISLABELED}`, ids);
    const changed = res.meta?.changes ?? 0;
    console.log(`  UPDATE changes=${changed} (expected ${rows.length})`);

    const after = await d1(`SELECT COUNT(*) AS n FROM ${table} WHERE ${MISLABELED}`);
    console.log(`  remaining mislabeled after: ${after.results?.[0]?.n ?? '?'} (expected ${skipped})`);
    total += changed;
  }
  console.log(`\n=== TOTAL rows corrected: ${total} ===`);
}

const modes = { slate: slateCheck, scope, apply, verify };
if (!modes[MODE]) { console.error(`unknown PROBE_MODE=${MODE}`); process.exit(1); }
modes[MODE]().catch(e => { console.error('PROBE ERROR:', e); process.exit(1); });
