#!/usr/bin/env node
/**
 * Rule 90 for scripts/check-odds-backfill-sport-filter.mjs.
 *
 * Each mutation changes ONE thing in a copy of src/index.js (the row filter on one table, the column it reads, the route's
 * handoff, the refusal of a bad label, the answer's echo, the cron's call) and aims the check at the copy through INDEX_SRC.
 * The check must go red for every one. A mutant counts as CAUGHT only when an assertion failed ("N of M passed." with N < M and a
 * FAIL line): a crash or a syntax error proves nothing about what the check asserts and is reported as a harness error. A
 * mutation whose anchor is missing or not unique applies NOTHING, so each fails the harness by name instead of passing quietly.
 */
import { readFileSync, writeFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, resolve, dirname } from 'node:path';

const INDEX = 'src/index.js';
const original = readFileSync(INDEX, 'utf8');
const born = [];
const place = (text, tag) => {
  const p = join(dirname(INDEX), `.mutant-${tag}-${Math.random().toString(36).slice(2, 8)}.js`);
  writeFileSync(p, text); born.push(p); return resolve(p);
};
process.on('exit', () => { for (const p of born) rmSync(p, { force: true }); });
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => process.exit(130));

// 'pass' | 'red' (an assertion failed) | 'error' (anything else).
const run = (indexSrc) => {
  let out = '', code = 0;
  try {
    out = execFileSync(process.execPath, ['scripts/check-odds-backfill-sport-filter.mjs'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, INDEX_SRC: indexSrc } });
  } catch (e) { out = String(e.stdout === undefined ? '' : e.stdout); code = e.status === undefined ? 1 : e.status; }
  const m = /^(\d+) of (\d+) passed\.$/m.exec(out);
  if (code === 0) return m && m[1] === m[2] ? 'pass' : 'error';
  return m && Number(m[1]) < Number(m[2]) && /^FAIL  /m.test(out) ? 'red' : 'error';
};

if (run(resolve(INDEX)) !== 'pass') { console.log('FAIL: the check is already red on clean source.'); process.exit(1); }
if (run(place(original, 'control')) !== 'pass') {
  console.log('FAIL: an UNMUTATED copy at the mutant location is red, so no verdict below would mean anything.');
  process.exit(1);
}
console.log('baseline: the check passes on current source and on an unmutated copy at the mutant location\n');

const RS = "  const rsPicked = wantSport === null ? rsRows : rsRows.filter(r => String(r.sport).toLowerCase() === wantSport);";
const PS = "  const psPicked = wantSport === null ? psRows : psRows.filter(r => String(r.sport).toLowerCase() === wantSport);";
const GATE_ARG = "runOddsBackfillForDate(env, date, 'archiveOddsBackfill', q.sport, q.snapshot)";
const SPORT_GATE = "if (sport !== null && typeof archiveSportToOddsKey(sport) !== 'string') return refuse(";
const SNAP_GATE = "if (snapshot !== null && !/^([01]\\d|2[0-3]):[0-5]\\d$/.test(snapshot)) return refuse(";
const SIG = "async function runOddsBackfillForDate(env, isoDate, site = 'fetchSportOddsHistorical', onlySport = null, snapshotTime = ODDS_HIST_SNAPSHOT_DEFAULT) {";
const ZERO = "    return { ok: true, date: isoDate, ...echo, games_found: 0, odds_populated: 0, odds_skipped: 0 };";
const GUARDED_COUNT = "    if (!ok) { oddsSkipped += group.rs.length + group.ps.length; if (guarded) oddsGuarded++; continue; }";
const LATE = "        if (kickoffMark(odds.captured_at, row.start_time).late_minutes !== null\n            || kickoffMark(odds.captured_at, og.commence_time).late_minutes !== null) { oddsSkipped++; continue; }\n";
const FETCH_CALL = "= await fetchSportOddsHistorical(env, sportKey, isoDate, site, snapshotTime);\n";
const SNAP_ECHO = "...(snapshotTime === ODDS_HIST_SNAPSHOT_DEFAULT ? {} : { snapshot: snapshotTime })";

