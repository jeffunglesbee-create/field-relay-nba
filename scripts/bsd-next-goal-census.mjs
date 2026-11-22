#!/usr/bin/env node
// How many of BSD's published next-goal calls could FIELD grade against its own captured goal timelines?
//
// WHY THIS EXISTS. docs/CC-CMD-2026-11-22-bsd-next-goal-probe.md found the ledger (GET /api/v2/next-goal/calls/) readable
// by the relay's token, its event ids the ids events/live and the R2 captures use, 1,744 calls since 2026-08-05, each with
// `called_at`, `resolved_at` and `resolved_minute`, and only 2 of 16 live reads in a league FIELD tracks. Whether a lab proof
// that grades the vendor against FIELD's own timelines is worth building turns on one number this run measures: of the
// ledger's calls, how many sit on a match whose capture in R2 covers the call from its minute to its resolution.
//
// COUNTS ONLY. Nothing here is a verdict about the vendor and nothing is compared with the vendor's `outcome`: the
// agreement rate is the lab proof's job, under a rule it pre-registers. The artifact holds counts, never a ledger row, a
// team, a player or an event id (BSD licence v4.0 section 4 bars redistributing raw data as a standalone dataset, and this
// repository is public).
//
// WHAT A CAPTURE IS. bsd/{slug}/{id}/incidents.json is {event_id, incidents:[...]}: goal rows (minute, is_home), a `period`
// row per period carrying the running score, `injuryTime`, substitutions, cards (committed real examples:
// data/bsd-flow-{finished,inplay}-incidents.json in field-laboratory). A `period` row's `minute` is NOT read as the capture's
// clock: in those examples HT carries 45 beside a 4-minute injuryTime and FT carries 90 for a match whose event row says
// current_minute 96, so it is a nominal period marker, and an in-play capture's live `Second half` row said 90 for a match
// that went on to score. A first version of this census took that minute as the clock and found every call with a readable
// capture "covered" (0 of 370 uncovered while 234 of 246 captures were in play): a check that could not fail. What a capture
// can prove is the goals it holds. "Covers" below is therefore: the capture saw full time (its goal list is complete), OR it
// holds a goal within WITNESS_TOLERANCE minute of the call's `resolved_minute` (the resolving goal itself, which the
// cumulative list could not hold unless the capture was taken after it). The live row's minute is tallied, not used.
//
// MECHANISM. UPSTREAM for the ledger (the token, a runner), through the relay for R2 (its public /bsd/r2/list and
// /bsd/r2/read, which read R2 and never BSD). The ledger is newest-first and grows while it is paged, so rows are de-duplicated
// by `id` and the count is read before and after.
//
// SAMPLE-COVERAGE-A (Rule 91): the coverage line carries every denominator. Budget (Rule 78): about 12 BSD requests (cap
// CALL_BUDGET, default 16), a 429 or 401 stops the run, a run deadline writes the artifact whatever happened.
//
// Rule 90: scripts/check-bsd-next-goal-census.mjs (analysis), scripts/check-bsd-next-goal-census-run.mjs (the whole run
// against a stub vendor and a stub relay), scripts/mutate-bsd-next-goal-census.mjs (breaks it on purpose).
//
// Usage: BSD_API_TOKEN=... node scripts/bsd-next-goal-census.mjs

import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import { refuseIfTokenInside, positiveInt, ngRows, fieldLeagueIdsFromSource } from './bsd-next-goal-probe.mjs';

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const tally = (arr, f = (x) => x) => { const o = {}; for (const x of arr) { const k = String(f(x)); o[k] = (o[k] || 0) + 1; } return o; };
const inc = (o, k, n = 1) => { o[k] = (o[k] || 0) + n; };

// ---------------------------------------------------------------- the R2 side
export const INCIDENTS_KEY = /^bsd\/([^/]+)\/(\d+)\/([^/]+)$/;
/** bsd/{slug}/{id}/{file} -> {slug, id, file}; anything else is null. */
export function parseKey(key) {
  const m = typeof key === 'string' ? INCIDENTS_KEY.exec(key) : null;
  return m ? { slug: m[1], id: m[2], file: m[3] } : null;
}

