#!/usr/bin/env node
// Grade BSD's published next-goal calls against ESPN's goal timeline, on this repository's runner (the one that holds BSD_API_TOKEN).
// field-laboratory docs/CC-CMD-2026-11-23-bsd-next-goal-independent-reference.md, Task 1 (the build); the run is Task 3 and waits for the owner.
//
// WHO DOES WHAT. The rule and its counting live in field-laboratory (scripts/espn-reference-grade-core.mjs, LAB-FIRST-A): pure, imports nothing,
// returns counts. This file is only the part that can run nowhere else:
//   1. the census's collect() (the ledger, the R2 listing and the capture reads, with its call budget, its stop on a 429 or a 401, its deadline),
//   2. the census's own gradeable population (populationOf), grouped by BSD event,
//   3. /context/date for each call's UTC day and the day before (the archive rows that carry the BSD id), and reachEach: a match is reached when
//      those rows carry exactly ONE distinct ESPN id (Task 0's E2; the relay's own BSD-to-archive join does the matching, nothing is joined here),
//   4. for each reached match, ONE read of ESPN's summary (site.web.api.espn.com, the host the relay itself reads summaries from), one second
//      apart, a 403 or a 429 stops the run (CLAUDE.md Rule 78), a redirect is read as a status, every fetch has a timeout,
//   5. the laboratory's core, loaded and shape-checked BEFORE anything is spent, and a counts-only artifact.
// The first grade's core is loaded too, for its readGoals() only: the capture's parsed goals are what step A compares ESPN with.
//
// THE TRUST BOUNDARY, as for the first grade: both cores are import()ed into THIS process, which holds the BSD token, so they can reach it.
// What limits it is that the workflow refuses to run unless the laboratory is checked out at a full SHA that was reviewed, that each core's check
// asserts its source text reaches for nothing (a tripwire, not a sandbox), and that the artifact is refused if the token appears in it.
// Both files' sha256 and the laboratory commit are written into the artifact: a record, not a prevention.
//
// COUNTS ONLY. No ledger row, team, player, event id or ESPN id is written (licence v4.0 section 4; this repository is public).
//
// Usage: BSD_API_TOKEN=... LAB_DIR=lab [LAB_SHA=<40 hex>] node scripts/espn-reference-grade.mjs     Under GITHUB_ACTIONS a 40-hex LAB_SHA is required.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { refuseIfTokenInside } from './bsd-next-goal-probe.mjs';
import { collect, analyseCensus } from './bsd-next-goal-census.mjs';
import { populationOf } from './bsd-next-goal-grade.mjs';
import { matchesOf, readDays } from './bsd-e2-reach-probe.mjs';
import { daysToRead, reachEach, registryFromSource, summaryToEspn, summaryEventId } from './espn-task0-lib.mjs';

const ESPN_OVERRIDE = typeof process.env.ESPN_BASE === 'string' && process.env.ESPN_BASE !== '' ? process.env.ESPN_BASE : null;   // the check points this at a stub
const SUMMARY = ESPN_OVERRIDE !== null ? ESPN_OVERRIDE : 'https://site.web.api.espn.com/apis/site/v2/sports/soccer';
const SPACING_MS = /^\d{1,4}$/.test(String(process.env.ESPN_SPACING_MS)) ? Number(process.env.ESPN_SPACING_MS) : 1000;   // the check shortens it; a run does not
const FETCH_TIMEOUT_MS = /^\d{3,5}$/.test(String(process.env.ESPN_TIMEOUT_MS)) && Number(process.env.ESPN_TIMEOUT_MS) <= 30000 ? Number(process.env.ESPN_TIMEOUT_MS) : 30000;   // the check shortens it to test the stall; a run does not
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const bump = (t, k, n = 1) => { t[k] = (t[k] === undefined ? 0 : t[k]) + n; };
const intEnv = (name, dflt, min, max) => {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return dflt;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < min || n > max) { console.error(`${name} must be a whole number from ${min} to ${max}, got ${JSON.stringify(raw)}`); process.exit(1); }
  return n;
};
const fileSha = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');

async function loadCores(labDir) {
  const load = async (rel, names) => {
    const file = path.resolve(labDir, rel);
    if (!fs.existsSync(file)) throw new Error(`${rel} does not exist under LAB_DIR ${labDir}: the laboratory was not checked out there`);
    const mod = await import(pathToFileURL(file).href);
    for (const n of names) if (typeof mod[n] !== 'function') throw new Error(`${rel} does not export ${n}()`);
    if (typeof mod.RULE_VERSION !== 'string') throw new Error(`${rel} does not export RULE_VERSION`);
    return { mod, sha256: fileSha(file) };
  };
  const bsd = await load('scripts/bsd-next-goal-grade-core.mjs', ['readGoals']);
  const espn = await load('scripts/espn-reference-grade-core.mjs', ['gradeAgainstEspn', 'coverageLine']);
  return { bsd, espn };
}

