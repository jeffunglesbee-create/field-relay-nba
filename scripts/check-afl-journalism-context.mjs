#!/usr/bin/env node
/**
 * The AFL journalism context on GET /v2/games?sport=afl: every game gets the tip that is ITS OWN, in the year and the round it is played in.
 * docs/CC-CMD-2026-11-24-afl-finals-round-and-journalism-club-match.md, Parts A, B and D (and C: finals, below).
 *
 * WHY. `buildAFLJournalismContext` (src/index.js) joins a Kali or Squiggle row to an ESPN game. Measured on the deployed relay, 2026-11-24:
 *   - `GWS GIANTS v Geelong Cats` (2026-07-11) carried `journalism.squiggle: null` while the three other games that day carried values: ESPN says
 *     "GWS GIANTS", Squiggle says "Greater Western Sydney", and the join was teamNameMatch's prefix rule plus a private nickname-stripping copy.
 *   - the Opening Round games (2026-03-05, 2026-03-06) carried no `journalism` key at all: `if (!round ...) return {}` reads round 0 as no round.
 *   - the year is the constant `season: 2026` of the AFL config, so in 2027 the relay would ask Squiggle for 2026's tips.
 * The join clauses that matched the HOME club alone are gone too: a row whose opponent is not the game's opponent is not that game.
 *
 * THIS RUNS THE ROUTE: the real src/index.js default export on GET /v2/games?sport=afl&date=..., with KALI_AFL_TOKEN and a Map KV set (the journalism
 * block is gated on the token), over a pinned clock and a fetch stub that serves ESPN's scoreboard, Squiggle's tips and Kali's predictions. The
 * slates are the real ones (relay /v2/games 2026-07-05..12, the ESPN names as served, Squiggle's round-18 and round-0 Aggregate rows as served by
 * `?q=tips;year=2026;round=N;source=8` on 2026-11-24).
 *
 * INDEX_MODULE points the worker elsewhere; scripts/mutate-afl-journalism-context.mjs uses it.
 */
import { register } from 'node:module';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

register('data:text/javascript,' + encodeURIComponent(
  "export async function resolve(s, c, next) { if (s === '@cloudflare/puppeteer') return { url: 'data:text/javascript,export default {}', shortCircuit: true }; return next(s, c); }"));

const RealDate = Date;
let CLOCK = RealDate.parse('2026-11-24T12:00:00Z');
class PinnedDate extends RealDate {
  constructor(...a) { if (a.length) super(...a); else super(CLOCK); }
  static now() { return CLOCK; }
}
globalThis.Date = PinnedDate;

const INDEX = resolve(process.env.INDEX_MODULE || 'src/index.js');
const worker = (await import(pathToFileURL(INDEX).href)).default;

// ── fixtures ────────────────────────────────────────────────────────────────────────────────────────────────────────
// An ESPN scoreboard event, the fields adaptESPNBasketball and the journalism join read. `season` is what ESPN serves per EVENT.
const ev = (id, utc, round, home, away, season = { year: 2026, type: 2, slug: 'regular-season' }) => ({
  id, date: utc, week: round === null ? undefined : { number: round }, ...(season ? { season } : {}),
  competitions: [{ status: { period: 4, displayClock: '0:00', type: { name: 'STATUS_FINAL', state: 'post' } },
    competitors: [
      { homeAway: 'home', score: '90', team: { displayName: home, abbreviation: home.slice(0, 3).toUpperCase() } },
      { homeAway: 'away', score: '80', team: { displayName: away, abbreviation: away.slice(0, 3).toUpperCase() } },
    ] }],
});
// ESPN, by the UTC date the relay asks for. Names are ESPN's displayNames as the relay served them.
const SLATES = {
  '20260711': [ev('1133632', '2026-07-11T03:15Z', 18, 'St Kilda', 'Port Adelaide'), ev('1133630', '2026-07-11T06:15Z', 18, 'GWS GIANTS', 'Geelong Cats'),
               ev('1133628', '2026-07-11T09:35Z', 18, 'Carlton', 'Hawthorn'), ev('1133634', '2026-07-11T10:10Z', 18, 'Adelaide Crows', 'Gold Coast SUNS')],
  '20260709': [ev('1133635', '2026-07-09T10:10Z', 18, 'Fremantle', 'Sydney Swans')],
  '20260305': [ev('1133483', '2026-03-05T08:30Z', 0, 'Sydney Swans', 'Carlton'), ev('1133484', '2026-03-06T09:05Z', 0, 'Gold Coast SUNS', 'Geelong Cats')],
  // Synthetic: a round whose home clubs are North Melbourne and Melbourne, listed so that Squiggle's row for the second comes first.
  '20260718': [ev('9000001', '2026-07-18T03:15Z', 19, 'North Melbourne', 'Collingwood'), ev('9000002', '2026-07-18T06:15Z', 19, 'Melbourne', 'Richmond')],
  // Synthetic: ESPN's home club is Hawthorn; Squiggle's row lists Carlton as the home club (the clubs the other way round).
  '20260725': [ev('9000003', '2026-07-25T03:15Z', 20, 'Hawthorn', 'Carlton')],
  // 2027, to see the year follow the event and the clock. Round 1: the Opening Round is gone from 2027 (Squiggle docs, read 2026-11-24).
  '20270312': [ev('9100001', '2027-03-12T08:35Z', 1, 'Carlton', 'Richmond', { year: 2027, type: 2, slug: 'regular-season' })],
  '20270313': [ev('9100002', '2027-03-13T08:35Z', 1, 'Geelong Cats', 'Hawthorn', null)],   // an event that carries no season: the clock's year
};
// Squiggle's Aggregate rows, `?q=tips;year=Y;round=R` (the shape served; real values for round 18 and round 0).
const tip = (gameid, date, round, hteam, hteamid, ateam, ateamid, hconf, year = 2026) =>
  ({ gameid, date, round, year, hteam, hteamid, ateam, ateamid, hconfidence: hconf, confidence: Number(hconf) >= 50 ? hconf : (100 - Number(hconf)).toFixed(2), source: 'Aggregate', sourceid: 8 });
