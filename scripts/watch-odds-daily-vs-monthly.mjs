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
// THE SEGMENT, STATED. The span is the current month's run of readings, not the
// file. Before 2026-10-03 it was the file, and a September reset sitting behind
// three perfectly comparable October readings made this watch refuse four runs
// in a row. A reader who cannot see which readings were used cannot tell a
// narrow verdict from a latched refusal.
if (typeof v.readingsInSegment === 'number')
  say(`readings in the current month's segment: ${v.readingsInSegment}`
    + `${v.droppedBeforeReset ? `  (${v.droppedBeforeReset} dropped at the reset of ${v.resetAt})` : ''}`);
say(`days fully inside the span: ${v.days ? v.days.length : 0}`
  + `${v.days && v.days.length ? ` (${v.days.map(d => `${d.day}:${d.used}`).join(' · ')})` : ''}`);
say(`span: ${v.from || '-'}  ->  ${v.to || '-'}`);
say(`verdict: ${v.verdict}`);

// THE PER-DAY TABLE.
//
// The whole-segment inequality is the verdict and stays the verdict. But a
// cumulative figure hides a fix that landed on one day, and it did: the atomic
// counter shipped 2026-09-23 and the per-day excess fell from +3,418 on 09-22
// to -24 on 09-29 while every cumulative reading still looked like a standing
// defect. That table was derived by hand, off-script, for six days running —
// which is the reason it is printed here instead.
//
// DIAGNOSTIC, NOT A VERDICT, and `spanHours` is on every row so that is
// checkable rather than asserted: the readings land near 05:00Z, so a pair
// spans a day offset from the UTC day by about five hours.
if (Array.isArray(v.perDay) && v.perDay.length) {
  say('');
  say('  PER-DAY, diagnostic only — each pair spans ~24h offset from the UTC day');
  say('  day          dayUsed   monthlyD    excess   span');
  for (const d of v.perDay) {
    const n = (x) => (x === null || x === undefined ? '—' : String(x));
    say(`  ${String(d.day || '-').padEnd(12)}${n(d.dayUsed).padStart(8)}`
      + `${n(d.monthlyDelta).padStart(11)}${n(d.excess).padStart(10)}`
      + `${n(d.spanHours).padStart(7)}h${d.resetBetween ? '   reset between' : ''}`);
  }
  say('');
  say('  A row is not a verdict: the two windows differ by the read hour, so a');
  say('  single excess of a few tens is window offset, not a counter defect. The');
  say('  verdict above is the window-free inequality over the whole segment.');
}

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
