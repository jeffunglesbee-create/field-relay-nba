#!/usr/bin/env node
// Task 0 (the part that needs the BSD token) of field-laboratory docs/CC-CMD-2026-11-23-bsd-next-goal-independent-reference.md: E2b and E2c.
//
// Of the matches the grade covers (the census's gradeable calls, grouped by BSD event), how many does the relay's existing BSD-to-archive
// join reach? For each match: its BSD event id, looked for as `bsd_event_id` on the archive rows of the day of each of its calls and the
// day before (/context/date/{day}, one read per distinct day). 0, 1 or 2+ rows; a match with one row is split by whether that row carries
// an espn_event_id; every zero gets one named reason; the reads also count rows by sport label (the refuting reads for premises (1) and
// (2) of E2c). A day that cannot be read makes its matches "unread", never zero.
//
// The ledger and the capture reads are the census's collect() (the BSD requests, the budget, the stop on 429/401, the deadline, the
// timeout). COUNTS ONLY: no ledger row, team, player or event id is written (licence v4.0 section 4; this repository is public). This file
// imports only this repository's own scripts; it loads no laboratory code, so nothing but this repository's reviewed source runs in the
// process that holds the token.
//
// Usage: BSD_API_TOKEN=... node scripts/bsd-e2-reach-probe.mjs     (DAY_CAP=300 by default: more distinct days than that and no read is made)

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { refuseIfTokenInside } from './bsd-next-goal-probe.mjs';
import { collect, analyseCensus } from './bsd-next-goal-census.mjs';
import { populationOf } from './bsd-next-goal-grade.mjs';
import { dayOf, daysToRead, rowsOfDay, reachOf, labelStats, REASONS } from './espn-task0-lib.mjs';

const RELAY = process.env.RELAY_URL || 'https://field-relay-nba.jeffunglesbee.workers.dev';
const DAY_CAP = Number.isInteger(Number(process.env.DAY_CAP)) && Number(process.env.DAY_CAP) >= 1 && Number(process.env.DAY_CAP) <= 2000 ? Number(process.env.DAY_CAP) : 300;
const FETCH_TIMEOUT_MS = 30000;
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/** One entry per distinct BSD event the grade covers: its R2 directory and the UTC days of its calls. */
export function matchesOf(items) {
  const byKey = new Map();
  for (const it of items) {
    if (!byKey.has(it.key)) byKey.set(it.key, { key: it.key, slug: it.tags.slug, callDays: new Set() });
    const d = dayOf(it.call.called_at);
    if (d !== null) byKey.get(it.key).callDays.add(d);
  }
  return [...byKey.values()].map((m) => ({ key: m.key, slug: m.slug, callDays: [...m.callDays].sort() }));
}

