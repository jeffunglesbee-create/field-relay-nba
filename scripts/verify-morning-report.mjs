#!/usr/bin/env node
// Checks one stored Morning Report against the games it was written from. Read-only: three GETs of public
// routes, no LLM call and no write (Rule 78: nothing here touches the recompute route).
//
//   node scripts/verify-morning-report.mjs 2026-10-30            the morning for that date, from the live relay
//   node scripts/verify-morning-report.mjs 2026-10-30 --relay URL
//   node scripts/verify-morning-report.mjs 2026-10-30 --dir DIR      from three saved route answers instead of the network:
//        DIR/morning_report.json  GET /analytics/morning_report/<date>
//        DIR/context.json         GET /context/date/<date>
//        DIR/truth_is.json        GET /analytics/truth_is/<date>   (optional)
//   (for an environment where curl reaches the relay and Node's fetch does not)
//
// The date is the day the games were played on: the cron writes it at 09:00Z the next morning (05:00 ET before
// 2026-11-01, 04:00 ET after). From the first cron after src/morning-report.js started writing the sentence
// about each game (the row for 2026-10-30), every game the report cites must be printed as exactly the fact
// line and exactly the sentence the spec has for its row. Rows written before that hold sentences the model
// wrote; this command reports them as defects, which is correct and not a fault of the relay.
//
// Exit code: 0 verified; 1 defects found; 2 nothing to verify (no row, a degraded morning, a night with no
// game); 64 bad usage; 70 a route could not be read.
//
// scripts/lib/morning-report-verify.mjs holds the logic and is pinned by scripts/check-morning-report-cite.mjs.
import { readFileSync } from 'node:fs';
import { verifyMorning } from './lib/morning-report-verify.mjs';
import { slateNamesOf } from '../src/morning-report.js';

const args = process.argv.slice(2);
const date = args.find((a) => /^\d{4}-\d{2}-\d{2}$/.test(a));
const ri = args.indexOf('--relay');
const relay = (ri >= 0 ? args[ri + 1] : null) || process.env.RELAY_BASE || 'https://field-relay-nba.jeffunglesbee.workers.dev';
const di = args.indexOf('--dir');
const dir = di >= 0 ? args[di + 1] : null;
if (!date || (di >= 0 && !dir) || (ri >= 0 && !args[ri + 1])) {
  console.error('usage: node scripts/verify-morning-report.mjs YYYY-MM-DD [--relay URL | --dir DIR]');
  process.exit(64);
}

// The routes are cached for a few minutes; a changing query string reads past the cache.
const get = async (path, { optional = false } = {}) => {
  const r = await fetch(`${relay}${path}?x=${Date.now()}`);
  if (r.status === 404 && optional) return null;
  if (!r.ok) throw new Error(`${path} -> HTTP ${r.status}`);
  return r.json();
};

const saved = (name, { optional = false } = {}) => {
  try { return JSON.parse(readFileSync(`${dir}/${name}`, 'utf8')); }
  catch (e) { if (optional && e.code === 'ENOENT') return null; throw e; }
};

let mr, ctx, truth;
try {
  if (dir) {
    mr = saved('morning_report.json', { optional: true });
    ctx = saved('context.json');
    truth = saved('truth_is.json', { optional: true });
  } else {
    [mr, ctx, truth] = await Promise.all([
      get(`/analytics/morning_report/${date}`, { optional: true }),
      get(`/context/date/${date}`),
      get(`/analytics/truth_is/${date}`, { optional: true }),
    ]);
  }
} catch (e) {
  console.error(`could not read ${dir ? 'a saved answer' : 'a route'}: ${e.message}`);
  process.exit(70);
}
if (!mr || !mr.data) { console.log(`no morning_report row for ${date}`); process.exit(2); }

const rows = [...(ctx?.games?.regular || []), ...(ctx?.games?.postseason || [])];
const result = verifyMorning({
  value: mr.data.value,
  briefText: mr.data.brief_text,
  rows,
  headline: truth?.data?.value?.headline ?? null,
  slateNames: slateNamesOf(ctx),
});

console.log(`morning_report ${date}  written ${mr.data.created_at}  read ${new Date().toISOString()}`);
console.log(`value: ${JSON.stringify(mr.data.value)}`);
console.log(`brief_text: ${mr.data.brief_text}`);
console.log(`games on the night: ${rows.length}; Phase 3 headline: ${truth?.data?.value?.headline ?? '(none)'}`);
if (result.status === 'not-composed') {
  console.log(`\nNOTHING TO VERIFY  ${result.reason}`);
  process.exit(2);
}
console.log('');
for (const p of result.picks) console.log(`  ${p.id}  ${p.fact}${p.sentence ? ` ${p.sentence}` : ''}   [${p.kind ?? 'fact line only'}${p.phrasing === null ? '' : `, phrasing ${p.phrasing % 3}`}]`);
console.log(`  open : ${result.open ?? '(none)'}`);
console.log(`  close: ${result.close ?? '(none)'}`);
if (result.status === 'verified') {
  console.log(`\nVERIFIED  ${result.picks.length} game(s): each fact line and sentence is the spec's for its row; open and close follow the form`);
  process.exit(0);
}
console.log(`\nDEFECTS (${result.problems.length}):\n${result.problems.map((x) => `  - ${x}`).join('\n')}`);
console.log('\nA row finalised after the cron read it (went_to_ot filled in later, a score corrected) differs from what was printed; check finalized_at on the game before calling this a relay defect.');
process.exit(1);
