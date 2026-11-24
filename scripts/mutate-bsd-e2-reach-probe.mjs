#!/usr/bin/env node
// Mutation harness for scripts/bsd-e2-reach-probe.mjs and check-bsd-e2-reach-probe.mjs (CLAUDE.md Rule 90). Each mutant is a broken copy of
// the probe, written NEXT TO the real one (so its relative imports resolve) under a dot-name, run through the check with --source, and
// must turn it red. The harness distrusts itself first: every anchor must occur exactly once, every mutant must parse, and the
// unmodified copy and a comment-only copy must pass the check with at least MIN_ASSERTIONS assertions.
//
// EQUIVALENT (not mutated, with the reason):
//   - the row projection in readDays (`rows.filter(isObj).map(...)`) only drops fields the accounting never reads, to hold less in memory;
//     no output depends on it.
//   - `reach.partitions === true` in `reached`: holds by construction of reachOf (its own check asserts it), so no input can make it false.
//   - `census.gradeable === items.length`: the same selection the census counts (populationOf uses the census's captureOf and covers), so
//     it can only differ if one of those two changes; the grade runner carries the same guard and its own check for it.
//   - refuseIfTokenInside(body, TOKEN): the function is the existing one, covered by its own check; a token cannot reach this body.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const MIN_ASSERTIONS = 27;
const dir = path.dirname(fileURLToPath(import.meta.url));
const REAL = path.join(dir, 'bsd-e2-reach-probe.mjs');
const MUT = path.join(dir, '.mutant-bsd-e2-reach-probe.mjs');
const CHECK = path.join(dir, 'check-bsd-e2-reach-probe.mjs');
const src = fs.readFileSync(REAL, 'utf8');
const root = path.resolve(dir, '..');

const M = (name, anchor, replacement) => ({ name, anchor, replacement });
const MUTANTS = [
  M('matchesOf: a bad date adds a day', 'if (d !== null) byKey.get(it.key).callDays.add(d);', 'byKey.get(it.key).callDays.add(d);'),
  M('matchesOf: days unsorted', '{ key: m.key, slug: m.slug, callDays: [...m.callDays].sort() }', '{ key: m.key, slug: m.slug, callDays: [...m.callDays] }'),
  M('readDays: a 429 or 403 does not stop the run', 'if (r.status === 429 || r.status === 403) stopped = st;', ''),
  M('readDays: a stopped run keeps reading', 'if (stopped !== null) { dayRows.set(day, null);', 'if (stopped === 0) { dayRows.set(day, null);'),
  M('readDays: a read that is not the contract is empty, not unread', 'rows = rowsOfDay(JSON.parse(text));', 'rows = rowsOfDay(JSON.parse(text)) |' + '| [];'),
  M('main: the cap is exclusive', 'if (days.length > DAY_CAP)', 'if (days.length >= DAY_CAP)'),
  M('main: the default cap moved', '? Number(process.env.DAY_CAP) : 300;', '? Number(process.env.DAY_CAP) : 299;'),
  M('main: unread matches still reach the target', 'reach.partitions === true && reach.unread === 0 &&', 'reach.partitions === true &&'),
  M('main: -latest.json always advances', 'if (reached) { fs.writeFileSync(\'outbox/bsd-e2-reach-latest.json\'', 'if (true) { fs.writeFileSync(\'outbox/bsd-e2-reach-latest.json\''),
  M('main: an empty population is searched anyway', 'else if (notReached === null && analysisError === null) notReached = \'the census found no gradeable calls\';', ''),
  M('main: an empty population reads days', 'analysisError === null && matches.length > 0) {', 'analysisError === null) {'),
  M('main: the census verdict is not consulted', "analysis.calls.verdict !== 'ANSWERED'", "analysis.calls.verdict === 'NEVER'"),
  M('main: the days-read count counts failures', '[...dayRead.dayRows.values()].filter((v) => v !== null).length', 'dayRead.dayRows.size'),
  M('main: the reach is computed on the wrong rows', 'reachOf({ matches, dayRows: dayRead.dayRows })', 'reachOf({ matches, dayRows: new Map() })'),
  M('main: the espn-id outcome is not in the coverage line', ', ESPN id on the rows of the ${reach.one + reach.many} matches that have rows: exactly one distinct ${reach.espnIds.one}, none ${reach.espnIds.none}, conflicting ${reach.espnIds.conflict}', ''),
  M('main: the labels are not counted', 'labels = labelStats(dayRead.dayRows);', 'labels = labelStats(new Map());'),
];

let bad = 0;
const problems = [];
function runWith(text) {
  fs.writeFileSync(MUT, text);
  const parse = spawnSync(process.execPath, ['--check', MUT], { encoding: 'utf8' });
  if (parse.status !== 0) return { invalid: true, detail: (parse.stderr || '').split('\n').slice(0, 3).join(' | ') };
  const r = spawnSync(process.execPath, [CHECK, '--source', MUT, '--fail-fast'], { cwd: root, encoding: 'utf8', timeout: 150000 });
  return { status: r.status, out: `${r.stdout}${r.stderr}`, timedOut: r.error !== undefined && r.error.code === 'ETIMEDOUT' };
}
try {
  const clean = runWith(src);
  const m = clean.invalid ? null : /^ok (\d+) scenarios, (\d+) assertions/m.exec(clean.out);
  if (clean.invalid || clean.status !== 0 || m === null || Number(m[2]) < MIN_ASSERTIONS) { bad++; problems.push(`CONTROL unmodified copy did not pass with at least ${MIN_ASSERTIONS} assertions: ${clean.invalid ? clean.detail : clean.out.slice(0, 400)}`); }
  const comment = runWith(`${src}\n// harmless\n`);
  if (comment.invalid || comment.status !== 0) { bad++; problems.push('CONTROL a comment-only change turned the check red'); }

  let caught = 0;
  for (const mu of MUTANTS) {
    const count = src.split(mu.anchor).length - 1;
    if (count !== 1) { console.error(`ANCHOR for "${mu.name}" occurs ${count} times, not once`); process.exitCode = 2; throw new Error('anchor'); }
    const mutated = src.replace(mu.anchor, () => mu.replacement);
    if (mutated === src) { console.error(`mutant "${mu.name}" did not change the text`); process.exitCode = 2; throw new Error('noop'); }
    const r = runWith(mutated);
    if (r.invalid) { console.error(`mutant "${mu.name}" does not parse: ${r.detail}`); process.exitCode = 2; throw new Error('parse'); }
    if (r.status !== 0 && !r.timedOut) { caught++; console.log(`CAUGHT   ${mu.name}`); }
    else { bad++; problems.push(`NOT CAUGHT ${mu.name}`); console.log(`NOT CAUGHT ${mu.name}`); }
  }
  console.log(`\n${caught} of ${MUTANTS.length} mutations caught; controls ${clean.status === 0 && comment.status === 0 ? 'ok' : 'FAILED'}; ${MIN_ASSERTIONS} assertions required of the clean copy`);
} catch (e) {
  if (process.exitCode !== 2) { console.error(e && e.stack ? e.stack : e); process.exitCode = 1; }
} finally {
  try { fs.unlinkSync(MUT); } catch (_) { /* never written */ }
}
if (bad) { console.log(problems.join('\n')); process.exitCode = 1; }
