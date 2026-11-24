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
 * (2026-07-08 10:00Z, the day before the one fixture measured by hand: Fremantle v Sydney Swans, round 18, on 2026-07-09) and
 * a fetch stub that behaves the way ESPN was measured to behave: a `dates=` value with a dash answers 400 with the real body,
 * a single day answers a scoreboard whose events carry `week.number`, `competitions[0].competitors[].homeAway` and
 * `team.displayName` (the fields the resolver reads). The Squiggle stub serves a different Aggregate confidence for each
 * round, so a wrong round gives a wrong number and not merely a null.
 *
 * WHAT THE STUB IS NOT. It is not a recording of ESPN: no recorded AFL scoreboard exists in outbox (the probe tool truncates
 * the body), so the event shape is built from the field names the code reads and the relay's own AFL adapter reads
 * (`ev.week?.number`). The real shape is to be proven by .github/workflows/afl-round-live-check.yml, which asks real ESPN from
 * a runner with the same pinned clock; until that has run, the live shape is STAGED (docs/CC-CMD-2026-11-24-... Status).
 *
 * WP_RESOLVER_SRC points the resolver elsewhere; scripts/mutate-afl-round-discovery.mjs uses it.
 */
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const RealDate = Date;
const CLOCK = RealDate.parse('2026-07-08T10:00:00Z');
class PinnedDate extends RealDate {
  constructor(...a) { if (a.length) super(...a); else super(CLOCK); }
  static now() { return CLOCK; }
}
globalThis.Date = PinnedDate;

// ── fixtures ────────────────────────────────────────────────────────────────────────────────────────────────────────
// The window is 2026-07-05 .. 2026-07-14 (-3d .. +6d around 2026-07-08): ten days. Days -4 and +7 are OUTSIDE it.
const mk = (id, round, home, away) => ({
  id, week: round === null ? undefined : { number: round },
  competitions: [{ competitors: [
    { homeAway: 'home', team: { displayName: home } },
    { homeAway: 'away', team: { displayName: away } },
  ] }],
});
// Team names are the ones ESPN serves (displayName, read through the relay's /v2/games for 2026-07-05..07-12: 'Fremantle', 'Sydney Swans',
// 'GWS GIANTS', 'Gold Coast SUNS', 'Adelaide Crows', ...), NOT the nicknamed labels a client might send; the Squiggle stub below uses
// Squiggle's own names ('Sydney', 'Greater Western Sydney', 'Gold Coast', 'Adelaide'). Picks are sent as either.
const DAYS = {
  '20260704': [mk('o1', 16, 'Richmond', 'Gold Coast SUNS')],                     // day -4: outside the window
  '20260705': [mk('e1', 17, 'Collingwood', 'Carlton')],                          // day -3: the first day of the window
  '20260706': [mk('e2', 17, 'Geelong Cats', 'Brisbane Lions')],                  // day -2: Geelong's FIRST game in the window
  '20260707': [mk('e8', 17, 'North Melbourne', 'Essendon')],                     // day -1: North Melbourne, the club a 'Melbourne' pick must not land on
  '20260709': [mk('e3', 18, 'Fremantle', 'Sydney Swans'),                        // day +1: the measured 2026-07-08 fixture
               mk('e4', null, 'Adelaide Crows', 'Hawthorn')],                    //   an event with no week number
  '20260710': [mk('e7', 0, 'West Coast Eagles', 'Gold Coast SUNS')],            // day +2: an Opening-Round-style event, week.number 0
  '20260711': [mk('e9', 18, 'Melbourne', 'GWS GIANTS')],                         // day +3: Melbourne (not North Melbourne) and GWS (a different spelling in Squiggle)
  '20260712': [mk('e5', 18, 'Geelong Cats', 'Western Bulldogs')],                // day +4: Geelong's SECOND game; Western Bulldogs (not Greater Western Sydney)
  '20260713': [mk('e10', 18, 'St Kilda', 'Port Adelaide')],                      // day +5: Port Adelaide (not Adelaide)
  '20260714': [mk('e6', 19, 'Hawthorn', 'Essendon')],                            // day +6: the last day of the window
  '20260715': [mk('o2', 19, 'Richmond', 'GWS GIANTS')],                          // day +7: outside the window
};
const ALL_DAYS = ['20260705','20260706','20260707','20260708','20260709','20260710','20260711','20260712','20260713','20260714'];
// ESPN's top-level `week` (the "current week"), which the old comment recorded as disagreeing with the events inside a response:
// every body here carries 17 at the top level while the round-18 events carry 18. The round must come from the EVENT.
const TOP_LEVEL_WEEK = { number: 17 };

