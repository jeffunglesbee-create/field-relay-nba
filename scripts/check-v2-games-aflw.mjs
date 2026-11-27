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
// DERIVED, A22: the Grand Final's own status read 'UNCONFIRMED_TEAMS' through the deployed route on 2026-11-27 (a 502 naming it); no body carrying it was kept, so this is the real SCHEDULED item with the status and a day changed.
// CONFIRMED_TEAMS is NOT an aflapi spelling anyone has read from this host (a documented one): the case is that it stays unmapped.
const M_UNCONFIRMED = withFields(M9081, { id: 9102, status: 'UNCONFIRMED_TEAMS', utcStartTime: '2026-12-05T15:00:00.000+0000' });
const M_CONFIRMED = withFields(M9081, { id: 9103, status: 'CONFIRMED_TEAMS', utcStartTime: '2026-12-06T15:00:00.000+0000' });

// The Grand Final is listed BEFORE the earlier game of its day on purpose: with the list already in start order, a missing sort
// would pass (A15 and the first A1 case), which is what the first version of this check did.
const ALL_MATCHES = [M8988, M8884, M_LATE_AEST, M_STALE_SCHEDULED, M_LIVE, M9081, M_SAME_DAY_EARLY, M_UNCONFIRMED, M_CONFIRMED];

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

