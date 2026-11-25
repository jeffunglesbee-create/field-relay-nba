#!/usr/bin/env node
// The BSD game join, offline, on the EFL Championship label (docs/CC-CMD-2026-10-27-bsd-event-id-on-game-rows.md, Addendum 2026-11-25, the owner's "build both next").
// Runs the real joinBatch (src/bsd-game-join.js, the rule, untouched) over outbox/fixture-bsd-game-join-eflchamp.json: the archive's 200 EFL Championship rows of 40
// dates (written by the history backfill of the same day) and the BSD events of each date and the next, both captured from the deployed relay on a runner. With the
// label on the list and no club aliases it joined 42 of 200; with the 13 aliases, 200 of 200. That last number is pinned here, so a dropped alias or a dropped label
// is a red check (scripts/mutate-bsd-uefa-join.mjs deletes each in turn, this block included).
//
//   node scripts/check-bsd-eflchamp-join.mjs
import fs from 'node:fs';
import { joinBatch, eventDaysFor, BSD_SOCCER_SPORTS, BSD_KICKOFF_REFUSE_MINUTES } from '../src/bsd-game-join.js';
import { resolveTeamKey } from '../src/identity-resolver.js';

const FIXTURE = new URL('../outbox/fixture-bsd-game-join-eflchamp.json', import.meta.url);
const LABEL = 'EFL Championship';
const ROWS = 200;

let n = 0, bad = 0;
const check = (name, ok, detail = '') => { n++; if (!ok) { bad++; console.log(`FAIL  ${name}${detail ? `\n      -> ${detail}` : ''}`); } };
const nameOf = (t) => (t && typeof t === 'object' ? t.name : t);

const fx = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));
check('the fixture is the one the check was written against: 40 dates, the one label', fx.dates.length === 40 && JSON.stringify(fx.soccerSports) === JSON.stringify([LABEL]), JSON.stringify(fx.soccerSports));

const claimed = new Map();   // event id -> row id, so an event joined twice is seen
const doubles = [], unjoined = [], farKickoff = [];
let rows = 0, events = 0, unjudged = 0, joined = 0;
for (const d of fx.dates) {
  const evs = eventDaysFor(d.date).flatMap((day) => d.events[day] ?? []);
  events += evs.length;
  const byId = new Map(evs.map((e) => [String(e.id), e]));
  const { results } = joinBatch(d.rows, evs);
  d.rows.forEach((r, i) => {
    rows++;
    if (r.sport !== LABEL) { unjoined.push(`${r.id} (label ${r.sport} is not ${LABEL})`); return; }
    const res = results[i];
    if (res.how !== 'joined') { unjoined.push(`${r.id} ${r.home} v ${r.away}: ${res.how}`); return; }
    joined++;
    const e = byId.get(String(res.bsd_event_id));
    if (claimed.has(res.bsd_event_id)) doubles.push(`${res.bsd_event_id}: ${claimed.get(res.bsd_event_id)} and ${r.id}`); else claimed.set(res.bsd_event_id, r.id);
    if (res.kickoff === 'unjudged') unjudged++;
    else { const gap = Math.abs(Date.parse(r.start_time) - Date.parse(e.event_date)) / 60000; if (!(gap <= BSD_KICKOFF_REFUSE_MINUTES)) farKickoff.push(`${r.id}: ${gap} min`); }
    // the join's own contract, restated on the served rows: both sides under one key, in the same orientation
    if (resolveTeamKey(r.home) !== resolveTeamKey(nameOf(e.home_team)) || resolveTeamKey(r.away) !== resolveTeamKey(nameOf(e.away_team))) unjoined.push(`${r.id}: joined to an event whose sides do not resolve to its own`);
  });
}
check('the EFL Championship label is on the join list, once', BSD_SOCCER_SPORTS.filter((x) => x === LABEL).length === 1, JSON.stringify(BSD_SOCCER_SPORTS));
check(`every fixture row is an ${LABEL} row, and there are ${ROWS} of them (${rows} rows, ${events} events read)`, rows === ROWS, String(rows));
check(`${ROWS} of ${ROWS} rows are joined`, joined === ROWS && unjoined.length === 0, `${joined} joined: ${unjoined.slice(0, 8).join(' | ')}`);
check('no BSD event is joined to two rows', doubles.length === 0, doubles.slice(0, 5).join(' | '));
check(`no joined pair is further apart than the ${BSD_KICKOFF_REFUSE_MINUTES}-minute refusal (${unjudged} rows carry no start_time and are not judged)`, farKickoff.length === 0, farKickoff.slice(0, 5).join(' | '));

// controls: the join is still a join, not a list of yeses
const ev = (id, h, a) => ({ id, home_team: { name: h }, away_team: { name: a }, event_date: '2026-09-16T19:00:00Z' });
const row = (sport, h, a) => ({ id: `${sport}_${h}_${a}`, sport, home: h, away: a, start_time: '2026-09-16T19:00:00Z' });
const j = (r, evs) => joinBatch([r], evs).results[0].how;
check('control: the short names ESPN serves meet the full ones BSD serves', j(row(LABEL, 'Boro', 'QPR'), [ev(1, 'Middlesbrough', 'Queens Park Rangers')]) === 'joined');
check('control: a row against an event of two clubs it does not name is unmatched', j(row(LABEL, 'Boro', 'QPR'), [ev(1, 'Stoke City', 'Swansea City')]) === 'unmatched');
check('control: the same clubs with home and away swapped are unmatched (the orientation rule)', j(row(LABEL, 'Boro', 'QPR'), [ev(1, 'Queens Park Rangers', 'Middlesbrough')]) === 'unmatched');
check('control: a club with no alias and a spelling BSD does not share is unmatched, not guessed', j(row(LABEL, 'Zzyzx', 'QPR'), [ev(1, 'Zzyzx Rovers FC', 'Queens Park Rangers')]) === 'unmatched');
check('control: two events that fit one row are ambiguous, never the first', j(row(LABEL, 'Boro', 'QPR'), [ev(1, 'Middlesbrough', 'Queens Park Rangers'), ev(2, 'Middlesbrough', 'Queens Park Rangers')]) === 'ambiguous');
check('control: a row of a label not on the list is not soccer to the join', j(row('EFL League One', 'Boro', 'QPR'), [ev(1, 'Middlesbrough', 'Queens Park Rangers')]) === 'not-soccer');
console.log(`\ncoverage: ${fx.dates.length} dates, ${rows} ${LABEL} rows, ${events} BSD events; ${joined} joined`);
console.log(bad === 0 ? `ok ${n} checks` : `${bad} of ${n} FAILED`);
process.exit(bad === 0 ? 0 : 1);
