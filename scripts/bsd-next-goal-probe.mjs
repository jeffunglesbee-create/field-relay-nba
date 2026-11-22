#!/usr/bin/env node
// Measure BSD's "Next to Score" API before anything is built on it.
//
// WHY THIS EXISTS. The vendor's 2026-11 newsletter (utm_campaign=next_goal_api) announces
// GET /api/v2/next-goal/, /next-goal/{event_id}/ and /next-goal/calls/. Rule 72 makes that a
// hypothesis, and no file in any of the four repos mentions the endpoint. Eleven premises
// stand between that page and any use of it (docs/CC-CMD-2026-11-22-bsd-next-goal-probe.md).
// This run answers the ones one authenticated GET can answer, on a live slate, and commits
// one artifact. Nothing is built from it and nothing under src/ is touched.
//
// UPSTREAM, with the token, like bsd-newsletter-claims.mjs: these are questions about what the
// vendor publishes, and the relay has no route for the endpoint. The container proxy blocks the
// vendor host, so this runs on a GitHub runner.
//
// DISCOVERY, NEVER ASSERTION. A 403 is a finding. A call that was not made, or was refused by
// the budget, is UNKNOWN, never false (Rule 99). The exit code is 0 unless the probe itself
// breaks, so a red run means the probe broke, not that the vendor answered unwelcomely (Rule 77).
//
// WHAT IT ASKS (premise -> the one call that refutes it):
//   gate        does this token read next-goal at all?              GET /next-goal/?limit=200
//   id space    is event.id the id events/live and the relay use?   same call + GET /events/live/
//   coverage    which leagues get a read, and which in-play matches don't?  the same two
//   filters     are league_id and calls_only honoured?              a control call per filter
//   one match   what does /{id}/ say, and what is `available:false`?  three calls
//   ledger      is /calls/ readable, how deep, and does the vendor's published 73.6% of 1,508
//               reproduce from its own counts?                      eight calls of limit 1
//
// SAMPLE-COVERAGE-A (Rule 91): the coverage line is built from the measured denominators and is
// printed beside every verdict. A verdict whose denominator is 0 says so.
//
// Budget (Rule 78): CALL_BUDGET (default 24) is enforced here, a 429 or 401 stops the run, and
// the 18 calls this normally makes are one slate's worth, not a poll.
//
// Usage: BSD_API_TOKEN=... node scripts/bsd-next-goal-probe.mjs
// Rule 90: scripts/check-bsd-next-goal-probe.mjs runs `analyse` on fixtures; the mutation script
// breaks it on purpose.

import fs from 'node:fs';
import { pathToFileURL } from 'node:url';

export const VENDOR_CLAIMS = {
  // Rule 73: where, when, how. Read by a search-engine crawl of unknown crawl time, not by a
  // request to the origin, so a figure here may be older than the run that compares against it.
  source: 'https://sports.bzzoiro.com/next-to-score/',
  read: '2026-11-22 via mcp__Exa__web_search_exa (crawl time unknown)',
  accuracy: 0.736,
  gradedCalls: 1508,
  windowDays: 90,
  accuracyAt80Plus: 0.812,
  callsAt80Plus: 287,
  bestFixedGuess: 0.569,
  matchesCalled: 998,
  competitions: 64,
};

// The token must never reach a committed file. Exported so the check can prove it refuses; main()
// calls it on the exact bytes about to be written. A token shorter than 8 characters is not a token.
export function refuseIfTokenInside(body, token) {
  if (typeof token === 'string' && token.length >= 8 && body.includes(token)) {
    throw new Error('the artifact contains the token; refusing to write it');
  }
}

// ---------------------------------------------------------------- small helpers
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const str = (v, n = 200) => (typeof v === 'string' ? v.slice(0, n) : null);
const norm = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
const tally = (arr, f = (x) => x) => {
  const o = {};
  for (const x of arr) { const k = String(f(x)); o[k] = (o[k] || 0) + 1; }
  return o;
};
const minmax = (arr) => {
  const n = arr.map(num).filter((v) => v !== null);
  return n.length ? { min: Math.min(...n), max: Math.max(...n), n: n.length } : null;
};
const unknown = (why) => ({ verdict: 'UNKNOWN', why });

