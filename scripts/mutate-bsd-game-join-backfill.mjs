#!/usr/bin/env node
// Mutation harness for scripts/bsd-game-join-backfill.mjs and check-bsd-game-join-backfill.mjs (CLAUDE.md Rule 90). Each mutant is a broken copy
// of the script written NEXT TO the real one (so its imports resolve) under a dot-name, run through the check with --source, and must turn it red.
// The harness distrusts itself first: every anchor must occur exactly once, every mutant must parse, and the unmodified copy and a comment-only
// copy must pass with at least MIN_ASSERTIONS assertions.
//
// EQUIVALENT (not mutated, with the reason): the `slice(0, 30)` caps and `slice(0, 120)` trims in slim() bound what a hostile answer can write and
// no scenario sends one that long; the 'none-matched' and 'nothing-pending' members of ANSWERED (the stub produces neither: a day with nothing
// pending is never chosen, and none-matched needs events read with nothing written); the fetch timeouts and `redirect: 'manual'` (timing and
// transport, not output).
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const MIN_ASSERTIONS = 49;
const dir = path.dirname(fileURLToPath(import.meta.url));
const REAL = path.join(dir, 'bsd-game-join-backfill.mjs');
const MUT = path.join(dir, '.mutant-bsd-game-join-backfill.mjs');
const CHECK = path.join(dir, 'check-bsd-game-join-backfill.mjs');
const src = fs.readFileSync(REAL, 'utf8');
const root = path.resolve(dir, '..');
const M = (name, anchor, replacement) => ({ name, anchor, replacement });
const MUTANTS = [
  M('TO may reach yesterday and later', 'if (TO > latestAllowed)', "if (TO > '9999-12-31')"),
  M('the scheduled join\'s days are not left alone', 'Date.now() - 2 * 86400000', 'Date.now() + 2 * 86400000'),
  M('a real run does not need the secret', "if (!DRY && (typeof secret !== 'string' || secret === ''))", 'if (false)'),
  M('a dry run writes', 'if (!DRY) {\n    const outcomes', 'if (true) {\n    const outcomes'),
  M('the wrong header', "'X-FIELD-Relay': secret", "'X-FIELD-Relay': 'x'"),
  M('the wrong body', 'body: JSON.stringify({ date })', 'body: JSON.stringify({ day: date })'),
  M('the re-read is not cache-busted', '${bust ? `?v=${Date.now()}` : \'\'}', '${false ? `?v=${Date.now()}` : \'\'}'),
  M('an unread day is read as clean', 'survey.set(day, rd.rows === null ? null :', 'survey.set(day, rd.rows === null ? { soccer: 0, pending: 0, bySport: {}, scope: 0 } :'),
  M('verification ignores what was written', 'written: written === null ? 0 : written })', 'written: 0 })'),
  M('a join is not counted as written', "const written = outcome === 'joined' ? num(resp.written) : 0;", 'const written = 0;'),
  M('pages are not added up', 'out.pagesUsed += pages === null ? 0 : pages;', 'out.pagesUsed += 0;'),
  M('the page cap is not applied', 'pageCap: PAGE_CAP });', 'pageCap: 99999 });'),
  M('a stop does not stop', 'console.log(`STOP: ${stop}`); break; }', 'console.log(`STOP: ${stop}`); }'),
  M('a failed day is recorded as answered', 'if (ANSWERED.has(outcome)) {', 'if (true) {'),
  M('an answered day is not recorded', "fs.writeFileSync('outbox/bsd-join-backfill-state.json', JSON.stringify(state, null, 2));\n      }", '}'),
  M('an answered day is asked again', 'state.attempted[d] !== undefined', 'false'),
  M('complete with an unread day', 'plan.unread.length === 0 && days.length > 0;', 'days.length > 0;'),
  M('the marker is not written', "fs.writeFileSync('outbox/bsd-join-backfill-complete.json'", "void ('outbox/bsd-join-backfill-complete.json'"),
  M('remaining ignores the failed days', 'out.remainingToAttempt = plan.pendingDays - attemptedNow;', 'out.remainingToAttempt = plan.remainingAfter;'),
  M('the secret guard is gone', "if (typeof secret === 'string' && secret !== '' && body.includes(secret)) fail('the artifact would contain the relay secret: refusing to write it');", ''),
  M('the scope is all six sports', 'rd.regular, SCOPE_SPORTS).pending', 'rd.regular, BSD_SOCCER_SPORTS).pending'),
  M('postseason rows choose a date', 'pendingOf(INCLUDE_POSTSEASON ? rd.rows : rd.regular, SCOPE_SPORTS)', 'pendingOf(rd.rows, SCOPE_SPORTS)'),
  M('postseason rows never choose a date', 'pendingOf(INCLUDE_POSTSEASON ? rd.rows : rd.regular, SCOPE_SPORTS)', 'pendingOf(rd.regular, SCOPE_SPORTS)'),
  M('the marker is written for a narrower range', 'out.rangeComplete && FROM <= DEFAULT_FROM && TO >= DEFAULT_TO && INCLUDE_MLS;', 'out.rangeComplete && INCLUDE_MLS;'),
  M('the marker is written without MLS', 'FROM <= DEFAULT_FROM && TO >= DEFAULT_TO && INCLUDE_MLS;', 'FROM <= DEFAULT_FROM && TO >= DEFAULT_TO;'),
  M('the marker is written without checking the end of the range', 'FROM <= DEFAULT_FROM && TO >= DEFAULT_TO && INCLUDE_MLS;', 'FROM <= DEFAULT_FROM && INCLUDE_MLS;'),
  M('the marker is written from the start of the range only', 'FROM <= DEFAULT_FROM && TO >= DEFAULT_TO', 'TO >= DEFAULT_TO'),
  M('INCLUDE_POSTSEASON accepts anything', ": process.env.INCLUDE_POSTSEASON === 'false' ? false : fail('INCLUDE_POSTSEASON must be true or false')", ': false'),
  M('the range limit is not applied', 'daysBetween(FROM, TO, 400)', 'daysBetween(FROM, TO, 40000)'),
  M('MLS is always in scope', "BSD_SOCCER_SPORTS.filter((s) => s !== 'MLS')", 'BSD_SOCCER_SPORTS'),
  M('out-of-scope days are not counted', 'v !== null && v.scope === 0 && v.pending > 0', 'false'),
  M('INCLUDE_MLS accepts anything', ": process.env.INCLUDE_MLS === 'false' ? false : fail('INCLUDE_MLS must be true or false')", ': false'),
  M('MAX_DATES has no real limit', "intEnv('MAX_DATES', 5, 1, 10)", "intEnv('MAX_DATES', 5, 1, 99)"),
  M('DRY_RUN accepts anything', ": process.env.DRY_RUN === 'false' ? false : fail('DRY_RUN must be true or false')", ': false'),
  M('a backwards range is accepted', 'if (days === null) fail(', 'if (false) fail('),
];

let bad = 0; const problems = [];
function runWith(text) {
  fs.writeFileSync(MUT, text);
  const parse = spawnSync(process.execPath, ['--check', MUT], { encoding: 'utf8' });
  if (parse.status !== 0) return { invalid: true, detail: (parse.stderr || '').split('\n').slice(0, 3).join(' | ') };
  const r = spawnSync(process.execPath, [CHECK, '--source', MUT, '--fail-fast'], { cwd: root, encoding: 'utf8', timeout: 200000 });
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