// ESPN: one summary per reached match, spaced, stopping on a 403 or a 429
async function readEspn(reached, leagueOf, readCap) {
  const out = new Map();
  const statuses = Object.create(null);
  const ids = Object.create(null);   // the event id the summary says it is for, against the one asked: matched, absent, differs
  let stopped = null, made = 0, capped = false, failed = 0;
  for (const m of reached) {
    if (stopped !== null) { out.set(m.key, null); bump(statuses, '(not read: stopped)'); continue; }
    if (made >= readCap) { capped = true; out.set(m.key, null); bump(statuses, '(not read: cap)'); continue; }
    const league = leagueOf(m.slug);
    if (league === undefined) { out.set(m.key, null); bump(statuses, '(no ESPN league for the directory)'); failed++; continue; }
    if (made > 0) await sleep(SPACING_MS);
    made++;
    let st = 'no response', espn = null;
    try {
      const r = await fetch(`${SUMMARY}/${league}/summary?event=${encodeURIComponent(m.espnId)}`, { redirect: 'manual', headers: { Accept: 'application/json', 'User-Agent': 'FIELD/1.0' }, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
      st = String(r.status);
      if (r.status === 403 || r.status === 429) stopped = st;
      const text = await r.text();
      if (r.status === 200) {
        let json = null;
        try { json = JSON.parse(text); } catch (_) { st = '200 non-JSON'; }
        if (st === '200') {
          espn = summaryToEspn(json);
          if (espn === null) st = '200 not the summary shape';
          else {
            const got = summaryEventId(json);
            const idCheck = got === null ? 'absent' : got === m.espnId ? 'matched' : 'differs';
            bump(ids, idCheck);
            if (idCheck === 'differs') { espn = null; st = '200 other event'; }
          }
        }
      }
    } catch (e) { st = `error: ${String(e && e.message ? e.message : e).slice(0, 40)}`; }
    out.set(m.key, espn);
    bump(statuses, st);
    if (st !== '200' && st !== '404') failed++;   // a 404 is ESPN saying it has no such event; anything else is a read that did not answer
  }
  return { byKey: out, statuses, ids, stopped, made, capped, failed };
}

// The core's own `partitions` is not trusted alone: the sums are added up again here, from the numbers it returned (as the first grade's runner does). The census
// ties (population and matches) are checked beside it, so they are not repeated here, and a count that is not a whole number cannot pass the sums below.
function partitionsHold(g) {
  if (!isObj(g) || !isObj(g.notApplicable) || !isObj(g.notApplicable.byReason) || !isObj(g.bySlug)) return false;
  const slugs = Object.values(g.bySlug);
  const reasons = Object.values(g.notApplicable.byReason);
  const sum = (list) => list.reduce((t, x) => t + x, 0);
  return reasons.every((x) => Number.isInteger(x) && x >= 0)
    && g.population === g.graded + g.notApplicable.total && g.graded === g.agree + g.disagree
    && sum(reasons) === g.notApplicable.total
    && sum(slugs.map((x) => x.calls)) === g.population && sum(slugs.map((x) => x.graded)) === g.graded && sum(slugs.map((x) => x.agree)) === g.agree
    && sum(slugs.map((x) => x.disagree)) === g.disagree && sum(slugs.map((x) => x.notApplicable)) === g.notApplicable.total;
}

async function main() {
  const dir = path.dirname(fileURLToPath(import.meta.url));
  const LAB_DIR = process.env.LAB_DIR;
  if (typeof LAB_DIR !== 'string' || LAB_DIR === '') { console.error('LAB_DIR is not set: it names the laboratory checkout'); process.exit(1); }
  const LAB_SHA = typeof process.env.LAB_SHA === 'string' && process.env.LAB_SHA !== '' ? process.env.LAB_SHA : null;
  if (process.env.GITHUB_ACTIONS === 'true' && !/^[0-9a-f]{40}$/.test(String(LAB_SHA))) { console.error('under GITHUB_ACTIONS LAB_SHA must be the full 40-hex laboratory commit the cores were checked out at'); process.exit(1); }
  const DAY_CAP = intEnv('DAY_CAP', 300, 1, 2000);
  const ESPN_READ_CAP = intEnv('ESPN_READ_CAP', 400, 1, 2000);
  const reg = registryFromSource(fs.readFileSync(path.join(dir, '..', 'src', 'index.js'), 'utf8'));
  const cores = await loadCores(LAB_DIR);   // before anything is spent

  const c = await collect('espn-reference-grade');
  const { out, ledger, r2, reads, ctx, log, slugOf, TOKEN, TS, bsdCalls, stopped: bsdStopped } = c;
  let analysis, items = [], analysisError = null, notReached = null;
  try {
    analysis = analyseCensus({ ledger, r2, reads, ctx });
    if (analysis.calls.verdict !== 'ANSWERED') notReached = `the census is ${analysis.calls.verdict}: ${(analysis.calls.partialBecause || [analysis.calls.why]).join('; ')}`;
    else items = populationOf({ rows: ledger.rows, reads, slugOf });
  } catch (e) {
    analysisError = redact(String(e && e.stack ? e.stack : e).split('\n').slice(0, 4).join(' | '));
    analysis = analysis || { calls: {}, coverageLine: `ANALYSIS FAILED: ${analysisError.slice(0, 160)}` };
  }
  const census = analysis.calls || {};
  const matches = matchesOf(items);
  let reach = null, dayRead = null, espnRead = null, grade = null, gradeLine = null, gradeError = null;
  const reachCounts = Object.create(null);
  if (notReached === null && analysisError === null && matches.length > 0) {
    const days = daysToRead(matches);
    if (days.length > DAY_CAP) notReached = `${days.length} distinct days are needed, over the cap of ${DAY_CAP}: no /context/date read was made`;
    else {
      dayRead = await readDays(days);
      reach = reachEach({ matches, dayRows: dayRead.dayRows });
      for (const r of reach) bump(reachCounts, r.reached ? 'reached' : r.reason);
      const reachedList = matches.map((m, i) => ({ ...m, espnId: reach[i].espnId, reached: reach[i].reached })).filter((m) => m.reached);
      espnRead = await readEspn(reachedList, (slug) => reg[slug], ESPN_READ_CAP);
      try {
        const byKey = new Map();
        for (const it of items) { if (!byKey.has(it.key)) byKey.set(it.key, { capture: it.capture, calls: [] }); byKey.get(it.key).calls.push(it.call); }
        const coreMatches = matches.map((m, i) => {
          const g = byKey.get(m.key);
          return { key: m.key, slug: m.slug, reach: { reached: reach[i].reached, reason: reach[i].reason }, espn: reach[i].reached ? espnRead.byKey.get(m.key) : null,
            bsd: cores.bsd.mod.readGoals(g.capture), calls: g.calls.map((x) => ({ side: x.side, outcome: x.outcome, score_at_call: x.score_at_call, resolved_minute: x.resolved_minute })) };
        });
        grade = cores.espn.mod.gradeAgainstEspn(coreMatches);
        gradeLine = cores.espn.mod.coverageLine(grade);
        if (typeof gradeLine !== 'string' || !isObj(grade) || grade.partitions !== true) throw new Error('the core returned a grade that does not partition, or a line that is not text');
        if (grade.population !== items.length || grade.matches !== matches.length) throw new Error(`the core's population ${grade.population} / matches ${grade.matches} is not the census's ${items.length} / ${matches.length}`);
        if (!partitionsHold(grade)) throw new Error('the numbers the core returned do not add up: every call must be agree, disagree or one named reason, once');
      } catch (e) { gradeError = redact(String(e && e.stack ? e.stack : e).split('\n').slice(0, 4).join(' | ')); grade = null; gradeLine = null; }
    }
  } else if (notReached === null && analysisError === null) notReached = 'the census found no gradeable calls';

  const reachedCount = reach === null ? 0 : reach.filter((r) => r.reached).length;
  const idUse = new Map();
  if (reach !== null) for (const r of reach) if (r.reached) idUse.set(r.espnId, (idUse.get(r.espnId) || 0) + 1);
  const sharedIds = [...idUse.values()].filter((n) => n > 1).reduce((t, n) => t + n, 0);
  const espnOk = espnRead === null ? 0 : [...espnRead.byKey.values()].filter((v) => v !== null).length;
  const complete = grade !== null && dayRead !== null && dayRead.stopped === null && [...dayRead.dayRows.values()].every((v) => v !== null)
    && espnRead !== null && espnRead.stopped === null && espnRead.capped === false && espnRead.failed === 0 && bsdStopped === null && census.gradeable === items.length;
  const why = complete ? null : analysisError !== null ? 'the analysis threw' : notReached !== null ? notReached : gradeError !== null ? `the grade threw or did not partition: ${gradeError.slice(0, 120)}`
    : dayRead === null ? 'no reach was computed' : dayRead.stopped !== null || [...dayRead.dayRows.values()].some((v) => v === null) ? 'a /context/date day was not read'
      : espnRead.stopped !== null ? `ESPN answered ${espnRead.stopped}: the run stopped` : espnRead.capped ? `the ESPN read cap was reached` : espnRead.failed > 0 ? `${espnRead.failed} ESPN read(s) answered neither 200 nor 404, so those matches are unread, not "no timeline"` : bsdStopped !== null ? `BSD answered ${bsdStopped}` : `the census's gradeable count ${census.gradeable} is not the population ${items.length}`;
  const notReachedLine = Object.entries(reachCounts).filter(([k]) => k !== 'reached').map(([k, n]) => `${k} ${n}`).join('; ');
  const coverageLine = grade === null ? `not graded: ${why}`
    : `${gradeLine} | matches ${matches.length}: reached ${reachedCount}${notReachedLine === '' ? '' : `, not reached [${notReachedLine}]`}; ESPN summaries read ${espnOk} of ${reachedCount} reached (event id matched ${espnRead === null ? 0 : espnRead.ids.matched || 0}, absent ${espnRead === null ? 0 : espnRead.ids.absent || 0}, differing ${espnRead === null ? 0 : espnRead.ids.differs || 0}); reached matches sharing an ESPN id ${sharedIds}`;

  Object.assign(out, {
    bsdCallsMade: bsdCalls, stopped: bsdStopped, analysisError, readsMade: reads.size, reachedTarget: complete, notReachedBecause: why,
    cores: { labSha: LAB_SHA, bsdCoreSha256: cores.bsd.sha256, bsdCoreRule: cores.bsd.mod.RULE_VERSION, espnCoreSha256: cores.espn.sha256, espnCoreRule: cores.espn.mod.RULE_VERSION },
    runner: { gitSha: typeof process.env.GITHUB_SHA === 'string' && process.env.GITHUB_SHA !== '' ? process.env.GITHUB_SHA : null, runId: typeof process.env.GITHUB_RUN_ID === 'string' && process.env.GITHUB_RUN_ID !== '' ? process.env.GITHUB_RUN_ID : null,
      runnerSha256: fileSha(fileURLToPath(import.meta.url)), libSha256: fileSha(path.join(dir, 'espn-task0-lib.mjs')), censusSha256: fileSha(path.join(dir, 'bsd-next-goal-census.mjs')),
      graderSha256: fileSha(path.join(dir, 'bsd-next-goal-grade.mjs')), reachSha256: fileSha(path.join(dir, 'bsd-e2-reach-probe.mjs')) },
    coverageLine, censusCoverageLine: analysis.coverageLine, census: { verdict: census.verdict, gradeable: census.gradeable },
    calls: items.length, matches: matches.length, reachCounts, daysNeeded: dayRead === null ? null : dayRead.dayRows.size, dayReadStatuses: dayRead === null ? null : dayRead.statuses,
    espnReads: espnRead === null ? null : { made: espnRead.made, statuses: espnRead.statuses, eventIds: espnRead.ids, stopped: espnRead.stopped, capped: espnRead.capped, failed: espnRead.failed, summariesRead: espnOk },
    sharedEspnIds: sharedIds,
    grade, bsdLog: log,
  });
  const body = JSON.stringify(out, null, 2);
  refuseIfTokenInside(body, TOKEN);
  console.log('\n=== COVERAGE ===\n' + coverageLine);
  fs.mkdirSync('outbox', { recursive: true });
  const stamp = TS.replace(/[:.]/g, '-');
  fs.writeFileSync(`outbox/espn-reference-grade-${stamp}.json`, body);
  if (complete) { fs.writeFileSync('outbox/espn-reference-grade-latest.json', body); console.log(`\nwrote outbox/espn-reference-grade-${stamp}.json and -latest.json`); }
  else console.log(`\nwrote outbox/espn-reference-grade-${stamp}.json; NOT advancing -latest.json (${why})`);
}

// The token must not reach the log through an error message (a core that throws with it, an exception that echoes the environment).
const redact = (text) => [process.env.BSD_API_TOKEN, typeof process.env.BSD_API_TOKEN === 'string' ? process.env.BSD_API_TOKEN.trim() : undefined]
  .reduce((s, t) => (typeof t === 'string' && t.length >= 8 ? s.split(t).join('[redacted]') : s), String(text));

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().then(() => process.exit(0)).catch((e) => { console.error('espn-reference-grade failed:', redact(e && e.stack ? e.stack : e)); process.exit(1); });
}