// Every field path at any depth, from EVERY row (a field present on some rows only is a finding).
function fieldCounts(rows, depthLimit = 5) {
  const acc = {};
  const walk = (v, prefix, depth) => {
    if (depth > depthLimit || v === null || typeof v !== 'object') return;
    if (Array.isArray(v)) { if (v.length) walk(v[0], `${prefix}[]`, depth + 1); return; }
    for (const [k, val] of Object.entries(v)) {
      const p = prefix ? `${prefix}.${k}` : k;
      acc[p] = (acc[p] || 0) + 1;
      walk(val, p, depth + 1);
    }
  };
  for (const r of rows) walk(r, '', 0);
  return acc;
}

// ---------------------------------------------------------------- extraction from a call record
export function ngRows(rec) {
  return rec && rec.status === 200 && isObj(rec.json) && Array.isArray(rec.json.results) ? rec.json.results : null;
}
export function liveRows(rec) {
  if (!rec || rec.status !== 200 || rec.json == null) return { rows: null, shape: null };
  const j = rec.json;
  if (Array.isArray(j)) return { rows: j, shape: 'array' };
  if (isObj(j) && Array.isArray(j.events)) return { rows: j.events, shape: 'events' };
  if (isObj(j) && Array.isArray(j.results)) return { rows: j.results, shape: 'results' };
  return { rows: null, shape: isObj(j) ? `object keys: ${Object.keys(j).slice(0, 8).join(',')}` : typeof j };
}

// ---------------------------------------------------------------- the gate
export function gateOf(rec) {
  if (!rec) return { verdict: 'UNKNOWN', why: 'not called' };
  if (rec.blocked) return { verdict: 'UNKNOWN', why: rec.blocked };
  if (rec.error) return { verdict: 'UNKNOWN', why: `request error: ${rec.error}` };
  const s = rec.status;
  const body = isObj(rec.json) ? rec.json : null;
  const verdict = s === 200 ? 'OPEN'
    : s === 401 ? 'TOKEN_REFUSED'
    : s === 402 || s === 403 ? 'GATED'
    : s === 404 ? 'ABSENT'
    : s === 429 ? 'RATE_LIMITED'
    : s >= 500 ? 'UPSTREAM_ERROR' : 'UNKNOWN';
  const out = { status: s, verdict, bodyKeys: body ? Object.keys(body).slice(0, 12) : null };
  if (s !== 200) {
    out.code = str(body?.code ?? body?.error?.code);
    out.detail = str(body?.detail ?? body?.message ?? body?.error?.message ?? body?.error);
    if (rec.nonJson) out.nonJson = str(rec.nonJson, 120);
  }
  return out;
}

// ---------------------------------------------------------------- shape of the reads
export function shapeOf(rows, nowMs) {
  const ev = rows.map((r) => (isObj(r?.event) ? r.event : {}));
  const probs = rows.map((r) => (isObj(r?.probabilities) ? r.probabilities : {}));
  let sumBad = 0, sumOk = 0, noGoalNull = 0, confEqLeader = 0, confNotEq = 0, confUnknown = 0;
  let callAgree = 0, callDisagree = 0, callUnknown = 0;
  rows.forEach((r, i) => {
    const p = probs[i];
    const h = num(p.home), a = num(p.away), g = num(p.no_goal);
    if (h === null || a === null) { sumBad++; } else {
      const total = h + a + (g === null ? 0 : g);
      if (Math.abs(total - 1) <= 0.011) sumOk++; else sumBad++;
    }
    if (p.no_goal === null) noGoalNull++;
    const lp = typeof r?.leader === 'string' ? num(p[r.leader]) : null;
    const conf = num(r?.confidence);
    if (lp === null || conf === null) confUnknown++;
    else if (Math.abs(conf - lp) <= 0.0101) confEqLeader++; else confNotEq++;
    const th = num(r?.call_threshold);
    if (conf === null || th === null || typeof r?.is_call !== 'boolean') callUnknown++;
    else if (r.is_call === (conf >= th)) callAgree++; else callDisagree++;
  });
  const gen = rows.map((r) => Date.parse(r?.generated_at)).filter((v) => Number.isFinite(v));
  const ageSec = nowMs && gen.length ? minmax(gen.map((t) => (nowMs - t) / 1000)) : null;
  const tr = rows.map((r) => (isObj(r?.track_record) ? JSON.stringify(r.track_record) : null)).filter(Boolean);
  const trDistinct = [...new Set(tr)];
  const acc = trDistinct.map((s) => num(JSON.parse(s).accuracy)).filter((v) => v !== null);
  return {
    rows: rows.length,
    fieldCounts: fieldCounts(rows),
    eventStatus: tally(ev, (e) => e.status ?? '(absent)'),
    leader: tally(rows, (r) => r?.leader ?? '(absent)'),
    probabilitiesSumToOne: { ok: sumOk, notOk: sumBad, tolerance: 0.011 },
    noGoalNull,
    confidenceEqualsLeaderProbability: { equal: confEqLeader, notEqual: confNotEq, unknown: confUnknown },
    isCallMatchesThreshold: { agree: callAgree, disagree: callDisagree, unknown: callUnknown },
    callThresholdValues: tally(rows, (r) => r?.call_threshold ?? '(absent)'),
    isCall: tally(rows, (r) => r?.is_call ?? '(absent)'),
    callPaused: tally(rows, (r) => r?.call_paused ?? '(absent)'),
    minute: minmax(rows.map((r) => r?.minute)),
    minutesSinceGoal: minmax(rows.map((r) => r?.minutes_since_goal)),
    minutesSinceGoalNull: rows.filter((r) => r?.minutes_since_goal === null).length,
    momentum5m: minmax(rows.map((r) => r?.evidence?.momentum_5m)),
    momentum15m: minmax(rows.map((r) => r?.evidence?.momentum_15m)),
    shotsHome10m: minmax(rows.map((r) => r?.evidence?.shots_home_10m)),
    shotsAway10m: minmax(rows.map((r) => r?.evidence?.shots_away_10m)),
    evidenceKeys: Object.keys(fieldCounts(rows.map((r) => r?.evidence || {}))).sort(),
    trackRecordDistinct: trDistinct.length,
    trackRecordFirst: trDistinct[0] ? JSON.parse(trDistinct[0]) : null,
    // The page shows accuracy 0.72 in one example and 77.3 in another; record which the API serves.
    trackRecordAccuracyScale: acc.length ? (acc.every((v) => v <= 1) ? 'fraction (<=1)' : acc.every((v) => v > 1) ? 'percent (>1)' : 'mixed') : null,
    generatedAtAgeSeconds: ageSec,
  };
}

