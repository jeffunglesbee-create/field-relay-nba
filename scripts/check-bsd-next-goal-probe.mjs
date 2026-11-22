#!/usr/bin/env node
// Rule 90 / Rule 91 for scripts/bsd-next-goal-probe.mjs.
//
// The probe's one job is to turn a vendor's answers into verdicts a person will act on: is the
// endpoint gated, do the ids join, which in-play matches have no read, are the filters honoured,
// does the published 73.6% reproduce. A probe that has only ever run against the vendor proves
// nothing about those verdicts, because the vendor's answer on the day is not under our control.
// This runs `analyse` and the pure helpers on SYNTHETIC payloads shaped from the documentation and
// from the real events/live capture, one scenario per verdict branch, and asserts each verdict and
// each denominator. scripts/mutate-bsd-next-goal-probe.mjs then breaks the probe and requires this
// (or the run check) to go red on every break.
//
// WHAT THIS DOES NOT COVER: the vendor's real behaviour (that is the probe's run), the network
// layer of main() (that is scripts/check-bsd-next-goal-probe-run.mjs), and any field the
// documentation does not name. The fixtures are not vendor data and say nothing about the
// vendor's accuracy.
//
// SAMPLE-COVERAGE-A (Rule 91): scenarios and assertions run are printed, and a run that executed
// fewer than MIN_SCENARIOS or MIN_ASSERTIONS cannot pass.
//
// Usage: node scripts/check-bsd-next-goal-probe.mjs [--source <probe.mjs>]
//        node scripts/check-bsd-next-goal-probe.mjs --self-test

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

// Set to the exact counts of the last full run, so a scenario that is deleted or skipped trips them.
export const MIN_SCENARIOS = 19;
export const MIN_ASSERTIONS = 241;

const argv = process.argv.slice(2);
const srcIdx = argv.indexOf('--source');
const SOURCE = srcIdx >= 0 ? argv[srcIdx + 1] : 'scripts/bsd-next-goal-probe.mjs';

let scenarios = 0, assertions = 0, failed = 0;
// A probe whose import runs main() ends in process.exit(0), which would pre-empt the summary and the MIN gates below
// and leave this exiting 0 having run nothing. An exit before the end is a failure.
let finished = false;
process.on('exit', (code) => {
  if (!finished) { console.log(`FAIL  the check did not run to its end (exit ${code}, ${scenarios} scenarios, ${assertions} assertions)`); process.exitCode = 1; }
});
// key order is not part of any verdict, so it is not part of any comparison
const stable = (v) => JSON.stringify(v, (k, val) => (val && typeof val === 'object' && !Array.isArray(val)
  ? Object.fromEntries(Object.entries(val).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) : val));
const eq = (label, got, want) => {
  assertions++;
  if (stable(got) !== stable(want)) { failed++; console.log(`FAIL  ${label}\n        got  ${stable(got)}\n        want ${stable(want)}`); }
};
const scenario = (name, fn) => {
  scenarios++;
  try { fn(); } catch (e) { failed++; console.log(`FAIL  ${name} threw: ${e.message}`); }
};

const NOW = '2026-11-22T14:01:00Z';
const rec = (key, status, json, extra = {}) => ({ key, path: `/${key}`, status, json, at: NOW, headers: {}, ...extra });

const { analyse, gateOf, definiteGate, liveRows, ngRows, refuseIfTokenInside, fieldLeagueIdsFromSource, VENDOR_CLAIMS,
  liveClass, isHalftime, pickNoRead, pickFinished, pickLeague, nameOf, positiveInt, coverageOf, shapeOf } =
  await import(pathToFileURL(path.resolve(SOURCE)).href);
const { ngRow, liveRow, finishedRow, notStartedRow, halftimeRow, page, cnt, THREE } =
  await import(pathToFileURL(path.resolve('scripts/fixtures/bsd-next-goal-synthetic.mjs')).href);

// an ngRow whose event carries no league_id (ngRow's own default would turn a null into league 7)
const noLeagueRow = (id) => { const r = ngRow({ id }); return { ...r, event: { ...r.event, league_id: null } }; };

const baseRaw = () => ({
  ng_list: rec('ng_list', 200, page(THREE)),
  live: rec('live', 200, { count: 5, events: [liveRow({ id: 1 }), liveRow({ id: 2 }), liveRow({ id: 3, league: 8 }),
    liveRow({ id: 4, minute: 30, wsp: true }), liveRow({ id: 5, minute: 9 })] }),
  ng_calls_only: rec('ng_calls_only', 200, page([THREE[0], THREE[2]])),
  ng_league: rec('ng_league', 200, page([THREE[0], THREE[1]]), { leagueUsed: '7' }),
  ng_league_control: rec('ng_league_control', 200, page([]), { leagueUsed: 100008 }),
  ng_one: rec('ng_one', 200, { ...THREE[0], available: true }, { id: 1 }),
  ng_noread_pick: 4,
  ng_noread: rec('ng_noread', 200, { event: { id: 4 }, available: false, reason: 'too_early' }, { id: 4, eventStatus: 'inprogress' }),
  finished_list: rec('finished_list', 200, page([notStartedRow({ id: 8 }), finishedRow({ id: 9 })])),
  ng_finished_pick: 9,
  ng_finished: rec('ng_finished', 200, { event: { id: 9 }, available: false, reason: 'not_live' }, { id: 9 }),
  calls_since: rec('calls_since', 200, cnt(1500)),
  calls_page: rec('calls_page', 200, page([{ event_id: 1, minute: 12, side: 'home', team: 'Alpha 1', probability: 0.8, score_at_call: { home: 0, away: 0 }, outcome: 'hit', resolved_at: '2026-11-21T19:00:00Z' }])),
  calls_hit: rec('calls_hit', 200, cnt(1100)), calls_miss: rec('calls_miss', 200, cnt(380)),
  calls_nogoal: rec('calls_nogoal', 200, cnt(8)), calls_unclear: rec('calls_unclear', 200, cnt(2)), calls_open: rec('calls_open', 200, cnt(10)),
  calls_all: rec('calls_all', 200, cnt(9000)),
  calls_last_offset: rec('calls_last_offset', 200, page([{ event_id: 7, outcome: 'hit', resolved_at: '2026-01-05T10:00:00Z' }])),
});
const CTX = { d90: '2026-08-24', callsMade: 18, callBudget: 24, fieldLeagueIds: [7, 3] };
const A = (raw) => analyse(raw, CTX);
const withoutPicks = (r) => { for (const k of ['ng_noread_pick', 'ng_noread', 'ng_finished_pick', 'ng_finished', 'finished_list']) delete r[k]; return r; };

// The real feed's mix: finished rows first, a not-started row, matches in play at several minutes, one at halftime.
const realShapeLive = () => [
  finishedRow({ id: 101 }), finishedRow({ id: 102 }), finishedRow({ id: 103 }), notStartedRow({ id: 104 }),
  liveRow({ id: 201, minute: 44 }), liveRow({ id: 202, minute: 84, wsp: true }), halftimeRow({ id: 203 }),
  liveRow({ id: 204, minute: 10 }), liveRow({ id: 205, minute: 9 }), liveRow({ id: 206, minute: null }), liveRow({ id: 207, minute: 12 }),
];
const realShapeRaw = () => {
  const r = baseRaw();
  r.ng_list = rec('ng_list', 200, page([ngRow({ id: 201 }), ngRow({ id: 204 }), ngRow({ id: 101 }), ngRow({ id: 206 }), ngRow({ id: 203 }), ngRow({ id: 205 })]));
  r.live = rec('live', 200, { count: 11, events: realShapeLive() });
  return r;
};

