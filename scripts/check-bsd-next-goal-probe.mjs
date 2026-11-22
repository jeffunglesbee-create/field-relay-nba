#!/usr/bin/env node
// Rule 90 / Rule 91 for scripts/bsd-next-goal-probe.mjs.
//
// The probe's one job is to turn a vendor's answers into verdicts a person will act on: is the
// endpoint gated, do the ids join, are the filters honoured, does the published 73.6% reproduce.
// A probe that has only ever run against the vendor proves nothing about those verdicts, because
// the vendor's answer on the day is not under our control. This runs `analyse` on SYNTHETIC
// payloads built from the documented shape, one scenario per verdict, and asserts each verdict
// and each denominator. scripts/mutate-bsd-next-goal-probe.mjs then breaks the probe 20 ways and
// requires this to go red on every one.
//
// WHAT THIS DOES NOT COVER: the vendor's real behaviour (that is the probe's run), the network
// layer of main() (budget, 429 stop, the files it writes), and any field the documentation does
// not name. The fixtures are not vendor data and say nothing about the vendor's accuracy.
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
export const MIN_SCENARIOS = 22;
export const MIN_ASSERTIONS = 90;

const argv = process.argv.slice(2);
const srcIdx = argv.indexOf('--source');
const SOURCE = srcIdx >= 0 ? argv[srcIdx + 1] : 'scripts/bsd-next-goal-probe.mjs';

let scenarios = 0, assertions = 0, failed = 0;
const eq = (label, got, want) => {
  assertions++;
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) { failed++; console.log(`FAIL  ${label}\n        got  ${JSON.stringify(got)}\n        want ${JSON.stringify(want)}`); }
};
const scenario = (name, fn) => {
  scenarios++;
  try { fn(); } catch (e) { failed++; console.log(`FAIL  ${name} threw: ${e.message}`); }
};

// ---------------------------------------------------------------- SYNTHETIC fixtures
const NOW = '2026-11-22T14:01:00Z';
const rec = (key, status, json, extra = {}) => ({ key, path: `/${key}`, status, json, at: NOW, headers: {}, ...extra });
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

// ---------------------------------------------------------------- run
const { analyse, gateOf, liveRows, refuseIfTokenInside, fieldLeagueIdsFromSource, VENDOR_CLAIMS } =
  await import(pathToFileURL(path.resolve(SOURCE)).href);
const { ngRow, liveRow, page, cnt, THREE } = await import(pathToFileURL(path.resolve('scripts/fixtures/bsd-next-goal-synthetic.mjs')).href);

