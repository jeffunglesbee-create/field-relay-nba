#!/usr/bin/env node
// Rule 90 for the daily-vs-vendor watch.
//
// This one guards a claim about MONEY, so its mutations are aimed at the ways a
// breach could be made to read as health. V5 is the one to keep: swapping the
// tolerance denominator makes the allowance shrink exactly as the counter
// under-reports, so the worse the defect the easier the check passes — a
// failure mode that looks like a stricter check.
//
// Each asserts its anchor is unique and applied before reporting; NOT CAUGHT
// with nothing mutated is worse than no test.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';

const WATCH = 'scripts/watch-odds-daily-vs-vendor.mjs';
const SELF  = [WATCH, '--self-test'];
// The whole run against a stub relay (the wiring the pure functions cannot show): a mutation is caught if EITHER goes red.
const RUN   = ['scripts/check-odds-daily-vs-vendor-run.mjs', WATCH];
// OPTIONAL, ON PURPOSE. This harness runs in odds-daily-vs-vendor.yml BEFORE the measurement, where a red harness skips the day's reading and splits the
// next vendor window, so it must not depend on a local HTTP server and a temp directory. guards.yml (on every push) passes --with-run and runs
// everything; without it the mutants that only the run check can see (`run: true`) are skipped, and the output says how many.
const WITH_RUN = process.argv.includes('--with-run');

if (spawnSync('git', ['diff', '--quiet', '--', WATCH]).status !== 0) {
  console.log(`FAIL — ${WATCH} has unstaged changes; restore would lose them.`);
  process.exit(1);
}
if (spawnSync('node', SELF, { stdio: 'ignore' }).status !== 0) {
  console.log(`FAIL — ${WATCH} --self-test is already red on clean source.`);
  process.exit(1);
}
if (WITH_RUN && spawnSync('node', RUN, { stdio: 'ignore' }).status !== 0) {
  console.log(`FAIL — ${RUN[0]} is already red on clean source.`);
  process.exit(1);
}
console.log(`baseline: ${WATCH} --self-test${WITH_RUN ? ` and ${RUN[0]}` : ''} pass on clean source\n`);

