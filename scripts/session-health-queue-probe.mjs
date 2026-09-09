// CC-CMD-2026-09-07-session-health-queue-coverage — TASK 0.
//
// READ ONLY. Every statement is a SELECT.
//
// The CC-CMD names two faults in `stale_pending_cc_cmds` and asks for real
// counts before either is fixed, explicitly refusing to be trusted as the source
// ("this document's transcription is a starting point, not the source of
// truth"). It also asks whether `status` is a better predicate than title-prefix
// matching — and says to REPORT WHICH IS ACTUALLY TRUE rather than assume.
//
// So this measures the predicate candidates against each other rather than
// picking one. The output is what Task 1 is derived from.

const RELAY = process.env.RELAY_BASE || 'https://field-relay-nba.jeffunglesbee.workers.dev';
const GATE = process.env.RELAY_SHARED_SECRET;
const need = (v, n) => { if (!v) { console.error(`${n} is not set. This script will not guess it.`); process.exit(1); } return v; };

async function d1(sql, params = []) {
  const r = await fetch(`${RELAY}/d1/execute`, {
    method: 'POST',
    headers: { 'X-FIELD-Relay': need(GATE, 'RELAY_SHARED_SECRET'), 'Content-Type': 'application/json' },
    body: JSON.stringify({ sql, params }),
  });
  const t = await r.text();
  let b; try { b = JSON.parse(t); } catch { return { error: t.slice(0, 300) }; }
  if (!r.ok || b.ok === false) return { error: `HTTP ${r.status} ${t.slice(0, 300)}` };
  return { rows: b.results || [] };
}

const out = { ran_at: new Date().toISOString(), relay: RELAY };
const one = r => (r.rows || [])[0] || {};

// ── 0.2 the three counts the CC-CMD asks for ────────────────────────────────
out.total_queue_rows = one(await d1(
  `SELECT COUNT(*) AS n FROM codex WHERE category = 'cc-cmd-queue'`)).n;

out.matching_pending_prefix = one(await d1(
  `SELECT COUNT(*) AS n FROM codex WHERE category = 'cc-cmd-queue' AND title LIKE 'PENDING%'`)).n;

// "not matching, whose status is not resolved" — the population the current
// query is blind to.
out.not_matching_unresolved = one(await d1(
  `SELECT COUNT(*) AS n FROM codex WHERE category = 'cc-cmd-queue'
     AND title NOT LIKE 'PENDING%' AND (status IS NULL OR status != 'resolved')`)).n;

// ── 0.3 is `status` reliably populated for this category? ───────────────────
//
// The `incident` query eight lines above the defect ALREADY uses
// `status IS NULL OR status != 'resolved'`, so the column exists and is used as
// a predicate elsewhere in the same block. That is not evidence it is populated
// HERE. `ensureCodexStatusColumn` adds it with DEFAULT 'open', which means every
// pre-existing row got 'open' whether or not anyone judged it open — a default
// is not a judgement, and a predicate resting on one would report the whole
// table as open forever.
out.status_distribution = (await d1(
  `SELECT COALESCE(status, '(null)') AS status, COUNT(*) AS n
   FROM codex WHERE category = 'cc-cmd-queue' GROUP BY status ORDER BY n DESC`)).rows;

// The discriminating question: does `status` DISAGREE with the title anywhere?
// If every row is 'open' regardless of a DONE title, the column carries no
// information and title-matching is the only real signal.
out.status_vs_title = (await d1(
  `SELECT COALESCE(status,'(null)') AS status,
          CASE
            WHEN UPPER(title) LIKE 'DONE%'      THEN 'title:DONE'
            WHEN UPPER(title) LIKE 'PENDING%'   THEN 'title:PENDING'
            WHEN UPPER(title) LIKE 'OPEN%'      THEN 'title:OPEN'
            WHEN UPPER(title) LIKE '%PENDING%'  THEN 'title:contains PENDING'
            WHEN UPPER(title) LIKE '%RESOLVED%' THEN 'title:contains RESOLVED'
            ELSE 'title:other'
          END AS title_class,
          COUNT(*) AS n
   FROM codex WHERE category = 'cc-cmd-queue'
   GROUP BY status, title_class ORDER BY n DESC`)).rows;

// Every distinct leading word, so a broadened predicate is derived from what the
// rows really say rather than from three prefixes someone remembered.
out.title_first_words = (await d1(
  `SELECT UPPER(TRIM(SUBSTR(title, 1, INSTR(title || ' ', ' ') - 1))) AS first_word, COUNT(*) AS n
   FROM codex WHERE category = 'cc-cmd-queue' GROUP BY first_word ORDER BY n DESC`)).rows;

// ── the two keys the CC-CMD says are permanently invisible ──────────────────
out.named_invisible_keys = (await d1(
  `SELECT key, title, COALESCE(status,'(null)') AS status, updated_at FROM codex
   WHERE key IN ('playground-weatherpoll-wrong-endpoint', 'queue-deadcode-and-ambiguous')`)).rows;

// ── what the CURRENT query actually returns, reproduced exactly ─────────────
// Including the LIMIT and the >= 2h filter the route applies in JS afterwards.
// The CC-CMD names truncation and predicate blindness; it does not name the
// interaction between a SQL LIMIT and a post-hoc JS filter, and a fix that
// reports `returned` without accounting for it would report a number the payload
// does not contain.
const current = await d1(
  `SELECT key, title, updated_at,
          ROUND((julianday('now') - julianday(updated_at)) * 24, 1) AS hours_stale
   FROM codex
   WHERE category = 'cc-cmd-queue' AND title LIKE 'PENDING%'
   ORDER BY updated_at ASC LIMIT 15`);
out.current_query_rows = (current.rows || []).length;
out.current_query_after_2h_filter = (current.rows || []).filter(r => r.hours_stale >= 2).length;

const { writeFileSync } = await import('node:fs');
writeFileSync(`outbox/session-health-queue-probe-${out.ran_at.replace(/[:.]/g,'-')}.json`,
  JSON.stringify(out, null, 2) + '\n');

console.log(JSON.stringify(out, null, 2));
