// Do our OWN two counters agree? Read-only. No vendor call, no credits.
//
// `consumeOddsCredit` (src/index.js:6535) charges the identical `units` to the
// daily counter and then to the monthly one, in one function, in that order.
// Within a UTC day they cannot legitimately diverge — yet on 2026-09-21 the
// daily figure read 3799 while the monthly counter moved 146.
//
// WHY THIS IS THE CHEAP CHECK NOBODY MADE. Every existing watch compares one of
// our numbers against the VENDOR's cumulative bill, differenced across a window
// that does not line up with a UTC day — or compares daily against the per-site
// sum, which has been structurally incapable of disagreeing since the atomic
// batch shipped, so its green is a tautology. This comparison needs no vendor,
// no window alignment and no external referent. Both numbers arrive in a single
// /budget/odds read, and the series file already holds four of them.
//
// It reads the series that odds-daily-vs-vendor already writes rather than
// keeping a second one. Two files of the same readings would drift, and a
// drifting denominator is this project's most frequent defect.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dailyVsMonthly } from './lib/daily-vs-monthly.cjs';

const SERIES = process.env.DVM_SERIES || 'outbox/odds-daily-vs-vendor-series.json';
const stamp = new Date().toISOString().replace(/[-:]/g, '').slice(0, 15) + 'Z';
const LOG = `outbox/odds-daily-vs-monthly-${stamp}.log`;

const out = [];
const say = (s) => { out.push(s); console.log(s); };

say(`=== odds daily-vs-monthly  utc=${new Date().toISOString()} ===`);
say(`series: ${SERIES}`);

if (!existsSync(SERIES)) {
  say(`NOT RUN — ${SERIES} does not exist. odds-daily-vs-vendor writes it; until`);
  say(`that watch has run at least twice there is nothing here to compare.`);
  writeFileSync(LOG, out.join('\n') + '\n');
  process.exit(0);
}

let readings;
try {
  const j = JSON.parse(readFileSync(SERIES, 'utf8'));
  readings = Array.isArray(j) ? j : (j.readings || j.series || null);
} catch (e) {
  say(`NOT RUN — ${SERIES} is unreadable: ${String(e.message || e).slice(0, 120)}`);
  writeFileSync(LOG, out.join('\n') + '\n');
  process.exit(0);
}

const v = dailyVsMonthly(readings);

// COVERAGE IN THE OUTPUT, NOT IN A COMMENT (Rule 91). A verdict over two
// contained days out of a four-reading series is a different claim from one
// over twenty, and a reader seeing only the word should still know which.
say(`readings on file: ${Array.isArray(readings) ? readings.length : 0}`);
say(`days fully inside the span: ${v.days ? v.days.length : 0}`
  + `${v.days && v.days.length ? ` (${v.days.map(d => `${d.day}:${d.used}`).join(' · ')})` : ''}`);
say(`span: ${v.from || '-'}  ->  ${v.to || '-'}`);
say(`verdict: ${v.verdict}`);

if (v.verdict === 'daily-exceeds-monthly') {
  say('');
  say(`  daily sum over contained days : ${v.dailySum}`);
  say(`  monthly counter moved         : ${v.monthlyDelta}`);
  say(`  EXCESS                        : ${v.excess}   (ratio ${v.ratio}x)`);
  say('');
  say('  The monthly delta spans the SAME hours as those days PLUS the partial');
  say('  hours at each edge, so it can only be larger. Daily exceeding it is not');
  say('  a tolerance question — the excess is a FLOOR on the error, never an');
  say('  estimate of it.');
  say('');
  say('  This says the two disagree. It does NOT say which one is wrong.');
  console.error(`FAIL — the daily counter claims ${v.excess} credits more than the monthly counter recorded.`);
  writeFileSync(LOG, out.join('\n') + '\n');
  process.exit(1);
}

if (v.verdict === 'consistent') {
  say('');
  say(`  daily sum ${v.dailySum} <= monthly delta ${v.monthlyDelta} — no contradiction.`);
  say('  One-sided on purpose: the monthly delta holding MORE than the contained');
  say('  days is expected, because it also holds the edge hours.');
} else {
  say('');
  say(`  ${v.why || 'no comparison was made'}`);
  say('  Not a pass and not a failure — the comparison did not run (Rule 99).');
}

writeFileSync(LOG, out.join('\n') + '\n');
process.exit(0);
