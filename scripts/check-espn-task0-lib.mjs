#!/usr/bin/env node
// Check for scripts/espn-task0-lib.mjs. Every expected value below was derived by hand from the rule, not from the code's output.
// Exit 1 and a FAIL line on any difference. The mutation harness (mutate-espn-task0-lib.mjs) proves each rule here can fail.
import * as L from './espn-task0-lib.mjs';

let n = 0, bad = 0;
const norm = (v) => JSON.parse(JSON.stringify(v === undefined ? null : v));
function eq(name, actual, expected) {
  n++;
  const a = JSON.stringify(norm(actual)), e = JSON.stringify(norm(expected));
  if (a !== e) { bad++; console.log(`FAIL ${name}\n  expected ${e}\n  actual   ${a}`); }
}

// ---- days
eq('dayOf: a timestamp gives its UTC day', L.dayOf('2026-10-25T21:00:00Z'), '2026-10-25');
eq('dayOf: an impossible date is refused', L.dayOf('2026-02-30'), null);
eq('dayOf: a non-string is refused', L.dayOf(20261025), null);
eq('prevDay crosses a month', L.prevDay('2026-03-01'), '2026-02-28');
eq('prevDay crosses a year', L.prevDay('2026-01-01'), '2025-12-31');
eq('neededDays: each day and the day before, once, sorted', L.neededDays(['2026-10-26', '2026-10-25', '2026-10-25']), ['2026-10-24', '2026-10-25', '2026-10-26']);
eq('daysToRead: invalid and missing days add nothing', L.daysToRead([{ callDays: ['2026-10-25'] }, { callDays: ['bad'] }, {}]), ['2026-10-24', '2026-10-25']);

eq('daysToRead: null, undefined and numbers are not days (dayOf(null) is null, and null === null)', L.daysToRead([{ callDays: [null, undefined, 5, '2026-10-25'] }]), ['2026-10-24', '2026-10-25']);

// ---- the rows of a read
const A = { id: 'a' }, B = { id: 'b' };
eq('rowsOfDay: regular and postseason', L.rowsOfDay({ ok: true, games: { regular: [A], postseason: [B] } }), [A, B]);
eq('rowsOfDay: regular only', L.rowsOfDay({ ok: true, games: { regular: [A] } }), [A]);
eq('rowsOfDay: a postseason that is not a list is not the contract', L.rowsOfDay({ ok: true, games: { regular: [A], postseason: {} } }), null);
eq('rowsOfDay: ok false', L.rowsOfDay({ ok: false, games: { regular: [] } }), null);
eq('rowsOfDay: no games', L.rowsOfDay({ ok: true }), null);
eq('rowsOfDay: regular not a list', L.rowsOfDay({ ok: true, games: { regular: {} } }), null);
eq('rowsOfDay: not an object', L.rowsOfDay(null), null);
eq('rowsOfDay: an empty day is empty, not unread', L.rowsOfDay({ ok: true, games: { regular: [] } }), []);

// ---- label statistics
const ls = L.labelStats(new Map([
  ['d1', [{ id: 'a', sport: 'MLS', bsd_event_id: '1', espn_event_id: null }, { id: 'b', sport: 'MLS', bsd_event_id: '2', espn_event_id: '9' },
    { id: 'c', sport: 'EPL', bsd_event_id: null, espn_event_id: '7' }, { id: 'a', sport: 'MLS', bsd_event_id: '1', espn_event_id: null }]],
  ['d2', null],
  ['d3', [{ sport: 'UEFA Champions League', espn_event_id: '5' }, { id: 'x', sport: 'EFL Championship' }, { id: 'y', sport: '__proto__' }]],
]));
eq('labelStats: days, unread days, rows, rows without an id, duplicates', [ls.days, ls.unreadDays, ls.rows, ls.noIdRows, ls.duplicateRows], [3, 1, 6, 1, 1]);
eq('labelStats: MLS has two rows, two bsd ids, one espn id, one with both', ls.byLabel.MLS, { rows: 2, withBsd: 2, withEspn: 1, withBoth: 1 });
eq('labelStats: EPL', ls.byLabel.EPL, { rows: 1, withBsd: 0, withEspn: 1, withBoth: 0 });
eq('labelStats: a label that is not safe is pooled, and the prototype is not touched', [ls.byLabel['(other)'], Object.getPrototypeOf(ls.byLabel)], [{ rows: 1, withBsd: 0, withEspn: 0, withBoth: 0 }, null]);
eq('labelStats: the target labels are all present, zero when absent', ls.targetLabelRows, {
  'EFL Championship': 1, 'UEFA Champions League': 1, 'UEFA Europa League': 0, 'UEFA Europa Conference League': 0,
  'UEFA Champions League Qualifying': 0, 'UEFA Europa League Qualifying': 0, 'UEFA Europa Conference League Qualifying': 0 });

