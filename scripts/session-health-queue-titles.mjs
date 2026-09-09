// CC-CMD-2026-09-07-session-health-queue-coverage — Task 0, second pass.
//
// The first pass classified titles by their leading WORD. That is enough to see
// the shape and not enough to choose a predicate: eight of the twenty first
// words are ambiguous without reading the title behind them. Task 1 says "do not
// invent a scheme the existing rows do not support", so this reads the rows.
//
// READ ONLY.

const RELAY = process.env.RELAY_BASE || 'https://field-relay-nba.jeffunglesbee.workers.dev';
const GATE = process.env.RELAY_SHARED_SECRET;
if (!GATE) { console.error('RELAY_SHARED_SECRET is not set. This script will not guess it.'); process.exit(1); }

const d1 = async (sql) => {
  const r = await fetch(`${RELAY}/d1/execute`, {
    method: 'POST',
    headers: { 'X-FIELD-Relay': GATE, 'Content-Type': 'application/json' },
    body: JSON.stringify({ sql, params: [] }),
  });
  const t = await r.text();
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${t.slice(0, 200)}`);
  return JSON.parse(t).results || [];
};

// The vocabulary that unambiguously means CLOSED, taken from the first-word
// census. Everything else is printed in full for a human to read.
const CLOSED_WORDS = ['DONE', 'DONE,', 'RESOLVED', 'SUPERSEDED', 'CLOSED', 'WITHDRAWN', 'MERGED', 'EXECUTED'];
const notClosed = CLOSED_WORDS.map(w => `UPPER(TRIM(SUBSTR(title,1,INSTR(title||' ',' ')-1))) != '${w}'`).join(' AND ');

const rows = await d1(
  `SELECT key, title, COALESCE(status,'(null)') AS status, updated_at
   FROM codex WHERE category = 'cc-cmd-queue' AND ${notClosed}
   ORDER BY updated_at ASC`);

console.log(`${rows.length} row(s) whose leading word is not in the unambiguous CLOSED vocabulary\n`);
for (const r of rows) {
  console.log(`  ${r.updated_at}  [${r.status}]  ${r.key}`);
  console.log(`      ${r.title}\n`);
}

const { writeFileSync } = await import('node:fs');
writeFileSync(`outbox/session-health-queue-titles-${new Date().toISOString().replace(/[:.]/g,'-')}.json`,
  JSON.stringify({ ran_at: new Date().toISOString(), closed_words: CLOSED_WORDS, count: rows.length, rows }, null, 2) + '\n');
