#!/usr/bin/env node
// The AFLW board on /v2/games is the AFL's own API, and a failed or unreadable answer is not an empty slate.
// docs/CC-CMD-2026-11-22-aflw-live-source.md, Task 2 (the feed) and Task 4 (this check).
//
// WHY. ESPN serves no AFLW (core australian-football/leagues is `afl` only, runner probe 2026-11-22), so the board comes from
// aflapi.afl.com.au/afl/v2, competition 3. Three things about it are easy to get wrong and silent when wrong:
//   - STAGE 1 maps only the two status strings that have been READ (SCHEDULED, CONCLUDED). Nothing has been in play to read the
//     live spelling, so any other string must be a named 502 for the whole board: a guessed `live` is a wrong card, a dropped
//     game is a card that never moves, and a guessed `pre` hides a live game. Stage 2 adds the spelling from the 2026-11-27
//     Grand Final capture (outbox/aflapi-aflw-gf-9081-*.json), and this check gains that row then.
//   - A refusal is not an empty slate (the defect CC-CMD-2026-10-22-nba-cdn-403-in-season removed from the NBA board): a 403, a
//     thrown fetch, an HTML 200 (Kali's holding page taught that one) and a paginated answer are each a 502 that says why.
//   - The slate is the ET calendar day of each kickoff (the archive's own date key), not the UTC day: an AFLW game at 12:35pm AEST
//     is the previous ET day.
//
// This runs the REAL worker (src/index.js default export) on GET /v2/games against a stubbed aflapi. src/index.js imports
// @cloudflare/puppeteer, which this repo's CI does not install, so a resolve hook stubs that one package.
//
// Fixtures: the REAL bodies in outbox/aflapi-aflw-fixtures-20261123.json (matches 8988 and 8884, the season list) and the real
// Grand Final item (match 9081, SCHEDULED). A fixture marked DERIVED below is a real item with one field changed to make the case,
// not a body aflapi sent: the 2026-08-15T03:00Z game (real, read through Exa on 2026-11-22; its start is the real one), a second
// game on the Grand Final's ET day, a SCHEDULED item whose start has long passed (modelled on match 1181 of 2016, which reads
// SCHEDULED still), and an item with status `LIVE` (NOT an aflapi spelling anyone has read: a third-party report names LIVE for a
// different endpoint, and the point of the case is that the adapter does not know it).
//
// Coverage, printed with the result (Rule 91): the case ids in CASES, counted from the cases that ran. Not checked: the live
// spelling and any period or clock (unread until 2026-11-27); the shape of any match item that is not one of the fixtures; the
// archive (Task 3 of the CC-CMD is a separate writer); the pagination of a season with more than 200 matches (the cap is named and
// refused, not read).
//
//   node scripts/check-v2-games-aflw.mjs            # self-test
//   node scripts/check-v2-games-aflw.mjs --mutate   # Rule 90

import { register } from 'node:module';
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

register('data:text/javascript,' + encodeURIComponent(
  "export async function resolve(s, c, next) { if (s === '@cloudflare/puppeteer') return { url: 'data:text/javascript,export default {}', shortCircuit: true }; return next(s, c); }"));

const HERE = path.dirname(fileURLToPath(import.meta.url));
const INDEX = path.resolve(HERE, '../src/index.js');
const INDEX_MODULE = process.env.INDEX_MODULE || INDEX;
const FIXTURES = JSON.parse(readFileSync(path.resolve(HERE, '../outbox/aflapi-aflw-fixtures-20261123.json'), 'utf8'));

const [M8988, M8884] = FIXTURES.matches.matches;
const M9081 = FIXTURES.scheduled;
const withFields = (m, f) => ({ ...m, ...f });
// DERIVED (see the header): one field of a real item changed.
const M_LATE_AEST = withFields(M8884, { id: 8881, utcStartTime: '2026-08-15T03:00:00.000+0000' });
const M_SAME_DAY_EARLY = withFields(M9081, { id: 9082, utcStartTime: '2026-11-27T06:00:00.000+0000' });
const M_STALE_SCHEDULED = withFields(M9081, { id: 9099, utcStartTime: '2026-08-20T03:00:00.000+0000' });
const M_LIVE = withFields(M9081, { id: 9100, status: 'LIVE', utcStartTime: '2026-11-26T07:00:00.000+0000' });

