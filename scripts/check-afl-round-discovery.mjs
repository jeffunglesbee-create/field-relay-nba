#!/usr/bin/env node
/**
 * AFL round discovery reads ESPN ONE DAY at a time, never a date range.
 * docs/CC-CMD-2026-11-24-afl-round-discovery-sends-a-date-range.md.
 *
 * WHY. src/wp-resolver.js `_discoverAFLRound` sent `scoreboard?dates=YYYYMMDD-YYYYMMDD`. ESPN answers a range with
 * HTTP 400 {"code":400,"message":"Failed to get events endpoint."} (measured 2026-11-24, for AFL and for eng.1), the
 * function read `!r.ok` as "no round" and returned null without a log line, so while ESPN refuses ranges an AFL pick cannot
 * resolve to a win probability and nothing says why. The fix is ten single-day reads (-3d..+6d), which keep the window and
 * take each event's own `week.number`.
 *
 * THIS RUNS THE RESOLVER: the real `resolveWinProbability('AFL', ...)` from src/wp-resolver.js, over a pinned clock
 * (2026-07-08 10:00Z, the day before the one fixture measured by hand: Fremantle v Sydney Swans, round 18, on 2026-07-09; two more
 * instants for the window edges and the year) and
 * a fetch stub that behaves the way ESPN was measured to behave: a `dates=` value with a dash answers 400 with the real body,
 * a single day answers a scoreboard whose events carry `week.number`, `competitions[0].competitors[].homeAway` and
 * `team.displayName` (the fields the resolver reads). The Squiggle stub serves a different Aggregate confidence for each
 * round, so a wrong round gives a wrong number and not merely a null.
 *
 * WHAT THE STUB IS. Built from the field names the code reads and the relay's own AFL adapter reads (`ev.week?.number`), except for
 * ONE real body: outbox/espn-afl-scoreboard-20260709-recorded-2026-11-24.json (a completed event, off-season, trimmed; replayed in S43/S44).
 * Every other day, and any live-event body, is built, not recorded. The rest of the real shape is to be proven by
 * .github/workflows/afl-round-live-check.yml, which asks real ESPN from a runner with the same pinned clock; until that has run, the
 * live shape beyond that one body is STAGED (docs/CC-CMD-2026-11-24-afl-round-discovery-sends-a-date-range.md, Status).
 *
 * WP_RESOLVER_SRC points the resolver elsewhere; scripts/mutate-afl-round-discovery.mjs uses it.
 */
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { readFileSync } from 'node:fs';

const RealDate = Date;
let CLOCK = RealDate.parse('2026-07-08T10:00:00Z');
class PinnedDate extends RealDate {
  constructor(...a) { if (a.length) super(...a); else super(CLOCK); }
  static now() { return CLOCK; }
}
globalThis.Date = PinnedDate;

