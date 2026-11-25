#!/usr/bin/env node
// Mutation harness for scripts/espn-reference-grade.mjs and check-espn-reference-grade-run.mjs (CLAUDE.md Rule 90). Each mutant is a broken copy
// of the runner, written NEXT TO the real one (so its relative imports resolve) under a dot-name, run through the check with --source, and must
// turn it red. The harness distrusts itself first: every anchor must occur exactly once, every mutant must parse, and the unmodified copy and a
// comment-only copy must pass the check with at least MIN_ASSERTIONS assertions.
//   node scripts/mutate-espn-reference-grade.mjs --lab DIR     (DIR: a laboratory checkout that has scripts/espn-reference-grade-core.mjs)
//
// EQUIVALENT or NOT EXERCISED (not mutated, with the reason):
//   - the defaults of DAY_CAP (300) and ESPN_READ_CAP (400): a default is only a value; the workflow passes both explicitly, and a check that
//     reaches 300 days or 400 reads would be the e2 probe's check again at 100x the cost. The bounds are tested (0 and "many" are refused).
//   - the 30000 ceiling on ESPN_TIMEOUT_MS: a limit on a test knob; the check sets 400 and the run never sets it.
//   - encodeURIComponent(m.espnId): ESPN ids are digits; the check's ids contain nothing to encode, so no input of this check can tell.
//   - `espn: reach[i].reached ? espnRead.byKey.get(m.key) : null`: an unreached match has no entry in byKey, so undefined and null are the
//     same input to the core (it tests `!espn`).
//   - `isInt` on `g.matches` and `g.population` separately from their equality with the census numbers: the equality is tested next, so a non-integer fails it too.
//   - `espnRead.stopped === null` in `complete`: a 403 or 429 is itself a read that is neither 200 nor 404, so it is counted in `failed`, and `failed === 0` is
//     in the same conjunction; the stop term can differ from it for no input. It stays as the plain statement of the rule (a stop is not a result).
//   - the `String()` that the event-id comparison once had: lib reachEach builds every ESPN id with String() already, so the runner compares text with text.
//   - the integer, shape and tie terms that partitionsHold does NOT have: a fractional agree or disagree that is consistent in every sum passes it, and that cannot
//     come from a core that counts with ++; the census ties (population, matches) are the runner's own explicit checks beside it, each with its own case in the table.
//   - the redact() on analysisError: no input of this check makes the census analysis throw (its own check covers that); the same helper on
//     gradeError IS exercised (a core that throws with the token in its message).
//   - `bsdStopped === null` in `complete`: a BSD 429 or 401 means the request that got it returned no data, and every BSD request the census
//     makes (the opening count, each ledger page, the closing count) is needed for `ledger.complete`, so the census verdict is not ANSWERED
//     and `notReached` is set before `complete` is read (bsd-next-goal-census.mjs lines 311, 346 and 353). The scenario "a 429 from BSD" runs
//     that path and passes through the verdict, not through this term; it stays as a guard on the day the census changes.
//   - `census.gradeable === items.length` in `complete`: the same selection the census counts (populationOf uses the census's own captureOf), so
//     it can differ only if one of those two changes; the e2 probe's harness lists the same guard under the same reason.
//   - refuseIfTokenInside(body, TOKEN): the existing function, covered by its own check; with redact() in place a token cannot reach the body.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const MIN_ASSERTIONS = 69;
const dir = path.dirname(fileURLToPath(import.meta.url));
const REAL = path.join(dir, 'espn-reference-grade.mjs');
const MUT = path.join(dir, '.mutant-espn-reference-grade.mjs');
const CHECK = path.join(dir, 'check-espn-reference-grade-run.mjs');
const argv = process.argv.slice(2);
const labAt = argv.indexOf('--lab');
const LAB = path.resolve(labAt >= 0 ? argv[labAt + 1] : 'lab');
const src = fs.readFileSync(REAL, 'utf8');
const root = path.resolve(dir, '..');

