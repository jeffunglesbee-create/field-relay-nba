#!/usr/bin/env node
// Mutation harness for scripts/espn-task0-probe.mjs and check-espn-task0-probe.mjs (CLAUDE.md Rule 90): each mutant is a broken copy of the
// probe, written NEXT TO the real one (so its relative imports and its ../src/index.js resolve) under a dot-name, run through the check
// with --source, and must turn it red. The harness distrusts itself first: every anchor must occur exactly once, every mutant must parse,
// and the unmodified copy and a comment-only copy must pass the check with at least MIN_ASSERTIONS assertions.
//
// EQUIVALENT (not mutated, with the reason): E1's own "every goal row has a team id" term was one: a team id that is one of the two
// competitors implies a team id, so the first run of this harness found the term redundant and it was removed from the probe. Also: the one-second pause between reads (SPACING_MS) and the fetch timeout change only WHEN a
// read happens, and the check shortens the first to zero; the Accept header is not read by the stub. All three are politeness and
// robustness toward ESPN, asserted nowhere because no output depends on them.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const MIN_ASSERTIONS = 31;
const dir = path.dirname(fileURLToPath(import.meta.url));
const REAL = path.join(dir, 'espn-task0-probe.mjs');
const MUT = path.join(dir, '.mutant-espn-task0-probe.mjs');
const CHECK = path.join(dir, 'check-espn-task0-probe.mjs');
const src = fs.readFileSync(REAL, 'utf8');
const root = path.resolve(dir, '..');

const M = (name, anchor, replacement) => ({ name, anchor, replacement });
const SB = 'leagues[s].scoreboard !== null && leagues[s].scoreboard.status === 200 && leagues[s].scoreboard.shapeOk === true';
const REACH = 'e2a.shapeOk === true && e2a.status === 200';
const MUTANTS = [
  M('probed: the status is not required', SB, 'leagues[s].scoreboard !== null && leagues[s].scoreboard.shapeOk === true'),
  M('probed: the shape is not required', SB, 'leagues[s].scoreboard !== null && leagues[s].scoreboard.status === 200'),
  M('get: a 403 or 429 does not stop the run', 'if (r.status === 403 || r.status === 429) stopped = String(r.status);', ''),
  M('get: a stopped run keeps requesting', 'if (stopped !== null) { requests.push(', 'if (stopped === 0) { requests.push('),
  M('get: a redirect is followed', "redirect: 'manual'", "redirect: 'follow'"),
  M('get: the cache header is not kept', "rec.cacheControl = r.headers.get('cache-control');", ''),
  M('E1: the team need not be a competitor', 'l.shape.teamIdIsACompetitor === l.shape.goalRows && ', ''),
  M('E1: a clock is not required', ' && l.shape.withClock === l.shape.goalRows', ''),
  M('equal: any goal rows count as equal', 'l.shape.goalRowsEqualFinalTotal', 'l.shape.goalRows > 0'),
  M('own goal: any own-goal key counts', 'l.shape.ownGoalTrue > 0', 'l.shape.ownGoalKey > 0'),
  M('reached: fewer than nine leagues is enough', 'probed.length === R2_LEAGUES.length && ', ''),
  M('reached: the relay status is not required', REACH, 'e2a.shapeOk === true'),
  M('reached: the relay shape is not required', REACH, 'e2a.status === 200'),
  M('main: -latest.json always advances', "if (reached) { fs.writeFileSync('outbox/espn-task0-latest.json'", "if (true) { fs.writeFileSync('outbox/espn-task0-latest.json'"),
  M('probeLeague: the first event, not the most recent finished one', 'const ev = pickRecentFinished(events);', 'const ev = events[0];'),
  M('probeLeague: a league with no finished match is read anyway', 'if (ev === null) { out.chosen = null; return out; }', 'if (ev === null) { out.chosen = null; }'),
  M('probeLeague: the summary of the wrong event', 'summary?event=${encodeURIComponent(String(ev.id))}', 'summary?event=${encodeURIComponent(String(events[0].id))}'),
  M('probeLeague: no page limit', '&limit=300`', '`'),
  M('window: thirteen days', 'const WINDOW_DAYS = 14;', 'const WINDOW_DAYS = 13;'),
  M('E2a: another day', "const E2A_DAY = '2026-10-25';", "const E2A_DAY = '2026-10-26';"),
  M('E2a: the rows are not counted', 'labelStats(new Map([[E2A_DAY, rows]]))', 'labelStats(new Map())'),
  M('main: a league missing from the registry is not fatal', 'if (missing.length > 0)', 'if (missing.length > 99)'),
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