// ---------------------------------------------------------------- the whole analysis
export function analyse(raw, ctx = {}) {
  const A = {};
  const nowMs = Date.parse(raw.ng_list?.at) || null;

  A.gate = gateOf(raw.ng_list);
  A.gateCalls = gateOf(raw.calls_since);
  A.gateLive = gateOf(raw.live);

  // Rate-limit headers across every call: the vendor says free accounts get them and paid ones don't.
  const rl = {};
  let rlCalls = 0, responded = 0;
  for (const rec of Object.values(raw)) {
    if (!isObj(rec) || rec.status == null) continue;
    responded++;
    const seen = Object.entries(rec.headers || {}).filter(([k]) => /ratelimit|retry-after/i.test(k));
    if (seen.length) { rlCalls++; for (const [k, v] of seen) rl[k] = v; }
  }
  A.rateLimit = { headersSeenOnCalls: rlCalls, ofCallsWithAResponse: responded, values: rl };

  const ng = ngRows(raw.ng_list);
  const { rows: lv, shape: liveShape } = liveRows(raw.live);
  A.live = { shape: liveShape, rows: lv ? lv.length : null, count: raw.live?.json?.count ?? null,
    status: lv ? tally(lv, (r) => r?.status ?? '(absent)') : null,
    websocketPlus: lv ? tally(lv, (r) => r?.websocket_plus ?? '(absent)') : null };

  // ---- shape and id space
  if (ng === null) {
    A.shape = unknown(A.gate.verdict === 'OPEN' ? 'next-goal returned 200 without a results array' : `next-goal gate is ${A.gate.verdict}`);
    A.idSpace = unknown('no next-goal rows to compare');
    A.leagues = unknown('no next-goal rows');
    A.coverage = unknown('no next-goal rows');
  } else if (ng.length === 0) {
    A.shape = unknown('next-goal answered 200 with 0 rows (no live slate, or no reads yet); shape not observed');
    A.idSpace = unknown('0 next-goal rows, nothing to compare');
    A.leagues = unknown('0 rows');
    A.coverage = { verdict: 'UNKNOWN', why: '0 next-goal rows', liveRows: lv ? lv.length : null };
  } else {
    A.shape = Object.assign({ verdict: 'ANSWERED' }, shapeOf(ng, nowMs));
    A.truncated = { reportedCount: raw.ng_list.json.count ?? null, rowsRead: ng.length, nextPage: raw.ng_list.json.next ?? null };

    // id space: an id match alone could be a coincidence of two integer spaces, so names must agree too.
    if (lv === null) A.idSpace = unknown('events/live was not read');
    else {
      const liveById = new Map(lv.map((r) => [String(r?.id), r]));
      let matched = 0, agree = 0, disagree = 0, teamIdAgree = 0, teamIdDisagree = 0;
      const disagreements = [];
      for (const r of ng) {
        const e = r?.event || {};
        const l = liveById.get(String(e.id));
        if (!l) continue;
        matched++;
        const same = norm(l.home_team) === norm(e.home_team) && norm(l.away_team) === norm(e.away_team);
        if (same) agree++; else { disagree++; if (disagreements.length < 3) disagreements.push({ id: e.id, nextGoal: [e.home_team, e.away_team], live: [l.home_team, l.away_team] }); }
        if (l.home_team_id != null && e.home_team_id != null) {
          if (String(l.home_team_id) === String(e.home_team_id)) teamIdAgree++; else teamIdDisagree++;
        }
      }
      A.idSpace = {
        verdict: matched === 0 ? 'NOT_JOINED' : disagree > 0 ? 'ID_COLLISION' : 'SAME_ID_SPACE',
        nextGoalRows: ng.length, matchedInEventsLive: matched, nameAgree: agree, nameDisagree: disagree,
        homeTeamIdAgree: teamIdAgree, homeTeamIdDisagree: teamIdDisagree,
        partial: matched < ng.length,
        note: matched === 0 ? 'no next-goal id appears in events/live: a different id space, OR events/live does not list these matches; not distinguished by this run' : undefined,
        disagreements,
      };
    }

    // leagues, and which FIELD already tracks (ids read from src/index.js by the caller)
    const byLeague = {};
    for (const r of ng) {
      const e = r?.event || {};
      const k = String(e.league_id ?? '(absent)');
      byLeague[k] = byLeague[k] || { league_name: e.league_name ?? null, rows: 0 };
      byLeague[k].rows++;
    }
    const tracked = Array.isArray(ctx.fieldLeagueIds) ? new Set(ctx.fieldLeagueIds.map(String)) : null;
    A.leagues = {
      verdict: 'ANSWERED', distinct: Object.keys(byLeague).length, byLeague,
      fieldTrackedLeagueIds: tracked ? [...tracked].sort((a, b) => a - b) : null,
      rowsInFieldTrackedLeagues: tracked ? ng.filter((r) => tracked.has(String(r?.event?.league_id))).length : null,
      rowsOutsideFieldTrackedLeagues: tracked ? ng.filter((r) => !tracked.has(String(r?.event?.league_id))).length : null,
    };

    // coverage: in-play matches with and without a read. A read starts "from around minute 10".
    if (lv === null) A.coverage = unknown('events/live was not read');
    else {
      const readIds = new Set(ng.map((r) => String(r?.event?.id)));
      const noRead = lv.filter((r) => !readIds.has(String(r?.id)));
      const atTen = (r) => (num(r?.current_minute) ?? -1) >= 10;
      A.coverage = {
        verdict: 'ANSWERED',
        liveRows: lv.length, withRead: lv.length - noRead.length,
        withoutRead: noRead.length,
        withoutReadAtMinute10Plus: noRead.filter(atTen).length,
        withoutReadBeforeMinute10: noRead.filter((r) => !atTen(r)).length,
        withoutReadByWebsocketPlus: tally(noRead.filter(atTen), (r) => r?.websocket_plus ?? '(absent)'),
        withoutReadAt10PlusByLeague: tally(noRead.filter(atTen), (r) => `${r?.league_id ?? '?'}:${r?.league_name ?? ''}`),
        withReadByWebsocketPlus: tally(lv.filter((r) => readIds.has(String(r?.id))), (r) => r?.websocket_plus ?? '(absent)'),
      };
    }
  }

  // ---- filters, each with a control that an ignored filter could not pass
  if (ng === null || ng.length === 0) {
    A.filterCallsOnly = unknown('no next-goal rows in the unfiltered call');
    A.filterLeagueId = unknown('no next-goal rows in the unfiltered call');
  } else {
    const co = ngRows(raw.ng_calls_only);
    if (co === null) A.filterCallsOnly = unknown(raw.ng_calls_only?.blocked || `calls_only call status ${raw.ng_calls_only?.status ?? 'none'}`);
    else {
      const listHadNonCalls = ng.some((r) => r?.is_call !== true);
      const unfilteredCalls = ng.filter((r) => r?.is_call === true).length;
      const allCalls = co.every((r) => r?.is_call === true);
      A.filterCallsOnly = {
        verdict: !allCalls ? 'NOT_HONOURED'
          : co.length === 0 && unfilteredCalls > 0 ? 'INCONSISTENT'
          : listHadNonCalls ? 'HONOURED' : 'INDISTINGUISHABLE',
        unfilteredRows: ng.length, unfilteredCalls, filteredRows: co.length, allFilteredAreCalls: allCalls, unfilteredHadNonCalls: listHadNonCalls,
        note: !listHadNonCalls ? 'every unfiltered row was already a call, so an ignored filter would look identical' : undefined,
      };
    }
    const lg = ngRows(raw.ng_league), ctl = ngRows(raw.ng_league_control);
    if (lg === null || ctl === null) A.filterLeagueId = unknown(raw.ng_league?.blocked || raw.ng_league_control?.blocked || 'league_id call not answered with 200');
    else {
      const L = String(ctx.leagueUsed ?? raw.ng_league?.leagueUsed ?? '');
      const allL = lg.every((r) => String(r?.event?.league_id) === L);
      A.filterLeagueId = {
        verdict: lg.length === 0 ? 'EMPTY_FOR_A_LEAGUE_WITH_READS'
          : allL && ctl.length === 0 ? 'HONOURED'
          : ctl.length >= ng.length ? 'NOT_HONOURED' : 'UNKNOWN',
        leagueUsed: L, filteredRows: lg.length, allFilteredInThatLeague: allL,
        controlLeagueId: raw.ng_league_control?.leagueUsed ?? null, controlRows: ctl.length, unfilteredRows: ng.length,
      };
    }
  }

  // ---- one match, and the two kinds of no-read
  const one = raw.ng_one;
  if (!one || one.status !== 200 || !isObj(one.json)) A.oneMatch = unknown(one?.blocked || `status ${one?.status ?? 'none'}`);
  else {
    const listRow = ng && ng.find((r) => String(r?.event?.id) === String(one.id));
    const lk = listRow ? Object.keys(listRow) : null;
    const ok = Object.keys(one.json);
    A.oneMatch = {
      verdict: 'ANSWERED', id: one.id, available: one.json.available ?? '(absent)',
      keys: ok, extraKeysVersusList: lk ? ok.filter((k) => !lk.includes(k)) : null,
      missingKeysVersusList: lk ? lk.filter((k) => !ok.includes(k)) : null,
    };
  }
  const reasonOf = (rec) => {
    if (!rec) return unknown('not called');
    if (rec.blocked) return unknown(rec.blocked);
    if (rec.status !== 200 || !isObj(rec.json)) return { verdict: 'ANSWERED', status: rec.status, nonStandard: true, bodyKeys: isObj(rec.json) ? Object.keys(rec.json) : null, detail: str(rec.nonJson, 120) };
    return { verdict: 'ANSWERED', status: 200, id: rec.id, eventStatus: rec.eventStatus ?? null, available: rec.json.available ?? '(absent)', reason: rec.json.reason ?? null };
  };
  A.noReadInPlay = raw.ng_noread_pick ? reasonOf(raw.ng_noread) : unknown('every in-play event in events/live already had a read');
  A.noReadFinished = raw.ng_finished_pick ? reasonOf(raw.ng_finished) : unknown('no finished event found by pattern in yesterday\'s list');

  // ---- the ledger
  const pageRows = ngRows(raw.calls_page);
  const cnt = (rec) => (rec && rec.status === 200 && isObj(rec.json) && num(rec.json.count) !== null ? rec.json.count : null);
  const L = {
    gate: A.gateCalls,
    countSince: cnt(raw.calls_since), since: ctx.d90 ?? null,
    outcomes: { hit: cnt(raw.calls_hit), miss: cnt(raw.calls_miss), nogoal: cnt(raw.calls_nogoal), unclear: cnt(raw.calls_unclear), open: cnt(raw.calls_open) },
    countAllTime: cnt(raw.calls_all),
  };
  if (pageRows && pageRows.length) {
    const fc = fieldCounts(pageRows);
    const dateLike = [];
    const scan = (v) => { if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v)) dateLike.push(v); else if (isObj(v)) Object.values(v).forEach(scan); };
    pageRows.forEach(scan);
    L.page = {
      rows: pageRows.length, fieldCounts: fc,
      outcome: tally(pageRows, (r) => r?.outcome ?? '(absent)'), side: tally(pageRows, (r) => r?.side ?? '(absent)'),
      probability: minmax(pageRows.map((r) => r?.probability)), minute: minmax(pageRows.map((r) => r?.minute)),
      dateLikeValuesSeen: dateLike.length, newestDateLike: dateLike.length ? dateLike.slice().sort().slice(-1)[0] : null,
      oldestDateLikeOnPage: dateLike.length ? dateLike.slice().sort()[0] : null,
    };
  }
  // The row at the LAST offset: the oldest if the ledger is newest-first, the newest if it is not.
  // The order is not assumed; it is read from the two dates.
  const dateLikes = (row) => {
    const d = [];
    const scan = (v) => { if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v)) d.push(v); else if (isObj(v)) Object.values(v).forEach(scan); };
    scan(row);
    return d.sort();
  };
  const last = ngRows(raw.calls_last_offset);
  if (last && last.length) {
    const ld = dateLikes(last[0]);
    L.lastOffsetRowDateLike = ld.length ? ld[0] : null;
    L.lastOffsetRowKeys = Object.keys(last[0] || {});
    const pd = pageRows && pageRows.length ? dateLikes(pageRows[0]) : [];
    L.pageFirstRowDateLike = pd.length ? pd[0] : null;
    L.ledgerOrder = L.lastOffsetRowDateLike && L.pageFirstRowDateLike
      ? (L.lastOffsetRowDateLike < L.pageFirstRowDateLike ? 'newest-first' : L.lastOffsetRowDateLike > L.pageFirstRowDateLike ? 'oldest-first' : 'same-date') : 'unknown';
  }
  // accuracy under each denominator the vendor's wording could mean, from the exact counts
  const o = L.outcomes;
  const all5 = Object.values(o).every((v) => v !== null);
  if (L.countSince === null || !all5) L.reproduction = unknown('one or more count calls did not return a count');
  else {
    const D = {
      hit_over_hit_miss: [o.hit, o.hit + o.miss],
      hit_over_hit_miss_nogoal: [o.hit, o.hit + o.miss + o.nogoal],
      hit_over_hit_miss_nogoal_unclear: [o.hit, o.hit + o.miss + o.nogoal + o.unclear],
      hit_over_all_calls_since: [o.hit, L.countSince],
    };
    const claim = ctx.vendorClaims || VENDOR_CLAIMS;
    const defs = {};
    for (const [k, [n, d]] of Object.entries(D)) {
      defs[k] = { hits: n, denominator: d, accuracy: d > 0 ? Math.round((n / d) * 10000) / 10000 : null,
        deltaVersusVendorAccuracy: d > 0 ? Math.round((n / d - claim.accuracy) * 10000) / 10000 : null,
        deltaVersusVendorGradedCalls: d - claim.gradedCalls };
    }
    const closest = Object.entries(defs).filter(([, v]) => v.accuracy !== null)
      .sort((a, b) => Math.abs(a[1].deltaVersusVendorAccuracy) - Math.abs(b[1].deltaVersusVendorAccuracy))[0];
    L.reproduction = {
      verdict: 'ANSWERED',
      vendorClaim: claim,
      sumOfFiveOutcomes: o.hit + o.miss + o.nogoal + o.unclear + o.open,
      sumEqualsCountSince: o.hit + o.miss + o.nogoal + o.unclear + o.open === L.countSince,
      definitions: defs,
      closestToVendorAccuracy: closest ? closest[0] : null,
      note: 'the vendor figure is a crawl of unknown date over a rolling 90 days; deltas are informative, not a pass or fail',
    };
  }
  A.ledger = L;

  // ---- the headline, with its denominators (Rule 91)
  const c = A.coverage;
  A.coverageLine = [
    `next-goal list: ${ng ? ng.length : 'no'} rows (gate ${A.gate.verdict}${A.gate.status ? ' ' + A.gate.status : ''})`,
    `events/live: ${lv ? lv.length : 'not read'} events${c && c.liveRows != null && c.withoutReadAtMinute10Plus != null ? `, ${c.withoutReadAtMinute10Plus} at minute 10+ without a read` : ''}`,
    `leagues with reads: ${A.leagues && A.leagues.distinct != null ? A.leagues.distinct : 'n/a'}`,
    `ledger: ${L.countSince ?? 'n/a'} calls since ${L.since ?? 'n/a'}, ${L.page ? L.page.rows : 0} page rows, ${all5 ? 5 : Object.values(o).filter((v) => v !== null).length} of 5 outcome counts`,
    `calls ${ctx.callsMade ?? '?'}/${ctx.callBudget ?? '?'}`,
  ].join(' | ');
  return A;
}