// ── fixtures ────────────────────────────────────────────────────────────────────────────────────────────────────────
// At the default instant the window is 2026-07-05 .. 2026-07-14 (-3d .. +6d around 2026-07-08): ten days. Days -4 and +7 are OUTSIDE it.
const mk = (id, round, home, away, season, date) => ({
  id, week: round === null ? undefined : { number: round }, ...(season ? { season } : {}), ...(date ? { date } : {}),
  competitions: [{ competitors: [
    { homeAway: 'home', team: { displayName: home } },
    { homeAway: 'away', team: { displayName: away } },
  ] }],
});
// Team names are the ones ESPN serves (displayName, read through the relay's /v2/games for 2026-07-05..07-12: 'Fremantle', 'Sydney Swans',
// 'GWS GIANTS', 'Gold Coast SUNS', 'Adelaide Crows', ...), NOT the nicknamed labels a client might send; the Squiggle stub below uses
// Squiggle's own names ('Sydney', 'Greater Western Sydney', 'Gold Coast', 'Adelaide'). Picks are sent as either.
const POST = { year: 2026, type: 3, slug: 'post-season' };
const DAYS = {
  '20260704': [mk('o1', 16, 'Richmond', 'Gold Coast SUNS')],                     // day -4: outside the window
  '20260705': [mk('e1', 17, 'Collingwood', 'Carlton'),                           // day -3: the first day of the window
               mk('e2', 17, 'Geelong Cats', 'Brisbane Lions')],                  //   Geelong's FIRST game in the window, the furthest from today
  '20260707': [mk('e8', 17, 'North Melbourne', 'Essendon')],                     // day -1: North Melbourne, the club a 'Melbourne' pick must not land on
  '20260708': [mk('e11', 18, 'Giants', 'Crows')],                                // day  0: names that are only nicknames (they strip to nothing)
  '20260709': [mk('e3', 18, 'Fremantle', 'Sydney Swans'),                        // day +1: the measured 2026-07-08 fixture
               mk('e4', null, 'Adelaide Crows', 'Hawthorn'),                     //   an event with no week number
               mk('e5', 18, 'Geelong Cats', 'Western Bulldogs')],                //   Geelong's SECOND game and the NEAREST to today; Western Bulldogs (not Greater Western Sydney)
  '20260710': [mk('e7', 0, 'West Coast Eagles', 'Gold Coast SUNS')],            // day +2: an Opening-Round-style event, week.number 0
  '20260711': [mk('e9', 18, 'Melbourne', 'GWS GIANTS')],                         // day +3: Melbourne (not North Melbourne) and GWS (a different spelling in Squiggle)
  '20260713': [mk('e10', 18, 'St Kilda', 'Port Adelaide')],                      // day +5: Port Adelaide (not Adelaide)
  '20260714': [mk('e6', 19, 'Hawthorn', 'Essendon')],                            // day +6: the last day of the window
  '20260715': [mk('o2', 19, 'Richmond', 'GWS GIANTS')],                          // day +7: outside the window
  // FINALS, real events (ESPN, read 2026-11-24): event.season is {type 3, 'post-season'} and the week restarts at 1; Squiggle's rounds for them are 26.
  '20260903': [mk('1133701', 2, 'Fremantle', 'Hawthorn', POST, '2026-09-03T10:10Z')],
  '20260904': [mk('1133706', 2, 'Geelong Cats', 'Carlton', POST, '2026-09-04T09:40Z')],
  '20260905': [mk('1133702', 2, 'Sydney Swans', 'Brisbane Lions', POST, '2026-09-05T05:15Z'), mk('1133703', 2, 'Adelaide Crows', 'Western Bulldogs', POST, '2026-09-05T09:35Z')],
  // Synthetic: a final whose ESPN season year is NOT the clock's (the year asked of Squiggle is the event's).
  '20260906': [mk('9000010', 3, 'Collingwood', 'Carlton', { year: 2025, type: 3, slug: 'post-season' }, '2026-09-06T09:35Z')],
  '20270311': [mk('y1', 1, 'Carlton', 'Richmond')],                              // 2027, for the instant 2027-03-10: the year asked of Squiggle follows the clock
};
const ALL_DAYS = ['20260705','20260706','20260707','20260708','20260709','20260710','20260711','20260712','20260713','20260714'];
// ESPN's top-level `week`. For a RANGE the old comment recorded it disagreeing with the events inside (top-level 17 while round-18 games
// carried 18). One-day bodies measured 2026-11-24 (20260705, 20260709, 20260711) agree with their events; every body here DISAGREES on
// purpose (17 at the top level over round-18 events), so a change that starts reading the top-level value goes red.
const TOP_LEVEL_WEEK = { number: 17 };

// Squiggle rows in the shape Squiggle serves (?q=tips measured 2026-11-24): 2-decimal strings, `tip` the tipped team, `confidence` the
// TIPPED team's value (it differs from `hconfidence` whenever the away side is tipped), `hconfidence` the home side's.
const tip = (round, hteam, ateam, hconf, source = 'Aggregate') => {
  const h = Number(hconf);
  return { source, round, year: 2026, hteam, ateam, tip: h >= 50 ? hteam : ateam, confidence: (h >= 50 ? h : 100 - h).toFixed(2), hconfidence: hconf };
};
const TIPS = {
  17: [tip(17, 'Collingwood', 'Carlton', '70.40'),
       tip(17, 'Geelong', 'Brisbane Lions', '55.30'),
       tip(17, 'North Melbourne', 'Essendon', '58.10')],
  18: [tip(18, 'Fremantle', 'Sydney', '99.00', 'Other'),                      // a decoy source, listed FIRST: only the Aggregate row may be read
       tip(18, 'Fremantle', 'Sydney', '62.49'),
       tip(18, 'Adelaide', 'Hawthorn', '72.30'),                              // listed before Port Adelaide's: 'Adelaide' must not stand in for it
       tip(18, 'Melbourne', 'Greater Western Sydney', '87.54'),               // listed before the Bulldogs': 'Greater Western Sydney' must not stand in for 'Western Bulldogs'
       tip(18, 'Geelong', 'Western Bulldogs', '34.80'),                       // the AWAY side is tipped here: confidence 65.20, hconfidence 34.80
       tip(18, 'St Kilda', 'Port Adelaide', '62.10')],
  19: [tip(19, 'Hawthorn', 'Essendon', '40.20')],
  0:  [tip(0, 'West Coast', 'Gold Coast', '31.00')],
  1:  [tip(1, 'Carlton', 'Richmond', '51.00')],
};

