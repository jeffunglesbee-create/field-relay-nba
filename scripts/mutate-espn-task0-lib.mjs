#!/usr/bin/env node
// Mutation harness for scripts/espn-task0-lib.mjs and its check (CLAUDE.md Rule 90): break each rule on purpose, run the check on the
// broken copy, and require it to go red. A check that has only ever passed has proven nothing.
//
// The harness distrusts itself first:
//   - every anchor must occur EXACTLY once in the library text, or the run stops (a mutant that applied nowhere would print "not caught"
//     and be read as a weak check, or print nothing and be read as a strong one);
//   - every mutated copy must still parse (a syntax error makes any check go red, so it would count as "caught" for the wrong reason);
//   - the unmodified copy and a comment-only copy must PASS with at least MIN_ASSERTIONS assertions (a check that is red or empty on
//     clean source catches everything).
// A mutant is CAUGHT when the check exits non-zero on it. A crash counts, and is reported as a crash.
//
// EQUIVALENT (not mutated, with the reason):
//   - reachEach's own slug test: the slug reaches only zeroReason, which compares it for equality with three exact names, so a slug that is not safe
//     and a '(other)' behave alike.
//   - the `out.zero === reasons` and `out.one === ...` terms of `partitions` are guards that hold by construction of the loop above them,
//     so no input can make them differ; they are kept as a tripwire against a later edit.
//   - the `out.one + out.many === out.espnIds...` term of `partitions`: the same kind of guard, true by construction of the block above it.
//   - dayOf's leading /^\d{4}-\d{2}-\d{2}/ test: the calendar round trip after it (`toISOString().slice(0, 10) !== d`) already forces the
//     first ten characters to be exactly a real YYYY-MM-DD, so removing the test changes no result (found by this harness: the mutant
//     survived, and no input separates it).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const MIN_ASSERTIONS = 81;
const dir = path.dirname(fileURLToPath(import.meta.url));
const LIB = 'espn-task0-lib.mjs';
const CHECK = 'check-espn-task0-lib.mjs';
const lib = fs.readFileSync(path.join(dir, LIB), 'utf8');
const check = fs.readFileSync(path.join(dir, CHECK), 'utf8');