const M = (name, anchor, replacement) => ({ name, anchor, replacement });
const MUTANTS = [
  M('loadCores: a missing export is not refused', "if (typeof mod[n] !== 'function') throw new Error(`${rel} does not export ${n}()`);", ''),
  M('loadCores: RULE_VERSION is not required', "if (typeof mod.RULE_VERSION !== 'string') throw new Error(`${rel} does not export RULE_VERSION`);", ''),
  M('loadCores: the existence check is gone', 'if (!fs.existsSync(file)) throw new Error(`${rel} does not exist under LAB_DIR ${labDir}: the laboratory was not checked out there`);', ''),
  M('main: a missing LAB_DIR is not refused', "if (typeof LAB_DIR !== 'string' || LAB_DIR === '') {", 'if (false) {'),
  M('main: a SHA is not required under the Actions', "process.env.GITHUB_ACTIONS === 'true' && !/^[0-9a-f]{40}$/", "false && !/^[0-9a-f]{40}$/"),
  M('main: a short SHA is accepted', '/^[0-9a-f]{40}$/.test(String(LAB_SHA))', '/^[0-9a-f]{4,40}$/.test(String(LAB_SHA))'),
  M('intEnv: a number below the minimum is accepted', 'n < min || n > max', 'n > max'),
  M('intEnv: a non-integer is accepted', '!Number.isInteger(n) ||', ''),
  M('main: the day cap is exclusive', 'if (days.length > DAY_CAP)', 'if (days.length >= DAY_CAP)'),
  M('readEspn: a 403 does not stop the run', 'if (r.status === 403 || r.status === 429) stopped = st;', 'if (r.status === 429) stopped = st;'),
  M('readEspn: a 429 does not stop the run', 'if (r.status === 403 || r.status === 429) stopped = st;', 'if (r.status === 403) stopped = st;'),
  M('readEspn: a stopped run keeps reading', 'if (stopped !== null) { out.set(m.key, null);', 'if (stopped === 0) { out.set(m.key, null);'),
  M('readEspn: the cap is exclusive', 'if (made >= readCap)', 'if (made > readCap)'),
  M('readEspn: no spacing between reads', 'if (made > 0) await sleep(SPACING_MS);', ''),
  M('readEspn: the default spacing moved', 'Number(process.env.ESPN_SPACING_MS) : 1000;', 'Number(process.env.ESPN_SPACING_MS) : 100;'),
  M('readEspn: a redirect is followed', "redirect: 'manual', headers: { Accept", "redirect: 'follow', headers: { Accept"),
  M('readEspn: no timeout on the read', "'User-Agent': 'FIELD/1.0' }, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) }", "'User-Agent': 'FIELD/1.0' } }"),
  M('readEspn: a 200 that is not the summary shape is not named', "if (espn === null) st = '200 not the summary shape';", 'if (espn === null) st = \'200\';'),
  M('readEspn: a non-JSON 200 is not named', "st = '200 non-JSON';", "st = '200';"),
  M('readEspn: a directory with no league is still asked', "if (league === undefined) { out.set(m.key, null); bump(statuses, '(no ESPN league for the directory)'); failed++; continue; }", ''),
  M('main: every match is asked of the same league', 'leagueOf(m.slug)', "leagueOf('epl')"),
  M('main: matches that were not reached are read too', '.filter((m) => m.reached);', ';'),
  M('main: the ESPN id comes from the wrong match', 'espnId: reach[i].espnId', 'espnId: reach[0].espnId'),
  M('main: the call time is dropped from the core input', 'resolved_minute: x.resolved_minute }', 'resolved_minute: undefined }'),
  M('main: the score at the call is dropped from the core input', 'score_at_call: x.score_at_call,', 'score_at_call: null,'),
  M('main: a grade that does not partition is accepted', "|| grade.partitions !== true", ''),
  M('main: the population is not compared', 'grade.population !== items.length ||', ''),
  M('main: the match count is not compared', '|| grade.matches !== matches.length', ''),
  M('main: a coverage line that is not text is accepted', "typeof gradeLine !== 'string' ||", ''),
  M('main: a missing grade still reaches the target', 'const complete = grade !== null && dayRead !== null', 'const complete = dayRead !== null'),
  M('main: unread days still reach the target', '&& [...dayRead.dayRows.values()].every((v) => v !== null)', ''),
  M('main: a stopped day read still reaches the target', 'dayRead.stopped === null &&', 'true &&'),
  M('main: a reached ESPN cap still reaches the target', '&& espnRead.capped === false && espnRead.failed === 0 && bsdStopped === null', '&& espnRead.failed === 0 && bsdStopped === null'),
  M('main: -latest.json always advances', "if (complete) { fs.writeFileSync('outbox/espn-reference-grade-latest.json'", "if (true) { fs.writeFileSync('outbox/espn-reference-grade-latest.json'"),
  M('main: an empty population is searched anyway', "else if (notReached === null && analysisError === null) notReached = 'the census found no gradeable calls';", ''),
  M('main: an empty population reads days', 'analysisError === null && matches.length > 0) {', 'analysisError === null) {'),
  M('main: the census verdict is not consulted', "analysis.calls.verdict !== 'ANSWERED'", "analysis.calls.verdict === 'NEVER'"),
  M('main: the reach is computed on no rows', 'reachEach({ matches, dayRows: dayRead.dayRows })', 'reachEach({ matches, dayRows: new Map() })'),
  M('main: a core that throws leaks its message', 'gradeError = redact(String(e && e.stack ? e.stack : e)', 'gradeError = (String(e && e.stack ? e.stack : e)'),
  M('artifact: the laboratory commit is not recorded', 'cores: { labSha: LAB_SHA,', 'cores: { labSha: null,'),
  M('artifact: the ESPN core is recorded by the other core\'s hash', 'espnCoreSha256: cores.espn.sha256', 'espnCoreSha256: cores.bsd.sha256'),
  M('artifact: the first core is recorded by the other core\'s hash', 'bsdCoreSha256: cores.bsd.sha256', 'bsdCoreSha256: cores.espn.sha256'),
  M('artifact: the runner does not record itself', 'runnerSha256: fileSha(fileURLToPath(import.meta.url))', "runnerSha256: fileSha(path.join(dir, 'espn-task0-lib.mjs'))"),
  M('artifact: the lib hash is the census hash', "libSha256: fileSha(path.join(dir, 'espn-task0-lib.mjs'))", "libSha256: fileSha(path.join(dir, 'bsd-next-goal-census.mjs'))"),
  M('artifact: the reach probe is not recorded', "reachSha256: fileSha(path.join(dir, 'bsd-e2-reach-probe.mjs'))", 'reachSha256: null'),
  M('coverage: the denominator of the ESPN reads is the matches, not the reached', 'ESPN summaries read ${espnOk} of ${reachedCount} reached', 'ESPN summaries read ${espnOk} of ${matches.length} reached'),
  M('coverage: the matches that were not reached are not listed', ', not reached [${notReachedLine}]', ''),
  M('coverage: the reached count is the match count', '${matches.length}: reached ${reachedCount}', '${matches.length}: reached ${matches.length}'),
  M('artifact: the reach counts are not recorded', 'calls: items.length, matches: matches.length, reachCounts,', 'calls: items.length, matches: matches.length, reachCounts: {},'),

  // ---- the independent reader of 2026-11-25
  M('readEspn: a summary for another event is graded', "if (idCheck === 'differs') { espn = null; st = '200 other event'; }", ''),
  M('readEspn: an absent event id is refused', "const idCheck = got === null ? 'absent' :", "const idCheck = got === null ? 'differs' :"),
  M('readEspn: the event id is compared with another id', "got === m.espnId ? 'matched'", "got === 'x' ? 'matched'"),
  M('readEspn: the event ids are not counted', 'bump(ids, idCheck);', ''),
  M('readEspn: any status has its body parsed', 'if (r.status === 200) {\n        let json = null;', 'if (true) {\n        let json = null;'),
  M('readEspn: a read that did not answer is not counted as failed', "if (st !== '200' && st !== '404') failed++;", ''),
  M('readEspn: a 404 is a failed read', "if (st !== '200' && st !== '404') failed++;", "if (st !== '200') failed++;"),
  M('readEspn: a 200 that was refused is not a failed read', "if (st !== '200' && st !== '404') failed++;", "if (!/^[2-4]/.test(st)) failed++;"),
  M('main: reads that did not answer still reach the target', '&& espnRead.capped === false && espnRead.failed === 0 && bsdStopped === null', '&& espnRead.capped === false && bsdStopped === null'),
  M('main: the ESPN reads are counted as timelines', 'summariesRead: espnOk }', 'summariesRead: espnOk, timelinesRead: espnOk }'),
  M('main: the shared ESPN ids are not counted', 'const sharedIds = [...idUse.values()].filter((n) => n > 1).reduce((t, n) => t + n, 0);', 'const sharedIds = 0;'),
  M('main: a shared ESPN id counts once, not per match', 'const sharedIds = [...idUse.values()].filter((n) => n > 1).reduce((t, n) => t + n, 0);', 'const sharedIds = [...idUse.values()].filter((n) => n > 1).length;'),
  M('main: an id used by one match is shared', 'const sharedIds = [...idUse.values()].filter((n) => n > 1).reduce((t, n) => t + n, 0);', 'const sharedIds = [...idUse.values()].filter((n) => n > 0).reduce((t, n) => t + n, 0);'),
  M('main: the numbers the core returned are not added up again', '        if (!partitionsHold(grade)) throw', '        if (false) throw'),
  M('partitions: graded need not be agree plus disagree', 'g.population === g.graded + g.notApplicable.total && g.graded === g.agree + g.disagree', 'g.population === g.graded + g.notApplicable.total'),
  M('partitions: the population need not be graded plus not applicable', 'g.population === g.graded + g.notApplicable.total && g.graded === g.agree + g.disagree', 'g.graded === g.agree + g.disagree'),
  M('partitions: the reasons need not add up', '&& sum(reasons) === g.notApplicable.total', ''),
  M('partitions: the directories need not add up to the calls', '&& sum(slugs.map((x) => x.calls)) === g.population', ''),
  M('partitions: the directories need not add up to graded', "&& sum(slugs.map((x) => x.graded)) === g.graded", ''),
  M('partitions: the directories need not add up to agree', "&& sum(slugs.map((x) => x.agree)) === g.agree\n    && sum(slugs.map((x) => x.disagree))", "\n    && sum(slugs.map((x) => x.disagree))"),
  M('partitions: the directories need not add up to disagree', "&& sum(slugs.map((x) => x.disagree)) === g.disagree", ''),
  M('partitions: the directories need not add up to not applicable', "&& sum(slugs.map((x) => x.notApplicable)) === g.notApplicable.total;", ';'),
  M('partitions: the reason counts need not be whole numbers', 'return reasons.every((x) => Number.isInteger(x) && x >= 0)\n    && g.population', 'return g.population'),
  M('partitions: the tables need not exist', 'if (!isObj(g) || !isObj(g.notApplicable) || !isObj(g.notApplicable.byReason) || !isObj(g.bySlug)) return false;', ''),
];

let bad = 0;
const problems = [];
function runWith(text) {
  fs.writeFileSync(MUT, text);
  const parse = spawnSync(process.execPath, ['--check', MUT], { encoding: 'utf8' });
  if (parse.status !== 0) return { invalid: true, detail: (parse.stderr || '').split('\n').slice(0, 3).join(' | ') };
  const r = spawnSync(process.execPath, [CHECK, '--lab', LAB, '--source', MUT, '--fail-fast'], { cwd: root, encoding: 'utf8', timeout: 240000 });
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
