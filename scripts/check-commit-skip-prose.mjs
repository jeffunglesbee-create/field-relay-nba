#!/usr/bin/env node
// A commit message that MENTIONS the skip directive suppresses every workflow.
//
// MEASURED, NOT REASONED. On 2026-09-17 commit c195b0d carried the 09-16d
// session doc plus a body explaining why the directive was NOT being used:
//
//   "No [<the token>]: deploy.yml filters on src/** ... but [<the token>] would
//    suppress drive-upload-outbox.yml and the session doc would never reach
//    Drive"
//
// GitHub scans the entire message, body included, and matched the token inside
// that explanation. Runs for that SHA: ZERO. Deploy, the Drive upload, and every
// gate in this repo were skipped by a sentence saying they should not be.
//
// WHY THIS CANNOT BE A CI GATE. The condition it detects is the condition that
// stops CI from running. A workflow step asserting "no commit mentions the
// token" can never fire on the commit that mentions it. So this is a local
// check, run before pushing, and its only enforcement is that it exists and is
// cheap to run:  node scripts/check-commit-skip-prose.mjs [<rev-range>]
//
// It reads git log, so the range is whatever you are about to push:
//   node scripts/check-commit-skip-prose.mjs origin/main..HEAD
//
// --self-test needs no git.
import { execFileSync } from 'node:child_process';

// Built from parts so this FILE does not contain the literal token — a check
// that trips itself is the joke this repo has already made twice.
const TOKEN = ['[skip', 'ci]'].join(' ');
const ALT   = ['[ci', 'skip]'].join(' ');

/** Returns the reasons a message would suppress workflows, or [] if it is safe.
 *  A message may still USE the directive deliberately — that is what `intent`
 *  is for: a commit whose SUBJECT needs it declares so, and only the body is
 *  then treated as prose. */
export function skipProseProblems(message) {
  const lines = String(message || '').split('\n');
  const subject = lines[0] || '';
  const body = lines.slice(1).join('\n');
  const has = (s, t) => s.includes(t);
  const out = [];
  const deliberate = has(subject, TOKEN) || has(subject, ALT);
  for (const [t, name] of [[TOKEN, 'skip-ci'], [ALT, 'ci-skip']]) {
    if (has(body, t)) {
      out.push(deliberate
        ? `body mentions the ${name} directive; harmless here because the SUBJECT already carries it, but say "the skip directive" instead`
        : `body mentions the ${name} directive — GitHub reads the whole message and will suppress EVERY workflow for this commit`);
    }
  }
  // Only a body mention on a commit that did NOT mean it is a failure.
  return deliberate ? [] : out;
}

if (process.argv.includes('--self-test')) {
  let bad = 0;
  const one = (label, got, want, why) => got === want
    ? console.log(`  PASS  ${label} -> ${got}  (${why})`)
    : (bad++, console.log(`  FAIL  ${label}: got ${got} want ${want}  (${why})`));
  const n = (m) => skipProseProblems(m).length;

  one('a clean message', n('docs: a close-out\n\nNothing unusual here.'), 0, 'no directive anywhere');
  one('the c195b0d shape', n(`docs: close-out\n\nNo ${TOKEN}: deploy.yml already filters on src/**.`), 1,
      'the commit that suppressed every workflow while explaining that it would not');
  one('the ci-skip spelling', n(`docs: close-out\n\nwe avoid ${ALT} on docs commits`), 1,
      'GitHub honours both spellings');
  one('both spellings in one body', n(`docs: x\n\n${TOKEN} and ${ALT}`), 2, 'each is reported');
  one('a deliberate subject', n(`chore: watch result ${TOKEN}`), 0,
      'the directive is MEANT here — this check must not block the convention it protects');
  one('deliberate subject, body repeats it', n(`chore: watch result ${TOKEN}\n\nbecause ${TOKEN} is correct on probe commits`), 0,
      'already suppressed by the subject; the body changes nothing');
  one('the words apart', n('docs: x\n\nwe skip the ci step for docs'), 0,
      'prose about skipping is not the token — a check at that precision gets ignored');

  console.log(bad ? `\n${bad} FAILED` : `\nself-test: 7/7`);
  console.log(`COVERAGE: the predicate only. It does not read git, and it cannot see a`);
  console.log(`commit already pushed — by then the workflows are already skipped.`);
  process.exit(bad ? 1 : 0);
}

const range = process.argv[2] || 'origin/main..HEAD';
let log = '';
try {
  log = execFileSync('git', ['log', '--format=%H%x00%B%x00%x00', range], { encoding: 'utf8' });
} catch (e) {
  console.log(`FAIL: cannot read git log for ${range} (${e.message}).`);
  process.exit(1);
}

const commits = log.split('\x00\x00').map(c => c.trim()).filter(Boolean)
  .map(c => { const [sha, msg] = c.split('\x00'); return { sha: (sha || '').trim(), msg: msg || '' }; });

console.log(`=== commit messages that would suppress CI  range=${range} ===\n`);
let problems = 0;
for (const c of commits) {
  const bad = skipProseProblems(c.msg);
  problems += bad.length;
  for (const b of bad) console.log(`  FAIL  ${c.sha.slice(0, 7)}  ${b}`);
}
console.log(`\nCOVERAGE: ${commits.length} commit(s) in ${range}. It judges the MESSAGE only —`);
console.log(`it cannot tell whether the workflows those commits needed actually ran.`);
console.log(problems ? `\n${problems} FAILED` : `\nno commit message suppresses CI by accident`);
process.exit(problems ? 1 : 0);