// Squiggle's Aggregate rows by CLUB (`?q=tips;year=Y;team=T;source=8`, the club's season in date order). Finals rows are the real ones (round 26, read 2026-11-24);
// the March row is the real Adelaide v Western Bulldogs round-2 tip (47.29), the one the round-based read finds when it is handed ESPN's week 2.
const row = (gameid, date, round, hteam, hteamid, ateam, ateamid, hconf) =>
  ({ gameid, date, round, year: 2026, hteam, hteamid, ateam, ateamid, hconfidence: hconf, confidence: Number(hconf) >= 50 ? hconf : (100 - Number(hconf)).toFixed(2), source: 'Aggregate', sourceid: 8 });
const SEASON_ROWS = [
  row(38509, '2026-03-20 19:40:00', 2, 'Adelaide', 1, 'Western Bulldogs', 18, '47.29'),
  row(38723, '2026-09-03 20:10:00', 26, 'Fremantle', 6, 'Hawthorn', 10, '66.02'), row(38721, '2026-09-04 19:40:00', 26, 'Geelong', 7, 'Carlton', 3, '62.47'),
  row(38724, '2026-09-05 15:15:00', 26, 'Sydney', 16, 'Brisbane Lions', 2, '50.61'), row(38722, '2026-09-05 19:35:00', 26, 'Adelaide', 1, 'Western Bulldogs', 18, '68.60'),
];

// ── the fetch stub ──────────────────────────────────────────────────────────────────────────────────────────────────
const RANGE_400_BODY = JSON.stringify({ code: 400, message: 'Failed to get events endpoint.' });
const SCOREBOARD_PATH = '/sports/australian-football/afl/scoreboard';   // the host is not pinned: this module has moved ESPN hosts twice
const jsonResp = (body, status = 200) => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
let log, behave;
const fresh = (b = {}, iso = '2026-07-08T10:00:00Z') => { CLOCK = RealDate.parse(iso); log = { espn: [], squiggle: [], squiggleTeam: [], kali: [], warns: [], timeouts: [], inflight: 0, peak: 0 }; behave = b; };
const realFetch = globalThis.fetch;
const realTimeout = AbortSignal.timeout.bind(AbortSignal);
AbortSignal.timeout = (ms) => { if (log) log.timeouts.push(ms); return realTimeout(ms); };
globalThis.fetch = async (input, init = {}) => {
  const url = String(typeof input === 'string' ? input : input.url);
  const u = new URL(url);
  if (u.pathname.endsWith(SCOREBOARD_PATH)) {
    const dates = u.searchParams.get('dates');
    log.espn.push({ url, dates, params: [...u.searchParams.keys()], init });
    log.inflight++; log.peak = Math.max(log.peak, log.inflight);
    try {
      await new Promise(r => setTimeout(r, 5));                                  // every read in flight at once shows up in `peak`
      if (/-/.test(dates || '')) return jsonResp(RANGE_400_BODY, 400);
      if (behave.espnDown) return jsonResp('{}', behave.espnDown);
      if (behave.throwOn && behave.throwOn.includes(dates)) throw new TypeError('network down for ' + dates);
      if (behave.status && behave.status[dates]) return jsonResp('{}', behave.status[dates]);
      if (behave.raw && dates in behave.raw) return new Response(behave.raw[dates], { status: 200 });   // a 200 with this exact body text
      if (behave.empty) return jsonResp({ events: [] });                         // ten healthy answers with no games: the off-season
      return jsonResp({ week: TOP_LEVEL_WEEK, events: DAYS[dates] || [] });
    } finally { log.inflight--; }
  }
  if (url.startsWith('https://api.squiggle.com.au/') && /;team=(\d+);source=8/.test(url)) {
    log.squiggleTeam.push(url.slice('https://api.squiggle.com.au/'.length));
    if (behave.squiggle503) return jsonResp('{}', 503);
    const [, year, team] = /year=(\d+);team=(\d+);source=8/.exec(url);
    return jsonResp({ tips: (behave.noRows ? [] : SEASON_ROWS).filter(r => String(r.year) === year && (r.hteamid === Number(team) || r.ateamid === Number(team))) });
  }
  if (url.startsWith('https://kaliaflstats.com/')) { log.kali.push(url); return jsonResp('{}', 503); }
  if (url.startsWith('https://api.squiggle.com.au/')) {
    const m = /year=(\d+);round=(\d+)/.exec(url);
    log.squiggle.push({ url, year: m && Number(m[1]), round: m && Number(m[2]) });
    return jsonResp({ tips: (m && TIPS[Number(m[2])]) || [] });
  }
  throw new Error('check: an unexpected fetch to ' + url + ' (the live network is not reachable from this check)');
};
const realWarn = console.warn;
console.warn = (...a) => { if (log) log.warns.push(a.map(String).join(' ')); };