// The Grand Final is listed BEFORE the earlier game of its day on purpose: with the list already in start order, a missing sort
// would pass (A15 and the first A1 case), which is what the first version of this check did.
const ALL_MATCHES = [M8988, M8884, M_LATE_AEST, M_STALE_SCHEDULED, M_LIVE, M9081, M_SAME_DAY_EARLY];

// mode: 'ok' serves the fixtures; '403' refuses; 'throw' fails the fetch; 'html' answers 200 with a page; 'paged' says numPages 2;
// 'noseasons' serves an empty season list.
function stubAflapi(mode, seen) {
  globalThis.fetch = async (input, init) => {
    const url = String(input?.url ?? input);
    seen.push({ url, init });
    if (!url.startsWith('https://aflapi.afl.com.au/')) return new Response('{}', { status: 404 });
    if (mode === 'throw') throw new Error('network down');
    if (mode === '403') return new Response('Access Denied', { status: 403 });
    if (mode === 'html') return new Response('<html><body><h1>Whitelabel Error Page</h1></body></html>', { status: 200 });
    if (url.includes('/afl/v2/competitions/3/compseasons'))
      return Response.json(mode === 'noseasons' ? { meta: { code: 200 }, compSeasons: [] } : FIXTURES.compseasons);
    if (url.includes('/afl/v2/matches'))
      return Response.json({ meta: { code: 200, pagination: { page: 0, numPages: mode === 'paged' ? 2 : 1, pageSize: 200, numEntries: ALL_MATCHES.length } },
                             matches: ALL_MATCHES.filter(m => m.status !== 'LIVE' || mode === 'live') });
    return new Response('{}', { status: 404 });
  };
}