// ---- where each graded match lands
const R1 = { id: 'r1', sport: 'EPL', bsd_event_id: '100', espn_event_id: '900' };
const dayRows = new Map([
  ['2026-09-11', []], ['2026-09-12', []], ['2026-10-23', []],
  ['2026-10-24', [R1]],                                       // the same row twice, on two days: it is one row
  ['2026-10-25', [R1, { id: 'r2', sport: 'MLS', bsd_event_id: 200, espn_event_id: null },
    { id: 'r3a', sport: 'La Liga', bsd_event_id: '300' }, { id: 'r3b', sport: 'La Liga', bsd_event_id: '300' }]],
  ['2026-10-26', []], ['2026-10-31', []], ['2026-11-01', null],
]);
const matches = [
  { key: '100', slug: 'epl', callDays: ['2026-10-25'] },                       // one row, with an espn id
  { key: '200', slug: 'mls', callDays: ['2026-10-25'] },                       // one row (a NUMBER bsd id matches), no espn id
  { key: '300', slug: 'laliga', callDays: ['2026-10-25'] },                    // two rows
  { key: '400', slug: 'eflchamp', callDays: ['2026-10-25'] },                  // zero: eflchamp
  { key: '500', slug: 'ucl', callDays: ['2026-10-25'] },                       // zero: ucl or europa
  { key: '600', slug: 'europa', callDays: ['2026-09-12'] },                    // zero: europa, and early does not apply first
  { key: '700', slug: 'seriea', callDays: ['2026-09-12'] },                    // zero: early
  { key: '800', slug: 'seriea', callDays: ['2026-10-25'] },                    // zero: other
  { key: '900', slug: 'ligue1', callDays: ['2026-11-01'] },                    // a needed day was not read
  { key: '1000', slug: 'epl', callDays: [] },                                  // no day
  { key: '1100', slug: '__proto__', callDays: ['2026-10-25'] },                // zero: other, slug pooled
  { key: '1300', slug: 'epl', callDays: ['2026-10-24'] },                      // the boundary day itself is not early
  { key: '1400', slug: 'epl', callDays: ['2026-10-24', '2026-09-12'] },        // the EARLIEST call day decides: early
];
const r = L.reachOf({ matches, dayRows });
eq('reachOf: totals', [r.matches, r.noDay, r.unread, r.zero, r.one, r.many], [13, 1, 1, 8, 2, 1]);
eq('reachOf: one-row matches by whether the row has an espn id', r.oneRow, { withEspnId: 1, withoutEspnId: 1 });
eq('reachOf: every zero has one named reason', r.zeroReasons, { [L.REASONS.eflchamp]: 1, [L.REASONS.uefa]: 2, [L.REASONS.early]: 2, [L.REASONS.other]: 3 });
eq('reachOf: by slug', r.bySlug, {
  epl: { matches: 4, noDay: 1, unread: 0, zero: 2, one: 1, many: 0 }, mls: { matches: 1, noDay: 0, unread: 0, zero: 0, one: 1, many: 0 },
  laliga: { matches: 1, noDay: 0, unread: 0, zero: 0, one: 0, many: 1 }, eflchamp: { matches: 1, noDay: 0, unread: 0, zero: 1, one: 0, many: 0 },
  ucl: { matches: 1, noDay: 0, unread: 0, zero: 1, one: 0, many: 0 }, europa: { matches: 1, noDay: 0, unread: 0, zero: 1, one: 0, many: 0 },
  seriea: { matches: 2, noDay: 0, unread: 0, zero: 2, one: 0, many: 0 }, ligue1: { matches: 1, noDay: 0, unread: 1, zero: 0, one: 0, many: 0 },
  '(other)': { matches: 1, noDay: 0, unread: 0, zero: 1, one: 0, many: 0 } });
