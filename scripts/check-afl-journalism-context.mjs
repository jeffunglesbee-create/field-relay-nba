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
 *   - FINALS (Part C): ESPN restarts its week at 1 for the postseason and marks each final's EVENT season.type 3; Squiggle numbers the finals 25-29. The relay
 *     asked Squiggle for ESPN's week, so a September final was served a March game's tip (2026-09-05 Adelaide v Western Bulldogs: 47.29 for the Bulldogs, in
 *     March; the final's own tip is 68.60 for Adelaide). A final's tip is now the row of its own two clubs and kickoff day, and Kali is not asked for it.
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
import { resolve, dirname } from 'node:path';

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
// The Squiggle module sitting next to the worker under test, so a mutant of it (scripts/mutate-afl-journalism-context.mjs copies src/ with one file changed) is the one measured.
const squiggleModule = await import(pathToFileURL(resolve(dirname(INDEX), 'afl-squiggle.js')).href);

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
const POST = { year: 2026, type: 3, slug: 'post-season' };
const SLATES = {
  '20260711': [ev('1133632', '2026-07-11T03:15Z', 18, 'St Kilda', 'Port Adelaide'), ev('1133630', '2026-07-11T06:15Z', 18, 'GWS GIANTS', 'Geelong Cats'),
               ev('1133628', '2026-07-11T09:35Z', 18, 'Carlton', 'Hawthorn'), ev('1133634', '2026-07-11T10:10Z', 18, 'Adelaide Crows', 'Gold Coast SUNS')],
  '20260709': [ev('1133635', '2026-07-09T10:10Z', 18, 'Fremantle', 'Sydney Swans')],
  '20260305': [ev('1133483', '2026-03-05T08:30Z', 0, 'Sydney Swans', 'Carlton'), ev('1133484', '2026-03-06T09:05Z', 0, 'Gold Coast SUNS', 'Geelong Cats')],
  // Synthetic: a round whose home clubs are North Melbourne and Melbourne, listed so that Squiggle's row for the second comes first.
  '20260718': [ev('9000001', '2026-07-18T03:15Z', 19, 'North Melbourne', 'Collingwood'), ev('9000002', '2026-07-18T06:15Z', 19, 'Melbourne', 'Richmond')],
  // Synthetic: ESPN's home club is Hawthorn; Squiggle's row lists Carlton as the home club (the clubs the other way round).
  '20260725': [ev('9000003', '2026-07-25T03:15Z', 20, 'Hawthorn', 'Carlton')],
  // FINALS, real: ESPN's own event.season is {type 3, slug 'post-season'} and its week restarts at 1 (read 2026-11-24, one day per read).
  '20260828': [ev('1133705', '2026-08-28T09:40Z', 1, 'Western Bulldogs', 'Collingwood', POST)],
  '20260905': [ev('1133702', '2026-09-05T05:15Z', 2, 'Sydney Swans', 'Brisbane Lions', POST), ev('1133703', '2026-09-05T09:35Z', 2, 'Adelaide Crows', 'Western Bulldogs', POST)],
  '20260926': [ev('1133711', '2026-09-26T04:30Z', 5, 'Fremantle', 'Brisbane Lions', POST)],
  // FINALS, synthetic. 2025: GWS at home in the first week (the club whose ESPN and Squiggle names differ), season year 2025.
  '20250906': [ev('8000001', '2025-09-06T05:15Z', 1, 'GWS GIANTS', 'Hawthorn', { year: 2025, type: 3, slug: 'post-season' })],
  // A night final: 15:00Z is 01:00 the NEXT day in Melbourne, so Squiggle's date is 2026-09-06 although the UTC day is 09-05 (real kickoffs are 03:00-10:30Z).
  '20260907': [ev('8000002', '2026-09-05T15:00Z', 2, 'Collingwood', 'Carlton', POST)],
  // A final Squiggle has no tip for (none yet, or the game moved to another day).
  '20260908': [ev('8000003', '2026-09-08T09:35Z', 3, 'Geelong Cats', 'Brisbane Lions', POST)],
  // 2027, to see the year follow the event and the clock. Round 1: the Opening Round is gone from 2027 (Squiggle docs, read 2026-11-24).
  // Synthetic: a final whose ESPN home club (Carlton) is the AWAY club in Squiggle's row (Melbourne v Carlton, real, 2026-08-29 19:35 Melbourne): the clubs the other way round.
  '20260830': [ev('8000004', '2026-08-29T09:35Z', 1, 'Carlton', 'Melbourne', POST)],
  // Synthetic: a regular slate whose FIRST game carries no week (ESPN omitted it) and whose second is round 21: the round is the first game that has one.
  '20260801': [ev('9000010', '2026-08-01T03:15Z', null, 'Carlton', 'Hawthorn'), ev('9000011', '2026-08-01T06:15Z', 21, 'Richmond', 'Essendon')],
  // Synthetic: a regular slate whose only game carries no week: no round to read, no finals, so no journalism at all.
  '20260802': [ev('9000012', '2026-08-02T03:15Z', null, 'Carlton', 'Hawthorn')],
  // Synthetic finals the lookup cannot place: a club the team table does not have, and a final with no kickoff.
  '20260909': [ev('8000005', '2026-09-09T09:35Z', 3, 'Tasmania Devils', 'Geelong Cats', POST)],
  '20260910': [{ ...ev('8000006', '2026-09-10T09:35Z', 3, 'Geelong Cats', 'Carlton', POST), date: undefined }],
  // Synthetic 2027: the FIRST game carries no season, the second one does: the year is the first integer among the events' seasons, not the first event's.
  '20270314': [ev('9100003', '2027-03-14T08:35Z', 1, 'Carlton', 'Geelong Cats', null), ev('9100004', '2027-03-14T05:15Z', 1, 'Richmond', 'Hawthorn', { year: 2027, type: 2, slug: 'regular-season' })],
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
  // DECOYS: what the round-based route serves for ESPN's finals WEEKS (1, 2, 3, 5): March's rounds. A final answered through ESPN's week reads one of these, so a regression
  // that falls back to the round read fails with the wrong value (round 2 is the real March Adelaide v Western Bulldogs row, 47.29), not merely with a null.
  '2026:1': [tip(38501, '2026-03-12 19:40:00', 1, 'Western Bulldogs', 18, 'Collingwood', 4, '12.34')],
  '2026:2': [tip(38509, '2026-03-20 19:40:00', 2, 'Adelaide', 1, 'Western Bulldogs', 18, '47.29'), tip(38601, '2026-03-21 19:40:00', 2, 'Sydney', 16, 'Brisbane Lions', 2, '71.48')],
  '2026:3': [tip(38602, '2026-03-28 19:40:00', 3, 'Geelong', 7, 'Brisbane Lions', 2, '33.00')],
  '2026:5': [tip(38505, '2026-04-10 19:40:00', 5, 'Fremantle', 6, 'Brisbane Lions', 2, '33.33')],
  '2026:21': [tip(39010, '2026-08-01 16:15:00', 21, 'Richmond', 14, 'Essendon', 5, '55.55')],
  '2026:20': [tip(39003, '2026-07-25 13:15:00', 20, 'Carlton', 3, 'Hawthorn', 10, '60.00')],
  '2027:1':  [tip(40003, '2027-03-14 15:15:00', 1, 'Richmond', 14, 'Hawthorn', 10, '48.00', 2027), tip(40001, '2027-03-12 19:35:00', 1, 'Carlton', 3, 'Richmond', 14, '51.00', 2027), tip(40002, '2027-03-13 19:35:00', 1, 'Geelong', 7, 'Hawthorn', 10, '58.00', 2027)],
};
// Squiggle's Aggregate rows by CLUB, `?q=tips;year=Y;team=T;source=8` (the club's whole season, in date order, so March comes before September). The finals rows
// are the real ones (rounds 25-29, read 2026-11-24); the March rows are real for Adelaide v Western Bulldogs (round 2, 47.29: the tip the old code served on
// 2026-09-05) and synthetic for the others (a March round-3 Sydney v Brisbane Lions, a decoy for the finals of the same two clubs).
const SEASON_ROWS = [
  tip(38509, '2026-03-20 19:40:00', 2, 'Adelaide', 1, 'Western Bulldogs', 18, '47.29'), tip(38600, '2026-03-27 19:40:00', 3, 'Sydney', 16, 'Brisbane Lions', 2, '71.48'),
  tip(38720, '2026-08-28 19:40:00', 25, 'Western Bulldogs', 18, 'Collingwood', 4, '47.20'), tip(38719, '2026-08-29 19:35:00', 25, 'Melbourne', 11, 'Carlton', 3, '55.66'),
  tip(38802, '2026-09-05 13:15:00', 26, 'Adelaide', 1, 'Carlton', 3, '70.00'),                                   // synthetic decoy: Adelaide on the same day against ANOTHER club, listed before the final
  tip(38723, '2026-09-03 20:10:00', 26, 'Fremantle', 6, 'Hawthorn', 10, '66.02'), tip(38721, '2026-09-04 19:40:00', 26, 'Geelong', 7, 'Carlton', 3, '62.47'),
  tip(38724, '2026-09-05 15:15:00', 26, 'Sydney', 16, 'Brisbane Lions', 2, '50.61'), tip(38722, '2026-09-05 19:35:00', 26, 'Adelaide', 1, 'Western Bulldogs', 18, '68.60'),
  { ...tip(38722, '2026-09-05 19:35:00', 26, 'Adelaide', 1, 'Western Bulldogs', 18, '20.00'), source: 'Punters', sourceid: 5 },   // synthetic decoy: another source for the same game (the stub, unlike Squiggle, does not filter source=8)
  tip(38725, '2026-09-11 20:10:00', 27, 'Fremantle', 6, 'Geelong', 7, '58.91'), tip(38726, '2026-09-12 19:35:00', 27, 'Brisbane Lions', 2, 'Adelaide', 1, '69.35'),
  tip(38728, '2026-09-18 19:40:00', 28, 'Sydney', 16, 'Fremantle', 6, '59.00'), tip(38727, '2026-09-19 17:15:00', 28, 'Hawthorn', 10, 'Brisbane Lions', 2, '55.20'),
  tip(38729, '2026-09-26 14:30:00', 29, 'Fremantle', 6, 'Brisbane Lions', 2, '48.51'),
  tip(38800, '2026-09-06 01:00:00', 26, 'Collingwood', 4, 'Carlton', 3, '52.50'),                                  // synthetic: the night final's row, dated in Melbourne
  { ...tip(38801, '2026-09-08 19:35:00', 27, 'Geelong', 7, 'Brisbane Lions', 2, '40.40'), date: '2026-09-09 19:35:00' },   // synthetic: moved to another DAY than ESPN's
  tip(37315, '2025-09-06 15:15:00', 25, 'Greater Western Sydney', 9, 'Hawthorn', 10, '51.74', 2025),                // REAL (Squiggle ?q=tips;year=2025;round=25;source=8, read 2026-11-25): 2025, the club whose two names differ
];
// Kali's /predictions, in Kali's own namespace (outbox/kali-predictions.txt: 'Brisbane', 'Sydney', ...; 0-100 percentages).
// The VALUES are invented, and 'Fremantle' is not among the recorded names (Sydney and Carlton are): this exercises the join, not Kali.
const KALI = { '2026:18': [{ homeTeam: 'Fremantle', awayTeam: 'Sydney', homeProbability: 61.2, awayProbability: 38.8, squiggleConsensus: 64.07, factors: [], homeBreakdown: {}, awayBreakdown: {} }],
               '2026:20': [{ homeTeam: 'Carlton', awayTeam: 'Hawthorn', homeProbability: 55, awayProbability: 45, squiggleConsensus: 60, factors: [], homeBreakdown: {}, awayBreakdown: {} }] };

// ── the stub ────────────────────────────────────────────────────────────────────────────────────────────────────────
let seen;
let warns = [];
console.warn = (...a) => { warns.push(a.map(String).join(' ')); }; console.error = () => {};
globalThis.fetch = async (input, init = {}) => {
  const url = String(typeof input === 'string' ? input : input.url);
  seen.push({ url, init });
  if (url.includes('/australian-football/afl/scoreboard?dates=')) {
    const d = /dates=(\d{8})/.exec(url)[1];
    return Response.json({ events: SLATES[d] || [] });
  }
  if (url.startsWith('https://api.squiggle.com.au/') && /;team=(\d+);source=8/.test(url)) {
    if (squiggleMode === '503') return new Response('{}', { status: 503 });
    if (squiggleMode === 'badjson') return new Response('<!doctype html><title>Squiggle is down for maintenance</title>', { status: 200 });
    if (squiggleMode === 'reject') throw new TypeError('network down');
    if (squiggleMode === 'object') return Response.json({ tips: { error: 'rate limited' } });
    const [, year, team] = /year=(\d+);team=(\d+);source=8/.exec(url);
    let rows = SEASON_ROWS.filter(r => String(r.year) === year && (r.hteamid === Number(team) || r.ateamid === Number(team)));
    if (squiggleMode === 'nullrow') rows = [null, ...rows];                                              // a null entry in the array, ahead of the real rows
    if (squiggleMode === 'dup') rows = rows.flatMap(r => [r, { ...r, gameid: r.gameid + 100000 }]);       // every row twice: the same pair on the same day twice
    if (squiggleMode === 'noconf') rows = rows.map(r => ({ ...r, hconfidence: null }));                  // a tip not yet computed
    return Response.json({ tips: rows });
  }
  if (url.startsWith('https://api.squiggle.com.au/')) {
    const m = /q=tips;year=(\d+);round=(\d+)/.exec(url);
    let rows = (m && TIPS[`${m[1]}:${m[2]}`]) || [];
    if (squiggleMode === 'noconf') rows = rows.map(r => ({ ...r, hconfidence: null }));
    return Response.json({ tips: rows });
  }
  if (url.startsWith('https://kaliaflstats.com/')) {
    if (kaliMode === 'holding') return new Response('<!doctype html><title>kali-afl — back in 2027</title>', { status: 200 });
    const m = /year=(\d+)&round=(\d+)/.exec(url);
    return Response.json({ data: (m && KALI[`${m[1]}:${m[2]}`]) || [] });
  }
  throw new Error('check: an unexpected fetch to ' + url);
};
let kaliMode = 'holding';
let squiggleMode = 'ok';
const kv = () => { const m = new Map(); return { get: async k => (m.has(k) ? m.get(k) : null), put: async (k, v) => { m.set(k, v); } }; };

// GET /v2/games?sport=afl&date=D through the real worker. `kali`: 'holding' (the page Kali's host serves now), 'json' (predictions served).
async function get(date, { token = true, kali = 'holding', clock = '2026-11-24T12:00:00Z', squiggle = 'ok' } = {}) {
  seen = []; warns = []; kaliMode = kali; squiggleMode = squiggle; CLOCK = RealDate.parse(clock);
  const env = { ...(token ? { KALI_AFL_TOKEN: 'k', KALI_CACHE: kv() } : {}) };
  const waits = [];
  const r = await worker.fetch(new Request(`http://relay.test/v2/games?sport=afl&date=${date}`), env, { waitUntil: p => waits.push(p), passThroughOnException() {} });
  await Promise.allSettled(waits);
  let body = null; try { body = await r.json(); } catch (_) { /* not JSON */ }
  const sq = seen.map(s => s.url).filter(u => u.startsWith('https://api.squiggle.com.au/')).map(u => u.slice('https://api.squiggle.com.au/'.length));
  const ka = seen.map(s => s.url).filter(u => u.startsWith('https://kaliaflstats.com/')).map(u => u.slice('https://kaliaflstats.com/api/afl/v1'.length));
  const cacheKeys = seen.filter(s => s.url.startsWith('https://api.squiggle.com.au/')).map(s => s.init?.cf?.cacheKey);
  const signals = seen.filter(s => s.url.startsWith('https://api.squiggle.com.au/') && /;team=\d+/.test(s.url)).map(s => !!(s.init && s.init.signal));
  const sqReads = seen.filter(s => s.url.startsWith('https://api.squiggle.com.au/'));
  const cf = sqReads.map(s => [s.init?.cf?.cacheTtl, s.init?.cf?.cacheEverything]);
  const ua = sqReads.map(s => [s.init?.headers?.Accept, String(s.init?.headers?.['User-Agent']).startsWith('FIELD-Global-Sports-Intelligence/')]);
  return { status: r.status, body, squiggle: sq, kali: ka, games: body?.games ?? [], warns: [...warns], cacheKeys, signals, cf, ua };
}
const byHome = (res, home) => res.games.find(g => g.home.name === home) || null;
// 'NO-JOURNALISM-KEY' is its own value: JSON.stringify turns undefined inside an array into null, which would make an absent key equal a served null.
const sqOf = (g) => g && g.journalism ? g.journalism.squiggle : 'NO-JOURNALISM-KEY';
// The served tip as [home, away] to two decimals (the home value is served as Squiggle's string, the away as a number).
const pair = (s) => s && typeof s === 'object' ? [String(s.homeConfidence), Number(s.awayConfidence).toFixed(2)] : s;

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
eq('J4 one Squiggle read, for 2026 round 18, and one Kali read for the same year and round', [r1.squiggle, r1.kali], [['?q=tips;year=2026;round=18;source=8'], ['/predictions?year=2026&round=18']]);
eq('J4b the round-based Squiggle read asks for the Aggregate source alone (3 KB, not 104 KB) and is edge-cached under its own key', r1.cacheKeys, ['squiggle:tips:2026:18:aggregate']);
eq('J4c the round-based read carries the relay\'s Accept and User-Agent', r1.ua, [['application/json', true]]);
eq('J5 Kali answering with its holding page leaves kali null and Squiggle served (the state of the world now)', byHome(r1, 'St Kilda')?.journalism?.kali, null);

// A row joins a game only when BOTH clubs are the game's clubs: Squiggle's list also has Collingwood v Geelong and North Melbourne v Geelong, and the slate has North Melbourne v Collingwood.
const r2 = await get('2026-07-18');
eq('J6 North Melbourne v Collingwood gets its own tip (31.40) and Melbourne v Richmond its own (66.60), although Melbourne\'s row is listed first',
   [pair(sqOf(byHome(r2, 'North Melbourne'))), pair(sqOf(byHome(r2, 'Melbourne')))], [['31.40', '68.60'], ['66.60', '33.40']]);

// Part B: round 0 is a round. The Opening Round games carried no `journalism` key at all.
const r3 = await get('2026-03-05');
eq('J7 an Opening Round game (round 0) carries a journalism key, and its tip', [pair(sqOf(byHome(r3, 'Sydney Swans'))), pair(sqOf(byHome(r3, 'Gold Coast SUNS')))], [['64.91', '35.09'], ['47.22', '52.78']]);
eq('J8 ... read for round 0', r3.squiggle, ['?q=tips;year=2026;round=0;source=8']);

// Part D: the year is the event's, and without one the clock's. It was the constant 2026.
const r4 = await get('2027-03-12');
eq('J9 a 2027 game asks Squiggle for 2027 although the clock says 2026 (the event says season.year 2027), and gets that year\'s tip', [r4.squiggle, pair(sqOf(byHome(r4, 'Carlton')))], [['?q=tips;year=2027;round=1;source=8'], ['51.00', '49.00']]);
const r5 = await get('2027-03-13', { clock: '2027-03-13T10:00:00Z' });
eq('J10 an event that carries no season takes the clock\'s year, not 2026', [r5.squiggle, pair(sqOf(byHome(r5, 'Geelong Cats')))], [['?q=tips;year=2027;round=1;source=8'], ['58.00', '42.00']]);

// Kali's own names ('Sydney') join the same game as ESPN's ('Sydney Swans').
const r6 = await get('2026-07-09', { kali: 'json' });
eq('J11 Kali\'s "Fremantle" v "Sydney" prediction joins Fremantle v Sydney Swans (61.2 / 38.8) and so does Squiggle\'s (64.07)',
   [byHome(r6, 'Fremantle')?.journalism?.kali?.homeWinPct, byHome(r6, 'Fremantle')?.journalism?.kali?.awayWinPct, pair(sqOf(byHome(r6, 'Fremantle')))], [61.2, 38.8, ['64.07', '35.93']]);

// A row that lists the clubs the other way round to ESPN's game puts each side's value on the right club.
const r8 = await get('2026-07-25', { kali: 'json' });
eq('J13 Squiggle\'s "Carlton v Hawthorn" 60.00 on ESPN\'s Hawthorn v Carlton gives Hawthorn 40.00 and Carlton 60.00; Kali\'s 55/45 swaps the same way',
   [pair(sqOf(byHome(r8, 'Hawthorn'))), byHome(r8, 'Hawthorn')?.journalism?.kali?.homeWinPct, byHome(r8, 'Hawthorn')?.journalism?.kali?.awayWinPct], [['40.00', '60.00'], 45, 55]);

// Part C: a final's tip is the row of its own clubs and kickoff day, not ESPN's week read as Squiggle's round.
// (The stub serves every source for a club: Squiggle filters to the Aggregate with source=8, and the code's own Aggregate guard is what these decoy rows test.)
// A runtime without the Melbourne zone (Intl throws RangeError for it): the finals are served with no tip and a warning, and nothing else breaks. Run FIRST: a working
// formatter is cached after its first use.
const RealDTF = Intl.DateTimeFormat;
Intl.DateTimeFormat = class { constructor() { throw new RangeError('Invalid time zone specified: Australia/Melbourne'); } };
const f0 = await get('2026-09-05');
Intl.DateTimeFormat = RealDTF;
eq('F0 a runtime with no Melbourne zone serves the day with no tip for either final and warns ONCE per final, with the reason and no second line about a missing kickoff (it does not fail, and does not guess a day)',
   [f0.status, f0.games.length, f0.games.map(g => sqOf(g)), f0.warns.filter(w => /^\[AFL-SQUIGGLE\] no Melbourne time zone in this runtime/.test(w)).length, f0.warns.filter(w => /^\[AFL-SQUIGGLE\]/.test(w)).length], [200, 2, [null, null], 2, 2]);
const f1 = await get('2026-09-05', { kali: 'json' });
eq('F1 the 2026-09-05 finals (ESPN week 2): Adelaide v Western Bulldogs gets the final\'s tip 68.60, not March\'s 47.29; Sydney v Brisbane gets 50.61, not March\'s 71.48',
   [pair(sqOf(byHome(f1, 'Adelaide Crows'))), pair(sqOf(byHome(f1, 'Sydney Swans')))], [['68.60', '31.40'], ['50.61', '49.39']]);
eq('F2 each final asks Squiggle for its HOME club\'s season, and nothing else: no round read, and Kali (served here) is not asked',
   [[...f1.squiggle].sort(), f1.kali], [['?q=tips;year=2026;team=16;source=8', '?q=tips;year=2026;team=1;source=8'], []]);
eq('F2c each final\'s read asks for the edge cache the way the relay\'s other Squiggle reads do (an hour, cacheEverything: Rule 78) and carries the relay\'s Accept and User-Agent', [f1.cf, f1.ua], [[[3600, true], [3600, true]], [['application/json', true], ['application/json', true]]]);
eq('F2b the two edge-cache keys are different: one entry per club and year, never one shared entry', [new Set(f1.cacheKeys).size, f1.cacheKeys.every(k => /^squiggle:tips:2026:team:\d+:aggregate$/.test(k))], [2, true]);
eq('F3 the Grand Final (ESPN week 5; the relay served it null) gets Squiggle\'s round-29 tip 48.51', pair(sqOf(byHome(await get('2026-09-26'), 'Fremantle'))), ['48.51', '51.49']);
eq('F4 a Wildcard Final (ESPN week 1, a round that is also March\'s round 1) gets its own tip 47.20', pair(sqOf(byHome(await get('2026-08-28'), 'Western Bulldogs'))), ['47.20', '52.80']);
const f5 = await get('2025-09-06', { clock: '2025-09-06T12:00:00Z' });
eq('F5 a 2025 final asks for 2025 and finds "GWS GIANTS" as Squiggle\'s "Greater Western Sydney" (team 9): the real round-25 row, 51.74', [pair(sqOf(byHome(f5, 'GWS GIANTS'))), f5.squiggle], [['51.74', '48.26'], ['?q=tips;year=2025;team=9;source=8']]);
eq('F6 a night final (15:00Z = 01:00 the next day in Melbourne) joins the row Squiggle dates on the Melbourne day', pair(sqOf(byHome(await get('2026-09-07'), 'Collingwood'))), ['52.50', '47.50']);
const f7 = await get('2026-09-08');
eq('F7 a final Squiggle has no tip for on that day (its row is dated a day later) serves null, and says so with a warning that names the day', [f7.games.length, sqOf(byHome(f7, 'Geelong Cats')), f7.warns.some(w => /^\[AFL-SQUIGGLE\] no Squiggle tip for Geelong Cats v Brisbane Lions on 2026-09-08/.test(w))], [1, null, true]);
const f8 = await get('2026-09-05', { squiggle: '503' });
eq('F7b the final with no tip of its own is NOT answered through ESPN\'s week: the only Squiggle read is the club\'s season (round 3 would have served Geelong v Brisbane Lions 33.00)', f7.squiggle, ['?q=tips;year=2026;team=7;source=8']);
eq('F8 Squiggle answering 503 serves null for each final, the day is still served, and each failure is warned with the status', [f8.status, f8.games.length, f8.games.map(g => sqOf(g)), f8.warns.filter(w => /^\[AFL-SQUIGGLE\] Squiggle answered 503 /.test(w)).length], [200, 2, [null, null], 2]);
eq('F8c a failed read is not retried through ESPN\'s week either: two reads, both the clubs\' seasons', [...f8.squiggle].sort(), ['?q=tips;year=2026;team=16;source=8', '?q=tips;year=2026;team=1;source=8']);
eq('F8b each final\'s Squiggle read carries an abort signal (a stalled Squiggle must not hold the whole day), and the two reads are the only two', [f1.signals, f1.signals.length], [[true, true], 2]);
// The ways a final's read can go wrong, each one a null for the final and a warning that says which, never a thrown error and never a guess.
const f9 = await get('2026-08-30');
eq('F9 a final whose ESPN home club is Squiggle\'s AWAY club (ESPN Carlton v Melbourne, Squiggle Melbourne v Carlton 55.66) joins, and each side gets its own value: Carlton 44.34, Melbourne 55.66',
   [pair(sqOf(byHome(f9, 'Carlton')))], [['44.34', '55.66']]);
const f10 = await get('2026-09-05', { squiggle: 'dup' });
eq('F10 the same pair listed twice on the same day is ambiguous: no tip for either final, and a warning that says ambiguous with the row count',
   [f10.status, f10.games.map(g => sqOf(g)), f10.warns.filter(w => /^\[AFL-SQUIGGLE\] ambiguous Squiggle tip for .* on 2026-09-05 \(year 2026\): 2 row\(s\)$/.test(w)).length], [200, [null, null], 2]);
const f11 = await get('2026-09-05', { squiggle: 'object' });
eq('F11 an answer whose tips is not an array serves null for each final, still serves the day, and says so', [f11.status, f11.games.map(g => sqOf(g)), f11.warns.filter(w => /^\[AFL-SQUIGGLE\] Squiggle answered no tips array for /.test(w)).length], [200, [null, null], 2]);
const f12 = await get('2026-09-05', { squiggle: 'badjson' });
eq('F12 an answer that is not JSON serves null for each final, still serves the day, and says the read failed', [f12.status, f12.games.map(g => sqOf(g)), f12.warns.filter(w => /^\[AFL-SQUIGGLE\] Squiggle read failed for /.test(w)).length], [200, [null, null], 2]);
const f13 = await get('2026-09-05', { squiggle: 'reject' });
eq('F13 a network failure serves null for each final, still serves the day, and says the read failed', [f13.status, f13.games.map(g => sqOf(g)), f13.warns.filter(w => /^\[AFL-SQUIGGLE\] Squiggle read failed for /.test(w)).length], [200, [null, null], 2]);
const f14 = await get('2026-09-05', { squiggle: 'nullrow' });
eq('F14 a null entry among the tips is skipped: both finals still get their own tips', [pair(sqOf(byHome(f14, 'Adelaide Crows'))), pair(sqOf(byHome(f14, 'Sydney Swans')))], [['68.60', '31.40'], ['50.61', '49.39']]);
const f15 = await get('2026-09-05', { squiggle: 'noconf' });
eq('F15 a final whose tip carries no hconfidence (null is 0 to Number()) serves null, not certainty, and says so', [f15.games.map(g => sqOf(g)), f15.warns.filter(w => /^\[AFL-SQUIGGLE\] the Squiggle tip for .* carries no usable hconfidence: null$/.test(w)).length], [[null, null], 2]);
const j14 = await get('2026-07-11', { squiggle: 'noconf' });
eq('J14 a regular game whose tip carries no hconfidence serves null too (four games, four nulls)', [j14.games.length, j14.games.map(g => sqOf(g))], [4, [null, null, null, null]]);
// The round of a regular slate is the first game that HAS one.
const j15 = await get('2026-08-01');
eq('J15 a slate whose first game carries no week still reads the round of the game that does (21): that game gets its tip, the weekless one (no row of its own) none',
   [j15.squiggle, pair(sqOf(byHome(j15, 'Richmond'))), sqOf(byHome(j15, 'Carlton'))], [['?q=tips;year=2026;round=21;source=8'], ['55.55', '44.45'], null]);

const j16 = await get('2026-08-02');
eq('J16 a regular slate whose only game has no week serves no journalism key at all, and asks nobody', [j16.games.length, j16.games.some(g => 'journalism' in g), j16.squiggle, j16.kali], [1, false, [], []]);
const j17 = await get('2027-03-14');
eq('J17 the year is the first season ANY event carries (the first game has none, the second says 2027, the clock says 2026): Squiggle is asked for 2027 and Richmond v Hawthorn gets its tip',
   [j17.squiggle, pair(sqOf(byHome(j17, 'Richmond')))], [['?q=tips;year=2027;round=1;source=8'], ['48.00', '52.00']]);
const f16 = await get('2026-09-09');
eq('F16 a final with a club the team table does not have serves null, asks Squiggle nothing, and says which names', [sqOf(byHome(f16, 'Tasmania Devils')), f16.squiggle, f16.warns.filter(w => /^\[AFL-SQUIGGLE\] no Squiggle team id for "Tasmania Devils" v "Geelong Cats"$/.test(w)).length], [null, [], 1]);
const f17 = await get('2026-09-10');
eq('F17 a final with no kickoff serves null, asks Squiggle nothing, and says there is no kickoff', [sqOf(byHome(f17, 'Geelong Cats')), f17.squiggle, f17.warns.filter(w => /^\[AFL-SQUIGGLE\] no year or kickoff for Geelong Cats v Carlton /.test(w)).length], [null, [], 1]);

// The module's own helpers, asserted on the module the worker under test imports.
const { squiggleHomePct, squiggleTeamId, squiggleConfidenceFor, SQUIGGLE_TEAM_IDS, melbourneDay } = squiggleModule;
// The kickoff DAY on Melbourne's wall clock: AEST (+10) in winter, AEDT (+11) from the first Sunday of October to the first Sunday of April, never Brisbane's fixed +10.
eq('U4 melbourneDay: 13:59Z on 2026-09-05 is still that day (23:59 AEST), 14:00Z is the next (00:00 AEST); 13:30Z on 2026-03-20 is already the next day (00:30 AEDT, a fixed +10 would say 23:30) and so is 13:30Z on 2026-10-10',
   [['2026-09-05T13:59:00Z', '2026-09-05T14:00:00Z', '2026-03-20T13:30:00Z', '2026-10-10T13:30:00Z'].map(x => melbourneDay(RealDate.parse(x))), melbourneDay(NaN)], [['2026-09-05', '2026-09-06', '2026-03-21', '2026-10-11'], null]);
eq('U1 squiggleHomePct: a number or a non-empty numeric string in 0..100 is a percentage; null, "", blanks, text, booleans, NaN and values outside 0..100 are not',
   [[null, '', '  ', 'abc', true, NaN, '101', '-5', 101, -1, undefined].map(x => squiggleHomePct({ hconfidence: x })), ['68.60', 68.6, '0', 0, '100', 100].map(x => squiggleHomePct({ hconfidence: x })), squiggleHomePct(null), squiggleHomePct(undefined)],
   [[null, null, null, null, null, null, null, null, null, null, null], [68.6, 68.6, 0, 0, 100, 100], null, null]);
const SQUIGGLE_TEAMS = { 'Adelaide': 1, 'Brisbane Lions': 2, 'Carlton': 3, 'Collingwood': 4, 'Essendon': 5, 'Fremantle': 6, 'Geelong': 7, 'Gold Coast': 8, 'Greater Western Sydney': 9, 'Hawthorn': 10,
                         'Melbourne': 11, 'North Melbourne': 12, 'Port Adelaide': 13, 'Richmond': 14, 'St Kilda': 15, 'Sydney': 16, 'West Coast': 17, 'Western Bulldogs': 18 };   // ?q=teams, read 2026-11-24
eq('U2 all 18 Squiggle team ids (?q=teams, read 2026-11-24) are what the table says, by Squiggle\'s own names', Object.fromEntries(Object.keys(SQUIGGLE_TEAMS).map(n => [n, squiggleTeamId(n)])), SQUIGGLE_TEAMS);
eq('U2b ... and by ESPN\'s names (the spellings the relay is handed), with the table holding exactly 18 clubs',
   [['Adelaide Crows', 'Brisbane Lions', 'Carlton', 'Collingwood', 'Essendon', 'Fremantle', 'Geelong Cats', 'Gold Coast SUNS', 'GWS GIANTS', 'Hawthorn', 'Melbourne', 'North Melbourne', 'Port Adelaide', 'Richmond', 'St Kilda', 'Sydney Swans', 'West Coast Eagles', 'Western Bulldogs'].map(squiggleTeamId), Object.keys(SQUIGGLE_TEAM_IDS).length],
   [[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18], 18]);
const T = { hteamid: 3, ateamid: 14, hconfidence: '60.00' };
eq('U3 squiggleConfidenceFor gives the home club the tip, the away club the rest, and a club not in the row (or a row with no tip) nothing',
   [squiggleConfidenceFor(T, 'Carlton'), squiggleConfidenceFor(T, 'Richmond'), squiggleConfidenceFor(T, 'Geelong'), squiggleConfidenceFor({ ...T, hconfidence: null }, 'Carlton'), squiggleConfidenceFor({ ...T, hconfidence: null }, 'Richmond'), squiggleConfidenceFor(T, 'Nobody FC')], [60, 40, null, null, null, null]);

// The gate is unchanged: no Kali token, no journalism context and no Kali or Squiggle read.
const r7 = await get('2026-07-11', { token: false });
eq('J12 without KALI_AFL_TOKEN no game carries a journalism key and nothing is asked of Kali or Squiggle', [r7.games.some(g => 'journalism' in g), r7.squiggle, r7.kali], [false, [], []]);

console.log(`COVERAGE: ${total} assertions through the real GET /v2/games?sport=afl, with KALI_AFL_TOKEN set (J12 runs it unset), a pinned clock (2026-11-24, 2027-03-13 and the 2025 final's day) and a Map KV. REAL inputs: the 2026-07-11, -07-09 and -03-05 slates as the relay served them (ESPN names), the 2026 finals events as ESPN served them (season.type 3), Squiggle's real Aggregate rows for rounds 0 and 18, for the 2026 finals (rounds 25-29) and for the 2025 round-25 GWS v Hawthorn game. SYNTHETIC inputs: the 07-18, 07-25, 08-01, 08-02, 08-30, 09-06/07/08/09/10 and 2027 slates, every row marked synthetic in SEASON_ROWS and TIPS (including the rounds 1, 2 (its Adelaide row is real), 3 and 5 decoys the round route serves for ESPN's finals weeks), the Kali predictions (names 'Sydney' and 'Carlton' are recorded Kali names, 'Fremantle' is not, every value is invented) and the Squiggle failure modes (503, not JSON, network down, tips not an array, a null row, a row listed twice, no hconfidence). The module's helpers (hconfidence, all 18 team ids, the Melbourne day across both offsets) are asserted on the module under test. A final is asserted to ask Squiggle for its home club's season and Kali for nothing, with the relay's cf options and headers and an abort signal. Not covered here: Kali's FINALS numbering (unmeasured, offline until 2027), the Kali branch's team names beyond 'Sydney' (8 of 18 recorded), ESPN's league-level season block (the stubs omit it), a slate mixing finals and regular games (ESPN's regular season ends before its finals begin), whether Cloudflare's cf cache options take effect on Squiggle's zone (asserted as sent, not as honoured: Node ignores cf) and the client.`);
console.log(`${passed} of ${total} passed.`);
globalThis.Date = RealDate;
process.exit(passed === total ? 0 : 1);
