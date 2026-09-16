#!/usr/bin/env node
// A backfill run that pays for events and pairs NONE of them is the defect this
// watcher exists for, because it is invisible everywhere else.
//
// WHAT IT IS WATCHING FOR, concretely. Until 2026-09-16 the cron's matcher
// compared team names for equality, and the vendor appends a mascot to every
// college name, so CFB scored 0 of 80 — not poorly, zero. The workflow went
// green every day. `silently-dead-crons.yml` could not see it: the cron was not
// dead, it ran, spent credits and wrote a progress row saying games_processed 0.
// A zero whose denominator is invisible reads as health (Rule 99).
//
// THE SIGNATURE IS UNAMBIGUOUS: credits_used > 0 AND games_processed = 0. The
// run fetched a payload, was billed for it, and paired nothing out of it. There
// is no benign reading — a date with no mappable games spends no credits, and a
// date whose vendor has no data spends credits but is reported separately below
// so the two are never conflated.
//
// READ-ONLY. The d1 helper refuses any statement that is not a SELECT.
// --self-test runs the predicate against enumerated synthetic rows and needs no
// network, so the gate can run in CI where D1 is not reachable.

const RELAY = process.env.RELAY_BASE || 'https://field-relay-nba.jeffunglesbee.workers.dev';
const GATE  = process.env.RELAY_SHARED_SECRET;   // no default: an unset secret must 401, not look set
const SINCE = process.argv.find(a => a.startsWith('--since='))?.split('=')[1] || null;
const DAYS  = Number(process.argv.find(a => a.startsWith('--days='))?.split('=')[1] || 14);
const SELF  = process.argv.includes('--self-test');

/** The whole judgement, in one place, so the self-test and the live run cannot
 *  diverge. Returns the rows that are the defect. */
export function burnedWithoutPairing(rows) {
  return (rows || []).filter(r => Number(r.credits_used) > 0 && Number(r.games_processed) === 0);
}

if (SELF) {
  const CASES = [
    [{ date: 'a', credits_used: 20, games_processed: 0 },  true,  'paid and paired nothing — the 0-of-80 signature'],
    [{ date: 'b', credits_used: 20, games_processed: 1 },  false, 'paid and paired one — working, however thinly'],
    [{ date: 'c', credits_used: 0,  games_processed: 0 },  false, 'spent nothing, so there was nothing to pair'],
    [{ date: 'd', credits_used: 0,  games_processed: 5 },  false, 'paired without spending — a cached or resumed run'],
    [{ date: 'e', credits_used: '20', games_processed: '0' }, true, 'D1 returns strings; the predicate must still fire'],
    [{ date: 'f', credits_used: 20, games_processed: null }, true, 'a null pairing count is zero pairings, not unknown'],
  ];
  let bad = 0;
  for (const [row, want, why] of CASES) {
    const got = burnedWithoutPairing([row]).length === 1;
    got === want ? console.log(`  PASS  ${row.date}: flagged=${got}  (${why})`)
                 : (bad++, console.log(`  FAIL  ${row.date}: flagged=${got} want ${want}  (${why})`));
  }
  console.log(bad ? `\n${bad} FAILED` : `\nself-test: ${CASES.length}/${CASES.length}`);
  console.log(`COVERAGE: the predicate only. It does not exercise D1 or the cron.`);
  process.exit(bad ? 1 : 0);
}

async function d1(sql, params = []) {
  if (!/^\s*SELECT\b/i.test(sql)) throw new Error(`refusing non-SELECT: ${sql.slice(0, 60)}`);
  const res = await fetch(`${RELAY}/d1/execute`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-FIELD-Relay': GATE },
    body: JSON.stringify({ sql, params }),
  });
  const body = await res.json();
  if (!res.ok || body.success === false) throw new Error(`d1 HTTP ${res.status}: ${JSON.stringify(body).slice(0, 300)}`);
  const r = body.results || body.result || [];
  return Array.isArray(r) ? (r[0]?.results || r) : (r.results || []);
}

const since = SINCE || new Date(Date.now() - DAYS * 86400000).toISOString().slice(0, 10);
console.log(`=== odds backfill pairing rate  utc=${new Date().toISOString()} ===`);
console.log(`window: progress rows dated >= ${since}\n`);

const rows = await d1(
  `SELECT date, games_processed, credits_used
     FROM odds_backfill_progress
    WHERE date >= ?
    ORDER BY date DESC`, [since]);

// An empty result is NOT a pass. It means the cron has not recorded a run in
// the window, which is its own failure and must not read as "nothing wrong".
if (!rows.length) {
  console.log(`FAIL: no progress row at all since ${since}.`);
  console.log(`The backfill has not recorded a run in ${DAYS} day(s). That is not a`);
  console.log(`clean bill of health — it is an absent denominator.`);
  process.exit(1);
}

const spent  = rows.filter(r => Number(r.credits_used) > 0);
const burned = burnedWithoutPairing(rows);
const paired = spent.length - burned.length;

console.log(`  progress rows in window        : ${rows.length}`);
console.log(`  of those, rows that spent      : ${spent.length}`);
console.log(`  spent AND paired at least one  : ${paired}`);
console.log(`  spent AND paired ZERO          : ${burned.length}`);
console.log(`  total credits in window        : ${rows.reduce((a, r) => a + Number(r.credits_used || 0), 0)}`);
console.log(`  total games paired in window   : ${rows.reduce((a, r) => a + Number(r.games_processed || 0), 0)}`);

if (burned.length) {
  console.log(`\nFAIL: ${burned.length} date(s) were billed and paired nothing:`);
  for (const r of burned.slice(0, 20)) console.log(`      ${r.date}  credits ${r.credits_used}  games 0`);
  if (burned.length > 20) console.log(`      … ${burned.length - 20} more`);
  console.log(`\nThis is the shape the equality matcher produced on every CFB date before`);
  console.log(`2026-09-16. Investigate the matcher before the budget (Rule 77).`);
  console.log(`\nCOVERAGE: ${rows.length} progress rows since ${since}. odds_backfill_progress is`);
  console.log(`keyed by DATE, so a date mixing a paired sport with an unpaired one reads as`);
  console.log(`paired — this catches total failure per date, not per sport.`);
  process.exit(1);
}

console.log(`\nPASS: every date that spent credits paired at least one game.`);
console.log(`\nCOVERAGE: ${rows.length} progress rows since ${since}. odds_backfill_progress is`);
console.log(`keyed by DATE, so a date mixing a paired sport with an unpaired one reads as`);
console.log(`paired — this catches total failure per date, not per sport.`);
