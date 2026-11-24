#!/usr/bin/env node
/**
 * Rule 90 for scripts/check-afl-round-discovery.mjs.
 *
 * Each mutation changes ONE thing in a copy of src/wp-resolver.js (the request shape, the window's two ends, the order the
 * reads run in, the cache, the timeout, each warning, the failed-day handling, the scan order, the week test, the team
 * sides, the year, the round) and aims the check at the copy through WP_RESOLVER_SRC. The check must go red for every one.
 * A mutant counts as CAUGHT only when an assertion failed ("N of M passed." with N < M and a FAIL line): a crash or a syntax
 * error proves nothing about what the check asserts and is reported as a harness error. A mutation whose anchor is missing
 * or not unique applies NOTHING, so each fails the harness by name instead of passing quietly.
 */
import { readFileSync, writeFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, resolve, dirname } from 'node:path';

const SRC = 'src/wp-resolver.js';
const original = readFileSync(SRC, 'utf8');
const born = [];
const place = (text, tag) => {
  const p = join(dirname(SRC), `.mutant-${tag}-${Math.random().toString(36).slice(2, 8)}.js`);
  writeFileSync(p, text); born.push(p); return resolve(p);
};
process.on('exit', () => { for (const p of born) rmSync(p, { force: true }); });
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => process.exit(130));

// 'pass' | 'red' (an assertion failed) | 'error' (anything else).
const run = (src) => {
  let out = '', code = 0;
  try {
    out = execFileSync(process.execPath, ['scripts/check-afl-round-discovery.mjs'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, WP_RESOLVER_SRC: src } });
  } catch (e) { out = String(e.stdout === undefined ? '' : e.stdout); code = e.status === undefined ? 1 : e.status; }
  const m = /^(\d+) of (\d+) passed\.$/m.exec(out);
  if (code === 0) return m && m[1] === m[2] ? 'pass' : 'error';
  return m && Number(m[1]) < Number(m[2]) && /^FAIL  /m.test(out) ? 'red' : 'error';
};

if (run(resolve(SRC)) !== 'pass') { console.log('FAIL: the check is already red on clean source.'); process.exit(1); }
if (run(place(original, 'control')) !== 'pass') {
  console.log('FAIL: an UNMUTATED copy at the mutant location is red, so no verdict below would mean anything.');
  process.exit(1);
}
console.log('baseline: the check passes on current source and on an unmutated copy at the mutant location\n');

const URL_LINE = "const url = `${ESPN_SCOREBOARD_BASE}/sports/australian-football/afl/scoreboard?dates=${day}`;";
const FETCH = "const r = await fetch(url, { headers: ESPN_SUMMARY_HEADERS, signal: AbortSignal.timeout(5000) });";
const NOT_OK = "if (!r.ok) { console.warn(`[AFL-ROUND] ESPN answered ${r.status} for ${day}`); return null; }";
const NO_EVENTS = "console.warn(`[AFL-ROUND] ESPN body for ${day} has no events array`); return null;";
const CATCH = "console.warn(`[AFL-ROUND] ESPN read failed for ${day}: ${e && e.message}`);\n";
const NONE = "if (answered === 0) console.warn(";
const SKIP = "if (d === null) continue;";
const SCAN = "for (let i = 0; i < slates.length; i++) {";
const SIDES = "if (teamNameMatch(predictedWinner, homeN) || teamNameMatch(predictedWinner, awayN)) {";
const WEEK = "const round = ev?.week?.number ?? null;";
const RET = "return { round, year: now.getUTCFullYear() };";
const PAR_OPEN = "const slates = await Promise.all(days.map(async (day) => {";
const PAR_CLOSE = "    }));\n    const answered";
const TRY_OPEN = "        try {\n            for (const ev of d.events) {";
const TRY_CLOSE = "        } catch (e) {\n            console.warn(`[AFL-ROUND] ESPN body for ${days[i]} could not be read: ${e && e.message}`);\n        }\n";

