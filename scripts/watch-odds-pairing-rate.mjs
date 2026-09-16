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
const fs    = await import('node:fs').then(m => m.default);

/** The whole judgement, in one place, so the self-test and the live run cannot
 *  diverge. Returns the rows that are the defect. */
export function burnedWithoutPairing(rows) {
  return (rows || []).filter(r => Number(r.credits_used) > 0 && Number(r.games_processed) === 0);
}

/**
 * Did the provider bill more between two readings than the daily ceiling allows?
 *
 * WHY THE PROVIDER AND NOT OUR LEDGER. The ledger is what our guards THINK they
 * spent. The provider is what was actually billed. Measured 2026-09-16, the two
 * disagree by ~19,700 on the month — an offset already ~17,800 on 2026-09-05, so
 * it is old and roughly static rather than a live leak, but it means a ledger
 * reading cannot answer "what did today cost". Only the provider can.
 *
 * WHY THIS CAN FIRE AT ALL, given a 3,800/day ceiling exists. Both guards
 * degrade OPEN: consumeOddsCredit returns true when FIELD_JOURNALISM is unbound,
 * and checkAndIncrementDailyOdds returns true on any KV error. A day billed well
 * above the ceiling is therefore not impossible — it is the signature of a guard
 * that stopped guarding, which is invisible from inside the guard.
 *
 * The allowance is prorated by elapsed time, because two readings are ~24h apart
 * but never exactly, and comparing a 30-hour delta against a 24-hour ceiling
 * would manufacture a failure.
 *
 * A NEGATIVE delta is the monthly reset, not an error, and is reported as such.
 *
 * @param {{at: string, provider_used: number}|null} prev  previous reading, or null
 * @param {{at: string, provider_used: number}} curr
 * @param {number} ceiling  credits the daily guard permits
 */
