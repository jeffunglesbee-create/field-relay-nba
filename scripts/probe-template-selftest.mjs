// CC-CMD-2026-08-09-create-field-laboratory-repo, Task 6 verification.
//
// Minimal by design. Its only job is to prove the ported _reusable-probe.yml
// wiring works end to end: that checkout happened (so there is a git repo to
// commit into), that the script ran, and that its output survived to a real
// committed file. It deliberately asserts nothing about FIELD itself --
// anything else it checked would blur which layer a failure came from.
//
// The CC-CMD requires the committed output be read back, not inferred from a
// green CI status. So this writes values that could only come from a real run:
// the runner's own env, and a timestamp.

import { writeFileSync, mkdirSync } from 'node:fs';

const ts = new Date().toISOString().replace(/[:.]/g, '-');
mkdirSync('outbox', { recursive: true });

const payload = {
  probe: 'probe-template-selftest',
  ccCmd: 'CC-CMD-2026-08-09-create-field-laboratory-repo',
  ts,
  // Present only inside a real GitHub Actions run. If a future reader finds
  // these null, the file did not come from the workflow it claims to.
  runId: process.env.GITHUB_RUN_ID ?? null,
  repo: process.env.GITHUB_REPOSITORY ?? null,
  sha: process.env.GITHUB_SHA ?? null,
  nodeVersion: process.version,
  // Proves the checkout step ran: this file cannot be read without it.
  sawOwnSource: true,
};

const path = `outbox/probe-template-selftest-${ts}.json`;
writeFileSync(path, JSON.stringify(payload, null, 2));
console.log(`wrote ${path}`);
console.log(JSON.stringify(payload, null, 2));
