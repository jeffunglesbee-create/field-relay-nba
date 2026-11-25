#!/usr/bin/env node
// The BSD game join, offline, on the UEFA labels (docs/CC-CMD-2026-10-27-bsd-event-id-on-game-rows.md, Addendum 2026-11-25, the owner's "build both next").
// Runs the real joinBatch (src/bsd-game-join.js, the rule, untouched) over outbox/fixture-bsd-game-join-uefa.json: the archive's UEFA rows of 24 dates and the BSD
// events of each date and the next, both captured from the deployed relay on a runner. Before the six UEFA labels and the 64 club aliases it joined 0 of 302 (the
// labels were not on the list); with the list alone, 103 of 302; with the aliases, 302 of 302. That last number is pinned here, per label, so a dropped alias or a
// dropped label is a red check (scripts/mutate-bsd-uefa-join.mjs deletes each in turn).
//
//   node scripts/check-bsd-uefa-join.mjs
import fs from 'node:fs';
import { joinBatch, eventDaysFor, BSD_SOCCER_SPORTS, BSD_KICKOFF_REFUSE_MINUTES } from '../src/bsd-game-join.js';
import { resolveTeamKey } from '../src/identity-resolver.js';

const FIXTURE = new URL('../outbox/fixture-bsd-game-join-uefa.json', import.meta.url);
const UEFA = ['UEFA Champions League', 'UEFA Europa League', 'UEFA Europa Conference League', 'UEFA Champions League Qualifying', 'UEFA Europa League Qualifying', 'UEFA Europa Conference League Qualifying'];
const EXPECT = { 'UEFA Champions League': 91, 'UEFA Europa League': 73, 'UEFA Europa Conference League': 55, 'UEFA Champions League Qualifying': 11, 'UEFA Europa League Qualifying': 24, 'UEFA Europa Conference League Qualifying': 48 };

let n = 0, bad = 0;
const check = (name, ok, detail = '') => { n++; if (!ok) { bad++; console.log(`FAIL  ${name}${detail ? `\n      -> ${detail}` : ''}`); } };
const nameOf = (t) => (t && typeof t === 'object' ? t.name : t);

const fx = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));
check('the fixture is the one the check was written against: 24 dates, the six UEFA labels', fx.dates.length === 24 && JSON.stringify([...fx.soccerSports].sort()) === JSON.stringify([...UEFA].sort()), JSON.stringify(fx.soccerSports));