export async function readDays(days) {
  const dayRows = new Map();
  const statuses = Object.create(null);
  const t0 = Date.now();
  let stopped = null, next = 0;
  async function worker() {
    while (next < days.length) {
      const day = days[next++];
      if (stopped !== null) { dayRows.set(day, null); statuses['(not read: stopped)'] = (statuses['(not read: stopped)'] === undefined ? 0 : statuses['(not read: stopped)']) + 1; continue; }
      let st = 'no response', rows = null;
      try {
        const r = await fetch(`${RELAY}/context/date/${day}`, { redirect: 'manual', signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
        st = String(r.status);
        if (r.status === 429 || r.status === 403) stopped = st;
        const text = await r.text();
        try {
          rows = rowsOfDay(JSON.parse(text));
          if (rows !== null) rows = rows.filter(isObj).map((x) => ({ id: x.id, sport: x.sport, bsd_event_id: x.bsd_event_id, espn_event_id: x.espn_event_id }));
        } catch (_) { st = `${st} non-JSON`; }
      } catch (e) { st = `error: ${String(e && e.message ? e.message : e).slice(0, 40)}`; }
      dayRows.set(day, rows);
      statuses[st] = (statuses[st] === undefined ? 0 : statuses[st]) + 1;
    }
  }
  await Promise.all(Array.from({ length: 4 }, worker));
  return { dayRows, statuses, stopped, seconds: Math.round((Date.now() - t0) / 100) / 10 };
}

const fileSha = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');

async function main() {
  const dir = path.dirname(fileURLToPath(import.meta.url));
  const c = await collect('bsd-e2-reach');
  const { out, ledger, r2, reads, ctx, log, slugOf, TOKEN, TS, bsdCalls, stopped: bsdStopped } = c;
  let analysis, items = [], analysisError = null, notReached = null;
  try {
    analysis = analyseCensus({ ledger, r2, reads, ctx });
    if (analysis.calls.verdict !== 'ANSWERED') notReached = `the census is ${analysis.calls.verdict}: ${(analysis.calls.partialBecause || [analysis.calls.why]).join('; ')}`;
    else items = populationOf({ rows: ledger.rows, reads, slugOf });
  } catch (e) {
    analysisError = String(e && e.stack ? e.stack : e).split('\n').slice(0, 4).join(' | ');
    analysis = analysis || { calls: {}, coverageLine: `ANALYSIS FAILED: ${analysisError.slice(0, 160)}` };
  }
  const census = analysis.calls || {};
  const matches = matchesOf(items);
  const days = daysToRead(matches);
  let reach = null, dayRead = null, labels = null;
  if (notReached === null && analysisError === null && matches.length > 0) {
    if (days.length > DAY_CAP) notReached = `${days.length} distinct days are needed, over the cap of ${DAY_CAP}: no /context/date read was made`;
    else {
      dayRead = await readDays(days);
      reach = reachOf({ matches, dayRows: dayRead.dayRows });
      labels = labelStats(dayRead.dayRows);
    }
  } else if (notReached === null && analysisError === null) notReached = 'the census found no gradeable calls';

  const reached = reach !== null && reach.partitions === true && reach.unread === 0 && reach.matches === matches.length && census.gradeable === items.length;
  const why = reached ? null : analysisError !== null ? 'the analysis threw' : notReached !== null ? notReached
    : reach === null ? 'no reach was computed' : !reach.partitions ? 'the matches were not each placed once'
      : reach.unread > 0 ? `${reach.unread} matches needed a day that was not read` : `the population ${items.length} is not the census's gradeable count ${census.gradeable}`;
  const reasonsLine = Object.values(REASONS).map((r) => `${r} ${reach !== null && reach.zeroReasons[r] !== undefined ? reach.zeroReasons[r] : 0}`).join('; ');
  const coverageLine = reach === null ? `not reached: ${why}`
    : `${items.length} gradeable calls on ${reach.matches} distinct matches | archive rows carrying the match's bsd id: one ${reach.one} (with an espn id ${reach.oneRow.withEspnId}, without ${reach.oneRow.withoutEspnId}), two or more ${reach.many}, none ${reach.zero} [${reasonsLine}], ESPN id on the rows of the ${reach.one + reach.many} matches that have rows: exactly one distinct ${reach.espnIds.one}, none ${reach.espnIds.none}, conflicting ${reach.espnIds.conflict}, unread ${reach.unread}, no valid call day ${reach.noDay} | days read ${[...dayRead.dayRows.values()].filter((v) => v !== null).length} of ${days.length} needed (cap ${DAY_CAP}) | rows read ${labels.rows} (target-label rows: ${Object.entries(labels.targetLabelRows).map(([k, v]) => `${k} ${v}`).join(', ')})`;

  Object.assign(out, {
    bsdCallsMade: bsdCalls, stopped: bsdStopped, analysisError, readsMade: reads.size, reachedTarget: reached, notReachedBecause: why,
    runner: { gitSha: typeof process.env.GITHUB_SHA === 'string' && process.env.GITHUB_SHA !== '' ? process.env.GITHUB_SHA : null,
      runId: typeof process.env.GITHUB_RUN_ID === 'string' && process.env.GITHUB_RUN_ID !== '' ? process.env.GITHUB_RUN_ID : null,
      probeSha256: fileSha(fileURLToPath(import.meta.url)), libSha256: fileSha(path.join(dir, 'espn-task0-lib.mjs')),
      censusSha256: fileSha(path.join(dir, 'bsd-next-goal-census.mjs')), graderSha256: fileSha(path.join(dir, 'bsd-next-goal-grade.mjs')) },
    coverageLine, censusCoverageLine: analysis.coverageLine, census: { verdict: census.verdict, gradeable: census.gradeable },
    calls: items.length, matches: matches.length, dayCap: DAY_CAP, daysNeeded: days.length,
    dayReadStatuses: dayRead === null ? null : dayRead.statuses, dayReadSeconds: dayRead === null ? null : dayRead.seconds, dayReadStopped: dayRead === null ? null : dayRead.stopped,
    reach, labels, bsdLog: log,
  });
  const body = JSON.stringify(out, null, 2);
  refuseIfTokenInside(body, TOKEN);
  console.log('\n=== COVERAGE ===\n' + coverageLine);
  fs.mkdirSync('outbox', { recursive: true });
  const stamp = TS.replace(/[:.]/g, '-');
  fs.writeFileSync(`outbox/bsd-e2-reach-${stamp}.json`, body);
  if (reached) { fs.writeFileSync('outbox/bsd-e2-reach-latest.json', body); console.log(`\nwrote outbox/bsd-e2-reach-${stamp}.json and -latest.json`); }
  else console.log(`\nwrote outbox/bsd-e2-reach-${stamp}.json; NOT advancing -latest.json (${why})`);
}

const redact = (text) => [process.env.BSD_API_TOKEN, typeof process.env.BSD_API_TOKEN === 'string' ? process.env.BSD_API_TOKEN.trim() : undefined]
  .reduce((s, t) => (typeof t === 'string' && t.length >= 8 ? s.split(t).join('[redacted]') : s), String(text));

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().then(() => process.exit(0)).catch((e) => { console.error('bsd-e2-reach-probe failed:', redact(e && e.stack ? e.stack : e)); process.exit(1); });
}