const CASES = ['N', 'A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'A7', 'A8', 'A9', 'A10', 'A11', 'A12', 'A13', 'A14', 'A15', 'A16', 'A17', 'A18', 'A19', 'A20', 'A21', 'A22', 'A23', 'A24', 'A25'];
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
  const get = async (query, mode = 'ok', env = {}) => {
    seen.length = 0;
    stubAflapi(mode, seen);
    const waits = [];
    const ctx = { waitUntil: p => waits.push(p), passThroughOnException() {} };
    // Everything the worker writes to the console while answering is kept (A23 looks for the address in it) and the real console is put back before anything is printed.
    const logs = [], real = { log: console.log, warn: console.warn, error: console.error, info: console.info };
    for (const k of Object.keys(real)) console[k] = (...a) => logs.push(a.map(String).join(' '));
    let r;
    try {
      r = await worker.fetch(new Request(`http://relay.test/v2/games?${query}`), env, ctx);
      await Promise.allSettled(waits);
    } finally { Object.assign(console, real); }
    let body = null, text = '';
    try { text = await r.text(); body = JSON.parse(text); } catch (_) { /* not JSON */ }
    return {
      status: r.status, body, text, calls: [...seen], logs: logs.join('\n'),
      allHeaders: [...r.headers].map(([k, v]) => `${k}: ${v}`).join('\n'),
      headers: { contact: r.headers.get('X-FIELD-Aflapi-Contact'), feed: r.headers.get('X-FIELD-Aflapi-Feed'), cache: r.headers.get('Cache-Control'), cors: r.headers.get('Access-Control-Allow-Origin') },
    };
  };
  const uaOf = c => c.calls.map(x => x.init?.headers?.['User-Agent']);
  const acceptOf = c => c.calls.map(x => x.init?.headers?.Accept);

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

  // A17-A18: the contact address (ADR-004, approved 2026-11-27). The Worker secret AFLAPI_CONTACT: one plain address goes into the User-Agent of BOTH reads
  // as `FIELD/1.0 - <address>`, trimmed; the response says only a word about it, never the address; anything that is not one plain address is not sent.
  // The address below is a placeholder on a reserved domain: it is never a real one.
  const ADDR = 'ops@example.com';
  const withAddr = await get('sport=aflw&date=2026-11-27', 'ok', { AFLAPI_CONTACT: `  ${ADDR}  ` });
  eq('A17 a set contact address is in the User-Agent of both reads, trimmed, name then " - " then the address last', [withAddr.status, uaOf(withAddr)], [200, [`FIELD/1.0 - ${ADDR}`, `FIELD/1.0 - ${ADDR}`]]);
  eq('A17 the response names the state and never the address (header, body)', [withAddr.headers.contact, withAddr.text.includes(ADDR), withAddr.text.includes('example.com')], ['set', false, false]);
  const noSeason = await get('sport=aflw&date=2027-08-01', 'ok', { AFLAPI_CONTACT: ADDR });
  eq('A17 the no-season answer carries the state too, and sends the address on the one read it made', [noSeason.headers.contact, uaOf(noSeason)], ['set', [`FIELD/1.0 - ${ADDR}`]]);
  eq('A17 with no secret the state is "unset" and the User-Agent is the name alone', [a.headers.contact, uaOf(a)], ['unset', ['FIELD/1.0', 'FIELD/1.0']]);
  eq('A17 both reads still ask for JSON (the Accept header survived the User-Agent change), with and without the address', [acceptOf(a), acceptOf(withAddr)], [['application/json', 'application/json'], ['application/json', 'application/json']]);
  const noSeasonUnset = await get('sport=aflw&date=2027-08-01'), noSeasonBad = await get('sport=aflw&date=2027-08-01', 'ok', { AFLAPI_CONTACT: 'not an address' });
  eq('A17 the no-season answer reports the state it is in, whatever it is: unset with no secret, invalid with a bad one', [noSeasonUnset.headers.contact, noSeasonBad.headers.contact], ['unset', 'invalid']);
  const refusedWithAddr = await get('sport=aflw&date=2026-11-27', '403', { AFLAPI_CONTACT: ADDR });
  const offWithAddr = await get('sport=aflw&date=2026-11-27', 'ok', { AFLAPI_CONTACT: ADDR, AFLW_FEED_OFF: '1' });
  eq('A17 the contact state is on the two 200 boards only: not on a 502, not on the off answer, even with the address set', [refusedWithAddr.status, refusedWithAddr.headers.contact, refusedWithAddr.headers.feed, offWithAddr.headers.contact], [502, null, null, null]);
  const BAD_ADDRS = [['not an address', 'words'], ['ops@example.com\r\nX-Injected: 1', 'a header injection'], ['mailto:ops@example.com', 'a scheme'], ['ops@example.com, ceo@example.com', 'two addresses'], ['Ops <ops@example.com>', 'an angle-bracket form'], ['ops@localhost', 'no dotted domain']];
  for (const [bad, what] of BAD_ADDRS) {
    const r = await get('sport=aflw&date=2026-11-27', 'ok', { AFLAPI_CONTACT: bad });
    eq(`A18 ${what} is not sent: User-Agent is the name alone, the state is "invalid", the games are still served`, [r.status, r.body?.count, uaOf(r), r.headers.contact], [200, 2, ['FIELD/1.0', 'FIELD/1.0'], 'invalid']);
  }
  const blank = await get('sport=aflw&date=2026-11-27', 'ok', { AFLAPI_CONTACT: '   ' });
  eq('A18 a blank secret is "unset", not "invalid"', [uaOf(blank), blank.headers.contact], [['FIELD/1.0', 'FIELD/1.0'], 'unset']);

  // A19-A21: the switch-off (ADR-004, approved 2026-11-27). The Worker secret AFLW_FEED_OFF, checked BEFORE anything is read: off is a 200 with no games and its reason,
  // zero requests to aflapi, a header that says so. It fails CLOSED: any non-empty value but 0, false or no (case-insensitive, trimmed) is off.
  const off = await get('sport=aflw&date=2026-11-27', 'ok', { AFLW_FEED_OFF: '1' });
  eq('A19 a set switch answers 200 with no games, its source and its reason', [off.status, { ...off.body, ts: 0 }], [200, { sport: 'aflw', date: '2026-11-27', games: [], count: 0, source: 'aflapi', note: 'aflw feed switched off', ts: 0 }]);
  eq('A19 a set switch makes no request to aflapi and says so in a header', [off.calls.length, off.headers.feed], [0, 'off']);
  eq('A19 an unset switch has no such header and reads aflapi as before', [gf.headers.feed, gf.calls.length, gf.body?.count], [null, 2, 2]);
  const offBroken = await get('sport=aflw&date=2026-11-27', '403', { AFLW_FEED_OFF: '1' });
  eq('A20 the switch is checked before the read: with aflapi refusing, an off feed is still the 200 answer and asks nothing', [offBroken.status, offBroken.body?.note, offBroken.calls.length], [200, 'aflw feed switched off', 0]);
  for (const v of ['1', 'true', 'TRUE', 'yes', 'on', 'OFF', 'x', ' 1 ']) {
    const r = await get('sport=aflw&date=2026-11-27', 'ok', { AFLW_FEED_OFF: v });
    eq(`A21 AFLW_FEED_OFF=${JSON.stringify(v)} is off (zero reads)`, [r.body?.note, r.calls.length], ['aflw feed switched off', 0]);
  }
  for (const v of ['', '   ', '0', 'false', 'FALSE', 'No', ' no ']) {
    const r = await get('sport=aflw&date=2026-11-27', 'ok', { AFLW_FEED_OFF: v });
    eq(`A21 AFLW_FEED_OFF=${JSON.stringify(v)} is not off (the feed reads as before)`, [r.body?.count, r.calls.length, r.headers.feed], [2, 2, null]);
  }

  // A22: a status read on 2026-11-27. The Grand Final's own status moved to UNCONFIRMED_TEAMS, which is before the match and is `pre`; CONFIRMED_TEAMS is documented elsewhere but unread from this host, so it is still a named 502 until the
  // Grand Final captures read it (CC-CMD Task 1, stage 2). A guessed state is a wrong card.
  const unconfirmed = await get('sport=aflw&date=2026-12-05');
  eq('A22 a match whose status is UNCONFIRMED_TEAMS is a pre game, with no score, NS and an empty clock', (unconfirmed.body?.games ?? []).map(g => [unconfirmed.status, g.aflapiMatchId, g.state, g.home.score, g.away.score, g.periodLabel, g.clock]), [[200, 9102, 'pre', null, null, 'NS', '']]);
  const confirmed = await get('sport=aflw&date=2026-12-06');
  eq('A22 CONFIRMED_TEAMS, unread from this host, is still a 502 naming it and the match, and the message lists what has been read', [confirmed.status, /"CONFIRMED_TEAMS" is not mapped \(match 9103\); only SCHEDULED, UNCONFIRMED_TEAMS, CONCLUDED have been read/.test(confirmed.body?.error ?? '')], [502, true]);

  // A23: the address is a secret of the owner's. A canary in the secret must not appear in ANY response (body, every header) or console line, on any path: a board, the no-season note, an upstream refusal, a thrown fetch, a non-JSON answer,
  // a paginated answer, an unmapped status, an invalid-shaped value, and the off answer. (A17 checks the one place it is meant to be sent: the outgoing User-Agent.)
  const CANARY = 'canary-leak-7f3a@example.com';
  for (const [what, query, mode, env] of [
    ['a served board', 'sport=aflw&date=2026-11-27', 'ok', { AFLAPI_CONTACT: CANARY }], ['the no-season note', 'sport=aflw&date=2027-08-01', 'ok', { AFLAPI_CONTACT: CANARY }],
    ['an upstream 403', 'sport=aflw&date=2026-11-27', '403', { AFLAPI_CONTACT: CANARY }], ['a thrown fetch', 'sport=aflw&date=2026-11-27', 'throw', { AFLAPI_CONTACT: CANARY }],
    ['a non-JSON answer', 'sport=aflw&date=2026-11-27', 'html', { AFLAPI_CONTACT: CANARY }], ['a paginated answer', 'sport=aflw&date=2026-11-27', 'paged', { AFLAPI_CONTACT: CANARY }],
    ['an unmapped status', 'sport=aflw&date=2026-11-26', 'live', { AFLAPI_CONTACT: CANARY }], ['a value that is not an address', 'sport=aflw&date=2026-11-27', 'ok', { AFLAPI_CONTACT: `${CANARY}, other@example.com` }],
    ['the off answer', 'sport=aflw&date=2026-11-27', 'ok', { AFLAPI_CONTACT: CANARY, AFLW_FEED_OFF: '1' }],
  ]) {
    const r = await get(query, mode, env);
    const seenIn = ['canary-leak-7f3a', 'example.com'].filter(w => (r.text + '\n' + r.allHeaders + '\n' + r.logs).includes(w));
    eq(`A23 the address is nowhere in the response or the console on ${what}`, [r.status > 0, seenIn], [true, []]);
  }

  // A24: the switch is for the AFLW feed alone, and its answer is the contract's: cached 60 s (that decides how soon the owner's flip back on shows), readable cross-origin, and it says nothing about the contact.
  const offNhl = await get('sport=nhl&date=2026-11-27', 'ok', { AFLW_FEED_OFF: '1' });
  eq('A24 the switch does not touch another sport: an NHL request with it set carries no aflw note and no feed header', [offNhl.body?.note === 'aflw feed switched off', offNhl.headers.feed], [false, null]);
  eq('A24 the off answer is cached 60 s and carries the CORS header', [off.headers.cache, off.headers.cors], ['public, max-age=60', '*']);

  // A25: the switch as a platform delivers it. A dashboard JSON variable or a wrangler.toml [vars] boolean is `true` or `1`, not a string; an off-switch that ignored it would fail OPEN.
  for (const [v, want] of [[true, true], [1, true], [2, true], [{ a: 1 }, true], [false, false], [0, false], [null, false], [undefined, false]]) {
    const r = await get('sport=aflw&date=2026-11-27', 'ok', { AFLW_FEED_OFF: v });
    eq(`A25 AFLW_FEED_OFF=${v === undefined ? 'undefined' : JSON.stringify(v)} (a ${v === null ? 'null' : typeof v}) is ${want ? 'off' : 'not off'}`, [r.calls.length === 0, r.headers.feed], want ? [true, 'off'] : [false, null]);
  }

  const missing = CASES.filter(c => !seenCases.has(c));
  if (missing.length) { failed++; console.log(`  FAIL coverage: case ${missing.join(', ')} did not run`); }
  console.log(`\nchecked ${CASES.length - missing.length} of ${CASES.length} cases (${assertions} assertions) of /v2/games?sport=aflw: a pre game, a final game, the ET day, no game, a stale SCHEDULED, an unmapped status, a 403, a thrown fetch, a non-JSON 200, a paginated answer, no season, caching, the key, one source, order, the season id, the contact address (set, padded, blank, six malformed forms, never echoed in any response, header or console line on nine paths, the Accept header kept, the state header on the two 200 boards only), the switch-off (checked before the read; fail-closed values including a boolean or a number; the reads it avoids; only the AFLW feed; the off answer's 60 s and CORS), the status UNCONFIRMED_TEAMS (pre) and CONFIRMED_TEAMS (still a named 502). Not checked: a secret set in a real Worker (the owner's step; the header X-FIELD-Aflapi-Contact on the deployed route says which state it is in), the live spelling, any period or clock (unread until 2026-11-27), the archive writer.`);
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
  ['a day with no season is a refusal', [["if (!season) return { games: [], note: `no ${year} season on aflapi` };", "if (!season) throw new Error('no season');"]]],
  // The contact address and the switch-off (ADR-004, 2026-11-27).
  ['the contact address is used without the shape check', [["return raw === '' ? 'unset' : isPlainAddress(raw) ? 'set' : 'invalid';", "return raw === '' ? 'unset' : 'set';"]]],
  ['the contact address is never sent', [["'User-Agent': aflapiContactState(env) === 'set' ?", "'User-Agent': false ?"]]],
  ['the contact address is sent untrimmed', [["`${AFLAPI_AGENT} - ${env.AFLAPI_CONTACT.trim()}`", "`${AFLAPI_AGENT} - ${env.AFLAPI_CONTACT}`"]]],
  ['the contact separator is not " - "', [["`${AFLAPI_AGENT} - ${env.AFLAPI_CONTACT.trim()}`", "`${AFLAPI_AGENT} / ${env.AFLAPI_CONTACT.trim()}`"]]],
  ['the season-list read drops the contact address', [["compseasons?pageSize=100`, 3600, env)", "compseasons?pageSize=100`, 3600)"]]],
  ['the matches read drops the contact address', [["&pageSize=200`, 30, env)", "&pageSize=200`, 30)"]]],
  ['the board read is not given the env by the route', [["await readAflapiBoard(cfg, date, AFLAPI_BASE, env);\n            if (note) {", "await readAflapiBoard(cfg, date, AFLAPI_BASE);\n            if (note) {"]]],
  ['the games answer says the state is always set', [["'Cache-Control': 'public, max-age=15', 'X-FIELD-Aflapi-Contact': aflapiContactState(env)", "'Cache-Control': 'public, max-age=15', 'X-FIELD-Aflapi-Contact': 'set'"]]],
  ['the games answer leaves the state out', [["'Cache-Control': 'public, max-age=15', 'X-FIELD-Aflapi-Contact': aflapiContactState(env)", "'Cache-Control': 'public, max-age=15'"]]],
  ['the no-season answer leaves the state out', [["'Cache-Control': 'public, max-age=300', 'X-FIELD-Aflapi-Contact': aflapiContactState(env)", "'Cache-Control': 'public, max-age=300'"]]],
  ['the switch is ignored by the route', [["if (aflwFeedOff(env)) {\n            return new Response(", "if (false) {\n            return new Response("]]],
  ['the switch is inverted', [["return v !== '' && v !== '0' && v !== 'false' && v !== 'no';", "return !(v !== '' && v !== '0' && v !== 'false' && v !== 'no');"]]],
  ['an unset switch reads as off', [["return v !== '' && v !== '0'", "return v !== '' || v !== '0'"]]],
  ['"0" reads as off', [["&& v !== '0'", ""]]],
  ['"false" reads as off', [["&& v !== 'false'", ""]]],
  ['"no" reads as off', [["&& v !== 'no';", ";"]]],
  ['the switch is case-sensitive', [["String(raw).trim().toLowerCase()", "String(raw).trim()"]]],
  ['the switch is not trimmed', [["String(raw).trim().toLowerCase()", "String(raw).toLowerCase()"]]],
  ['a non-string switch value is ignored (fails open)', [["const v = raw == null ? '' : String(raw).trim().toLowerCase();", "const v = typeof raw === 'string' ? raw.trim().toLowerCase() : '';"]]],
  ['an unset switch reads as the text undefined', [["const v = raw == null ? '' : String(raw).trim().toLowerCase();", "const v = String(raw).trim().toLowerCase();"]]],
  ['the switch is read above the per-sport branches and blanks every sport', [["    // ESPN-sourced sports (golf/PGA) bypass api-sports and route to ESPN scoreboard.\n", "    if (aflwFeedOff(env)) return new Response(JSON.stringify({ sport, date, games: [], count: 0, source: 'aflapi', note: 'aflw feed switched off', ts: Date.now() }), { headers: { ...CORS, 'Content-Type': 'application/json', 'X-FIELD-Aflapi-Feed': 'off' } });\n    // ESPN-sourced sports (golf/PGA) bypass api-sports and route to ESPN scoreboard.\n"]]],
  ['the off answer is cached for an hour', [["'Cache-Control': 'public, max-age=60', 'X-FIELD-Aflapi-Feed': 'off'", "'Cache-Control': 'public, max-age=3600', 'X-FIELD-Aflapi-Feed': 'off'"]]],
  ['the off answer loses its CORS header', [["{ headers: { ...CORS, 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=60', 'X-FIELD-Aflapi-Feed': 'off' } }", "{ headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=60', 'X-FIELD-Aflapi-Feed': 'off' } }"]]],
  ['the off answer carries the contact state', [["'Cache-Control': 'public, max-age=60', 'X-FIELD-Aflapi-Feed': 'off'", "'Cache-Control': 'public, max-age=60', 'X-FIELD-Aflapi-Feed': 'off', 'X-FIELD-Aflapi-Contact': aflapiContactState(env)"]]],
  ['the off answer echoes the address in a header', [["'Cache-Control': 'public, max-age=60', 'X-FIELD-Aflapi-Feed': 'off'", "'Cache-Control': 'public, max-age=60', 'X-FIELD-Aflapi-Feed': 'off', 'X-FIELD-Aflapi-Agent': String(env?.AFLAPI_CONTACT)"]]],
  ['the no-season answer says the state is always set', [["'Cache-Control': 'public, max-age=300', 'X-FIELD-Aflapi-Contact': aflapiContactState(env)", "'Cache-Control': 'public, max-age=300', 'X-FIELD-Aflapi-Contact': 'set'"]]],
  ['the 502 carries the contact state', [["{ status: 502, headers: { ...CORS, 'Content-Type': 'application/json' } });\n        }\n    }\n    // ", "{ status: 502, headers: { ...CORS, 'Content-Type': 'application/json', 'X-FIELD-Aflapi-Contact': aflapiContactState(env) } });\n        }\n    }\n    // "]]],
  ['the 502 body echoes the address', [["JSON.stringify({ error: e.message, sport, date }),\n                { status: 502, headers: { ...CORS, 'Content-Type': 'application/json' } });\n        }\n    }\n    // ", "JSON.stringify({ error: e.message, sport, date, agent: aflapiHeaders(env)['User-Agent'] }),\n                { status: 502, headers: { ...CORS, 'Content-Type': 'application/json' } });\n        }\n    }\n    // "]]],
  ['the address is logged on every read', [["    try { r = await fetch(u, { headers: aflapiHeaders(env),", "    console.log(aflapiHeaders(env)['User-Agent']);\n    try { r = await fetch(u, { headers: aflapiHeaders(env),"]]],
  ['the Accept header is dropped', [["    'Accept': 'application/json',\n    'User-Agent': aflapiContactState(env) === 'set'", "    'User-Agent': aflapiContactState(env) === 'set'"]]],
  ['UNCONFIRMED_TEAMS reads live', [["UNCONFIRMED_TEAMS: 'pre'", "UNCONFIRMED_TEAMS: 'live'"]]],
  ['UNCONFIRMED_TEAMS is unmapped again', [["UNCONFIRMED_TEAMS: 'pre', ", ""]]],
  ['CONFIRMED_TEAMS is mapped on a documented guess', [["UNCONFIRMED_TEAMS: 'pre', ", "UNCONFIRMED_TEAMS: 'pre', CONFIRMED_TEAMS: 'pre', "]]],
  ['the unmapped-status message stops listing the mapped ones', [["only ${Object.keys(AFLAPI_STATE).join(', ')} have been read", "only SCHEDULED and CONCLUDED have been read"]]],
  ['the switch off has no header', [["'Cache-Control': 'public, max-age=60', 'X-FIELD-Aflapi-Feed': 'off'", "'Cache-Control': 'public, max-age=60'"]]],
  ['the switch off has no reason', [["note: 'aflw feed switched off', ts: Date.now() }),\n                { headers: { ...CORS, 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=60'", "ts: Date.now() }),\n                { headers: { ...CORS, 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=60'"]]],
  ['the switch is read after aflapi has been asked', [["if (aflwFeedOff(env)) {\n            return new Response(", "if (false) {\n            return new Response("], ["await readAflapiBoard(cfg, date, AFLAPI_BASE, env);\n            if (note) {", "await readAflapiBoard(cfg, date, AFLAPI_BASE, env);\n            if (aflwFeedOff(env)) return new Response(JSON.stringify({ sport, date, games: [], count: 0, source: 'aflapi', note: 'aflw feed switched off', ts: Date.now() }), { headers: { ...CORS, 'Content-Type': 'application/json', 'X-FIELD-Aflapi-Feed': 'off' } });\n            if (note) {"]]],
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