/** Every key under bsd/ by cursor. A truncated page with no cursor is a dead end and is reported, never papered over. */
export async function listAll(get, prefix = 'bsd/', maxPages = 40) {
  const keys = []; let cursor = null, pages = 0;
  for (;;) {
    if (pages >= maxPages) return { keys, pages, complete: false, why: `stopped at ${maxPages} pages` };
    const q = `prefix=${encodeURIComponent(prefix)}&limit=1000${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`;
    const r = await get(`/bsd/r2/list?${q}`);
    pages++;
    if (!r || r.status !== 200 || !isObj(r.json) || !Array.isArray(r.json.keys)) return { keys, pages, complete: false, why: `list page ${pages} answered ${r && r.status != null ? r.status : (r && r.error) || 'nothing'}` };
    if (r.json.prefix !== prefix) return { keys, pages, complete: false, why: `list answered prefix ${JSON.stringify(r.json.prefix)} for a request of ${JSON.stringify(prefix)}` };
    for (const k of r.json.keys) keys.push(k);
    if (!r.json.truncated) return { keys, pages, complete: true, why: null };
    if (!r.json.cursor) return { keys, pages, complete: false, why: `page ${pages} is truncated and carries no cursor` };
    cursor = r.json.cursor;
  }
}

/** One incidents.json, reduced to what coverage needs. */
export const WITNESS_TOLERANCE = 1;
export function captureOf(json) {
  const rows = isObj(json) && Array.isArray(json.incidents) ? json.incidents : null;
  if (!rows) return { ok: false, why: isObj(json) ? 'no incidents array' : 'not an object' };
  const periods = rows.filter((r) => isObj(r) && r.type === 'period');
  const ft = periods.find((r) => /^(ft|aet|ap|pen)/i.test(String(r.text ?? '')) && r.is_live === false);
  const live = periods.find((r) => r.is_live === true);
  const goals = rows.filter((r) => isObj(r) && r.type === 'goal' && num(r.minute) !== null);
  const goalMinutes = goals.map((g) => g.minute).sort((a, b) => a - b);
  const fs_ = ft ? { home: num(ft.home_score), away: num(ft.away_score) } : null;
  return {
    ok: true,
    fullTime: Boolean(ft),
    state: ft ? 'full-time' : live ? 'in-play' : 'unmarked',
    liveRowMinute: live ? num(live.minute) : null,
    goalMinutes,
    goals: goals.length,
    finalScore: fs_,
    goalCountMatchesFinal: fs_ && fs_.home !== null && fs_.away !== null ? goals.length === fs_.home + fs_.away : null,
    periodTexts: periods.map((p) => `${p.text ?? '(none)'}/${p.is_live}`),
  };
}

/** Minutes from the call's resolved minute to the nearest goal the capture holds; null when either is missing. */
export function goalDistance(call, cap) {
  const rm = num(call?.resolved_minute);
  if (rm === null || !cap || !cap.ok || !cap.goalMinutes.length) return null;
  return Math.min(...cap.goalMinutes.map((m) => Math.abs(m - rm)));
}

/** Does this capture hold the call's resolution? Full time, or the resolving goal itself. */
export function covers(call, cap, tolerance = WITNESS_TOLERANCE) {
  if (!cap || !cap.ok) return false;
  if (cap.fullTime) return true;
  const d = goalDistance(call, cap);
  return d !== null && d <= tolerance;
}

// ---------------------------------------------------------------- the ledger side
/** Unique rows by `id`, in first-seen order; rows with no usable id are kept and counted. */
export function dedupeLedger(pages) {
  const seen = new Set(), rows = [];
  let duplicates = 0, noId = 0;
  for (const p of pages) for (const r of p) {
    const id = isObj(r) ? r.id : undefined;
    if (id === undefined || id === null) { noId++; rows.push(r); continue; }
    const k = String(id);
    if (seen.has(k)) { duplicates++; continue; }
    seen.add(k); rows.push(r);
  }
  return { rows, duplicates, noId };
}

const monthOf = (s) => (typeof s === 'string' && /^\d{4}-\d{2}/.test(s) ? s.slice(0, 7) : '(no date)');

