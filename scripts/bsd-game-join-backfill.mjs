#!/usr/bin/env node
// The owner-approved backfill (2026-11-24, "Backfill approved") of option (a) in the 2026-11-15 addendum of
// docs/CC-CMD-2026-10-28-bsd-join-aliases-beyond-the-fixture-dates.md: the soccer archive rows of dates that nothing visits (the scheduled
// join looks only at today..today+3 and yesterday) get their `bsd_event_id`, a few dates a day, through POST /admin/bsd-game-join.
//
// WHAT IT WRITES. Only through the deployed route, which is the same function the scheduled tick runs: it fills `bsd_event_id` where it IS
// NULL, never overwrites a value, goes through reconcile() and logs one change_log row per write (source 'bsd_game_join'). Reversible:
// UPDATE the rows named by those change_log rows back to NULL. It reads BSD through the Worker (the Worker holds the BSD token; this runner
// holds only RELAY_SHARED_SECRET), at most 24 upstream pages per date, and refuses to write for a day whose events it did not read in full.
//
// HOW IT STAYS SMALL AND SAFE.
//   - Survey first (reads only): /context/date for every day FROM..TO; a day is pending when a soccer row of the join's six sports has no
//     bsd_event_id. A day that cannot be read is "unread", never "clean". The oldest pending days are chosen, at most MAX_DATES.
//   - One POST per chosen date; each answer is classified; each is VERIFIED by re-reading /context/date (cache-busted) and checking that
//     the pending count fell by exactly what the route said it wrote. A mismatch, a refusal, a 429, two failed passes in a row, or the
//     upstream-page cap stops the run. Nothing after a stop is written.
//   - A date whose pass ANSWERED but left rows pending (BSD has no event for them, or none matched) is recorded in the state file and is not
//     asked again: the scheduled run would otherwise re-spend BSD pages on it every day. A date whose pass FAILED is not recorded, so it is retried.
//   - Complete when no un-attempted pending day is left and no day is unread: a marker file says so and the workflow stops running.
//
// BSD's request budget is unknown (no RateLimit header; its own pages say both 7,500 and 100 a day). MAX_DATES (default 5, about 25 pages) and
// PAGE_CAP (default 40) are how that is respected; the first real run's upstreamPages is the first measurement of what a date costs.
//
// SCOPE. The approved scope is the addendum's: the five European leagues (197 rows over 34 dates on 2026-11-15; MLS was explicitly left out as "a
// different list of clubs"). A date is CHOSEN when one of those five leagues' rows on it is pending. The route joins every soccer row of a date,
// MLS included, so an MLS row on a chosen date is joined too; an MLS-only date is not chosen, and is counted in the artifact as out of scope.
// INCLUDE_MLS=true widens the choice to MLS-only dates (the owner said "include MLS" on 2026-11-24; the scheduled run sets it).
//
// POSTSEASON. `games.postseason` holds tournaments and playoffs filed under sport 'MLS' (Leagues Cup, the CONCACAF Champions Cup, MLS Cup). A date is chosen
// only when a row of the SCOPE sports is pending in `games.regular`, the leagues' own matches, unless INCLUDE_POSTSEASON=true. Why, measured 2026-11-24: of
// the postseason MLS rows before November, 0 of ~297 were ever joined (not by the scheduled tick, which tried them for real), and the backfill's own tests on
// six such dates (3 in February, 3 in August) read 146 to 174 BSD events a day and matched 0 of 24 rows. The route still joins a postseason row on a chosen date.
//
// COMPLETE means the SCHEDULED scope is done: FROM at or before the default FROM, TO at or after the default TO, MLS included. A narrower range that has
// nothing left is `rangeComplete` only. (The first narrow test run wrote the marker, and the schedule would have stopped for good: found 2026-11-24.)
//
// Usage: RELAY_SHARED_SECRET=... [FROM=2026-02-01 TO=2026-10-23 MAX_DATES=5 PAGE_CAP=40 DRY_RUN=true INCLUDE_MLS=false INCLUDE_POSTSEASON=false] node scripts/bsd-game-join-backfill.mjs
// DRY_RUN=true reads and plans and writes nothing to the relay; it needs no secret.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { BSD_SOCCER_SPORTS } from '../src/bsd-game-join.js';
import { daysBetween, splitRows, pendingOf, planDates, outcomeOf, verifyOf, stopAfter } from './bsd-backfill-lib.mjs';