const MUTATIONS = [
  { name: 'V1 the month boundary is treated as spend',
    anchor: "  if (pm !== cm) return { state: 'month-boundary', from: pm, to: cm };",
    replace: '  if (false) return { state: 0 };',
    catches: 'the vendor reset reads as a huge negative day and the month rolls in as a finding' },

  { name: 'V2 a reset off the 1st slips through',
    anchor: "  if (delta < -RESET_FLOOR) return { state: 'counter-reset', delta };",
    replace: "  if (delta < -1e12) return { state: 'counter-reset', delta };",
    catches: 'a billing cycle that does not land on the 1st is differenced as if it were spend' },

  { name: 'V3a a no-header row that lost its credits is summed as 0 (the original defect)',
    anchor: "    if (!Number.isFinite(r.credits_kept) || !Number.isFinite(r.n)) return null;",
    replace: "    r = { ...r, credits_kept: Number(r.credits_kept) || 0, n: Number(r.n) || 0 };",
    catches: 'the unreconciled-estimate line reads a smaller number, or 0, for a tally it could not read' },

  { name: 'V3b a null row in the tally is skipped',
    anchor: "    if (!r || typeof r !== 'object') return null;",
    replace: "    if (!r || typeof r !== 'object') continue;",
    catches: 'a row that was lost reads as a row that was not there' },

  { name: 'V3 no baseline becomes a zero-spend day',
    anchor: "  if (!prev) return { state: 'no-data' };",
    replace: "  if (!prev) return { state: 'ok', vendorDay: 0 };",
    catches: 'the first ever run reports the vendor billed nothing (Rule 99)' },

  { name: 'V4 known CI spend stops being subtracted',
    anchor: '  const residual = vendorDayCredits - ourDay - (Number(knownCI) || 0);',
    replace: '  const residual = vendorDayCredits - ourDay;',
    catches: 'every backfill day reports a breach, and a real one becomes indistinguishable' },

  { name: 'V5 the tolerance follows OUR number instead of the vendor',
    anchor: '  const tol = toleranceFor(vendorDayCredits);',
    replace: '  const tol = toleranceFor(ourDay);',
    catches: 'the allowance shrinks as our counter under-reports, so the worse the defect the easier it passes' },

  { name: 'V6 over-charging is reported as under-counting',
    anchor: "  return { state: 'we-overcharge-ourselves', residual, tol };",
    replace: "  return { state: 'counter-under-counts', residual, tol };",
    catches: 'wasted headroom and a budget breach are opposite defects with opposite fixes' },

  { name: 'V7 ?date= being ignored stops mattering',
    anchor: "  if (d.date !== wantDay) return { ok: false, why: `asked for ${wantDay}, got ${JSON.stringify(d.date)} — ?date= was not honoured` };",
    replace: '  if (false) return { ok: false, why: 0 };',
    catches: "today's partial total is compared against yesterday's vendor delta — the whole measurement, wrong" },

  { name: 'V8 a still-running day is accepted',
    anchor: "  if (d.is_today === true) return { ok: false, why: `${wantDay} is still running; a day must be CLOSED before its total means anything` };",
    replace: '  if (false) return { ok: false, why: 0 };',
    catches: 'a partial day against a full vendor delta manufactures a shortfall every single run' },

  // Re-anchored 2026-09-19: the line this named was replaced when the vendor
  // turned out to send a string. The harness caught its own staleness and
  // refused to report a verdict — anchor matched 0 times, NOTHING MUTATED —
  // which is the corollary working. V9 now breaks the CALLER's refusal and V11
  // breaks the helper's; both paths can drop an absent reading on their own.
  { name: 'V9 an absent vendor figure is accepted by the caller',
    anchor: "  if (v === null) return { ok: false, why: `provider.requests_used is ${JSON.stringify(body?.provider?.requests_used)} — absent or unparseable; null is NOT zero (Rule 99)` };",
    replace: '  if (false) return { ok: false, why: 0 };',
    catches: 'a day the vendor did not report reads as a day the vendor billed nothing' },

  { name: 'V10 a drifted window is differenced anyway',
    anchor: "  if (hours < 22 || hours > 26) return { state: 'window-drift', hours: Math.round(hours * 10) / 10 };",
    replace: '  if (false) return { state: 0 };',
    catches: 'the measured 104-405 minute runner drift books itself as a shortfall on most days' },

  { name: 'V11 the vendor string is coerced without the absence guard',
    anchor: "  if (v === null || v === undefined || String(v).trim() === '') return null;",
    replace: '  if (false) return null;',
    catches: "Number(null) is 0, so a day the vendor never reported reads as a day it billed nothing" },

  { name: 'V12 a numeric string is rejected again',
    anchor: '  const n = Number(v);\n  return Number.isFinite(n) ? n : null;',
    replace: "  return typeof v === 'number' ? v : null;",
    catches: 'the exact 2026-09-19 failure — the vendor sends "76945" and every real reading is refused' },
  { name: 'V13 a null tally reads as nothing unreconciled',
    anchor: '  if (!Array.isArray(reconcileRows)) return null;',
    replace: '  if (!Array.isArray(reconcileRows)) return { credits: 0, calls: 0, sites: [] };',
    catches: 'an unreadable tally reports 0 unreconciled credits, so a residual that is entirely a kept estimate reads as entirely unexplained (Rule 99)' },

  { name: 'V14 reconciled rows counted as unreconciled',
    anchor: "    if (r.state !== 'no-header') continue;",
    replace: '    if (false) continue;',
    catches: 'every settled call is added to the named overcharge, which would make the residual look fully explained on any day' },

  // ── Task 1 of CC-CMD-2026-10-13-vendor-residual-window: the verdict is the window-aligned residual ──
  { name: 'W1 the verdict is computed against the UTC-day counter again',
    anchor: '  const window = residualVerdict(vd.vendorDay, lw.ledgerWindow, knownCI);',
    replace: '  const window = residualVerdict(vd.vendorDay, curr.day_used, knownCI);',
    catches: 'the offset is back in the verdict: the 10-12 pair reads -616 for -190 and the 10-23 pair reads the breach for health' },

  { name: 'W2 the ledger window is the later reading, not a difference of two',
    anchor: "  return { state: 'ok', ledgerWindow: delta };",
    replace: "  return { state: 'ok', ledgerWindow: c };",
    catches: 'a month-to-date total is differenced against one day of vendor spend' },

  { name: 'W3 an unreadable ledger is coerced instead of refused',
    anchor: "  if (typeof p !== 'number' || typeof c !== 'number' || !Number.isFinite(p) || !Number.isFinite(c)) {",
    replace: '  if (false) {',
    catches: 'null becomes 0 and an unmeasured window reads as a window we recorded nothing in (Rule 99)' },

  { name: 'W4 a ledger that fell inside the month is accepted',
    anchor: "  if (delta < 0) return { state: 'ledger-went-backwards', delta };\n",
    replace: '',
    catches: 'a bad reading is differenced as negative spend and the residual inflates by exactly that much' },

  { name: 'W5 judgeDay lets the ledger path past a vendor refusal',
    anchor: "  if (vd.state !== 'ok') return { state: vd.state, vd };",
    replace: "  if (false) return { state: vd.state, vd };",
    catches: 'the window path becomes a way round month-boundary, window-drift and no-data' },

  { name: 'W6 the verdict state is taken from the UTC-day diagnostic',
    anchor: '  return { state: window.state, vd, lw, window, utcDay };',
    replace: '  return { state: utcDay.state, vd, lw, window, utcDay };',
    catches: 'the printed residual is the window one while the state and the exit code are the old ones' },

  { name: 'W7 the UTC-day diagnostic is dropped from the log',
    anchor: "  L.push(`  residual against that       : ${j.utcDay.residual}   tolerance ${j.utcDay.tol}`);\n",
    replace: '',
    catches: 'the change cannot be seen without reading the code, which is done condition 3' },

  { name: 'W8 the diagnostic is no longer labelled as not the verdict',
    anchor: "  L.push(`  diagnostic, NOT the verdict : the UTC day's counter covers a different 24 hours than the window`);\n",
    replace: '',
    catches: 'two residuals on the page and nothing saying which one decides' },

  { name: 'W9 the window residual is no longer labelled as the verdict',
    anchor: '   <- the verdict`);',
    replace: '`);',
    catches: 'the same, from the other side' },

  { name: 'W10 the ledger the verdict differences against is not named',
    anchor: '(monthly.used at those two readings)`);',
    replace: '`);',
    catches: 'a reader cannot tell what the residual is a residual against' },

  { name: 'W11 the window ledger line is dropped from the log',
    anchor: "  L.push(`  our ledger, same window     : ${j.lw.ledgerWindow}   (monthly.used at those two readings)`);\n",
    replace: '',
    catches: 'the verdict cannot be checked by hand from the log' },

  // The wiring: only the run against the stub relay can see these.
  { name: 'W12 an unreadable ledger no longer fails the run',
    anchor: "if (j.state === 'ledger-unreadable' || j.state === 'ledger-went-backwards' || j.state === 'ci-unreadable') {",
    replace: 'if (false) {',
    catches: 'the run goes on with no ledger delta (and crashes or, worse, prints a residual) instead of failing with its reason', run: true },

  { name: 'W13 the run decides on the UTC-day residual',
    anchor: 'const v = j.window;',
    replace: 'const v = j.utcDay;',
    catches: 'the pure verdict is the window one and the run still exits on the old one', run: true },

  { name: 'W14 the judged day is never printed',
    anchor: 'for (const l of judgementLines(j, reading, ci)) say(l);\n',
    replace: '',
    catches: 'the log has a verdict line and none of the figures behind it', run: true },

  { name: 'W15 the no-header estimate is netted against the window verdict',
    anchor: '  const after = j.utcDay.residual + nh.credits;',
    replace: '  const after = j.window.residual + nh.credits;',
    catches: 'a UTC-day tally is subtracted from a window figure: the same two-windows error, one line down', run: true },

  { name: 'W16 the month boundary exits non-zero',
    anchor: "  say(`\\nOK: reading stored. A verdict needs two readings inside one vendor billing month.`);\n  flush();\n  process.exit(0);",
    replace: "  say(`\\nOK: reading stored. A verdict needs two readings inside one vendor billing month.`);\n  flush();\n  process.exit(1);",
    catches: 'a refusal that expires turns the run red every month rollover', run: true },
  // ── review of Task 1 (2026-11-01): the ledger's source, the CI rows as a reading, the window tolerance, the operand lines, the series ──
  { name: 'X1 a ledger served from KV is accepted as the D1 ledger',
    anchor: "m.source === 'd1' && ",
    replace: '',
    catches: 'the KV correction counter (tens, against a month total of tens of thousands) becomes the baseline and corrupts two verdicts' },

  { name: 'X2 the ledger source is not kept beside a null ledger',
    anchor: "    ledger_source: m && typeof m === 'object' && typeof m.source === 'string' ? m.source : null,\n",
    replace: '',
    catches: 'a null ledger with no reason in the series, a mystery for the next reader' },

  { name: 'X3 a D1 answer that says success:false is read as rows',
    anchor: "  if (body.success !== true) return { ok: false, why: `success is ${JSON.stringify(body.success)}${body.error ? ` (${String(body.error).slice(0, 80)})` : ''}` };\n",
    replace: '',
    catches: 'an error body with no results array is not caught here, and one with one is read as CI spend' },

  { name: 'X4 the HTTP status of the D1 answer is ignored',
    anchor: "  if (!(Number.isInteger(status) && status >= 200 && status < 300)) return { ok: false, why: `HTTP ${status}` };\n",
    replace: '',
    catches: 'a 401 or 500 whose body happens to parse is read as an answer' },

  { name: 'X5 unread CI spend is defaulted to 0 in the verdict',
    anchor: "  if (typeof knownCI !== 'number' || !Number.isFinite(knownCI)) return { state: 'ci-unreadable', vd, lw };\n",
    replace: '',
    catches: 'the 10-12 pair with its CI rows unread reads tracks-the-bill with a residual of 10' },

  { name: 'X6 the run passes unread CI as 0',
    anchor: 'const j = judgeDay(prev, reading, ci === null ? null : ci.credits);',
    replace: 'const j = judgeDay(prev, reading, ci === null ? 0 : ci.credits);',
    catches: 'the pure function is strict and the run defaults anyway: a 500 from D1 turns a finding green', run: true },

  { name: 'X7 the D1 read does not send the relay secret',
    anchor: "headers: { 'Content-Type': 'application/json', 'X-FIELD-Relay': GATE },",
    replace: "headers: { 'Content-Type': 'application/json' },",
    catches: 'every live run gets a 401 and, before this change, silently read CI spend as 0', run: true },

  { name: 'X8 the CI window has no upper bound',
    anchor: 'ci = ciSpendInInterval(c.rows, prev.at, reading.at);',
    replace: "ci = ciSpendInInterval(c.rows, prev.at, '9999-01-01T00:00:00Z');",
    catches: 'CI spend after this reading is subtracted from this window', run: true },

  { name: 'X9 the CI window has no lower bound',
    anchor: 'ci = ciSpendInInterval(c.rows, prev.at, reading.at);',
    replace: "ci = ciSpendInInterval(c.rows, '2000-01-01T00:00:00Z', reading.at);",
    catches: 'the SQL returns the whole UTC day of the previous reading, so CI spend before the window is subtracted', run: true },

  { name: 'X10 the watch asks for today instead of yesterday',
    anchor: 'const YESTERDAY = new Date(Date.now() - 86400000).toISOString().slice(0, 10);',
    replace: 'const YESTERDAY = new Date(Date.now()).toISOString().slice(0, 10);',
    catches: 'a day still running is compared against a closed window', run: true },

  { name: 'X11 the watch asks for the day before yesterday',
    anchor: 'const YESTERDAY = new Date(Date.now() - 86400000).toISOString().slice(0, 10);',
    replace: 'const YESTERDAY = new Date(Date.now() - 2 * 86400000).toISOString().slice(0, 10);',
    catches: 'the diagnostic and the stored reading carry the wrong day', run: true },

  { name: 'X12 the reading is not written to the series',
    anchor: "writeFileSync(SERIES, JSON.stringify(series.slice(-90), null, 2) + '\\n');\n",
    replace: '',
    catches: 'the next run has no baseline and every window after this one is no-data', run: true },

  { name: 'X13 the reading is stored without its ledger',
    anchor: 'series.push(reading);',
    replace: 'series.push({ ...reading, ledger_month_used: null });',
    catches: 'the next window has no ledger baseline and fails ledger-unreadable on every healthy run', run: true },

  { name: 'X14 the series keeps only the last row',
    anchor: 'series.slice(-90)',
    replace: 'series.slice(-1)',
    catches: 'the history every other watch reads is truncated to one row', run: true },

  { name: 'X15 the window tolerance follows the ledger instead of the vendor',
    anchor: '  const window = residualVerdict(vd.vendorDay, lw.ledgerWindow, knownCI);',
    replace: '  const window = (() => { const r = residualVerdict(vd.vendorDay, lw.ledgerWindow, knownCI); return { ...r, tol: toleranceFor(lw.ledgerWindow) }; })();',
    catches: 'the allowance shrinks as the ledger under-reports, so the worse the defect the easier it passes' },

  { name: 'X16 the vendor window line is dropped from the log',
    anchor: "  L.push(`  vendor billed in the window : ${j.vd.vendorDay}   (${j.vd.hours} h between the two readings)`);\n",
    replace: '',
    catches: 'the first operand of the verdict cannot be read off the log' },

  { name: 'X17 the known CI line is dropped from the log',
    anchor: "  L.push(`  known CI spend              : ${ci.credits}   (${ci.runs} run(s), ${ci.undated} undated)`);\n",
    replace: '',
    catches: 'the subtracted operand cannot be read off the log' },

  { name: 'X18 the daily counter line is dropped from the log',
    anchor: "  L.push(`  our daily counter (UTC day) : ${curr.day_used}`);\n",
    replace: '',
    catches: 'the diagnostic residual is printed with no operand' },

  { name: 'X19 the monthly ledger reading is not printed',
    anchor: "say(`  our monthly ledger now : ${reading.ledger_month_used}`);\n",
    replace: '',
    catches: 'the stored ledger value is not in the log', run: true },

  { name: 'X20 a fall of up to 99 in the ledger is tolerated',
    anchor: "  if (delta < 0) return { state: 'ledger-went-backwards', delta };",
    replace: "  if (delta < -99) return { state: 'ledger-went-backwards', delta };",
    catches: 'a small bad reading is differenced as negative spend' },

  { name: 'X21 a non-finite ledger is accepted',
    anchor: " || !Number.isFinite(p) || !Number.isFinite(c)) {",
    replace: ") {",
    catches: 'NaN and Infinity pass the number check' },
];


