#!/usr/bin/env node
/**
 * AFL finals against REAL ESPN and REAL Squiggle, from a runner. docs/CC-CMD-2026-11-24-afl-finals-round-and-journalism-club-match.md, Part C.
 *
 * MODE=resolver (default): the real resolveWinProbability('AFL', ...) with the clock pinned inside the 2026 finals, real ESPN scoreboard reads and real Squiggle
 * reads. The expected values are Squiggle's own Aggregate tips for the finished 2026 finals (read 2026-11-24: ?q=tips;year=2026;round=25..29;source=8), which do
 * not change. The control is the resolver as it was before the fix (WP_RESOLVER_SRC), which hands ESPN's week 2 to Squiggle as a round and answers a March
 * game's tip: it must FAIL here by assertion, or this check could not tell the two apart.
 * MODE=relay: the DEPLOYED relay's GET /v2/games?sport=afl for finals dates and for the two other defects of the same CC-CMD (GWS GIANTS, the Opening Round).
 * Before the deploy that carries the fix it must FAIL (it serves March's 47.29 for the 2026-09-05 Adelaide v Western Bulldogs final); after it, pass.
 *
 * The sandbox cannot reach ESPN or Squiggle; a GitHub runner can.
 */
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const MODE = process.env.MODE || 'resolver';
const RealDate = Date;
let CLOCK = RealDate.now();
class PinnedDate extends RealDate {
  constructor(...a) { if (a.length) super(...a); else super(CLOCK); }
  static now() { return CLOCK; }
}
let passed = 0, total = 0;
const ok = (name, cond, detail) => { total++; if (cond) { passed++; return; } console.log(`FAIL  ${name}${detail ? '\n        ' + detail : ''}`); };

