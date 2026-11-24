#!/usr/bin/env node
// Check for scripts/bsd-backfill-lib.mjs. Every expected value is derived by hand from the rule. mutate-bsd-backfill-lib.mjs proves each can fail.
import * as L from './bsd-backfill-lib.mjs';

let n = 0, bad = 0;
const norm = (v) => JSON.parse(JSON.stringify(v === undefined ? null : v));
function eq(name, actual, expected) {
  n++;
  const a = JSON.stringify(norm(actual)), e = JSON.stringify(norm(expected));
  if (a !== e) { bad++; console.log(`FAIL ${name}\n  expected ${e}\n  actual   ${a}`); }
}

// ---- days
eq('daysBetween: inclusive at both ends', L.daysBetween('2026-10-01', '2026-10-03'), ['2026-10-01', '2026-10-02', '2026-10-03']);
eq('daysBetween: one day is one day', L.daysBetween('2026-10-01', '2026-10-01'), ['2026-10-01']);
eq('daysBetween: crosses a month', L.daysBetween('2026-02-27', '2026-03-02'), ['2026-02-27', '2026-02-28', '2026-03-01', '2026-03-02']);
eq('daysBetween: a backwards range is refused', L.daysBetween('2026-10-03', '2026-10-01'), null);
eq('daysBetween: an impossible day is refused', L.daysBetween('2026-02-30', '2026-03-02'), null);
eq('daysBetween: a range over the limit is refused', L.daysBetween('2026-01-01', '2026-12-31', 10), null);
eq('daysBetween: a range exactly at the limit is allowed', L.daysBetween('2026-10-01', '2026-10-03', 3).length, 3);
eq('daysBetween: non-strings are refused', [L.daysBetween(20261001, '2026-10-03'), L.daysBetween('2026-10-01', null)], [null, null]);

// ---- the rows of a read
const A = { id: 'a' }, B = { id: 'b' };
eq('rowsOfDay: regular and postseason', L.rowsOfDay({ ok: true, games: { regular: [A], postseason: [B] } }), [A, B]);
eq('rowsOfDay: regular only', L.rowsOfDay({ ok: true, games: { regular: [A] } }), [A]);
eq('rowsOfDay: an empty day is empty, not unread', L.rowsOfDay({ ok: true, games: { regular: [] } }), []);
eq('rowsOfDay: not the contract is unread', [L.rowsOfDay({ ok: false, games: { regular: [] } }), L.rowsOfDay({ ok: true }), L.rowsOfDay({ ok: true, games: { regular: {} } }), L.rowsOfDay({ ok: true, games: { regular: [], postseason: {} } }), L.rowsOfDay(null)], [null, null, null, null, null]);

// ---- what is pending
const sports = ['MLS', 'EPL'];
const p = L.pendingOf([{ sport: 'MLS', bsd_event_id: null }, { sport: 'MLS', bsd_event_id: '5' }, { sport: 'EPL' }, { sport: 'EPL', bsd_event_id: '' },
  { sport: 'NBA', bsd_event_id: null }, { sport: 'MLS', bsd_event_id: 0 }, null, { sport: 7, bsd_event_id: null }], sports);
eq('pendingOf: soccer rows, pending rows, by sport (a null, an absent and an empty id are pending; a 0 is an id; NBA and junk are not soccer)', [p.soccer, p.pending, p.bySport], [5, 3, { MLS: 1, EPL: 2 }]);
eq('pendingOf: no rows', L.pendingOf([], sports), { soccer: 0, pending: 0, bySport: {} });

// ---- which dates
const survey = new Map([['2026-08-03', { pending: 2 }], ['2026-08-01', { pending: 5 }], ['2026-08-02', { pending: 0 }], ['2026-08-04', null], ['2026-08-05', { pending: 1 }]]);
const plan = L.planDates({ survey, maxDates: 2 });
eq('planDates: the oldest days with work, a clean day and an unread day skipped', plan.chosen, ['2026-08-01', '2026-08-03']);
eq('planDates: the counts', [plan.pendingDays, plan.remainingAfter, plan.unread, plan.readDays, plan.pendingRows, plan.complete], [3, 1, ['2026-08-04'], 4, 8, false]);
eq('planDates: a limit of zero chooses nothing and leaves everything', [L.planDates({ survey, maxDates: 0 }).chosen, L.planDates({ survey, maxDates: 0 }).remainingAfter], [[], 3]);
eq('planDates: all clean and all read is complete', L.planDates({ survey: new Map([['a', { pending: 0 }], ['b', { pending: 0 }]]), maxDates: 5 }).complete, true);
eq('planDates: work still pending, every day read, is not complete', L.planDates({ survey: new Map([['a', { pending: 2 }], ['b', { pending: 0 }]]), maxDates: 5 }).complete, false);
eq('planDates: an unread day means it is not complete even with no work seen', L.planDates({ survey: new Map([['a', { pending: 0 }], ['b', null]]), maxDates: 5 }).complete, false);
eq('planDates: nothing surveyed is not complete', L.planDates({ survey: new Map(), maxDates: 5 }).complete, false);

