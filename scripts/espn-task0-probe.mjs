#!/usr/bin/env node
// Task 0 (no token) of field-laboratory docs/CC-CMD-2026-11-23-bsd-next-goal-independent-reference.md, run on this repository's runner.
//
//   E1  does ESPN publish, for a finished soccer match in the nine R2 leagues, a goal list with a scoring team that is one of the two
//       competitors, a clock, and an own-goal flag?  Per league: scoreboard reads, one DAY each, walking back from yesterday until a day
//       holds a finished match with a score (at most 10 days, so at most 90 reads in all), then ONE summary read of that match. A SHAPE
//       PROBE: the grade will take its ESPN ids from the archive rows, not from here. One day per read because ESPN's scoreboard refuses a
//       date RANGE with HTTP 400 "Failed to get events endpoint" (run 45442799799 and its successor; docs/CC-CMD-2026-10-14-espn-host-flip.md
//       says the same in its table: "One read per league per day"). Scoreboards from site.api.espn.com and summaries from
//       site.web.api.espn.com, the two hosts the relay itself reads them from.
//   E2a can a runner read the archive rows that carry the BSD id, and do they carry the ESPN id as well?  One read of
//       /context/date/2026-10-25, by sport label: rows, rows with a bsd id, rows with an espn id, rows with both. (A read of
//       2026-10-25 by hand on 2026-11-24 showed MLS rows with a bsd id and a NULL espn id; this counts it instead of trusting the glance.)
//
// The league slugs are read from this repository's own registry text (src/index.js), not written here from memory; a slug that is not in
// it stops the run. ESPN is unauthenticated: no token is read or sent. A 403 or a 429 stops the run (CLAUDE.md Rule 78), a redirect is
// read as a status and never followed, every fetch has a timeout (the 2026-11-23 stall finding), and reads are one second apart.
// The artifact holds field names, counts, statuses and ESPN event ids (public); no team, player or text is copied out of a payload.
//
// ANCHOR_DATE (YYYY-MM-DD, default: yesterday UTC) is the first day read; the walk goes back from it. Pointed at an old date it answers whether ESPN still carries goal rows
// for the matches the next-goal grade covers (August to November), which the default run, always the last ten days, cannot. An anchored run does NOT advance -latest.json.
//
// Usage: [ANCHOR_DATE=2026-08-30] node scripts/espn-task0-probe.mjs      (writes outbox/espn-task0-<stamp>.json, and -latest.json when the target was reached, unanchored)

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { pathToFileURL, fileURLToPath } from 'node:url';
import {
  registryFromSource, pickRecentFinished, competitorsOf, finalTotalOf, goalShape, inventory, isGoalRow, rowsOfDay, labelStats,
} from './espn-task0-lib.mjs';

const R2_LEAGUES = ['epl', 'mls', 'ucl', 'eflchamp', 'laliga', 'europa', 'seriea', 'bundesliga', 'ligue1'];
const ESPN_OVERRIDE = typeof process.env.ESPN_BASE === 'string' && process.env.ESPN_BASE !== '' ? process.env.ESPN_BASE : null;   // the check points both at one stub
const SCOREBOARD = ESPN_OVERRIDE !== null ? ESPN_OVERRIDE : 'https://site.api.espn.com/apis/site/v2/sports/soccer';
const SUMMARY = ESPN_OVERRIDE !== null ? ESPN_OVERRIDE : 'https://site.web.api.espn.com/apis/site/v2/sports/soccer';
const RELAY = process.env.RELAY_URL || 'https://field-relay-nba.jeffunglesbee.workers.dev';
const E2A_DAY = '2026-10-25';
const MAX_DAYS_BACK = 10;
const ANCHOR_RAW = typeof process.env.ANCHOR_DATE === 'string' && process.env.ANCHOR_DATE !== '' ? process.env.ANCHOR_DATE : null;
const FETCH_TIMEOUT_MS = 30000;
const SPACING_MS = /^\d{1,4}$/.test(String(process.env.ESPN_SPACING_MS)) ? Number(process.env.ESPN_SPACING_MS) : 1000;   // the check shortens it; a run does not
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ymd = (d) => d.toISOString().slice(0, 10).replace(/-/g, '');