const perLabel = Object.fromEntries(UEFA.map((l) => [l, { rows: 0, joined: 0 }]));
const claimed = new Map();   // event id -> row id, so an event joined twice is seen
const doubles = [], unjoined = [], farKickoff = [];
let rows = 0, events = 0, unjudged = 0;
for (const d of fx.dates) {
  const evs = eventDaysFor(d.date).flatMap((day) => d.events[day] ?? []);
  events += evs.length;
  const byId = new Map(evs.map((e) => [String(e.id), e]));
  const { results } = joinBatch(d.rows, evs);
  d.rows.forEach((r, i) => {
    rows++;
    const l = perLabel[r.sport];
    if (l === undefined) { unjoined.push(`${r.id} (label ${r.sport} is not one of the six)`); return; }
    l.rows++;
    const res = results[i];
    if (res.how !== 'joined') { unjoined.push(`${r.id}: ${res.how}`); return; }
    l.joined++;
    const e = byId.get(String(res.bsd_event_id));
    if (claimed.has(res.bsd_event_id)) doubles.push(`${res.bsd_event_id}: ${claimed.get(res.bsd_event_id)} and ${r.id}`); else claimed.set(res.bsd_event_id, r.id);
    if (res.kickoff === 'unjudged') unjudged++;
    else { const gap = Math.abs(Date.parse(r.start_time) - Date.parse(e.event_date)) / 60000; if (!(gap <= BSD_KICKOFF_REFUSE_MINUTES)) farKickoff.push(`${r.id}: ${gap} min`); }
    // the join's own contract, restated on the served rows: both sides under one key, in the same orientation
    if (resolveTeamKey(r.home) !== resolveTeamKey(nameOf(e.home_team)) || resolveTeamKey(r.away) !== resolveTeamKey(nameOf(e.away_team))) unjoined.push(`${r.id}: joined to an event whose sides do not resolve to its own`);
  });
}
check('every UEFA label is on the join list, once', UEFA.every((l) => BSD_SOCCER_SPORTS.filter((x) => x === l).length === 1), JSON.stringify(BSD_SOCCER_SPORTS));
check('the six labels the join already covered are still on it', ['MLS', 'EPL', 'La Liga', 'Serie A', 'Bundesliga', 'Ligue 1'].every((l) => BSD_SOCCER_SPORTS.includes(l)), JSON.stringify(BSD_SOCCER_SPORTS));
const ALL = ['MLS', 'EPL', 'La Liga', 'Serie A', 'Bundesliga', 'Ligue 1', ...UEFA, 'EFL Championship'];
check('the list is exactly those thirteen labels (the six leagues, the six UEFA labels, EFL Championship) and nothing else', BSD_SOCCER_SPORTS.length === 13 && JSON.stringify([...BSD_SOCCER_SPORTS].sort()) === JSON.stringify([...ALL].sort()), JSON.stringify(BSD_SOCCER_SPORTS));
check(`every fixture row is of one of the six labels, and there are 302 of them (${rows} rows, ${events} events read)`, rows === 302 && Object.values(perLabel).reduce((t, x) => t + x.rows, 0) === 302, String(rows));
for (const l of UEFA) check(`${l}: ${EXPECT[l]} rows, all ${EXPECT[l]} joined`, perLabel[l].rows === EXPECT[l] && perLabel[l].joined === EXPECT[l], `${perLabel[l].joined} of ${perLabel[l].rows}: ${unjoined.filter((u) => u.includes(l.replace(/ /g, '').slice(0, 0))).length}`);
check('302 of 302 rows are joined', unjoined.length === 0, unjoined.slice(0, 8).join(' | '));
check('no BSD event is joined to two rows', doubles.length === 0, doubles.slice(0, 5).join(' | '));
check(`no joined pair is further apart than the ${BSD_KICKOFF_REFUSE_MINUTES}-minute refusal (${unjudged} rows carry no start_time and are not judged)`, farKickoff.length === 0, farKickoff.slice(0, 5).join(' | '));

// controls: the join is still a join, not a list of yeses
const ev = (id, h, a) => ({ id, home_team: { name: h }, away_team: { name: a }, event_date: '2026-09-16T19:00:00Z' });
const row = (sport, h, a) => ({ id: `${sport}_${h}_${a}`, sport, home: h, away: a, start_time: '2026-09-16T19:00:00Z' });
const j = (r, evs) => joinBatch([r], evs).results[0].how;
check('control: a UEFA row against an event of two clubs it does not name is unmatched', j(row('UEFA Champions League', 'Sporting', 'Man Utd'), [ev(1, 'Sporting Braga', 'Kuopion Palloseura')]) === 'unmatched');
check('control: a UEFA row whose home and away are swapped against the event is unmatched (the orientation rule)', j(row('UEFA Champions League', 'Sporting', 'Man Utd'), [ev(1, 'Manchester United', 'Sporting CP')]) === 'unmatched');
check('control: the same row against the right event, with the BSD long names, is joined', j(row('UEFA Champions League', 'Sporting', 'Man Utd'), [ev(1, 'Sporting CP', 'Manchester United')]) === 'joined');
check('control: a club with no alias and a spelling BSD does not share is unmatched, not guessed', j(row('UEFA Champions League', 'Zzyzx United', 'Man Utd'), [ev(1, 'Zzyzx Utd FC', 'Manchester United')]) === 'unmatched');
check('control: two events that fit one row are ambiguous, never the first', j(row('UEFA Champions League', 'Sporting', 'Man Utd'), [ev(1, 'Sporting CP', 'Manchester United'), ev(2, 'Sporting CP', 'Manchester United')]) === 'ambiguous');
check('control: a row of a label not on the list is not soccer to the join', j(row('UEFA Super Cup', 'Sporting', 'Man Utd'), [ev(1, 'Sporting CP', 'Manchester United')]) === 'not-soccer');
console.log(`\ncoverage: ${fx.dates.length} dates, ${rows} UEFA rows, ${events} BSD events; ${Object.values(perLabel).reduce((t, x) => t + x.joined, 0)} joined`);
console.log(bad === 0 ? `ok ${n} checks` : `${bad} of ${n} FAILED`);
process.exit(bad === 0 ? 0 : 1);
