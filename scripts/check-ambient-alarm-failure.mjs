#!/usr/bin/env node
// AmbientDO._scheduleAlarm, run against a stubbed storage that rejects
// (CC-CMD-2026-09-12-ambient-do-setalarm-swallowed Task 3).
//
// A swallowed error and a handled one are indistinguishable from outside, so
// the only test that means anything forces the rejection. These cases are the
// ones the posture was chosen for: it must LOG, it must retry EXACTLY ONCE, and
// the retry must not be able to loop.
//
// The method is extracted from source rather than imported — ambient-do.js is a
// Workers Durable Object module and instantiating it needs a real DO runtime.
// The extraction asserts exactly one match before anything runs.
//
// Coverage (Rule 91): one method, 3 scenarios. It says nothing about whether
// setAlarm ever actually rejects in production — that is a Cloudflare storage
// question no local test can answer.

import fs from 'node:fs';
const src = fs.readFileSync('src/ambient-do.js', 'utf8');

const all = [...src.matchAll(/_scheduleAlarm\(delayMs, _isRetry = false\) \{[\s\S]*?\n {4}\}/g)];
if (all.length !== 1) {
  console.error(`FAIL — extraction matched ${all.length} time(s), expected 1. Nothing was checked.`);
  process.exit(1);
}
const body = all[0][0];

// Build a standalone function with the same body, bound to a fake `this`.
const make = (storage) => {
  const logs = [];
  const fn = new Function('console', `return { ${body} };`)({
    error: (...a) => logs.push(a.join(' ')),
    log: () => {}, warn: () => {},
  })._scheduleAlarm;
  // The retry re-enters through `this._scheduleAlarm`, so the stub `this` must
  // carry the method. Without it the harness threw TypeError on the retry path
  // and reported a product failure that was its own — which is why the happy
  // path alone is never enough to trust a harness.
  const self = { ctx: { id: 'ambient-test-id', storage }, _scheduleAlarm: fn };
  return { call: (ms) => fn.call(self, ms), logs };
};

let failed = 0;
const check = (l, c, d) => { if (c) console.log(`  ok    ${l}`); else { failed++; console.error(`  FAIL  ${l}${d ? ` — ${d}` : ''}`); } };
const tick = () => new Promise(r => setTimeout(r, 0));

// ── 1. the happy path: one call, no log ──
{
  let calls = 0;
  const { call, logs } = make({ setAlarm: async () => { calls++; } });
  call(30000); await tick(); await tick();
  check('1a a successful setAlarm is called exactly once', calls === 1, `got ${calls}`);
  check('1b and logs nothing', logs.length === 0, JSON.stringify(logs));
}

// ── 2. THE DEFECT: a rejection must be logged, not swallowed ──
{
  let calls = 0;
  // The stub stops rejecting after 50 attempts. Without that bound, a mutation
  // removing the _isRetry guard makes the retry recurse forever and this check
  // HANGS instead of failing — which it did, leaving the mutated file on disk
  // and the job stuck. A test that can hang is a test that cannot report.
  const { call, logs } = make({ setAlarm: async () => {
    calls++;
    if (calls <= 50) throw new Error('storage unavailable');
  } });
  call(30000);
  for (let i = 0; i < 10; i++) await tick();
  check('2a the rejection is logged, not swallowed', logs.length > 0, 'nothing was logged — the error vanished');
  // Per-line, not `logs.some(...)`. Both lines carry delayMs, so `some` passed
  // with the delay deleted from the FIRST one — mutation A4 was NOT CAUGHT
  // until these were split. An assertion over a collection proves something
  // about the collection, which is weaker than what it was meant to say.
  const firstLine = logs.find(l => /retrying once/.test(l)) || '';
  const retryLine = logs.find(l => /retry ALSO failed/.test(l)) || '';
  check('2b the FIRST-failure log names the delay', /delayMs=30000/.test(firstLine), JSON.stringify(logs));
  check('2c the FIRST-failure log names the DO id', /ambient-test-id/.test(firstLine), JSON.stringify(logs));
  check('2d the FIRST-failure log carries the underlying message', /storage unavailable/.test(firstLine), JSON.stringify(logs));
  check('2d2 the RETRY log names the delay and the id too',
        /delayMs=30000/.test(retryLine) && /ambient-test-id/.test(retryLine), JSON.stringify(logs));
  // Exactly two attempts. Not one (no retry at all) and not three or more.
  check('2e it retries EXACTLY once — two attempts total', calls === 2, `got ${calls} attempt(s)`);
  check('2f the second failure says the instance is now stalled',
        logs.some(l => /will not poll again until a client connects/.test(l)), JSON.stringify(logs));
}

// ── 3. a retry that succeeds stops there ──
{
  let calls = 0;
  const { call, logs } = make({ setAlarm: async () => { calls++; if (calls === 1) throw new Error('transient'); } });
  call(15000);
  for (let i = 0; i < 10; i++) await tick();
  check('3a a transient failure is recovered by the single retry', calls === 2, `got ${calls}`);
  check('3b and the stalled-instance line is NOT logged',
        !logs.some(l => /will not poll again/.test(l)), JSON.stringify(logs));
}

console.log(`\nchecked 3 scenario(s) / 11 assertions against the extracted _scheduleAlarm. Proves the `
          + `posture (log + exactly one retry) holds when setAlarm rejects; says nothing about whether `
          + `setAlarm ever rejects in production.`);
if (failed) { console.error(`FAIL — ${failed} assertion(s).`); process.exit(1); }
console.log('PASS');