if (MODE === 'resolver') {
  globalThis.Date = PinnedDate;
  const realFetch = globalThis.fetch;
  let urls = [];
  globalThis.fetch = async (input, init) => { const url = String(typeof input === 'string' ? input : input.url); urls.push(url); return realFetch(url, init); };
  const warns = []; const realWarn = console.warn; console.warn = (...a) => { warns.push(a.map(String).join(' ')); };
  const { resolveWinProbability } = await import(pathToFileURL(resolve(process.env.WP_RESOLVER_SRC || 'src/wp-resolver.js')).href);
  console.log(`resolver: ${process.env.WP_RESOLVER_SRC || 'src/wp-resolver.js'}`);
  const run = async (clock, winner) => {
    CLOCK = RealDate.parse(clock); urls = []; warns.length = 0;
    const r = await resolveWinProbability('AFL', { gameId: 'espn:live', predictedWinner: winner }, {});
    const squiggle = urls.filter(u => u.startsWith('https://api.squiggle.com.au/')).map(u => u.slice('https://api.squiggle.com.au/'.length));
    console.log(`  ${clock.slice(0, 10)}  ${winner.padEnd(18)} -> ${JSON.stringify(r)}  squiggle ${JSON.stringify(squiggle)}${warns.length ? '  warns ' + JSON.stringify(warns) : ''}`);
    return { r, squiggle };
  };
  // 2026-09-04 10:00Z: the window is 09-01..09-10, holding the finals of 09-03 (Fremantle v Hawthorn, 66.02), 09-04 (Geelong v Carlton), 09-05 (Sydney v Brisbane Lions;
  // Adelaide v Western Bulldogs, 68.60). The pick names a club; its EARLIEST game in the window is the one answered.
  const adel = await run('2026-09-04T10:00:00Z', 'Adelaide Crows');
  ok('L1 Adelaide Crows resolves to the 2026-09-05 final\'s own tip, 68.60 -> 0.686 (not March\'s round-2 47.29 -> 0.473)', adel.r && adel.r.probability === 0.686 && adel.r.source === 'squiggle', 'got ' + JSON.stringify(adel.r));
  ok('L2 ... asking Squiggle for Adelaide\'s season (team 1) and for no round', JSON.stringify(adel.squiggle) === JSON.stringify(['?q=tips;year=2026;team=1;source=8']), 'asked ' + JSON.stringify(adel.squiggle));
  const dogs = await run('2026-09-04T10:00:00Z', 'Western Bulldogs');
  ok('L3 Western Bulldogs, the away club of that final, resolves to the rest: 0.314', dogs.r && dogs.r.probability === 0.314, 'got ' + JSON.stringify(dogs.r));
  const frem = await run('2026-09-04T10:00:00Z', 'Fremantle Dockers');
  ok('L4 Fremantle Dockers resolves to the 2026-09-03 final (Fremantle v Hawthorn, 66.02): 0.66', frem.r && frem.r.probability === 0.66, 'got ' + JSON.stringify(frem.r));
  const gf = await run('2026-09-25T10:00:00Z', 'Brisbane Lions');
  ok('L5 the Grand Final (ESPN week 5, Squiggle round 29), Brisbane Lions away: (100 - 48.51) / 100 = 0.515', gf.r && gf.r.probability === 0.515, 'got ' + JSON.stringify(gf.r));
  const wc = await run('2026-08-27T10:00:00Z', 'Collingwood Magpies');
  ok('L6 a Wildcard Final (ESPN week 1, a round that is also March\'s round 1), Collingwood away at the Western Bulldogs (home 47.20): 0.528', wc.r && wc.r.probability === 0.528, 'got ' + JSON.stringify(wc.r));
  console.warn = realWarn;
  console.log(`COVERAGE: ${total} assertions: the real resolver, real ESPN one-day reads and real Squiggle, five picks across the 2026 finals (a Qualifying and an Elimination week, the Grand Final, the Wildcard week), the clock pinned. Not covered: another season, Kali (not asked for a final), the journalism route (MODE=relay), a final in progress.`);
} else {
  const RELAY = process.env.RELAY || 'https://field-relay-nba.jeffunglesbee.workers.dev';
  const games = async (date) => {
    const r = await fetch(`${RELAY}/v2/games?sport=afl&date=${date}`);
    const j = r.ok ? await r.json() : null;
    console.log(`  GET /v2/games?sport=afl&date=${date} -> HTTP ${r.status}, ${j ? j.games.length : 0} game(s)`);
    return j ? j.games : [];
  };
  const sq = (gs, home) => { const g = gs.find(x => x.home.name === home); return g ? (g.journalism ? g.journalism.squiggle : 'no journalism key') : 'no such game'; };
  console.log(`relay: ${RELAY}`);
  const f1 = await games('2026-09-05');
  for (const [h, want] of [['Adelaide Crows', '68.60'], ['Sydney Swans', '50.61']]) {
    const s = sq(f1, h);
    console.log(`  ${h}: ${JSON.stringify(s)}`);
    ok(`R1 ${h}'s 2026-09-05 final (ESPN week 2) is served its own tip ${want} (the old relay served a March tip)`, s && s.homeConfidence === want, 'got ' + JSON.stringify(s));
  }
  const f2 = await games('2026-09-26');
  ok('R2 the Grand Final (the old relay served null) is served 48.51', (sq(f2, 'Fremantle') || {}).homeConfidence === '48.51', 'got ' + JSON.stringify(sq(f2, 'Fremantle')));
  const f3 = await games('2026-08-28');
  ok('R3 a Wildcard Final is served its own tip 47.20', (sq(f3, 'Western Bulldogs') || {}).homeConfidence === '47.20', 'got ' + JSON.stringify(sq(f3, 'Western Bulldogs')));
  const g1 = await games('2026-07-11');
  ok('R4 GWS GIANTS v Geelong Cats (the old relay served null) is served Squiggle\'s Greater Western Sydney tip 42.16', (sq(g1, 'GWS GIANTS') || {}).homeConfidence === '42.16', 'got ' + JSON.stringify(sq(g1, 'GWS GIANTS')));
  const o1 = await games('2026-03-05');
  ok('R5 the Opening Round games (round 0; the old relay served no journalism key) carry a journalism key with Squiggle\'s tip', o1.length > 0 && o1.every(g => g.journalism && g.journalism.squiggle), 'got ' + JSON.stringify(o1.map(g => g.journalism)));
  // The year (Part D). The journalism year was the constant `season: 2026`, so any 2027 date was served 2026's round-1 tip: the scheduled 2027-03-18 Fremantle v Western Bulldogs game
  // carried 71.48, 2026's Western Bulldogs v GWS (read 2026-11-25; Squiggle's own tip for the 2027 game was 68.10 that day). A pre-game tip moves until kickoff, so this asserts what is
  // stable: a number, and not the 2026 one.
  const y1 = await games('2027-03-18');
  const y = sq(y1, 'Fremantle');
  console.log(`  Fremantle (2027-03-18): ${JSON.stringify(y)}`);
  ok('R6 a 2027 game is served a 2027 tip, not 2026\'s round-1 tip: Fremantle v Western Bulldogs (2027-03-18) carries a number that is not 71.48', !!y && typeof y === 'object' && /^\d+(\.\d+)?$/.test(String(y.homeConfidence)) && y.homeConfidence !== '71.48', 'got ' + JSON.stringify(y));
  console.log(`COVERAGE: ${total} assertions against the DEPLOYED relay, five dates of the finished 2026 season and one 2027 date (as "not 2026's tip": a pre-game tip moves). Needs KALI_AFL_TOKEN set in production (the journalism context is gated on it). Not covered: Kali, a game in progress, the preseason, a 2027 final.`);
}
console.log(`${passed} of ${total} passed.`);
process.exit(passed === total ? 0 : 1);
