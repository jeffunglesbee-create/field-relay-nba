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
//   coverage    which in-play matches at minute 10+ get no read?    the same two
//   filters     are league_id and calls_only honoured?              a control call per filter
//   one match   what does /{id}/ say, and what is `available:false`?  up to three calls
//   ledger      is /calls/ readable, how deep, and does the vendor's published 73.6% of 1,508
//               reproduce from its own counts?                      eight calls of limit 1
//
// WHAT EVENTS/LIVE IS. Measured on the committed 2026-09-19 capture (outbox/bsd-uefa-probe-
// 20260919T161717Z.txt): 58 rows, 34 of them status "finished" with period "FT" and a null
// current_minute, 24 "inprogress" (1st_half, 2nd_half, halftime). It is NOT a list of matches in
// play, so a coverage count over all its rows reports finished matches as matches without a read.
// Every denominator here is taken over in-play rows at minute 10 or later, and the status/period
// vocabulary actually seen is written into the artifact so a miss in `liveClass` is visible.
//
// SAMPLE-COVERAGE-A (Rule 91): the coverage line is built from the measured denominators and is
// printed beside every verdict. A verdict whose denominator is 0 says so.
//
// Budget (Rule 78): CALL_BUDGET (an integer of 1 or more, default 24) is enforced here, a 429 or
// 401 stops the run before the body is read, a redirect is an error (one request, never twenty),
// and a run deadline (RUN_DEADLINE_SECONDS, default 400) marks the rest UNKNOWN so the artifact is
// always written inside the workflow's 10-minute limit. The 18 calls this normally makes are one
// slate's worth, not a poll.
//
// Usage: BSD_API_TOKEN=... node scripts/bsd-next-goal-probe.mjs
// Rule 90: scripts/check-bsd-next-goal-probe.mjs runs `analyse` on fixtures, scripts/check-bsd-next-goal-probe-run.mjs
// runs this whole file against a stub vendor, and scripts/mutate-bsd-next-goal-probe.mjs breaks it on purpose.

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
// calls it on the exact bytes about to be written. It looks for the raw token, its JSON-escaped and
// URL-encoded forms, and its first 12 characters (a vendor that echoes "Invalid token abcd1234..."
// truncated would otherwise pass). A token shorter than 8 characters is not a token.
export function refuseIfTokenInside(body, token) {
  if (typeof token !== 'string' || token.length < 8) return;
  const forms = [token, JSON.stringify(token).slice(1, -1), encodeURIComponent(token), token.slice(0, Math.min(token.length, 12))];
  if (forms.some((f) => body.includes(f))) {
    throw new Error('the artifact contains the token; refusing to write it');
  }
}