const RELAY = process.env.RELAY_URL || 'https://field-relay-nba.jeffunglesbee.workers.dev';
const DEFAULT_FROM = '2026-02-01';   // the earliest date with an unjoined soccer row in either table (D1, 2026-11-24: February, MLS tournament rows)
const DEFAULT_TO = '2026-10-23';     // the day before the first date the scheduled join has covered itself
const FETCH_TIMEOUT_MS = 30000;
const POST_TIMEOUT_MS = 90000;
const ANSWERED = new Set(['joined', 'none-matched', 'bsd-has-no-events', 'nothing-pending']);   // a pass that answered: not retried tomorrow
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

function fail(msg, code = 1) { console.error(msg); process.exit(code); }
function intEnv(name, dflt, min, max) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return dflt;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < min || n > max) fail(`${name} must be a whole number from ${min} to ${max}, got ${JSON.stringify(raw)}`);
  return n;
}
function dayEnv(name, dflt) {
  const raw = process.env[name];
  const v = raw === undefined || raw === '' ? dflt : raw;
  if (daysBetween(v, v) === null) fail(`${name} must be a real YYYY-MM-DD day, got ${JSON.stringify(v)}`);
  return v;
}

async function readDay(day, bust) {
  const url = `${RELAY}/context/date/${day}${bust ? `?v=${Date.now()}` : ''}`;
  try {
    const r = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (r.status !== 200) { await r.text(); return { status: r.status, rows: null }; }
    let json;
    try { json = JSON.parse(await r.text()); } catch (_) { return { status: r.status, rows: null }; }
    const sp = splitRows(json);
    return { status: r.status, rows: sp === null ? null : sp.regular.concat(sp.postseason), regular: sp === null ? null : sp.regular };
  } catch (e) { return { status: null, rows: null, error: String(e && e.message ? e.message : e).slice(0, 80) }; }
}

async function post(date, secret) {
  try {
    const r = await fetch(`${RELAY}/admin/bsd-game-join`, { method: 'POST', redirect: 'manual', headers: { 'Content-Type': 'application/json', 'X-FIELD-Relay': secret }, body: JSON.stringify({ date }), signal: AbortSignal.timeout(POST_TIMEOUT_MS) });
    const text = await r.text();
    let body;
    try { body = JSON.parse(text); } catch (_) { body = { ok: false, reason: `not JSON: ${text.slice(0, 60)}` }; }
    return { status: r.status, ...(isObj(body) ? body : { ok: false }) };
  } catch (e) { return { status: null, ok: false, reason: `request failed: ${String(e && e.message ? e.message : e).slice(0, 60)}` }; }
}

const num = (v) => (Number.isInteger(v) && v >= 0 ? v : null);
const slim = (resp) => ({
  status: resp.status, ok: resp.ok === true, reason: typeof resp.reason === 'string' ? resp.reason.slice(0, 120) : null,
  pending: num(resp.pending), written: num(resp.written), joined: num(resp.joined), ambiguous: num(resp.ambiguous), refusedKickoff: num(resp.refusedKickoff),
  unjudgedKickoff: num(resp.unjudgedKickoff), eventsRead: num(resp.eventsRead), upstreamPages: num(resp.upstreamPages), cacheHits: num(resp.cacheHits),
  unmatched: Array.isArray(resp.unmatched) ? resp.unmatched.filter((x) => typeof x === 'string').slice(0, 30).map((x) => x.slice(0, 120)) : [],
});

