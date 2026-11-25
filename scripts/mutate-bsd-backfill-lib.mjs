#!/usr/bin/env node
// Mutation harness for scripts/bsd-backfill-lib.mjs and its check (CLAUDE.md Rule 90): break each rule on purpose, run the check on the broken
// copy, require it to go red. The harness distrusts itself first: every anchor must occur exactly once, every mutant must parse, and the
// unmodified copy and a comment-only copy must pass with at least MIN_ASSERTIONS assertions. CAUGHT = the check exits non-zero.
//
// EQUIVALENT (not mutated, with the reason): the 86400000 step in daysBetween: adding or removing a millisecond per day never changes a
// date's first ten characters inside the 400-day limit, so no input separates it.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const MIN_ASSERTIONS = 56;
const dir = path.dirname(fileURLToPath(import.meta.url));
const LIB = 'bsd-backfill-lib.mjs', CHECK = 'check-bsd-backfill-lib.mjs';
const lib = fs.readFileSync(path.join(dir, LIB), 'utf8');
const check = fs.readFileSync(path.join(dir, CHECK), 'utf8');
const M = (name, anchor, replacement) => ({ name, anchor, replacement });
const MUTANTS = [
  M('daysBetween: a backwards range accepted', ' || from > to) return null;', ') return null;'),
  M('daysBetween: the last day left out', 't <= Date.parse(', 't < Date.parse('),
  M('daysBetween: no limit', 'if (out.length > maxDays) return null;', ''),
  M('daysBetween: no calendar round trip', " && new Date(`${d}T00:00:00Z`).toISOString().slice(0, 10) === d;", ';'),
  M('rowsOfDay: ok not required', 'json.ok !== true || ', ''),
  M('rowsOfDay: postseason dropped', 'post === undefined ? json.games.regular : json.games.regular.concat(post)', 'json.games.regular'),
  M('rowsOfDay: a postseason that is not a list accepted', 'if (post !== undefined && !Array.isArray(post)) return null;', ''),
  M('rowsOfDay: regular not required to be a list', ' || !Array.isArray(json.games.regular)) return null;', ') return null;'),
  M('splitRows: the tables swapped', 'return { regular: json.games.regular, postseason: json.games.postseason === undefined ? [] : json.games.postseason };', 'return { regular: json.games.postseason === undefined ? [] : json.games.postseason, postseason: json.games.regular };'),
  M('splitRows: a read that is not the contract is split anyway', 'if (rowsOfDay(json) === null) return null;\n  return { regular', 'return { regular'),
  M('pendingOf: every sport counts', ' || !sports.includes(r.sport)) continue;', ') continue;'),
  M('pendingOf: an empty id is an id', " || String(r.bsd_event_id) === '')", ')'),
  M('pendingOf: an absent id is an id', 'r.bsd_event_id === undefined || ', ''),
  M('pendingOf: a null id is an id', 'r.bsd_event_id === null || ', ''),
  M('pendingOf: soccer rows not counted', '    soccer++;\n', ''),
  M('isStuck: an attempt is stuck whatever is pending', "return Object.keys(pendingBySport).every((s) => asked.includes(s));", 'return true;'),
  M('isStuck: some sport asked is enough', "return Object.keys(pendingBySport).every((s) => asked.includes(s));", 'return Object.keys(pendingBySport).some((s) => asked.includes(s));'),
  M('isStuck: nothing is ever stuck', "return Object.keys(pendingBySport).every((s) => asked.includes(s));", 'return false;'),
  M('isStuck: an attempt without sports asked about every sport', "Array.isArray(attempt.sports) ? attempt.sports : LEGACY_ATTEMPT_SPORTS;", "Array.isArray(attempt.sports) ? attempt.sports : Object.keys(pendingBySport);"),
  M('isStuck: a recorded list is added to the legacy one', "Array.isArray(attempt.sports) ? attempt.sports : LEGACY_ATTEMPT_SPORTS;", "Array.isArray(attempt.sports) ? attempt.sports.concat(LEGACY_ATTEMPT_SPORTS) : LEGACY_ATTEMPT_SPORTS;"),
  M('isStuck: an attempt that is not an object is stuck', "if (!isObj(attempt) || !isObj(pendingBySport)) return false;", "if (!isObj(pendingBySport)) return true;"),
  M('isStuck: a pending map that is not an object is stuck', "if (!isObj(attempt) || !isObj(pendingBySport)) return false;", "if (!isObj(attempt)) return false;"),
  M('LEGACY_ATTEMPT_SPORTS: the list follows the join (UEFA added)', "export const LEGACY_ATTEMPT_SPORTS = ['MLS', 'EPL', 'La Liga', 'Serie A', 'Bundesliga', 'Ligue 1'];", "export const LEGACY_ATTEMPT_SPORTS = ['MLS', 'EPL', 'La Liga', 'Serie A', 'Bundesliga', 'Ligue 1', 'UEFA Champions League', 'EFL Championship'];"),
  M('planDates: unsorted', '[...survey.keys()].sort()', '[...survey.keys()]'),
  M('planDates: a clean day is chosen', 'survey.get(d).pending > 0)', 'survey.get(d).pending >= 0)'),
  M('planDates: no limit', 'withWork.slice(0, maxDates)', 'withWork'),
  M('planDates: remaining ignores the chosen', 'remainingAfter: withWork.length - chosen.length', 'remainingAfter: withWork.length'),
  M('planDates: complete with work left', 'withWork.length === 0 && unread.length === 0 && days.length > 0', 'unread.length === 0 && days.length > 0'),
  M('planDates: complete with an unread day', 'withWork.length === 0 && unread.length === 0 && days.length > 0', 'withWork.length === 0 && days.length > 0'),
  M('planDates: complete on nothing surveyed', 'withWork.length === 0 && unread.length === 0 && days.length > 0', 'withWork.length === 0 && unread.length === 0'),
  M('outcomeOf: a 403 is not a refusal', 'resp.status === 401 || resp.status === 403', 'resp.status === 401'),
  M('outcomeOf: a 429 is not a throttle', "if (resp.status === 429) return 'throttled';", ''),
  M('outcomeOf: ok false is not failed', "if (resp.ok !== true) return 'failed';", ''),
  M('outcomeOf: nothing pending not named', "if (resp.pending === 0) return 'nothing-pending';", ''),
  M('outcomeOf: a zero write is a join', 'resp.written > 0', 'resp.written >= 0'),
  M('outcomeOf: no events is events', 'resp.eventsRead > 0', 'resp.eventsRead >= 0'),
  M('verifyOf: the wrong expectation', 'const expected = pendingBefore - written;', 'const expected = pendingBefore + written;'),
  M('verifyOf: a negative count accepted', 'Number.isInteger(n) && n >= 0', 'Number.isInteger(n)'),
  M('verifyOf: fewer than expected accepted', 'pendingAfter === expected ?', 'pendingAfter <= expected ?'),
  M('stopAfter: a refusal does not stop', "if (last === 'refused') return 'the route refused the secret';", ''),
  M('stopAfter: a throttle does not stop', "if (last === 'throttled') return 'the route answered 429';", ''),
  M('stopAfter: a mismatch does not stop', 'if (verified === false) return', 'if (verified === 0) return'),
  M('stopAfter: an unverified pass is a mismatch', 'if (verified === false) return', 'if (verified !== true) return'),
  M('stopAfter: two failures do not stop', "if (outcomes.length >= 2 && outcomes[outcomes.length - 2] === 'failed' && last === 'failed') return 'two failed passes in a row';", ''),
  M('stopAfter: one failure stops', "outcomes.length >= 2 && outcomes[outcomes.length - 2] === 'failed' && last === 'failed'", "last === 'failed'"),
  M('stopAfter: the cap is exclusive', 'pagesUsed >= pageCap &&', 'pagesUsed > pageCap &&'),
  M('stopAfter: the cap stops the last date too', 'pagesUsed >= pageCap && remaining > 0', 'pagesUsed >= pageCap'),
];

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bsd-backfill-mutate-'));
fs.writeFileSync(path.join(tmp, CHECK), check);
function runWith(text) {
  fs.writeFileSync(path.join(tmp, LIB), text);
  const parse = spawnSync(process.execPath, ['--check', path.join(tmp, LIB)], { encoding: 'utf8' });
  if (parse.status !== 0) return { invalid: true, detail: (parse.stderr || '').split('\n').slice(0, 3).join(' | ') };
  const r = spawnSync(process.execPath, [path.join(tmp, CHECK)], { encoding: 'utf8', timeout: 30000 });
  return { status: r.status, out: `${r.stdout}${r.stderr}`, timedOut: r.error !== undefined && r.error.code === 'ETIMEDOUT' };
}
let bad = 0; const problems = [];
const clean = runWith(lib);
const m = clean.invalid ? null : /^ok (\d+) assertions/m.exec(clean.out);
if (clean.invalid || clean.status !== 0 || m === null || Number(m[1]) < MIN_ASSERTIONS) { bad++; problems.push(`CONTROL unmodified copy did not pass with at least ${MIN_ASSERTIONS} assertions: ${clean.invalid ? clean.detail : clean.out.slice(0, 300)}`); }
const comment = runWith(`${lib}\n// harmless\n`);
if (comment.invalid || comment.status !== 0) { bad++; problems.push('CONTROL a comment-only change turned the check red'); }
let caught = 0;
for (const mu of MUTANTS) {
  const count = lib.split(mu.anchor).length - 1;
  if (count !== 1) { console.error(`ANCHOR for "${mu.name}" occurs ${count} times, not once`); process.exit(2); }
  const mutated = lib.replace(mu.anchor, () => mu.replacement);
  if (mutated === lib) { console.error(`mutant "${mu.name}" did not change the text`); process.exit(2); }
  const r = runWith(mutated);
  if (r.invalid) { console.error(`mutant "${mu.name}" does not parse: ${r.detail}`); process.exit(2); }
  const crashed = r.status !== 0 && !/FAIL /.test(r.out);
  if (r.status !== 0 && !r.timedOut) { caught++; console.log(`CAUGHT   ${mu.name}${crashed ? '  (crash)' : ''}`); }
  else { bad++; problems.push(`NOT CAUGHT ${mu.name}`); console.log(`NOT CAUGHT ${mu.name}`); }
}
console.log(`\n${caught} of ${MUTANTS.length} mutations caught; controls ${clean.status === 0 && comment.status === 0 ? 'ok' : 'FAILED'}; ${MIN_ASSERTIONS} assertions required of the clean copy`);
if (bad) { console.log(problems.join('\n')); process.exit(1); }