const M = (name, anchor, replacement) => ({ name, anchor, replacement });
const MUTANTS = [
  M('dayOf: no calendar round trip', 'Number.isNaN(t) || new Date(t).toISOString().slice(0, 10) !== d ? null : d', 'Number.isNaN(t) ? null : d'),
  M('prevDay: the wrong length of day', 'Date.parse(`${d}T00:00:00Z`) - 86400000)', 'Date.parse(`${d}T00:00:00Z`) - 86400001)'),
  M('prevDay: the next day', 'Date.parse(`${d}T00:00:00Z`) - 86400000)', 'Date.parse(`${d}T00:00:00Z`) + 86400000)'),
  M('neededDays: without the day before', 's.add(prevDay(d));', ''),
  M('neededDays: unsorted', 'return [...s].sort();\n}\nexport function daysToRead', 'return [...s];\n}\nexport function daysToRead'),
  M('daysToRead: invalid days not filtered', 'neededDays(validDays(m.callDays))', 'neededDays(m.callDays)'),
  M('validDays: a non-string passes', 'a.filter((d) => isStr(d) && dayOf(d) === d)', 'a.filter((d) => dayOf(d) === d)'),
  M('rowsOfDay: ok not required', '!isObj(json) || json.ok !== true || ', '!isObj(json) || '),
  M('rowsOfDay: postseason dropped', 'post === undefined ? json.games.regular : json.games.regular.concat(post)', 'json.games.regular'),
  M('rowsOfDay: a postseason that is not a list accepted', 'if (post !== undefined && !Array.isArray(post)) return null;', ''),
  M('rowsOfDay: regular not required to be a list', '|| !Array.isArray(json.games.regular)) return null;', ') return null;'),
  M('labelStats: duplicates counted twice', 'if (seen.has(r.id)) { duplicates++; continue; }', 'if (seen.has(r.id)) { duplicates++; }'),
  M('labelStats: either id counts as both', 'if (b && s) e.withBoth++;', 'if (b || s) e.withBoth++;'),
  M('has: null counts as present', 'const has = (v) => v !== null && v !== undefined && String(v) !== \'\';', 'const has = (v) => v !== undefined;'),
  M('labelStats: unread days not counted', 'if (rs === null) { unreadDays++; continue; }', 'if (rs === null) { continue; }'),
  M('label: any string is a safe label', 'isStr(v) && SAFE_LABEL.test(v) ? v : \'(other)\'', 'isStr(v) ? v : \'(other)\''),
  M('proto: tallies have a prototype', 'const proto = () => Object.create(null);', 'const proto = () => ({});'),
  M('targetLabelRows: absent counts as one', 'byLabel[t] === undefined ? 0 : byLabel[t].rows', 'byLabel[t] === undefined ? 1 : byLabel[t].rows'),
  M('hitsFor: a row on two days counted twice', 'if (seen.has(r.id)) continue; seen.add(r.id); }\n      hits.push(r);', 'seen.add(r.id); }\n      hits.push(r);'),
  M('reachOf: ids compared without String()', 'String(r.bsd_event_id) !== m.key', 'r.bsd_event_id !== m.key'),
  M('reachOf: two rows read as one', 'else if (hits.length === 1)', 'else if (hits.length >= 1)'),
  M('reachOf: the first listed call day decides', 'bump(out.zeroReasons, zeroReason(slug, callDays.slice().sort()[0], boundaryDay))', 'bump(out.zeroReasons, zeroReason(slug, callDays[0], boundaryDay))'),
  M('reachEach: the first listed call day decides', 'reason: zeroReason(slug, callDays.slice().sort()[0], boundaryDay), espnId: null', 'reason: zeroReason(slug, callDays[0], boundaryDay), espnId: null'),
  M('reachOf: the boundary day is early', 'firstCallDay < boundaryDay', 'firstCallDay <= boundaryDay'),
  M('zeroReason: eflchamp not named', "if (slug === 'eflchamp') return REASONS.eflchamp;", ''),
  M('zeroReason: europa not named', "if (slug === 'ucl' || slug === 'europa') return REASONS.uefa;", "if (slug === 'ucl') return REASONS.uefa;"),
  M('reachOf: an unread day is not noticed', '!dayRows.has(d) || dayRows.get(d) === null)) { out.unread++', '!dayRows.has(d))) { out.unread++'),
  M('reachEach: an unread day (a null read) is not noticed', '!dayRows.has(d) || dayRows.get(d) === null)) return', '!dayRows.has(d))) return'),
  M('reachOf: an absent day is not noticed', '!dayRows.has(d) || dayRows.get(d) === null)) { out.unread++', 'dayRows.get(d) === null)) { out.unread++'),
  M('reachEach: an absent day is not noticed', '!dayRows.has(d) || dayRows.get(d) === null)) return', 'dayRows.get(d) === null)) return'),
  M('reachOf: one-row espn id counts swapped', 'out.oneRow.withEspnId++; else out.oneRow.withoutEspnId++;', 'out.oneRow.withoutEspnId++; else out.oneRow.withEspnId++;'),
  M('espnIds: rows that agree are a conflict', 'const ids = new Set(hits.filter((h) => has(h.espn_event_id)).map((h) => String(h.espn_event_id)));\n      const k =', 'const ids = new Set(hits.filter((h) => has(h.espn_event_id)).map((h) => h.id));\n      const k ='),
  M('espnIds: a null id counts as an id', 'const ids = new Set(hits.filter((h) => has(h.espn_event_id)).map((h) => String(h.espn_event_id)));\n      const k =', 'const ids = new Set(hits.map((h) => String(h.espn_event_id)));\n      const k ='),
  M('espnIds: none and one swapped', "ids.size === 1 ? 'one' : ids.size === 0 ? 'none' : 'conflict'", "ids.size === 1 ? 'none' : ids.size === 0 ? 'one' : 'conflict'"),
  M('espnIds: a conflict is read as one', "ids.size === 1 ? 'one' : ids.size === 0 ? 'none' : 'conflict'", "ids.size >= 1 ? 'one' : 'none'"),
  M('espnIds: not counted by slug', 'out.espnBySlug[slug][k]++;', ''),
  M('reachOf: a match with no day is a zero', 'if (callDays.length === 0) { out.noDay++', 'if (callDays.length === 99) { out.noDay++'),
  M('reachOf: a slug is used as given', "isStr(m.slug) && SAFE_SLUG.test(m.slug) ? m.slug : '(other)';\n    if (out.bySlug[slug]", "m.slug;\n    if (out.bySlug[slug]"),
  M('reachOf: days needed not collected', 'for (const d of days) allDays.add(d);', ''),
  M('BOUNDARY_DAY moved a day', "export const BOUNDARY_DAY = '2026-10-24';", "export const BOUNDARY_DAY = '2026-10-25';"),
  M('competitorsOf: a numeric team id refused', '(isStr(x.team.id) || Number.isInteger(x.team.id))', '(isStr(x.team.id))'),
  M('finalTotalOf: a negative score accepted', '|| x.score < 0)', ')'),
  M('finalTotalOf: a fractional score accepted', '|| !Number.isInteger(x.score)', ''),
  M('isCompleted: any flag but undefined', 'completed === true', 'completed !== undefined'),
  M('pickRecentFinished: the earliest', 'if (t > bestT)', 'if (t < bestT)'),
  M('pickRecentFinished: a score is not required', 'if (!isCompleted(ev) || finalTotalOf(ev) === null) continue;', 'if (!isCompleted(ev)) continue;'),
  M('inventory: one level too deep', 'depth + 1 < maxDepth', 'depth + 1 <= maxDepth'),
  M('inventory: unsafe keys listed', 'if (!SAFE_KEY.test(k)) { unsafeKeys++; continue; }', ''),
  M('inventory: a path cap that does not say so', 'if (count >= maxPaths) { truncated = true; continue; }', 'if (count >= maxPaths) { continue; }'),
  M('goalShape: any team id is a competitor', 'if (competitorIds.includes(tid)) o.teamIdIsACompetitor++;', 'o.teamIdIsACompetitor++;'),
  M('goalShape: own goal counted by key not value', 'if (r.ownGoal === true) o.ownGoalTrue++;', 'if (r.ownGoal !== undefined) o.ownGoalTrue++;'),
  M('goalShape: fewer goals than the score is "equal"', 'o.goalRows === finalTotal', 'o.goalRows <= finalTotal'),
  M('isGoalRow: scoringPlay ignored', 'r.scoringPlay === true || (isObj(r.type)', '(isObj(r.type)'),
  M('goalShape: an object clock always counts', 'isObj(r.clock) ? isStr(r.clock.displayValue) : isStr(r.clock)', 'isObj(r.clock) || isStr(r.clock)'),
  M('goalShape: clock samples not capped', 'if (o.clockSamples.length < 4) {', 'if (true) {'),
  M('goalShape: a numeric clock value dropped', "typeof c.value === 'number' && Number.isFinite(c.value) ? c.value : null", 'null'),
  M('goalShape: a display copied out unchecked', "(/^[0-9+' :.]{1,16}$/.test(dsp) ? dsp : '(other)')", 'dsp'),
  M('goalShape: type texts not counted', 'bump(o.typeTexts, label(isObj(r.type) ? r.type.text : undefined));', ''),
  M('reachEach: a conflict read as reached', "return { reached: false, reason: ids.size === 0 ? UNREACHED.noEspn : UNREACHED.conflict, espnId: null };", "return { reached: true, reason: null, espnId: [...ids][0] };"),
  M('reachEach: a conflict and no id swapped', 'ids.size === 0 ? UNREACHED.noEspn : UNREACHED.conflict', 'ids.size === 0 ? UNREACHED.conflict : UNREACHED.noEspn'),
  M('reachEach: more than one id reached', 'if (ids.size === 1) return', 'if (ids.size >= 1) return'),
  M('reachEach: an unread day read as a missing row', "if (days.some((d) => !dayRows.has(d) || dayRows.get(d) === null)) return { reached: false, reason: UNREACHED.unread, espnId: null };", ''),
  M('reachEach: a match with no day is reached', "if (callDays.length === 0) return { reached: false, reason: UNREACHED.noDay, espnId: null };", ''),
  M('reachEach: a null espn id counts as an id', 'const ids = new Set(hits.filter((h) => has(h.espn_event_id)).map((h) => String(h.espn_event_id)));\n    if (ids.size === 1) return', 'const ids = new Set(hits.map((h) => String(h.espn_event_id)));\n    if (ids.size === 1) return'),
  M('reachEach: the id of the wrong type', "return { reached: true, reason: null, espnId: [...ids][0] };", "return { reached: true, reason: null, espnId: null };"),
  M('reachEach: a missing row has no reason of its own', 'if (hits.length === 0) return { reached: false, reason: zeroReason(slug, callDays.slice().sort()[0], boundaryDay), espnId: null };', 'if (hits.length === 0) return { reached: false, reason: UNREACHED.noEspn, espnId: null };'),
  M('summaryToEspn: the details need not be a list', '!Array.isArray(c0.details) || ', ''),
  M('summaryToEspn: the competitors need not be a list', ' || !Array.isArray(c0.competitors)) return null;', ') return null;'),
  M('summaryToEspn: a competitor with no team accepted', '!isObj(c.team) || !isStr(c.team.id) || ', ''),
  M('summaryToEspn: the competitor id is used, not the team id', 'competitors.push({ id: c.team.id,', 'competitors.push({ id: c.id,'),
  M('summaryToEspn: a numeric score accepted', '!isStr(c.score) || ', ''),
  M('summaryToEspn: a score with a fraction accepted', "/^\\d{1,3}$/.test(c.score)", "/^[0-9.]{1,5}$/.test(c.score)"),
  M('summaryToEspn: the score left a string', 'score: Number(c.score) });', 'score: c.score });'),
  M('summaryEventId: the id read from the wrong place', 'json.header.id : null;', 'json.id : null;'),
  M('summaryEventId: a string id is not accepted', "if (isStr(id) && id !== '') return id;", ''),
  M('summaryEventId: an empty id is an id', "if (isStr(id) && id !== '') return id;", 'if (isStr(id)) return id;'),
  M('summaryEventId: a numeric id is not accepted', 'return Number.isInteger(id) && id >= 0 ? String(id) : null;', 'return null;'),
  M('summaryEventId: a numeric id is kept a number', 'return Number.isInteger(id) && id >= 0 ? String(id) : null;', 'return Number.isInteger(id) && id >= 0 ? id : null;'),
  M('summaryEventId: zero is an absence', 'return Number.isInteger(id) && id >= 0 ? String(id) : null;', 'return Number.isInteger(id) && id > 0 ? String(id) : null;'),
  M('summaryEventId: a fraction is an id', 'return Number.isInteger(id) && id >= 0 ? String(id) : null;', 'return typeof id === "number" && id >= 0 ? String(id) : null;'),
  M('summaryToEspn: a payload that is not an object read', 'const c0 = isObj(json) && isObj(json.header)', 'const c0 = isObj(json.header)'),
  M('summaryToEspn: the rows are replaced', 'return { rows: c0.details, competitors };', 'return { rows: [], competitors };'),
  M('registry: every sport accepted', "sport:\\s*'soccer',", "sport:\\s*'[a-z]+',"),
  M('registry: last entry wins', 'if (out[m[1]] === undefined) out[m[1]] = m[2];', 'out[m[1]] = m[2];'),
];

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'espn-task0-mutate-'));
fs.writeFileSync(path.join(tmp, CHECK), check);
function runWith(libText) {
  fs.writeFileSync(path.join(tmp, LIB), libText);
  const parse = spawnSync(process.execPath, ['--check', path.join(tmp, LIB)], { encoding: 'utf8' });
  if (parse.status !== 0) return { invalid: true, detail: (parse.stderr || '').split('\n').slice(0, 3).join(' | ') };
  const r = spawnSync(process.execPath, [path.join(tmp, CHECK)], { encoding: 'utf8', timeout: 30000 });
  return { status: r.status, out: `${r.stdout}${r.stderr}`, timedOut: r.error !== undefined && r.error.code === 'ETIMEDOUT' };
}

let bad = 0;
const problems = [];
// ---- the controls
const clean = runWith(lib);
const m = clean.invalid ? null : /^ok (\d+) assertions/m.exec(clean.out);
if (clean.invalid || clean.status !== 0 || m === null || Number(m[1]) < MIN_ASSERTIONS) { bad++; problems.push(`CONTROL unmodified copy did not pass with at least ${MIN_ASSERTIONS} assertions: ${clean.invalid ? clean.detail : clean.out.slice(0, 300)}`); }
const commentOnly = runWith(`${lib}\n// harmless\n`);
if (commentOnly.invalid || commentOnly.status !== 0) { bad++; problems.push('CONTROL a comment-only change turned the check red'); }

// ---- the mutants
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
console.log(`\n${caught} of ${MUTANTS.length} mutations caught; controls ${clean.status === 0 && commentOnly.status === 0 ? 'ok' : 'FAILED'}; ${MIN_ASSERTIONS} assertions required of the clean copy`);
if (bad) { console.log(problems.join('\n')); process.exit(1); }
