#!/usr/bin/env node
// Grade BSD's published next-goal calls against FIELD's own captured goal timelines, on this repo's runner (the one that holds
// BSD_API_TOKEN). docs/CC-CMD-2026-11-22-bsd-next-goal-grade-against-field-timelines.md in field-laboratory, run on the owner's
// word of 2026-11-23 ("Yes, run from relays runner").
//
// WHO DOES WHAT. The rule, the counting and its checks live in field-laboratory (scripts/bsd-next-goal-grade-core.mjs, LAB-FIRST-A),
// a pure module that imports nothing and returns counts. This file is only the part that can run nowhere else: it reuses the census's
// collect() (the ledger from the vendor, the R2 listing and the capture reads through the relay, with the call budget, the stop on a
// 429 or a 401, the run deadline and the read cap), selects the population the census calls gradeable, hands it to the lab's core, and
// writes a counts-only artifact. The core is loaded from LAB_CORE (the workflow checks the laboratory out at a recorded commit);
// its sha256 and the laboratory commit are written into the artifact so a number can be tied to the code that made it.
//
// The core runs in this process, which holds the BSD token in its environment. It is pure (the lab's check asserts that of its
// source text), the artifact is refused if the token appears in it, and the core is loaded and shape-checked BEFORE anything is
// spent, so a missing or wrong module costs no request.
//
// COUNTS ONLY. No ledger row, team, player or event id is written (licence v4.0 section 4; this repository is public).
//
// Usage: BSD_API_TOKEN=... LAB_CORE=lab/scripts/bsd-next-goal-grade-core.mjs [LAB_SHA=...] node scripts/bsd-next-goal-grade.mjs

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { refuseIfTokenInside } from './bsd-next-goal-probe.mjs';
import { collect, analyseCensus, captureOf, covers } from './bsd-next-goal-census.mjs';

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/**
 * The census's gradeable population, as the items the core grades: a hit or miss, with a resolved_minute, on a capture that was
 * read, parsed and covers the call. Selected here with the census's own captureOf and covers, so there is one definition of
 * "gradeable"; the run then requires the core's population to equal the census's own count.
 */
export function populationOf({ rows, reads, slugOf }) {
  const items = [];
  for (const r of rows) {
    const id = isObj(r) && isObj(r.event) && r.event.id !== undefined && r.event.id !== null ? String(r.event.id) : null;
    if (id === null) continue;
    if (r.outcome !== 'hit' && r.outcome !== 'miss') continue;
    if (num(r.resolved_minute) === null) continue;
    const rd = reads.get(id);
    if (!rd || rd.status !== 200 || rd.json === undefined) continue;
    const cap = captureOf(rd.json);
    if (!cap.ok || !covers(r, cap)) continue;
    items.push({ call: r, capture: rd.json, key: id, tags: { slug: slugOf.get(id), state: cap.state } });
  }
  return items;
}

async function loadCore(corePath) {
  const file = path.resolve(corePath);
  if (!fs.existsSync(file)) throw new Error(`LAB_CORE ${corePath} does not exist: the laboratory was not checked out there`);
  const text = fs.readFileSync(file);
  const core = await import(pathToFileURL(file).href);
  for (const name of ['gradeCalls', 'coverageLine']) if (typeof core[name] !== 'function') throw new Error(`LAB_CORE does not export ${name}()`);
  if (typeof core.RULE_VERSION !== 'string') throw new Error('LAB_CORE does not export RULE_VERSION');
  return { core, sha256: crypto.createHash('sha256').update(text).digest('hex') };
}

async function main() {
  const CORE_PATH = process.env.LAB_CORE;
  if (typeof CORE_PATH !== 'string' || CORE_PATH === '') { console.error('LAB_CORE is not set: it names the laboratory grader module'); process.exit(1); }
  const { core, sha256 } = await loadCore(CORE_PATH);   // before anything is spent

  const c = await collect('bsd-next-goal-grade');
  const { out, ledger, r2, reads, ctx, log, slugOf, TOKEN, TS, bsdCalls, stopped } = c;
  let analysis, grade = null, analysisError = null, notGraded = null;
  try {
    analysis = analyseCensus({ ledger, r2, reads, ctx });
    if (analysis.calls.verdict !== 'ANSWERED') notGraded = `the census is ${analysis.calls.verdict}: ${(analysis.calls.partialBecause || [analysis.calls.why]).join('; ')}`;
    else grade = core.gradeCalls(populationOf({ rows: ledger.rows, reads, slugOf }));
  } catch (e) {
    analysisError = String(e && e.stack ? e.stack : e).split('\n').slice(0, 4).join(' | ');
    analysis = analysis || { calls: {}, coverageLine: `ANALYSIS FAILED: ${analysisError.slice(0, 160)}` };
  }
  const census = analysis.calls || {};
  const partitions = grade !== null && grade.graded + grade.notApplicable.total === grade.population && grade.agree + grade.disagree === grade.graded;
  const reached = partitions && grade.population === census.gradeable;
  const why = analysisError !== null ? 'the analysis threw'
    : grade === null ? notGraded
      : grade.population !== census.gradeable ? `the core's population ${grade.population} is not the census's gradeable count ${census.gradeable}`
        : !partitions ? 'the core did not place every call exactly once' : null;

  Object.assign(out, {
    bsdCallsMade: bsdCalls, stopped, analysisError, readsMade: reads.size,
    // -latest.json advances only on a grade whose population is the census's own and that placed every call once
    reachedTarget: reached, notReachedBecause: why,
    core: { path: CORE_PATH, sha256, labSha: typeof process.env.LAB_SHA === 'string' && process.env.LAB_SHA !== '' ? process.env.LAB_SHA : null, ruleVersion: core.RULE_VERSION },
    coverageLine: grade !== null ? core.coverageLine(grade, census) : `not graded: ${why}`,
    censusCoverageLine: analysis.coverageLine,
    census: { verdict: census.verdict, partialBecause: census.partialBecause, uniqueCalls: census.uniqueCalls, inTrackedLeague: census.inTrackedLeague, withIncidentsKey: census.withIncidentsKey, gradeable: census.gradeable, gradeableBy: census.gradeableBy },
    grade, bsdLog: log,
  });
  const body = JSON.stringify(out, null, 2);
  refuseIfTokenInside(body, TOKEN);
  console.log('\n=== COVERAGE ===\n' + out.coverageLine);
  console.log(`\n=== RESULT ===\n${grade !== null ? `graded ${grade.graded} of ${grade.population} | agree ${grade.agree} | disagree ${grade.disagree} | not applicable ${grade.notApplicable.total}` : `not graded | ${why}`}${analysisError ? ` | ANALYSIS_ERROR ${analysisError.slice(0, 120)}` : ''}`);

  fs.mkdirSync('outbox', { recursive: true });
  const stamp = TS.replace(/[:.]/g, '-');
  fs.writeFileSync(`outbox/bsd-next-goal-grade-${stamp}.json`, body);
  if (out.reachedTarget) { fs.writeFileSync('outbox/bsd-next-goal-grade-latest.json', body); console.log(`\nwrote outbox/bsd-next-goal-grade-${stamp}.json and -latest.json`); }
  else console.log(`\nwrote outbox/bsd-next-goal-grade-${stamp}.json; NOT advancing -latest.json (${why})`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().then(() => process.exit(0)).catch((e) => { console.error('bsd-next-goal-grade failed:', e.stack || e.message); process.exit(1); });
}
