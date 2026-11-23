#!/usr/bin/env node
// Grade BSD's published next-goal calls against FIELD's own captured goal timelines, on this repo's runner (the one that holds
// BSD_API_TOKEN). docs/CC-CMD-2026-11-22-bsd-next-goal-grade-against-field-timelines.md in field-laboratory, run on the owner's
// word of 2026-11-23 ("Yes, run from relays runner").
//
// WHO DOES WHAT. The rule, the counting and its checks live in field-laboratory (scripts/bsd-next-goal-grade-core.mjs, LAB-FIRST-A),
// a pure module that imports nothing and returns counts. This file is only the part that can run nowhere else: it reuses the census's
// collect() (the ledger from the vendor, the R2 listing and the capture reads through the relay, with the call budget, the stop on a
// 429 or a 401, the run deadline, the fetch timeout and the read cap), selects the population the census calls gradeable, hands it to
// the lab's core, and writes a counts-only artifact. The core is loaded from LAB_CORE (the workflow checks the laboratory out at a
// full commit SHA); its sha256 and the laboratory commit are written into the artifact so a number can be tied to the code that made it.
//
// THE TRUST BOUNDARY, stated plainly (review of 2026-11-23): the core is import()ed into THIS process, which holds the BSD token in its
// environment, so it can reach the token. Nothing here can prevent that. What limits it is that the workflow refuses to run unless the
// laboratory is checked out at a full SHA, that the lab's check asserts the core's source text reaches for nothing (a tripwire against
// an accident, not a sandbox), and that the artifact is refused if the token appears in it. The sha256 recorded here ties a result to
// the code afterwards; it does not stop anything.
//
// The core is loaded and shape-checked BEFORE anything is spent, so a missing or wrong module costs no request; what it returns is
// shape-checked inside the same try as the analysis, so a malformed return leaves the evidence of the spend (the request log) and a
// reachedTarget of false, never a crash with no artifact.
//
// COUNTS ONLY. No ledger row, team, player or event id is written (licence v4.0 section 4; this repository is public).
//
// Usage: BSD_API_TOKEN=... LAB_CORE=lab/scripts/bsd-next-goal-grade-core.mjs [LAB_SHA=<40 hex>] node scripts/bsd-next-goal-grade.mjs
//   Under GITHUB_ACTIONS a 40-hex LAB_SHA is required.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { refuseIfTokenInside } from './bsd-next-goal-probe.mjs';
import { collect, analyseCensus, captureOf, covers } from './bsd-next-goal-census.mjs';

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const isCount = (v) => Number.isInteger(v) && v >= 0;

export const NOTE = 'agree means FIELD\'s own record of the match and the vendor\'s ledger name the same side for the goal that followed a call. FIELD\'s captures and the vendor\'s ledger both come from BSD (the census found the ledger\'s resolved_minute equal to a goal minute in the capture for every call it could test), so agreement is a consistency check of one feed against itself, not an independent grade of the vendor; a disagreement is the finding, and resolvedMinuteDistance, distinctGoals, byTag and premises say what kind. Counts are per call: several calls can sit on one goal (distinctGoals).';

/**
 * The census's gradeable population, as the items the core grades: a hit or miss, with a resolved_minute, on a capture that was
 * read, parsed and covers the call. Selected here with the census's own captureOf and covers, so there is one definition of
 * "gradeable"; the run then requires the core's population to equal the census's own count. Each item carries tags the core tallies
 * agreement by: the R2 directory, the capture's state, whether it holds VAR rows, whether its own event_id is the ledger's, and
 * whether the match went to extra time.
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
    const rows2 = rd.json.incidents;
    const ownId = rd.json.event_id;
    items.push({
      call: r, capture: rd.json, key: id,
      tags: {
        slug: slugOf.get(id),
        state: cap.state,
        var: rows2.some((x) => isObj(x) && x.type === 'varDecision') ? 'var rows' : 'no var rows',
        eventId: ownId === undefined || ownId === null ? 'absent' : String(ownId) === id ? 'matches' : 'differs',
        extraTime: cap.periodTexts.some((x) => /^(extra|et)/i.test(x)) ? 'yes' : 'no',
      },
    });
  }
  return items;
}

/** The shape the runner relies on, checked once, so a core that returns something else cannot crash the write. */
export function validGrade(g) {
  return isObj(g) && isCount(g.population) && isCount(g.graded) && isCount(g.agree) && isCount(g.disagree)
    && isObj(g.notApplicable) && isCount(g.notApplicable.total) && typeof g.ruleVersion === 'string'
    && isObj(g.premises) && isCount(g.premises.distinctCaptures) && isObj(g.byTag);
}

/**
 * The run's own check that the core graded the census's population and not another of the same size: the same number of calls, the
 * same number of distinct captures, and, for every R2 directory, the same number of calls in it (graded or not applicable).
 */