// Squiggle: one Aggregate tip per round, with a DIFFERENT home confidence per round, plus a non-Aggregate decoy source.
const TIPS = {
  17: [{ source: 'Aggregate', hteam: 'Collingwood', ateam: 'Carlton', hconfidence: '70' },
       { source: 'Aggregate', hteam: 'Geelong', ateam: 'Brisbane Lions', hconfidence: '55' },
       { source: 'Aggregate', hteam: 'North Melbourne', ateam: 'Essendon', hconfidence: '58' }],
  18: [{ source: 'Aggregate', hteam: 'Fremantle', ateam: 'Sydney', hconfidence: '60' },
       { source: 'Other',     hteam: 'Fremantle', ateam: 'Sydney', hconfidence: '99' },
       { source: 'Aggregate', hteam: 'Adelaide', ateam: 'Hawthorn', hconfidence: '72' },                 // listed before Port Adelaide's: 'Adelaide' must not stand in for it
       { source: 'Aggregate', hteam: 'Melbourne', ateam: 'Greater Western Sydney', hconfidence: '87' },   // listed before the Bulldogs': 'Greater Western Sydney' must not stand in for 'Western Bulldogs'
       { source: 'Aggregate', hteam: 'Geelong', ateam: 'Western Bulldogs', hconfidence: '65' },
       { source: 'Aggregate', hteam: 'St Kilda', ateam: 'Port Adelaide', hconfidence: '62' }],
  19: [{ source: 'Aggregate', hteam: 'Hawthorn', ateam: 'Essendon', hconfidence: '40' }],
  0:  [{ source: 'Aggregate', hteam: 'West Coast', ateam: 'Gold Coast', hconfidence: '35' }],
};

// ── the fetch stub ──────────────────────────────────────────────────────────────────────────────────────────────────
const RANGE_400_BODY = JSON.stringify({ code: 400, message: 'Failed to get events endpoint.' });
const SCOREBOARD_PATH = '/sports/australian-football/afl/scoreboard';   // the host is not pinned: this module has moved ESPN hosts twice
const jsonResp = (body, status = 200) => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
let log, behave;
const fresh = (b = {}) => { log = { espn: [], squiggle: [], warns: [], timeouts: [], inflight: 0, peak: 0 }; behave = b; };
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
      return jsonResp({ week: TOP_LEVEL_WEEK, events: DAYS[dates] || [] });
    } finally { log.inflight--; }
  }
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
const pick = (winner) => resolveWinProbability('AFL', { gameId: 'espn:401', predictedWinner: winner }, {});

// ── assertions ──────────────────────────────────────────────────────────────────────────────────────────────────────
let passed = 0, total = 0;
const eq = (name, got, want) => {
  total++; const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { passed++; return; }
  console.log(`FAIL  ${name}\n        got  ${g}\n        want ${w}`);
};
const ok = (name, cond, detail) => { total++; if (cond) { passed++; return; } console.log(`FAIL  ${name}${detail ? '\n        ' + detail : ''}`); };
const warnedFor = (day) => log.warns.some(w => /\[AFL-ROUND\]/.test(w) && w.includes(day));
const WP = (probability) => ({ probability, source: 'squiggle', label: 'Statistical probability' });

// S1 the measured fixture, through the real entry point
fresh();
eq('S1 Fremantle (home) on +1d resolves through round 18 to the Squiggle Aggregate, 0.6, although every body says week 17 at the top level', await pick('Fremantle Dockers'), WP(0.6));
eq('S2 the Squiggle read is for 2026 round 18 exactly once', log.squiggle.map(s => [s.year, s.round]), [[2026, 18]]);
const espn1 = log.espn.map(e => e.dates);
ok('S3 no ESPN request carries a date RANGE (a dash in dates= is answered 400)', espn1.every(d => /^\d{8}$/.test(d || '')), 'dates sent: ' + JSON.stringify(espn1));
eq('S4 exactly the ten days -3d..+6d were read, once each', [...espn1].sort(), ALL_DAYS);
ok('S5 no ESPN read is edge-cached for longer than /v2/games\' 15 s on the same URL (an entry written here would serve its live poll stale)',
   log.espn.every(e => !e.init.cf || (typeof e.init.cf.cacheTtl === 'number' ? e.init.cf.cacheTtl <= 15 : e.init.cf.cacheEverything !== true)), 'cf: ' + JSON.stringify(log.espn.map(e => e.init.cf)));