const CASES = ['N', 'A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'A7', 'A8', 'A9', 'A10', 'A11', 'A12', 'A13', 'A14', 'A15', 'A16'];
const seenCases = new Set();
async function selfTest() {
  let failed = 0, assertions = 0;
  const eq = (name, got, want) => {
    assertions++; seenCases.add(name.split(' ')[0]);
    const ok = JSON.stringify(got) === JSON.stringify(want);
    if (!ok) failed++;
    console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name}${ok ? '' : `\n         got  ${JSON.stringify(got)}\n         want ${JSON.stringify(want)}`}`);
  };

  const seen = [];
  stubAflapi('ok', seen);
  const worker = (await import(pathToFileURL(INDEX_MODULE).href)).default;
  const get = async (query, mode = 'ok') => {
    seen.length = 0;
    stubAflapi(mode, seen);
    const waits = [];
    const ctx = { waitUntil: p => waits.push(p), passThroughOnException() {} };
    const r = await worker.fetch(new Request(`http://relay.test/v2/games?${query}`), {}, ctx);
    await Promise.allSettled(waits);
    let body = null;
    try { body = await r.json(); } catch (_) { /* not JSON */ }
    return { status: r.status, body, calls: [...seen] };
  };

  eq('N the real Grand Final item is SCHEDULED with no score object (the fixture is what was read)', [M9081.status, M9081.home.score, M9081.id], ['SCHEDULED', undefined, 9081]);

  // A1: the Grand Final, before kickoff: pre, every contract field, no espnEventId.
  const gf = await get('sport=aflw&date=2026-11-27');
  eq('A1 a served day answers 200 with the games of that ET day, in start order', [gf.status, gf.body?.count, (gf.body?.games ?? []).map(g => g.aflapiMatchId)], [200, 2, [9082, 9081]]);
  const g9081 = (gf.body?.games ?? []).find(g => g.aflapiMatchId === 9081);
  eq('A1 the Grand Final is a pre game in the contract shape', g9081, {
    id: 'aflw:9081', aflapiMatchId: 9081, sport: 'aflw', league: 'AFLW', state: 'pre', start: '2026-11-27T08:45:00.000Z',
    home: { name: 'North Melbourne', abbr: 'NMFC', score: null }, away: { name: 'Melbourne', abbr: 'MELB', score: null },
    periodNum: 0, periodLabel: 'NS', clock: '', venue: 'IKON Park' });
  eq('A1 the board says where it came from', [gf.body?.sport, gf.body?.source, gf.body?.date], ['aflw', 'aflapi', '2026-11-27']);
  eq('A1 no espnEventId is emitted (the game is not on ESPN; the laboratory joins by club names)', 'espnEventId' in (g9081 ?? {}), false);

  // A2: a finished game: final, points are totalScore, period F.
  const rd1 = await get('sport=aflw&date=2026-08-09');
  eq('A2 a finished game is final with its points', (rd1.body?.games ?? []).map(g => [g.aflapiMatchId, g.state, g.home.score, g.away.score, g.periodLabel, g.start, g.venue]),
    [[8988, 'final', 40, 66, 'F', '2026-08-09T06:35:00.000Z', 'Marvel Stadium']]);

  // A3: the slate is the ET day of the kickoff, not the UTC day.
  const fri = await get('sport=aflw&date=2026-08-14');
  const sat = await get('sport=aflw&date=2026-08-15');
  eq('A3 a 03:00Z game belongs to the previous ET day, and not to its UTC day',
    [(fri.body?.games ?? []).map(g => g.aflapiMatchId), (sat.body?.games ?? []).map(g => g.aflapiMatchId)], [[8881], []]);

  // A4: a day with no match is an honest empty answer.
  const none = await get('sport=aflw&date=2026-09-01');
  eq('A4 a day with no AFLW match is a 200 with no games', [none.status, none.body?.count, none.body?.games, none.body?.source], [200, 0, [], 'aflapi']);

  // A5: SCHEDULED stays pre however long ago the start was; the feed makes no live claim from a clock.
  const stale = await get('sport=aflw&date=2026-08-19');
  eq('A5 a SCHEDULED game whose start has long passed is pre, not live and not dropped', (stale.body?.games ?? []).map(g => [g.aflapiMatchId, g.state, g.periodLabel]), [[9099, 'pre', 'NS']]);

  // A6: a status the adapter was never shown fails the whole board, named.
  const live = await get('sport=aflw&date=2026-11-26', 'live');
  eq('A6 an unmapped status is a 502 naming the status and the match, and no game is served',
    [live.status, live.body?.games, /"LIVE" is not mapped \(match 9100\)/.test(live.body?.error ?? ''), live.body?.sport], [502, undefined, true, 'aflw']);

  // A7-A9, A11: a refusal, a thrown fetch, a page that is not JSON and a paginated answer are each a named 502, never an empty slate.
  const refused = await get('sport=aflw&date=2026-11-27', '403');
  eq('A7 an aflapi 403 is a 502 naming it, not an empty slate', [refused.status, refused.body?.games, /aflapi upstream 403/.test(refused.body?.error ?? '')], [502, undefined, true]);
  const thrown = await get('sport=aflw&date=2026-11-27', 'throw');
  eq('A8 a thrown fetch is a 502 naming the network error', [thrown.status, thrown.body?.games, /aflapi network error/.test(thrown.body?.error ?? '')], [502, undefined, true]);
  const html = await get('sport=aflw&date=2026-11-27', 'html');
  eq('A9 a 200 that is not JSON is a 502 naming it (a holding page is not data)', [html.status, html.body?.games, /did not answer JSON/.test(html.body?.error ?? '')], [502, undefined, true]);
  const paged = await get('sport=aflw&date=2026-11-27', 'paged');
  eq('A11 a paginated answer is refused by name, not read as the first page', [paged.status, paged.body?.games, /paginated \(2 pages\)/.test(paged.body?.error ?? '')], [502, undefined, true]);

  // A10: no season for the year is the one honest empty answer.
  const nextYear = await get('sport=aflw&date=2027-08-01');
  eq('A10 a year aflapi has no season for is a 200 with no games and says so', [nextYear.status, nextYear.body?.count, nextYear.body?.note], [200, 0, 'no 2027 season on aflapi']);

  // A12: Rule 78: both reads are edge-cached, the cache keys carry no date, the UA is the relay's.
  const a = await get('sport=aflw&date=2026-11-27');
  const b = await get('sport=aflw&date=2026-08-09');
  const cacheOf = c => c.calls.map(x => [x.url.replace('https://aflapi.afl.com.au', ''), x.init?.cf?.cacheEverything, x.init?.cf?.cacheTtl, x.init?.cf?.cacheKey === x.url, x.init?.headers?.['User-Agent']]);
  eq('A12 two cached reads, 3600 s for the season list and 30 s for the matches, keyed by their own URL', cacheOf(a), [
    ['/afl/v2/competitions/3/compseasons?pageSize=100', true, 3600, true, 'FIELD/1.0'],
    ['/afl/v2/matches?competitionId=3&compSeasonId=96&pageSize=200', true, 30, true, 'FIELD/1.0']]);
  eq('A12 two different dates make the same two requests (the date is not in the cache key)', JSON.stringify(cacheOf(a)) === JSON.stringify(cacheOf(b)), true);

  // A13: the key exists and the 400 list names it.
  const unknown = await get('sport=zzz');
  eq('A13 aflw is a supported sport key', [unknown.status, (unknown.body?.supported ?? []).includes('aflw')], [400, true]);

  // A14: nothing else is asked.
  eq('A14 only aflapi is asked (no ESPN, no fallback source)', gf.calls.every(c => c.url.startsWith('https://aflapi.afl.com.au/')), true);

  // A15: the contract's order is the start time.
  eq('A15 games are in start order within the day', (gf.body?.games ?? []).map(g => g.start), ['2026-11-27T06:00:00.000Z', '2026-11-27T08:45:00.000Z']);

  // A16: the season id is read from the season list for the request's year, not hard-coded.
  const y2025 = await get('sport=aflw&date=2025-11-29');
  eq('A16 a 2025 request asks for season 84 and not 96', y2025.calls.map(c => c.url).some(u => u.includes('compSeasonId=84')) && !y2025.calls.some(c => c.url.includes('compSeasonId=96')), true);

  const missing = CASES.filter(c => !seenCases.has(c));
  if (missing.length) { failed++; console.log(`  FAIL coverage: case ${missing.join(', ')} did not run`); }
  console.log(`\nchecked ${CASES.length - missing.length} of ${CASES.length} cases (${assertions} assertions) of /v2/games?sport=aflw: a pre game, a final game, the ET day, no game, a stale SCHEDULED, an unmapped status, a 403, a thrown fetch, a non-JSON 200, a paginated answer, no season, caching, the key, one source, order, the season id. Not checked: the live spelling, any period or clock (unread until 2026-11-27), the archive writer.`);
  console.log(failed ? `SELF-TEST FAILED: ${failed}` : 'self-test passed');
  return failed;
}