// ---------------------------------------------------------------- the one place that talks to the vendor
const SHOWN_HEADERS = /^(ratelimit|x-ratelimit|retry-after|x-cache-status|cf-cache-status|age|cache-control|content-type|vary|allow)/i;

export function fieldLeagueIdsFromSource(file = 'src/index.js') {
  let src;
  try { src = fs.readFileSync(file, 'utf8'); } catch (_) { return null; }
  const ids = new Set();
  for (const m of src.matchAll(/bsdLeagueId:\s*(\d+)/g)) ids.add(Number(m[1]));
  return ids.size ? [...ids] : null;
}

async function main() {
  const BASE = process.env.BSD_BASE || 'https://sports.bzzoiro.com';
  // No fallback: an unset variable and an empty one both mean "no token", and `!TOKEN` already says so.
  // (The absence-collapse ratchet counts `|| ''` as a collapse of absent into empty.)
  const TOKEN = process.env.BSD_API_TOKEN;
  const TS = new Date().toISOString();
  const CALL_BUDGET = Number(process.env.CALL_BUDGET || 24);
  const d90 = new Date(Date.parse(TS) - VENDOR_CLAIMS.windowDays * 86400000).toISOString().slice(0, 10);
  const yesterday = new Date(Date.parse(TS) - 86400000).toISOString().slice(0, 10);

  let calls = 0, stopped = null;
  const raw = {};
  const headerNames = new Set();
  const log = [];

  async function get(key, path, extra = {}) {
    const rec = Object.assign({ key, path }, extra);
    raw[key] = rec;
    if (!TOKEN) { rec.blocked = 'no BSD_API_TOKEN in env'; return rec; }
    if (stopped) { rec.blocked = `run stopped on ${stopped}`; return rec; }
    if (calls >= CALL_BUDGET) { rec.blocked = `call budget ${CALL_BUDGET} exhausted`; return rec; }
    calls++;
    const t0 = Date.now();
    rec.at = new Date(t0).toISOString();
    try {
      const r = await fetch(`${BASE}${path}`, { headers: { Authorization: `Token ${TOKEN}`, Accept: 'application/json' }, signal: AbortSignal.timeout(30000) });
      rec.status = r.status; rec.ms = Date.now() - t0; rec.headers = {};
      for (const [k, v] of r.headers.entries()) { headerNames.add(k); if (SHOWN_HEADERS.test(k)) rec.headers[k] = v; }
      const text = await r.text();
      rec.bytes = text.length;
      try { rec.json = JSON.parse(text); } catch (_) { rec.nonJson = text.slice(0, 200); }
      if (r.status === 429 || r.status === 401) stopped = String(r.status);
    } catch (e) { rec.error = String(e.message || e); }
    log.push({ key, path, status: rec.status ?? null, ms: rec.ms ?? null, bytes: rec.bytes ?? null, error: rec.error, blocked: rec.blocked });
    return rec;
  }

  console.log(`=== bsd-next-goal-probe  base=${BASE}  utc=${TS}  budget=${CALL_BUDGET} ===`);
  if (!TOKEN) console.log('!! BSD_API_TOKEN absent: every question below reports UNKNOWN, not FALSE.');

  // gate + id space need the two reads taken close together
  await Promise.all([get('ng_list', '/api/v2/next-goal/?limit=200'), get('live', '/api/v2/events/live/')]);
  const ng = ngRows(raw.ng_list);
  const { rows: lv } = liveRows(raw.live);

  if (ng && ng.length) {
    const leagueCounts = tally(ng, (r) => r?.event?.league_id);
    const L = Object.entries(leagueCounts).sort((a, b) => b[1] - a[1])[0][0];
    const control = Math.max(...ng.map((r) => num(r?.event?.league_id) ?? 0)) + 100000;
    await get('ng_calls_only', '/api/v2/next-goal/?calls_only=true&limit=200');
    await get('ng_league', `/api/v2/next-goal/?league_id=${L}&limit=200`, { leagueUsed: L });
    await get('ng_league_control', `/api/v2/next-goal/?league_id=${control}&limit=200`, { leagueUsed: control });
    const first = ng[0]?.event?.id;
    await get('ng_one', `/api/v2/next-goal/${encodeURIComponent(first)}/`, { id: first });
    const readIds = new Set(ng.map((r) => String(r?.event?.id)));
    const noRead = (lv || []).find((r) => r?.id != null && !readIds.has(String(r.id)) && (num(r.current_minute) ?? -1) >= 10) || (lv || []).find((r) => r?.id != null && !readIds.has(String(r.id)));
    if (noRead) { raw.ng_noread_pick = noRead.id; await get('ng_noread', `/api/v2/next-goal/${encodeURIComponent(noRead.id)}/`, { id: noRead.id, eventStatus: noRead.status ?? null }); }
  }
  // a finished event, picked by pattern (the vocabulary is recorded by the shape section, not assumed here)
  if (ng !== null) {
    await get('finished_list', `/api/v2/events/?date_from=${yesterday}&date_to=${yesterday}&limit=50`);
    const fr = isObj(raw.finished_list?.json) && Array.isArray(raw.finished_list.json.results) ? raw.finished_list.json.results : [];
    const fin = fr.find((r) => r?.id != null && /finish|ended|full.?time|^ft$/i.test(String(r.status)));
    if (fin) { raw.ng_finished_pick = fin.id; await get('ng_finished', `/api/v2/next-goal/${encodeURIComponent(fin.id)}/`, { id: fin.id, eventStatus: fin.status ?? null }); }
  }
  // the ledger is its own endpoint: gated or open independently of the list
  await get('calls_since', `/api/v2/next-goal/calls/?date_from=${d90}&limit=1`);
  if (raw.calls_since.status === 200) {
    await get('calls_page', '/api/v2/next-goal/calls/?limit=200');
    for (const o of ['hit', 'miss', 'nogoal', 'unclear', 'open']) await get(`calls_${o}`, `/api/v2/next-goal/calls/?date_from=${d90}&outcome=${o}&limit=1`);
    await get('calls_all', '/api/v2/next-goal/calls/?limit=1');
    const total = num(raw.calls_all?.json?.count);
    if (total && total > 1) await get('calls_last_offset', `/api/v2/next-goal/calls/?limit=1&offset=${total - 1}`);
  }

  const ctx = { d90, callsMade: calls, callBudget: CALL_BUDGET, fieldLeagueIds: fieldLeagueIdsFromSource(), vendorClaims: VENDOR_CLAIMS };
  const analysis = analyse(raw, ctx);

  // a verbatim sample: ONE row per endpoint, as shape evidence (Rule 73), not a dataset
  const samples = {
    nextGoalRow: ng && ng.length ? ng[0] : null,
    callsRow: ngRows(raw.calls_page) && ngRows(raw.calls_page).length ? ngRows(raw.calls_page)[0] : null,
    liveEventRow: lv && lv.length ? lv[0] : null,
  };

  const out = {
    ts: TS, base: BASE, tokenPresent: Boolean(TOKEN), callBudget: CALL_BUDGET, callsMade: calls, stopped,
    // -latest.json advances only on a run that got at least one 200: a 429-only or error-only run is evidence
    // of the block, kept under its stamp, but must not stand in for a reading under a name that looks current.
    reachedVendor: Object.values(raw).some((r) => isObj(r) && r.status === 200),
    coverageLine: analysis.coverageLine,
    responseHeaderNames: [...headerNames].sort(),
    calls: log, analysis, samples,
  };
  const body = JSON.stringify(out, null, 2);
  refuseIfTokenInside(body, TOKEN);

  console.log('\n=== COVERAGE ===\n' + out.coverageLine);
  const pick = (k) => analysis[k] && (analysis[k].verdict || JSON.stringify(analysis[k]).slice(0, 80));
  console.log('\n=== VERDICTS ===');
  console.log(`gate(list)=${analysis.gate.verdict}(${analysis.gate.status ?? '-'}) gate(calls)=${analysis.gateCalls.verdict}(${analysis.gateCalls.status ?? '-'})`
    + ` idSpace=${pick('idSpace')} calls_only=${pick('filterCallsOnly')} league_id=${pick('filterLeagueId')}`
    + ` ledger.reproduction=${analysis.ledger.reproduction && analysis.ledger.reproduction.verdict}`);

  fs.mkdirSync('outbox', { recursive: true });
  const stamp = TS.replace(/[:.]/g, '-');
  fs.writeFileSync(`outbox/bsd-next-goal-probe-${stamp}.json`, body);
  if (out.reachedVendor) {
    fs.writeFileSync('outbox/bsd-next-goal-probe-latest.json', body);
    console.log(`\nwrote outbox/bsd-next-goal-probe-${stamp}.json and -latest.json`);
  } else {
    console.log(`\nwrote outbox/bsd-next-goal-probe-${stamp}.json; NOT advancing -latest.json (no call returned 200)`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().then(() => process.exit(0)).catch((e) => { console.error('bsd-next-goal-probe failed:', e.stack || e.message); process.exit(1); });
}
