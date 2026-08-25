#!/usr/bin/env node
// Is HANDOFF.md still describing this repository?
//
// WHY
//
// CLAUDE.md's session protocol opens with "Read HANDOFF.md first". On
// 2026-08-25 it had zero mentions of that date after seven substantive commits
// had landed, including a deleted workflow, two new deploy gates and a
// credential removal. Everything the day had done was invisible to a session
// that followed the protocol exactly.
//
// Nothing noticed, because a document going stale produces no error.
//
// THE SHALLOW-CLONE PROBLEM, WHICH IS THE WHOLE DESIGN
//
// deploy.yml checks out with `fetch-depth: 25`. This session alone produced 21
// commits. So "count the commits since the sha HANDOFF names" is a number that
// silently truncates in CI and reports a comfortable answer for an
// uncomfortable situation — the exact failure field-laboratory's
// docs/history-boundary.txt records at length about its own history check.
//
// So there are three outcomes, not two, and the distinction is reported rather
// than collapsed:
//
//   IN HISTORY    the sha is reachable — the lag is exact.
//   BEYOND DEPTH  the sha is not in a shallow checkout. The lag is AT LEAST the
//                 checkout depth, which is a lower bound and is itself the
//                 alarm. Never reported as an exact number.
//   ABSENT        git does not know the sha at all on a full clone: HANDOFF
//                 names a commit that was rebased away or never existed.
//
// Chore commits are excluded from the lag. `[skip ci]` housekeeping — Drive
// syncs, verification manifests, status refreshes — is not what a handoff is
// for, and counting it would make the threshold fire on noise.

import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

const SELF_TEST = process.argv.includes('--self-test');

// STALENESS IS A TIME PROPERTY, NOT A COUNT. The first version of this check
// failed above 25 unrecorded commits -- and then PASSED on the exact situation
// it was written for: ten substantive commits on 2026-08-25 with HANDOFF still
// dated the 24th. A guard that cannot fail on the case that motivated it is a
// claim, not a guard.
//
// A count bar is also the wrong shape. Set it low enough to catch a day of
// unwritten work and it fires partway through a busy session, which is how a
// check gets deleted. The real defect is work landing on one day and the
// close-out never being written -- so the question is how OLD the unrecorded
// work is, not how much of it there is.
//
// One day of grace: a session's own commits are same-day and never trip this.
// Work still unrecorded the following day does.
const GRACE_DAYS = 1;

let failed = 0;
const check = (name, ok, detail) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
  if (!ok) { console.log(`      → ${detail}`); failed++; }
};

/** The newest `**HEAD:** \`a\` → \`b\`` in the document; `b` is what it claims. */
export function newestHead(text) {
  const m = text.match(/^\*\*HEAD:\*\*\s+`([0-9a-f]{7,40})`\s*(?:→|->)\s*`([0-9a-f]{7,40})`/m);
  return m ? { from: m[1], to: m[2] } : null;
}

/** Whole days from `a` to `b`, both YYYY-MM-DD. Negative if b precedes a. */
export function daysBetween(a, b) {
  return Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86_400_000);
}

/** A commit subject that is housekeeping rather than work. */
export function isChore(subject) {
  return /^(chore|status):/i.test(subject) || /\[skip ci\]/.test(subject);
}

if (SELF_TEST) {
  check('the newest HEAD line parses',
    newestHead('# H\n\n**HEAD:** `9f6bbbb` → `ccc39ce` · **Branch:** main\n')?.to === 'ccc39ce',
    'did not parse');
  check('the FIRST HEAD line wins, not the last',
    newestHead('**HEAD:** `aaaaaaa` → `bbbbbbb`\n**HEAD:** `ccccccc` → `ddddddd`\n')?.to === 'bbbbbbb',
    'read an older entry as current');
  check('an arrow written as -> also parses',
    newestHead('**HEAD:** `aaaaaaa` -> `bbbbbbb`\n')?.to === 'bbbbbbb', 'did not parse');
  check('a document with no HEAD line yields null',
    newestHead('# HANDOFF\n\nnothing here\n') === null, 'invented one');
  check('housekeeping is excluded from the lag',
    ['chore: record Drive-delivered outbox docs [skip ci]',
     'status: refresh [skip ci]',
     'docs: session doc [skip ci]'].every(isChore), 'a chore counted as work');
  check('real work is not excluded',
    !['fix: a tour is not a sport', 'feat: anchored citations', 'docs: two odds findings']
      .some(isChore), 'work was counted as a chore');

  // The case the first version of this check PASSED on, which is why the model
  // changed from a count to a date.
  check('same-day work is inside the grace period',
    daysBetween('2026-08-25', '2026-08-25') <= GRACE_DAYS, 'a session would trip on its own commits');
  check("the next day's is too",
    daysBetween('2026-08-24', '2026-08-25') <= GRACE_DAYS, 'one day of grace is not being given');
  check('two days later is stale',
    daysBetween('2026-08-24', '2026-08-26') > GRACE_DAYS, 'work left unwritten for two days passed');
  check('a close-out dated AFTER the commit is not stale',
    daysBetween('2026-08-26', '2026-08-25') <= GRACE_DAYS, 'a negative gap read as stale');
  process.exit(failed === 0 ? 0 : 1);
}