export function daySpendVerdict(prev, curr, ceiling) {
  // Number(null) is 0 and Number('') is 0, so a MISSING reading would subtract
  // as a real zero and look like a counter reset. Rule 99, in the instrument
  // built to catch spend anomalies. Absent is absent, not zero.
  const num = (v) => (v === null || v === undefined || String(v).trim() === ''
    ? null : (Number.isFinite(Number(v)) ? Number(v) : null));
  const used = num(curr?.provider_used);
  if (used === null) return { state: 'unreadable', over: false };
  if (!prev) return { state: 'no_baseline', over: false };
  const before = num(prev.provider_used);
  if (before === null) return { state: 'unreadable', over: false };

  const elapsedH = (Date.parse(curr.at) - Date.parse(prev.at)) / 3600000;
  if (!Number.isFinite(elapsedH) || elapsedH <= 0) return { state: 'unreadable', over: false };

  const delta = used - before;
  if (delta < 0) return { state: 'provider_counter_reset', over: false, delta, elapsedH };

  const allowance = ceiling * (elapsedH / 24);
  return {
    state: delta > allowance ? 'over_ceiling' : 'within_ceiling',
    over: delta > allowance,
    delta, allowance: Math.round(allowance), elapsedH: Math.round(elapsedH * 10) / 10,
    perDay: Math.round(delta / (elapsedH / 24)),
  };
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

  const D = (h) => new Date(Date.parse('2026-09-16T11:00:00Z') + h * 3600000).toISOString();
  const SPEND = [
    [null, { at: D(0), provider_used: 100 }, 3800, 'no_baseline', 'the first reading has nothing to subtract from'],
    [{ at: D(0), provider_used: 1000 }, { at: D(24), provider_used: 4000 }, 3800, 'within_ceiling', '3000 in 24h, under 3800'],
    [{ at: D(0), provider_used: 1000 }, { at: D(24), provider_used: 12000 }, 3800, 'over_ceiling', '11000 in a day — a guard degraded open'],
    [{ at: D(0), provider_used: 1000 }, { at: D(12), provider_used: 3000 }, 3800, 'over_ceiling', '2000 in HALF a day is over a prorated 1900'],
    [{ at: D(0), provider_used: 1000 }, { at: D(30), provider_used: 4600 }, 3800, 'within_ceiling', '3600 over 30h is under a prorated 4750 — no manufactured failure'],
    [{ at: D(0), provider_used: 90000 }, { at: D(24), provider_used: 120 }, 3800, 'provider_counter_reset', 'the month rolled over; not an error'],
    [{ at: D(0), provider_used: 1000 }, { at: D(24), provider_used: '4000' }, 3800, 'within_ceiling', "the provider sends a STRING; it must still subtract"],
    [{ at: D(0), provider_used: 1000 }, { at: D(24), provider_used: null }, 3800, 'unreadable', 'an absent reading is not a zero-spend day'],
  ];
  for (const [prev, curr, ceil, want, why] of SPEND) {
    const got = daySpendVerdict(prev, curr, ceil).state;
    got === want ? console.log(`  PASS  spend: ${want.padEnd(23)} (${why})`)
                 : (bad++, console.log(`  FAIL  spend: got ${got} want ${want}  (${why})`));
  }

  console.log(bad ? `\n${bad} FAILED` : `\nself-test: ${CASES.length + SPEND.length}/${CASES.length + SPEND.length}`);
  console.log(`COVERAGE: both predicates only. Neither exercises D1, the provider, or the cron.`);
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

let failed = false;

if (burned.length) {
  failed = true;
  console.log(`\nFAIL: ${burned.length} date(s) were billed and paired nothing:`);
  for (const r of burned.slice(0, 20)) console.log(`      ${r.date}  credits ${r.credits_used}  games 0`);
  if (burned.length > 20) console.log(`      … ${burned.length - 20} more`);
  console.log(`\nThis is the shape the equality matcher produced on every CFB date before`);
  console.log(`2026-09-16. Investigate the matcher before the budget (Rule 77).`);
}

// ── the provider series: what was actually BILLED, day over day ─────────────
//
// The ledger above is what our guards think they spent. This is what the
// provider charged. Two readings 11 days apart on 2026-09-16 showed the two
// disagreeing by ~19,700 cumulative, so "what did today cost" is a question
// only the provider can answer — and it could not be answered at all, because
// nothing was recording the number. A series of one is not a series.
const SERIES = 'outbox/odds-provider-usage-series.json';
let series = [];
try { series = JSON.parse(fs.readFileSync(SERIES, 'utf8')); } catch (_) { series = []; }
if (!Array.isArray(series)) series = [];

let budget = null;
try {
  const r = await fetch(`${RELAY}/budget/odds`, { headers: { Accept: 'application/json' } });
  budget = await r.json();
} catch (e) {
  console.log(`\nFAIL: /budget/odds unreachable (${e.message}).`);
  console.log(`Today's spend cannot be recorded, so tomorrow's delta will have no baseline.`);
  process.exit(1);
}

const reading = {
  at: new Date().toISOString(),
  provider_used: budget?.provider?.requests_used ?? null,
  provider_remaining: budget?.provider?.requests_remaining ?? null,
  ledger_month_used: budget?.monthly?.used ?? null,
  daily_used: budget?.daily?.used ?? null,
  daily_ceiling: budget?.daily?.ceiling ?? null,
  games_paired_in_window: rows.reduce((a, r) => a + Number(r.games_processed || 0), 0),
};
const prev = series.length ? series[series.length - 1] : null;
const ceiling = Number(reading.daily_ceiling) || 3800;
const spend = daySpendVerdict(prev, reading, ceiling);

console.log(`\n  provider billed this month     : ${reading.provider_used ?? 'unreadable'}`);
console.log(`  our ledger says                : ${reading.ledger_month_used ?? 'unreadable'}`);
console.log(`  today's daily counter          : ${reading.daily_used ?? 'unreadable'} / ${ceiling}`);
console.log(`  readings on file               : ${series.length}`);

if (spend.state === 'no_baseline') {
  console.log(`\n  FIRST READING — no delta yet. Tomorrow's run is the first that can`);
  console.log(`  answer "what did a day cost". Recording and continuing.`);
} else if (spend.state === 'unreadable') {
  console.log(`\n  the provider figure is absent, which is NOT a zero-spend day.`);
} else if (spend.state === 'provider_counter_reset') {
  console.log(`\n  the provider counter went backwards — monthly reset, not an error.`);
} else {
  console.log(`\n  since the last reading (${spend.elapsedH}h):`);
  console.log(`      provider billed   : ${spend.delta}`);
  console.log(`      allowance         : ${spend.allowance}   (${ceiling}/day, prorated)`);
  console.log(`      rate              : ${spend.perDay} credits/day`);
  console.log(`      games paired since: ${reading.games_paired_in_window - (prev.games_paired_in_window ?? 0)}`);
}

series.push(reading);
fs.writeFileSync(SERIES, JSON.stringify(series.slice(-120), null, 2) + '\n');
console.log(`\n  wrote ${SERIES} (${Math.min(series.length, 120)} reading(s) kept)`);

if (spend.over) {
  failed = true;
  console.log(`\nFAIL: the provider billed ${spend.delta} where ${spend.allowance} was allowed.`);
  console.log(`The daily guard permits ${ceiling}. Both guards degrade OPEN — consumeOddsCredit`);
  console.log(`returns true when FIELD_JOURNALISM is unbound, checkAndIncrementDailyOdds returns`);
  console.log(`true on any KV error — so a day above the ceiling is the signature of a guard`);
  console.log(`that stopped guarding. Investigate the guard, not the budget (Rule 77).`);
}

if (!failed) console.log(`\nPASS: every date that spent credits paired at least one game, and the`);
if (!failed) console.log(`provider billed no more than the ceiling allows.`);

console.log(`\nCOVERAGE: ${rows.length} progress rows since ${since}, ${series.length} provider reading(s).`);
console.log(`odds_backfill_progress is keyed by DATE, so a date mixing a paired sport with an`);
console.log(`unpaired one reads as paired — this catches total failure per date, not per sport.`);
process.exit(failed ? 1 : 0);
