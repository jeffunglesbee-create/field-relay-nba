#!/usr/bin/env node
// Rule 90 / Rule 91 for scripts/bsd-next-goal-census.mjs, the analysis half.
//
// The census turns two sources (the vendor's ledger and the relay's R2 captures) into counts a person will use to decide
// whether to build a grading proof: how many calls are gradeable against FIELD's own goal timelines. A wrong count is a
// wrong decision, and the real sources are not under our control, so this runs the pure functions on a small SYNTHETIC world
// in which every branch occurs once, and asserts each count, each reason and each denominator. The reasons a call is NOT
// gradeable are asserted one by one, because "gradeable of N" with the wrong N would still look plausible.
// scripts/mutate-bsd-next-goal-census.mjs then breaks the census and requires this (or the run check) to go red.
//
// WHAT THIS DOES NOT COVER: the network layer of main() (scripts/check-bsd-next-goal-census-run.mjs), and the real shape of
// either source beyond the keys the committed real examples show. The fixtures are not vendor data.
//
// SAMPLE-COVERAGE-A (Rule 91): scenarios and assertions run are printed; fewer than the minimum cannot pass, and an early
// process.exit cannot pass.
//
// Usage: node scripts/check-bsd-next-goal-census.mjs [--source <census.mjs>]
//        node scripts/check-bsd-next-goal-census.mjs --self-test

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

export const MIN_SCENARIOS = 10;
export const MIN_ASSERTIONS = 96;

const argv = process.argv.slice(2);
const srcIdx = argv.indexOf('--source');
const SOURCE = srcIdx >= 0 ? argv[srcIdx + 1] : 'scripts/bsd-next-goal-census.mjs';

let scenarios = 0, assertions = 0, failed = 0;
let finished = false;
process.on('exit', (code) => {
  if (!finished) { console.log(`FAIL  the check did not run to its end (exit ${code}, ${scenarios} scenarios, ${assertions} assertions)`); process.exitCode = 1; }
});
const stable = (v) => JSON.stringify(v, (k, val) => (val && typeof val === 'object' && !Array.isArray(val)
  ? Object.fromEntries(Object.entries(val).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) : val));
const eq = (label, got, want) => {
  assertions++;
  if (stable(got) !== stable(want)) { failed++; console.log(`FAIL  ${label}\n        got  ${stable(got)}\n        want ${stable(want)}`); }
};
const scenario = async (name, fn) => { scenarios++; try { await fn(); } catch (e) { failed++; console.log(`FAIL  ${name} threw: ${e.message}`); } };

const { analyseCensus, parseKey, listAll, captureOf, covers, goalDistance, WITNESS_TOLERANCE, dedupeLedger } = await import(pathToFileURL(path.resolve(SOURCE)).href);
const { call, goal, ftRow, liveRow, htRow, ftCapture, liveCapture, htCapture, key, listPage, page, worldKeys, worldCalls, worldReads } =
  await import(pathToFileURL(path.resolve('scripts/fixtures/bsd-next-goal-census-synthetic.mjs')).href);

const ledgerOf = (rows, o = {}) => ({ rows, duplicates: 3, noId: 0, pages: 1, reportedFirst: rows.length, reportedLast: rows.length + 1, complete: true, why: null, ...o });
const r2Of = (keys, o = {}) => ({ keys, pages: 1, complete: true, why: null, ...o });
const CTX = { trackedLeagueIds: [1, 2], capped: true, callsMade: 11, callBudget: 16 };
const world = (over = {}) => ({ ledger: ledgerOf(worldCalls()), r2: r2Of(worldKeys()), reads: worldReads(), ctx: CTX, ...over });
const A = (w) => analyseCensus(w);
// a fake relay `get` that answers from a script of pages
const pager = (pages, over = {}) => { let i = 0; const asked = []; const get = async (p) => { asked.push(p); const r = pages[i++]; return r === undefined ? { status: 500 } : r.status !== undefined ? r : { status: 200, json: r, ...over }; }; get.asked = asked; return get; };