function run() {
  scenario('1 a normal slate: every verdict ANSWERED with its denominators', () => {
    const a = A(baseRaw());
    eq('gate OPEN', [a.gate.verdict, a.gate.status], ['OPEN', 200]);
    eq('ledger gate OPEN', a.gateCalls.verdict, 'OPEN');
    eq('shape rows', [a.shape.verdict, a.shape.rows], ['ANSWERED', 3]);
    eq('ids: same space, 3 matched, 0 name disagreements', [a.idSpace.verdict, a.idSpace.matchedInEventsLive, a.idSpace.nameAgree, a.idSpace.nameDisagree, a.idSpace.nameUnknown, a.idSpace.partial], ['SAME_ID_SPACE', 3, 3, 0, 0, false]);
    eq('home team ids agree 3 of 3', [a.idSpace.homeTeamIdAgree, a.idSpace.homeTeamIdDisagree], [3, 0]);
    eq('id types', a.idSpace.idTypes, { number: 3 });
    eq('leagues distinct 2', [a.leagues.verdict, a.leagues.distinct, a.leagues.byLeague['7'].rows, a.leagues.byLeague['8'].rows, a.leagues.byLeague['7'].league_name], ['ANSWERED', 2, 2, 1, 'League 7']);
    eq('field-tracked rows: league 7 tracked, 8 not', [a.leagues.rowsInFieldTrackedLeagues, a.leagues.rowsOutsideFieldTrackedLeagues, a.leagues.fieldTrackedLeagueIds], [2, 1, ['3', '7']]);
    eq('coverage verdict and truncation', [a.coverage.verdict, a.coverage.listTruncated, a.truncated.partial], ['ANSWERED', false, false]);
    eq('coverage live 5, all in play, 4 at minute 10+ with 3 reads', [a.coverage.liveRows, a.coverage.byClass, a.coverage.inPlay, a.coverage.inPlayAtMinute10Plus, a.coverage.withReadAtMinute10Plus, a.coverage.withoutReadAtMinute10Plus], [5, { inplay: 5 }, 5, 4, 3, 1]);
    eq('the gap by period, minute bucket, websocket_plus and league', [a.coverage.withoutReadByPeriod, a.coverage.withoutReadByMinuteBucket, a.coverage.withoutReadByWebsocketPlus, a.coverage.withoutReadByLeague], [{ '1st_half': 1 }, { '15+': 1 }, { true: 1 }, { '7:League 7': 1 }]);
    eq('reads by websocket_plus', a.coverage.withReadByWebsocketPlus, { false: 3 });
    eq('before minute 10, unknown minute, halftime, reads for non-play rows, next-goal rows not in live', [a.coverage.inPlayBeforeMinute10, a.coverage.inPlayUnknownMinute, a.coverage.halftime, a.coverage.readsForRowsNotInPlay, a.coverage.nextGoalRowsNotInEventsLive], [{ n: 1, withRead: 0 }, { n: 0, withRead: 0 }, { n: 0, withRead: 0 }, 0, 0]);
    eq('calls_only honoured', [a.filterCallsOnly.verdict, a.filterCallsOnly.filteredRows, a.filterCallsOnly.unfilteredCalls, a.filterCallsOnly.pausedInFiltered, a.filterCallsOnly.plainNonCallsInFiltered], ['HONOURED', 2, 2, 0, 0]);
    eq('league_id honoured with a control of 0 rows', [a.filterLeagueId.verdict, a.filterLeagueId.leagueUsed, a.filterLeagueId.filteredRows, a.filterLeagueId.controlRows, a.filterLeagueId.controlLeagueId], ['HONOURED', '7', 2, 0, 100008]);
    eq('one match available true', [a.oneMatch.verdict, a.oneMatch.id, a.oneMatch.available, a.oneMatch.extraKeysVersusList, a.oneMatch.missingKeysVersusList], ['ANSWERED', 1, true, ['available'], []]);
    eq('no read in play: too_early, from the picked event', [a.noReadInPlay.available, a.noReadInPlay.reason, a.noReadInPlay.id, a.noReadInPlay.eventStatus], [false, 'too_early', 4, 'inprogress']);
    eq('no read finished: not_live', [a.noReadFinished.available, a.noReadFinished.reason, a.noReadFinished.id], [false, 'not_live', 9]);
    eq('the finished list is recorded with its vocabulary', a.finishedList, { requested: true, rows: 2, statusPeriod: { 'notstarted/(absent)': 1, 'finished/FT': 1 }, picked: 9 });
    eq('events/live vocabulary and classes', [a.live.shape, a.live.rows, a.live.count, a.live.byClass, a.live.statusPeriod, a.live.websocketPlus], ['events', 5, 5, { inplay: 5 }, { 'inprogress/2nd_half': 3, 'inprogress/1st_half': 2 }, { false: 4, true: 1 }]);
    eq('coverage line carries the denominators', a.coverageLine, 'next-goal list: 3 rows (gate OPEN 200) | events/live: 5 rows, 5 in play, 4 at minute 10+ (3 with a read, 1 without) | leagues with reads: 2 | ledger: 1500 calls since 2026-08-24, 1 page rows, 5 of 5 outcome counts | calls 18/24');
  });

  scenario('2 the real feed: finished and not-started rows are not matches in play', () => {
    const a = A(realShapeRaw());
    eq('classes', a.coverage.byClass, { finished: 3, notstarted: 1, inplay: 7 });
    eq('7 in play, 4 of them at minute 10+ (the halftime row, the minute-9 row and the unknown-minute row are not)', [a.coverage.liveRows, a.coverage.inPlay, a.coverage.inPlayAtMinute10Plus], [11, 7, 4]);
    eq('2 with a read, 2 without', [a.coverage.withReadAtMinute10Plus, a.coverage.withoutReadAtMinute10Plus], [2, 2]);
    eq('the gap is the 84th-minute match (2nd half, 15+, websocket_plus) and the 12th-minute match (1st half, 10-14)', [a.coverage.withoutReadByPeriod, a.coverage.withoutReadByMinuteBucket, a.coverage.withoutReadByWebsocketPlus, a.coverage.withReadByWebsocketPlus], [{ '2nd_half': 1, '1st_half': 1 }, { '15+': 1, '10-14': 1 }, { true: 1, false: 1 }, { false: 2 }]);
    eq('before minute 10, unknown minute and halftime: each with its read', [a.coverage.inPlayBeforeMinute10, a.coverage.inPlayUnknownMinute, a.coverage.halftime], [{ n: 1, withRead: 1 }, { n: 1, withRead: 1 }, { n: 1, withRead: 1 }]);
    eq('a read for a FINISHED match is counted, not hidden', a.coverage.readsForRowsNotInPlay, 1);
    eq('the line says 4 at minute 10+, not 11 events', /events\/live: 11 rows, 7 in play, 4 at minute 10\+ \(2 with a read, 2 without\)/.test(a.coverageLine), true);
    eq('ids still join across finished and in-play rows', [a.idSpace.verdict, a.idSpace.matchedInEventsLive], ['SAME_ID_SPACE', 6]);
    eq('vocabulary seen', a.live.statusPeriod, { 'finished/FT': 3, 'notstarted/(absent)': 1, 'inprogress/1st_half': 4, 'inprogress/2nd_half': 2, 'inprogress/halftime': 1 });
    const lv = realShapeLive(), ng = [ngRow({ id: 201 }), ngRow({ id: 204 }), ngRow({ id: 101 })];
    eq('the no-read pick prefers an unread match at minute 10+ (the first in the feed)', pickNoRead(lv, ng).id, 202);
    eq('...then the next unread match at minute 10+ (never the halftime row, which is at minute 45)', pickNoRead(lv, [...ng, ngRow({ id: 202 })]).id, 207);
    eq('...then an unread match in play before minute 10', pickNoRead(lv, [...ng, ngRow({ id: 202 }), ngRow({ id: 207 })]).id, 205);
    eq('...then nothing (a null minute, halftime and finished rows are never picked)', pickNoRead(lv, [...ng, ngRow({ id: 202 }), ngRow({ id: 207 }), ngRow({ id: 205 })]), null);
    eq('minute 10 counts as 10+: with a minute-9 match listed first, the minute-10 match is picked', pickNoRead([liveRow({ id: 2, minute: 9 }), liveRow({ id: 1, minute: 10 })], []).id, 1);
    const lone = liveRow({ id: 301, minute: 40 }); delete lone.websocket_plus;
    eq('a row with no websocket_plus key is counted as (absent), not as false', coverageOf([lone], []).withoutReadByWebsocketPlus, { '(absent)': 1 });
    eq('a finished row is never the in-play pick even when it has no read', pickNoRead([finishedRow({ id: 9 })], []), null);
    eq('...nor when it carries a minute', pickNoRead([{ ...finishedRow({ id: 9 }), current_minute: 90 }], []), null);
    eq('...nor a not-started row that carries one', pickNoRead([{ ...notStartedRow({ id: 9 }), current_minute: 0 }], []), null);
    eq('not-array input is null', [pickNoRead(null, []), pickNoRead(undefined, [])], [null, null]);
    eq('the unread pick with no list at all', pickNoRead([liveRow({ id: 7, minute: 20 })], null).id, 7);
    eq('the finished pick is the first finished row', pickFinished([notStartedRow({ id: 1 }), finishedRow({ id: 2 }), finishedRow({ id: 3 })]).id, 2);
    eq('no finished row: null; a row without an id is skipped; not-array is null', [pickFinished([notStartedRow({ id: 1 })]), pickFinished([{ status: 'finished', period: 'FT' }, finishedRow({ id: 5 })]).id, pickFinished(null)], [null, 5, null]);
  });

  scenario('3 liveClass and isHalftime on every state the feed shows', () => {
    const c = (status, period) => liveClass({ status, period });
    eq('finished/FT', c('finished', 'FT'), 'finished');
    eq('ended', c('ended', null), 'finished');
    eq('the period wins over an in-progress status', c('inprogress', 'FT'), 'finished');
    eq('after extra time', c('inprogress', 'AET'), 'finished');
    eq('inprogress 1st half', c('inprogress', '1st_half'), 'inplay');
    eq('inprogress 2nd half', c('inprogress', '2nd_half'), 'inplay');
    eq('inprogress halftime is in play', c('inprogress', 'halftime'), 'inplay');
    eq('next-goal vocabulary (status is the period)', c('2nd_half', undefined), 'inplay');
    eq('extra time in play', c('inprogress', 'extra_time_1'), 'inplay');
    eq('extra time by status alone (the next-goal vocabulary puts the period in the status)', [c('extra_time_1', undefined), c('penalties', undefined)], ['inplay', 'inplay']);
    eq('a period alone is enough', [c(undefined, '1st_half'), c(null, '2nd_half'), c(undefined, 'halftime')], ['inplay', 'inplay', 'inplay']);
    eq('notstarted', c('notstarted', null), 'notstarted');
    eq('postponed', c('postponed', null), 'notstarted');
    eq('abandoned', c('abandoned', null), 'notstarted');
    eq('an unknown vocabulary is other, visibly', [c('weird', 'odd'), liveClass({}), liveClass(null)], ['other', 'other', 'other']);
    eq('halftime by period', isHalftime({ period: 'halftime' }), true);
    eq('halftime by status', isHalftime({ status: 'half_time' }), true);
    eq('HT', isHalftime({ period: 'ht' }), true);
    eq('a half in play is not halftime', [isHalftime({ period: '1st_half' }), isHalftime({}), isHalftime(null)], [false, false, false]);
  });

  scenario('4 a 403 gate is GATED with its code, and everything downstream is UNKNOWN, not false', () => {
    const raw = withoutPicks(baseRaw());
    raw.ng_list = rec('ng_list', 403, { code: 'unlimited_required', detail: 'Requires Football API Unlimited' });
    const a = A(raw);
    eq('gate', [a.gate.verdict, a.gate.status, a.gate.code, a.gate.detail, a.gate.bodyKeys], ['GATED', 403, 'unlimited_required', 'Requires Football API Unlimited', ['code', 'detail']]);
    eq('shape is UNKNOWN naming the gate', [a.shape.verdict, /GATED/.test(a.shape.why)], ['UNKNOWN', true]);
    eq('idSpace, leagues UNKNOWN', [a.idSpace.verdict, a.leagues.verdict], ['UNKNOWN', 'UNKNOWN']);
    eq('coverage UNKNOWN, with the reason', [a.coverage.verdict, /next-goal not read: next-goal gate is GATED/.test(a.coverage.why)], ['UNKNOWN', true]);
    eq('filters UNKNOWN', [a.filterCallsOnly.verdict, a.filterLeagueId.verdict], ['UNKNOWN', 'UNKNOWN']);
    eq('no truncation block when nothing was read', a.truncated, undefined);
    eq('the no-read reasons say what happened', [a.noReadInPlay.why, a.noReadFinished.why], ['next-goal not read: GATED', 'not requested: next-goal was not read']);
    eq('coverage line says no rows and the gate, and still reports events/live', /next-goal list: no rows \(gate GATED 403\) \| events\/live: 5 rows, 5 in play \(not compared: next-goal not read\) \| leagues with reads: n\/a/.test(a.coverageLine), true);
    const nr = baseRaw(); nr.ng_list = rec('ng_list', 200, { count: 0 });
    eq('a 200 without a results array is not an empty slate', [A(nr).shape.why, A(nr).gate.verdict], ['next-goal returned 200 without a results array', 'OPEN']);
  });

  scenario('5 every other status code has its own verdict, and a status beats an error', () => {
    eq('402', gateOf(rec('x', 402, { detail: 'pay' })).verdict, 'GATED');
    eq('401', gateOf(rec('x', 401, {})).verdict, 'TOKEN_REFUSED');
    eq('404', gateOf(rec('x', 404, {})).verdict, 'ABSENT');
    eq('429', gateOf(rec('x', 429, {})).verdict, 'RATE_LIMITED');
    eq('500', gateOf(rec('x', 500, {})).verdict, 'UPSTREAM_ERROR');
    eq('503', gateOf(rec('x', 503, {})).verdict, 'UPSTREAM_ERROR');
    eq('418 is UNKNOWN', gateOf(rec('x', 418, {})).verdict, 'UNKNOWN');
    eq('200 is OPEN with its keys and no code', gateOf(rec('x', 200, { results: [] })), { status: 200, verdict: 'OPEN', bodyKeys: ['results'] });
    eq('a non-JSON body is kept, trimmed', gateOf(rec('x', 502, undefined, { nonJson: '<html>bad gateway</html>' })).nonJson, '<html>bad gateway</html>');
    eq('a 429 whose body then failed is still RATE_LIMITED, and says the body failed', gateOf({ key: 'x', status: 429, error: 'terminated' }), { status: 429, verdict: 'RATE_LIMITED', bodyKeys: null, code: null, detail: null, bodyError: 'terminated' });
    eq('the code is read from error.code too', gateOf(rec('x', 403, { error: { code: 'nope', message: 'm' } })).code, 'nope');
    eq('definiteGate: open, gated, absent yes; the rest no', ['OPEN', 'GATED', 'ABSENT', 'UNKNOWN', 'RATE_LIMITED', 'TOKEN_REFUSED', 'UPSTREAM_ERROR'].map((v) => definiteGate({ verdict: v })), [true, true, true, false, false, false, false]);
    eq('definiteGate of nothing', [definiteGate(null), definiteGate(undefined)], [false, false]);
  });

  scenario('6 an empty list while matches are in play is an ANSWER, not a hole', () => {
    const raw = baseRaw();
    raw.ng_list = rec('ng_list', 200, page([]));
    raw.live = rec('live', 200, { count: 12, events: [finishedRow({ id: 1 }), liveRow({ id: 2, minute: 30 }), liveRow({ id: 3, minute: 70 }), halftimeRow({ id: 4 })] });
    const a = A(raw);
    eq('gate still OPEN', a.gate.verdict, 'OPEN');
    eq('shape UNKNOWN', [a.shape.verdict, /0 rows/.test(a.shape.why)], ['UNKNOWN', true]);
    eq('idSpace, leagues UNKNOWN', [a.idSpace.verdict, a.leagues.verdict], ['UNKNOWN', 'UNKNOWN']);
    eq('coverage ANSWERED: 0 of 2 in play at minute 10+ have a read', [a.coverage.verdict, a.coverage.inPlayAtMinute10Plus, a.coverage.withReadAtMinute10Plus, a.coverage.withoutReadAtMinute10Plus], ['ANSWERED', 2, 0, 2]);
    eq('the truncation block exists for an empty list', a.truncated, { reportedCount: 0, rowsRead: 0, nextPage: null, partial: false });
    eq('filters UNKNOWN', [a.filterCallsOnly.verdict, a.filterLeagueId.verdict], ['UNKNOWN', 'UNKNOWN']);
    eq('the line', /next-goal list: 0 rows \(gate OPEN 200\) \| events\/live: 4 rows, 3 in play, 2 at minute 10\+ \(0 with a read, 2 without\)/.test(a.coverageLine), true);
    const noLive = withoutPicks(baseRaw());
    noLive.ng_list = rec('ng_list', 200, page([]));
    noLive.live = rec('live', 200, { count: 0, events: [] });
    const b = A(noLive);
    eq('nothing live at all: 0 of 0, and the reason says nothing was in play', [b.coverage.inPlayAtMinute10Plus, b.coverage.withoutReadAtMinute10Plus, /no in-play match without a read/.test(b.noReadInPlay.why)], [0, 0, true]);
  });

  scenario('7 id space: collisions, unknown names, spelling, objects, strings', () => {
    const coll = baseRaw();
    coll.live = rec('live', 200, { count: 3, events: [liveRow({ id: 1, home: 'Someone Else' }), liveRow({ id: 2 }), liveRow({ id: 3, league: 8 })] });
    const c = A(coll).idSpace;
    eq('collision', [c.verdict, c.nameAgree, c.nameDisagree, c.disagreements.length, c.disagreements[0].id, c.disagreements[0].live, c.disagreements[0].nextGoal], ['ID_COLLISION', 2, 1, 1, 1, ['Someone Else', 'Beta 1'], ['Alpha 1', 'Beta 1']]);
    const four = baseRaw();
    four.ng_list = rec('ng_list', 200, page([1, 2, 3, 4, 5].map((id) => ngRow({ id }))));
    four.live = rec('live', 200, { count: 5, events: [1, 2, 3, 4, 5].map((id) => liveRow({ id, home: `Other ${id}` })) });
    eq('only the first three disagreements are kept, all are counted', [A(four).idSpace.nameDisagree, A(four).idSpace.disagreements.length], [5, 3]);
    const t = baseRaw();
    t.live = rec('live', 200, { count: 3, events: [liveRow({ id: 1, tid: 999 }), liveRow({ id: 2 }), liveRow({ id: 3, league: 8 })] });
    const T = A(t).idSpace;
    eq('names agree but one home team id differs: recorded, not a collision', [T.verdict, T.homeTeamIdAgree, T.homeTeamIdDisagree], ['SAME_ID_SPACE', 2, 1]);
    const nj = baseRaw();
    nj.live = rec('live', 200, { count: 1, events: [liveRow({ id: 99 })] });
    const n = A(nj).idSpace;
    eq('not joined, and the note says why it cannot tell', [n.verdict, n.matchedInEventsLive, n.partial, typeof n.note], ['NOT_JOINED', 0, true, 'string']);
    const sp = baseRaw();
    sp.ng_list = rec('ng_list', 200, page([ngRow({ id: 1, home: 'Atlético Madrid', away: 'Real  Sociedad' }), ngRow({ id: 2, home: 'Öster IF', away: "St. Mary's" }), ngRow({ id: 3, league: 8 })]));
    sp.live = rec('live', 200, { count: 3, events: [liveRow({ id: 1, home: 'Atletico Madrid', away: 'real sociedad' }), liveRow({ id: 2, home: 'Oster IF', away: 'St Marys' }), liveRow({ id: 3, league: 8 })] });
    eq('diacritics, case, spacing and punctuation are one name', [A(sp).idSpace.verdict, A(sp).idSpace.nameAgree], ['SAME_ID_SPACE', 3]);
    const un = baseRaw();
    un.ng_list = rec('ng_list', 200, page([ngRow({ id: 1, home: '', away: '' })]));
    un.live = rec('live', 200, { count: 1, events: [liveRow({ id: 1, home: '', away: '' })] });
    const U = A(un).idSpace;
    eq('ids match, no team name comparable on either side: UNKNOWN, never SAME', [U.verdict, U.matchedInEventsLive, U.nameAgree, U.nameDisagree, U.nameUnknown, typeof U.note], ['UNKNOWN', 1, 0, 0, 1, 'string']);
    const nl = baseRaw();
    nl.ng_list = rec('ng_list', 200, page([ngRow({ id: 1, home: '北京国安', away: '上海申花' })]));
    nl.live = rec('live', 200, { count: 1, events: [liveRow({ id: 1, home: '北京国安', away: '上海申花' })] });
    eq('names that fold to nothing (non-Latin) are unknown, not agreeing', [A(nl).idSpace.verdict, A(nl).idSpace.nameUnknown], ['UNKNOWN', 1]);
    const ob = baseRaw();
    ob.ng_list = rec('ng_list', 200, page([ngRow({ id: 1, home: { id: 5, name: 'Alpha 1' }, away: { id: 6, name: 'Beta 1' } })]));
    ob.live = rec('live', 200, { count: 1, events: [liveRow({ id: 1 })] });
    eq('team objects with a name compare by name', [A(ob).idSpace.verdict, A(ob).idSpace.nameAgree], ['SAME_ID_SPACE', 1]);
    const sid = baseRaw();
    sid.ng_list = rec('ng_list', 200, page([{ ...ngRow({ id: 1 }), event: { ...ngRow({ id: 1 }).event, id: '1' } }]));
    sid.live = rec('live', 200, { count: 1, events: [liveRow({ id: 1 })] });
    eq('a string id joins a numeric one, and the type is recorded', [A(sid).idSpace.verdict, A(sid).idSpace.idTypes], ['SAME_ID_SPACE', { string: 1 }]);
    const half = baseRaw();
    half.ng_list = rec('ng_list', 200, page([ngRow({ id: 1 }), ngRow({ id: 50 })]));
    half.live = rec('live', 200, { count: 1, events: [liveRow({ id: 1 })] });
    const H = A(half);
    eq('one of two matched: partial, and the unmatched row is counted', [H.idSpace.verdict, H.idSpace.matchedInEventsLive, H.idSpace.partial, H.coverage.nextGoalRowsNotInEventsLive], ['SAME_ID_SPACE', 1, true, 1]);
    const awayDiff = baseRaw();
    awayDiff.live = rec('live', 200, { count: 3, events: [liveRow({ id: 1, away: 'Someone Else' }), liveRow({ id: 2 }), liveRow({ id: 3, league: 8 })] });
    eq('the home names agree and the away names differ: a collision', [A(awayDiff).idSpace.verdict, A(awayDiff).idSpace.nameDisagree], ['ID_COLLISION', 1]);
    const homeOnly = baseRaw();
    homeOnly.ng_list = rec('ng_list', 200, page([ngRow({ id: 1, home: '' })]));
    homeOnly.live = rec('live', 200, { count: 1, events: [liveRow({ id: 1, home: '' })] });
    eq('the away names agree and the home name is empty on both sides: that row is unknown, not agreeing', [A(homeOnly).idSpace.verdict, A(homeOnly).idSpace.nameUnknown, A(homeOnly).idSpace.nameAgree], ['UNKNOWN', 1, 0]);
    const awayOnly = baseRaw();
    awayOnly.ng_list = rec('ng_list', 200, page([ngRow({ id: 1, away: '' })]));
    awayOnly.live = rec('live', 200, { count: 1, events: [liveRow({ id: 1, away: '' })] });
    eq('the home names agree and the away name is empty on both sides: that row is unknown, not agreeing', [A(awayOnly).idSpace.verdict, A(awayOnly).idSpace.nameUnknown, A(awayOnly).idSpace.nameAgree], ['UNKNOWN', 1, 0]);
    const noTid = baseRaw();
    const lr = liveRow({ id: 1 }); delete lr.home_team_id;
    noTid.live = rec('live', 200, { count: 1, events: [lr] });
    noTid.ng_list = rec('ng_list', 200, page([ngRow({ id: 1 })]));
    eq('a live row with no home_team_id is neither an agreement nor a disagreement of team ids', [A(noTid).idSpace.homeTeamIdAgree, A(noTid).idSpace.homeTeamIdDisagree], [0, 0]);
    eq('nameOf', [nameOf('x'), nameOf({ name: 'y' }), nameOf({ name: 5 }), nameOf(null), nameOf(7), nameOf([])], ['x', 'y', null, null, null, null]);
    const nolv = baseRaw();
    nolv.live = rec('live', 500, {});
    eq('events/live unreadable: idSpace and coverage UNKNOWN with the reason, the rest answered', [A(nolv).idSpace.why, A(nolv).coverage.why, A(nolv).shape.verdict, A(nolv).gateLive.verdict], ['events/live was not read', 'events/live was not read', 'ANSWERED', 'UPSTREAM_ERROR']);
    eq('and the line says so', /events\/live: not read/.test(A(nolv).coverageLine), true);
  });

  scenario('8 a list cut off at its page size is PARTIAL, and says so', () => {
    const raw = baseRaw();
    raw.ng_list = rec('ng_list', 200, page(THREE, { count: 450, next: 'https://x/api/v2/next-goal/?limit=200&offset=200' }));
    const a = A(raw);
    eq('truncation block', a.truncated, { reportedCount: 450, rowsRead: 3, nextPage: 'https://x/api/v2/next-goal/?limit=200&offset=200', partial: true });
    eq('coverage, leagues PARTIAL; id space partial', [a.coverage.verdict, a.coverage.listTruncated, a.leagues.verdict, a.idSpace.partial], ['PARTIAL', true, 'PARTIAL', true]);
    eq('the line names the cut', /3 rows \(TRUNCATED: 450 reported, next page not read\)/.test(a.coverageLine), true);
    const byCount = baseRaw();
    byCount.ng_list = rec('ng_list', 200, page(THREE, { count: 10 }));
    eq('count above the rows read with no next page is still partial', A(byCount).truncated.partial, true);
    const nextOnly = baseRaw();
    nextOnly.ng_list = rec('ng_list', 200, page(THREE, { count: 3, next: 'https://x/?offset=3' }));
    eq('a next page alone, with a count that matches the rows, still makes the list partial', A(nextOnly).truncated.partial, true);
    eq('count equal to the rows and no next page is complete', A(baseRaw()).truncated.partial, false);
    const noCount = baseRaw();
    noCount.ng_list = rec('ng_list', 200, { results: THREE });
    eq('no count and no next is not called partial', A(noCount).truncated, { reportedCount: null, rowsRead: 3, nextPage: null, partial: false });
  });

  scenario('9 calls_only: honoured, ignored, indistinguishable, inconsistent, paused', () => {
    const f = (mut) => { const r = baseRaw(); mut(r); return A(r).filterCallsOnly; };
    eq('a non-call in the filtered rows: NOT_HONOURED', f((r) => { r.ng_calls_only = rec('x', 200, page(THREE)); }).verdict, 'NOT_HONOURED');
    eq('...and the plain non-calls are counted', f((r) => { r.ng_calls_only = rec('x', 200, page(THREE)); }).plainNonCallsInFiltered, 1);
    const A8 = f((r) => { r.ng_list = rec('ng_list', 200, page([THREE[0], THREE[2]])); });
    eq('every unfiltered row already a call: INDISTINGUISHABLE with a note', [A8.verdict, typeof A8.note], ['INDISTINGUISHABLE', 'string']);
    eq('0 filtered rows while calls exist: INCONSISTENT', f((r) => { r.ng_calls_only = rec('x', 200, page([])); }).verdict, 'INCONSISTENT');
    const NC = f((r) => { r.ng_list = rec('ng_list', 200, page([ngRow({ id: 1, call: false, conf: 0.4 }), ngRow({ id: 2, call: false, conf: 0.3 })])); r.ng_calls_only = rec('x', 200, page([])); });
    eq('NO call on the slate and an empty filtered answer: INDISTINGUISHABLE, never HONOURED', [NC.verdict, NC.unfilteredCalls, NC.filteredRows, /nothing for the filter to retrieve/.test(NC.note)], ['INDISTINGUISHABLE', 0, 0, true]);
    const paused = f((r) => { r.ng_calls_only = rec('x', 200, page([THREE[0], ngRow({ id: 9, call: false, paused: true, conf: 0.7 })])); });
    eq('a paused would-be call in the filtered rows is its own count and does not condemn the filter', [paused.verdict, paused.pausedInFiltered, paused.plainNonCallsInFiltered], ['HONOURED', 1, 0]);
    eq('calls_only not answered 200: UNKNOWN with the reason', f((r) => { r.ng_calls_only = { key: 'x', blocked: 'call budget 3 exhausted' }; }), { verdict: 'UNKNOWN', why: 'call budget 3 exhausted' });
    eq('...and a non-200 status', f((r) => { r.ng_calls_only = rec('x', 500, {}); }).why, 'calls_only call status 500');
  });

  scenario('10 league_id: honoured, ignored, emptied, leaky, one-league slate, no league on the rows', () => {
    const f = (mut) => { const r = baseRaw(); mut(r); return A(r).filterLeagueId; };
    eq('control returns everything: NOT_HONOURED', f((r) => { r.ng_league = rec('x', 200, page(THREE), { leagueUsed: '7' }); r.ng_league_control = rec('x', 200, page(THREE), { leagueUsed: 100008 }); }).verdict, 'NOT_HONOURED');
    eq('emptied: 0 rows for a league that has reads', f((r) => { r.ng_league = rec('x', 200, page([]), { leagueUsed: '7' }); }).verdict, 'EMPTY_FOR_A_LEAGUE_WITH_READS');
    eq('rows from another league, control clean: UNKNOWN', f((r) => { r.ng_league = rec('x', 200, page(THREE), { leagueUsed: '7' }); }).verdict, 'UNKNOWN');
    const only7 = [THREE[0], THREE[1]];
    eq('a one-league slate with the filter ignored: every row is in league 7, only the control shows it', f((r) => { r.ng_list = rec('x', 200, page(only7)); r.ng_league = rec('x', 200, page(only7), { leagueUsed: '7' }); r.ng_league_control = rec('x', 200, page(only7), { leagueUsed: 100008 }); }).verdict, 'NOT_HONOURED');
    const pc = f((r) => { r.ng_league_control = rec('x', 200, page([THREE[2]]), { leagueUsed: 100008 }); });
    eq('a control that returns one of three rows is neither honoured nor ignored', [pc.verdict, pc.controlRows], ['UNKNOWN', 1]);
    eq('league_id not answered: UNKNOWN naming the block', f((r) => { r.ng_league = { key: 'x', blocked: 'run stopped on 429' }; }).why, 'run stopped on 429');
    eq('...or the control', f((r) => { r.ng_league_control = { key: 'x', blocked: 'call budget 6 exhausted' }; }).why, 'call budget 6 exhausted');
    eq('...or a 500', f((r) => { r.ng_league = rec('x', 500, {}); }).why, 'league_id call not answered with 200');
    const noLeague = baseRaw();
    noLeague.ng_list = rec('ng_list', 200, page([noLeagueRow(1), noLeagueRow(2)]));
    eq('no league_id on any row: UNKNOWN, no test', A(noLeague).filterLeagueId, { verdict: 'UNKNOWN', why: 'no league_id on any next-goal row' });
    eq('pickLeague: most common wins, the control is above the maximum', pickLeague([ngRow({ id: 1, league: 7 }), ngRow({ id: 2, league: 12 }), ngRow({ id: 3, league: 12 })]), { league: '12', control: 100012 });
    eq('pickLeague: no ids is null; null ids are skipped', [pickLeague([noLeagueRow(1)]), pickLeague([]), pickLeague([noLeagueRow(1), ngRow({ id: 2, league: 3 })])], [null, null, { league: '3', control: 100003 }]);
    const emptyLeague = ngRow({ id: 1 }); emptyLeague.event.league_id = '';
    eq('pickLeague: an empty-string league id is no league', pickLeague([emptyLeague]), null);
    eq('pickLeague: string ids stay strings and still get a numeric control', pickLeague([ngRow({ id: 1, league: 'epl' }), ngRow({ id: 2, league: 'epl' })]), { league: 'epl', control: 100000 });
  });

  scenario('11 the numeric summaries of a read, on rows that differ from each other', () => {
    const rows = [
      ngRow({ id: 1, minute: 10, msg: 0, m5: 5.5, m15: -3, sh: 4, sa: 0, gen: '2026-11-22T14:00:00Z', leader: 'home', conf: 0.8, probs: { home: 0.8, away: 0.1, no_goal: 0.1 }, th: 0.75, call: true }),
      ngRow({ id: 2, minute: 90, msg: 30, m5: -20, m15: -12, sa: 9, gen: '2026-11-22T14:00:50Z', leader: 'away', conf: 0.5, probs: { home: 0.25, away: 0.5, no_goal: 0.25 }, call: false }),
      ngRow({ id: 3, minute: 45, msg: null, call: false, paused: true, conf: 0.66, probs: { home: 0.2, away: 0.66, no_goal: 0.14 } }),
      ngRow({ id: 4, call: false, conf: 0.6, probs: { home: 0.2, away: 0.6, no_goal: 0.2 } }),
      ngRow({ id: 5, call: false, conf: 0.9, probs: { home: 0.05, away: 0.9, no_goal: 0.05 } }),
      { ...ngRow({ id: 6, conf: 0.4, probs: { home: 0.4, away: 0.3, no_goal: 0.3 } }), is_call: 'true' },
      ngRow({ id: 7, probs: { home: 0.4, away: 0.6, no_goal: null }, conf: 0.6, call: true }),
      ngRow({ id: 8, leader: 'home', conf: 0.3, call: false, probs: { home: 0.3, away: 0.3, no_goal: 0.1 }, tr: { accuracy: 77.3, matches_evaluated: 8394 } }),
    ];
    const s = shapeOf(rows, Date.parse(NOW));
    eq('rows', s.rows, 8);
    eq('probabilities sum to one on 7 of 8; the bad row is counted', s.probabilitiesSumToOne, { ok: 7, notOk: 1, tolerance: 0.011 });
    eq('no_goal null', s.noGoalNull, 1);
    eq('scales', [s.probabilityScale, s.confidenceScale, s.callThresholdScale], ['fraction (<=1)', 'fraction (<=1)', 'fraction (<=1)']);
    eq('leader domain', s.leader, { home: 2, away: 6 });
    eq('confidence equals the leader probability on 7, not on 1', s.confidenceEqualsLeaderProbability, { equal: 7, notEqual: 1, unknown: 0 });
    eq('is_call against the threshold, paused and rounding and unknown kept apart', s.isCallMatchesThreshold, { agree: 4, pausedExplained: 1, withinRounding: 1, disagree: 1, unknown: 1 });
    eq('threshold values, is_call, paused', [s.callThresholdValues, s.isCall, s.callPaused], [{ '0.75': 1, '0.6': 7 }, { true: 3, false: 5 }, { true: 1, false: 7 }]);
    eq('minute range', s.minute, { min: 10, max: 90, n: 8 });
    eq('minutes since a goal: range over the rows that have one, nulls counted', [s.minutesSinceGoal, s.minutesSinceGoalNull], [{ min: 0, max: 30, n: 7 }, 1]);
    eq('momentum ranges', [s.momentum5m, s.momentum15m], [{ min: -20, max: 5.5, n: 8 }, { min: -12, max: -3, n: 8 }]);
    eq('shots ranges', [s.shotsHome10m, s.shotsAway10m], [{ min: 0, max: 4, n: 8 }, { min: 0, max: 9, n: 8 }]);
    eq('evidence keys', s.evidenceKeys, ['momentum_15m', 'momentum_5m', 'red_cards_away', 'red_cards_home', 'shots_away_10m', 'shots_home_10m']);
    eq('track record: two distinct, first kept, scale mixed', [s.trackRecordDistinct, s.trackRecordFirst.accuracy, s.trackRecordAccuracyScale], [2, 0.72, 'mixed']);
    eq('age of a read in seconds, across rows', s.generatedAtAgeSeconds, { min: 5, max: 60, n: 8 });
    eq('field counts see every row', [s.fieldCounts['evidence.momentum_5m'], s.fieldCounts.leader, s.fieldCounts['event.id']], [8, 8, 8]);
    eq('event status vocabulary', s.eventStatus, { '2nd_half': 8 });
    const pct = shapeOf([ngRow({ id: 1, conf: 62, th: 60, probs: { home: 24, away: 62, no_goal: 14 }, tr: { accuracy: 77.3 } })], Date.parse(NOW));
    eq('percent scales are recognised', [pct.probabilityScale, pct.confidenceScale, pct.callThresholdScale, pct.trackRecordAccuracyScale], ['percent (>1)', 'percent (>1)', 'percent (>1)', 'percent (>1)']);
    const none = shapeOf([{}], Date.parse(NOW));
    eq('a row with nothing in it is counted, not crashed on', [none.rows, none.minute, none.probabilityScale, none.trackRecordDistinct, none.trackRecordAccuracyScale, none.generatedAtAgeSeconds, none.isCallMatchesThreshold.unknown], [1, null, null, 0, null, null, 1]);
    eq('a probability of exactly 1 is still a fraction', shapeOf([ngRow({ id: 1, probs: { home: 1, away: 0, no_goal: 0 }, leader: 'home', conf: 1 })], Date.parse(NOW)).probabilityScale, 'fraction (<=1)');
    const tol = shapeOf([
      ngRow({ id: 1, conf: 0.62, probs: { home: 0.2, away: 0.6249, no_goal: 0.1751 } }),
      ngRow({ id: 2, conf: 0.605, th: 0.6, call: false, probs: { home: 0.2, away: 0.605, no_goal: 0.195 } }),
      ngRow({ id: 3, conf: 0.62, probs: { home: 0.2, away: 0.64, no_goal: 0.16 } }),
      ngRow({ id: 4, conf: 0.5, th: 0.6, call: true, probs: { home: 0.25, away: 0.5, no_goal: 0.25 } }),
    ], Date.parse(NOW));
    eq('rounding: 0.62 against 0.6249 is equal, against 0.64 is not', tol.confidenceEqualsLeaderProbability, { equal: 3, notEqual: 1, unknown: 0 });
    eq('rounding: a call flagged false at 0.605 against 0.6 is within rounding; a call at 0.5 against 0.6 is a real disagreement', [tol.isCallMatchesThreshold.withinRounding, tol.isCallMatchesThreshold.disagree, tol.isCallMatchesThreshold.agree], [1, 1, 2]);
    const one = (o) => shapeOf([ngRow({ id: 1, ...o })], Date.parse(NOW)).isCallMatchesThreshold;
    eq('a call at exactly the threshold agrees', one({ conf: 0.6, th: 0.6, call: true, probs: { home: 0.2, away: 0.6, no_goal: 0.2 } }), { agree: 1, pausedExplained: 0, withinRounding: 0, disagree: 0, unknown: 0 });
    eq('a non-call at exactly the threshold is within rounding, not agreement', one({ conf: 0.6, th: 0.6, call: false, probs: { home: 0.2, away: 0.6, no_goal: 0.2 } }), { agree: 0, pausedExplained: 0, withinRounding: 1, disagree: 0, unknown: 0 });
    eq('a non-call just under the threshold agrees', one({ conf: 0.595, th: 0.6, call: false, probs: { home: 0.2, away: 0.595, no_goal: 0.205 } }), { agree: 1, pausedExplained: 0, withinRounding: 0, disagree: 0, unknown: 0 });
    const scl = shapeOf([ngRow({ id: 1, conf: 62, th: 0.6, probs: { home: 0.24, away: 0.62, no_goal: 0.14 } })], Date.parse(NOW));
    eq('each scale is read from its own field', [scl.probabilityScale, scl.confidenceScale, scl.callThresholdScale], ['fraction (<=1)', 'percent (>1)', 'fraction (<=1)']);
    eq('no nowMs means no age', shapeOf([ngRow({ id: 1 })], null).generatedAtAgeSeconds, null);
    eq('the age is measured against the first call', A(baseRaw()).shape.generatedAtAgeSeconds, { min: 5, max: 5, n: 3 });
    const later = baseRaw();
    later.live.at = '2026-11-22T14:09:00Z';
    eq('...so a later events/live does not change it', A(later).shape.generatedAtAgeSeconds, { min: 5, max: 5, n: 3 });
  });

  scenario('12 the ledger: partition, reproduction, order, depth', () => {
    const a = A(baseRaw());
    const R = a.ledger.reproduction;
    eq('verdict and partition', [R.verdict, R.sumOfFiveOutcomes, R.sumEqualsCountSince, R.partitionDifference], ['ANSWERED', 1500, true, 0]);
    eq('hit over hit+miss', R.definitions.hit_over_hit_miss, { hits: 1100, denominator: 1480, accuracy: 0.7432, deltaVersusVendorAccuracy: 0.0072, deltaVersusVendorGradedCalls: -28 });
    eq('hit over hit+miss+nogoal', [R.definitions.hit_over_hit_miss_nogoal.denominator, R.definitions.hit_over_hit_miss_nogoal.accuracy, R.definitions.hit_over_hit_miss_nogoal.deltaVersusVendorGradedCalls], [1488, 0.7392, -20]);
    eq('hit over +unclear', [R.definitions.hit_over_hit_miss_nogoal_unclear.denominator, R.definitions.hit_over_hit_miss_nogoal_unclear.accuracy], [1490, 0.7383]);
    eq('hit over all calls since', [R.definitions.hit_over_all_calls_since.denominator, R.definitions.hit_over_all_calls_since.accuracy, R.definitions.hit_over_all_calls_since.deltaVersusVendorAccuracy], [1500, 0.7333, -0.0027]);
    eq('the closest definition is named (1100/1490 = 0.7383 is 0.0023 from 0.736; 1100/1500 is 0.0027)', R.closestToVendorAccuracy, 'hit_over_hit_miss_nogoal_unclear');
    eq('the vendor claim travels with its provenance', [R.vendorClaim.accuracy, R.vendorClaim.gradedCalls, typeof R.vendorClaim.read], [0.736, 1508, 'string']);
    const mism = baseRaw(); mism.calls_open = rec('calls_open', 200, cnt(50));
    const M = A(mism).ledger.reproduction;
    eq('a counts mismatch is its own verdict, with the difference', [M.verdict, M.sumEqualsCountSince, M.partitionDifference], ['PARTITION_MISMATCH', false, 40]);
    const ign = baseRaw();
    for (const k of ['calls_hit', 'calls_miss', 'calls_nogoal', 'calls_unclear', 'calls_open']) ign[k] = rec(k, 200, cnt(1500));
    eq('every outcome count equal to the window: the filter was ignored', A(ign).ledger.reproduction.verdict, 'OUTCOME_FILTER_IGNORED');
    const zero = baseRaw();
    zero.calls_since = rec('calls_since', 200, cnt(0));
    for (const k of ['calls_hit', 'calls_miss', 'calls_nogoal', 'calls_unclear', 'calls_open']) zero[k] = rec(k, 200, cnt(0));
    const Z = A(zero).ledger.reproduction;
    eq('an empty ledger: ANSWERED with null accuracies, not a division by zero', [Z.verdict, Z.definitions.hit_over_hit_miss.accuracy, Z.definitions.hit_over_all_calls_since.accuracy, Z.closestToVendorAccuracy], ['ANSWERED', null, null, null]);
    eq('counts and since', [a.ledger.countSince, a.ledger.since, a.ledger.countAllTime, a.ledger.outcomes], [1500, '2026-08-24', 9000, { hit: 1100, miss: 380, nogoal: 8, unclear: 2, open: 10 }]);
    const span = baseRaw(); span.calls_open.at = '2026-11-22T14:01:07Z';
    eq('the counts are read over a span, and the span is reported', [a.ledger.countsSpanSeconds, A(span).ledger.countsSpanSeconds], [0, 7]);
    const rows = [
      { event_id: 1, minute: 12, side: 'home', team: 'A', probability: 0.8, outcome: 'open', score_at_call: { home: 0, away: 0 } },
      { event_id: 2, minute: 30, side: 'away', team: 'B', probability: 0.7, outcome: 'hit', resolved_at: '2026-11-21T19:00:00Z', called_at: '2026-11-21T18:30:00Z' },
      { event_id: 3, minute: 60, side: 'home', team: 'C', probability: 0.9, outcome: 'miss', result: { resolved_at: '2026-11-20T21:00:00Z' } },
    ];
    const withPage = (last) => { const r = baseRaw(); r.calls_page = rec('x', 200, page(rows)); r.calls_last_offset = rec('x', 200, page([last])); return A(r).ledger; };
    const P = withPage({ event_id: 7, outcome: 'hit', resolved_at: '2026-01-05T10:00:00Z' });
    eq('page summary', [P.page.rows, P.page.outcome, P.page.side, P.page.probability, P.page.minute, P.page.probabilityScale], [3, { open: 1, hit: 1, miss: 1 }, { home: 2, away: 1 }, { min: 0.7, max: 0.9, n: 3 }, { min: 12, max: 60, n: 3 }, 'fraction (<=1)']);
    eq('a row without a date is counted as such; a row dates by its latest value', [P.page.rowsWithADate, P.page.oldestRowDate, P.page.newestRowDate], [2, '2026-11-20T21:00:00Z', '2026-11-21T19:00:00Z']);
    eq('newest-first: the last-offset row is older than every dated row', [P.ledgerOrder, P.lastOffsetRowDate, P.lastOffsetRowKeys], ['newest-first', '2026-01-05T10:00:00Z', ['event_id', 'outcome', 'resolved_at']]);
    eq('oldest-first: it is newer than every dated row', withPage({ event_id: 7, resolved_at: '2026-12-30T00:00:00Z' }).ledgerOrder, 'oldest-first');
    eq('inconclusive: it falls inside the page', withPage({ event_id: 7, resolved_at: '2026-11-21T00:00:00Z' }).ledgerOrder, 'inconclusive');
    eq('unknown: the last-offset row has no date', withPage({ event_id: 7 }).ledgerOrder, 'unknown');
    const nodates = baseRaw(); nodates.calls_page = rec('x', 200, page([rows[0]]));
    eq('unknown: no row on the page has a date', A(nodates).ledger.ledgerOrder, 'unknown');
    const ldg = baseRaw(); ldg.calls_since = rec('calls_since', 403, { code: 'unlimited_required' });
    for (const k of ['calls_page', 'calls_hit', 'calls_miss', 'calls_nogoal', 'calls_unclear', 'calls_open', 'calls_all', 'calls_last_offset']) delete ldg[k];
    const G = A(ldg);
    eq('list OPEN, ledger GATED: reproduction UNKNOWN, no page, no order', [G.gate.verdict, G.gateCalls.verdict, G.ledger.reproduction.verdict, G.ledger.page, G.ledger.ledgerOrder], ['OPEN', 'GATED', 'UNKNOWN', undefined, undefined]);
    const emptyPage = baseRaw(); emptyPage.calls_page = rec('x', 200, page([]));
    eq('an empty ledger page has no summary and no order', [A(emptyPage).ledger.page, A(emptyPage).ledger.ledgerOrder], [undefined, 'unknown']);
    const badCount = baseRaw(); badCount.calls_hit = rec('calls_hit', 200, { count: 'many', results: [] });
    eq('a non-numeric count is not a count', A(badCount).ledger.reproduction.verdict, 'UNKNOWN');
    const oneEq = baseRaw();
    for (const [k, n] of [['calls_hit', 1500], ['calls_miss', 0], ['calls_nogoal', 0], ['calls_unclear', 0], ['calls_open', 0]]) oneEq[k] = rec(k, 200, cnt(n));
    const O = A(oneEq).ledger.reproduction;
    eq('one outcome equal to the window while the rest are 0 is a real partition, not an ignored filter', [O.verdict, O.definitions.hit_over_hit_miss.accuracy], ['ANSWERED', 1]);
    const claim = analyse(baseRaw(), { ...CTX, vendorClaims: { ...VENDOR_CLAIMS, accuracy: 0.5, gradedCalls: 1000 } }).ledger.reproduction;
    eq('the claim compared against is the one the caller gives', [claim.vendorClaim.accuracy, claim.definitions.hit_over_hit_miss.deltaVersusVendorAccuracy, claim.definitions.hit_over_hit_miss.deltaVersusVendorGradedCalls], [0.5, 0.2432, 480]);
    const miss = baseRaw(); delete miss.calls_miss;
    eq('one missing outcome count is UNKNOWN, not zero', A(miss).ledger.reproduction.verdict, 'UNKNOWN');
    eq('...and the line counts the five honestly', /4 of 5 outcome counts/.test(A(miss).coverageLine), true);
  });

  scenario('19 one match is compared with its own list row, not the first', () => {
    const rows = [ngRow({ id: 1 }), { ...ngRow({ id: 2 }), extra_key: 1 }, ngRow({ id: 3 })];
    const raw = baseRaw();
    raw.ng_list = rec('ng_list', 200, page(rows));
    raw.ng_one = rec('ng_one', 200, { ...rows[1], available: true }, { id: 2 });
    const o = A(raw).oneMatch;
    eq('the extra key is in both, so only `available` is extra, and nothing is missing', [o.id, o.extraKeysVersusList, o.missingKeysVersusList], [2, ['available'], []]);
    raw.ng_one = rec('ng_one', 200, { ...ngRow({ id: 2 }), available: true }, { id: 2 });
    eq('a one-match answer without the list row\'s extra key reports it missing', A(raw).oneMatch.missingKeysVersusList, ['extra_key']);
    raw.ng_one = rec('ng_one', 200, { available: false, reason: 'not_live' }, { id: 77 });
    eq('an id that is not in the list: the key comparison is null, not a guess', [A(raw).oneMatch.extraKeysVersusList, A(raw).oneMatch.missingKeysVersusList], [null, null]);
  });

  scenario('13 the two no-read answers and the finished list: every reason is true', () => {
    const noPick = baseRaw(); delete noPick.ng_noread_pick; delete noPick.ng_noread;
    eq('no pick, events/live read, next-goal read: the reason names the checked conditions', /no in-play match without a read in events\/live when it was read/.test(A(noPick).noReadInPlay.why), true);
    const noLv = baseRaw(); delete noLv.ng_noread_pick; delete noLv.ng_noread; noLv.live = rec('live', 503, {});
    eq('events/live unreadable', A(noLv).noReadInPlay.why, 'events/live was not read');
    const blockedPick = baseRaw(); blockedPick.ng_noread = { key: 'ng_noread', blocked: 'call budget 9 exhausted', id: 4 };
    eq('a pick the budget then refused', A(blockedPick).noReadInPlay, { verdict: 'UNKNOWN', why: 'call budget 9 exhausted' });
    const odd = baseRaw(); odd.ng_noread = rec('ng_noread', 404, { detail: 'nf' }, { id: 4 });
    eq('a non-200 answer is kept as an answer, nonStandard', [A(odd).noReadInPlay.verdict, A(odd).noReadInPlay.status, A(odd).noReadInPlay.nonStandard, A(odd).noReadInPlay.bodyKeys], ['ANSWERED', 404, true, ['detail']]);
    const html = baseRaw(); html.ng_noread = rec('ng_noread', 502, undefined, { id: 4, nonJson: '<html>bad</html>' });
    eq('...and a non-JSON body', [A(html).noReadInPlay.detail, A(html).noReadInPlay.bodyKeys], ['<html>bad</html>', null]);
    const na = baseRaw(); na.ng_noread = rec('ng_noread', 200, { event: { id: 4 }, available: true, probabilities: {} }, { id: 4 });
    eq('available:true for an event believed to have no read is reported as it is', [A(na).noReadInPlay.available, A(na).noReadInPlay.reason], [true, null]);
    const fl = (mut) => { const r = baseRaw(); delete r.ng_finished_pick; delete r.ng_finished; mut(r); return A(r); };
    eq('no finished list requested (gate closed)', fl((r) => { delete r.finished_list; }).noReadFinished.why, 'not requested: next-goal was not read');
    eq('finished list blocked', fl((r) => { r.finished_list = { key: 'finished_list', blocked: 'run deadline 400 s passed' }; }).noReadFinished.why, 'finished list blocked: run deadline 400 s passed');
    eq('finished list answered 500', fl((r) => { r.finished_list = rec('finished_list', 500, {}); }).noReadFinished.why, 'finished list answered status 500');
    eq('no finished row: the vocabulary seen is named', fl((r) => { r.finished_list = rec('finished_list', 200, page([notStartedRow({ id: 8 }), liveRow({ id: 9 })])); }).noReadFinished.why, "no finished event among 2 rows of yesterday's list (status/period seen: notstarted/(absent), inprogress/2nd_half)");
    eq('the finished-list block when it failed', fl((r) => { r.finished_list = rec('finished_list', 500, {}); }).finishedList, { requested: true, status: 500, blocked: null, error: null });
    eq('the finished-list block when never requested', fl((r) => { delete r.finished_list; }).finishedList, { requested: false });
    const err = baseRaw(); err.finished_list = { key: 'finished_list', error: 'timeout' }; delete err.ng_finished_pick; delete err.ng_finished;
    eq('and when the request itself failed', A(err).finishedList, { requested: true, status: null, blocked: null, error: 'timeout' });
  });

  scenario('14 the rate-limit header measurement is exact', () => {
    const none = A(baseRaw()).rateLimit;
    eq('none seen, over the 18 calls that answered', [none.headersSeenOnCalls, none.values, none.ofCallsWithAResponse], [0, {}, 18]);
    const raw = baseRaw();
    raw.live.headers = { ratelimit: '"football";r=7400;t=100', 'content-type': 'application/json' };
    raw.ng_list.headers = { 'retry-after': '3' };
    raw.calls_hit.headers = { 'x-ratelimit-remaining': '9' };
    const some = A(raw).rateLimit;
    eq('three calls carried them', some.headersSeenOnCalls, 3);
    eq('the values are kept exactly, content-type is not', some.values, { ratelimit: '"football";r=7400;t=100', 'retry-after': '3', 'x-ratelimit-remaining': '9' });
    const blocked = baseRaw(); blocked.ng_one = { key: 'ng_one', blocked: 'x' };
    eq('a call that never answered is not in the denominator', A(blocked).rateLimit.ofCallsWithAResponse, 17);
    const nonrec = baseRaw(); nonrec.junk = 7; nonrec.nope = null;
    eq('non-record entries in raw are ignored', A(nonrec).rateLimit.ofCallsWithAResponse, 18);
  });

  scenario('15 the token can never be written, in any form it could take', () => {
    const t = (body, token) => { try { refuseIfTokenInside(body, token); return false; } catch (_) { return true; } };
    eq('the raw token', t('{"a":"abcd1234efgh"}', 'abcd1234efgh'), true);
    eq('a clean body', t('{"a":"clean"}', 'abcd1234efgh'), false);
    eq('a string under 8 characters is not treated as a token', t('{"a":"short"}', 'short'), false);
    eq('an absent token is not a leak', [t('{"a":"x"}', ''), t('{"a":"x"}', undefined), t('{"a":"x"}', null)], [false, false, false]);
    const odd = 'ab"cd\\12345678';
    eq('the JSON-escaped form of a token with a quote and a backslash', t(JSON.stringify({ e: `Invalid token ${odd}` }), odd), true);
    eq('...and a body without it is clean', t(JSON.stringify({ e: 'Invalid token' }), odd), false);
    eq('the URL-encoded form', t('{"e":"/x?token=ab%2Fcd%2Bef1234"}', 'ab/cd+ef1234'), true);
    eq('a truncated echo (the first 12 characters)', t('{"e":"Invalid token abcdefghijkl..."}', 'abcdefghijklmnopqrstuvwxyz'), true);
    eq('a token of exactly 8 characters is guarded in full', [t('x12345678y', '12345678'), t('x1234567y', '12345678')], [true, false]);
    eq('a body that merely resembles the start of a short token is clean', t('{"e":"abcdefg"}', 'abcdefgh'), false);
  });

  scenario('16 the constants and the small helpers', () => {
    eq('the whole vendor claim, with its provenance', VENDOR_CLAIMS, {
      source: 'https://sports.bzzoiro.com/next-to-score/', read: '2026-11-22 via mcp__Exa__web_search_exa (crawl time unknown)',
      accuracy: 0.736, gradedCalls: 1508, windowDays: 90, accuracyAt80Plus: 0.812, callsAt80Plus: 287, bestFixedGuess: 0.569, matchesCalled: 998, competitions: 64,
    });
    eq('the default base is the vendor host and the token is read from the environment', [fs.readFileSync(SOURCE, 'utf8').includes("process.env.BSD_BASE || 'https://sports.bzzoiro.com'"), fs.readFileSync(SOURCE, 'utf8').includes('process.env.BSD_API_TOKEN')], [true, true]);
    eq('positiveInt: only an integer of 1 or more, else the default', [positiveInt('3', 24), positiveInt('abc', 24), positiveInt('0', 24), positiveInt('-5', 24), positiveInt('2.5', 24), positiveInt('', 24), positiveInt(undefined, 24), positiveInt('1', 24), positiveInt('400', 9)], [3, 24, 24, 24, 24, 24, 24, 1, 400]);
    eq('liveRows: array', liveRows(rec('l', 200, [{ id: 1 }])), { rows: [{ id: 1 }], shape: 'array' });
    eq('liveRows: events', liveRows(rec('l', 200, { events: [{ id: 2 }] })).shape, 'events');
    eq('liveRows: results', liveRows(rec('l', 200, { results: [{ id: 3 }] })).shape, 'results');
    eq('liveRows: unknown object keeps its keys; a non-200 and a missing record have no rows; a bare string is typed', [liveRows(rec('l', 200, { items: [] })), liveRows(rec('l', 500, {})), liveRows(undefined), liveRows(rec('l', 200, 'text')).shape], [{ rows: null, shape: 'object keys: items' }, { rows: null, shape: null }, { rows: null, shape: null }, 'string']);
    eq('ngRows: only a 200 with a results array', [ngRows(rec('n', 200, { results: [1] })), ngRows(rec('n', 200, { results: 5 })), ngRows(rec('n', 403, { results: [1] })), ngRows(undefined), ngRows(rec('n', 200, [1]))], [[1], null, null, null, null]);
    eq('a call the budget refused, a request error, and no record', [gateOf({ key: 'x', blocked: 'call budget 24 exhausted' }), gateOf({ key: 'x', error: 'timeout' }), gateOf(undefined), gateOf({ key: 'x' })], [{ verdict: 'UNKNOWN', why: 'call budget 24 exhausted' }, { verdict: 'UNKNOWN', why: 'request error: timeout' }, { verdict: 'UNKNOWN', why: 'not called' }, { verdict: 'UNKNOWN', why: 'no status' }]);
  });

  scenario('17 the league ids FIELD tracks are read from source', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ngp-'));
    const f = path.join(dir, 'index.js');
    fs.writeFileSync(f, 'x = { bsdLeagueId: 7 }; y = { bsdLeagueId: null }; z = { bsdLeagueId: 18 }; w = { bsdLeagueId:7 }; v = { bsdLeagueId: 12 };');
    eq('ids, multi-digit included, null ignored, duplicates folded', fieldLeagueIdsFromSource(f).sort((a, b) => a - b), [7, 12, 18]);
    fs.writeFileSync(f, 'x = { bsdLeagueId: null };');
    eq('a file with no id is null, not []', fieldLeagueIdsFromSource(f), null);
    eq('a missing file is null', fieldLeagueIdsFromSource('/nonexistent/index.js'), null);
    const real = fieldLeagueIdsFromSource();
    eq('the default path is src/index.js and reads the real ids', [Array.isArray(real), real.includes(7), real.includes(8), real.includes(1)], [true, true, true, true]);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  scenario('18 analyse does not throw on malformed vendor shapes', () => {
    const odd = [null, 5, 'x', { event: null }, { probabilities: [] }, { track_record: 'x' }, { evidence: [] }, { generated_at: 'junk', leader: 7, confidence: 'a' }, { event: { id: null } }];
    const raw = baseRaw();
    raw.ng_list = rec('ng_list', 200, page(odd));
    raw.live = rec('live', 200, { count: 3, events: [null, { id: null }, liveRow({ id: 1 })] });
    let a, threw = null;
    try { a = A(raw); } catch (e) { threw = e.message; }
    eq('no throw', threw, null);
    eq('a line is still produced', typeof a.coverageLine, 'string');
    eq('the shape counts the rows it was given', a.shape.rows, 9);
    const dup = baseRaw(); dup.ng_list = rec('ng_list', 200, { count: 'many', next: null, results: THREE });
    eq('a non-numeric count is not read as a number', A(dup).truncated, { reportedCount: 'many', rowsRead: 3, nextPage: null, partial: false });
    eq('coverageOf on an empty events/live', [coverageOf([], []).liveRows, coverageOf([], []).inPlayAtMinute10Plus], [0, 0]);
  });
}

// ---------------------------------------------------------------- self-test of the check itself
// A check that has only ever passed proves nothing (Rule 90). This one is proven able to fail by
// running ITSELF against a copy of the real probe with one verdict broken, and requiring a red
// exit. The anchor must match exactly once or nothing was broken and a "red" would mean nothing.
function selfTest() {
  const ANCHOR = "s === 402 || s === 403 ? 'GATED'";
  const real = fs.readFileSync(SOURCE, 'utf8');
  const n = real.split(ANCHOR).length - 1;
  if (n !== 1) { console.log(`FAIL  self-test anchor matched ${n} times, not 1`); return 1; }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ngp-self-'));
  const broken = path.join(dir, 'probe-broken.mjs');
  fs.writeFileSync(broken, real.replace(ANCHOR, "s === 402 ? 'GATED'"));
  const r = spawnSync(process.execPath, [fileURLToPath(import.meta.url), '--source', broken], { encoding: 'utf8' });
  const red = r.status === 1 && /FAIL/.test(r.stdout);
  fs.rmSync(dir, { recursive: true, force: true });
  console.log(`${red ? 'ok  ' : 'FAIL'}  self-test: the check goes red (exit ${r.status}) on a probe whose 403 is no longer GATED`);
  return red ? 0 : 1;
}

if (argv.includes('--self-test')) {
  const bad = selfTest();
  console.log(`\n${bad === 0 ? 'OK' : 'FAILED'}: check self-test`);
  finished = true;
  process.exit(bad === 0 ? 0 : 1);
}

run();
console.log(`\nscenarios ${scenarios}, assertions ${assertions}, failed ${failed}   (source: ${SOURCE})`);
if (scenarios < MIN_SCENARIOS) { console.log(`FAIL  only ${scenarios} scenarios ran; MIN_SCENARIOS is ${MIN_SCENARIOS}`); failed++; }
if (assertions < MIN_ASSERTIONS) { console.log(`FAIL  only ${assertions} assertions ran; MIN_ASSERTIONS is ${MIN_ASSERTIONS}`); failed++; }
finished = true;
process.exit(failed === 0 ? 0 : 1);
