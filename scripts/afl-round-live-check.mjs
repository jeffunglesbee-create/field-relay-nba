#!/usr/bin/env node
/**
 * AFL round discovery against REAL ESPN, from a runner. docs/CC-CMD-2026-11-24-afl-round-discovery-sends-a-date-range.md.
 *
 * scripts/check-afl-round-discovery.mjs proves the resolver's logic over a stub that is built from the field names the code
 * reads. This proves the field names: it runs the real `resolveWinProbability('AFL', ...)` with the clock pinned to
 * 2026-07-08 and real ESPN scoreboard reads (the sandbox cannot reach ESPN; a GitHub runner can). 2026-07-09 is the one
 * fixture date measured by hand (Fremantle v Sydney Swans, round 18, read through the relay's /v2/games), so a correct
 * discovery must ask Squiggle for 2026 round 18.
 *
 * Only Squiggle is stubbed (it is not what is being tested, and its availability must not decide the result): the stub records
 * the URL the resolver asks for and answers one Aggregate tip.
 *
 * WP_RESOLVER_SRC points the resolver elsewhere. The workflow runs this once on the fixed source (must pass) and once on the
 * pre-fix source (must FAIL with an assertion, or this check could not tell the two apart).
 *
 * Printed, not asserted: the live answer to a date RANGE. The premise of the fix is that ESPN refuses it (400, measured
 * 2026-11-24); if ESPN allowed it again nothing here would be broken, so it is recorded and not failed on.
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

const SCOREBOARD_PATH = '/sports/australian-football/afl/scoreboard';   // the host is not pinned: the resolver has moved ESPN hosts twice
const DEFAULT_BASE = 'https://site.api.espn.com/apis/site/v2' + SCOREBOARD_PATH;
const realFetch = globalThis.fetch;
const espn = [];       // { dates, status, events, afl: [{round, home, away}] }
const squiggle = [];   // { url, year, round }
globalThis.fetch = async (input, init) => {
  const url = String(typeof input === 'string' ? input : input.url);
  if (url.startsWith('https://api.squiggle.com.au/')) {
    const m = /year=(\d+);round=(\d+)/.exec(url);
    squiggle.push({ url, year: m && Number(m[1]), round: m && Number(m[2]) });
    const tips = { 17: [{ source: 'Aggregate', hteam: 'Port Adelaide', ateam: 'North Melbourne', hconfidence: '70' }],
                   18: [{ source: 'Aggregate', hteam: 'Fremantle', ateam: 'Sydney', hconfidence: '60' },
                        { source: 'Aggregate', hteam: 'Greater Western Sydney', ateam: 'Geelong', hconfidence: '40' }] }[m && Number(m[2])] || [];
    return new Response(JSON.stringify({ tips }), { status: 200, headers: { 'content-type': 'application/json' } });
  }
  const r = await realFetch(url, init);
  if (new URL(url).pathname.endsWith(SCOREBOARD_PATH)) {
    const dates = new URL(url).searchParams.get('dates');
    let body = null, parseError = null;
    try { body = await r.clone().json(); } catch (e) { parseError = String(e && e.message); }
    const evs = Array.isArray(body && body.events) ? body.events : [];
    espn.push({ url, dates, status: r.status, parseError, events: evs.length,
      afl: evs.map(ev => { const c = (ev.competitions && ev.competitions[0] && ev.competitions[0].competitors) || [];
        const nm = side => (c.find(t => t.homeAway === side) || {}).team?.displayName || null;
        return { round: ev.week && ev.week.number != null ? ev.week.number : null, home: nm('home'), away: nm('away') }; }) });
  }
  return r;
};

const SRC = resolve(process.env.WP_RESOLVER_SRC || 'src/wp-resolver.js');
const { resolveWinProbability } = await import(pathToFileURL(SRC).href);

let passed = 0, total = 0;
const ok = (name, cond, detail) => { total++; if (cond) { passed++; return; } console.log(`FAIL  ${name}${detail ? '\n        ' + detail : ''}`); };

const asPick = (winner) => resolveWinProbability('AFL', { gameId: 'espn:live', predictedWinner: winner }, {});
// Picks run one after another, so squiggle[0..3] are the Squiggle reads of these four picks, in order.
const home = await asPick('Fremantle Dockers');   // client label; ESPN serves "Fremantle"
const away = await asPick('Sydney Swans');
const gws  = await asPick('GWS GIANTS');          // ESPN's spelling; Squiggle's is "Greater Western Sydney"
const port = await asPick('Port Adelaide');       // plays the round-17 game on 2026-07-05 (the window's first day); Adelaide Crows must not stand in

console.log(`resolver: ${SRC}`);
console.log(`clock pinned: ${new RealDate(CLOCK).toISOString()}`);
console.log('ESPN reads made by the resolver (all four picks, in the order they completed):');
for (const e of espn) console.log(`  dates=${e.dates}  HTTP ${e.status}  events ${e.events}${e.parseError ? '  NOT JSON: ' + e.parseError : ''}  ${e.afl.map(g => `r${g.round} ${g.home} v ${g.away}`).join('; ')}`);
console.log('Squiggle asked for:', JSON.stringify(squiggle.map(s => [s.year, s.round])));
console.log('answers: Fremantle Dockers ->', JSON.stringify(home), ' Sydney Swans ->', JSON.stringify(away), ' GWS GIANTS ->', JSON.stringify(gws), ' Port Adelaide ->', JSON.stringify(port));

ok('L1 no ESPN request the resolver made carried a date range', espn.every(e => /^\d{8}$/.test(e.dates || '')), 'dates: ' + JSON.stringify(espn.map(e => e.dates)));
ok('L2 ESPN answered 200, with a JSON body, to every one-day read', espn.length > 0 && espn.every(e => e.status === 200 && e.parseError === null), 'statuses: ' + JSON.stringify(espn.map(e => [e.dates, e.status])));
ok('L3 the read for 20260709 carried the Fremantle v Sydney game, with a week number',
   espn.some(e => e.dates === '20260709' && e.afl.some(g => g.round !== null && /Fremantle/.test(g.home + g.away) && /Sydney/.test(g.home + g.away))),
   '20260709: ' + JSON.stringify((espn.find(e => e.dates === '20260709') || {}).afl));
ok('L4 Squiggle was asked for 2026 round 18 for Fremantle and for Sydney, 18 for GWS GIANTS (GWS GIANTS v Geelong Cats, 2026-07-11) and 17 for Port Adelaide (v North Melbourne, 2026-07-05)',
   squiggle.length === 4 && squiggle.every(s => s.year === 2026) && JSON.stringify(squiggle.map(s => s.round)) === '[18,18,18,17]', 'asked: ' + JSON.stringify(squiggle.map(s => s.url)));
ok('L5 the home pick resolved to a probability', home && home.probability === 0.6, 'got ' + JSON.stringify(home));
ok('L6 the away pick resolved to the complement', away && away.probability === 0.4, 'got ' + JSON.stringify(away));
ok('L7 GWS GIANTS (ESPN) found Squiggle\'s Greater Western Sydney tip: home side, 0.4', gws && gws.probability === 0.4, 'got ' + JSON.stringify(gws));
ok('L8 Port Adelaide took its own round-17 tip (home, 0.7)', port && port.probability === 0.7, 'got ' + JSON.stringify(port));

// Printed, not asserted: what ESPN says to a date RANGE today.
try {
  const base = espn.length ? espn[0].url.split('?')[0] : DEFAULT_BASE;   // the host the resolver itself used
  const rr = await realFetch(`${base}?dates=20260705-20260714`, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(8000) });
  console.log(`INFO  a date RANGE (dates=20260705-20260714) is answered HTTP ${rr.status}: ${(await rr.text()).slice(0, 120)}`);
} catch (e) { console.log(`INFO  the range read failed: ${e && e.message}`); }

console.log(`COVERAGE: ${espn.length} ESPN reads recorded over 4 picks (ten per pick when the resolver reads one day at a time; the pre-fix resolver makes one range read per pick), one pinned clock (2026-07-08), one stubbed Squiggle (round-keyed, Squiggle's own team names). Not covered: any other round or season, the other fourteen clubs, Kali, and the live in-season slate.`);
console.log(`${passed} of ${total} passed.`);
process.exit(passed === total ? 0 : 1);