// ---------------------------------------------------------------- the whole census
export function analyseCensus({ ledger, r2, reads, ctx = {} }) {
  const A = {};
  const L = ledger && Array.isArray(ledger.rows) ? ledger : null;
  A.ledger = !L ? { verdict: 'UNKNOWN', why: (ledger && ledger.why) || 'the ledger was not read' } : (() => {
    const rows = L.rows;
    const ev = (r) => (isObj(r?.event) ? r.event : {});
    const events = new Set(rows.map((r) => String(ev(r).id)).filter((x) => x !== 'undefined' && x !== 'null'));
    return {
      verdict: L.complete ? 'COMPLETE' : 'PARTIAL', why: L.complete ? null : L.why,
      uniqueCalls: rows.length, duplicates: L.duplicates ?? 0, rowsWithoutId: L.noId ?? 0, pages: L.pages ?? null,
      reportedFirst: L.reportedFirst ?? null, reportedLast: L.reportedLast ?? null,
      drift: num(L.reportedFirst) !== null && num(L.reportedLast) !== null ? L.reportedLast - L.reportedFirst : null,
      distinctEvents: events.size,
      outcomes: tally(rows, (r) => r?.outcome ?? '(absent)'),
      byMonth: tally(rows, (r) => monthOf(r?.called_at)),
      rowsWithoutEventId: rows.filter((r) => ev(r).id === undefined || ev(r).id === null).length,
      rowsWithoutResolvedMinute: rows.filter((r) => num(r?.resolved_minute) === null).length,
      oldestCalledAt: rows.map((r) => r?.called_at).filter((x) => typeof x === 'string').sort()[0] ?? null,
      newestCalledAt: rows.map((r) => r?.called_at).filter((x) => typeof x === 'string').sort().slice(-1)[0] ?? null,
    };
  })();

  // R2: which events have an incidents.json, under which slug
  const byEvent = new Map();      // id -> {slugs:Set, files:Set}
  let keysSeen = 0, unparsed = 0;
  const files = {};
  if (r2 && Array.isArray(r2.keys)) {
    for (const k of r2.keys) {
      keysSeen++;
      const p = parseKey(k && k.key);
      if (!p) { unparsed++; continue; }
      inc(files, p.file);
      const e = byEvent.get(p.id) || { slugs: new Set(), files: new Set() };
      e.slugs.add(p.slug); e.files.add(p.file); byEvent.set(p.id, e);
    }
  }
  const withIncidents = [...byEvent.entries()].filter(([, e]) => e.files.has('incidents.json'));
  A.r2 = !r2 || !Array.isArray(r2.keys) ? { verdict: 'UNKNOWN', why: (r2 && r2.why) || 'the R2 listing was not read' } : {
    verdict: r2.complete ? 'COMPLETE' : 'PARTIAL', why: r2.complete ? null : r2.why,
    keys: keysSeen, pages: r2.pages ?? null, keysNotMatchingTheLayout: unparsed, files,
    events: byEvent.size, eventsWithIncidents: withIncidents.length,
    eventsPerSlug: tally(withIncidents, ([, e]) => [...e.slugs].sort().join('+')),
    idsUnderMoreThanOneSlug: [...byEvent.values()].filter((e) => e.slugs.size > 1).length,
  };

  // reads of incidents.json for the ledger's events that have one
  const R = reads instanceof Map ? reads : new Map();
  const caps = new Map();
  let ok = 0, missing = 0, failed = 0, parseFail = 0, blockedReads = 0;
  for (const [id, rd] of R) {
    if (rd.status === 200 && rd.json !== undefined) { const c = captureOf(rd.json); caps.set(id, c); if (c.ok) ok++; else parseFail++; }
    else if (rd.status === 404) missing++;
    else { failed++; if (rd.blocked) blockedReads++; }
  }
  const capList = [...caps.values()].filter((c) => c.ok);
  A.reads = { attempted: R.size, parsed: ok, notFound404: missing, failedOrBlocked: failed, blockedByDeadline: blockedReads, parseFailures: parseFail, capped: Boolean(ctx.capped) };
  A.captures = {
    ofLedgerEvents: capList.length,
    fullTime: capList.filter((c) => c.fullTime).length,
    state: tally(capList, (c) => c.state),
    liveRowMinute: tally(capList.filter((c) => c.state === 'in-play'), (c) => (c.liveRowMinute === null ? 'none' : c.liveRowMinute)),
    periodTexts: tally(capList.flatMap((c) => c.periodTexts), (t) => t),
    goalCountMatchesFinal: tally(capList.filter((c) => c.fullTime), (c) => (c.goalCountMatchesFinal === null ? 'unknown' : c.goalCountMatchesFinal ? 'yes' : 'no')),
  };

  // calls
  if (!L) { A.calls = { verdict: 'UNKNOWN', why: A.ledger.why }; }
  else {
    const tracked = Array.isArray(ctx.trackedLeagueIds) ? new Set(ctx.trackedLeagueIds.map(String)) : null;
    const reasons = {}, gradeableBySlug = {}, gradeableByMonth = {}, gradeableByOutcome = {}, gradeableBy = {};
    const distance = {}, byTolerance = { 0: 0, 1: 0, 2: 0 };
    let inTracked = 0, withKey = 0, withCapture = 0, withFullTime = 0, covered = 0, gradeable = 0, trackedNoKey = 0, keyUntracked = 0;
    const eventsTrackedNoKey = new Set(), eventsGradeable = new Set(), eventsTracked = new Set();
    for (const r of L.rows) {
      const e = isObj(r?.event) ? r.event : {};
      const id = e.id === undefined || e.id === null ? null : String(e.id);
      const isTracked = tracked ? tracked.has(String(e.league_id)) : null;
      if (isTracked) { inTracked++; if (id) eventsTracked.add(id); }
      const key = id !== null ? byEvent.get(id) : undefined;
      const hasKey = Boolean(key && key.files.has('incidents.json'));
      if (hasKey) withKey++;
      if (isTracked && !hasKey) { trackedNoKey++; if (id) eventsTrackedNoKey.add(id); }
      if (!isTracked && hasKey) keyUntracked++;
      const cap = id !== null ? caps.get(id) : undefined;
      if (cap && cap.ok) { withCapture++; if (cap.fullTime) withFullTime++; }
      const outcome = r?.outcome;
      let reason;
      if (id === null) reason = 'the call has no event id';
      else if (outcome !== 'hit' && outcome !== 'miss') reason = `outcome is ${outcome === undefined ? '(absent)' : outcome}`;
      else if (num(r?.resolved_minute) === null) reason = 'no resolved_minute';
      else if (!hasKey) reason = 'no incidents.json in R2 for the event';
      else if (!R.has(id)) reason = 'incidents.json not read (cap or deadline)';
      else if (!cap) reason = `incidents.json read failed (status ${R.get(id).status ?? 'none'})`;
      else if (!cap.ok) reason = `incidents.json unreadable: ${cap.why}`;
      else if (!covers(r, cap)) reason = `the capture did not see full time and holds no goal within ${WITNESS_TOLERANCE} minute of the resolution`;
      else reason = null;
      if (cap && cap.ok && covers(r, cap)) covered++;
      // every call with a readable capture, a hit or miss and a resolved minute: how far is the nearest goal in the capture, by state
      if (cap && cap.ok && (outcome === 'hit' || outcome === 'miss') && num(r?.resolved_minute) !== null) {
        const d = goalDistance(r, cap);
        if (!distance[cap.state]) distance[cap.state] = {};
        inc(distance[cap.state], d === null ? 'no goal in the capture' : d >= 3 ? '3+' : String(d));
        for (const tol of [0, 1, 2]) if (cap.fullTime || (d !== null && d <= tol)) byTolerance[tol]++;
      }
      if (reason === null) {
        gradeable++; eventsGradeable.add(id); inc(gradeableBy, cap.fullTime ? 'full time' : `a goal within ${WITNESS_TOLERANCE} minute`);
        inc(gradeableBySlug, [...key.slugs].sort().join('+')); inc(gradeableByMonth, monthOf(r?.called_at)); inc(gradeableByOutcome, outcome);
      } else inc(reasons, reason);
    }
    A.calls = {
      // ANSWERED only when nothing the answer rests on was left out. A read that failed is an answer (its reason is counted); a read that was never made is not.
      partialBecause: [!L.complete && 'the ledger is partial', !(r2 && r2.complete) && 'the R2 listing is partial', ctx.capped && 'the read cap was reached', blockedReads > 0 && 'reads were blocked by the run deadline'].filter(Boolean),
      verdict: L.complete && r2 && r2.complete && !ctx.capped && blockedReads === 0 ? 'ANSWERED' : 'PARTIAL',
      uniqueCalls: L.rows.length,
      inTrackedLeague: tracked ? inTracked : null, distinctEventsInTrackedLeague: tracked ? eventsTracked.size : null,
      trackedLeagueWithoutIncidentsKey: tracked ? trackedNoKey : null, distinctTrackedEventsWithoutKey: tracked ? eventsTrackedNoKey.size : null,
      withIncidentsKeyOutsideTrackedLeagues: tracked ? keyUntracked : null,
      withIncidentsKey: withKey, withReadableCapture: withCapture, withFullTimeCapture: withFullTime, coveredByCapture: covered,
      gradeable, distinctEventsGradeable: eventsGradeable.size,
      gradeableBy, gradeableByOutcome, gradeableBySlug, gradeableByMonth,
      // nearest goal in the capture to the ledger's resolved_minute, over hit/miss calls with a readable capture. For full-time
      // captures (complete goal lists) this measures whether resolved_minute is the minute of a goal at all.
      goalDistanceByCaptureState: distance,
      gradeableIfToleranceWere: { 0: byTolerance[0], 1: byTolerance[1], 2: byTolerance[2] },
      notGradeableBecause: reasons,
      note: `gradeable = outcome hit or miss, a resolved_minute, an incidents.json that was read and either saw full time or holds a goal within ${WITNESS_TOLERANCE} minute of resolved_minute. A period row's minute is not a clock. It says nothing about whether the vendor was right.`,
    };
  }

  // the headline, with every denominator (Rule 91)
  const c = A.calls, l = A.ledger, q = A.r2;
  A.coverageLine = [
    `ledger: ${l.uniqueCalls ?? 'not read'} unique calls (${l.verdict}${l.reportedFirst != null ? `, reported ${l.reportedFirst} then ${l.reportedLast}` : ''}, ${l.pages ?? '?'} pages, ${l.duplicates ?? '?'} duplicates)`,
    `R2: ${q.verdict === 'UNKNOWN' ? 'not read' : `${q.keys} keys, ${q.eventsWithIncidents} events with incidents.json (${q.verdict})`}`,
    `reads: ${A.reads.parsed} parsed of ${A.reads.attempted} attempted${A.reads.capped ? ' (CAPPED)' : ''}`,
    `calls: ${c.gradeable ?? 'n/a'} gradeable of ${c.uniqueCalls ?? 'n/a'}${c.inTrackedLeague != null ? ` (${c.inTrackedLeague} in a tracked league, ${c.withIncidentsKey} with an incidents.json, ${c.withFullTimeCapture} with a full-time capture)` : ''}`,
    `BSD calls ${ctx.callsMade ?? '?'}/${ctx.callBudget ?? '?'}`,
  ].join(' | ');
  return A;
}