// [name, [[from, to], ...]]. Every anchor must occur exactly once, or the mutation is not run and the gate
// fails (Rule 90's corollary: a mutation that applied nothing is worse than no test).
const MUTATIONS = [
  ['an unmapped status reads pre', [["const state = AFLAPI_STATE[m?.status];", "const state = AFLAPI_STATE[m?.status] || 'pre';"]]],
  ['CONCLUDED reads pre', [["CONCLUDED: 'final'", "CONCLUDED: 'pre'"]]],
  ['SCHEDULED reads live', [["SCHEDULED: 'pre'", "SCHEDULED: 'live'"]]],
  ['an upstream refusal becomes an empty answer', [["if (!r.ok) throw new Error(`aflapi upstream ${r.status} for ${path}`);", "if (!r.ok) return { matches: [], compSeasons: [] };"]]],
  ['a thrown fetch becomes an empty answer', [["catch (e) { throw new Error(`aflapi network error: ${e.message}`); }", "catch (e) { return { matches: [], compSeasons: [] }; }"]]],
  ['a non-JSON 200 becomes an empty answer', [["catch { throw new Error(`aflapi upstream: ${path} did not answer JSON`); }", "catch { return { matches: [], compSeasons: [] }; }"]]],
  ['the UTC day is used instead of the ET day', [[".filter(m => fieldDayOfInstant(m.utcStartTime) === date)", ".filter(m => String(m.utcStartTime).slice(0, 10) === date)"]]],
  ['a paginated answer is read as one page', [["if ((page.meta?.pagination?.numPages ?? 1) > 1)", "if (false)"]]],
  ['an espnEventId is invented', [["        id:           `aflw:${m.id}`,\n", "        id:           `aflw:${m.id}`,\n        espnEventId:  String(m.id),\n"]]],
  ['the edge cache is dropped', [["cf: { cacheTtl: ttl, cacheEverything: true, cacheKey: u }", "cf: {}"]]],
  ['a missing score reads 0', [["typeof s?.score?.totalScore === 'number' ? s.score.totalScore : null", "typeof s?.score?.totalScore === 'number' ? s.score.totalScore : 0"]]],
  ['the games are not sorted', [[".sort((x, y) => x.start.localeCompare(y.start) || x.aflapiMatchId - y.aflapiMatchId);", ";"]]],
  ['the season is hard-coded to 2026', [["startsWith(`${year} `)", "startsWith('2026 ')"]]],
  ['home and away are swapped', [["        home:         side(m.home),\n        away:         side(m.away),\n", "        home:         side(m.away),\n        away:         side(m.home),\n"]]],
  ['a finished game has no final word', [["periodLabel:  state === 'final' ? 'F' : 'NS',", "periodLabel:  'NS',"]]],
  ['a day with no season is a refusal', [["JSON.stringify({ sport, date, games: [], count: 0, source: 'aflapi', note: `no ${year} season on aflapi`, ts: Date.now() }),", "JSON.stringify({ error: 'no season', sport, date }),"]]],
];

