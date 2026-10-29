#!/usr/bin/env node
/**
 * Rule 90 for scripts/check-identity-route-join.mjs.
 *
 * Each mutation changes ONE thing in a copy of src/index.js (the join, the SQL, a reported field, the gate) and
 * aims the check at the copy through INDEX_SRC. The check must go red for every one. A mutant counts as CAUGHT only
 * when an assertion failed ("N of M passed." with N < M and a FAIL line): a crash or a syntax error proves nothing
 * about what the check asserts and is reported as a harness error.
 *
 * THE HARNESS'S OWN ANCHORS ARE ASSERTED. A mutation whose anchor is missing or not unique applies NOTHING, and a
 * check that is green on unmutated source would then print a pass for it. Each fails the harness by name when its
 * anchor does not occur exactly once.
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
    out = execFileSync(process.execPath, ['scripts/check-identity-route-join.mjs'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, INDEX_SRC: indexSrc } });
  } catch (e) { out = String(e.stdout || ''); code = e.status ?? 1; }
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

const JOINCALL = "const og = findOddsForRow(oddsIndex, row.home, row.away, row.start_time);\n                    if (!og) {";
const SELECT_TAIL = "FROM ${table} WHERE date = ? AND sport = ?`\n                    ).bind(date, sport).all();";
const DATE_BLOCK = "            const date = url.searchParams.get('date');\n            if (!date || !/^\\d{4}-\\d{2}-\\d{2}$/.test(date)) {\n                return new Response(JSON.stringify({ ok: false, error: 'missing or invalid ?date=YYYY-MM-DD' }),\n                    { status: 400, headers: { ...CORS, 'Content-Type': 'application/json' } });\n            }\n            const sportParam";
const GATE = "            if (!mcpBearerMatches(request.headers.get('Authorization'), env))\n                return new Response('Unauthorized', { status: 401, headers: CORS });\n            if (!env.ARCHIVE_DB) {\n                return new Response(JSON.stringify({ ok: false, error: 'ARCHIVE_DB not bound' }),";
const PRICEABLE = "if (row.finalized_at == null && odds\n                        && kickoffMark(odds.captured_at, row.start_time).late_minutes === null\n                        && kickoffMark(odds.captured_at, og.commence_time).late_minutes === null) priceable++;";
const UNMATCHED = "start_time: row.start_time, finalized: row.finalized_at != null,";
const KEY = "d1_key: `${resolveTeamKey(row.home)}|${resolveTeamKey(row.away)}`,\n                            start_time";

const MUTANTS = [
  // THE DATE (required, validated before anything is billed, and the one the rows are keyed by).
  ['J1 the date defaults to the clock\'s UTC day and is not validated', DATE_BLOCK, "            const date = url.searchParams.get('date') || new Date().toISOString().slice(0, 10);\n            const sportParam"],
  ['J2 the date pattern is not anchored', DATE_BLOCK, DATE_BLOCK.replace('/^\\d{4}-\\d{2}-\\d{2}$/', '/\\d{4}-\\d{2}-\\d{2}/')],
  ['J3 the slate matcher is given the clock\'s day instead of the requested date', 'const slate = matchSlate(slateRows, oddsGames, date);', 'const slate = matchSlate(slateRows, oddsGames, new Date().toISOString().slice(0, 10));'],
  ['J4 the window count uses the clock\'s day', 'slateWindow(oddsGames, date).length', 'slateWindow(oddsGames, new Date().toISOString().slice(0, 10)).length'],
  // THE ROWS (both tables, this sport, this date).
  ['J5 the postseason table is not read', "for (const table of ['regular_season_games', 'postseason_games']) {\n                    const got", "for (const table of ['regular_season_games']) {\n                    const got"],
  ['J6 the SELECT stops filtering on sport', SELECT_TAIL, 'FROM ${table} WHERE date = ?`\n                    ).bind(date).all();'],
  ['J7 the SELECT stops filtering on date', SELECT_TAIL, 'FROM ${table} WHERE sport = ?`\n                    ).bind(sport).all();'],
  ['J8 "unpriced" is inverted', 'opening_odds IS NULL AS unpriced', 'opening_odds IS NOT NULL AS unpriced'],
  ['J9 the late-minutes read is not guarded against a blob that is not JSON', "CASE WHEN json_valid(opening_odds)\n                                     THEN json_extract(opening_odds, '$._kickoff.late_minutes') END AS late_minutes", "json_extract(opening_odds, '$._kickoff.late_minutes') AS late_minutes"],
  // THE JOIN.
  ['J10 the route stops joining (nothing matches)', JOINCALL, "const og = findOddsForRow(oddsIndex, row.home, row.away, row.start_time);\n                    if (true) {"],
  ['J11 the join loses the row\'s kickoff (the per-row rule without its window)', JOINCALL, "const og = findOddsForRow(oddsIndex, row.home, row.away);\n                    if (!og) {"],
  ['J12 the vendor index of the FIRST sport is reused for the later ones', 'const oddsIndex = indexOddsByPair(oddsGames);\n                vendorKeysBySport.set(sport, oddsIndex.vendorKeys);', 'const oddsIndex = (report.__idx ||= indexOddsByPair(oddsGames));\n                vendorKeysBySport.set(sport, oddsIndex.vendorKeys);'],
  // JOINED IS NOT PRICED.
  ['J13 a finalized row counts as priceable', PRICEABLE, PRICEABLE.replace('row.finalized_at == null && odds', 'odds')],
  ['J14 an event without a price counts as priceable', "const odds = extractOddsForGame(og, ODDS_PREFERRED_BOOK, new Date().toISOString());\n                    if (row.finalized_at == null && odds", "const odds = extractOddsForGame(og, ODDS_PREFERRED_BOOK, new Date().toISOString()) || { captured_at: new Date().toISOString() };\n                    if (row.finalized_at == null && odds"],
  ['J15 the row\'s own kickoff is not consulted', PRICEABLE, PRICEABLE.replace('\n                        && kickoffMark(odds.captured_at, row.start_time).late_minutes === null', '')],
  ['J16 the event\'s commence time is not consulted', PRICEABLE, PRICEABLE.replace('\n                        && kickoffMark(odds.captured_at, og.commence_time).late_minutes === null', '')],
  ['J17 every joined row counts as priceable', PRICEABLE, 'priceable++;'],
  // THE SLATE MATCHER.
  ['J18 the slate matcher decides only the unpriced rows', 'const slate = matchSlate(slateRows, oddsGames, date);', 'const slate = matchSlate(missingRows, oddsGames, date);'],
  ['J19 slate_matched counts the priced rows\' pairs too', 'for (const row of missingRows) if (slate.byGameId.has(row.id)) slateMatched++;', 'slateMatched = slate.byGameId.size;'],
  ['J20 slate_matched repeats the per-row count', 'slate_matched: slateMatched,', 'slate_matched: matched.length,'],
  // THE DENOMINATORS.
  ['J21 d1_rows is the unpriced count', 'd1_rows: slateRows.length,', 'd1_rows: missingRows.length,'],
  ['J22 d1_priced is every row', 'd1_priced: slateRows.length - missingRows.length,', 'd1_priced: slateRows.length,'],
  ['J23 no price is ever late', 'd1_priced_late: slateRows.filter(r => r.unpriced === 0 && r.late_minutes != null).length,', 'd1_priced_late: 0,'],
  ['J24 every priced row is late', 'd1_priced_late: slateRows.filter(r => r.unpriced === 0 && r.late_minutes != null).length,', 'd1_priced_late: slateRows.filter(r => r.unpriced === 0).length,'],
  ['J25 d1_missing is every row', 'd1_missing: missingRows.length,', 'd1_missing: slateRows.length,'],
  ['J26 the window count is the whole feed', 'odds_events_in_window: slateWindow(oddsGames, date).length,', 'odds_events_in_window: oddsGames.length,'],
  ['J27 the substitution pass reads every row, priced or not', 'for (const row of missingRows) {\n                    // ONE argument', 'for (const row of slateRows) {\n                    // ONE argument'],
  // WHAT AN UNMATCHED ROW SAYS.
  ['J28 an unmatched row loses its start_time', UNMATCHED, 'finalized: row.finalized_at != null,'],
  ['J29 an unmatched row never says it is finalized', UNMATCHED, 'start_time: row.start_time, finalized: false,'],
  ['J30 an unmatched row says finalized when it is not', UNMATCHED, 'start_time: row.start_time, finalized: row.finalized_at == null,'],
  ['J31 an unmatched row\'s key is the two names the wrong way round', KEY, 'd1_key: `${resolveTeamKey(row.away)}|${resolveTeamKey(row.home)}`,\n                            start_time'],
  // THE GATE.
  ['J32 the gate is removed', GATE, "            if (!env.ARCHIVE_DB) {\n                return new Response(JSON.stringify({ ok: false, error: 'ARCHIVE_DB not bound' }),"],
];

let missed = 0, nothing = 0, errored = 0;
for (const [name, anchor, repl] of MUTANTS) {
  const count = original.split(anchor).length - 1;
  if (count !== 1) {
    nothing++;
    console.log(`NOTHING MUTATED  ${name}\n        the anchor occurs ${count} times in ${INDEX}, not once`);
    continue;
  }
  const text = original.replace(anchor, () => repl);
  if (text === original) { nothing++; console.log(`NOTHING MUTATED  ${name}`); continue; }
  const verdict = run(place(text, name.slice(0, 3).trim()));
  const label = verdict === 'red' ? 'CAUGHT    ' : verdict === 'pass' ? 'NOT CAUGHT' : 'HARNESS ERROR (no assertion failed; a crash is not a catch)';
  console.log(`${label}  ${name}`);
  if (verdict === 'pass') missed++;
  if (verdict === 'error') errored++;
}
const caughtN = MUTANTS.length - missed - nothing - errored;
console.log(`\nmutations: ${caughtN} of ${MUTANTS.length} caught${missed ? `, ${missed} SURVIVED` : ''}${errored ? `, ${errored} harness error(s)` : ''}${nothing ? `, ${nothing} not applied` : ''}`);
console.log('COVERAGE: the date, both SELECTs and their scoping, the join, priceable, the slate matcher, the denominators, the unmatched row\'s fields and the gate, mutated in a copy');
console.log('of src/index.js. NOT mutated: the cross-sport substitution pass (scripts/check-team-key-substitution.mjs reads it) and the credit guard.');
process.exit(missed || nothing || errored ? 1 : 0);