const SRC = resolve(process.env.WP_RESOLVER_SRC || 'src/wp-resolver.js');
const { resolveWinProbability } = await import(pathToFileURL(SRC).href);
const { resolveAFLTeamKey } = await import(new URL('../src/identity-resolver.js', import.meta.url).href);
const pick = (winner, env = {}) => resolveWinProbability('AFL', { gameId: 'espn:401', predictedWinner: winner }, env);

// ── assertions ──────────────────────────────────────────────────────────────────────────────────────────────────────
let passed = 0, total = 0;
const eq = (name, got, want) => {
  total++; const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { passed++; return; }
  console.log(`FAIL  ${name}\n        got  ${g}\n        want ${w}`);
};
const ok = (name, cond, detail) => { total++; if (cond) { passed++; return; } console.log(`FAIL  ${name}${detail ? '\n        ' + detail : ''}`); };
// A warning that names THIS day and no other (a warning that lists every day would satisfy a looser test), carrying the module's tag.
const warnedFor = (day, re = /./) => log.warns.some(w => /^\[AFL-ROUND\]/.test(w) && w.includes(day) && re.test(w) && !ALL_DAYS.some(d => d !== day && w.includes(d)));
const WP = (probability) => ({ probability, source: 'squiggle', label: 'Statistical probability' });

// S1 the measured fixture, through the real entry point
fresh();
eq('S1 Fremantle (home, label "Fremantle Dockers", ESPN "Fremantle") on +1d resolves through round 18 to the Aggregate row, 62.49 -> 0.625, although every body says week 17 at the top level and a decoy source says 99', await pick('Fremantle Dockers'), WP(0.625));
eq('S2 the Squiggle read is for 2026 round 18 exactly once', log.squiggle.map(s => [s.year, s.round]), [[2026, 18]]);
const espn1 = log.espn.map(e => e.dates);
ok('S3 no ESPN request carries a date RANGE (a dash in dates= is answered 400)', espn1.every(d => /^\d{8}$/.test(d || '')), 'dates sent: ' + JSON.stringify(espn1));
eq('S4 exactly the ten days -3d..+6d were read, once each', [...espn1].sort(), ALL_DAYS);
ok('S5 no ESPN read is edge-cached for longer than /v2/games\' 15 s on the same URL (an entry written here would serve its live poll stale)',
   log.espn.every(e => !e.init.cf || (typeof e.init.cf.cacheTtl === 'number' ? e.init.cf.cacheTtl <= 15 : e.init.cf.cacheEverything !== true)), 'cf: ' + JSON.stringify(log.espn.map(e => e.init.cf)));
ok('S6 the reads run together, not one after another (so a slow ESPN costs one timeout, not ten)', log.peak === 10, 'peak in flight: ' + log.peak);
ok('S7 every ESPN read carries an abort signal, and the timeouts asked for are exactly eleven 5000 ms (ten ESPN reads and the one Squiggle read)',
   log.espn.every(e => e.init.signal && typeof e.init.signal.aborted === 'boolean') && log.timeouts.length === 11 && log.timeouts.every(t => t === 5000), 'timeouts: ' + JSON.stringify(log.timeouts));