const TIPS = {
  '2026:18': [{ ...tip(38643, '2026-07-11 13:15:00', 18, 'St Kilda', 15, 'Port Adelaide', 13, '10.00'), source: 'Spline', sourceid: 1 },   // a decoy source for the game below, listed before the real row
              tip(38645, '2026-07-11 20:10:00', 18, 'Adelaide', 1, 'Gold Coast', 8, '72.30'), tip(38638, '2026-07-12 16:40:00', 18, 'Brisbane Lions', 2, 'Essendon', 5, '93.54'),
              tip(38639, '2026-07-11 19:35:00', 18, 'Carlton', 3, 'Hawthorn', 10, '39.14'), tip(38640, '2026-07-10 19:40:00', 18, 'Collingwood', 4, 'North Melbourne', 12, '72.11'),
              tip(38646, '2026-07-09 20:10:00', 18, 'Fremantle', 6, 'Sydney', 16, '64.07'), tip(38641, '2026-07-11 16:15:00', 18, 'Greater Western Sydney', 9, 'Geelong', 7, '42.16'),
              tip(38642, '2026-07-12 15:15:00', 18, 'Melbourne', 11, 'Richmond', 14, '87.54'), tip(38643, '2026-07-11 13:15:00', 18, 'St Kilda', 15, 'Port Adelaide', 13, '62.49'),
              { ...tip(38643, '2026-07-11 13:15:00', 18, 'St Kilda', 15, 'Port Adelaide', 13, '11.00'), source: 'Punters', sourceid: 5 }],   // and one listed after it: an unfiltered loop would let the later row win
  '2026:0':  [tip(38497, '2026-03-07 19:35:00', 0, 'Brisbane Lions', 2, 'Western Bulldogs', 18, '63.39'), tip(38495, '2026-03-06 20:05:00', 0, 'Gold Coast', 8, 'Geelong', 7, '47.22'),
              tip(38496, '2026-03-07 16:15:00', 0, 'Greater Western Sydney', 9, 'Hawthorn', 10, '45.71'), tip(38498, '2026-03-08 19:20:00', 0, 'St Kilda', 15, 'Collingwood', 4, '35.66'),
              tip(38494, '2026-03-05 19:30:00', 0, 'Sydney', 16, 'Carlton', 3, '64.91')],
  // the row for Melbourne v Richmond comes BEFORE North Melbourne v Collingwood's; a third row has a home club that plays a different opponent in the slate
  '2026:19': [tip(39001, '2026-07-18 15:15:00', 19, 'Melbourne', 11, 'Richmond', 14, '66.60'), tip(39000, '2026-07-18 13:15:00', 19, 'North Melbourne', 12, 'Collingwood', 4, '31.40'),
              tip(39002, '2026-07-18 16:15:00', 19, 'Collingwood', 4, 'Geelong', 7, '50.50'),
              tip(39004, '2026-07-18 14:15:00', 19, 'North Melbourne', 12, 'Geelong', 7, '44.00')],   // North Melbourne's home row against a DIFFERENT opponent, listed after the real one
  '2026:20': [tip(39003, '2026-07-25 13:15:00', 20, 'Carlton', 3, 'Hawthorn', 10, '60.00')],
  '2027:1':  [tip(40001, '2027-03-12 19:35:00', 1, 'Carlton', 3, 'Richmond', 14, '51.00', 2027), tip(40002, '2027-03-13 19:35:00', 1, 'Geelong', 7, 'Hawthorn', 10, '58.00', 2027)],
};
// Kali's /predictions, in Kali's own namespace (outbox/kali-predictions.txt: 'Brisbane', 'Sydney', ...; 0-100 percentages).
const KALI = { '2026:18': [{ homeTeam: 'Fremantle', awayTeam: 'Sydney', homeProbability: 61.2, awayProbability: 38.8, squiggleConsensus: 64.07, factors: [], homeBreakdown: {}, awayBreakdown: {} }],
               '2026:20': [{ homeTeam: 'Carlton', awayTeam: 'Hawthorn', homeProbability: 55, awayProbability: 45, squiggleConsensus: 60, factors: [], homeBreakdown: {}, awayBreakdown: {} }] };

