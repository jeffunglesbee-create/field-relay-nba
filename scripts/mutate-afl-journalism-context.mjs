#!/usr/bin/env node
/**
 * Rule 90 for scripts/check-afl-journalism-context.mjs.
 *
 * Each mutation changes ONE thing in a copy of src/index.js (the join's clauses, the round guard, the year, the orientation of a row, the source
 * filter) and aims the check at the copy through INDEX_MODULE. The check must go red for every one. A mutant counts as CAUGHT only when an assertion
 * failed ("N of M passed." with N < M and a FAIL line): a crash is reported as a harness error. A mutation whose anchor is missing or not unique
 * applies NOTHING, so each fails the harness by name instead of passing quietly. src/index.js is read and written as latin1 so the copy is byte-exact.
 */
import { readFileSync, writeFileSync, rmSync, mkdirSync, readdirSync, copyFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, resolve, dirname } from 'node:path';

const SRC = 'src/index.js';
const original = readFileSync(SRC, 'latin1');
const MODULE_SRC = 'src/afl-squiggle.js';
const moduleOriginal = readFileSync(MODULE_SRC, 'latin1');
const born = [];
const place = (text, tag) => {
  const p = join(dirname(SRC), `.mutant-${tag}-${Math.random().toString(36).slice(2, 8)}.js`);
  writeFileSync(p, text, 'latin1'); born.push(p); return resolve(p);
};
// A mutant of a module index.js IMPORTS needs index.js to import the mutant: the whole of src/ is copied into a directory of its own with that one file
// mutated, and the check is aimed at index.js inside it.
const placeTree = (file, text, tag) => {
  const dir = join(dirname(SRC), `.mutant-tree-${tag}-${Math.random().toString(36).slice(2, 8)}`);
  mkdirSync(dir); born.push(dir);
  for (const f of readdirSync(dirname(SRC))) if (f.endsWith('.js')) copyFileSync(join(dirname(SRC), f), join(dir, f));
  writeFileSync(join(dir, file), text, 'latin1');
  return resolve(dir, 'index.js');
};
process.on('exit', () => { for (const p of born) rmSync(p, { force: true, recursive: true }); });
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => process.exit(130));

const run = (src) => {
  let out = '', code = 0;
  try {
    out = execFileSync(process.execPath, ['scripts/check-afl-journalism-context.mjs'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, INDEX_MODULE: src }, maxBuffer: 1 << 26 });
  } catch (e) { out = String(e.stdout === undefined ? '' : e.stdout); code = e.status === undefined ? 1 : e.status; }
  const m = /^(\d+) of (\d+) passed\.$/m.exec(out);
  if (code === 0) return m && m[1] === m[2] ? 'pass' : 'error';
  return m && Number(m[1]) < Number(m[2]) && /^FAIL  /m.test(out) ? 'red' : 'error';
};

if (run(resolve(SRC)) !== 'pass') { console.log('FAIL: the check is already red on clean source.'); process.exit(1); }
if (run(place(original, 'control')) !== 'pass') { console.log('FAIL: an UNMUTATED copy at the mutant location is red, so no verdict below would mean anything.'); process.exit(1); }
console.log('baseline: the check passes on current source and on an unmutated copy at the mutant location\n');

const C1 = "(sameAFLClub(homeTeam, g.home.name) && sameAFLClub(awayTeam, g.away.name)) ||";
const C2 = "(sameAFLClub(homeTeam, g.away.name) && sameAFLClub(awayTeam, g.home.name))";
const GUARD = "if (round === null || round === undefined) return finals.length ? ctx : {};";
const YEAR = "const _aflYear  = [...(_aflEventSeasons?.values() || [])].map(x => x?.year).find(Number.isInteger) ?? new Date().getUTCFullYear();";
const SQ_ORIENT = "const servedSquiggle = (tip, g) => sameAFLClub(tip.hteam, g.home.name)";
const KALI_KEEP = "const keep = sameAFLClub(pred.homeTeam, g.home.name);";
const FINALS = "const finals = games.filter(g => seasonOf(g)?.type === 3);";
const REGULAR = "const regularGames = games.filter(g => seasonOf(g)?.type == null || seasonOf(g)?.type === 2);";
const FINALS_ONLY = "return finals.length ? ctx : {};";
const CALLER = "buildAFLJournalismContext(games, _aflYear, env, _aflEventSeasons);";
const FYEAR = "year: seasonOf(g)?.year ?? year,";
const SEASONS = "if (sport === 'afl') _aflEventSeasons = new Map(";
const ROUND = "const round = regularGames.map(g => g.round).find(r => r !== null && r !== undefined) ?? null;";
const FSIGNAL = "{ headers: SQUIGGLE_HEADERS, signal: AbortSignal.timeout(5000) });";
const REGPCT = "if (squiggleHomePct(tip) === null) continue;";
const FTIP = "if (tip) ctx[g.espnEventId].squiggle = servedSquiggle(tip, g);";