eq('S8 nothing was warned on a clean read', log.warns, []);
ok('S8b the URL is the scoreboard path with the one dates= parameter and nothing else', log.espn.every(e => e.params.length === 1 && e.params[0] === 'dates' && e.url.includes(SCOREBOARD_PATH + '?dates=')), 'urls: ' + JSON.stringify(log.espn.map(e => e.url).slice(0, 2)));
ok('S8c every ESPN read sends the browser-style headers the module sends everywhere else (Origin, Referer, User-Agent)',
   log.espn.every(e => e.init.headers && e.init.headers.Origin && e.init.headers.Referer && e.init.headers['User-Agent']), 'headers: ' + JSON.stringify(log.espn[0] && log.espn[0].init.headers));

// away side
fresh();
eq('S9 Sydney Swans (away) on the same game resolves to (100 - 62.49) / 100 = 0.375', await pick('Sydney Swans'), WP(0.375));

// window edges, in the order the window is scanned
fresh();
eq('S10 a game on the FIRST day of the window (-3d) is found, round 17 (Collingwood at home, 70.40 -> 0.704)', await pick('Collingwood Magpies'), WP(0.704));
eq('S11 ... and asked Squiggle for round 17', log.squiggle.map(s => s.round), [17]);
fresh();
eq('S12 a game on the LAST day of the window (+6d) is found, round 19 (Hawthorn at home, 40.20 -> 0.402)', await pick('Hawthorn Hawks'), WP(0.402));
eq('S13 ... and asked Squiggle for round 19', log.squiggle.map(s => s.round), [19]);

// outside the window and the unknown
fresh();
eq('S14 a club whose only games are on day -4 and day +7 (both outside the window) resolves to null', await pick('Richmond Tigers'), null);
eq('S15 ... and asks Squiggle nothing', log.squiggle, []);
fresh();
eq('S17 a name no club has resolves to null, with no Squiggle read', [await pick('Tasmania Devils'), await pick('Hobart'), log.squiggle.length], [null, null, 0]);
fresh();
eq('S17b a bare nickname strips to no club key and must not match another bare nickname: "Swans" against an event between "Giants" and "Crows" resolves to null', [await pick('Swans'), log.squiggle.length], [null, 0]);
fresh();
eq('S18 an event with no week number is skipped (Adelaide Crows is only in one)', await pick('Adelaide Crows'), null);
eq('S18b ... and Squiggle is not asked for a round that was never there', log.squiggle, []);

// clubs whose names contain another club's name: each resolves through its OWN game and its OWN tip
fresh();
eq('S18f Melbourne resolves through Melbourne v GWS (round 18, 87.54 -> 0.875), not through North Melbourne\'s game two days earlier (round 17)', await pick('Melbourne Demons'), WP(0.875));
eq('S18g ... and asked Squiggle for round 18 only', log.squiggle.map(s => s.round), [18]);
fresh();
eq('S18h North Melbourne resolves through its own round-17 game (58.10 -> 0.581), not Melbourne\'s', await pick('North Melbourne Kangaroos'), WP(0.581));
fresh();
eq('S18i GWS GIANTS (ESPN) finds Squiggle\'s "Greater Western Sydney" tip: away side of Melbourne v GWS, (100 - 87.54) / 100 = 0.125', await pick('GWS GIANTS'), WP(0.125));
eq('S18j ... and so does the label form "GWS Giants"', (await pick('GWS Giants'))?.probability, 0.125);
fresh();
eq('S18k Western Bulldogs takes Geelong v Western Bulldogs\' tip (home 34.80 tipped away: (100 - 34.80) / 100 = 0.652), not Greater Western Sydney\'s (0.125) that comes first in the list, nor West Coast\'s', await pick('Western Bulldogs'), WP(0.652));
eq('S18k2 ... and asked Squiggle for round 18 only (not West Coast\'s round 0)', log.squiggle.map(s => s.round), [18]);
fresh();
eq('S18l Port Adelaide takes St Kilda v Port Adelaide (away, (100 - 62.10) / 100 = 0.379), not Adelaide\'s tip (0.723) that comes first in the list', await pick('Port Adelaide Power'), WP(0.379));
eq('S18l2 ... and its round is the Port Adelaide game\'s own (18)', log.squiggle.map(s => s.round), [18]);