const MUTANTS = [
  ['F1 the filter is ignored on the regular-season rows', RS, "  const rsPicked = rsRows;"],
  ['F2 the filter is ignored on the postseason rows', PS, "  const psPicked = psRows;"],
  ['F3 the filter reads the league column, not the sport, on the regular-season rows', RS, RS.replace('r.sport', 'r.league')],
  ['F4 the filter is inverted: every sport but the one asked for', RS, RS.replace('=== wantSport', '!== wantSport')],
  ['F5 the route does not hand the sport to the function', GATE_ARG, "runOddsBackfillForDate(env, date, 'archiveOddsBackfill', null, q.snapshot)"],
  ['F6 a label with no Odds-API key is accepted', SPORT_GATE, "if (false) return refuse("],
  ['F7 an empty ?sport= is read as "no filter" and not refused', SPORT_GATE, "if (sport && sport !== null && typeof archiveSportToOddsKey(sport) !== 'string') return refuse("],
  ['F8 the answer does not say which sport it covered', "    ...echo,\n    games_found: gamesFound,\n", "    games_found: gamesFound,\n"],
  ['F9 the daily catch-up call is narrowed to one sport', "runOddsBackfillForDate(env, oddsDate)", "runOddsBackfillForDate(env, oddsDate, 'fetchSportOddsHistorical', 'EPL')"],
  ['F10 the route does not apply the refusal', "                if (q.refusal) return q.refusal;\n", ""],
  ['F11 the filter reads the league column, not the sport, on the postseason rows', PS, PS.replace('r.sport', 'r.league')],
  ['F12 no postseason row is ever picked when a sport is asked for', PS, "  const psPicked = wantSport === null ? psRows : [];"],
  ['F13 the filter is case-sensitive again (the lookup and the bucketing below it are not)', RS, "  const rsPicked = wantSport === null ? rsRows : rsRows.filter(r => r.sport === onlySport);"],
  ['F14 the name of an Object property passes the refusal (the lookup is a plain object)', SPORT_GATE, "if (sport !== null && !archiveSportToOddsKey(sport)) return refuse("],
  ['F15 a date with no rows of the sport does not say which sport it covered', ZERO, ZERO.replace('...echo, ', '')],
  ['F16 a fetch the credit guard declined is not counted', GUARDED_COUNT, GUARDED_COUNT.replace(' if (guarded) oddsGuarded++;', '')],
  ['F17 the function\'s own default narrows the cron to one sport', SIG, SIG.replace('onlySport = null', "onlySport = 'EPL'")],
  ['F18 the answer never reports the guard', "    guarded: oddsGuarded || undefined,\n", ""],
  ['F19 a snapshot served after kickoff is priced as an opener', LATE, ""],
  ['F20 the route does not hand the snapshot to the function', GATE_ARG, "runOddsBackfillForDate(env, date, 'archiveOddsBackfill', q.sport, undefined)"],
  ['F21 a bad ?snapshot= is not refused', SNAP_GATE, "if (false) return refuse("],
  ['F22 the snapshot check accepts 25:00 and 09:60 (digits only)', "/^([01]\\d|2[0-3]):[0-5]\\d$/", "/^\\d\\d:\\d\\d$/"],
  ['F23 the fetch builds its URL with noon whatever it was asked', "const snapshot = `${isoDate}T${snapshotTime}:00Z`;", "const snapshot = `${isoDate}T12:00:00Z`;"],
  ['F24 the backfill loop does not pass the snapshot to the fetch', FETCH_CALL, FETCH_CALL.replace(', snapshotTime', '')],
  ['F25 the answer does not say which snapshot it asked for', SNAP_ECHO, "...{}"],
  ['F26 the default snapshot moves off noon (every existing caller moves with it)', "const ODDS_HIST_SNAPSHOT_DEFAULT = '12:00';", "const ODDS_HIST_SNAPSHOT_DEFAULT = '10:00';"],
  ['F27 the query helper drops the snapshot it parsed', "return { sport, snapshot: snapshot === null ? undefined : snapshot };", "return { sport, snapshot: undefined };"],
];

let missed = 0, nothing = 0, errored = 0;
for (const [name, anchor, repl] of MUTANTS) {
  const count = original.split(anchor).length - 1;
  if (count !== 1) { nothing++; console.log(`NOTHING MUTATED  ${name}\n        the anchor occurs ${count} times in ${INDEX}, not once`); continue; }
  const text = original.replace(anchor, () => repl);
  if (text === original) { nothing++; console.log(`NOTHING MUTATED  ${name}`); continue; }
  const verdict = run(place(text, name.slice(0, 2).trim()));
  const label = verdict === 'red' ? 'CAUGHT    ' : verdict === 'pass' ? 'NOT CAUGHT' : 'HARNESS ERROR (no assertion failed; a crash is not a catch)';
  console.log(`${label}  ${name}`);
  if (verdict === 'pass') missed++;
  if (verdict === 'error') errored++;
}
const caughtN = MUTANTS.length - missed - nothing - errored;
console.log(`\nmutations: ${caughtN} of ${MUTANTS.length} caught${missed ? `, ${missed} SURVIVED` : ''}${errored ? `, ${errored} harness error(s)` : ''}${nothing ? `, ${nothing} not applied` : ''}`);
console.log('COVERAGE: the snapshot parameter (handoff, validation, its regex, the URL, the echo, the default) and the filter on each table and the column it reads, its direction and its case, the route\'s handoff, the refusal of a bad, empty or Object-property label, the answer\'s echo (also on a date with no rows) and its guard flag, the cron\'s call and default, and the late-snapshot skip, mutated in a copy of src/index.js.');
console.log('NOT mutated here: the gate (scripts/check-odds-label-split.mjs), the credit guard itself and the match itself (src/odds-join.js): this check proves the join on one vendor slate with decoys, not every slate.');
process.exit(missed || nothing || errored ? 1 : 0);