ok('S6 the reads run together, not one after another (so a slow ESPN costs one timeout, not ten)', log.peak === 10, 'peak in flight: ' + log.peak);
ok('S7 every ESPN read carries an abort signal, and every timeout asked for (ten here, one more by the Squiggle read) is 5000 ms', log.espn.every(e => e.init.signal && typeof e.init.signal.aborted === 'boolean') && log.timeouts.length >= 10 && log.timeouts.every(t => t === 5000), 'timeouts: ' + JSON.stringify(log.timeouts));
eq('S8 nothing was warned on a clean read', log.warns, []);
ok('S8b the URL is the scoreboard path with the one dates= parameter and nothing else', log.espn.every(e => e.params.length === 1 && e.params[0] === 'dates' && e.url.includes(SCOREBOARD_PATH + '?dates=')), 'urls: ' + JSON.stringify(log.espn.map(e => e.url).slice(0, 2)));
ok('S8c every ESPN read sends the browser-style headers the module sends everywhere else (Origin, Referer, User-Agent)',
   log.espn.every(e => e.init.headers && e.init.headers.Origin && e.init.headers.Referer && e.init.headers['User-Agent']), 'headers: ' + JSON.stringify(log.espn[0] && log.espn[0].init.headers));

// away side and the Squiggle decoy source
fresh();
eq('S9 Sydney Swans (away) on the same game resolves to 1 - 0.6 = 0.4, not the "Other" source\'s 0.99', await pick('Sydney Swans'), WP(0.4));

// window edges, in the order the window is scanned
fresh();
eq('S10 a game on the FIRST day of the window (-3d) is found, round 17', await pick('Collingwood Magpies'), WP(0.7));
eq('S11 ... and asked Squiggle for round 17', log.squiggle.map(s => s.round), [17]);
fresh();
eq('S12 a game on the LAST day of the window (+6d) is found, round 19 (Hawthorn at home, 0.4)', await pick('Hawthorn Hawks'), WP(0.4));
eq('S13 ... and asked Squiggle for round 19', log.squiggle.map(s => s.round), [19]);

// outside the window and the unknown
fresh();
eq('S14 a club whose only games are on day -4 and day +7 (both outside the window) resolves to null', await pick('Richmond Tigers'), null);
eq('S15 ... and asks Squiggle nothing', log.squiggle, []);
fresh();
eq('S17 a club that plays in no game, and a name no club has, resolve to null', [await pick('Tasmania Devils'), await pick('Hobart')], [null, null]);
fresh();
eq('S18 an event with no week number is skipped (Adelaide Crows is only in one)', await pick('Adelaide Crows'), null);
eq('S18b ... and Squiggle is not asked for a round that was never there', log.squiggle, []);

// clubs whose names contain another club's name: each resolves through its OWN game and its OWN tip
fresh();
eq('S18f Melbourne resolves through Melbourne v GWS (round 18, 0.87), not through North Melbourne\'s game two days earlier (round 17)', await pick('Melbourne Demons'), WP(0.87));
eq('S18g ... and asked Squiggle for round 18 only', log.squiggle.map(s => s.round), [18]);
fresh();
eq('S18h North Melbourne resolves through its own round-17 game (0.58), not Melbourne\'s', await pick('North Melbourne Kangaroos'), WP(0.58));
fresh();
eq('S18i GWS GIANTS (ESPN) finds Squiggle\'s "Greater Western Sydney" tip: away side of Melbourne v GWS, 1 - 0.87 = 0.13', await pick('GWS GIANTS'), WP(0.13));
eq('S18j ... and so does the label form "GWS Giants"', (await pick('GWS Giants'))?.probability, 0.13);
fresh();
eq('S18k Western Bulldogs takes Geelong v Western Bulldogs\' tip (away, 1 - 0.65 = 0.35), not Greater Western Sydney\'s (0.13) that comes first in the list', await pick('Western Bulldogs'), WP(0.35));
fresh();
eq('S18l Port Adelaide takes St Kilda v Port Adelaide (away, 1 - 0.62 = 0.38), not Adelaide\'s tip (0.72) that comes first in the list', await pick('Port Adelaide Power'), WP(0.38));
fresh();
eq('S18m Adelaide Crows is not Port Adelaide: its only in-window event has no week, so it resolves to null although Port Adelaide plays on day +5', await pick('Adelaide Crows'), null);