function loadState() {
  const f = 'outbox/bsd-join-backfill-state.json';
  if (!fs.existsSync(f)) return { attempted: {} };
  const j = JSON.parse(fs.readFileSync(f, 'utf8'));
  if (!isObj(j) || !isObj(j.attempted)) fail(`${f} is not the state shape`);
  return j;
}

async function main() {
  const DRY = process.env.DRY_RUN === undefined || process.env.DRY_RUN === '' ? false : process.env.DRY_RUN === 'true' ? true : process.env.DRY_RUN === 'false' ? false : fail('DRY_RUN must be true or false');
  const FROM = dayEnv('FROM', DEFAULT_FROM);
  const TO = dayEnv('TO', DEFAULT_TO);
  const MAX_DATES = intEnv('MAX_DATES', 5, 1, 10);
  const PAGE_CAP = intEnv('PAGE_CAP', 40, 1, 200);
  const latestAllowed = new Date(Date.now() - 2 * 86400000).toISOString().slice(0, 10);   // the scheduled join owns yesterday and later
  if (TO > latestAllowed) fail(`TO ${TO} is later than ${latestAllowed}: yesterday and later belong to the scheduled join`);
  const days = daysBetween(FROM, TO, 400);
  if (days === null) fail(`FROM ${FROM} to TO ${TO} is not a range of 1 to 400 days`);
  const INCLUDE_MLS = process.env.INCLUDE_MLS === undefined || process.env.INCLUDE_MLS === '' ? false : process.env.INCLUDE_MLS === 'true' ? true : process.env.INCLUDE_MLS === 'false' ? false : fail('INCLUDE_MLS must be true or false');
  const INCLUDE_POSTSEASON = process.env.INCLUDE_POSTSEASON === undefined || process.env.INCLUDE_POSTSEASON === '' ? false : process.env.INCLUDE_POSTSEASON === 'true' ? true : process.env.INCLUDE_POSTSEASON === 'false' ? false : fail('INCLUDE_POSTSEASON must be true or false');
  const SCOPE_SPORTS = INCLUDE_MLS ? BSD_SOCCER_SPORTS : BSD_SOCCER_SPORTS.filter((s) => s !== 'MLS');
  const secret = process.env.RELAY_SHARED_SECRET;
  if (!DRY && (typeof secret !== 'string' || secret === '')) fail('RELAY_SHARED_SECRET is not set (no default: an unset secret fails loudly, not as a quiet 401)', 2);

  const TS = new Date().toISOString();
  const state = loadState();
  console.log(`=== bsd-game-join-backfill  utc=${TS}  ${DRY ? 'DRY RUN (nothing is written)' : 'WRITES'}  ${FROM}..${TO} (${days.length} days)  max dates ${MAX_DATES}  page cap ${PAGE_CAP}  scope ${SCOPE_SPORTS.join(', ')}  relay=${RELAY} ===`);

  // ---- survey: reads only
  const survey = new Map();
  const surveyStatuses = Object.create(null);
  let next = 0;
  await Promise.all(Array.from({ length: 4 }, async () => {
    while (next < days.length) {
      const day = days[next++];
      const rd = await readDay(day, false);
      const k = String(rd.status);
      surveyStatuses[k] = (surveyStatuses[k] === undefined ? 0 : surveyStatuses[k]) + 1;
      survey.set(day, rd.rows === null ? null : { ...pendingOf(rd.rows, BSD_SOCCER_SPORTS), scope: pendingOf(INCLUDE_POSTSEASON ? rd.rows : rd.regular, SCOPE_SPORTS).pending });
    }
  }));
  // a day already attempted whose pass answered is not asked again: it is reported as stuck, not re-planned
  const eligible = new Map();
  const stuck = [];
  for (const [d, v] of survey) {
    if (v !== null && v.scope > 0 && state.attempted[d] !== undefined) { stuck.push(d); eligible.set(d, { pending: 0 }); } else eligible.set(d, v === null ? null : { pending: v.scope });
  }
  stuck.sort();
  const plan = planDates({ survey: eligible, maxDates: MAX_DATES });
  const totalPendingRows = [...survey.values()].reduce((a, v) => a + (v === null ? 0 : v.pending), 0);
  const outOfScope = [...survey.values()].filter((v) => v !== null && v.scope === 0 && v.pending > 0);   // pending rows only in sports this run is not asked to chase
  console.log(`survey: ${plan.readDays} of ${days.length} days read, ${plan.pendingDays} days still to attempt (${plan.pendingRows} rows), ${stuck.length} days attempted and still pending, ${plan.unread.length} unread`);
  console.log(`chosen (oldest first): ${plan.chosen.join(', ') || '(none)'}`);

  const out = {
    ts: TS, dryRun: DRY, relay: RELAY, from: FROM, to: TO, maxDates: MAX_DATES, pageCap: PAGE_CAP,
    survey: { daysInRange: days.length, daysRead: plan.readDays, unreadDays: plan.unread, statuses: surveyStatuses, daysToAttempt: plan.pendingDays, rowsToAttempt: plan.pendingRows, attemptedStillPending: stuck.length, pendingRowsAllDays: totalPendingRows, scopeSports: SCOPE_SPORTS, includePostseason: INCLUDE_POSTSEASON, outOfScopeDays: outOfScope.length, outOfScopeRows: outOfScope.reduce((a, v) => a + v.pending, 0) },
    chosen: plan.chosen, dates: [], pagesUsed: 0, written: 0, stoppedBecause: null, remainingToAttempt: DRY ? plan.pendingDays : plan.remainingAfter, complete: false,
    runner: { gitSha: typeof process.env.GITHUB_SHA === 'string' && process.env.GITHUB_SHA !== '' ? process.env.GITHUB_SHA : null, runId: typeof process.env.GITHUB_RUN_ID === 'string' && process.env.GITHUB_RUN_ID !== '' ? process.env.GITHUB_RUN_ID : null,
      scriptSha256: crypto.createHash('sha256').update(fs.readFileSync(fileURLToPath(import.meta.url))).digest('hex'), libSha256: crypto.createHash('sha256').update(fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'bsd-backfill-lib.mjs'))).digest('hex') },
  };
  const stamp = TS.replace(/[:.]/g, '-');
  fs.mkdirSync('outbox', { recursive: true });
  const save = () => {
    const body = JSON.stringify(out, null, 2);
    if (typeof secret === 'string' && secret !== '' && body.includes(secret)) fail('the artifact would contain the relay secret: refusing to write it');
    fs.writeFileSync(`outbox/bsd-join-backfill-${stamp}.json`, body);
    fs.writeFileSync('outbox/bsd-join-backfill-latest.json', body);
  };

  // ---- one POST per chosen date, each verified
  if (!DRY) {
    const outcomes = [];
    for (const date of plan.chosen) {
      const before = survey.get(date);
      const resp = await post(date, secret);
      const outcome = outcomeOf(resp);
      outcomes.push(outcome);
      const written = outcome === 'joined' ? num(resp.written) : 0;
      const after = await readDay(date, true);
      const pendingAfter = after.rows === null ? null : pendingOf(after.rows, BSD_SOCCER_SPORTS).pending;
      const verify = pendingAfter === null ? { verified: null, why: 'the day could not be read again' } : verifyOf({ pendingBefore: before.pending, pendingAfter, written: written === null ? 0 : written });
      const pages = num(resp.upstreamPages);
      out.pagesUsed += pages === null ? 0 : pages;
      out.written += written === null ? 0 : written;
      const rec = { date, outcome, pendingBefore: before.pending, pendingBeforeBySport: before.bySport, pendingAfter, verify, response: slim(resp) };
      out.dates.push(rec);
      if (ANSWERED.has(outcome)) {
        state.attempted[date] = { at: new Date().toISOString(), outcome, pendingBefore: before.pending, pendingAfter, written: written === null ? 0 : written, unmatched: rec.response.unmatched };
        fs.writeFileSync('outbox/bsd-join-backfill-state.json', JSON.stringify(state, null, 2));
      }
      console.log(`${date}  ${outcome}  pending ${before.pending} -> ${pendingAfter === null ? '?' : pendingAfter}  written ${written === null ? '?' : written}  pages ${pages === null ? '?' : pages}  verified ${verify.verified}${verify.verified === false ? ` (${verify.why})` : ''}`);
      save();
      const stop = stopAfter({ outcomes, verified: verify.verified, pagesUsed: out.pagesUsed, pageCap: PAGE_CAP, remaining: plan.chosen.length - out.dates.length });
      if (stop !== null) { out.stoppedBecause = stop; console.log(`STOP: ${stop}`); break; }
    }
    const attemptedNow = out.dates.filter((d) => ANSWERED.has(d.outcome)).length;
    out.remainingToAttempt = plan.pendingDays - attemptedNow;
    out.rangeComplete = out.stoppedBecause === null && out.remainingToAttempt === 0 && plan.unread.length === 0 && days.length > 0;
    // the marker stops the SCHEDULE, so it is written only for the scheduled scope: a narrower range with nothing left proves nothing about the rest
    out.complete = out.rangeComplete && FROM <= DEFAULT_FROM && TO >= DEFAULT_TO && INCLUDE_MLS;
    if (out.rangeComplete && !out.complete) console.log(`range complete, but not the scheduled scope (${DEFAULT_FROM}..${DEFAULT_TO} with MLS): no marker`);
    if (out.complete) {
      fs.writeFileSync('outbox/bsd-join-backfill-complete.json', JSON.stringify({ at: TS, from: FROM, to: TO, attempted: Object.keys(state.attempted).length,
        stillPending: Object.entries(state.attempted).filter(([, v]) => v.pendingAfter > 0).map(([d, v]) => ({ date: d, rows: v.pendingAfter, unmatched: v.unmatched })) }, null, 2));
      console.log('COMPLETE: no un-attempted pending day is left and none is unread; wrote the marker');
    }
  }
  out.coverageLine = `${DRY ? 'DRY RUN: ' : ''}${plan.readDays} of ${days.length} days read (${plan.unread.length} unread) | scope ${SCOPE_SPORTS.length} sports${INCLUDE_MLS ? ' (MLS included)' : ' (MLS not included)'}, ${INCLUDE_POSTSEASON ? 'postseason rows count' : 'regular-season rows choose a date'}: to attempt ${plan.pendingDays} days / ${plan.pendingRows} rows, ${stuck.length} days attempted before and still pending | out of scope (pending rows in sports outside the scope only) ${outOfScope.length} days / ${outOfScope.reduce((a, v) => a + v.pending, 0)} rows | this run: ${out.dates.length} dates posted, ${out.written} rows written, ${out.pagesUsed} upstream pages (cap ${PAGE_CAP}), ${out.dates.filter((d) => d.verify.verified === true).length} verified | ${out.stoppedBecause === null ? 'no stop' : `STOPPED: ${out.stoppedBecause}`} | remaining to attempt ${out.remainingToAttempt}${out.complete ? ' | COMPLETE' : out.rangeComplete ? ' | range complete, not the scheduled scope' : ''}`;
  save();
  console.log('\n=== COVERAGE ===\n' + out.coverageLine);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().then(() => process.exit(0)).catch((e) => { const s = process.env.RELAY_SHARED_SECRET; console.error('bsd-game-join-backfill failed:', typeof s === 'string' && s.length >= 8 ? String(e && e.stack ? e.stack : e).split(s).join('[redacted]') : (e && e.stack ? e.stack : e)); process.exit(1); });
}
