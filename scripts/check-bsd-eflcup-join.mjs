#!/usr/bin/env node
// The BSD game join, offline, on the EFL Cup label (docs/CC-CMD-2026-10-27-bsd-event-id-on-game-rows.md, Addendum 2026-11-26, the owner's "join EFL Cup and Trophy").
// Runs the real joinBatch (src/bsd-game-join.js, the rule, untouched) over outbox/fixture-bsd-game-join-eflcups.json: the archive's 81 EFL Cup and 98 EFL Trophy rows of 27
// dates and the BSD events of each date and the next, both captured from the deployed relay on a runner. With the EFL Cup label on the list and no aliases it joined 43 of 81;
// with the 29 club aliases, 81 of 81. That last number is pinned here, so a dropped alias or a dropped label is a red check (scripts/mutate-bsd-uefa-join.mjs deletes each in turn).
//
// EFL Trophy is NOT on the list, and the second half of this check is why: its 98 rows are relabelled to a label that IS on the list and run through the same join, and none
// joins (measured 2026-11-26: 97 have no BSD event at all, 1 a one-sided look-alike; BSD's league list holds a Carabao Cup, league 40, and no Trophy). The fixture is a record of that
// measurement, not a live read: if BSD starts carrying the Trophy, capture again, and this half goes red the day the relabelled rows join.
//
//   node scripts/check-bsd-eflcup-join.mjs
import fs from 'node:fs';
import { joinBatch, eventDaysFor, BSD_SOCCER_SPORTS, BSD_KICKOFF_REFUSE_MINUTES } from '../src/bsd-game-join.js';
import { resolveTeamKey } from '../src/identity-resolver.js';

const FIXTURE = new URL('../outbox/fixture-bsd-game-join-eflcups.json', import.meta.url);
const CUP = 'EFL Cup', TROPHY = 'EFL Trophy';
const CUP_ROWS = 81, TROPHY_ROWS = 98;

let n = 0, bad = 0;
const check = (name, ok, detail = '') => { n++; if (!ok) { bad++; console.log(`FAIL  ${name}${detail ? `\n      -> ${detail}` : ''}`); } };
const nameOf = (t) => (t && typeof t === 'object' ? t.name : t);

const fx = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));
check('the fixture is the one the check was written against: 27 dates, the two labels', fx.dates.length === 27 && JSON.stringify([...fx.soccerSports].sort()) === JSON.stringify([CUP, TROPHY].sort()), JSON.stringify(fx.soccerSports));