// Each mutant: [name, [[anchor, replacement], ...]]; every anchor must occur exactly once.
const MUTANTS = [
  ['B1 the join is teamNameMatch\'s prefix rule again', [[C1, "(teamNameMatch(homeTeam, g.home.name) && teamNameMatch(awayTeam, g.away.name)) ||"], [C2, "(teamNameMatch(homeTeam, g.away.name) && teamNameMatch(awayTeam, g.home.name))"]]],
  ['B2 the clauses that matched the HOME club alone return (against the game\'s home club, then its away club)', [[C2, C2 + " || (sameAFLClub(homeTeam, g.home.name)) || (sameAFLClub(homeTeam, g.away.name))"]]],
  ['B2b one of them returns: a row whose home club is the game\'s AWAY club', [[C2, C2 + " || (sameAFLClub(homeTeam, g.away.name))"]]],
  ['B2c one of them returns: a row whose home club is the game\'s HOME club', [[C2, C2 + " || (sameAFLClub(homeTeam, g.home.name))"]]],
  ['B3 the away club is not compared in the same-orientation clause', [[C1, "(sameAFLClub(homeTeam, g.home.name)) ||"]]],
  ['B4 a row that lists the clubs the other way round no longer joins', [[C2, "false"]]],
  ['B5 round 0 is read as no round again', [[GUARD, "if (!round) return finals.length ? ctx : {};"]]],
  ['B6 the year is the AFL config\'s constant', [[YEAR, "const _aflYear  = cfg.season ?? new Date().getUTCFullYear();"]]],
  ['B7 the year ignores the events\' own season', [[YEAR, "const _aflYear  = [].map(x => x?.year).find(Number.isInteger) ?? new Date().getUTCFullYear();"]]],
  ['B8 an event with no season takes 2026, not the clock\'s year', [[YEAR, "const _aflYear  = [...(_aflEventSeasons?.values() || [])].map(x => x?.year).find(Number.isInteger) ?? 2026;"]]],
  ['B9 Squiggle\'s home value is served as the game\'s home value whatever the row\'s orientation', [[SQ_ORIENT, "const servedSquiggle = (tip, g) => true"]]],
  ['B10 Kali\'s sides are not swapped for a row listed the other way round', [[KALI_KEEP, "const keep = true;"]]],
  ['B11 the events\' seasons are never captured', [[SEASONS, "if (false) _aflEventSeasons = new Map("]]],
  ['C1 no event is a final (the season type is never read): a final is not served at all', [[FINALS, "const finals = [];"]]],
  ['C2 a final is ALSO joined through ESPN\'s week (the round read and Kali asked)', [[REGULAR, "const regularGames = games;"]]],
  ['C3 a slate of finals only returns an empty context', [[FINALS_ONLY, "return {};"]]],
  ['C4 the caller does not hand the events\' seasons to the context', [[CALLER, "buildAFLJournalismContext(games, _aflYear, env);"]]],
  ['C5 a final asks Squiggle for the constant 2026', [[FYEAR, "year: 2026,"]]],
  ['B13 the round-based Squiggle read asks for every source again', [["fetch(`${SQUIGGLE_BASE}/?q=tips;year=${year};round=${round};source=8`, {", "fetch(`${SQUIGGLE_BASE}/?q=tips;year=${year};round=${round}`, {"]]],
  ['B14 the round-based read shares the old edge-cache key (entries that hold every source)', [["cacheKey: `squiggle:tips:${year}:${round}:aggregate` },", "cacheKey: `squiggle:tips:${year}:${round}` },"]]],
  ['B15 the slate\'s round is the first game\'s round only (a weekless first game ends the context)', [[ROUND, "const round = regularGames.length ? (regularGames[0].round ?? null) : null;"]]],
  ['B16 a final\'s Squiggle read has no timeout', [[FSIGNAL, "{ headers: SQUIGGLE_HEADERS });"]]],
  ['B17 a regular row with no usable hconfidence is served (as certainty for one club)', [[REGPCT, ""]]],
  ['B24 everything that is not a final is a regular game again (a preseason game is joined through ESPN\'s week 1 as Squiggle\'s round 1)', [[REGULAR, "const regularGames = games.filter(g => seasonOf(g)?.type !== 3);"]]],
  ['B18 a regular slate with no round and no finals returns the ctx (a journalism key on every game) instead of nothing', [[FINALS_ONLY, "return ctx;"]]],
  ['B19 the year is the first event\'s season, not the first season that has a year', [[YEAR, "const _aflYear  = [...(_aflEventSeasons?.values() || [])].map(x => x?.year)[0] ?? new Date().getUTCFullYear();"]]],
  ['B20 a final\'s Squiggle read carries no headers', [[FSIGNAL, "{ signal: AbortSignal.timeout(5000) });"]]],
  ['B21 a final with no tip of its own falls back to the round read at ESPN\'s week (the original defect, as a fallback)', [[FTIP, FTIP + " else { const rr = await fetch(`${SQUIGGLE_BASE}/?q=tips;year=${year};round=${g.round};source=8`, { headers: SQUIGGLE_HEADERS }); const rj = await rr.json(); const rt = rj.tips.find(t => t.source === 'Aggregate' && sameAFLClub(t.hteam, g.home.name)); if (rt) ctx[g.espnEventId].squiggle = servedSquiggle(rt, g); }"]]],
  ['B22 the round-based read carries no headers', [["            headers: SQUIGGLE_HEADERS,\n            cf: { cacheTtl: squiggleTtl(", "            cf: { cacheTtl: squiggleTtl("]]],
  ['B23 a final serves Squiggle\'s home value as the game\'s whatever the row\'s orientation', [[FTIP, "if (tip) ctx[g.espnEventId].squiggle = { homeConfidence: tip.hconfidence, awayConfidence: 100 - tip.hconfidence };"]]],
  ['B12 a row from any source is taken, not the Aggregate', [["const aggTips = (sd.tips || []).filter(t => t.source === 'Aggregate');", "const aggTips = (sd.tips || []);"]]],
];