// ── the stub ────────────────────────────────────────────────────────────────────────────────────────────────────────
let seen;
console.warn = () => {}; console.error = () => {};
globalThis.fetch = async (input, init = {}) => {
  const url = String(typeof input === 'string' ? input : input.url);
  seen.push({ url, init });
  if (url.includes('/australian-football/afl/scoreboard?dates=')) {
    const d = /dates=(\d{8})/.exec(url)[1];
    return Response.json({ events: SLATES[d] || [] });
  }
  if (url.startsWith('https://api.squiggle.com.au/')) {
    const m = /q=tips;year=(\d+);round=(\d+)/.exec(url);
    return Response.json({ tips: (m && TIPS[`${m[1]}:${m[2]}`]) || [] });
  }
  if (url.startsWith('https://kaliaflstats.com/')) {
    if (kaliMode === 'holding') return new Response('<!doctype html><title>kali-afl — back in 2027</title>', { status: 200 });
    const m = /year=(\d+)&round=(\d+)/.exec(url);
    return Response.json({ data: (m && KALI[`${m[1]}:${m[2]}`]) || [] });
  }
  throw new Error('check: an unexpected fetch to ' + url);
};
let kaliMode = 'holding';
const kv = () => { const m = new Map(); return { get: async k => (m.has(k) ? m.get(k) : null), put: async (k, v) => { m.set(k, v); } }; };

// GET /v2/games?sport=afl&date=D through the real worker. `kali`: 'holding' (the page Kali's host serves now), 'json' (predictions served).
async function get(date, { token = true, kali = 'holding', clock = '2026-11-24T12:00:00Z' } = {}) {
  seen = []; kaliMode = kali; CLOCK = RealDate.parse(clock);
  const env = { ...(token ? { KALI_AFL_TOKEN: 'k', KALI_CACHE: kv() } : {}) };
  const waits = [];
  const r = await worker.fetch(new Request(`http://relay.test/v2/games?sport=afl&date=${date}`), env, { waitUntil: p => waits.push(p), passThroughOnException() {} });
  await Promise.allSettled(waits);
  let body = null; try { body = await r.json(); } catch (_) { /* not JSON */ }
  const sq = seen.map(s => s.url).filter(u => u.startsWith('https://api.squiggle.com.au/')).map(u => u.slice('https://api.squiggle.com.au/'.length));
  const ka = seen.map(s => s.url).filter(u => u.startsWith('https://kaliaflstats.com/')).map(u => u.slice('https://kaliaflstats.com/api/afl/v1'.length));
  return { status: r.status, body, squiggle: sq, kali: ka, games: body?.games ?? [] };
}
const byHome = (res, home) => res.games.find(g => g.home.name === home) || null;
const sqOf = (g) => g && g.journalism ? g.journalism.squiggle : undefined;
// The served tip as [home, away] to two decimals (the home value is served as Squiggle's string, the away as a number).
const pair = (s) => s ? [String(s.homeConfidence), Number(s.awayConfidence).toFixed(2)] : s;

// ── assertions ──────────────────────────────────────────────────────────────────────────────────────────────────────
let passed = 0, total = 0;
const eq = (name, got, want) => {
  total++; const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { passed++; return; }
  console.log(`FAIL  ${name}\n        got  ${g}\n        want ${w}`);
};

// Part A: a game gets the tip of its own clubs, whatever the spelling (ESPN "GWS GIANTS", Squiggle "Greater Western Sydney").
const r1 = await get('2026-07-11');
eq('J1 the day is served, four games', [r1.status, r1.games.length], [200, 4]);
eq('J2 GWS GIANTS v Geelong Cats gets Squiggle\'s "Greater Western Sydney" v "Geelong" tip (42.16): the game that carried null', pair(sqOf(byHome(r1, 'GWS GIANTS'))), ['42.16', '57.84']);
eq('J3 the other three games get their own tips', [pair(sqOf(byHome(r1, 'St Kilda'))), pair(sqOf(byHome(r1, 'Carlton'))), pair(sqOf(byHome(r1, 'Adelaide Crows')))],
   [['62.49', '37.51'], ['39.14', '60.86'], ['72.30', '27.70']]);