eq('reachOf: the distinct days the matches needed', r.daysNeeded, 7);
eq('reachOf: every match placed exactly once', r.partitions, true);
eq('reachOf: an unread day is never a zero', L.reachOf({ matches: [{ key: '1', slug: 'epl', callDays: ['2026-11-01'] }], dayRows }).zero, 0);
eq('reachOf: a day absent from the map is unread too', L.reachOf({ matches: [{ key: '1', slug: 'epl', callDays: ['2030-01-01'] }], dayRows }).unread, 1);
eq('reachOf: two one-row matches that both have an espn id are not read as having none (the 1/1 split above cannot tell the counts apart)',
  L.reachOf({ matches: [{ key: '100', slug: 'epl', callDays: ['2026-10-25'] }, { key: '100', slug: 'epl', callDays: ['2026-10-25'] }], dayRows }).oneRow, { withEspnId: 2, withoutEspnId: 0 });
eq('reachOf: no matches is an empty, consistent result', [L.reachOf({ matches: [], dayRows }).matches, L.reachOf({ matches: [], dayRows }).partitions], [0, true]);

// ---- what the rows say about the ESPN id: one distinct id (rows that agree are fine), none, or a conflict
const rowsE = (id, espn) => ({ id: `${id}-${espn}`, sport: 'MLS', bsd_event_id: id, espn_event_id: espn });
const dayE = new Map([['2026-10-24', []], ['2026-10-25', [
  rowsE('1', 'X'),                                      // mA: one row, an id
  rowsE('2', 'X'), { ...rowsE('2', 'X'), id: '2-X-b' }, // mB: two rows that agree
  rowsE('3', 'X'), rowsE('3', 'Y'),                     // mC: two rows that conflict
  rowsE('4', null),                                     // mD: one row, no id
  rowsE('5', null), { ...rowsE('5', null), id: '5-n-b' },   // mE: two rows, no id
  rowsE('6', null), rowsE('6', 'Z'),                    // mF: two rows, one with an id
]]]);
const mE = ['1', '2', '3', '4', '5', '6'].map((k) => ({ key: k, slug: 'mls', callDays: ['2026-10-25'] }));
const re = L.reachOf({ matches: mE, dayRows: dayE });
eq('reachOf: rows per match', [re.one, re.many, re.zero], [2, 4, 0]);
eq('reachOf: one distinct espn id (A, B, F), none (D, E), a conflict (C)', re.espnIds, { one: 3, none: 2, conflict: 1 });
eq('reachOf: the same by slug', re.espnBySlug, { mls: { one: 3, none: 2, conflict: 1 } });
eq('reachOf: the espn-id outcomes cover every match that has rows', re.partitions, true);
eq('reachOf: a match with no row has no espn-id outcome', L.reachOf({ matches: [{ key: '9', slug: 'mls', callDays: ['2026-10-25'] }], dayRows: dayE }).espnIds, { one: 0, none: 0, conflict: 0 });

// ---- ESPN's shape
const ev = (date, a, b, completed) => ({ date, competitions: [{ status: { type: { completed } }, competitors: [{ homeAway: 'home', score: a, team: { id: 11 } }, { homeAway: 'away', score: b, team: { id: '22' } }] }] });
const E1 = ev('2026-11-22T15:00Z', '2', '1', true);
eq('competitorsOf: ids become strings, scores numbers', L.competitorsOf(E1), [{ id: '11', homeAway: 'home', score: 2 }, { id: '22', homeAway: 'away', score: 1 }]);
eq('finalTotalOf: the two scores added', L.finalTotalOf(E1), 3);
eq('finalTotalOf: a negative score is refused', L.finalTotalOf(ev('2026-11-22T15:00Z', '-1', '1', true)), null);
eq('finalTotalOf: a fractional score is refused', L.finalTotalOf(ev('2026-11-22T15:00Z', '1.5', '1', true)), null);
eq('finalTotalOf: a missing score is refused', L.finalTotalOf(ev('2026-11-22T15:00Z', undefined, '1', true)), null);
eq('isCompleted: only a true flag', [L.isCompleted(E1), L.isCompleted(ev('x', '1', '0', false)), L.isCompleted({})], [true, false, false]);
eq('pickRecentFinished: the latest COMPLETED event with a score', L.pickRecentFinished([ev('2026-11-20T15:00Z', '0', '0', true), E1, ev('2026-11-23T15:00Z', '1', '1', false), ev('2026-11-23T12:00Z', undefined, undefined, true)]), E1);
eq('pickRecentFinished: none', L.pickRecentFinished([ev('2026-11-23T15:00Z', '1', '1', false)]), null);

