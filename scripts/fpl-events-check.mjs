#!/usr/bin/env node
// Locks src/fpl-events.js — CC-CMD-2026-08-21-fpl-event-grounding-epl and
// defect 2 of CC-CMD-2026-08-22-brief-sport-contamination.
//
// Every fixture below is shaped from the real payload probed 2026-08-23
// (outbox/fpl-event-shape-*.json): 604 elements of which most never played,
// per-fixture stats inside `explain`, and no minute anywhere.
//
// Run: node scripts/fpl-events-check.mjs
import {
  resolveFplTeam, matchEvents, tableLine, buildFplBlock, fplContextFor, EPL_ALIASES,
} from '../src/fpl-events.js';

let pass = 0, fail = 0;
const ok = (label, cond, detail = '') => {
  if (cond) { console.log(`PASS  ${label}`); pass++; }
  else { console.error(`FAIL  ${label}${detail ? ' — ' + detail : ''}`); fail++; }
};

// ── the bridge ──────────────────────────────────────────────────────────────
const FPL_TEAMS = ['Arsenal', 'Brentford', 'Crystal Palace', 'Everton', 'Hull City',
  'Ipswich Town', 'Leeds', 'Man Utd', "Nott'm Forest", 'Spurs', 'Sunderland'];
const teamsByName = new Map(FPL_TEAMS.map((n, i) => [n, { id: i + 1, name: n }]));

// Verbatim matches observed on 2026-08-22.
for (const n of ['Everton', 'Sunderland', 'Leeds', 'Brentford', 'Spurs']) {
  ok(`ESPN "${n}" resolves verbatim`, resolveFplTeam(n, teamsByName)?.name === n);
}
// The five that needed a line in the map, with the FPL spelling they map to.
for (const [espn, fpl] of Object.entries(EPL_ALIASES)) {
  ok(`ESPN "${espn}" resolves to FPL "${fpl}"`, resolveFplTeam(espn, teamsByName)?.name === fpl);
}
// A club nobody has observed must return null, not a near-miss. This is the
// assertion that keeps a fuzzy matcher out of the module.
ok('an unobserved club resolves to null, not an approximation',
  resolveFplTeam('Manchester City', teamsByName) === null);
ok('a blank name resolves to null', resolveFplTeam('', teamsByName) === null);

// ── per-fixture events, and the double-gameweek trap ────────────────────────
// Saka's gameweek TOTAL is two goals, one in each of two fixtures. A brief
// about fixture 1 that reads the total says he scored twice in it. Reading
// `explain` is what keeps that from happening.
const elementsById = new Map([
  [1, { id: 1, web_name: 'Saka' }], [2, { id: 2, web_name: 'Raya' }],
  [3, { id: 3, web_name: 'Rice' }], [4, { id: 4, web_name: 'Wirtz' }],
]);
const live = [
  { id: 1, stats: { goals_scored: 2 }, explain: [
      { fixture: 1, stats: [{ identifier: 'goals_scored', value: 1 }] },
      { fixture: 9, stats: [{ identifier: 'goals_scored', value: 1 }] }] },
  { id: 3, stats: { assists: 1 }, explain: [
      { fixture: 1, stats: [{ identifier: 'assists', value: 1 }] }] },
  { id: 2, stats: { saves: 6 }, explain: [
      { fixture: 1, stats: [{ identifier: 'saves', value: 6 }] }] },
  // never came on — present in the payload with nothing to its name
  { id: 4, stats: { minutes: 0 }, explain: [{ fixture: 1, stats: [] }] },
];
const ev = matchEvents(1, live, elementsById);
ok('a goal is attributed to the fixture it was scored in, not the GW total',
  ev.goals.length === 1 && ev.goals[0].name === 'Saka' && ev.goals[0].n === 1,
  JSON.stringify(ev.goals));
ok('assists come through', ev.assists.length === 1 && ev.assists[0].name === 'Rice');
ok('a keeper is named only on a real workload (>=4 saves)',
  ev.saves.length === 1 && ev.saves[0].name === 'Raya');
ok('players who did nothing are filtered out, not listed',
  !JSON.stringify(ev).includes('Wirtz'));
ok('a fixture with no events yields empty lists, not nulls',
  matchEvents(77, live, elementsById).goals.length === 0);

// ── the table, and the stat that must not come back ─────────────────────────
ok('table line leads with position and points',
  tableLine({ name: 'Arsenal', position: 1, points: 3, played: 1 }) ===
  'Arsenal: 1st in the table, 3 points from 1 match');
ok('a side yet to play says so rather than reporting 0-0-0',
  tableLine({ name: 'Coventry City', position: 20, points: 0, played: 0 })
    .includes('no matches played yet'));
ok('11th/12th/13th are not 11st/12nd/13rd',
  [11, 12, 13].every(p => tableLine({ name: 'X', position: p, points: 1, played: 1 }).includes(`${p}th`)));
ok('no won-drawn-lost record appears anywhere in a table line',
  !/\d+-\d+-\d+/.test(tableLine({ name: 'X', position: 4, points: 7, played: 3 })));

// ── the prompt block ────────────────────────────────────────────────────────
const block = buildFplBlock({ events: ev, homeTable: tableLine({ name: 'Arsenal', position: 1, points: 3, played: 1 }),
  awayTable: tableLine({ name: 'Spurs', position: 8, points: 1, played: 1 }), fixtureFinished: true });
ok('the block names goalscorers', /\[EPL GOALSCORERS\] Saka/.test(block));
ok('the block carries the table', /\[EPL TABLE\].*Arsenal.*Spurs/.test(block));
// The feed has no timestamps. Saying so is what stops the model supplying one.
ok('the block states that no minute is available', /NO minute/.test(block));
ok('the block never contains a minute marker itself', !/\b\d{1,2}'/.test(block) && !/\b\d{1,2}th minute/.test(block));
// Found by the live run, not designed in: with goalscorers listed and no score
// in sight, the model produced "a 2-1 result" out of two goalscorers.
ok('the block states it carries no scoreline', /NO scoreline/.test(block));
ok('the block forbids inferring a score from the scorer list',
  /never infer the score from the number of goalscorers/.test(block));
ok('the block contains no scoreline of its own', !/\b\d+\s*-\s*\d+\b/.test(block));
ok('an empty match yields null, not a heading with nothing under it',
  buildFplBlock({ events: matchEvents(77, live, elementsById), homeTable: null, awayTable: null }) === null);

// ── the caller-facing contract ──────────────────────────────────────────────
const data = { gameweek: 1, teamsByName, teamsById: new Map(), elementsById,
  liveElements: live, fixtures: [{ id: 1, team_h: 1, team_a: 10, finished: true }] };
ok('a resolvable match returns a block', !!fplContextFor('Arsenal', 'Spurs', data).block);
const miss = fplContextFor('Manchester City', 'Spurs', data);
ok('an unresolved club is reported by name, not silently dropped',
  miss.block === null && miss.reason === 'unresolved-team' && miss.unresolved.includes('Manchester City'),
  JSON.stringify(miss));
ok('missing FPL data is a stated reason, not a throw',
  fplContextFor('Arsenal', 'Spurs', null).reason === 'no-fpl-data');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