// round 0 is a round (ESPN's Opening Round carries week.number 0)
fresh();
eq('S18c a game whose week.number is 0 resolves through Squiggle round 0 (West Coast at home, 31.00 -> 0.31)', await pick('West Coast Eagles'), WP(0.31));
eq('S18d ... and asked Squiggle for round 0, not "no round"', log.squiggle.map(s => s.round), [0]);
fresh();
eq('S18e ... and its away side (ESPN "Gold Coast SUNS", label "Gold Coast Suns", Squiggle "Gold Coast") resolves to (100 - 31.00) / 100 = 0.69', await pick('Gold Coast Suns'), WP(0.69));

// the earliest game in day order wins, as it did when the range was one list: Geelong plays on day -3 (round 17) and day +1 (round 18, the NEAREST to today)
fresh();
eq('S19 a club playing twice in the window resolves through its EARLIER game, not its nearest (Geelong: round 17 on -3d, 55.30 -> 0.553; not round 18 on +1d)', await pick('Geelong Cats'), WP(0.553));
eq('S20 ... asked for round 17', log.squiggle.map(s => s.round), [17]);

// failures are said, and the days that answered are still searched
fresh({ status: { '20260709': 500 } });
eq('S21 one day answering 500 does not stop the others: Collingwood (-3d) still resolves', (await pick('Collingwood Magpies'))?.probability, 0.704);
ok('S22 ... and the failure is warned with its status and that day, and no other day', warnedFor('20260709', /500/), 'warns: ' + JSON.stringify(log.warns));
ok('S23 ... but not as "none answered"', !log.warns.some(w => /none of the/.test(w)));
fresh({ status: { '20260709': 500 } });
eq('S24 the team whose only game was on the failed day resolves to null (Fremantle)', await pick('Fremantle Dockers'), null);
fresh({ throwOn: ['20260705'] });
eq('S25 a network error on one day does not stop the others: Hawthorn (+6d) still resolves', (await pick('Hawthorn Hawks'))?.probability, 0.402);
ok('S26 ... and the error is warned with that day and the reason, and no other day', warnedFor('20260705', /network down/), 'warns: ' + JSON.stringify(log.warns));
fresh({ espnDown: 400 });
eq('S27 every read refused: the answer is null', await pick('Fremantle Dockers'), null);
ok('S28 ... and it says so, once, loudly and under the module\'s tag (the silent null is the defect this check exists for)',
   log.warns.filter(w => /^\[AFL-ROUND\] none of the 10 one-day reads answered/.test(w)).length === 1, 'warns: ' + JSON.stringify(log.warns));
eq('S29 ... and each of the ten refusals is warned too', log.warns.filter(w => /answered 400/.test(w)).length, 10);
eq('S30 ... and Squiggle is never asked without a round', log.squiggle, []);

// "none answered" is said when NONE did, not when some did, and not when all did and there was nothing on
const only = (keep) => Object.fromEntries(ALL_DAYS.filter(d => !keep.includes(d)).map(d => [d, 503]));
fresh({ status: only(['20260709']) });
eq('S31 nine days refused and one answering: that one is still searched and resolves (Fremantle, 0.625)', (await pick('Fremantle Dockers'))?.probability, 0.625);
ok('S32 ... and "none answered" is NOT said when one did', !log.warns.some(w => /none of the/.test(w)) && log.warns.filter(w => /answered 503/.test(w)).length === 9, 'warns: ' + JSON.stringify(log.warns));
fresh({ status: only(['20260705', '20260707', '20260709', '20260711', '20260713']) });
ok('S33 five of ten answering: "none answered" is NOT said', !log.warns.some(w => /none of the/.test(w)));
fresh({ empty: true });
eq('S33b ten healthy answers with no games (the off-season) resolve to null WITHOUT a warning: nothing failed', [await pick('Fremantle Dockers'), log.warns], [null, []]);

// a 200 that is not a scoreboard is said, and the other days are still searched
for (const [label, body, mustWarn] of [
  ['non-JSON text', 'upstream connect error', true],
  ['an empty object', '{}', true],
  ['events as an object', '{"events":{}}', true],
  ['events as null', '{"events":null}', true],
  ['an event whose competitors are not a list', '{"events":[{"week":{"number":18},"competitions":[{"competitors":{}}]}]}', true],
  ['an events array holding a null (a null event is skipped, not a failed day)', '{"events":[null]}', false],
]) {
  fresh({ raw: { '20260706': body } });
  eq(`S34 day -2 answering 200 with ${label} does not stop the later days: Fremantle (+1d) still resolves`, (await pick('Fremantle Dockers'))?.probability, 0.625);
  if (mustWarn) ok(`S35 ... and that day is warned by name, and no other day (${label})`, warnedFor('20260706'), 'warns: ' + JSON.stringify(log.warns));
  else ok(`S35 ... and nothing is warned for it (${label})`, log.warns.length === 0, 'warns: ' + JSON.stringify(log.warns));
}