function mutate() {
  const base = spawnSync(process.execPath, [fileURLToPath(import.meta.url)], { encoding: 'utf8' });
  if (base.status !== 0) { console.log('BASELINE RED: mutations not run.\n' + base.stdout + base.stderr); return 1; }
  let bad = 0;
  const original = readFileSync(INDEX, 'latin1');
  for (const [name, edits] of MUTATIONS) {
    let text = original, why = null;
    for (const [from, to] of edits) {
      const at = text.indexOf(from);
      if (at < 0 || text.indexOf(from, at + 1) >= 0) { why = at < 0 ? 'missing' : 'not unique'; break; }
      text = text.slice(0, at) + to + text.slice(at + from.length);
    }
    if (why) { console.log(`  ANCHOR     ${name} (${why}): not run`); bad++; continue; }
    if (text === original) { console.log(`  ANCHOR     ${name} (applied nothing): not run`); bad++; continue; }
    const mutant = path.join(path.dirname(INDEX), `.mutant-${process.pid}-aflw-index.js`);
    writeFileSync(mutant, text, 'latin1');
    try {
      const r = spawnSync(process.execPath, [fileURLToPath(import.meta.url)], { encoding: 'utf8', env: { ...process.env, INDEX_MODULE: mutant } });
      const fails = (r.stdout.match(/^  FAIL (\S+)/gm) || []).map(l => l.slice(7));
      if (r.status !== 0 && /SELF-TEST FAILED/.test(r.stdout) && fails.length) {
        console.log(`  CAUGHT     ${name}\n               by: ${[...new Set(fails)].join(' ')}`);
      } else if (r.status === 0) {
        console.log(`  NOT CAUGHT ${name}`); bad++;
      } else {
        console.log(`  HARNESS ERROR ${name} (exit ${r.status}, no failing assertion)\n${(r.stderr || '').slice(0, 400)}`); bad++;
      }
    } finally { unlinkSync(mutant); }
  }
  console.log(`\nmutations: ${MUTATIONS.length - bad} of ${MUTATIONS.length} caught (exit 0 when all are caught, 1 otherwise)`);
  return bad ? 1 : 0;
}

if (process.argv.includes('--mutate')) process.exit(mutate());
else process.exit(await selfTest() ? 1 : 0);