function run() {
  scenario('1 a normal slate: every verdict ANSWERED with its denominators', () => {
    const A = analyse(baseRaw(), CTX);
    eq('gate OPEN', [A.gate.verdict, A.gate.status], ['OPEN', 200]);
    eq('ledger gate OPEN', A.gateCalls.verdict, 'OPEN');
    eq('shape rows', [A.shape.verdict, A.shape.rows], ['ANSWERED', 3]);
    eq('ids: same space, 3 matched, 0 name disagreements', [A.idSpace.verdict, A.idSpace.matchedInEventsLive, A.idSpace.nameAgree, A.idSpace.nameDisagree, A.idSpace.partial], ['SAME_ID_SPACE', 3, 3, 0, false]);
    eq('home team ids agree 3 of 3', [A.idSpace.homeTeamIdAgree, A.idSpace.homeTeamIdDisagree], [3, 0]);
    eq('leagues distinct 2', [A.leagues.distinct, A.leagues.byLeague['7'].rows, A.leagues.byLeague['8'].rows], [2, 2, 1]);
    eq('field-tracked rows: league 7 tracked, 8 not', [A.leagues.rowsInFieldTrackedLeagues, A.leagues.rowsOutsideFieldTrackedLeagues], [2, 1]);
    eq('coverage live 5, with read 3, without 2', [A.coverage.liveRows, A.coverage.withRead, A.coverage.withoutRead], [5, 3, 2]);
    eq('coverage minute 10+ without read is 1 (id 4), before 10 is 1 (id 5)', [A.coverage.withoutReadAtMinute10Plus, A.coverage.withoutReadBeforeMinute10], [1, 1]);
    eq('the websocket_plus split of the 10+ gap', A.coverage.withoutReadByWebsocketPlus, { true: 1 });
    eq('calls_only honoured', [A.filterCallsOnly.verdict, A.filterCallsOnly.filteredRows, A.filterCallsOnly.unfilteredCalls], ['HONOURED', 2, 2]);
    eq('league_id honoured with a control of 0 rows', [A.filterLeagueId.verdict, A.filterLeagueId.filteredRows, A.filterLeagueId.controlRows], ['HONOURED', 2, 0]);
    eq('one match available true', [A.oneMatch.verdict, A.oneMatch.available, A.oneMatch.extraKeysVersusList, A.oneMatch.missingKeysVersusList], ['ANSWERED', true, ['available'], []]);
    eq('no read in play: too_early', [A.noReadInPlay.available, A.noReadInPlay.reason], [false, 'too_early']);
    eq('no read finished: not_live', [A.noReadFinished.available, A.noReadFinished.reason], [false, 'not_live']);
    eq('coverage line carries the denominators', A.coverageLine, 'next-goal list: 3 rows (gate OPEN 200) | events/live: 5 events, 1 at minute 10+ without a read | leagues with reads: 2 | ledger: 1500 calls since 2026-08-24, 1 page rows, 5 of 5 outcome counts | calls 18/24');
  });

  scenario('2 a 403 gate is GATED with its code, and everything downstream is UNKNOWN, not false', () => {
    const raw = baseRaw();
    raw.ng_list = rec('ng_list', 403, { code: 'unlimited_required', detail: 'Requires Football API Unlimited' });
    const A = analyse(raw, CTX);
    eq('gate', [A.gate.verdict, A.gate.status, A.gate.code], ['GATED', 403, 'unlimited_required']);
    eq('shape is UNKNOWN naming the gate', [A.shape.verdict, /GATED/.test(A.shape.why)], ['UNKNOWN', true]);
    eq('idSpace UNKNOWN', A.idSpace.verdict, 'UNKNOWN');
    eq('filters UNKNOWN', [A.filterCallsOnly.verdict, A.filterLeagueId.verdict], ['UNKNOWN', 'UNKNOWN']);
    eq('coverage line says no rows and the gate', /next-goal list: no rows \(gate GATED 403\)/.test(A.coverageLine), true);
  });

  scenario('3 402, 401, 404, 429 and 500 each get their own verdict', () => {
    eq('402', gateOf(rec('x', 402, { detail: 'pay' })).verdict, 'GATED');
    eq('401', gateOf(rec('x', 401, {})).verdict, 'TOKEN_REFUSED');
    eq('404', gateOf(rec('x', 404, {})).verdict, 'ABSENT');
    eq('429', gateOf(rec('x', 429, {})).verdict, 'RATE_LIMITED');
    eq('500', gateOf(rec('x', 500, {})).verdict, 'UPSTREAM_ERROR');
    eq('a non-JSON body is kept, trimmed', gateOf(rec('x', 502, undefined, { nonJson: '<html>bad gateway</html>' })).nonJson, '<html>bad gateway</html>');
  });

  scenario('4 an empty slate is UNKNOWN, never ANSWERED with zeros', () => {
    const raw = baseRaw();
    raw.ng_list = rec('ng_list', 200, page([]));
    raw.live = rec('live', 200, { count: 0, events: [] });
    const A = analyse(raw, CTX);
    eq('gate still OPEN', A.gate.verdict, 'OPEN');
    eq('shape UNKNOWN', [A.shape.verdict, /0 rows/.test(A.shape.why)], ['UNKNOWN', true]);
    eq('idSpace UNKNOWN', A.idSpace.verdict, 'UNKNOWN');
    eq('filters UNKNOWN', [A.filterCallsOnly.verdict, A.filterLeagueId.verdict], ['UNKNOWN', 'UNKNOWN']);
  });

  scenario('5 an id that matches with different team names is a COLLISION', () => {
    const raw = baseRaw();
    raw.live = rec('live', 200, { count: 3, events: [liveRow({ id: 1, home: 'Someone Else' }), liveRow({ id: 2 }), liveRow({ id: 3, league: 8 })] });
    const A = analyse(raw, CTX);
    eq('collision', [A.idSpace.verdict, A.idSpace.nameAgree, A.idSpace.nameDisagree], ['ID_COLLISION', 2, 1]);
    eq('the disagreement is shown', A.idSpace.disagreements.length, 1);
    const t = baseRaw();
    t.live = rec('live', 200, { count: 3, events: [liveRow({ id: 1, tid: 999 }), liveRow({ id: 2 }), liveRow({ id: 3, league: 8 })] });
    const T = analyse(t, CTX).idSpace;
    eq('names agree but one home team id differs: recorded, not a collision', [T.verdict, T.homeTeamIdAgree, T.homeTeamIdDisagree], ['SAME_ID_SPACE', 2, 1]);
  });

  scenario('6 ids absent from events/live are NOT_JOINED, and the note says why it cannot tell', () => {
    const raw = baseRaw();
    raw.live = rec('live', 200, { count: 1, events: [liveRow({ id: 99 })] });
    const A = analyse(raw, CTX);
    eq('not joined', [A.idSpace.verdict, A.idSpace.matchedInEventsLive, A.idSpace.partial], ['NOT_JOINED', 0, true]);
    eq('the note exists', typeof A.idSpace.note, 'string');
  });

  scenario('7 calls_only that returns a non-call is NOT_HONOURED', () => {
    const raw = baseRaw();
    raw.ng_calls_only = rec('ng_calls_only', 200, page(THREE));
    eq('verdict', analyse(raw, CTX).filterCallsOnly.verdict, 'NOT_HONOURED');
  });

  scenario('8 calls_only cannot be judged when every unfiltered row is already a call', () => {
    const raw = baseRaw();
    raw.ng_list = rec('ng_list', 200, page([THREE[0], THREE[2]]));
    raw.live = rec('live', 200, { count: 2, events: [liveRow({ id: 1 }), liveRow({ id: 3, league: 8 })] });
    const A = analyse(raw, CTX);
    eq('verdict', A.filterCallsOnly.verdict, 'INDISTINGUISHABLE');
    eq('note', typeof A.filterCallsOnly.note, 'string');
  });

  scenario('9 calls_only returning 0 rows while calls exist is INCONSISTENT', () => {
    const raw = baseRaw();
    raw.ng_calls_only = rec('ng_calls_only', 200, page([]));
    eq('verdict', analyse(raw, CTX).filterCallsOnly.verdict, 'INCONSISTENT');
  });

  scenario('10 league_id: an ignored filter, an emptied filter, and a control that returns rows', () => {
    const ignored = baseRaw();
    ignored.ng_league = rec('ng_league', 200, page(THREE), { leagueUsed: '7' });
    ignored.ng_league_control = rec('ng_league_control', 200, page(THREE), { leagueUsed: 100008 });
    eq('control returns everything: NOT_HONOURED', analyse(ignored, CTX).filterLeagueId.verdict, 'NOT_HONOURED');
    const emptied = baseRaw();
    emptied.ng_league = rec('ng_league', 200, page([]), { leagueUsed: '7' });
    eq('0 rows for a league that has reads', analyse(emptied, CTX).filterLeagueId.verdict, 'EMPTY_FOR_A_LEAGUE_WITH_READS');
    const leaky = baseRaw();
    leaky.ng_league = rec('ng_league', 200, page(THREE), { leagueUsed: '7' });
    eq('rows from another league in the filtered call, control clean: UNKNOWN', analyse(leaky, CTX).filterLeagueId.verdict, 'UNKNOWN');
    const single = baseRaw();
    const only7 = [THREE[0], THREE[1]];
    single.ng_list = rec('ng_list', 200, page(only7));
    single.ng_league = rec('ng_league', 200, page(only7), { leagueUsed: '7' });
    single.ng_league_control = rec('ng_league_control', 200, page(only7), { leagueUsed: 100008 });
    eq('a one-league slate with the filter ignored: every row is in league 7, only the control shows it', analyse(single, CTX).filterLeagueId.verdict, 'NOT_HONOURED');
  });

  scenario('11 probabilities: a two-way row sums, a bad row is counted, no_goal null is counted', () => {
    const raw = baseRaw();
    raw.ng_list = rec('ng_list', 200, page([
      ngRow({ id: 1, probs: { home: 0.4, away: 0.6, no_goal: null }, leader: 'away', conf: 0.6 }),
      ngRow({ id: 2, probs: { home: 0.3, away: 0.3, no_goal: 0.1 }, leader: 'home', conf: 0.3, call: false }),
      ngRow({ id: 3, league: 8 }),
    ]));
    const S = analyse(raw, CTX).shape;
    eq('sums', S.probabilitiesSumToOne, { ok: 2, notOk: 1, tolerance: 0.011 });
    eq('no_goal null', S.noGoalNull, 1);
  });

  scenario('12 is_call against call_threshold, and confidence against the leader probability', () => {
    const raw = baseRaw();
    raw.ng_list = rec('ng_list', 200, page([
      ngRow({ id: 1, conf: 0.55, th: 0.6, call: true, probs: { home: 0.2, away: 0.55, no_goal: 0.25 } }),
      ngRow({ id: 2, conf: 0.6, th: 0.6, call: true, probs: { home: 0.2, away: 0.6, no_goal: 0.2 } }),
      ngRow({ id: 3, conf: 0.5, th: 0.6, call: false, probs: { home: 0.25, away: 0.5, no_goal: 0.25 } }),
      ngRow({ id: 4, conf: 0.9, th: 0.6, call: true, probs: { home: 0.1, away: 0.6, no_goal: 0.3 } }),
    ]));
    const S = analyse(raw, CTX).shape;
    eq('is_call vs threshold: 1 disagrees (0.55 flagged), 3 agree (0.6 flagged counts as >=)', S.isCallMatchesThreshold, { agree: 3, disagree: 1, unknown: 0 });
    eq('confidence equals the leader probability on 3 of 4', S.confidenceEqualsLeaderProbability, { equal: 3, notEqual: 1, unknown: 0 });
    eq('threshold values', S.callThresholdValues, { '0.6': 4 });
  });

  scenario('13 the ledger reproduction: four denominators, and which is closest to 73.6%', () => {
    const A = analyse(baseRaw(), CTX);
    const R = A.ledger.reproduction;
    eq('verdict', R.verdict, 'ANSWERED');
    eq('sum of five outcomes is 1500 and equals countSince', [R.sumOfFiveOutcomes, R.sumEqualsCountSince], [1500, true]);
    eq('hit over hit+miss', R.definitions.hit_over_hit_miss, { hits: 1100, denominator: 1480, accuracy: 0.7432, deltaVersusVendorAccuracy: 0.0072, deltaVersusVendorGradedCalls: -28 });
    eq('hit over hit+miss+nogoal', [R.definitions.hit_over_hit_miss_nogoal.denominator, R.definitions.hit_over_hit_miss_nogoal.accuracy], [1488, 0.7392]);
    eq('hit over +unclear', R.definitions.hit_over_hit_miss_nogoal_unclear.denominator, 1490);
    eq('hit over all calls since', [R.definitions.hit_over_all_calls_since.denominator, R.definitions.hit_over_all_calls_since.accuracy], [1500, 0.7333]);
    eq('the closest definition is named (1100/1490 = 0.7383 is 0.0023 from 0.736; 1100/1500 is 0.0027)', R.closestToVendorAccuracy, 'hit_over_hit_miss_nogoal_unclear');
    eq('the vendor claim travels with its provenance', [R.vendorClaim.accuracy, R.vendorClaim.gradedCalls, typeof R.vendorClaim.read], [0.736, 1508, 'string']);
    eq('a counts mismatch is reported, not hidden', (() => { const raw = baseRaw(); raw.calls_open = rec('calls_open', 200, cnt(50)); return analyse(raw, CTX).ledger.reproduction.sumEqualsCountSince; })(), false);
  });

  scenario('14 the ledger gated independently of the list', () => {
    const raw = baseRaw();
    raw.calls_since = rec('calls_since', 403, { code: 'unlimited_required' });
    for (const k of ['calls_page', 'calls_hit', 'calls_miss', 'calls_nogoal', 'calls_unclear', 'calls_open', 'calls_all', 'calls_last_offset']) delete raw[k];
    const A = analyse(raw, CTX);
    eq('list OPEN, ledger GATED', [A.gate.verdict, A.gateCalls.verdict], ['OPEN', 'GATED']);
    eq('reproduction UNKNOWN', A.ledger.reproduction.verdict, 'UNKNOWN');
    eq('one missing outcome count is UNKNOWN, not zero', (() => { const r = baseRaw(); delete r.calls_miss; return analyse(r, CTX).ledger.reproduction.verdict; })(), 'UNKNOWN');
  });

  scenario('15 events/live comes in three shapes and one unknown', () => {
    eq('array', liveRows(rec('l', 200, [{ id: 1 }])), { rows: [{ id: 1 }], shape: 'array' });
    eq('events', liveRows(rec('l', 200, { events: [{ id: 2 }] })).shape, 'events');
    eq('results', liveRows(rec('l', 200, { results: [{ id: 3 }] })).shape, 'results');
    eq('unknown object keeps its keys', liveRows(rec('l', 200, { items: [] })), { rows: null, shape: 'object keys: items' });
    eq('a non-200 has no rows', liveRows(rec('l', 500, {})), { rows: null, shape: null });
  });

  scenario('16 a call the budget refused is UNKNOWN with the reason, never a verdict', () => {
    eq('blocked', gateOf({ key: 'x', blocked: 'call budget 24 exhausted' }), { verdict: 'UNKNOWN', why: 'call budget 24 exhausted' });
    eq('request error', gateOf({ key: 'x', error: 'timeout' }), { verdict: 'UNKNOWN', why: 'request error: timeout' });
    eq('not called', gateOf(undefined), { verdict: 'UNKNOWN', why: 'not called' });
  });

  scenario('17 rate-limit headers are counted over calls that answered, and absence is a number', () => {
    const none = analyse(baseRaw(), CTX).rateLimit;
    eq('none seen', [none.headersSeenOnCalls, none.values], [0, {}]);
    const raw = baseRaw();
    raw.live.headers = { 'ratelimit': '"football";r=7400;t=100', 'content-type': 'application/json' };
    raw.ng_list.headers = { 'retry-after': '3' };
    const some = analyse(raw, CTX).rateLimit;
    eq('two calls carried them', some.headersSeenOnCalls, 2);
    eq('values kept, content-type not', Object.keys(some.values).sort(), ['ratelimit', 'retry-after']);
    eq('the denominator is calls that answered', some.ofCallsWithAResponse > 10, true);
  });

  scenario('18 the token can never be written', () => {
    let threw = false;
    try { refuseIfTokenInside('{"a":"abcd1234efgh"}', 'abcd1234efgh'); } catch (_) { threw = true; }
    eq('refuses a body containing the token', threw, true);
    threw = false;
    try { refuseIfTokenInside('{"a":"clean"}', 'abcd1234efgh'); } catch (_) { threw = true; }
    eq('allows a clean body', threw, false);
    threw = false;
    try { refuseIfTokenInside('{"a":"short"}', 'short'); } catch (_) { threw = true; }
    eq('a string under 8 characters is not treated as a token', threw, false);
    threw = false;
    try { refuseIfTokenInside('{"a":"x"}', ''); } catch (_) { threw = true; }
    eq('an absent token is not a leak', threw, false);
  });

  scenario('19 the minute-10 boundary of coverage', () => {
    const raw = baseRaw();
    raw.live = rec('live', 200, { count: 4, events: [liveRow({ id: 1 }), liveRow({ id: 4, minute: 10 }), liveRow({ id: 5, minute: 9 }), liveRow({ id: 6, minute: 11, wsp: true })] });
    const C = analyse(raw, CTX).coverage;
    eq('10 counts, 9 does not', [C.withoutReadAtMinute10Plus, C.withoutReadBeforeMinute10], [2, 1]);
    eq('the unmatched ng rows do not inflate live', C.liveRows, 4);
  });

  scenario('20 the accuracy scale the API serves, and the age of a read', () => {
    const frac = analyse(baseRaw(), CTX).shape;
    eq('fraction', frac.trackRecordAccuracyScale, 'fraction (<=1)');
    eq('age 5 seconds', frac.generatedAtAgeSeconds, { min: 5, max: 5, n: 3 });
    const raw = baseRaw();
    raw.ng_list = rec('ng_list', 200, page([ngRow({ id: 1, tr: { accuracy: 77.3, matches_evaluated: 8394 } })]));
    eq('percent', analyse(raw, CTX).shape.trackRecordAccuracyScale, 'percent (>1)');
    eq('distinct track records are counted', analyse(baseRaw(), CTX).shape.trackRecordDistinct, 1);
    eq('momentum range is read, not assumed', analyse(baseRaw(), CTX).shape.momentum5m, { min: -14.2, max: -14.2, n: 3 });
    eq('field counts see every row', analyse(baseRaw(), CTX).shape.fieldCounts['evidence.momentum_5m'], 3);
  });

  scenario('21 the league ids FIELD tracks are read from source, nulls ignored', () => {
    const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ngp-')), 'index.js');
    fs.writeFileSync(f, "x = { bsdLeagueId: 7 }; y = { bsdLeagueId: null }; z = { bsdLeagueId: 8 }; w = { bsdLeagueId: 7 };");
    eq('ids', fieldLeagueIdsFromSource(f).sort(), [7, 8]);
    eq('missing file is null, not []', fieldLeagueIdsFromSource('/nonexistent/index.js'), null);
    eq('the shipped vendor claim has its source', VENDOR_CLAIMS.source, 'https://sports.bzzoiro.com/next-to-score/');
  });

  scenario('22 the ledger order is read from two dates, not assumed', () => {
    const A = analyse(baseRaw(), CTX);
    eq('newest first', [A.ledger.ledgerOrder, A.ledger.lastOffsetRowDateLike, A.ledger.pageFirstRowDateLike], ['newest-first', '2026-01-05T10:00:00Z', '2026-11-21T19:00:00Z']);
    const raw = baseRaw();
    raw.calls_last_offset = rec('calls_last_offset', 200, page([{ event_id: 7, resolved_at: '2026-12-30T00:00:00Z' }]));
    eq('oldest first', analyse(raw, CTX).ledger.ledgerOrder, 'oldest-first');
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
  console.log(`${red ? 'ok  ' : 'FAIL'}  self-test: the check goes red (exit ${r.status}) on a probe whose 403 is no longer GATED`);
  return red ? 0 : 1;
}

if (argv.includes('--self-test')) {
  const bad = selfTest();
  console.log(`\n${bad === 0 ? 'OK' : 'FAILED'}: check self-test`);
  process.exit(bad === 0 ? 0 : 1);
}

run();
console.log(`\nscenarios ${scenarios}, assertions ${assertions}, failed ${failed}   (source: ${SOURCE})`);
if (scenarios < MIN_SCENARIOS) { console.log(`FAIL  only ${scenarios} scenarios ran; MIN_SCENARIOS is ${MIN_SCENARIOS}`); failed++; }
if (assertions < MIN_ASSERTIONS) { console.log(`FAIL  only ${assertions} assertions ran; MIN_ASSERTIONS is ${MIN_ASSERTIONS}`); failed++; }
process.exit(failed === 0 ? 0 : 1);