// ---------------------------------------------------------------- the one place that talks to the network
const PAGE = 200;

async function main() {
  const BASE = process.env.BSD_BASE || 'https://sports.bzzoiro.com';
  const RELAY = process.env.RELAY_URL || 'https://field-relay-nba.jeffunglesbee.workers.dev';
  const TOKEN_RAW = process.env.BSD_API_TOKEN;
  const TOKEN = typeof TOKEN_RAW === 'string' ? TOKEN_RAW.trim() : undefined;
  if (TOKEN && /[^\x21-\x7e]/.test(TOKEN)) {
    console.error('BSD_API_TOKEN contains whitespace or a non-printable character; refusing to send it anywhere');
    process.exit(1);
  }
  const TS = new Date().toISOString();
  const CALL_BUDGET = positiveInt(process.env.CALL_BUDGET, 16);
  const READ_CAP = positiveInt(process.env.READ_CAP, 1500);
  const DEADLINE_MS = positiveInt(process.env.RUN_DEADLINE_SECONDS, 420) * 1000;
  const START = Date.now();
  const out = { ts: TS, base: BASE, relay: RELAY, tokenPresent: Boolean(TOKEN), callBudget: CALL_BUDGET, readCap: READ_CAP, deadlineSeconds: DEADLINE_MS / 1000 };

  let bsdCalls = 0, stopped = null;
  const log = [];
  const timedOut = () => Date.now() - START > DEADLINE_MS;

  async function bsd(key, path) {
    const rec = { key, path };
    if (!TOKEN) rec.blocked = 'no BSD_API_TOKEN in env';
    else if (stopped) rec.blocked = `run stopped on ${stopped}`;
    else if (bsdCalls >= CALL_BUDGET) rec.blocked = `call budget ${CALL_BUDGET} exhausted`;
    else if (timedOut()) rec.blocked = `run deadline ${DEADLINE_MS / 1000} s passed`;
    if (rec.blocked) { log.push({ key, status: null, blocked: rec.blocked }); return rec; }
    bsdCalls++;
    const t0 = Date.now();
    try {
      const r = await fetch(`${BASE}${path}`, { headers: { Authorization: `Token ${TOKEN}`, Accept: 'application/json' }, redirect: 'error', signal: AbortSignal.timeout(30000) });
      rec.status = r.status;
      if (r.status === 429 || r.status === 401) stopped = String(r.status);
      const text = await r.text();
      try { rec.json = JSON.parse(text); } catch (_) { rec.nonJson = text.slice(0, 120); }
    } catch (e) { rec.error = String(e.message || e); }
    rec.ms = Date.now() - t0;
    log.push({ key, status: rec.status ?? null, ms: rec.ms, error: rec.error });
    console.log(`bsd ${bsdCalls}/${CALL_BUDGET} ${key} -> ${rec.status ?? 'no response'} in ${rec.ms} ms`);
    return rec;
  }
  async function relay(path) {
    const rec = { path };
    if (timedOut()) { rec.blocked = `run deadline ${DEADLINE_MS / 1000} s passed`; return rec; }
    try {
      const r = await fetch(`${RELAY}${path}`, { redirect: 'error', signal: AbortSignal.timeout(30000) });
      rec.status = r.status;
      const text = await r.text();
      try { rec.json = JSON.parse(text); } catch (_) { rec.nonJson = text.slice(0, 120); }
    } catch (e) { rec.error = String(e.message || e); }
    return rec;
  }

  console.log(`=== bsd-next-goal-census  base=${BASE}  relay=${RELAY}  utc=${TS}  bsd budget=${CALL_BUDGET}  read cap=${READ_CAP} ===`);
  if (!TOKEN) console.log('!! BSD_API_TOKEN absent: the ledger cannot be read, so every count below is UNKNOWN, not zero.');

  // ---- the ledger: count first, pages, count last
  const first = await bsd('count_first', '/api/v2/next-goal/calls/?limit=1');
  const reportedFirst = first.status === 200 && isObj(first.json) ? num(first.json.count) : null;
  const pages = [];
  let ledger = { why: first.blocked || (first.status !== 200 ? `the ledger answered ${first.status ?? first.error ?? 'nothing'}` : 'the ledger gave no count') };
  if (reportedFirst !== null) {
    const want = Math.ceil(reportedFirst / PAGE) + 1;       // one page of slack: the ledger grows while it is paged
    let stoppedWhy = null;
    for (let i = 0; i < want; i++) {
      const p = await bsd(`page_${i}`, `/api/v2/next-goal/calls/?limit=${PAGE}&offset=${i * PAGE}`);
      const rows = ngRows(p);
      if (rows === null) { stoppedWhy = `ledger page ${i} answered ${p.blocked || p.status || p.error || 'nothing'}`; break; }
      pages.push(rows);
      if (rows.length < PAGE) break;
    }
    const last = await bsd('count_last', '/api/v2/next-goal/calls/?limit=1');
    const reportedLast = last.status === 200 && isObj(last.json) ? num(last.json.count) : null;
    const d = dedupeLedger(pages);
    const complete = !stoppedWhy && reportedLast !== null && d.rows.length >= reportedFirst;
    ledger = { rows: d.rows, duplicates: d.duplicates, noId: d.noId, pages: pages.length, reportedFirst, reportedLast, complete,
      why: complete ? null : stoppedWhy || (reportedLast === null ? 'the closing count was not read' : `${d.rows.length} unique rows of ${reportedFirst} reported`) };
  }

  // ---- R2 through the relay
  const r2 = await listAll(relay);
  const trackedLeagueIds = fieldLeagueIdsFromSource();

  // ---- read incidents.json for the ledger's events that have one
  const wantIds = new Set();
  if (ledger.rows) for (const r of ledger.rows) { const id = r && r.event && r.event.id; if (id !== undefined && id !== null) wantIds.add(String(id)); }
  const slugOf = new Map();
  for (const k of r2.keys) { const p = parseKey(k && k.key); if (p && p.file === 'incidents.json' && wantIds.has(p.id) && !slugOf.has(p.id)) slugOf.set(p.id, p.slug); }
  const todo = [...slugOf.entries()];
  const reads = new Map();
  let capped = false, next = 0;
  async function worker() {
    while (next < todo.length) {
      if (next >= READ_CAP) { capped = true; return; }
      const [id, slug] = todo[next++];
      const rd = await relay(`/bsd/r2/read?key=${encodeURIComponent(`bsd/${slug}/${id}/incidents.json`)}`);
      reads.set(id, { status: rd.status ?? null, json: rd.json, error: rd.error, blocked: rd.blocked });
    }
  }
  await Promise.all(Array.from({ length: 6 }, worker));

  const ctx = { trackedLeagueIds, capped, callsMade: bsdCalls, callBudget: CALL_BUDGET };
  let analysis, analysisError = null;
  try { analysis = analyseCensus({ ledger, r2, reads, ctx }); } catch (e) {
    analysisError = String(e && e.stack ? e.stack : e).split('\n').slice(0, 4).join(' | ');
    analysis = { coverageLine: `ANALYSIS FAILED: ${analysisError.slice(0, 160)}` };
  }

  Object.assign(out, {
    bsdCallsMade: bsdCalls, stopped, analysisError, readsMade: reads.size,
    // -latest.json advances only on a census that left nothing out: a partial one is evidence of why, kept under its stamp,
    // and must not stand in for a count under a name that looks current
    reachedTarget: Boolean(analysis.calls) && analysis.calls.verdict === 'ANSWERED',
    coverageLine: analysis.coverageLine, bsdLog: log, analysis,
  });
  const body = JSON.stringify(out, null, 2);
  refuseIfTokenInside(body, TOKEN);
  console.log('\n=== COVERAGE ===\n' + out.coverageLine);
  const c = analysis.calls || {};
  console.log(`\n=== RESULT ===\nledger ${analysis.ledger && analysis.ledger.verdict} | r2 ${analysis.r2 && analysis.r2.verdict} | calls ${c.verdict}${c.gradeable != null ? ` | gradeable ${c.gradeable} of ${c.uniqueCalls}` : ''}${analysisError ? ` | ANALYSIS_ERROR ${analysisError.slice(0, 120)}` : ''}`);

  fs.mkdirSync('outbox', { recursive: true });
  const stamp = TS.replace(/[:.]/g, '-');
  fs.writeFileSync(`outbox/bsd-next-goal-census-${stamp}.json`, body);
  if (out.reachedTarget) { fs.writeFileSync('outbox/bsd-next-goal-census-latest.json', body); console.log(`\nwrote outbox/bsd-next-goal-census-${stamp}.json and -latest.json`); }
  else console.log(`\nwrote outbox/bsd-next-goal-census-${stamp}.json; NOT advancing -latest.json (the ledger or the R2 listing was not read)`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().then(() => process.exit(0)).catch((e) => { console.error('bsd-next-goal-census failed:', e.stack || e.message); process.exit(1); });
}