const SOURCE_TEXT = fs.readFileSync(SOURCE, 'utf8');
async function run() {
  await scenario('1 the whole world: every count and every reason', () => {
    const a = A(world());
    eq('ledger block', [a.ledger.verdict, a.ledger.uniqueCalls, a.ledger.duplicates, a.ledger.rowsWithoutId, a.ledger.pages, a.ledger.reportedFirst, a.ledger.reportedLast, a.ledger.drift, a.ledger.distinctEvents], ['COMPLETE', 16, 3, 0, 1, 16, 17, 1, 9]);
    eq('outcomes, months, missing fields', [a.ledger.outcomes, a.ledger.byMonth, a.ledger.rowsWithoutEventId, a.ledger.rowsWithoutResolvedMinute], [{ hit: 11, miss: 3, open: 1, nogoal: 1 }, { '2026-10': 1, '2026-11': 15 }, 1, 3]);
    eq('oldest and newest call', [a.ledger.oldestCalledAt, a.ledger.newestCalledAt], ['2026-10-20T15:30:00Z', '2026-11-01T15:30:00Z']);
    eq('r2 block', [a.r2.verdict, a.r2.keys, a.r2.pages, a.r2.keysNotMatchingTheLayout, a.r2.events, a.r2.eventsWithIncidents, a.r2.idsUnderMoreThanOneSlug], ['COMPLETE', 13, 1, 2, 9, 8, 0]);
    eq('r2 files and slugs', [a.r2.files, a.r2.eventsPerSlug], [{ 'incidents.json': 8, 'stats.json': 3 }, { epl: 6, mls: 1, other: 1 }]);
    eq('reads: 7 attempted, 4 parsed, one 404, one 500, one unreadable, none blocked, capped', [a.reads.attempted, a.reads.parsed, a.reads.notFound404, a.reads.failedOrBlocked, a.reads.blockedByDeadline, a.reads.parseFailures, a.reads.capped], [7, 4, 1, 1, 0, 1, true]);
    eq('captures: 4 readable, 2 full time, states, the live row minute tallied, vocabulary, goal count against the final score', [a.captures.ofLedgerEvents, a.captures.fullTime, a.captures.state, a.captures.liveRowMinute, a.captures.periodTexts, a.captures.goalCountMatchesFinal], [4, 2, { 'full-time': 2, 'in-play': 1, unmarked: 1 }, { 70: 1 }, { 'FT/false': 2, 'Second half/true': 1, 'HT/false': 2 }, { yes: 1, no: 1 }]);
    eq('calls: verdict and the funnel', [a.calls.verdict, a.calls.uniqueCalls, a.calls.inTrackedLeague, a.calls.distinctEventsInTrackedLeague, a.calls.withIncidentsKey, a.calls.withReadableCapture, a.calls.withFullTimeCapture, a.calls.coveredByCapture, a.calls.gradeable, a.calls.distinctEventsGradeable], ['PARTIAL', 16, 15, 8, 14, 10, 5, 7, 5, 4]);
    eq('PARTIAL because the read cap was reached, and only that', a.calls.partialBecause, ['the read cap was reached']);
    eq('tracked league without a key, and a key outside the tracked leagues', [a.calls.trackedLeagueWithoutIncidentsKey, a.calls.distinctTrackedEventsWithoutKey, a.calls.withIncidentsKeyOutsideTrackedLeagues], [2, 1, 1]);
    eq('gradeable by how the capture covers it: three at full time, two by a goal within a minute', a.calls.gradeableBy, { 'full time': 3, 'a goal within 1 minute': 2 });
    eq('the nearest goal to resolved_minute, by capture state (full time 0, 3+, 1; in play 0, 3+; half-time row 2, 1)', a.calls.goalDistanceByCaptureState, { 'full-time': { 0: 1, '3+': 1, 1: 1 }, 'in-play': { 0: 1, '3+': 1 }, unmarked: { 2: 1, 1: 1 } });
    eq('what a tolerance of 0, 1 and 2 minutes would have graded: 4, 5, 6', a.calls.gradeableIfToleranceWere, { 0: 4, 1: 5, 2: 6 });
    eq('gradeable by outcome, slug and month', [a.calls.gradeableByOutcome, a.calls.gradeableBySlug, a.calls.gradeableByMonth], [{ hit: 4, miss: 1 }, { epl: 3, mls: 1, other: 1 }, { '2026-11': 4, '2026-10': 1 }]);
    eq('every reason a call is not gradeable, with its count', a.calls.notGradeableBecause, {
      'the capture did not see full time and holds no goal within 1 minute of the resolution': 2,
      'incidents.json read failed (status 404)': 1,
      'incidents.json read failed (status 500)': 1,
      'incidents.json unreadable: no incidents array': 1,
      'no incidents.json in R2 for the event': 1,
      'incidents.json not read (cap or deadline)': 1,
      'outcome is open': 1,
      'outcome is nogoal': 1,
      'no resolved_minute': 1,
      'the call has no event id': 1,
    });
    eq('the reasons and the gradeable calls add up to every call', Object.values(a.calls.notGradeableBecause).reduce((x, y) => x + y, 0) + a.calls.gradeable, 16);
    eq('the coverage line carries every denominator', a.coverageLine, 'ledger: 16 unique calls (COMPLETE, reported 16 then 17, 1 pages, 3 duplicates) | R2: 13 keys, 8 events with incidents.json (COMPLETE) | reads: 4 parsed of 7 attempted (CAPPED) | calls: 5 gradeable of 16 (15 in a tracked league, 14 with an incidents.json, 5 with a full-time capture) | BSD calls 11/16');
    eq('the note says what gradeable is and what it does not claim', [a.calls.note.startsWith('gradeable = outcome hit or miss, a resolved_minute,'), /says nothing about whether the vendor was right/.test(a.calls.note)], [true, true]);
  });

  await scenario('2 a partial source is PARTIAL and says why; a missing one is UNKNOWN, never zero', () => {
    const lp = A(world({ ledger: ledgerOf(worldCalls(), { complete: false, why: '12 unique rows of 20 reported' }) }));
    eq('ledger partial: its verdict, its reason, and the calls verdict', [lp.ledger.verdict, lp.ledger.why, lp.calls.verdict, lp.calls.partialBecause.includes('the ledger is partial')], ['PARTIAL', '12 unique rows of 20 reported', 'PARTIAL', true]);
    const rp = A(world({ r2: r2Of(worldKeys(), { complete: false, why: 'list page 2 answered 500' }) }));
    eq('r2 partial: its verdict, its reason, the calls verdict, and the line says so', [rp.r2.verdict, rp.r2.why, rp.calls.verdict, /\(PARTIAL\)/.test(rp.coverageLine)], ['PARTIAL', 'list page 2 answered 500', 'PARTIAL', true]);
    const none = A(world({ ledger: { why: 'the ledger answered 403' } }));
    eq('ledger missing: UNKNOWN with the reason, calls UNKNOWN, the other sources still read', [none.ledger, none.calls, none.r2.verdict], [{ verdict: 'UNKNOWN', why: 'the ledger answered 403' }, { verdict: 'UNKNOWN', why: 'the ledger answered 403' }, 'COMPLETE']);
    eq('ledger missing: the line says not read and gives no gradeable count', [/^ledger: not read unique calls \(UNKNOWN, \? pages, \? duplicates\)/.test(none.coverageLine), /calls: n\/a gradeable of n\/a/.test(none.coverageLine)], [true, true]);
    const nr2 = A(world({ r2: { keys: null, why: 'the relay answered nothing' } }));
    eq('r2 missing: UNKNOWN with the reason, and every call is "no incidents.json"', [nr2.r2, nr2.calls.gradeable, nr2.calls.notGradeableBecause['no incidents.json in R2 for the event']], [{ verdict: 'UNKNOWN', why: 'the relay answered nothing' }, 0, 12]);
    eq('r2 missing: the line says not read', /R2: not read/.test(nr2.coverageLine), true);
    const empty = A(world({ ledger: ledgerOf([]), reads: new Map() }));
    eq('an empty ledger is COMPLETE with 0 calls, not a failure', [empty.ledger.verdict, empty.calls.uniqueCalls, empty.calls.gradeable, empty.ledger.oldestCalledAt], ['COMPLETE', 0, 0, null]);
    const untracked = A(world({ ctx: { ...CTX, trackedLeagueIds: undefined } }));
    eq('no tracked-league list: the tracked counts are null, not 0', [untracked.calls.inTrackedLeague, untracked.calls.trackedLeagueWithoutIncidentsKey, untracked.calls.withIncidentsKeyOutsideTrackedLeagues, untracked.calls.gradeable], [null, null, null, 5]);
    eq('...and the line leaves the tracked clause out', /calls: 5 gradeable of 16 \| BSD/.test(untracked.coverageLine), true);
    const notCapped = A(world({ ctx: { ...CTX, capped: false } }));
    eq('a run that was not capped is not marked capped, and is ANSWERED with nothing left out', [notCapped.reads.capped, /CAPPED/.test(notCapped.coverageLine), notCapped.calls.verdict, notCapped.calls.partialBecause], [false, false, 'ANSWERED', []]);
    const blockedRun = A(world({ ctx: { ...CTX, capped: false }, reads: new Map([['101', { status: null, blocked: 'run deadline 420 s passed' }]]) }));
    eq('a read blocked by the deadline makes the census PARTIAL and says so', [blockedRun.reads.blockedByDeadline, blockedRun.calls.verdict, blockedRun.calls.partialBecause], [1, 'PARTIAL', ['reads were blocked by the run deadline']]);
    const both = A(world({ ledger: ledgerOf(worldCalls(), { complete: false, why: 'x' }), r2: r2Of(worldKeys(), { complete: false, why: 'y' }), ctx: { ...CTX, capped: false } }));
    eq('every reason a census is partial is listed', both.calls.partialBecause, ['the ledger is partial', 'the R2 listing is partial']);
    eq('the BSD call count and budget are in the line when absent from ctx', /BSD calls \?\/\?/.test(A(world({ ctx: { trackedLeagueIds: [1, 2] } })).coverageLine), true);
  });

  await scenario('3 covers: full time, the resolving goal, the tolerance, no clock', () => {
    const live = captureOf(liveCapture(70, [goal(20), goal(60, false)]));   // goals at 20 and 60; the live row says 70
    eq('the tolerance is one minute', WITNESS_TOLERANCE, 1);
    eq('a goal at the resolved minute covers it', covers({ resolved_minute: 60 }, live), true);
    eq('one minute away covers it, either side', [covers({ resolved_minute: 61 }, live), covers({ resolved_minute: 59 }, live)], [true, true]);
    eq('two minutes away does not, either side', [covers({ resolved_minute: 62 }, live), covers({ resolved_minute: 58 }, live)], [false, false]);
    eq('the live row is not a clock: its minute covers nothing, before it or after', [covers({ resolved_minute: 70 }, live), covers({ resolved_minute: 40 }, live), covers({ resolved_minute: 30 }, live)], [false, false, false]);
    eq('a wider or a zero tolerance is a parameter and moves the line exactly', [covers({ resolved_minute: 62 }, live, 2), covers({ resolved_minute: 63 }, live, 2), covers({ resolved_minute: 60 }, live, 0), covers({ resolved_minute: 61 }, live, 0)], [true, false, true, false]);
    const ft = captureOf(ftCapture([goal(20)], 1, 0));
    eq('full time covers any call, even one with no resolved minute or no goal near it', [covers({ resolved_minute: 95 }, ft), covers({ resolved_minute: null }, ft), covers({}, ft)], [true, true, true]);
    eq('an in-play capture does not cover a call with no resolved minute', covers({ resolved_minute: null }, live), false);
    const noGoal = captureOf({ incidents: [{ type: 'substitution', minute: 60 }] });
    eq('a capture with no goal covers nothing in play', [noGoal.state, noGoal.goalMinutes, covers({ resolved_minute: 60 }, noGoal)], ['unmarked', [], false]);
    eq('a failed capture covers nothing', [covers({ resolved_minute: 1 }, { ok: false }), covers({ resolved_minute: 1 }, null), covers({ resolved_minute: 1 }, undefined)], [false, false, false]);
    eq('a string resolved_minute is not a minute', covers({ resolved_minute: '60' }, live), false);
    eq('a capture that failed to parse covers nothing even if it says full time', covers({ resolved_minute: 1 }, { ok: false, fullTime: true, goalMinutes: [1] }), false);
    eq('a resolved minute of 0 is covered only by a goal near 0', [covers({ resolved_minute: 0 }, noGoal), covers({ resolved_minute: 0 }, captureOf({ incidents: [goal(1)] })), covers({ resolved_minute: 0 }, captureOf({ incidents: [goal(2)] }))], [false, true, false]);
    eq('goalDistance: the nearest goal; null with no capture, no goal or no resolved minute', [goalDistance({ resolved_minute: 50 }, live), goalDistance({ resolved_minute: 50 }, null), goalDistance({ resolved_minute: 50 }, noGoal), goalDistance({}, live), goalDistance({ resolved_minute: 0 }, live), goalDistance({ resolved_minute: 50 }, { ok: false, goalMinutes: [50] })], [10, null, null, null, 20, null]);
  });

  await scenario('4 captureOf: full time, extra time, in play, half-time only, garbage', () => {
    const ft = captureOf(ftCapture([goal(20), goal(60, false)], 1, 1));
    eq('a finished capture', [ft.ok, ft.fullTime, ft.state, ft.liveRowMinute, ft.goalMinutes, ft.goals, ft.finalScore, ft.goalCountMatchesFinal], [true, true, 'full-time', null, [20, 60], 2, { home: 1, away: 1 }, true]);
    eq('the score and the goal count disagree: recorded as no', captureOf(ftCapture([goal(20)], 2, 0)).goalCountMatchesFinal, false);
    eq('a final score that is not numbers: unknown', captureOf({ incidents: [{ type: 'period', text: 'FT', minute: 90, is_live: false }, goal(10)] }).goalCountMatchesFinal, null);
    eq('AET is full time', captureOf(ftCapture([], 0, 0, 'AET')).fullTime, true);
    eq('a penalty-shootout marker is full time', captureOf(ftCapture([], 0, 0, 'PEN')).fullTime, true);
    eq('AP is full time', captureOf(ftCapture([], 0, 0, 'AP')).fullTime, true);
    eq('FT with is_live true is not full time', captureOf({ incidents: [{ type: 'period', text: 'FT', minute: 90, is_live: true }] }).fullTime, false);
    eq('FT with no is_live is not full time', captureOf({ incidents: [{ type: 'period', text: 'FT', minute: 90 }] }).fullTime, false);
    const live = captureOf(liveCapture(70, [goal(20), goal(60, false)]));
    eq('a live row makes the capture in play; its minute is recorded, never used as a clock', [live.fullTime, live.state, live.liveRowMinute, live.goalMinutes], [false, 'in-play', 70, [20, 60]]);
    const liveLate = captureOf({ incidents: [liveRow(80), goal(60)] });
    eq('a live row minute later than every goal changes nothing about the goals held', [liveLate.state, liveLate.liveRowMinute, liveLate.goalMinutes], ['in-play', 80, [60]]);
    const liveEarly = captureOf({ incidents: [liveRow(50), goal(60)] });
    eq('...and a goal later than the live row minute is still a goal the capture holds', [liveEarly.liveRowMinute, liveEarly.goalMinutes, covers({ resolved_minute: 60 }, liveEarly)], [50, [60], true]);
    const ht = captureOf(htCapture([goal(40)]));
    eq('half-time only: unmarked, no live minute, its one goal held', [ht.state, ht.liveRowMinute, ht.goals, ht.goalMinutes], ['unmarked', null, 1, [40]]);
    const noMin = captureOf({ incidents: [{ type: 'period', text: 'Second half', is_live: true }, goal(33)] });
    eq('a live row with no minute is still in play, with no minute tallied', [noMin.state, noMin.liveRowMinute], ['in-play', null]);
    eq('goal minutes are sorted as numbers, not as text', captureOf({ incidents: [goal(100), goal(9), goal(20)] }).goalMinutes, [9, 20, 100]);
    eq('a period row with no is_live flag is neither full time nor in play', captureOf({ incidents: [{ type: 'period', text: 'Second half', minute: 60 }, goal(10)] }).state, 'unmarked');
    eq('full time wins when a capture carries both a full-time row and a live row', captureOf({ incidents: [liveRow(60), ftRow(1, 0)] }).state, 'full-time');
    eq('garbage', [captureOf({}), captureOf(null), captureOf('x'), captureOf({ incidents: 5 })], [{ ok: false, why: 'no incidents array' }, { ok: false, why: 'not an object' }, { ok: false, why: 'not an object' }, { ok: false, why: 'no incidents array' }]);
    eq('rows that are not objects are skipped, not fatal', captureOf({ incidents: [null, 5, 'x', goal(12)] }).goals, 1);
    eq('a goal with no minute is not counted', captureOf({ incidents: [{ type: 'goal', is_home: true }] }).goals, 0);
    eq('the period vocabulary is kept with its is_live flag', captureOf({ incidents: [ftRow(0, 0), htRow(), { type: 'period', is_live: true, minute: 5 }] }).periodTexts, ['FT/false', 'HT/false', '(none)/true']);
  });

  await scenario('5 parseKey', () => {
    eq('a capture key', parseKey('bsd/epl/101/incidents.json'), { slug: 'epl', id: '101', file: 'incidents.json' });
    eq('another file', parseKey('bsd/wc26/8346/stats.json'), { slug: 'wc26', id: '8346', file: 'stats.json' });
    eq('a slug with a slash is not a slug, and a key with no file name is no key', [parseKey('bsd/a/b/101/incidents.json'), parseKey('bsd/epl/101/')], [null, null]);
    eq('a key that does not fit the layout', [parseKey('bsd/meta.json'), parseKey('bsd/epl/abc/incidents.json'), parseKey('bsd/epl/101/deep/x.json'), parseKey('odds/epl/101/incidents.json'), parseKey(''), parseKey(null), parseKey(7)], [null, null, null, null, null, null, null]);
  });

  await scenario('6 listAll: the cursor, a dead end, another prefix, a failed page, a page cap', async () => {
    const ok = await listAll(pager([listPage([key('epl', 1)], { cursor: 'c1' }), listPage([key('epl', 2)])]));
    eq('two pages follow the cursor', [ok.keys.length, ok.pages, ok.complete, ok.why], [2, 2, true, null]);
    const g = pager([listPage([key('epl', 1)], { cursor: 'c1' }), listPage([key('epl', 2)])]);
    await listAll(g);
    eq('the second request carries the cursor and the first does not', [g.asked[0].includes('cursor='), g.asked[1].includes('cursor=c1'), g.asked[0].includes('limit=1000'), g.asked[0].includes('prefix=bsd%2F')], [false, true, true, true]);
    const dead = await listAll(pager([{ ...listPage([key('epl', 1)]), truncated: true, cursor: null }]));
    eq('a truncated page with no cursor is a dead end, incomplete, with the keys so far', [dead.complete, dead.keys.length, /no cursor/.test(dead.why)], [false, 1, true]);
    const other = await listAll(pager([listPage([key('epl', 1)], { prefix: 'bsd/wc26/' })]));
    eq('a page answered from another prefix stops the listing', [other.complete, other.keys.length, /prefix/.test(other.why)], [false, 0, true]);
    const bad = await listAll(pager([listPage([key('epl', 1)], { cursor: 'c1' }), { status: 500 }]));
    eq('a failed second page keeps the first and says which page failed', [bad.complete, bad.keys.length, bad.pages, /list page 2 answered 500/.test(bad.why)], [false, 1, 2, true]);
    const nothing = await listAll(async () => undefined);
    eq('no answer at all', [nothing.complete, nothing.keys.length, /nothing/.test(nothing.why)], [false, 0, true]);
    const errored = await listAll(async () => ({ error: 'timeout' }));
    eq('a request error is named', /timeout/.test(errored.why), true);
    const notKeys = await listAll(async () => ({ status: 200, json: { prefix: 'bsd/', keys: 'no' } }));
    eq('a 200 without a keys array is a failed page', [notKeys.complete, /answered 200/.test(notKeys.why)], [false, true]);
    const failedWithBody = await listAll(async () => ({ status: 500, json: listPage([key('epl', 1)]) }));
    eq('a 500 that carries a valid-looking body is still a failed page', [failedWithBody.complete, failedWithBody.keys.length], [false, 0]);
    let endlessCalls = 0;
    const endless = async () => { if (++endlessCalls > 50) throw new Error('the listing did not stop at its page cap'); return { status: 200, json: listPage([key('epl', 1)], { cursor: 'again' }) }; };
    const capped = await listAll(endless, 'bsd/', 3);
    eq('a page cap stops a listing that never ends', [capped.complete, capped.pages, /stopped at 3 pages/.test(capped.why)], [false, 3, true]);
  });

  await scenario('7 dedupeLedger: a ledger that grows while it is paged', () => {
    const d = dedupeLedger([[{ id: 5 }, { id: 4 }], [{ id: 4 }, { id: 3 }, { id: '3' }], [{ id: 2 }, {}, null, { id: null }]]);
    eq('unique by id in first-seen order; a string id equal to a number is the same id', d.rows.map((r) => (r ? r.id : r)), [5, 4, 3, 2, undefined, null, null]);
    eq('duplicates and rows without an id are counted', [d.duplicates, d.noId], [2, 3]);
    eq('no pages', dedupeLedger([]), { rows: [], duplicates: 0, noId: 0 });
    eq('rows are kept in the order read', dedupeLedger([[{ id: 1 }], [{ id: 2 }]]).rows.map((r) => r.id), [1, 2]);
  });

  await scenario('10 captures with no goal in them: the distance tally and the tolerance counts', () => {
    const w = world({
      ledger: ledgerOf([call({ id: 1, ev: 7, rm: 50 }), call({ id: 2, ev: 8, rm: 50 }), call({ id: 3, ev: 9, rm: 52 }), call({ id: 4, ev: 9, outcome: 'miss', rm: 100 }), call({ id: 5, ev: 9, rm: 53 }), call({ id: 6, ev: 9, outcome: 'open', rm: 50 })]),
      r2: r2Of([key('epl', 7), key('epl', 8), key('epl', 9)]),
      reads: new Map([['7', { status: 200, json: { event_id: 0, incidents: [{ type: 'period', text: 'Second half', is_live: true }] } }], ['8', { status: 200, json: ftCapture([], 0, 0) }], ['9', { status: 200, json: ftCapture([goal(50)], 1, 0) }]]),
      ctx: { trackedLeagueIds: [1], capped: false, callsMade: 11, callBudget: 16 },
    });
    const a = A(w);
    eq('nothing was left out, so the verdict is ANSWERED', [a.calls.verdict, a.calls.partialBecause], ['ANSWERED', []]);
    eq('no goal in the capture, a goal 2 away, 3 away and far away, by capture state; the open call is not tallied', a.calls.goalDistanceByCaptureState, { 'in-play': { 'no goal in the capture': 1 }, 'full-time': { 'no goal in the capture': 1, 2: 1, '3+': 2 } });
    eq('full time grades its four hit/miss calls at any tolerance; the in-play one never', a.calls.gradeableIfToleranceWere, { 0: 4, 1: 4, 2: 4 });
    eq('four gradeable, all by full time; the in-play capture with no goal and the open call are the two reasons', [a.calls.gradeable, a.calls.gradeableBy, a.calls.notGradeableBecause], [4, { 'full time': 4 }, { 'the capture did not see full time and holds no goal within 1 minute of the resolution': 1, 'outcome is open': 1 }]);
    eq('a live row with no minute is tallied as none', a.captures.liveRowMinute, { none: 1 });
  });

  await scenario('9 the source declares the defaults a live run depends on', () => {
    eq('the vendor host, the relay host and the main guard', [SOURCE_TEXT.includes("process.env.BSD_BASE || 'https://sports.bzzoiro.com'"), SOURCE_TEXT.includes("process.env.RELAY_URL || 'https://field-relay-nba.jeffunglesbee.workers.dev'"), SOURCE_TEXT.includes('if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {')], [true, true, true]);
  });

  await scenario('8 two ids under two slugs, the tracked-league list, and malformed input', () => {
    const keys = [key('epl', 7), key('mls', 7), key('epl', 8)];
    const a = A(world({ ledger: ledgerOf([call({ id: 1, ev: 7 }), call({ id: 2, ev: 8 })]), r2: r2Of(keys), reads: new Map([['7', { status: 200, json: ftCapture([goal(5)], 1, 0) }], ['8', { status: 200, json: ftCapture([], 0, 0) }]]) }));
    eq('an id under two slugs is counted, and its slugs are joined', [a.r2.idsUnderMoreThanOneSlug, a.r2.eventsPerSlug, a.calls.gradeableBySlug], [1, { 'epl+mls': 1, epl: 1 }, { 'epl+mls': 1, epl: 1 }]);
    const stringIds = A(world({ ledger: ledgerOf([{ ...call({ id: 1, ev: 8 }), event: { id: '8', league_id: '1' } }]), r2: r2Of(keys), reads: new Map([['8', { status: 200, json: ftCapture([], 0, 0) }]]) }));
    eq('a string event id and a string league id still join and count as tracked', [stringIds.calls.gradeable, stringIds.calls.inTrackedLeague], [1, 1]);
    const undated = A(world({ ledger: ledgerOf([{ ...call({ id: 1, ev: 101 }), called_at: null }, { ...call({ id: 2, ev: 101 }), outcome: undefined }]) }));
    eq('a call with no date is counted under (no date), and a call with no outcome is named as such', [undated.ledger.byMonth, undated.calls.notGradeableBecause], [{ '(no date)': 1, '2026-11': 1 }, { 'outcome is (absent)': 1 }]);
    const odd = [null, 5, 'x', { event: null }, { id: 1, event: { id: 7 } }, { event: { id: 7 }, resolved_minute: 'x', outcome: 'hit' }];
    let out, threw = null;
    try { out = A(world({ ledger: ledgerOf(odd), reads: new Map([['7', { status: 200, json: ftCapture([], 0, 0) }]]), r2: r2Of(keys) })); } catch (e) { threw = e.message; }
    eq('malformed ledger rows do not throw, and are counted', [threw, out && out.ledger.uniqueCalls, out && out.calls.gradeable], [null, 6, 0]);
    eq('the reasons still add up on malformed rows', Object.values(out.calls.notGradeableBecause).reduce((x, y) => x + y, 0) + out.calls.gradeable, 6);
    const odd2 = A(world({ reads: new Map([['101', { status: 200, json: undefined }], ['102', { status: 200, json: { incidents: [] } }]]) }));
    eq('a 200 with no body is not parsed; an empty incidents array parses, unmarked, and covers nothing in play', [odd2.reads.parsed, odd2.reads.failedOrBlocked, odd2.captures.state], [1, 1, { unmarked: 1 }]);
    const blocked = A(world({ reads: new Map([['101', { status: null, blocked: 'run deadline 420 s passed' }]]) }));
    eq('a read that never ran is counted as failed or blocked, and the reason names the missing status', [blocked.reads.failedOrBlocked, blocked.calls.notGradeableBecause['incidents.json read failed (status none)']], [1, 2]);
  });
}

