// CC-CMD-2026-09-07-codex-write-nondestructive-and-recovery — TASK 0a.
//
// READ ONLY. Every statement below is a SELECT. Nothing here mutates a row,
// and the CC-CMD's Task 0 is explicitly free diagnostics that may end the job.
//
// THE QUESTION: `codex_write` replaced the bodies of 25 `cc-cmd-queue` rows.
// Is a prior-value record journaled anywhere reachable, so the originals can be
// recovered with an ordinary SELECT instead of a Time Travel side-restore?
//
// WHY THIS RUNS EVEN THOUGH THE SOURCE ALREADY ANSWERS IT. Reading
// `src/index.js` shows `codex_write` is a bare INSERT ... ON CONFLICT DO UPDATE
// with no history write, and `change_log`'s CREATE TABLE in
// src/sync-reconciler.js declares `game_id TEXT NOT NULL` — a shape that cannot
// hold a codex key meaningfully. Both are the SOURCE of what created the live
// table, not the live table. field-laboratory's CLAUDE.md states the rule this
// repo's Rule 87 implies: a cross-boundary fact is not verified by reading, and
// the discriminating question is "is this the source, or a copy of the source?"
// The deployed worker and the live D1 schema are the things being asked about.
//
// It also measures the DAMAGE rather than inheriting it (Rule 72): the CC-CMD's
// claim of 25 overwritten rows came from a prior session's audit.

const RELAY = process.env.RELAY_BASE || 'https://field-relay-nba.jeffunglesbee.workers.dev';
const OUT = `outbox/codex-overwrite-diagnostics-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;

// The variable, never the value. `scripts/check-exposed-secrets.mjs` is a
// RATCHET on hard-coded uses of RELAY_SHARED_SECRET — a new one is the failure,
// and the first draft of this file was one, caught at 116 against a ceiling of
// 115. Most scripts in this directory predate the ratchet; a new script does not
// get to raise it. No default: an unset secret must be distinguishable from a
// set one before the relay 401s.
const RELAY_GATE = process.env.RELAY_SHARED_SECRET;
const need = (v, name) => {
  if (!v) { console.error(`${name} is not set. This script will not guess it.`); process.exit(1); }
  return v;
};

// The window the CC-CMD names, plus an hour of margin either side. A window
// drawn exactly around the reported incident cannot show that the incident was
// reported with the wrong clock.
const WINDOW_FROM = '2026-09-08 02:00:00';
const WINDOW_TO   = '2026-09-08 04:00:00';

async function d1(sql, params = []) {
  const res = await fetch(`${RELAY}/d1/execute`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-FIELD-Relay': need(RELAY_GATE, 'RELAY_SHARED_SECRET') },
    body: JSON.stringify({ sql, params }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body.success === false || body.ok === false) {
    return { error: `HTTP ${res.status} ${JSON.stringify(body).slice(0, 300)}` };
  }
  return { rows: body.results || [] };
}

const out = {
  ran_at: new Date().toISOString(),
  relay: RELAY,
  window: { from: WINDOW_FROM, to: WINDOW_TO },
  findings: {},
  verdict: null,
};

// ── 1. Does change_log carry ANY row in the window? ────────────────────────
// Asked before asking about codex specifically. If the table is empty across
// the whole window the codex question is answered without a predicate that
// could itself be wrong, and if it is NOT empty the codex query below is
// running against a table that demonstrably receives writes.
out.findings.change_log_rows_in_window = await d1(
  `SELECT COUNT(*) AS n FROM change_log WHERE ts >= ? AND ts <= ?`, [WINDOW_FROM, WINDOW_TO]);

out.findings.change_log_sources_in_window = await d1(
  `SELECT source, field, COUNT(*) AS n FROM change_log
   WHERE ts >= ? AND ts <= ? GROUP BY source, field ORDER BY n DESC`, [WINDOW_FROM, WINDOW_TO]);

// ── 2. Anything in change_log that mentions codex, ever ────────────────────
// Deliberately UNBOUNDED in time. A journal written under a different clock, or
// backfilled later, would be invisible to a windowed query — and "no rows in
// the window" would then be read as "no journal exists", which is a different
// claim.
out.findings.change_log_codex_any_time = await d1(
  `SELECT id, game_id, source, field, ts, substr(COALESCE(old_value,''),1,120) AS old_head
   FROM change_log
   WHERE game_id LIKE '%cc-cmd%' OR game_id LIKE '%codex%'
      OR source LIKE '%codex%' OR field LIKE '%codex%'
   ORDER BY ts DESC LIMIT 25`);

// ── 3. Does a history table already exist and hold anything? ───────────────
// Task 1 adds `codex_history`. If a prior session already added one, this is
// where the originals would be, and adding a second would be the duplication
// Rule 62 exists to prevent.
out.findings.codex_history_probe = await d1(`SELECT COUNT(*) AS n FROM codex_history`);

// ── 4. The damage, measured rather than inherited ──────────────────────────
// The CC-CMD's "25 rows" is a prior session's count (Rule 72). `updated_at`
// inside the incident window is what identifies an overwritten row; length and
// head of content say whether the body is a stub audit note or real prose.
out.findings.queue_rows = await d1(
  `SELECT key, title, status, created_at, updated_at,
          length(content) AS content_len,
          substr(content, 1, 160) AS content_head
   FROM codex WHERE category = 'cc-cmd-queue'
   ORDER BY updated_at DESC`);

out.findings.queue_touched_in_window = await d1(
  `SELECT COUNT(*) AS n FROM codex
   WHERE category = 'cc-cmd-queue' AND updated_at >= ? AND updated_at <= ?`,
  [WINDOW_FROM, WINDOW_TO]);

// ── 5. The one row the whole exercise is for ───────────────────────────────
out.findings.desk_sports_followups = await d1(
  `SELECT key, category, title, status, created_at, updated_at, content
   FROM codex WHERE key = ?`, ['cc-cmd-2026-08-08-desk-sports-followups']);

// ── verdict ────────────────────────────────────────────────────────────────
const codexJournalRows = out.findings.change_log_codex_any_time.rows?.length ?? null;
const historyRows = out.findings.codex_history_probe.rows?.[0]?.n ?? null;
const historyErrored = !!out.findings.codex_history_probe.error;

out.verdict =
  codexJournalRows === null
    ? 'INCONCLUSIVE — the change_log query itself failed; see findings.change_log_codex_any_time.error'
  : codexJournalRows > 0
    ? `RECOVERABLE FROM change_log — ${codexJournalRows} codex-referencing row(s). Task 2 and 3 are unnecessary.`
  : (!historyErrored && historyRows > 0)
    ? `RECOVERABLE FROM codex_history — ${historyRows} row(s) already journaled.`
    : 'NO JOURNAL — change_log carries no codex row at any time, and codex_history '
      + (historyErrored ? 'does not exist' : 'is empty')
      + '. Task 0a fails; the originals are not in live data.';

const { writeFileSync } = await import('node:fs');
writeFileSync(OUT, JSON.stringify(out, null, 2) + '\n');
console.log(JSON.stringify(out, null, 2).slice(0, 8000));
console.log(`\nwritten to ${OUT}`);
console.log(`\nVERDICT: ${out.verdict}`);