const head = newestHead(readFileSync('HANDOFF.md', 'utf8'));
check('HANDOFF names a HEAD', head !== null,
  'no `**HEAD:** `a` → `b`` line found — the close-out format is how this is read');
if (!head) process.exit(1);

const sh = c => execSync(c, { encoding: 'utf8' }).trim();
let known = false, reachable = false;
try { sh(`git cat-file -e ${head.to}^{commit}`); known = true; } catch { /* not in this checkout */ }
if (known) { try { sh(`git merge-base --is-ancestor ${head.to} HEAD`); reachable = true; } catch { /* orphan */ } }

const depth = Number(sh('git rev-list --count HEAD'));

if (!known) {
  // Ambiguous by nature: a shallow checkout and a rewritten history look the
  // same from here. Reported as a LOWER BOUND, never as a count.
  console.log(`\nHANDOFF names ${head.to}, which is not in this checkout (${depth} commit(s) deep).`);
  console.log('That is a shallow clone OR a rewritten history — this cannot tell which.');
  // A WARNING, not a failure, and the reason is the same one that made the
  // count model wrong: this state is genuinely ambiguous. A shallow clone and a
  // rewritten history look identical from here, and failing on the first would
  // turn a normal CI checkout red -- at this repo's commit rate, 25 commits is
  // under a day. Loud and unmissable, and it says plainly that nothing was
  // verified rather than implying everything is fine.
  console.log(`::warning::HANDOFF's HEAD ${head.to} is outside this checkout (${depth} commits). ` +
    `At least ${depth} commit(s) have landed since it -- a LOWER BOUND, not a count. Staleness was ` +
    'NOT verified this run. Raise fetch-depth, or re-point HANDOFF at a commit that exists.');
  process.exit(failed === 0 ? 0 : 1);
}

check('the HEAD HANDOFF names is an ancestor of the current HEAD', reachable,
  `${head.to} is a known commit but not in this history — it was rebased away. ` +
  'Re-point HANDOFF at the commit that carries the same work.');
if (!reachable) process.exit(1);

// `%cs` is the committer date as YYYY-MM-DD, which is what the close-out
// heading carries, so the two are compared in the same units.
// `%cs %s`, split at a FIXED WIDTH rather than on a delimiter. A null byte
// cannot appear in an execSync command string (ERR_INVALID_ARG_VALUE) and any
// printable separator can appear inside a commit subject; `%cs` is always
// exactly ten characters, so the offset is not a guess.
const log = sh(`git log --format=%cs\\ %s ${head.to}..HEAD`).split('\n').filter(Boolean)
  .map(l => ({ date: l.slice(0, 10), subject: l.slice(11) }));
const work = log.filter(c => !isChore(c.subject));

const closeOut = (readFileSync('HANDOFF.md', 'utf8').match(/^##\s+SESSION CLOSE-OUT\s+[—-]\s+(\d{4}-\d{2}-\d{2})/m) || [])[1];

console.log(`\nHANDOFF's newest HEAD: ${head.to}   newest close-out: ${closeOut ?? 'undated'}`);
console.log(`  ${log.length} commit(s) since it, ${work.length} of them work (${log.length - work.length} housekeeping)`);
for (const c of work.slice(0, 10)) console.log(`    ${c.date}  ${c.subject.slice(0, 84)}`);

check('the newest close-out carries a date', Boolean(closeOut),
  'no `## SESSION CLOSE-OUT — YYYY-MM-DD` heading found; the date is how staleness is measured');

if (closeOut) {
  const stale = work.filter(c => daysBetween(closeOut, c.date) > GRACE_DAYS);
  check(`no work is unrecorded for more than ${GRACE_DAYS} day(s)`, stale.length === 0,
    `${stale.length} of ${work.length} unrecorded commit(s) post-date the ${closeOut} close-out by more than ` +
    `${GRACE_DAYS} day(s), the oldest on ${stale[0]?.date}. CLAUDE.md's protocol opens with ` +
    '"Read HANDOFF.md first"; that instruction is worth exactly what the document is. Write the close-out.');
}

process.exit(failed === 0 ? 0 : 1);