const inv = L.inventory([{ type: { type: 'goal' }, team: { id: '1' }, clock: { displayValue: "12'" } }, { type: { type: 'yellow-card' }, team: { id: '2' } }, { 'bad key': 1, ok: true }]);
eq('inventory: paths with their row counts', Object.fromEntries(Object.entries(inv.paths).map(([k, v]) => [k, v.rows])), { type: 2, 'type.type': 2, team: 2, 'team.id': 2, clock: 1, 'clock.displayValue': 1, ok: 1 });
eq('inventory: value types are recorded', inv.paths.ok.types, { boolean: 1 });
eq('inventory: a key that is not a safe name is counted, not listed', [inv.unsafeKeys, inv.truncated, inv.rows], [1, false, 3]);
eq('inventory: depth is capped at three levels', Object.keys(L.inventory([{ a: { b: { c: { d: 1 } } } }]).paths), ['a', 'a.b', 'a.b.c']);
const capped = L.inventory([{ a: 1, b: 1, c: 1 }], { maxPaths: 2 });
eq('inventory: a path cap says so', [Object.keys(capped.paths).length, capped.truncated], [2, true]);

eq('isGoalRow', [L.isGoalRow({ type: { type: 'own-goal' } }), L.isGoalRow({ type: { type: 'card' } }), L.isGoalRow({ scoringPlay: true }), L.isGoalRow({ scoringPlay: false, type: { type: 'x' } }), L.isGoalRow(null)], [true, false, true, false, false]);
const rows = [
  { type: { type: 'goal' }, team: { id: '11' }, clock: { displayValue: "10'" }, ownGoal: false, penaltyKick: false, scoringPlay: true },
  { type: { type: 'goal---header' }, team: { id: '99' }, clock: "20'", ownGoal: true },
  { scoringPlay: true, type: { type: 'penalty---scored' }, team: { id: 22 }, penaltyKick: true, clock: {} },
  { type: { type: 'yellow-card' }, team: { id: '11' } },
  null,
];
const gs = L.goalShape(rows, { competitorIds: ['11', '22'], finalTotal: 3 });
eq('goalShape: counts', [gs.rows, gs.goalRows, gs.withTeamId, gs.teamIdIsACompetitor, gs.withClock, gs.ownGoalKey, gs.ownGoalTrue, gs.penaltyKickKey, gs.scoringPlayTrue], [5, 3, 3, 2, 2, 2, 1, 2, 2]);
eq('goalShape: three goal rows against a final total of three', gs.goalRowsEqualFinalTotal, true);
eq('goalShape: the type vocabulary, safe names only', gs.typeVocabulary, { goal: 1, 'goal---header': 1, 'penalty---scored': 1, 'yellow-card': 1 });
eq('goalShape: no readable final total is never "equal"', L.goalShape(rows, { competitorIds: ['11'], finalTotal: null }).goalRowsEqualFinalTotal, false);
eq('goalShape: a different count is not equal', L.goalShape(rows, { competitorIds: ['11'], finalTotal: 4 }).goalRowsEqualFinalTotal, false);

// ---- the registry, read from text
const reg = L.registryFromSource("'ucl':        { sport: 'soccer', espnLeague: 'uefa.champions',   bsdLeagueId: 7 },\n'eflchamp':   { sport: 'soccer', espnLeague: 'eng.2', bsdLeagueId: 12 },\n'nfl': { sport: 'football', espnLeague: 'nfl' },\n'ucl': { sport: 'soccer', espnLeague: 'dup.x' }");
eq('registryFromSource: soccer entries, first wins, others ignored', reg, { ucl: 'uefa.champions', eflchamp: 'eng.2' });

console.log(bad === 0 ? `ok ${n} assertions` : `${bad} of ${n} assertions FAILED`);
process.exit(bad === 0 ? 0 : 1);