const DAYFILTER = "&& typeof t.date === 'string' && t.date.slice(0, 10) === day);";
const PAIR = "&& ((t.hteamid === homeId && t.ateamid === awayId) || (t.hteamid === awayId && t.ateamid === homeId))";
const MODULE_MUTANTS = [
  ['S1 the kickoff day is not compared (a club\'s March game and its final both qualify)', [[DAYFILTER, "&& typeof t.date === 'string');"]]],
  ['S2 one club of the pair is enough (a club\'s other game on the same day qualifies)', [[PAIR, "&& (t.hteamid === homeId || t.ateamid === homeId)"]]],
  ['S3 a row of any source is taken, not the Aggregate', [["t && t.source === 'Aggregate' &&", "t &&"]]],
  ['S4 the kickoff day is the UTC day, not the Melbourne day', [["return melbourneFormat.format(new Date(instantMs));", "return new Date(instantMs).toISOString().slice(0, 10);"]]],
  ['S5 Greater Western Sydney is Squiggle team 10 (Hawthorn)', [["greate: 9,", "greate: 10,"]]],
  ['S6 the year in the request is a constant', [["const url = `${SQUIGGLE_BASE}/?q=tips;year=${year};team=${homeId};source=8`;", "const url = `${SQUIGGLE_BASE}/?q=tips;year=2026;team=${homeId};source=8`;"]]],
  ['S7 the edge-cache key is one entry for every club', [["cacheKey: `squiggle:tips:${year}:team:${homeId}:aggregate`", "cacheKey: `squiggle:tips:${year}:aggregate`"]]],
  ['S8 the request is not narrowed to the Aggregate source', [[";team=${homeId};source=8`;", ";team=${homeId}`;"]]],
  ['S9 a game with no tip is not said', [["console.warn(`[AFL-SQUIGGLE] ${found.length ? 'ambiguous' : 'no'} Squiggle tip for", "void (`[AFL-SQUIGGLE] ${found.length ? 'ambiguous' : 'no'} Squiggle tip for"]]],
  ['S11 a runtime with no Melbourne zone is not said', [["console.warn(`[AFL-SQUIGGLE] no Melbourne time zone in this runtime: ${e && e.message}`);\n", ""]]],
  ['S12 a row that lists the clubs the other way round to the game no longer qualifies', [[PAIR, "&& (t.hteamid === homeId && t.ateamid === awayId)"]]],
  ['S13 an ambiguous pair (two rows) is accepted: the first wins', [["if (found.length !== 1) {", "if (found.length < 1) {"]]],
  ['S14 a read that fails (not JSON, network down) is a thrown error, not null', [["console.warn(`[AFL-SQUIGGLE] Squiggle read failed for ${url}: ${e && e.message}`);\n        return null;", "throw e;"]]],
  ['S15 a body whose tips is not an array is not guarded', [["rows = Array.isArray(j && j.tips) ? j.tips : null;", "rows = j.tips;"]]],
  ['S16 a null entry among the tips is not guarded', [["t && t.source === 'Aggregate' &&", "t.source === 'Aggregate' &&"]]],
  ['S17 a final\'s row with no usable hconfidence is returned', [["if (squiggleHomePct(found[0]) === null) {", "if (false) {"]]],
  ['S18 an empty or null hconfidence counts as 0%', [["if (!((typeof raw === 'string' && raw.trim() !== '') || typeof raw === 'number')) return null;\n", ""]]],
  ['S19 a percentage outside 0..100 is accepted', [["return Number.isFinite(h) && h >= 0 && h <= 100 ? h : null;", "return Number.isFinite(h) ? h : null;"]]],
  ['S20 the abort signal is not passed on to the request', [["headers, ...(signal ? { signal } : {}),", "headers,"]]],
  ['S21 Essendon is Squiggle team 6', [["essend: 5,", "essend: 6,"]]],
  ['S22 North Melbourne is Squiggle team 11', [["northm: 12,", "northm: 11,"]]],
  ['S23 West Coast is Squiggle team 16', [["westco: 17,", "westco: 16,"]]],
  ['S24 a tip with no usable hconfidence gives the AWAY club certainty', [["if (id === null || h === null) return null;", "if (id === null) return null;"]]],
  ['S25 a failed read is an empty answer (no warning that it failed)', [["console.warn(`[AFL-SQUIGGLE] Squiggle read failed for ${url}: ${e && e.message}`);\n        return null;", "rows = [];"]]],
  ['S26 a failed read is not said', [["console.warn(`[AFL-SQUIGGLE] Squiggle read failed for ${url}: ${e && e.message}`);", "void 0;"]]],
  ['S27 a club the team table does not have is not said', [["console.warn(`[AFL-SQUIGGLE] no Squiggle team id for", "void (`[AFL-SQUIGGLE] no Squiggle team id for"]]],
  ['S28 a missing year or kickoff is not said', [["console.warn(`[AFL-SQUIGGLE] no year or kickoff for", "void (`[AFL-SQUIGGLE] no year or kickoff for"]]],
  ['S29 a body with no tips array is not said', [["console.warn(`[AFL-SQUIGGLE] Squiggle answered no tips array for", "void (`[AFL-SQUIGGLE] Squiggle answered no tips array for"]]],
  ['S30 the request does not ask for cacheEverything', [["cacheTtl: 3600, cacheEverything: true,", "cacheTtl: 3600,"]]],
  ['S31 the request asks for a 5 second edge cache', [["cacheTtl: 3600,", "cacheTtl: 5,"]]],
  ['S32 the request asks for a one-year edge cache', [["cacheTtl: 3600,", "cacheTtl: 31536000,"]]],
  ['S33 the request carries no headers', [["headers, ...(signal ? { signal } : {}),", "...(signal ? { signal } : {}),"]]],
  ['S34 the Melbourne day is the UTC day plus a fixed 10 hours', [["return melbourneFormat.format(new Date(instantMs));", "return new Date(instantMs + 36000000).toISOString().slice(0, 10);"]]],
  ['S35 the zone is Brisbane\'s (no daylight saving)', [["timeZone: 'Australia/Melbourne'", "timeZone: 'Australia/Brisbane'"]]],
  ['S36 a runtime with no Melbourne zone also says a kickoff is missing', [["if (day === null) return null;", "if (day === null) { console.warn('[AFL-SQUIGGLE] no year or kickoff'); return null; }"]]],
  ['S37 an ambiguous pair is said as no tip', [["${found.length ? 'ambiguous' : 'no'} Squiggle tip for", "${'no'} Squiggle tip for"]]],
  ['S10 a failed read is a thrown error, not null', [["console.warn(`[AFL-SQUIGGLE] Squiggle answered ${r.status} for ${url}`); return null; }", "throw new Error('squiggle ' + r.status); }"]]],
];