// FINALS. ESPN restarts its week at 1 for the postseason and marks each final's EVENT season.type 3 / 'post-season'; Squiggle numbers the finals on from the regular
// season (round 26 here). A final's tip is the row of its own clubs and kickoff day (src/afl-squiggle.js), never Squiggle's round handed ESPN's week.
const FIN = '2026-09-04T10:00:00Z';   // the window is 2026-09-01 .. 09-10: the 09-03 final is one day back, 09-04 today, 09-05 two games a day ahead
fresh({}, FIN);
eq('R1 Adelaide Crows (the 2026-09-05 final, ESPN week 2) resolves to the FINAL\'s tip, 68.60 -> 0.686, not the March round-2 tip 47.29 that week 2 would fetch',
   await pick('Adelaide Crows'), WP(0.686));
eq('R2 ... through one read of the home club\'s season, no round-based read at all, and a 5 s timeout on every read (ten ESPN reads and that one)', [log.squiggleTeam, log.squiggle, log.timeouts.length, log.timeouts.every(x => x === 5000)], [['?q=tips;year=2026;team=1;source=8'], [], 11, true]);
fresh({}, FIN);
eq('R3 Western Bulldogs (the away club of that final) resolves to the rest, (100 - 68.60) / 100 = 0.314', await pick('Western Bulldogs'), WP(0.314));
fresh({}, FIN);
eq('R4 Fremantle (the earlier final, 09-03, Fremantle v Hawthorn, 66.02) resolves to 0.66, and Squiggle is asked for Fremantle\'s season (team 6)', [await pick('Fremantle Dockers'), log.squiggleTeam], [WP(0.66), ['?q=tips;year=2026;team=6;source=8']]);
fresh({}, FIN);
eq('R5 Kali is NOT asked for a final, although a token is set (its finals numbering is unmeasured)', [await pick('Adelaide Crows', { KALI_AFL_TOKEN: 'k' }), log.kali], [WP(0.686), []]);
fresh({ noRows: true }, FIN);
eq('R6 a final Squiggle has no row for resolves to null, said with a warning, and is not answered through any other round', [await pick('Adelaide Crows'), log.warns.some(w => /^\[AFL-SQUIGGLE\] no Squiggle tip for Adelaide Crows v Western Bulldogs on 2026-09-05/.test(w)), log.squiggle], [null, true, []]);
fresh({ squiggle503: true }, FIN);
eq('R7 Squiggle answering 503 resolves to null with a warning that names the status', [await pick('Adelaide Crows'), log.warns.some(w => /^\[AFL-SQUIGGLE\] Squiggle answered 503 /.test(w))], [null, true]);

fresh({}, FIN);
eq('R8 a final\'s year is its event\'s own season year (here 2025, the clock says 2026): Squiggle is asked for 2025', [await pick('Collingwood Magpies'), log.squiggleTeam], [null, ['?q=tips;year=2025;team=4;source=8']]);

// other instants: the window is anchored on the UTC date of "now", and the year Squiggle is asked for follows the clock
fresh({}, '2026-07-08T23:30:00Z');
eq('S37 at 23:30Z the window is still the same ten UTC dates (a window anchored on another zone would lose day -3 or gain day +7)', [(await pick('Collingwood Magpies'))?.probability, log.espn.map(e => e.dates).sort()], [0.704, ALL_DAYS]);
fresh({}, '2026-07-08T00:00:00Z');
eq('S38 at 00:00Z the window is the same ten UTC dates', [(await pick('Hawthorn Hawks'))?.probability, log.espn.map(e => e.dates).sort()], [0.402, ALL_DAYS]);
fresh({}, '2027-03-10T10:00:00Z');
eq('S39 on 2027-03-10 the year asked of Squiggle is 2027 (round 1, Carlton at home, 51.00 -> 0.51), not a constant', [(await pick('Carlton Blues'))?.probability, log.squiggle.map(s => [s.year, s.round])], [0.51, [[2027, 1]]]);