// ---------------------------------------------------------------- small helpers
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const str = (v, n = 200) => (typeof v === 'string' ? v.slice(0, n) : null);
// Diacritics are folded first: 'Atletico' and 'Atlético' are one name, and a vendor that spells them differently must not read as an id collision.
const norm = (s) => String(s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
// A team name is a string in every shape seen so far; an object with a name is accepted, anything else is no name.
export const nameOf = (v) => (typeof v === 'string' ? v : isObj(v) && typeof v.name === 'string' ? v.name : null);
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
const scaleOf = (arr) => {
  const n = arr.map(num).filter((v) => v !== null);
  return n.length ? (Math.max(...n) <= 1 ? 'fraction (<=1)' : 'percent (>1)') : null;
};
const DATE_LIKE = /^\d{4}-\d{2}-\d{2}/;
const dateLikes = (v, acc = []) => {
  if (typeof v === 'string' && DATE_LIKE.test(v)) acc.push(v);
  else if (isObj(v)) Object.values(v).forEach((x) => dateLikes(x, acc));
  return acc;
};

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

// ---------------------------------------------------------------- what an events/live row is
// status "inprogress" with period 1st_half / 2nd_half / halftime; status "finished" with period "FT" and a
// null current_minute; the relay's own cron also handles "notstarted" on this endpoint. The vocabulary actually
// seen is reported (A.live.statusPeriod), so a value this does not know lands in 'other', visibly.
const FINISHED_RE = /^(finished|ended|ft|full.?time|aet|after)/i;
const NOT_STARTED_RE = /^(notstarted|not.?started|scheduled|postponed|cancel|abandon|suspend|interrupt)/i;
export function liveClass(r) {
  const s = String(r?.status ?? ''), p = String(r?.period ?? '');
  if (FINISHED_RE.test(s) || FINISHED_RE.test(p)) return 'finished';
  if (NOT_STARTED_RE.test(s)) return 'notstarted';
  if (/in.?progress|live|half|extra|penalt/i.test(s) || /half|extra|penalt|1st|2nd/i.test(p)) return 'inplay';
  return 'other';
}
export const isHalftime = (r) => /half.?time|^ht$/i.test(String(r?.period ?? '')) || /half.?time/i.test(String(r?.status ?? ''));

// The match whose no-read answer is worth one call: in play, not at halftime, no read, and (the premise under
// test is "a read starts from around minute 10") at minute 10 or later; failing that, in play before minute 10.
// Never a finished or not-started row: their answer is another question, asked separately.
export function pickNoRead(lv, ng) {
  if (!Array.isArray(lv)) return null;
  const readIds = new Set((ng || []).map((r) => String(r?.event?.id)));
  const cand = lv.filter((r) => r?.id != null && !readIds.has(String(r.id)) && liveClass(r) === 'inplay' && !isHalftime(r));
  return cand.find((r) => (num(r.current_minute) ?? -1) >= 10) || cand.find((r) => num(r.current_minute) !== null) || null;
}
export function pickFinished(rows) {
  return (Array.isArray(rows) ? rows : []).find((r) => r?.id != null && liveClass(r) === 'finished') || null;
}
// The league to filter by is the most common one among the reads, and the control is a league id above
// every one seen, which an ignored filter cannot satisfy. No league_id on any row means no test.
export function pickLeague(ng) {
  const ids = ng.map((r) => r?.event?.league_id).filter((v) => v !== null && v !== undefined && v !== '');
  if (!ids.length) return null;
  const top = Object.entries(tally(ids)).sort((a, b) => b[1] - a[1])[0][0];
  const nums = ids.map(num).filter((v) => v !== null);
  return { league: top, control: (nums.length ? Math.max(...nums) : 0) + 100000 };
}

// ---------------------------------------------------------------- the gate
export function gateOf(rec) {
  if (!rec) return { verdict: 'UNKNOWN', why: 'not called' };
  if (rec.status != null) {
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
    if (rec.error) out.bodyError = rec.error;   // a status arrived and the body then failed: the status still counts
    return out;
  }
  if (rec.blocked) return { verdict: 'UNKNOWN', why: rec.blocked };
  if (rec.error) return { verdict: 'UNKNOWN', why: `request error: ${rec.error}` };
  return { verdict: 'UNKNOWN', why: 'no status' };
}
export const definiteGate = (g) => Boolean(g) && ['OPEN', 'GATED', 'ABSENT'].includes(g.verdict);

// ---------------------------------------------------------------- shape of the reads
export function shapeOf(rows, nowMs) {
  const ev = rows.map((r) => (isObj(r?.event) ? r.event : {}));
  const probs = rows.map((r) => (isObj(r?.probabilities) ? r.probabilities : {}));
  let sumBad = 0, sumOk = 0, noGoalNull = 0, confEqLeader = 0, confNotEq = 0, confUnknown = 0;
  let callAgree = 0, callDisagree = 0, callUnknown = 0, callPausedExplained = 0, callWithinRounding = 0;
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
    // is_call is "the leader's probability clears call_threshold". Two documented states make that
    // comparison inexact: a paused call (would be a call, held after a goal) and 2-decimal rounding.
    const th = num(r?.call_threshold);
    if (conf === null || th === null || typeof r?.is_call !== 'boolean') callUnknown++;
    else {
      const wouldCall = conf >= th;
      if (r.is_call === wouldCall) callAgree++;
      else if (!r.is_call && r.call_paused === true && wouldCall) callPausedExplained++;
      else if (Math.abs(conf - th) <= 0.0101) callWithinRounding++;
      else callDisagree++;
    }
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
    probabilityScale: scaleOf(probs.flatMap((p) => [p.home, p.away, p.no_goal])),
    confidenceScale: scaleOf(rows.map((r) => r?.confidence)),
    callThresholdScale: scaleOf(rows.map((r) => r?.call_threshold)),
    noGoalNull,
    confidenceEqualsLeaderProbability: { equal: confEqLeader, notEqual: confNotEq, unknown: confUnknown },
    isCallMatchesThreshold: { agree: callAgree, pausedExplained: callPausedExplained, withinRounding: callWithinRounding, disagree: callDisagree, unknown: callUnknown },
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

// ---------------------------------------------------------------- coverage over events/live
export function coverageOf(lv, ng) {
  const readIds = new Set(ng.map((r) => String(r?.event?.id)));
  const liveIds = new Set(lv.map((r) => String(r?.id)));
  const rows = lv.map((r) => ({ r, c: liveClass(r), read: readIds.has(String(r?.id)), ht: isHalftime(r), m: num(r?.current_minute) }));
  const inplay = rows.filter((x) => x.c === 'inplay');
  const playing = inplay.filter((x) => !x.ht);
  const at10 = playing.filter((x) => x.m !== null && x.m >= 10);
  const before10 = playing.filter((x) => x.m !== null && x.m < 10);
  const unknownMinute = playing.filter((x) => x.m === null);
  const gap = at10.filter((x) => !x.read);
  const ws = (x) => x.r?.websocket_plus ?? '(absent)';
  return {
    liveRows: lv.length,
    byClass: tally(rows, (x) => x.c),
    inPlay: inplay.length,
    inPlayAtMinute10Plus: at10.length,
    withReadAtMinute10Plus: at10.length - gap.length,
    withoutReadAtMinute10Plus: gap.length,
    withoutReadByPeriod: tally(gap, (x) => x.r?.period ?? '(absent)'),
    withoutReadByMinuteBucket: tally(gap, (x) => (x.m < 15 ? '10-14' : '15+')),
    withoutReadByWebsocketPlus: tally(gap, ws),
    withReadByWebsocketPlus: tally(at10.filter((x) => x.read), ws),
    withoutReadByLeague: tally(gap, (x) => `${x.r?.league_id ?? '?'}:${x.r?.league_name ?? ''}`),
    inPlayBeforeMinute10: { n: before10.length, withRead: before10.filter((x) => x.read).length },
    inPlayUnknownMinute: { n: unknownMinute.length, withRead: unknownMinute.filter((x) => x.read).length },
    halftime: { n: inplay.filter((x) => x.ht).length, withRead: inplay.filter((x) => x.ht && x.read).length },
    readsForRowsNotInPlay: rows.filter((x) => x.c !== 'inplay' && x.read).length,
    nextGoalRowsNotInEventsLive: ng.filter((r) => !liveIds.has(String(r?.event?.id))).length,
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
  const partial = Boolean(raw.ng_list?.json) && ng !== null
    && (raw.ng_list.json.next != null || (num(raw.ng_list.json.count) !== null && raw.ng_list.json.count > ng.length));
  A.live = lv
    ? { shape: liveShape, rows: lv.length, count: raw.live.json?.count ?? null,
        statusPeriod: tally(lv, (r) => `${r?.status ?? '(absent)'}/${r?.period ?? '(absent)'}`),
        byClass: tally(lv, liveClass),
        websocketPlus: tally(lv, (r) => r?.websocket_plus ?? '(absent)') }
    : { shape: liveShape, rows: null };

  // ---- shape and id space
  if (ng === null) {
    const why = A.gate.verdict === 'OPEN' ? 'next-goal returned 200 without a results array' : `next-goal gate is ${A.gate.verdict}`;
    A.shape = unknown(why);
    A.idSpace = unknown('no next-goal rows to compare');
    A.leagues = unknown('no next-goal rows');
    A.coverage = unknown(`next-goal not read: ${why}`);
  } else {
    A.truncated = { reportedCount: raw.ng_list.json.count ?? null, rowsRead: ng.length, nextPage: raw.ng_list.json.next ?? null, partial };
    if (ng.length === 0) {
      A.shape = unknown('next-goal answered 200 with 0 rows (no live slate, or no reads yet); shape not observed');
      A.idSpace = unknown('0 next-goal rows, nothing to compare');
      A.leagues = unknown('0 rows');
    } else {
      A.shape = Object.assign({ verdict: 'ANSWERED' }, shapeOf(ng, nowMs));

      // id space: an id match alone could be a coincidence of two integer spaces, so names must agree too.
      if (lv === null) A.idSpace = unknown('events/live was not read');
      else {
        const liveById = new Map(lv.map((r) => [String(r?.id), r]));
        let matched = 0, agree = 0, disagree = 0, nameUnknown = 0, teamIdAgree = 0, teamIdDisagree = 0;
        const disagreements = [];
        for (const r of ng) {
          const e = r?.event || {};
          const l = liveById.get(String(e.id));
          if (!l) continue;
          matched++;
          const kh = [norm(nameOf(l.home_team)), norm(nameOf(e.home_team))];
          const ka = [norm(nameOf(l.away_team)), norm(nameOf(e.away_team))];
          if (!kh[0] || !kh[1] || !ka[0] || !ka[1]) nameUnknown++;
          else if (kh[0] === kh[1] && ka[0] === ka[1]) agree++;
          else { disagree++; if (disagreements.length < 3) disagreements.push({ id: e.id, nextGoal: [nameOf(e.home_team), nameOf(e.away_team)], live: [nameOf(l.home_team), nameOf(l.away_team)] }); }
          if (l.home_team_id != null && e.home_team_id != null) {
            if (String(l.home_team_id) === String(e.home_team_id)) teamIdAgree++; else teamIdDisagree++;
          }
        }
        A.idSpace = {
          verdict: matched === 0 ? 'NOT_JOINED' : disagree > 0 ? 'ID_COLLISION' : agree === 0 ? 'UNKNOWN' : 'SAME_ID_SPACE',
          nextGoalRows: ng.length, matchedInEventsLive: matched, nameAgree: agree, nameDisagree: disagree, nameUnknown,
          homeTeamIdAgree: teamIdAgree, homeTeamIdDisagree: teamIdDisagree,
          idTypes: tally(ng, (r) => typeof r?.event?.id),
          partial: matched < ng.length || partial,
          note: matched === 0 ? 'no next-goal id appears in events/live: a different id space, OR events/live does not list these matches; not distinguished by this run'
            : agree === 0 && disagree === 0 ? 'ids matched but no team name was comparable on either side' : undefined,
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
        verdict: partial ? 'PARTIAL' : 'ANSWERED', distinct: Object.keys(byLeague).length, byLeague,
        fieldTrackedLeagueIds: tracked ? [...tracked].sort((a, b) => a - b) : null,
        rowsInFieldTrackedLeagues: tracked ? ng.filter((r) => tracked.has(String(r?.event?.league_id))).length : null,
        rowsOutsideFieldTrackedLeagues: tracked ? ng.filter((r) => !tracked.has(String(r?.event?.league_id))).length : null,
      };
    }

    // coverage: in-play matches at minute 10 or later with and without a read. Computed even when the list is
    // empty: "0 reads while 24 matches are in play" is the most informative answer a live slate can give.
    A.coverage = lv === null ? unknown('events/live was not read')
      : Object.assign({ verdict: partial ? 'PARTIAL' : 'ANSWERED', listTruncated: partial }, coverageOf(lv, ng));
  }

  // ---- filters, each with a control that an ignored filter could not pass
  if (ng === null || ng.length === 0) {
    A.filterCallsOnly = unknown('no next-goal rows in the unfiltered call');
    A.filterLeagueId = unknown('no next-goal rows in the unfiltered call');
  } else {
    const co = ngRows(raw.ng_calls_only);
    if (co === null) A.filterCallsOnly = unknown(raw.ng_calls_only?.blocked || `calls_only call status ${raw.ng_calls_only?.status ?? 'none'}`);
    else {
      const isCall = (r) => r?.is_call === true;
      const unfilteredCalls = ng.filter(isCall).length;
      const listHadNonCalls = ng.some((r) => !isCall(r));
      // a paused would-be call is neither a call nor a plain non-call: whether calls_only includes it is the docs' open question
      const pausedInFiltered = co.filter((r) => !isCall(r) && r?.call_paused === true).length;
      const plainNonCallsInFiltered = co.filter((r) => !isCall(r) && r?.call_paused !== true).length;
      A.filterCallsOnly = {
        verdict: plainNonCallsInFiltered > 0 ? 'NOT_HONOURED'
          : co.length === 0 && unfilteredCalls > 0 ? 'INCONSISTENT'
          : unfilteredCalls === 0 || !listHadNonCalls ? 'INDISTINGUISHABLE'
          : 'HONOURED',
        unfilteredRows: ng.length, unfilteredCalls, filteredRows: co.length, pausedInFiltered, plainNonCallsInFiltered, unfilteredHadNonCalls: listHadNonCalls,
        note: unfilteredCalls === 0 ? 'no row in the unfiltered call was a call, so there was nothing for the filter to retrieve'
          : !listHadNonCalls ? 'every unfiltered row was already a call, so an ignored filter would look identical' : undefined,
      };
    }
    const lg = ngRows(raw.ng_league), ctl = ngRows(raw.ng_league_control);
    if (!pickLeague(ng)) A.filterLeagueId = unknown('no league_id on any next-goal row');
    else if (lg === null || ctl === null) A.filterLeagueId = unknown(raw.ng_league?.blocked || raw.ng_league_control?.blocked || 'league_id call not answered with 200');
    else {
      const L = String(raw.ng_league?.leagueUsed ?? '');
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
    if (rec.status !== 200 || !isObj(rec.json)) return { verdict: 'ANSWERED', status: rec.status ?? null, nonStandard: true, bodyKeys: isObj(rec.json) ? Object.keys(rec.json) : null, detail: str(rec.nonJson, 120), error: rec.error ?? null };
    return { verdict: 'ANSWERED', status: 200, id: rec.id, eventStatus: rec.eventStatus ?? null, available: rec.json.available ?? '(absent)', reason: rec.json.reason ?? null };
  };
  A.noReadInPlay = raw.ng_noread_pick != null ? reasonOf(raw.ng_noread)
    : ng === null ? unknown(`next-goal not read: ${A.gate.verdict}`)
    : lv === null ? unknown('events/live was not read')
    : unknown('no in-play match without a read in events/live when it was read (checked: in play, not at halftime, a current_minute)');
  const fl = raw.finished_list;
  const fr = fl && fl.status === 200 && isObj(fl.json) && Array.isArray(fl.json.results) ? fl.json.results : null;
  A.finishedList = !fl ? { requested: false }
    : fr ? { requested: true, rows: fr.length, statusPeriod: tally(fr, (r) => `${r?.status ?? '(absent)'}/${r?.period ?? '(absent)'}`), picked: raw.ng_finished_pick ?? null }
    : { requested: true, status: fl.status ?? null, blocked: fl.blocked ?? null, error: fl.error ?? null };
  A.noReadFinished = raw.ng_finished_pick != null ? reasonOf(raw.ng_finished)
    : !fl ? unknown('not requested: next-goal was not read')
    : fl.blocked ? unknown(`finished list blocked: ${fl.blocked}`)
    : !fr ? unknown(`finished list answered status ${fl.status ?? 'none'}`)
    : unknown(`no finished event among ${fr.length} rows of yesterday's list (status/period seen: ${Object.keys(A.finishedList.statusPeriod).join(', ') || 'none'})`);

  // ---- the ledger
  const pageRows = ngRows(raw.calls_page);
  const cnt = (rec) => (rec && rec.status === 200 && isObj(rec.json) && num(rec.json.count) !== null ? rec.json.count : null);
  const L = {
    gate: A.gateCalls,
    countSince: cnt(raw.calls_since), since: ctx.d90 ?? null,
    outcomes: { hit: cnt(raw.calls_hit), miss: cnt(raw.calls_miss), nogoal: cnt(raw.calls_nogoal), unclear: cnt(raw.calls_unclear), open: cnt(raw.calls_open) },
    countAllTime: cnt(raw.calls_all),
  };
  const countAts = ['calls_since', 'calls_hit', 'calls_miss', 'calls_nogoal', 'calls_unclear', 'calls_open']
    .map((k) => Date.parse(raw[k]?.at)).filter((v) => Number.isFinite(v));
  L.countsSpanSeconds = countAts.length > 1 ? Math.round((Math.max(...countAts) - Math.min(...countAts)) / 1000) : null;
  // each row's own date is its LATEST date-like value (a call carries when it was made and when it resolved)
  const rowDate = (row) => { const d = dateLikes(row).sort(); return d.length ? d[d.length - 1] : null; };
  if (pageRows && pageRows.length) {
    const dated = pageRows.map(rowDate).filter(Boolean).sort();
    L.page = {
      rows: pageRows.length, fieldCounts: fieldCounts(pageRows),
      outcome: tally(pageRows, (r) => r?.outcome ?? '(absent)'), side: tally(pageRows, (r) => r?.side ?? '(absent)'),
      probability: minmax(pageRows.map((r) => r?.probability)), minute: minmax(pageRows.map((r) => r?.minute)),
      probabilityScale: scaleOf(pageRows.map((r) => r?.probability)),
      rowsWithADate: dated.length, oldestRowDate: dated.length ? dated[0] : null, newestRowDate: dated.length ? dated[dated.length - 1] : null,
    };
  }
  // The row at the LAST offset is the oldest if the ledger is newest-first and the newest if it is not. The
  // order is read from the dates, never assumed.
  const last = ngRows(raw.calls_last_offset);
  if (last && last.length) {
    L.lastOffsetRowDate = rowDate(last[0]);
    L.lastOffsetRowKeys = Object.keys(last[0] || {});
    const p = L.page;
    L.ledgerOrder = !p || !p.oldestRowDate || !L.lastOffsetRowDate ? 'unknown'
      : L.lastOffsetRowDate < p.oldestRowDate ? 'newest-first'
      : L.lastOffsetRowDate > p.newestRowDate ? 'oldest-first' : 'inconclusive';
  }
  // accuracy under each denominator the vendor's wording could mean, from the exact counts
  const o = L.outcomes;
  const all5 = Object.values(o).every((v) => v !== null);
  if (L.countSince === null || !all5) L.reproduction = unknown('one or more count calls did not return a count');
  else {
    const sum = o.hit + o.miss + o.nogoal + o.unclear + o.open;
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
    // The five outcomes should partition the window. If every outcome count equals the window's count the
    // outcome filter was ignored; if they do not sum to it, the deltas below are not trustworthy.
    const filterIgnored = L.countSince > 0 && Object.values(o).every((v) => v === L.countSince);
    L.reproduction = {
      verdict: filterIgnored ? 'OUTCOME_FILTER_IGNORED' : sum === L.countSince ? 'ANSWERED' : 'PARTITION_MISMATCH',
      vendorClaim: claim,
      sumOfFiveOutcomes: sum,
      sumEqualsCountSince: sum === L.countSince,
      partitionDifference: sum - L.countSince,
      definitions: defs,
      closestToVendorAccuracy: closest ? closest[0] : null,
      note: 'the vendor figure is a crawl of unknown date over a rolling 90 days; deltas are informative, not a pass or fail, and are not trustworthy unless the verdict is ANSWERED',
    };
  }
  A.ledger = L;

  // ---- the headline, with its denominators (Rule 91)
  const c = A.coverage;
  const evLine = !lv ? 'events/live: not read'
    : c && c.inPlayAtMinute10Plus != null
      ? `events/live: ${lv.length} rows, ${c.inPlay} in play, ${c.inPlayAtMinute10Plus} at minute 10+ (${c.withReadAtMinute10Plus} with a read, ${c.withoutReadAtMinute10Plus} without)`
      : `events/live: ${lv.length} rows, ${A.live.byClass.inplay || 0} in play (not compared: ${c && c.why ? 'next-goal not read' : 'no comparison'})`;
  A.coverageLine = [
    `next-goal list: ${ng ? ng.length : 'no'} rows${partial ? ` (TRUNCATED: ${A.truncated.reportedCount ?? '?'} reported, next page not read)` : ''} (gate ${A.gate.verdict}${A.gate.status ? ' ' + A.gate.status : ''})`,
    evLine,
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

export const positiveInt = (v, dflt) => { const n = Number(v); return Number.isInteger(n) && n >= 1 ? n : dflt; };

async function main() {
  const BASE = process.env.BSD_BASE || 'https://sports.bzzoiro.com';
  // No fallback: an unset variable and an empty one both mean "no token", and `!TOKEN` already says so.
  // (The absence-collapse ratchet counts `|| ''` as a collapse of absent into empty.) A secret set from a
  // file often carries a trailing newline: fetch would refuse it as a header and nothing would be learned.
  const TOKEN_RAW = process.env.BSD_API_TOKEN;
  const TOKEN = typeof TOKEN_RAW === 'string' ? TOKEN_RAW.trim() : undefined;
  if (TOKEN && /[^\x21-\x7e]/.test(TOKEN)) {
    console.error('BSD_API_TOKEN contains whitespace or a non-printable character; refusing to send it anywhere');
    process.exit(1);
  }
  const TS = new Date().toISOString();
  const CALL_BUDGET = positiveInt(process.env.CALL_BUDGET, 24);
  const DEADLINE_MS = positiveInt(process.env.RUN_DEADLINE_SECONDS, 400) * 1000;
  const START = Date.now();
  const d90 = new Date(Date.parse(TS) - VENDOR_CLAIMS.windowDays * 86400000).toISOString().slice(0, 10);
  const yesterday = new Date(Date.parse(TS) - 86400000).toISOString().slice(0, 10);

  let calls = 0, stopped = null;
  const raw = {};
  const headerNames = new Set();
  const log = [];

  async function get(key, path, extra = {}) {
    const rec = Object.assign({ key, path }, extra);
    raw[key] = rec;
    if (!TOKEN) rec.blocked = 'no BSD_API_TOKEN in env';
    else if (stopped) rec.blocked = `run stopped on ${stopped}`;
    else if (calls >= CALL_BUDGET) rec.blocked = `call budget ${CALL_BUDGET} exhausted`;
    else if (Date.now() - START > DEADLINE_MS) rec.blocked = `run deadline ${DEADLINE_MS / 1000} s passed`;
    if (rec.blocked) { log.push({ key, path, status: null, blocked: rec.blocked }); return rec; }
    calls++;
    const t0 = Date.now();
    rec.at = new Date(t0).toISOString();
    try {
      const r = await fetch(`${BASE}${path}`, { headers: { Authorization: `Token ${TOKEN}`, Accept: 'application/json' }, redirect: 'error', signal: AbortSignal.timeout(30000) });
      rec.status = r.status; rec.headers = {};
      // a 429 or 401 stops the run NOW, before the body is read: a body that then fails must not leave the run going
      if (r.status === 429 || r.status === 401) stopped = String(r.status);
      for (const [k, v] of r.headers.entries()) { headerNames.add(k); if (SHOWN_HEADERS.test(k)) rec.headers[k] = v; }
      const text = await r.text();
      rec.bytes = text.length;
      try { rec.json = JSON.parse(text); } catch (_) { rec.nonJson = text.slice(0, 200); }
    } catch (e) { rec.error = String(e.message || e); }
    rec.ms = Date.now() - t0;
    log.push({ key, path, status: rec.status ?? null, ms: rec.ms, bytes: rec.bytes ?? null, error: rec.error, blocked: rec.blocked });
    console.log(`call ${calls}/${CALL_BUDGET} ${key} -> ${rec.status ?? 'no response'} in ${rec.ms} ms${rec.error ? ' (' + rec.error.slice(0, 60) + ')' : ''}`);
    return rec;
  }

  console.log(`=== bsd-next-goal-probe  base=${BASE}  utc=${TS}  budget=${CALL_BUDGET}  deadline=${DEADLINE_MS / 1000}s ===`);
  if (!TOKEN) console.log('!! BSD_API_TOKEN absent: every question below reports UNKNOWN, not FALSE.');

  // gate + id space need the two reads taken close together
  await Promise.all([get('ng_list', '/api/v2/next-goal/?limit=200'), get('live', '/api/v2/events/live/')]);
  const ng = ngRows(raw.ng_list);
  const { rows: lv } = liveRows(raw.live);

  if (ng !== null) {
    const pick = ng.length ? pickLeague(ng) : null;
    if (ng.length) {
      await get('ng_calls_only', '/api/v2/next-goal/?calls_only=true&limit=200');
      if (pick) {
        await get('ng_league', `/api/v2/next-goal/?league_id=${encodeURIComponent(pick.league)}&limit=200`, { leagueUsed: pick.league });
        await get('ng_league_control', `/api/v2/next-goal/?league_id=${pick.control}&limit=200`, { leagueUsed: pick.control });
      }
      const first = ng[0]?.event?.id;
      if (first != null) await get('ng_one', `/api/v2/next-goal/${encodeURIComponent(first)}/`, { id: first });
    }
    // a match in play with no read: asked even when the list is empty (0 reads while matches are in play is an answer)
    const noRead = pickNoRead(lv, ng);
    if (noRead) { raw.ng_noread_pick = noRead.id; await get('ng_noread', `/api/v2/next-goal/${encodeURIComponent(noRead.id)}/`, { id: noRead.id, eventStatus: noRead.status ?? null }); }
    // a finished event, picked by status/period (the vocabulary seen is recorded in analysis.finishedList)
    await get('finished_list', `/api/v2/events/?date_from=${yesterday}&date_to=${yesterday}&limit=50`);
    const fr = isObj(raw.finished_list?.json) && Array.isArray(raw.finished_list.json.results) ? raw.finished_list.json.results : [];
    const fin = pickFinished(fr);
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
  // A throw in the analysis must not erase the run: the call log is still the evidence of what was asked and answered.
  let analysis, analysisError = null;
  try { analysis = analyse(raw, ctx); } catch (e) {
    analysisError = String(e && e.stack ? e.stack : e).split('\n').slice(0, 4).join(' | ');
    analysis = { coverageLine: `ANALYSIS FAILED: ${analysisError.slice(0, 160)}`, gate: gateOf(raw.ng_list), gateCalls: gateOf(raw.calls_since), ledger: {} };
  }

  // a verbatim sample: ONE row per endpoint, as shape evidence (Rule 73), not a dataset. A row too large or too
  // deep to serialise is omitted rather than allowed to stop the artifact being written.
  const sample = (row) => {
    if (row == null) return null;
    try { const t = JSON.stringify(row); return t.length <= 20000 ? row : { omitted: `a row of ${t.length} characters` }; }
    catch (e) { return { omitted: 'the row could not be serialised' }; }
  };
  const samples = {
    nextGoalRow: sample(ng && ng.length ? ng[0] : null),
    callsRow: sample(ngRows(raw.calls_page) && ngRows(raw.calls_page).length ? ngRows(raw.calls_page)[0] : null),
    liveEventRow: sample(lv && lv.length ? lv[0] : null),
  };

  const out = {
    ts: TS, base: BASE, tokenPresent: Boolean(TOKEN), callBudget: CALL_BUDGET, callsMade: calls, stopped, deadlineSeconds: DEADLINE_MS / 1000,
    analysisError,
    // Any 200 at all (events/live counts): informational.
    reachedVendor: Object.values(raw).some((r) => isObj(r) && r.status === 200),
    // -latest.json advances only on a run that got a DEFINITE answer from the endpoint under test (open, gated or
    // absent, on the list or on the ledger). A 429-only, error-only or events/live-only run is evidence of the
    // block, kept under its stamp, but must not stand in for a reading under a name that looks current.
    reachedTarget: !analysisError && (definiteGate(analysis.gate) || definiteGate(analysis.gateCalls)),
    coverageLine: analysis.coverageLine,
    responseHeaderNames: [...headerNames].sort(),
    calls: log, analysis, samples,
  };
  const body = JSON.stringify(out, null, 2);
  refuseIfTokenInside(body, TOKEN);

  console.log('\n=== COVERAGE ===\n' + out.coverageLine);
  const pick = (k) => analysis[k] && (analysis[k].verdict || JSON.stringify(analysis[k]).slice(0, 80));
  const rep = analysis.ledger && analysis.ledger.reproduction;
  console.log('\n=== VERDICTS ===');
  console.log(`gate(list)=${analysis.gate.verdict}(${analysis.gate.status ?? '-'}) gate(calls)=${analysis.gateCalls.verdict}(${analysis.gateCalls.status ?? '-'})`
    + ` idSpace=${pick('idSpace')} calls_only=${pick('filterCallsOnly')} league_id=${pick('filterLeagueId')}`
    + ` ledger.reproduction=${rep ? rep.verdict : 'none'}${rep && rep.sumOfFiveOutcomes != null ? ` (outcomes sum ${rep.sumOfFiveOutcomes} vs window ${analysis.ledger.countSince}, closest definition ${rep.closestToVendorAccuracy})` : ''}`
    + (analysisError ? ` ANALYSIS_ERROR=${analysisError.slice(0, 120)}` : ''));

  fs.mkdirSync('outbox', { recursive: true });
  const stamp = TS.replace(/[:.]/g, '-');
  fs.writeFileSync(`outbox/bsd-next-goal-probe-${stamp}.json`, body);
  if (out.reachedTarget) {
    fs.writeFileSync('outbox/bsd-next-goal-probe-latest.json', body);
    console.log(`\nwrote outbox/bsd-next-goal-probe-${stamp}.json and -latest.json`);
  } else {
    console.log(`\nwrote outbox/bsd-next-goal-probe-${stamp}.json; NOT advancing -latest.json (no definite answer from the endpoint under test)`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().then(() => process.exit(0)).catch((e) => { console.error('bsd-next-goal-probe failed:', e.stack || e.message); process.exit(1); });
}