// Each mutant: [name, [[anchor, replacement], ...]]; every anchor must occur exactly once.
const MUTANTS = [
  ['A1 the request is a date RANGE again (the defect)', [[URL_LINE, "const url = `${ESPN_SCOREBOARD_BASE}/sports/australian-football/afl/scoreboard?dates=${days[0]}-${days[days.length - 1]}`;"]]],
  ['A2 the window loses its first day (-3d becomes -2d)', [['const AFL_ROUND_DAYS_BACK = 3;', 'const AFL_ROUND_DAYS_BACK = 2;']]],
  ['A3 the window loses its last day (+6d becomes +5d)', [['const AFL_ROUND_DAYS_FORWARD = 6;', 'const AFL_ROUND_DAYS_FORWARD = 5;']]],
  ['A4 the window gains a day before (-4d)', [['const AFL_ROUND_DAYS_BACK = 3;', 'const AFL_ROUND_DAYS_BACK = 4;']]],
  ['A5 the window gains a day after (+7d)', [['const AFL_ROUND_DAYS_FORWARD = 6;', 'const AFL_ROUND_DAYS_FORWARD = 7;']]],
  ['A6 the reads run one after another, not together', [[PAR_OPEN, "const slates = []; for (const day of days) slates.push(await (async () => {"], [PAR_CLOSE, "    })());\n    const answered"]]],
  ['A7 the reads are edge-cached for five minutes (an entry /v2/games would then serve stale)', [[FETCH, "const r = await fetch(url, { headers: ESPN_SUMMARY_HEADERS, signal: AbortSignal.timeout(5000), cf: { cacheTtl: 300, cacheEverything: true, cacheKey: url } });"]]],
  ['A8 the reads have no timeout', [[FETCH, "const r = await fetch(url, { headers: ESPN_SUMMARY_HEADERS });"]]],
  ['A9 a refused day is not warned', [[NOT_OK, "if (!r.ok) return null;"]]],
  ['A10 a day that throws is not warned', [[CATCH, ""]]],
  ['A11 every day refused is not warned as "none answered"', [[NONE, "if (false) console.warn("]]],
  ['A12 one failed day ends the search', [[SKIP, "if (d === null) return null;"]]],
  ['A13 the LAST matching game wins, not the earliest', [[SCAN, "for (let i = slates.length - 1; i >= 0; i--) {"]]],
  ['A14 an event with no week number is taken', [[WEEK + "\n                if (round === null) continue;", WEEK]]],
  ['A15 a missing week number defaults to round 1', [[WEEK, "const round = ev?.week?.number ?? 1;"]]],
  ['A16 only the home side is matched', [[SIDES, "if (teamNameMatch(predictedWinner, homeN)) {"]]],
  ['A17 the year is last year', [[RET, "return { round, year: now.getUTCFullYear() - 1 };"]]],
  ['A18 the round is off by one', [[RET, "return { round: round + 1, year: now.getUTCFullYear() };"]]],
  ['A19 the days are hours apart, not days', [["new Date(now.getTime() + k * 86400000)", "new Date(now.getTime() + k * 3600000)"]]],
  ['A20 a 400 is read as a slate (its body parsed as events)', [[NOT_OK, "if (!r.ok && r.status !== 400) { console.warn(`[AFL-ROUND] ESPN answered ${r.status} for ${day}`); return null; }"]]],
  ['A21 the timeout is a minute, not five seconds', [[FETCH, "const r = await fetch(url, { headers: ESPN_SUMMARY_HEADERS, signal: AbortSignal.timeout(60000) });"]]],
  ['A22 the browser-style headers are dropped', [[FETCH, "const r = await fetch(url, { signal: AbortSignal.timeout(5000) });"]]],
  ['A23 an extra query parameter rides on every read', [[URL_LINE, "const url = `${ESPN_SCOREBOARD_BASE}/sports/australian-football/afl/scoreboard?dates=${day}&limit=1`;"]]],
  ['A24 the round is read from the top-level week before the event', [[WEEK, "const round = d.week?.number ?? ev?.week?.number ?? null;"]]],
  ['A25 "none answered" fires when half or fewer answered', [[NONE, "if (answered <= 5) console.warn("]]],
  ['A26 a body with no events array is not warned', [[NO_EVENTS, "return null;"]]],
  ['A27 an unreadable day body is not caught: the exception ends the search', [[TRY_OPEN, "        {\n            for (const ev of d.events) {"], [TRY_CLOSE, "        }\n"]]],
  ['A29 round 0 is read as no round again (!round)', [["if (round === null) continue;", "if (!round) continue;"]]],
  ['A28 an unreadable day body is caught but not warned', [["console.warn(`[AFL-ROUND] ESPN body for ${days[i]} could not be read: ${e && e.message}`);\n", ""]]],
];

let missed = 0, nothing = 0, errored = 0;
for (const [name, edits] of MUTANTS) {
  let text = original, bad = null;
  for (const [anchor, repl] of edits) {
    const count = text.split(anchor).length - 1;
    if (count !== 1) { bad = `the anchor occurs ${count} times in ${SRC}, not once: ${JSON.stringify(anchor.slice(0, 70))}`; break; }
    text = text.replace(anchor, () => repl);
  }
  if (bad === null && text === original) bad = 'the replacement equals the anchor';
  if (bad !== null) { nothing++; console.log(`NOTHING MUTATED  ${name}\n        ${bad}`); continue; }
  const verdict = run(place(text, name.slice(0, 3).trim()));
  const label = verdict === 'red' ? 'CAUGHT    ' : verdict === 'pass' ? 'NOT CAUGHT' : 'HARNESS ERROR (no assertion failed; a crash is not a catch)';
  console.log(`${label}  ${name}`);
  if (verdict === 'pass') missed++;
  if (verdict === 'error') errored++;
}
const caughtN = MUTANTS.length - missed - nothing - errored;
console.log(`\nmutations: ${caughtN} of ${MUTANTS.length} caught${missed ? `, ${missed} SURVIVED` : ''}${errored ? `, ${errored} harness error(s)` : ''}${nothing ? `, ${nothing} not applied` : ''}`);
console.log('COVERAGE: the request shape (range vs day, an extra parameter, the headers), both ends of the window and a day beyond each, parallel vs sequential reads, an edge-cache option, the timeout and its value, each of the warnings, failed-day handling and an unreadable body, how many days must answer before "none answered" is said, scan order, the week-number test, its default and the top-level week, which sides of a game are matched, the year and the round returned, and a 400 read as a slate, mutated in a copy of src/wp-resolver.js.');
console.log('NOT mutated here: the Squiggle/Kali half of the AFL branch, teamNameMatch, and the real ESPN payload (.github/workflows/afl-round-live-check.yml).');
process.exit(missed || nothing || errored ? 1 : 0);