let missed = 0, nothing = 0, errored = 0;
for (const [name, edits, file = 'index.js'] of [...MUTANTS, ...MODULE_MUTANTS.map(([n, e]) => [n, e, 'afl-squiggle.js'])]) {
  const base = file === 'index.js' ? original : moduleOriginal;
  let text = base, bad = null;
  for (const [anchor, repl] of edits) {
    const count = text.split(anchor).length - 1;
    if (count !== 1) { bad = `the anchor occurs ${count} times in ${file}, not once: ${JSON.stringify(anchor.slice(0, 70))}`; break; }
    text = text.replace(anchor, () => repl);
  }
  if (bad === null && text === base) bad = 'the replacement equals the anchor';
  if (bad !== null) { nothing++; console.log(`NOTHING MUTATED  ${name}\n        ${bad}`); continue; }
  const verdict = run(file === 'index.js' ? place(text, name.slice(0, 3).trim()) : placeTree(file, text, name.slice(0, 3).trim()));
  const label = verdict === 'red' ? 'CAUGHT    ' : verdict === 'pass' ? 'NOT CAUGHT' : 'HARNESS ERROR (no assertion failed; a crash is not a catch)';
  console.log(`${label}  ${name}`);
  if (verdict === 'pass') missed++;
  if (verdict === 'error') errored++;
}
const TOTAL = MUTANTS.length + MODULE_MUTANTS.length;
const caughtN = TOTAL - missed - nothing - errored;
console.log(`\nmutations: ${caughtN} of ${TOTAL} caught${missed ? `, ${missed} SURVIVED` : ''}${errored ? `, ${errored} harness error(s)` : ''}${nothing ? `, ${nothing} not applied` : ''}`);
console.log('COVERAGE: the join (prefix rule restored, a home-club-alone clause, the away club dropped, the reversed clause dropped), the round guard (round 0), the year (the config constant, ignoring the events, a fixed fallback, never capturing them), the orientation of a Squiggle row and of a Kali row, and the Aggregate source filter, mutated in a copy of src/index.js; and, for finals, whether an event is a final, how it is joined (the season type, the caller, the empty context, the year) and, in a copy of src/afl-squiggle.js inside a copy of the rest of src/, the kickoff day (and its zone), the pair of clubs, the source, the team table (three ids by mutation, all 18 by assertion U2), the request (year, source, edge-cache key, abort signal), every way a game with no tip fails (no row, two rows, a failed read, a body that is not JSON or has no tips array, a null row, no hconfidence), the reversed row, and the hconfidence validation, the cf options and headers sent, and the Melbourne day (a fixed offset, Brisbane); and, in index.js, the slate\'s round (the first game that has one), the year (the first season with a year), a final\'s timeout and headers, the fallback of a final to the round read, the orientation of a final\'s tip, the empty context of a slate with no round, and the regular row\'s hconfidence guard. Equivalent (not mutated): Sydney\'s zone for Melbourne\'s (the same offsets and daylight saving rules).');
console.log('NOT mutated here: the Kali fetch and its token gate, and handleV2Games outside the AFL block.');
process.exit(missed || nothing || errored ? 1 : 0);