const requests = [];
let stopped = null;

async function get(label, url, { spaced = true } = {}) {
  if (stopped !== null) { requests.push({ label, status: null, blocked: `run stopped on ${stopped}` }); return { blocked: true }; }
  if (spaced) await sleep(SPACING_MS);
  const rec = { label };
  const t0 = Date.now();
  let json;
  try {
    const r = await fetch(url, { redirect: 'manual', headers: { Accept: 'application/json', 'User-Agent': 'FIELD/1.0' }, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    rec.status = r.status;
    rec.contentType = r.headers.get('content-type');
    rec.cacheControl = r.headers.get('cache-control');
    rec.age = r.headers.get('age');
    if (r.status === 403 || r.status === 429) stopped = String(r.status);
    const text = await r.text();
    rec.bytes = text.length;
    if (r.status !== 200) rec.errorBody = text.slice(0, 200);   // a refusal's own words are the diagnosis (ESPN's error text, public)
    try { json = JSON.parse(text); } catch (_) { rec.nonJson = true; }
  } catch (e) { rec.error = String(e && e.message ? e.message : e); }
  rec.ms = Date.now() - t0;
  requests.push(rec);
  console.log(`${label} -> ${rec.status === undefined ? 'no response' : rec.status} (${rec.ms} ms${rec.error ? `, ${rec.error}` : ''})`);
  return { rec, json };
}

function listsOf(ev, summary) {
  const comp = isObj(ev) && Array.isArray(ev.competitions) && isObj(ev.competitions[0]) ? ev.competitions[0] : null;
  const sh = isObj(summary) && isObj(summary.header) && Array.isArray(summary.header.competitions) && isObj(summary.header.competitions[0]) ? summary.header.competitions[0] : null;
  return [
    ['summary.keyEvents', isObj(summary) ? summary.keyEvents : undefined],
    ['scoreboard.competitions[0].details', comp === null ? undefined : comp.details],
    ['summary.header.competitions[0].details', sh === null ? undefined : sh.details],
  ];
}

async function probeLeague(slug, espnLeague, anchorMs) {
  const out = { espnLeague, scoreboard: null, chosen: null, summary: null, lists: {} };
  let ev = null;
  for (let back = 1; back <= MAX_DAYS_BACK && ev === null; back++) {
    const day = new Date(anchorMs - (back - 1) * 86400000);
    const sb = await get(`scoreboard ${slug} -${back}d`, `${SCOREBOARD}/${espnLeague}/scoreboard?dates=${ymd(day)}`);
    if (sb.blocked) return out;
    const events = isObj(sb.json) && Array.isArray(sb.json.events) ? sb.json.events : null;
    const prior = out.scoreboard === null ? 0 : out.scoreboard.reads;
    out.scoreboard = { reads: prior + 1, status: sb.rec.status === undefined ? null : sb.rec.status, events: events === null ? null : events.length, shapeOk: events !== null, daysBack: null };
    // a read that failed ends this league: it is reported as not answered, and no day is skipped over to find a match behind it
    if (events === null || out.scoreboard.status !== 200) return out;
    ev = pickRecentFinished(events);
    if (ev !== null) out.scoreboard.daysBack = back;
  }
  if (ev === null) { out.chosen = null; return out; }
  const competitors = competitorsOf(ev);
  out.chosen = { espnEventId: String(ev.id), date: typeof ev.date === 'string' ? ev.date.slice(0, 10) : null, finalTotal: finalTotalOf(ev), competitors: competitors.length };
  const sm = await get(`summary ${slug}`, `${SUMMARY}/${espnLeague}/summary?event=${encodeURIComponent(String(ev.id))}`);
  if (sm.blocked) return out;
  out.summary = { status: sm.rec.status, shapeOk: isObj(sm.json), topKeys: isObj(sm.json) ? Object.keys(sm.json).filter((k) => /^[A-Za-z][A-Za-z0-9_]{0,31}$/.test(k)).sort() : null };
  const ids = competitors.map((c) => c.id);
  for (const [name, list] of listsOf(ev, sm.json)) {
    if (!Array.isArray(list)) { out.lists[name] = { present: false }; continue; }
    const shape = goalShape(list, { competitorIds: ids, finalTotal: finalTotalOf(ev) });
    out.lists[name] = { present: true, shape, goalRowFields: inventory(list.filter(isGoalRow)) };
  }
  return out;
}

function fileSha(f) { return crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex'); }

async function main() {
  const dir = path.dirname(fileURLToPath(import.meta.url));
  const reg = registryFromSource(fs.readFileSync(path.join(dir, '..', 'src', 'index.js'), 'utf8'));
  const missing = R2_LEAGUES.filter((s) => reg[s] === undefined);
  if (missing.length > 0) { console.error(`the relay registry text has no soccer entry for: ${missing.join(', ')}`); process.exit(1); }
  const TS = new Date().toISOString();
  const today = new Date(TS);
  if (ANCHOR_RAW !== null && (!/^\d{4}-\d{2}-\d{2}$/.test(ANCHOR_RAW) || new Date(`${ANCHOR_RAW}T00:00:00Z`).toISOString().slice(0, 10) !== ANCHOR_RAW || ANCHOR_RAW > ymd(new Date(today.getTime() - 86400000)).replace(/^(\d{4})(\d{2})(\d{2})$/, '$1-$2-$3'))) { console.error(`ANCHOR_DATE must be a real YYYY-MM-DD day no later than yesterday, got ${JSON.stringify(ANCHOR_RAW)}`); process.exit(1); }
  const anchorMs = ANCHOR_RAW === null ? today.getTime() - 86400000 : Date.parse(`${ANCHOR_RAW}T00:00:00Z`);
  console.log(`=== espn-task0-probe  utc=${TS}  leagues=${R2_LEAGUES.length}  walk=${MAX_DAYS_BACK} days back  relay=${RELAY} ===`);

  const leagues = Object.create(null);
  for (const slug of R2_LEAGUES) leagues[slug] = await probeLeague(slug, reg[slug], anchorMs);

  // ---- E2a
  const ctx = await get(`relay /context/date/${E2A_DAY}`, `${RELAY}/context/date/${E2A_DAY}`, { spaced: false });
  let e2a = { status: ctx.rec && ctx.rec.status !== undefined ? ctx.rec.status : null, shapeOk: false };
  if (ctx.json !== undefined) {
    const rows = rowsOfDay(ctx.json);
    if (rows !== null) {
      const stats = labelStats(new Map([[E2A_DAY, rows]]));
      e2a = { status: ctx.rec.status, shapeOk: true, rowKeys: inventory(rows, { maxDepth: 1, maxPaths: 60 }).paths, ...stats };
    }
  }

  // ---- what the leagues say, with every denominator
  // a league is probed only when its scoreboard answered 200 in the shape the probe reads: a refused, failed or blocked read is not "answered"
  const probed = R2_LEAGUES.filter((s) => leagues[s].scoreboard !== null && leagues[s].scoreboard.status === 200 && leagues[s].scoreboard.shapeOk === true);
  const withMatch = probed.filter((s) => leagues[s].chosen !== null);
  const witness = (s) => Object.values(leagues[s].lists).filter((l) => l.present && l.shape.goalRows > 0);
  // a team id that IS one of the two competitors implies a team id was there, so "has a team id" is not tested separately (the mutation harness found it equivalent)
  const e1Holds = (l) => l.shape.teamIdIsACompetitor === l.shape.goalRows && l.shape.withClock === l.shape.goalRows;
  const e1Leagues = withMatch.filter((s) => witness(s).some(e1Holds));
  const listNames = [...new Set(withMatch.flatMap((s) => Object.keys(leagues[s].lists)))].sort();
  // which LIST witnesses E1: the grade will read one of them, and "some list holds" would hide that it is not the one it reads
  const heldByList = Object.fromEntries(listNames.map((n) => [n, withMatch.filter((s) => leagues[s].lists[n] !== undefined && leagues[s].lists[n].present && leagues[s].lists[n].shape.goalRows > 0 && e1Holds(leagues[s].lists[n]))]));
  const equalLeagues = withMatch.filter((s) => witness(s).some((l) => l.shape.goalRowsEqualFinalTotal));
  const ownGoalSeen = withMatch.filter((s) => witness(s).some((l) => l.shape.ownGoalTrue > 0));
  const all200 = requests.length > 0 && requests.every((r) => r.status === 200);
  const reached = stopped === null && probed.length === R2_LEAGUES.length && e2a.shapeOk === true && e2a.status === 200;
  const both = e2a.shapeOk ? Object.values(e2a.byLabel).reduce((a, l) => a + l.withBoth, 0) : null;
  const coverageLine = `ESPN: ${probed.length} of ${R2_LEAGUES.length} league scoreboards answered 200 in the contract shape, ${withMatch.length} had a finished match in the last ${MAX_DAYS_BACK} days (one match each, ${requests.filter((r) => /^summary/.test(r.label)).length} summaries read) | E1 (every goal row has a clock and a team id that is a competitor) held on ${e1Leagues.length} of ${withMatch.length} (by list: ${listNames.map((n) => `${n} ${heldByList[n].length}`).join(', ')}), goal rows equalled the final score on ${equalLeagues.length} of ${withMatch.length}, an own goal was seen in ${ownGoalSeen.length} of ${withMatch.length} | relay /context/date/${E2A_DAY}: ${e2a.status}, ${e2a.shapeOk ? `${e2a.rows} rows, ${both} with BOTH a bsd and an espn id` : 'not the contract shape'} | all requests 200: ${all200}`;

  const out = {
    ts: TS, reachedTarget: reached, stopped,
    notReachedBecause: reached ? null : stopped !== null ? `stopped on ${stopped}` : probed.length < R2_LEAGUES.length ? `${R2_LEAGUES.length - probed.length} league scoreboards not answered 200 in the contract shape` : 'the /context/date read was not the contract shape or not 200',
    runner: { gitSha: typeof process.env.GITHUB_SHA === 'string' && process.env.GITHUB_SHA !== '' ? process.env.GITHUB_SHA : null,
      runId: typeof process.env.GITHUB_RUN_ID === 'string' && process.env.GITHUB_RUN_ID !== '' ? process.env.GITHUB_RUN_ID : null,
      probeSha256: fileSha(fileURLToPath(import.meta.url)), libSha256: fileSha(path.join(dir, 'espn-task0-lib.mjs')) },
    hosts: { scoreboard: 'site.api.espn.com', summary: 'site.web.api.espn.com' }, maxDaysBack: MAX_DAYS_BACK, anchorDate: ANCHOR_RAW, relay: RELAY, requestCount: requests.length,
    coverageLine, e1: { leaguesProbed: probed.length, leaguesWithAFinishedMatch: withMatch.length, e1HeldOn: e1Leagues, heldOnByList: heldByList, goalRowsEqualFinalTotalOn: equalLeagues, ownGoalSeenOn: ownGoalSeen },
    e2a, leagues, requests,
  };
  console.log('\n=== COVERAGE ===\n' + coverageLine);
  fs.mkdirSync('outbox', { recursive: true });
  const stamp = TS.replace(/[:.]/g, '-');
  const body = JSON.stringify(out, null, 2);
  fs.writeFileSync(`outbox/espn-task0-${stamp}.json`, body);
  if (reached && ANCHOR_RAW === null) { fs.writeFileSync('outbox/espn-task0-latest.json', body); console.log(`\nwrote outbox/espn-task0-${stamp}.json and -latest.json`); }
  else console.log(`\nwrote outbox/espn-task0-${stamp}.json; NOT advancing -latest.json (${out.notReachedBecause})`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().then(() => process.exit(0)).catch((e) => { console.error('espn-task0-probe failed:', e && e.stack ? e.stack : e); process.exit(1); });
}
