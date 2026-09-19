#!/usr/bin/env node
// Does HANDOFF still say a thing has not happened, after it happened?
//
// MEASURED 2026-09-19, AND THE EXISTING GUARD PASSED THROUGHOUT.
// HANDOFF and the session doc were written at 03:0xZ. The 200-credit fill ran
// at 03:26Z. Both documents kept saying "verified and UNRUN", with dispatch
// instructions, for ten hours. A session reading either would have re-proposed
// a spend that had already happened.
//
// check-handoff-current.mjs did not fire, and was right not to: it measures the
// document's AGE against a one-day grace, and the document was hours old. Age
// was never the defect. The CLAIM was.
//
// So this asks the other question: for every place HANDOFF asserts that a named
// workflow has NOT run, did that workflow in fact run since the close-out? That
// is a contradiction a machine can find, and it is the only part of a handoff a
// machine should be trusted with.
//
// WHAT THIS DELIBERATELY DOES NOT DO. It does not write the handoff. The value
// of a close-out is the part no generator produces — "six pairs priced 99-100%,
// four bought one game between them", "the yield curve is an upper bound, never
// an estimate", "the prediction missed for a reason the model did not contain".
// A generated entry would be a git log with prose around it: present, passing,
// and worth nothing. The machine records WHAT HAPPENED; the session records
// WHAT IT MEANS. Automating the second half is how a document becomes furniture.
//
// READ-ONLY: HANDOFF.md and the GitHub Actions API, GET only.

const TOKEN = process.env.GITHUB_TOKEN;
const REPO  = process.env.GITHUB_REPOSITORY || 'jeffunglesbee-create/field-relay-nba';

// Phrases that assert a thing has NOT happened. Deliberately narrow: each one
// is an assertion of non-occurrence, not a description of state. "OPEN" and
// "blocked" are NOT here — a blocked item is honestly open even after a run.
export const NEGATIVE_CLAIMS = [
  'UNRUN', 'has not run', 'have not run', 'has never run', 'not yet run',
  'NOT run', 'not been run', 'never been run', 'awaiting dispatch',
];

// Claims of non-occurrence that a workflow run can NEVER settle. A feature that
// was not written does not become written because some workflow succeeded, so
// anchoring one of these to a nearby `.yml` would manufacture a contradiction
// out of proximity. They are counted and reported as unchecked — which is the
// honest answer — and never checked.
export const UNCHECKABLE_CLAIMS = ['NOT built', 'not been built', 'never built', 'not implemented'];

/** Claims of non-occurrence that also name a workflow file.
 *  A claim with no workflow named is not returned: there is nothing to check it
 *  against, and inventing a target would be worse than skipping it. The live
 *  run reports how many were skipped for that reason (Rule 91). */