// ---- what an answer means
eq('outcomeOf: 401 and 403 are a refusal, whatever the body says', [L.outcomeOf({ status: 401, ok: true, pending: 0 }), L.outcomeOf({ status: 403 })], ['refused', 'refused']);
eq('outcomeOf: 429 is a throttle', L.outcomeOf({ status: 429, ok: false }), 'throttled');
eq('outcomeOf: ok false and a non-object are failed passes', [L.outcomeOf({ status: 502, ok: false, reason: 'x' }), L.outcomeOf(null)], ['failed', 'failed']);
eq('outcomeOf: nothing pending', L.outcomeOf({ status: 200, ok: true, pending: 0 }), 'nothing-pending');
eq('outcomeOf: a write is a join', L.outcomeOf({ status: 200, ok: true, pending: 5, written: 3, eventsRead: 60 }), 'joined');
eq('outcomeOf: pending, no write, no events read is BSD having none; an absent count is not events', [L.outcomeOf({ status: 200, ok: true, pending: 5, written: 0, eventsRead: 0 }), L.outcomeOf({ status: 200, ok: true, pending: 5, written: 0 })], ['bsd-has-no-events', 'bsd-has-no-events']);
eq('outcomeOf: events read and none matched', L.outcomeOf({ status: 200, ok: true, pending: 5, written: 0, eventsRead: 60 }), 'none-matched');

// ---- did the rows change by what the route said
eq('verifyOf: pending fell by exactly what was written', L.verifyOf({ pendingBefore: 10, pendingAfter: 7, written: 3 }), { verified: true, expected: 7 });
eq('verifyOf: it fell by less', L.verifyOf({ pendingBefore: 10, pendingAfter: 8, written: 3 }).verified, false);
eq('verifyOf: it fell by more', L.verifyOf({ pendingBefore: 10, pendingAfter: 6, written: 3 }).verified, false);
eq('verifyOf: nothing written, nothing changed', L.verifyOf({ pendingBefore: 10, pendingAfter: 10, written: 0 }).verified, true);
eq('verifyOf: everything written', L.verifyOf({ pendingBefore: 5, pendingAfter: 0, written: 5 }).verified, true);
eq('verifyOf: a count that is not a whole number, or negative, is not verified', [L.verifyOf({ pendingBefore: '10', pendingAfter: 7, written: 3 }).verified, L.verifyOf({ pendingBefore: 3, pendingAfter: -1, written: 4 }).verified, L.verifyOf({ pendingBefore: 3, pendingAfter: 0.5, written: 2.5 }).verified], [false, false, false]);

// ---- when to stop
const st = (o, v = true, pagesUsed = 5, pageCap = 30) => L.stopAfter({ outcomes: o, verified: v, pagesUsed, pageCap });
eq('stopAfter: a refusal stops at once', st(['joined', 'refused']), 'the route refused the secret');
eq('stopAfter: a throttle stops at once', st(['throttled']), 'the route answered 429');
eq('stopAfter: a mismatch stops', st(['joined'], false), 'what the route said it wrote is not what /context/date shows');
eq('stopAfter: one failed pass does not stop', st(['failed']), null);
eq('stopAfter: two failed passes in a row stop', st(['joined', 'failed', 'failed']), 'two failed passes in a row');
eq('stopAfter: failed, joined, failed does not stop', st(['failed', 'joined', 'failed']), null);
eq('stopAfter: the page cap is reached at the cap, not after it', [st(['joined'], true, 30, 30), st(['joined'], true, 29, 30)], ['upstream pages used 30 reached the cap 30', null]);
eq('stopAfter: a refusal outranks the cap', st(['refused'], true, 99, 30), 'the route refused the secret');
eq('stopAfter: an unverified pass (null) is not a mismatch', st(['nothing-pending'], null), null);

console.log(bad === 0 ? `ok ${n} assertions` : `${bad} of ${n} assertions FAILED`);
process.exit(bad === 0 ? 0 : 1);
