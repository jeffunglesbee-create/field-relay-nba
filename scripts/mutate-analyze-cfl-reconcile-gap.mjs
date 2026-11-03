#!/usr/bin/env node
// Rule 90 for scripts/analyze-cfl-reconcile-gap.mjs: each mutation breaks one clause of the arithmetic that the CC-CMD's P5 conclusion rests on, and the self-test must go red.
// Each asserts its anchor is unique and applied before reporting a result. Mutates in place and restores; needs the file's changes staged or committed.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';

const FILE = 'scripts/analyze-cfl-reconcile-gap.mjs';
if (spawnSync('git', ['diff', '--quiet', '--', FILE]).status !== 0) { console.log(`FAIL — ${FILE} has unstaged changes; restoring would lose them.`); process.exit(1); }
if (spawnSync('node', [FILE, '--self-test'], { stdio: 'ignore' }).status !== 0) { console.log(`FAIL — ${FILE} --self-test is already red on clean source.`); process.exit(1); }
console.log(`baseline: ${FILE} --self-test passes on clean source\n`);

const M = [
  ['A1 kept sums every site, not this one', "const kept = sumBy(rec, (r) => r.credits_kept);", "const kept = sumBy(s.reconcile || [], (r) => r.credits_kept);", 'another site\'s kept credits are subtracted from CFL\'s by_site'],
  ['A2 hit counts every row', "const hit = sumBy(rec.filter((r) => r.cache === 'HIT'), (r) => r.n);", "const hit = sumBy(rec, (r) => r.n);", 'the gap is said to move with cache hits because every call is a hit'],
  ['A3 the gap is by_site + kept', "gap: by - kept,", "gap: by + kept,", 'sign'],
  ['A4 a sample AT t is still bounded by the next one', "hi: before && before.at === t ? lo : (after ? after.gap : lo)", "hi: after ? after.gap : lo", 'the window bounds widen by a whole sample when a reading coincides with one'],
  ['A5 the window across midnight drops the rest of day 1', "return { lo: Math.max(0, fin - a.hi) + b.lo, hi: Math.max(0, fin - a.lo) + b.hi };", "return { lo: b.lo, hi: b.hi };", 'a window that spans UTC midnight loses the evening burst'],
  ['A6 the residual has the wrong sign', "residual: vendor - ledger - ci", "residual: ledger - vendor - ci", 'negative would mean under-recorded'],
  ['A7 CI that cannot be read is zero', "return m ? Number(m[1]) : null;", "return m ? Number(m[1]) : 0;", 'a window with unreadable CI spend reads as measured (the old watch defect)'],
  ['A8 pearson of a constant column is 0', "return sxx === 0 || syy === 0 ? null : sxy / Math.sqrt(sxx * syy);", "return sxx === 0 || syy === 0 ? 0 : sxy / Math.sqrt(sxx * syy);", 'an undefined correlation reads as \"no correlation\"'],
  ['A10 a missing field is summed as zero', "if (typeof v !== 'number' || !Number.isFinite(v)) throw new Error(", "if (false) throw new Error(", 'a row that lost its n reads as a quiet day'],
  ['A11 an absent reconcile array reads as no calls', "if (!Array.isArray(s.reconcile)) throw new Error(", "if (false) throw new Error(", 'a sample that lost its tally reads as a quiet one'],
  ['A12 an unreadable site is read as its by_site', "if (Array.isArray(s.unreadable_sites) && s.unreadable_sites.includes(site)) throw new Error(", "if (false) throw new Error(", 'a site the relay could not read is counted as a reading'],
  ['A13 a by_site that is not a number is accepted', "if (present && (typeof s.by_site[site] !== 'number' || !Number.isFinite(s.by_site[site]))) throw new Error(", "if (false) throw new Error(", 'a null charge reads as 0'],
  ['A14 a null ledger is coerced to zero in the residual', "if (![prev.vendor_month_used, curr.vendor_month_used, prev.ledger_month_used, curr.ledger_month_used, ci].every((v) => typeof v === 'number' && Number.isFinite(v))) return null;", "", 'a window with no ledger reading prints a garbage residual'],
  ['A15 a by_site object that is absent reads as no spend', "if (!s.by_site || typeof s.by_site !== 'object') throw new Error(", "if (false) throw new Error(", 'a sample with no by_site reads as a quiet day'],
  // done condition 5: the stranded figure and the day read
  ['B1 stranded forgets the error rows', "stranded: by - (kept - kept_error),", "stranded: by - kept,", 'an error call\'s intent-kept hides a charge that stayed, and the criterion reads the smaller figure'],
  ['B2 kept_error counts every site', "const kept_error = sumBy(rec.filter((r) => r.state === 'error'), (r) => r.credits_kept);", "const kept_error = sumBy(s.reconcile.filter((r) => r.state === 'error'), (r) => r.credits_kept);", 'another site\'s error rows are added back to CFL\'s stranded figure'],
  ['B3 error classification inverted', "const kept_error = sumBy(rec.filter((r) => r.state === 'error'), (r) => r.credits_kept);", "const kept_error = sumBy(rec.filter((r) => r.state !== 'error'), (r) => r.credits_kept);", 'the rows that are NOT errors are added back'],
  ['B4 a row with no state is accepted', "for (const r of rec) if (typeof r.state !== 'string') throw new Error(", "for (const r of rec) if (false) throw new Error(", 'a row that cannot be classed is silently treated as not an error'],
  ['B5 the day read takes the largest sample, not the last', "  const l = today[today.length - 1];\n  const lastHour", "  const l = today.reduce((a, b) => (b.by_site > a.by_site ? b : a));\n  const lastHour", 'a figure that fell during the day, or a mid-day maximum, is read as the day\'s'],
  ['B6 the verdict reads the gap, not stranded', "if (l.stranded > DC5_MAX_STRANDED) return fin('fail'", "if (l.gap > DC5_MAX_STRANDED) return fin('fail'", 'the criterion keeps reading the figure that error rows push under the line'],
  ['B7 the HIT floor is exclusive', "if (l.hit < DC5_MIN_HIT) return fin(", "if (l.hit <= DC5_MIN_HIT) return fin(", 'a day with exactly 100 HIT calls is called inconclusive'],
  ['B8 the credit ceiling is exclusive', "if (l.stranded > DC5_MAX_STRANDED) return fin('fail'", "if (l.stranded >= DC5_MAX_STRANDED) return fin('fail'", 'exactly 48 credits (8 calls, the stated bound) fails'],
  ['B9 the partial-day guard is gone', "if (lastHour < DC5_MIN_LAST_SAMPLE_HOUR) return fin(", "if (false) return fin(", 'a day whose evening is unread passes'],
  ['B10 a day with no sample passes', "verdict: 'no-data', reason: `no drift sample is dated", "verdict: 'pass', reason: `no drift sample is dated", 'absence of rows reads as a quiet day'],
  ['B11 a figure that is not a count of calls gets a verdict', "if (l.stranded < 0 || l.stranded % CALL !== 0) return fin(", "if (false) return fin(", 'a negative or fractional stranded figure is judged instead of refused'],
  ['B12 figures_disagree is never set', "const figures_disagree = side(l.gap) !== side(l.stranded);", "const figures_disagree = false;", 'the reader is not told the two figures fall on different sides of the line'],
  ['B13 the unread hours are the read hours', "unread_hours_after_last_sample: Math.round((24 - lastHour) * 10) / 10", "unread_hours_after_last_sample: Math.round(lastHour * 10) / 10", 'the coverage line prints the wrong denominator'],
  ['B14 the day read does not sort its samples', "export function dayRead(rows, day) {\n  const today = rows.filter((r) => r.date === day).sort((a, b) => a.at.localeCompare(b.at));", "export function dayRead(rows, day) {\n  const today = rows.filter((r) => r.date === day);", 'samples handed over newest first are read oldest-last'],
  // P2: is the known CI spend in the ledger?
  ['C1 ciSide has the sides swapped', "return a < b ? 'not-in-ledger' : b < a ? 'in-ledger' : 'tie';", "return a < b ? 'in-ledger' : b < a ? 'not-in-ledger' : 'tie';", 'the P2 premise is reported backwards'],
  ['C2 ciSide ignores the CI', "const a = Math.abs(w.residual + g), b = Math.abs(w.residual + g + w.ci);", "const a = Math.abs(w.residual + g), b = Math.abs(w.residual + g);", 'every window ties, so the premise is never tested'],
  ['C3 ciSide does not add the CFL gap back', "const g = (w.cfl_gap_lo + w.cfl_gap_hi) / 2;", "const g = 0;", 'a window dominated by the CFL over-record is read against the wrong zero'],
  ['C4 an unmeasured window is judged', "if (typeof w.residual !== 'number' || typeof w.ci !== 'number') return null;", "if (false) return null;", 'a null residual or CI is coerced to a number and votes'],
  // --out
  ['D1 --out is ignored', "  if (i === -1) return 'outbox/cfl-reconcile-gap.json';\n  const v = argv[i + 1];", "  if (true) return 'outbox/cfl-reconcile-gap.json';\n  const v = argv[i + 1];", 'a run that must keep the committed record overwrites it'],
  ['D2 --out with no path falls back to the default', "  if (!v || v.startsWith('--')) throw new Error('--out needs a file path');", "  if (!v || v.startsWith('--')) return 'outbox/cfl-reconcile-gap.json';", 'a mistyped flag silently overwrites the committed record'],
  ['A9 pearson accepts two points', "if (n < 3) return null;", "if (n < 2) return null;", 'two points always give r = +-1'],
];
let caught = 0;
for (const [name, anchor, replace, why] of M) {
  const src = fs.readFileSync(FILE, 'utf8');
  const hits = src.split(anchor).length - 1;
  if (hits !== 1) { console.log(`FAIL       ${name}\n            anchor matched ${hits} times, expected 1 — NOTHING MUTATED.`); continue; }
  if (anchor === replace) { console.log(`FAIL       ${name}\n            replacement equals the anchor — NOTHING MUTATED.`); continue; }
  fs.writeFileSync(FILE, src.replace(anchor, () => replace));
  const run = spawnSync('node', [FILE, '--self-test'], { encoding: 'utf8', timeout: 60000 });
  const fails = String(run.stdout ?? '').split('\n').filter((l) => l.includes('FAIL'));
  const red = run.status !== 0 && fails.length > 0;   // a crash, a syntax error or a timeout is BROKE, not CAUGHT: an assertion must have fired
  fs.writeFileSync(FILE, src);
  console.log(`${red ? 'CAUGHT    ' : run.status !== 0 ? 'BROKE     ' : 'NOT CAUGHT'} ${name}\n            (${why})${red ? `\n            <- ${fails[0].trim().slice(0, 120)}` : ''}`);
  if (red) caught++;
}
console.log(`\n${caught} of ${M.length} mutations caught.`);
process.exit(caught === M.length ? 0 : 1);