// the one REAL ESPN body on record (outbox/espn-afl-scoreboard-20260709-recorded-2026-11-24.json, 2026-11-24, trimmed to what the resolver reads)
const RECORDED = JSON.parse(readFileSync(new URL('../outbox/espn-afl-scoreboard-20260709-recorded-2026-11-24.json', import.meta.url), 'utf8'));
delete RECORDED._provenance;
fresh({ raw: { '20260709': JSON.stringify(RECORDED) } });
eq('S43 the recorded real ESPN body for 20260709 (displayName "Fremantle" / "Sydney Swans", week.number 18, top-level week 18) resolves Fremantle through round 18', [(await pick('Fremantle Dockers'))?.probability, log.squiggle.map(s => s.round)], [0.625, [18]]);
fresh({ raw: { '20260709': JSON.stringify(RECORDED) } });
eq('S44 ... and Sydney Swans (away) through the same body', (await pick('Sydney Swans'))?.probability, 0.375);

// the identity the matching rests on: 18 clubs, 18 distinct keys, and each club's ESPN, Squiggle and client spellings share one
const CLUBS = [
  ['Adelaide Crows', 'Adelaide'], ['Brisbane Lions', 'Brisbane Lions'], ['Carlton', 'Carlton Blues'], ['Collingwood', 'Collingwood Magpies'],
  ['Essendon', 'Essendon Bombers'], ['Fremantle', 'Fremantle Dockers'], ['Geelong Cats', 'Geelong'], ['Gold Coast SUNS', 'Gold Coast'],
  ['GWS GIANTS', 'Greater Western Sydney'], ['Hawthorn', 'Hawthorn Hawks'], ['Melbourne', 'Melbourne Demons'], ['North Melbourne', 'North Melbourne Kangaroos'],
  ['Port Adelaide', 'Port Adelaide Power'], ['Richmond', 'Richmond Tigers'], ['St Kilda', 'St Kilda Saints'], ['Sydney Swans', 'Sydney'],
  ['West Coast Eagles', 'West Coast'], ['Western Bulldogs', 'Western Bulldogs'],
];   // [ESPN displayName as served, Squiggle name]; the client label is a third spelling for the clubs where it differs
ok('S40 every club\'s ESPN and Squiggle spellings resolve to one AFL key', CLUBS.every(([e, q]) => resolveAFLTeamKey(e) && resolveAFLTeamKey(e) === resolveAFLTeamKey(q)), JSON.stringify(CLUBS.filter(([e, q]) => resolveAFLTeamKey(e) !== resolveAFLTeamKey(q))));
ok('S41 the 18 clubs have 18 distinct keys (a 19th club or a shorter key would collide here)', new Set(CLUBS.map(([e]) => resolveAFLTeamKey(e))).size === 18, JSON.stringify(CLUBS.map(([e]) => resolveAFLTeamKey(e))));
ok('S42 a label with a nickname resolves to the same key as the ESPN name (GWS Giants / GWS GIANTS, Fremantle Dockers / Fremantle)', resolveAFLTeamKey('GWS Giants') === resolveAFLTeamKey('GWS GIANTS') && resolveAFLTeamKey('Fremantle Dockers') === resolveAFLTeamKey('Fremantle'));

console.warn = realWarn;
globalThis.fetch = realFetch;
console.log(`COVERAGE: ${total} assertions: the real resolveWinProbability('AFL', ...) over three pinned instants (2026-07-08 10:00Z, 23:30Z and 00:00Z, and 2027-03-10 10:00Z), one ESPN stub (range -> 400 with the measured body; single day -> events with week.number over a conflicting top-level week) and one Squiggle stub (round-keyed, rows in Squiggle's shape with a decoy source), plus the 18-club identity table. ESPN team names are the ones the relay served for 2026-07-05..12, one real body (20260709) is replayed as recorded, and Squiggle's are its own; 8 of Kali's 18 names are recorded in outbox and were run through the matcher once by hand, not here. Not covered here: Kali for finals (not asked), any other real ESPN body (afl-round-live-check.yml reads four days live), the Kali branch (no token in this check), finals (ESPN numbers them 1-5, Squiggle 25+), and the live season.`);
console.log(`${passed} of ${total} passed.`);
process.exit(passed === total ? 0 : 1);