// round 0 is a round (ESPN's Opening Round carries week.number 0)
fresh();
eq('S18c a game whose week.number is 0 resolves through Squiggle round 0 (home side, 0.35)', await pick('West Coast Eagles'), WP(0.35));
eq('S18d ... and asked Squiggle for round 0, not "no round"', log.squiggle.map(s => s.round), [0]);
fresh();
eq('S18e ... and its away side (ESPN "Gold Coast SUNS", label "Gold Coast Suns", Squiggle "Gold Coast") resolves to 1 - 0.35 = 0.65', await pick('Gold Coast Suns'), WP(0.65));

// the earliest game in day order wins, as it did when the range was one list
fresh();
eq('S19 a team playing twice in the window resolves through its EARLIER game (Geelong: round 17 on -2d, not round 18 on +4d)', await pick('Geelong Cats'), WP(0.55));
eq('S20 ... asked for round 17', log.squiggle.map(s => s.round), [17]);

// failures are said, and the days that answered are still searched
fresh({ status: { '20260709': 500 } });
eq('S21 one day answering 500 does not stop the others: Collingwood (-3d) still resolves', (await pick('Collingwood Magpies'))?.probability, 0.7);
ok('S22 ... and the failure is warned with its status and its day', log.warns.some(w => /\[AFL-ROUND\]/.test(w) && /500/.test(w) && /20260709/.test(w)), 'warns: ' + JSON.stringify(log.warns));
ok('S23 ... but not as "none answered"', !log.warns.some(w => /none of the/.test(w)));
fresh({ status: { '20260709': 500 } });
eq('S24 the team whose only game was on the failed day resolves to null', await pick('Fremantle Dockers'), null);
fresh({ throwOn: ['20260705'] });
eq('S25 a network error on one day does not stop the others: Hawthorn (+6d) still resolves', (await pick('Hawthorn Hawks'))?.probability, 0.4);
ok('S26 ... and the error is warned with the day and the reason', log.warns.some(w => /\[AFL-ROUND\]/.test(w) && /20260705/.test(w) && /network down/.test(w)), 'warns: ' + JSON.stringify(log.warns));
fresh({ espnDown: 400 });
eq('S27 every read refused: the answer is null', await pick('Fremantle Dockers'), null);
ok('S28 ... and it says so, once, loudly (the silent null is the defect this check exists for)',
   log.warns.filter(w => /none of the 10 one-day reads answered/.test(w)).length === 1, 'warns: ' + JSON.stringify(log.warns));
eq('S29 ... and each of the ten refusals is warned too', log.warns.filter(w => /answered 400/.test(w)).length, 10);
eq('S30 ... and Squiggle is never asked without a round', log.squiggle, []);

// "none answered" is said when NONE did, not when some did
const only = (keep) => Object.fromEntries(ALL_DAYS.filter(d => !keep.includes(d)).map(d => [d, 503]));
fresh({ status: only(['20260709']) });
eq('S31 nine days refused and one answering: that one is still searched and resolves', (await pick('Fremantle Dockers'))?.probability, 0.6);
ok('S32 ... and "none answered" is NOT said when one did', !log.warns.some(w => /none of the/.test(w)) && log.warns.filter(w => /answered 503/.test(w)).length === 9, 'warns: ' + JSON.stringify(log.warns));
fresh({ status: only(['20260705', '20260707', '20260709', '20260711', '20260713']) });
ok('S33 five of ten answering: "none answered" is NOT said', !log.warns.some(w => /none of the/.test(w)));

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
  eq(`S34 day -2 answering 200 with ${label} does not stop the later days: Fremantle (+1d) still resolves`, (await pick('Fremantle Dockers'))?.probability, 0.6);
  if (mustWarn) ok(`S35 ... and that day is warned by name (${label})`, warnedFor('20260706'), 'warns: ' + JSON.stringify(log.warns));
}

console.warn = realWarn;
globalThis.fetch = realFetch;
console.log(`COVERAGE: ${total} assertions through the real resolveWinProbability('AFL', ...) over ONE pinned instant (2026-07-08 10:00Z; day-boundary behaviour is not exercised), one ESPN stub (range -> 400 with the measured body; single day -> events with week.number, and a conflicting top-level week) and one Squiggle stub (round-keyed). ESPN team names are the ones the relay served for 2026-07-05..12, Squiggle's are its own; Kali's names are not measured. Not covered here: the real ESPN payload shape (afl-round-live-check.yml), Kali (no token in this check), and the live season.`);
console.log(`${passed} of ${total} passed.`);
process.exit(passed === total ? 0 : 1);
