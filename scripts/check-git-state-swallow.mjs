#!/usr/bin/env node
// No workflow may hide a MUTATING git command's failure behind `|| true`.
//
// WRITTEN FROM A MEASURED FAILURE. On 2026-09-13 two probe runs concluded
// failure while both probes succeeded. The cause was one line:
//
//     git pull --rebase --autostash origin main || true
//
// `|| true` swallows the exit code but NOT the state. A content conflict leaves
// a detached HEAD with unmerged files, and every later push fails with "You are
// not currently on a branch". The retries cannot succeed — they are guaranteed
// failures with real sleeps between them, and the run reports the symptom of its
// own damage rather than the original race.
//
// A RATCHET THAT REACHED ZERO. Eight workflows carried this shape when the check
// was written; all eight are converted. The allowance is now empty, so any
// workflow that grows the shape fails the build outright — which is what a
// ratchet is for, and why it was worth starting at eight rather than at zero. A
// gate that goes red on day one gets disabled, and a disabled gate protects
// nothing.
import { readFileSync, readdirSync } from 'node:fs';

// Measured 2026-09-13, `grep -rn "pull --rebase --autostash.*|| true"`. Every
// entry is a known defect awaiting its own CC-CMD. Removing one is the only
// edit this list should ever receive.
// EMPTY, 2026-09-14. All eight converted to scripts/probe-commit-retry.sh under
// CC-CMD-2026-09-14-git-state-swallow-sweep. The set stays here rather than
// being deleted with the check: the ratchet's job now is that it never refills.
const KNOWN = new Set([]);

// `git rebase --abort || true` is NOT this defect: it returns to a clean branch,
// which is the thing `|| true` on a pull fails to do. The pattern below matches
// only commands that leave state behind when they fail.
const SWALLOW = /\bgit\s+(pull|rebase|merge|cherry-pick|am)\b[^\n|]*\|\|\s*true\s*$/;

let checked = 0, failed = 0;
const eq = (label, got, want) => {
  checked++;
  const ok = got === want;
  if (!ok) failed++;
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${label}${ok ? '' : ` — got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`}`);
};

const dir = '.github/workflows';
const files = readdirSync(dir).filter(f => f.endsWith('.yml'));
const offenders = [];
for (const f of files) {
  for (const line of readFileSync(`${dir}/${f}`, 'utf8').split('\n')) {
    const t = line.trim();
    if (t.startsWith('#')) continue;
    // `|| git rebase --abort || true` recovers before swallowing; the trailing
    // `|| true` there guards the abort itself, not the mutating command.
    if (/\|\|\s*git\s+rebase\s+--abort/.test(t)) continue;
    if (SWALLOW.test(t)) { offenders.push(f); break; }
  }
}

const newOnes = offenders.filter(f => !KNOWN.has(f));
const fixed = [...KNOWN].filter(f => !offenders.includes(f));

eq(`no NEW workflow swallows a mutating git failure (${newOnes.join(', ') || 'none'})`,
   newOnes.length, 0);
eq(`the allowance has not grown (${offenders.length} found, ${KNOWN.size} allowed)`,
   offenders.length <= KNOWN.size, true);
// A fixed workflow must leave the list, or the ratchet stops ratcheting.
eq(`every fixed workflow has been removed from KNOWN (${fixed.join(', ') || 'none stale'})`,
   fixed.length, 0);

console.log(`\n${failed ? 'FAILED' : 'PASS'}: ${checked - failed}/${checked} assertions`
          + ` — scanned ${files.length} workflow(s), ${offenders.length} still swallow, `
          + `${KNOWN.size} allowed`);
process.exit(failed ? 1 : 0);