export function claimsFrom(markdown) {
  const lines = String(markdown || '').split('\n');
  const out = [], unanchored = [];
  let section = '(top)';
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const isHeading = /^#{2,4}\s/.test(line);
    if (isHeading) section = line.replace(/^#+\s*/, '').trim();
    // HEADINGS ARE CHECKED, NOT SKIPPED. The 2026-09-19 claim lived in one —
    // "### OPEN — the 200-credit fill is verified and UNRUN" — and a parser that
    // treated every heading as structure and moved on found zero claims in the
    // document it was written for. Caught by the self-test, which is the only
    // reason this line reads this way.
    const unfixable = UNCHECKABLE_CLAIMS.find(p => line.includes(p));
    if (unfixable) { unanchored.push({ section, phrase: unfixable, line: i + 1, reason: 'no run can settle it' }); continue; }
    const phrase = NEGATIVE_CLAIMS.find(p => line.includes(p));
    if (!phrase) continue;
    // The workflow may be named on this line or anywhere in the same section,
    // because "Dispatch `x.yml` with ..." routinely sits a line below the claim.
    let wf = (line.match(/`?([a-z0-9][a-z0-9._-]*\.yml)`?/i) || [])[1];
    if (!wf) {
      for (let j = i + 1; j < Math.min(i + 8, lines.length); j++) {
        if (/^#{2,4}\s/.test(lines[j])) break;
        const m = lines[j].match(/`?([a-z0-9][a-z0-9._-]*\.yml)`?/i);
        if (m) { wf = m[1]; break; }
      }
    }
    // A CLAIM THAT HAS BEEN SUPERSEDED IS NO LONGER AN ASSERTION. This repo
    // corrects history in place rather than deleting it — "The original text
    // follows because the cause is worth keeping" — so a false claim is meant
    // to stay on the page under a marker saying what happened instead. Reading
    // the marker is the difference between a guard that enforces the
    // convention and one that forbids it.
    const superseded = lines.slice(i, Math.min(i + 14, lines.length))
      .findIndex(l => /SUPERSEDED|\bRESOLVED\b|no longer true|corrected below/i.test(l));
    if (superseded !== -1) { unanchored.push({ section, phrase, line: i + 1, reason: 'superseded in place' }); continue; }
    if (wf) out.push({ section, workflow: wf, phrase, line: i + 1 });
    else unanchored.push({ section, phrase, line: i + 1, reason: 'names no workflow' });
  }
  return { claims: out, unanchored };
}

/** Did the named workflow succeed after the close-out?
 *  `runs` are that workflow's runs, newest first. A claim of non-occurrence is
 *  CONTRADICTED by a success at or after the close-out date. */
export function contradiction(claim, runs, closeOutDate) {
  if (!Array.isArray(runs)) return { state: 'unreadable', claim };
  if (!closeOutDate) return { state: 'no-close-out', claim };
  const after = runs.filter(r => r && r.conclusion === 'success'
    && String(r.run_started_at || '').slice(0, 10) >= closeOutDate);
  if (!after.length) return { state: 'consistent', claim };
  return { state: 'contradicted', claim, at: after[0].run_started_at, id: after[0].id };
}

export function verdict(results) {
  const bad = results.filter(r => r.state === 'contradicted');
  if (bad.length) return { state: 'stale-claims', count: bad.length };
  if (!results.length) return { state: 'no-claims' };
  return { state: 'consistent', count: results.length };
}

if (process.argv.includes('--self-test')) {
  let bad = 0;
  const one = (label, got, want, why) => JSON.stringify(got) === JSON.stringify(want)
    ? console.log(`  PASS  ${label} -> ${JSON.stringify(got)}  (${why})`)
    : (bad++, console.log(`  FAIL  ${label}: got ${JSON.stringify(got)} want ${JSON.stringify(want)}  (${why})`));

  const DOC = `## SESSION CLOSE-OUT — 2026-09-19

### OPEN — the 200-credit fill is verified and UNRUN

10 pairs, 200 credits. Dispatch \`targeted-odds-fill.yml\` with
\`apply=true, max_pairs=10\`.

### OPEN — a pair with 0 events in window will fail forever

NOT built — no session has been asked to.

### OPEN — the atomic counter

Two owner decisions first. Blocked on the vendor verdict.
`;
  const c = claimsFrom(DOC);
  one('THE 2026-09-19 CASE', c.claims.length, 1,
      'one claim of non-occurrence that names a workflow, exactly as HANDOFF carried it');
  one('the workflow is found a line below', c.claims[0].workflow, 'targeted-odds-fill.yml',
      '"Dispatch `x.yml`" routinely sits under the claim, not on it');
  one('a claim no run can settle is never anchored', c.unanchored.length, 1,
      '"NOT built" cannot be disproved by a workflow succeeding; anchoring it to a nearby .yml would invent a contradiction from proximity');
  one('and it is reported, not dropped', c.unanchored[0].reason, 'no run can settle it',
      'unchecked and silent are different, and only one of them is honest');

  // The repo corrects history in place. A guard that ignored the marker would
  // make the only honest way to fix an old entry — leaving it visible under a
  // correction — permanently red, and the pressure would be to DELETE history.
  const FIXED = `### OPEN — the cron has not yet run with the new matcher

Next \`odds-backfill.yml\` run is the first evidence.

> **SUPERSEDED 2026-09-19.** It has run, and it pairs 66 of 80.
`;
  one('a superseded claim is not an assertion', claimsFrom(FIXED).claims.length, 0,
      'the correction idiom this repo already uses must not be what turns the guard red');
  one('and it says WHY it was skipped', claimsFrom(FIXED).unanchored[0].reason, 'superseded in place',
      'a claim dropped without a reason is indistinguishable from one never seen');
  one('"blocked" is not a claim of non-occurrence', /blocked/i.test(DOC) && c.claims.length, 1,
      'a blocked item is honestly open after a run; only non-occurrence is checkable');

  const RUN = (d, concl) => ({ run_started_at: d + 'T03:26:09Z', conclusion: concl, id: 1 });
  one('a success after the close-out CONTRADICTS',
      contradiction(c.claims[0], [RUN('2026-09-19', 'success')], '2026-09-19').state, 'contradicted',
      'the fill ran at 03:26Z on the same day the document said it had not');
  one('a success BEFORE the close-out does not',
      contradiction(c.claims[0], [RUN('2026-09-17', 'success')], '2026-09-19').state, 'consistent',
      'an older run is what the close-out was written knowing about');
  one('a FAILED run does not contradict',
      contradiction(c.claims[0], [RUN('2026-09-19', 'failure')], '2026-09-19').state, 'consistent',
      'a run that failed did not do the thing the document says was not done');
  one('no runs is consistent, not unknown',
      contradiction(c.claims[0], [], '2026-09-19').state, 'consistent', 'an empty list is a real answer here');
  one('an unreadable list is NOT consistent',
      contradiction(c.claims[0], null, '2026-09-19').state, 'unreadable',
      'absent is not agreement (Rule 99)');
  one('no close-out date is its own state',
      contradiction(c.claims[0], [], null).state, 'no-close-out', 'nothing to measure "after" against');

  one('one contradiction fails the run', verdict([{ state: 'contradicted' }, { state: 'consistent' }]).state,
      'stale-claims', 'a single false claim is the defect; the rest is volume');
  one('no claims is not a pass dressed up', verdict([]).state, 'no-claims',
      'a document with no checkable claim has not been verified, it has been skipped');

  console.log(bad ? `\n${bad} FAILED` : `\nself-test: 15/15`);
  console.log(`COVERAGE: three pure predicates over an enumerated document. It does NOT`);
  console.log(`reach HANDOFF.md or the Actions API, and it can only check claims that NAME`);
  console.log(`a workflow — a false claim about anything else is invisible to it.`);
  process.exit(bad ? 1 : 0);
}

import { readFileSync } from 'node:fs';

const doc = readFileSync('HANDOFF.md', 'utf8');
const closeOut = (doc.match(/^##\s+SESSION CLOSE-OUT\s+[—-]\s+(\d{4}-\d{2}-\d{2})/m) || [])[1];
const { claims, unanchored } = claimsFrom(doc);

console.log(`=== handoff claims  repo=${REPO}  utc=${new Date().toISOString()} ===\n`);
console.log(`  newest close-out : ${closeOut ?? 'undated'}`);
console.log(`  claims of non-occurrence naming a workflow : ${claims.length}`);
console.log(`  claims NOT checkable (no workflow, or no run could settle them) : ${unanchored.length}`);
for (const u of unanchored) console.log(`      line ${u.line}  "${u.phrase}"  — ${u.reason || 'names no workflow'}`);

if (!closeOut) {
  console.error(`\nFAIL: no dated close-out heading, so "after" has no anchor.`);
  process.exit(1);
}

async function runsFor(wf) {
  if (!TOKEN) throw new Error('GITHUB_TOKEN is not set');
  const res = await fetch(`https://api.github.com/repos/${REPO}/actions/workflows/${wf}/runs?per_page=20`, {
    headers: { Authorization: `Bearer ${TOKEN}`, Accept: 'application/vnd.github+json',
               'User-Agent': 'field-relay-handoff-claims' },
  });
  if (res.status === 404) return [];           // a workflow that does not exist cannot have run
  if (!res.ok) return null;                    // unreadable is NOT an empty list
  return (await res.json()).workflow_runs || [];
}

const results = [];
for (const c of claims) {
  const runs = await runsFor(c.workflow).catch(() => null);
  const r = contradiction(c, runs, closeOut);
  results.push(r);
  console.log(`\n  ${c.workflow}  (line ${c.line}, "${c.phrase}")`);
  console.log(`      section : ${c.section}`);
  console.log(`      state   : ${r.state}${r.at ? `  — succeeded ${r.at}` : ''}`);
}

const v = verdict(results);
console.log(`\n  verdict: ${v.state}`);
console.log(`\nCOVERAGE: ${claims.length} checkable claim(s) of ${claims.length + unanchored.length} found;`);
console.log(`${unanchored.length} name no workflow and are NOT checked. This asks only whether a`);
console.log(`document says something has not run that has run. It cannot tell whether the`);
console.log(`rest of the document is true, and nothing here writes the handoff.`);

if (v.state === 'stale-claims') {
  console.error(`\nFAIL: ${v.count} section(s) say a workflow has not run, and it has.`);
  console.error(`      The age guard passes on these — the document is hours old and the`);
  console.error(`      claim inside it is false. Rewrite the section with what the run did.`);
  process.exit(1);
}
if (v.state === 'no-claims') console.log(`\nOK: nothing in HANDOFF asserts a named workflow has not run.`);
else console.log(`\nOK: all ${v.count} claim(s) of non-occurrence still hold.`);