eq('J4 one Squiggle read, for 2026 round 18, and one Kali read for the same year and round', [r1.squiggle, r1.kali], [['?q=tips;year=2026;round=18'], ['/predictions?year=2026&round=18']]);
eq('J5 Kali answering with its holding page leaves kali null and Squiggle served (the state of the world now)', byHome(r1, 'St Kilda')?.journalism?.kali, null);

// A row joins a game only when BOTH clubs are the game's clubs: Squiggle's list also has Collingwood v Geelong and North Melbourne v Geelong, and the slate has North Melbourne v Collingwood.
const r2 = await get('2026-07-18');
eq('J6 North Melbourne v Collingwood gets its own tip (31.40) and Melbourne v Richmond its own (66.60), although Melbourne\'s row is listed first',
   [pair(sqOf(byHome(r2, 'North Melbourne'))), pair(sqOf(byHome(r2, 'Melbourne')))], [['31.40', '68.60'], ['66.60', '33.40']]);

// Part B: round 0 is a round. The Opening Round games carried no `journalism` key at all.
const r3 = await get('2026-03-05');
eq('J7 an Opening Round game (round 0) carries a journalism key, and its tip', [pair(sqOf(byHome(r3, 'Sydney Swans'))), pair(sqOf(byHome(r3, 'Gold Coast SUNS')))], [['64.91', '35.09'], ['47.22', '52.78']]);
eq('J8 ... read for round 0', r3.squiggle, ['?q=tips;year=2026;round=0']);

// Part D: the year is the event's, and without one the clock's. It was the constant 2026.
const r4 = await get('2027-03-12');
eq('J9 a 2027 game asks Squiggle for 2027 although the clock says 2026 (the event says season.year 2027), and gets that year\'s tip', [r4.squiggle, pair(sqOf(byHome(r4, 'Carlton')))], [['?q=tips;year=2027;round=1'], ['51.00', '49.00']]);
const r5 = await get('2027-03-13', { clock: '2027-03-13T10:00:00Z' });
eq('J10 an event that carries no season takes the clock\'s year, not 2026', [r5.squiggle, pair(sqOf(byHome(r5, 'Geelong Cats')))], [['?q=tips;year=2027;round=1'], ['58.00', '42.00']]);

// Kali's own names ('Sydney') join the same game as ESPN's ('Sydney Swans').
const r6 = await get('2026-07-09', { kali: 'json' });
eq('J11 Kali\'s "Fremantle" v "Sydney" prediction joins Fremantle v Sydney Swans (61.2 / 38.8) and so does Squiggle\'s (64.07)',
   [byHome(r6, 'Fremantle')?.journalism?.kali?.homeWinPct, byHome(r6, 'Fremantle')?.journalism?.kali?.awayWinPct, pair(sqOf(byHome(r6, 'Fremantle')))], [61.2, 38.8, ['64.07', '35.93']]);

// A row that lists the clubs the other way round to ESPN's game puts each side's value on the right club.
const r8 = await get('2026-07-25', { kali: 'json' });
eq('J13 Squiggle\'s "Carlton v Hawthorn" 60.00 on ESPN\'s Hawthorn v Carlton gives Hawthorn 40.00 and Carlton 60.00; Kali\'s 55/45 swaps the same way',
   [pair(sqOf(byHome(r8, 'Hawthorn'))), byHome(r8, 'Hawthorn')?.journalism?.kali?.homeWinPct, byHome(r8, 'Hawthorn')?.journalism?.kali?.awayWinPct], [['40.00', '60.00'], 45, 55]);

// The gate is unchanged: no Kali token, no journalism context and no Kali or Squiggle read.
const r7 = await get('2026-07-11', { token: false });
eq('J12 without KALI_AFL_TOKEN no game carries a journalism key and nothing is asked of Kali or Squiggle', [r7.games.some(g => 'journalism' in g), r7.squiggle, r7.kali], [false, [], []]);

console.log(`COVERAGE: ${total} assertions through the real GET /v2/games?sport=afl, KALI_AFL_TOKEN set, a pinned clock (2026-11-24, and 2027-03-13), the 2026-07-11, -07-09, -03-05 slates as the relay served them (ESPN names, Squiggle's Aggregate rows), one synthetic slate (07-18) for the join, and 2027 fixtures for the year. Not covered here: finals (Part C), the Kali branch's team names beyond 'Fremantle'/'Sydney' (8 of 18 recorded, offline until 2027) and the client.`);
console.log(`${passed} of ${total} passed.`);
globalThis.Date = RealDate;
process.exit(passed === total ? 0 : 1);