let caught = 0, skipped = 0;
for (const mut of MUTATIONS) {
  if (mut.run && !WITH_RUN) { skipped++; console.log(`SKIPPED    ${mut.name}  (only the run check can see it: pass --with-run)`); continue; }
  const original = fs.readFileSync(WATCH, 'utf8');
  const hits = original.split(mut.anchor).length - 1;
  if (hits !== 1) {
    console.log(`FAIL       ${mut.name}\n            anchor matched ${hits} times, expected 1 — NOTHING MUTATED.`);
    continue;
  }
  fs.writeFileSync(WATCH, original.replace(mut.anchor, mut.replace));
  if (fs.readFileSync(WATCH, 'utf8') === original) {
    console.log(`FAIL       ${mut.name}\n            file unchanged — NOTHING MUTATED.`);
    continue;
  }
  const bySelf = spawnSync('node', SELF, { stdio: 'ignore' }).status !== 0;
  const byRun = WITH_RUN && spawnSync('node', RUN, { stdio: 'ignore' }).status !== 0;
  fs.writeFileSync(WATCH, original);
  const red = bySelf || byRun;
  console.log(`${red ? 'CAUGHT    ' : 'NOT CAUGHT'} ${mut.name}${red ? `  [${bySelf ? 'self-test' : ''}${bySelf && byRun ? ' + ' : ''}${byRun ? 'run check' : ''}]` : ''}\n            (${mut.catches})`);
  if (red) caught++;
}

console.log(`\n${caught} of ${MUTATIONS.length - skipped} mutations caught${skipped ? ` (${skipped} more need --with-run and were NOT run)` : ''}.`);
console.log(`COVERAGE: the pure functions (self-test)${WITH_RUN ? ' and the whole run against a STUB relay that speaks the routes\' real shapes (run check)' : '; the run check was NOT part of this run (no --with-run)'}.`);
console.log(`It does NOT exercise the real /budget/odds, the real D1 read or the committed series —`);
console.log(`sandbox egress to the relay is blocked, and dispatching the workflow splits the next`);
console.log(`vendor window, so those are verified by the next scheduled run.`);
process.exit(caught === MUTATIONS.length - skipped ? 0 : 1);