const claimed = new Map();   // event id -> row id, so an event joined twice is seen
const doubles = [], unjoined = [], farKickoff = [];
let cup = 0, cupJoined = 0, trophy = 0, trophyNotSoccer = 0, trophyRelabelledJoined = 0, events = 0, unjudged = 0;
for (const d of fx.dates) {
  const evs = eventDaysFor(d.date).flatMap((day) => d.events[day] ?? []);
  events += evs.length;
  const byId = new Map(evs.map((e) => [String(e.id), e]));
  const { results } = joinBatch(d.rows, evs);
  d.rows.forEach((r, i) => {
    const res = results[i];
    if (r.sport === TROPHY) { trophy++; if (res.how === 'not-soccer') trophyNotSoccer++; return; }
    if (r.sport !== CUP) { unjoined.push(`${r.id} (label ${r.sport} is neither of the two)`); return; }
    cup++;
    if (res.how !== 'joined') { unjoined.push(`${r.id} ${r.home} v ${r.away}: ${res.how}`); return; }
    cupJoined++;
    const e = byId.get(String(res.bsd_event_id));
    if (claimed.has(res.bsd_event_id)) doubles.push(`${res.bsd_event_id}: ${claimed.get(res.bsd_event_id)} and ${r.id}`); else claimed.set(res.bsd_event_id, r.id);
    if (res.kickoff === 'unjudged') unjudged++;
    else { const gap = Math.abs(Date.parse(r.start_time) - Date.parse(e.event_date)) / 60000; if (!(gap <= BSD_KICKOFF_REFUSE_MINUTES)) farKickoff.push(`${r.id}: ${gap} min`); }
    // the join's own contract, restated on the served rows: both sides under one key, in the same orientation
    if (resolveTeamKey(r.home) !== resolveTeamKey(nameOf(e.home_team)) || resolveTeamKey(r.away) !== resolveTeamKey(nameOf(e.away_team))) unjoined.push(`${r.id}: joined to an event whose sides do not resolve to its own`);
  });
  // the Trophy rows again, under a label the join accepts: would any of them join if the label were on the list?
  const relabelled = d.rows.filter((r) => r.sport === TROPHY).map((r) => ({ ...r, sport: CUP }));
  if (relabelled.length > 0) for (const res of joinBatch(relabelled, evs).results) if (res.how === 'joined') trophyRelabelledJoined++;
}
check('the EFL Cup label is on the join list, once', BSD_SOCCER_SPORTS.filter((x) => x === CUP).length === 1, JSON.stringify(BSD_SOCCER_SPORTS));
check(`every EFL Cup row of the fixture is there: ${CUP_ROWS} of them (${cup} read, ${events} BSD events read)`, cup === CUP_ROWS, String(cup));
check(`${CUP_ROWS} of ${CUP_ROWS} EFL Cup rows are joined`, cupJoined === CUP_ROWS && unjoined.length === 0, `${cupJoined} joined: ${unjoined.slice(0, 8).join(' | ')}`);
check('no BSD event is joined to two rows', doubles.length === 0, doubles.slice(0, 5).join(' | '));
check(`no joined pair is further apart than the ${BSD_KICKOFF_REFUSE_MINUTES}-minute refusal (${unjudged} rows carry no start_time and are not judged)`, farKickoff.length === 0, farKickoff.slice(0, 5).join(' | '));
check('the EFL Trophy label is NOT on the join list', !BSD_SOCCER_SPORTS.includes(TROPHY), JSON.stringify(BSD_SOCCER_SPORTS));
check(`the ${TROPHY_ROWS} EFL Trophy rows of the fixture are not soccer to the join (${trophy} read, ${trophyNotSoccer} not-soccer)`, trophy === TROPHY_ROWS && trophyNotSoccer === TROPHY_ROWS, `${trophy} read, ${trophyNotSoccer} not-soccer`);
check(`relabelled to a label on the list, none of the ${TROPHY_ROWS} Trophy rows joins: BSD has no event for them (the reason the label stays off)`, trophyRelabelledJoined === 0, `${trophyRelabelledJoined} joined`);

// controls: the join is still a join, not a list of yeses
const ev = (id, h, a) => ({ id, home_team: { name: h }, away_team: { name: a }, event_date: '2026-09-16T19:00:00Z' });
const row = (sport, h, a) => ({ id: `${sport}_${h}_${a}`, sport, home: h, away: a, start_time: '2026-09-16T19:00:00Z' });
const j = (r, evs) => joinBatch([r], evs).results[0].how;
check('control: the short names ESPN serves meet the full ones BSD serves', j(row(CUP, 'Wimbledon', 'Oxford Utd'), [ev(1, 'AFC Wimbledon', 'Oxford United')]) === 'joined');
check('control: a row against an event of two clubs it does not name is unmatched', j(row(CUP, 'Wimbledon', 'Oxford Utd'), [ev(1, 'Luton Town', 'Swindon Town')]) === 'unmatched');
check('control: the same clubs with home and away swapped are unmatched (the orientation rule)', j(row(CUP, 'Wimbledon', 'Oxford Utd'), [ev(1, 'Oxford United', 'AFC Wimbledon')]) === 'unmatched');
check('control: a club with no alias and a spelling BSD does not share is unmatched, not guessed', j(row(CUP, 'Zzyzx', 'Oxford Utd'), [ev(1, 'Zzyzx Rovers FC', 'Oxford United')]) === 'unmatched');
check('control: two events that fit one row are ambiguous, never the first', j(row(CUP, 'Wimbledon', 'Oxford Utd'), [ev(1, 'AFC Wimbledon', 'Oxford United'), ev(2, 'AFC Wimbledon', 'Oxford United')]) === 'ambiguous');
check('control: a Trophy row is not soccer to the join, even against the right event', j(row(TROPHY, 'Wimbledon', 'Oxford Utd'), [ev(1, 'AFC Wimbledon', 'Oxford United')]) === 'not-soccer');
console.log(`\ncoverage: ${fx.dates.length} dates, ${cup} ${CUP} rows and ${trophy} ${TROPHY} rows, ${events} BSD events; ${cupJoined} ${CUP} joined, ${trophyRelabelledJoined} ${TROPHY} joined when relabelled`);
console.log(bad === 0 ? `ok ${n} checks` : `${bad} of ${n} FAILED`);
process.exit(bad === 0 ? 0 : 1);