export function sameAsCensus(grade, census) {
  if (grade.population !== census.gradeable) return false;
  if (grade.premises.distinctCaptures !== census.distinctEventsGradeable) return false;
  const bySlug = isObj(census.gradeableBySlug) ? census.gradeableBySlug : {};
  const slugs = isObj(grade.byTag.slug) ? grade.byTag.slug : {};
  const want = Object.keys(bySlug).sort();
  const got = Object.keys(slugs).sort();
  if (want.length !== got.length || want.some((s, i) => s !== got[i])) return false;
  return want.every((s) => isObj(slugs[s]) && slugs[s].graded + slugs[s].notApplicable === bySlug[s]);
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

// What ran HERE, beside what the lab's core ran: the repository commit and run, and the hash of each file that selected and carried the
// data (this file, the census it reuses, and the probe it reuses), so a number can be tied to this repository's code as well as the lab's.
function runnerIdentity() {
  const dir = path.dirname(fileURLToPath(import.meta.url));
  const hash = (f) => crypto.createHash('sha256').update(fs.readFileSync(path.join(dir, f))).digest('hex');
  return {
    gitSha: typeof process.env.GITHUB_SHA === 'string' && process.env.GITHUB_SHA !== '' ? process.env.GITHUB_SHA : null,
    runId: typeof process.env.GITHUB_RUN_ID === 'string' && process.env.GITHUB_RUN_ID !== '' ? process.env.GITHUB_RUN_ID : null,
    graderSha256: crypto.createHash('sha256').update(fs.readFileSync(fileURLToPath(import.meta.url))).digest('hex'),
    censusSha256: hash('bsd-next-goal-census.mjs'),
    probeSha256: hash('bsd-next-goal-probe.mjs'),
  };
}

async function main() {
  const CORE_PATH = process.env.LAB_CORE;
  if (typeof CORE_PATH !== 'string' || CORE_PATH === '') { console.error('LAB_CORE is not set: it names the laboratory grader module'); process.exit(1); }
  const LAB_SHA = typeof process.env.LAB_SHA === 'string' && process.env.LAB_SHA !== '' ? process.env.LAB_SHA : null;
  if (process.env.GITHUB_ACTIONS === 'true' && !/^[0-9a-f]{40}$/.test(LAB_SHA)) { console.error('under GITHUB_ACTIONS LAB_SHA must be the full 40-hex laboratory commit the grader was checked out at'); process.exit(1); }
  const { core, sha256 } = await loadCore(CORE_PATH);   // before anything is spent

  const c = await collect('bsd-next-goal-grade');
  const { out, ledger, r2, reads, ctx, log, slugOf, TOKEN, TS, bsdCalls, stopped } = c;
  let analysis, grade = null, gradeLine = null, analysisError = null, notGraded = null;
  try {
    analysis = analyseCensus({ ledger, r2, reads, ctx });
    if (analysis.calls.verdict !== 'ANSWERED') notGraded = `the census is ${analysis.calls.verdict}: ${(analysis.calls.partialBecause || [analysis.calls.why]).join('; ')}`;
    else {
      const g = core.gradeCalls(populationOf({ rows: ledger.rows, reads, slugOf }));
      if (!validGrade(g)) throw new Error('the core returned a grade of the wrong shape');
      const line = core.coverageLine(g, analysis.calls);
      if (typeof line !== 'string') throw new Error('the core returned a coverage line that is not text');
      grade = g; gradeLine = line;
    }
  } catch (e) {
    analysisError = String(e && e.stack ? e.stack : e).split('\n').slice(0, 4).join(' | ');
    analysis = analysis || { calls: {}, coverageLine: `ANALYSIS FAILED: ${analysisError.slice(0, 160)}` };
  }
  const census = analysis.calls || {};
  const partitions = grade !== null && grade.graded + grade.notApplicable.total === grade.population && grade.agree + grade.disagree === grade.graded;
  const same = partitions && sameAsCensus(grade, census);
  const reached = same && grade.population > 0;
  const why = analysisError !== null ? 'the analysis threw'
    : grade === null ? notGraded
      : !partitions ? 'the core did not place every call exactly once'
        : grade.population !== census.gradeable ? `the core's population ${grade.population} is not the census's gradeable count ${census.gradeable}`
          : !same ? "the core's distinct captures or its calls per R2 directory are not the census's"
            : grade.population === 0 ? 'the census found no gradeable calls' : null;

  Object.assign(out, {
    bsdCallsMade: bsdCalls, stopped, analysisError, readsMade: reads.size,
    // -latest.json advances only on a grade whose population is the census's own, that is not empty, and that placed every call once
    reachedTarget: reached, notReachedBecause: why,
    core: { path: CORE_PATH, sha256, labSha: LAB_SHA, ruleVersion: core.RULE_VERSION },
    runner: runnerIdentity(),
    note: NOTE,
    coverageLine: grade !== null ? gradeLine : `not graded: ${why}`,
    censusCoverageLine: analysis.coverageLine,
    census: { verdict: census.verdict, partialBecause: census.partialBecause, uniqueCalls: census.uniqueCalls, inTrackedLeague: census.inTrackedLeague, withIncidentsKey: census.withIncidentsKey, gradeable: census.gradeable, gradeableBy: census.gradeableBy, distinctEventsGradeable: census.distinctEventsGradeable, gradeableBySlug: census.gradeableBySlug, notGradeableBecause: census.notGradeableBecause },
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

// The token must not reach the log through an error message (a core that throws with it, an exception that echoes the environment).
const redact = (text) => [process.env.BSD_API_TOKEN, typeof process.env.BSD_API_TOKEN === 'string' ? process.env.BSD_API_TOKEN.trim() : undefined]
  .reduce((s, t) => (typeof t === 'string' && t.length >= 8 ? s.split(t).join('[redacted]') : s), String(text));

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().then(() => process.exit(0)).catch((e) => { console.error('bsd-next-goal-grade failed:', redact(e && e.stack ? e.stack : e)); process.exit(1); });
}
