#!/usr/bin/env node
// READ-ONLY. Would repairing the 22 captured_at values change anything, and is
// the replacement defensible?
//
// This runs BEFORE any write and is the evidence a write would rest on. It
// makes no D1 change and has no --apply.
//
// THE PREMISES IT EXISTS TO REFUTE (Rule 100):
//
//  P1  "the noon anchor is the true capture time." It is not. The fix stamps
//      `servedAt || snapshot`; servedAt is what the vendor actually returned
//      and is unrecoverable for calls made weeks ago. The anchor is a
//      DERIVABLE SUBSTITUTE, and any row written with it is carrying a
//      reconstruction, not a measurement. Counted and labelled as such.
//
//  P2  "all 22 are verified pre-kickoff either way, so nothing moves." Said
//      from a sample of eight. Measured here over all of them, against the
//      row's own start_time.
//
//  P3  "captured_at has no other reader." Measured in source: the only reader
//      is stampKickoff, and its output `_kickoff` is ALREADY MATERIALISED on
//      the row. So a repair that rewrites captured_at without recomputing
//      _kickoff leaves the row self-contradictory — a new false fact in place
//      of the old one. This probe computes what _kickoff WOULD become.
//
// NO WRITE PATH. SELECT only, enforced.
import { writeFileSync } from 'node:fs';
import { kickoffMark } from '../src/odds-kickoff.js';
import { parseOddsJSON } from '../src/odds-consumer-rules.js';

const RELAY = process.env.RELAY_BASE || 'https://field-relay-nba.jeffunglesbee.workers.dev';
const GATE = process.env.RELAY_SHARED_SECRET;
const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const log = [];
const say = (s) => { console.log(s); log.push(s); };

async function d1(sql, params = []) {
  if (!GATE) throw new Error('RELAY_SHARED_SECRET is not set');
  if (!/^\s*SELECT\b/i.test(sql)) throw new Error('this script issues SELECT only');
  const res = await fetch(`${RELAY}/d1/execute`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-FIELD-Relay': GATE, 'User-Agent': UA },
    body: JSON.stringify({ sql, params }),
  });
  const b = await res.json().catch(() => ({}));
  if (!res.ok || b.success === false) throw new Error(`d1 HTTP ${res.status}: ${JSON.stringify(b).slice(0, 500)}`);
  return b.results || [];
}

// A millisecond fraction is new Date().toISOString(); the vendor's form has none.
const MS = `GLOB '*.[0-9][0-9][0-9]Z'`;

(async () => {
  say(`=== captured_at repair, verification only  relay=${RELAY}  utc=${new Date().toISOString()} ===`);
  say(`NOTHING IS WRITTEN BY THIS SCRIPT.`);

  const rows = [];
  for (const table of ['regular_season_games', 'postseason_games']) {
    const r = await d1(
      `SELECT id, date, start_time, closing_odds
         FROM ${table}
        WHERE closing_odds IS NOT NULL
          AND json_extract(closing_odds,'$.captured_at') ${MS}
          AND json_extract(closing_odds,'$.source') = 'draftkings'
          AND json_extract(closing_odds,'$.total') IS NULL`);
    for (const x of r) rows.push({ ...x, table });
  }
  say(`\n--- 0. the population, by the SHAPE that identified the writer`);
  say(`    draftkings + no total + millisecond captured_at : ${rows.length} row(s)`);
  say(`    (the 22 were found by joining odds_history; this selects by shape alone,`);
  say(`     so a different count here means the shape is wider than the join was.)`);

  let flips = 0, sameVerdict = 0, noStart = 0, lateEither = 0, minutesMoved = 0;
  const examples = [];
  for (const r of rows) {
    const blob = parseOddsJSON(r.closing_odds);
    const stored = blob?.captured_at ?? null;
    const anchor = r.date ? `${r.date}T12:00:00Z` : null;      // what the fix would have stamped
    const now = kickoffMark(stored, r.start_time);
    const after = kickoffMark(anchor, r.start_time);
    if (!r.start_time) { noStart++; continue; }
    if (now.verified !== after.verified) {
      flips++;
      if (examples.length < 10) examples.push(
        `      FLIP ${r.id}\n        kickoff ${r.start_time}\n`
        + `        stored ${stored} -> verified ${now.verified}\n`
        + `        anchor ${anchor} -> verified ${after.verified}`);
    } else sameVerdict++;
    if (!now.verified || !after.verified) lateEither++;
    if ((now.late_minutes ?? null) !== (after.late_minutes ?? null)) minutesMoved++;
    // Does the row's STORED _kickoff agree with what its own captured_at implies?
    const onRow = blob?._kickoff ?? null;
    if (onRow && onRow.verified !== now.verified && examples.length < 10)
      examples.push(`      STORED MARK DISAGREES ${r.id}: row says ${onRow.verified}, its captured_at implies ${now.verified}`);
  }

  say(`\n--- 1. P2 — would the anchor change the kickoff verdict?`);
  say(`    rows with a start_time to judge against : ${rows.length - noStart} of ${rows.length}`);
  say(`    verdict unchanged                       : ${sameVerdict}`);
  say(`    VERDICT FLIPS                           : ${flips}`);
  say(`    late under either timestamp             : ${lateEither}`);
  say(`    late_minutes would change               : ${minutesMoved}`);
  say(`    no start_time, unjudgeable              : ${noStart}`);
  for (const e of examples) say(e);

  say(`\n--- 2. P3 — what a partial repair would leave behind`);
  say(`    _kickoff is already materialised on every one of these rows, and`);
  say(`    stampKickoff is captured_at's ONLY reader. Rewriting captured_at without`);
  say(`    recomputing _kickoff leaves the row asserting two different capture times.`);
  say(`    A repair must write both fields in one statement or not run.`);

  say(`\n--- 3. P1 — what the replacement actually is`);
  say(`    The fix stamps servedAt || snapshot. servedAt is the vendor's served`);
  say(`    time and is NOT recoverable for these calls. The anchor <date>T12:00:00Z`);
  say(`    is a RECONSTRUCTION. ${rows.length} row(s) would carry it, and each would need`);
  say(`    to say so in the blob — an unmarked reconstruction is the same class of`);
  say(`    false fact as the run-time stamp it replaces.`);

  say(`\nCOVERAGE: every row in both tables matching the writer's shape was read`);
  say(`    — ${rows.length} of ${rows.length}, no sampling; at most 10 examples printed.`);

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  writeFileSync(`outbox/captured-at-repair-verify-${stamp}.log`, log.join('\n') + '\n');
  console.log(`\nwrote outbox/captured-at-repair-verify-${stamp}.log`);
})().catch(e => { console.error('FAIL:', e.message); process.exit(1); });