// ---------------------------------------------------------------- self-test of the check itself
// A check that has only ever passed proves nothing (Rule 90). This one is proven able to fail by running ITSELF against a
// copy of the real census with one boundary broken, and requiring a red exit. The anchor must match exactly once.
function selfTest() {
  const ANCHOR = 'return d !== null && d <= tolerance;';
  const real = fs.readFileSync(SOURCE, 'utf8');
  const n = real.split(ANCHOR).length - 1;
  if (n !== 1) { console.log(`FAIL  self-test anchor matched ${n} times, not 1`); return 1; }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ngc-self-'));
  const broken = path.join(dir, 'census-broken.mjs');
  // the census imports the probe by a relative path; a copy elsewhere needs it absolute
  fs.writeFileSync(broken, real.replace(ANCHOR, 'return d !== null && d < tolerance;').replace("'./bsd-next-goal-probe.mjs'", JSON.stringify(pathToFileURL(path.resolve('scripts/bsd-next-goal-probe.mjs')).href)));
  const r = spawnSync(process.execPath, [fileURLToPath(import.meta.url), '--source', broken], { encoding: 'utf8' });
  const red = r.status === 1 && /^FAIL/m.test(r.stdout);
  fs.rmSync(dir, { recursive: true, force: true });
  console.log(`${red ? 'ok  ' : 'FAIL'}  self-test: the check goes red (exit ${r.status}) on a census whose tolerance boundary has become exclusive`);
  return red ? 0 : 1;
}

if (argv.includes('--self-test')) {
  const bad = selfTest();
  console.log(`\n${bad === 0 ? 'OK' : 'FAILED'}: check self-test`);
  finished = true;
  process.exit(bad === 0 ? 0 : 1);
}

await run();
console.log(`\nscenarios ${scenarios}, assertions ${assertions}, failed ${failed}   (source: ${SOURCE})`);
if (scenarios < MIN_SCENARIOS) { console.log(`FAIL  only ${scenarios} scenarios ran; MIN_SCENARIOS is ${MIN_SCENARIOS}`); failed++; }
if (assertions < MIN_ASSERTIONS) { console.log(`FAIL  only ${assertions} assertions ran; MIN_ASSERTIONS is ${MIN_ASSERTIONS}`); failed++; }
finished = true;
process.exit(failed === 0 ? 0 : 1);
