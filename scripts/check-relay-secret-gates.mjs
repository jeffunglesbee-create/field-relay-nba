#!/usr/bin/env node
// Every relay gate reads the shared secret from the Worker binding and fails
// CLOSED. docs/CC-CMD-2026-08-25-rotate-relay-secret.md, step 1.
//
// WHY THIS EXISTS, 2026-10-13
//
// The gates compared X-FIELD-Relay against a compiled-in literal: a credential
// for POST /d1/execute in every clone of a public repository. They now go
// through relaySecretMatches(header, env). Two ways that can go wrong quietly,
// and this checks both:
//
//   1. THE HELPER OPENS ON AN UNSET BINDING. `header === env.RELAY_SHARED_SECRET`
//      is `undefined === undefined` for a caller that sends no header to a
//      Worker with no binding. That is open, and it is exactly the state both
//      Workers were in until 2026-10-13T06:36Z (scripts/worker-secret-names.sh
//      read ABSENT on both). The helper is extracted from src/index.js and run.
//
//   2. A GATE OR A FALLBACK COMES BACK. One `!== '<literal>'` or one
//      `env.RELAY_SHARED_SECRET || '<literal>'` and the rotation stops being
//      one: the old value keeps working beside the new one.
//
// --self-test is the mutation counterpart: each mutation is a way back to one
// of those two states, and must turn this check red.
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const INDEX = 'src/index.js';
const PROXY = 'workers/field-claude-proxy/src/index.js';
const FALLBACK_SCOPE = ['src/index.js', 'src/analytics-engine.js', PROXY];

export function checkSources(index, proxy, others = {}) {
  const out = [];
  const ok = (name, pass, detail) => out.push({ name, pass, detail });

  // 1. the helper, run.
  const m = index.match(/function relaySecretMatches\(header, env\) \{[\s\S]*?\n\}/);
  ok('the helper exists', !!m, 'function relaySecretMatches(header, env) not found in src/index.js');
  if (m) {
    let fn = null;
    try { fn = new Function(`${m[0]}; return relaySecretMatches;`)(); } catch (e) { /* reported below */ }
    ok('the helper compiles', typeof fn === 'function', 'the extracted helper did not evaluate');
    if (typeof fn === 'function') {
      const cases = [
        ['no binding, no header',        undefined, {},                              false],
        ['no env at all',                undefined, undefined,                       false],
        ['empty binding, empty header',  '',        { RELAY_SHARED_SECRET: '' },     false],
        ['binding set, no header',       undefined, { RELAY_SHARED_SECRET: 's3cret-value' }, false],
        ['binding set, wrong header',    'nope',    { RELAY_SHARED_SECRET: 's3cret-value' }, false],
        ['binding set, right header',    's3cret-value', { RELAY_SHARED_SECRET: 's3cret-value' }, true],
        ['a non-string binding',         '1',       { RELAY_SHARED_SECRET: 1 },      false],
      ];
      for (const [label, h, env, want] of cases) {
        // A helper that THROWS is broken too: in production that is a 500 on
        // every gated route, not a closed gate.
        let got; try { got = fn(h, env); } catch (e) { got = `threw ${e.constructor.name}`; }
        ok(`helper: ${label}`, got === want, `got ${got}, want ${want}`);
      }
    }
  }

  // 2. no gate compares the header to a literal; every comparison uses the helper.
  const literalGate = /headers\.get\(\s*['"]X-FIELD-Relay['"]\s*\)\s*[!=]==\s*['"`]|authHeader\s*[!=]==\s*['"`]|CI_ROUTE_GATE/g;
  const hits = index.match(literalGate) || [];
  ok('no gate compares X-FIELD-Relay to a literal or the old constant', hits.length === 0, `${hits.length} literal comparison(s) left`);
  const viaHelper = (index.match(/relaySecretMatches\(/g) || []).length - 1;   // minus the definition
  ok('the gates go through the helper', viaHelper >= 12, `${viaHelper} call(s); 12 gates were converted on 2026-10-13`);

  // 3. no literal fallback after the binding, anywhere it was.
  for (const [file, text] of Object.entries({ [INDEX]: index, [PROXY]: proxy, ...others })) {
    const fb = text.match(/RELAY_SHARED_SECRET\s*\)?\s*\|\|\s*['"`]/g) || [];
    ok(`${file}: no literal fallback after the binding`, fb.length === 0, `${fb.length} fallback(s)`);
  }

  // 4. the proxy fails closed too.
  ok('the proxy refuses an unset binding', /typeof env\.RELAY_SHARED_SECRET === 'string' && env\.RELAY_SHARED_SECRET\.length > 0/.test(proxy),
     'isRelay no longer checks that the binding is a non-empty string');
  return out;
}

function report(results) {
  let bad = 0;
  for (const r of results) {
    console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}`);
    if (!r.pass) { console.log(`      -> ${r.detail}`); bad++; }
  }
  return bad;
}

const read = f => readFileSync(f, 'utf8');
const others = Object.fromEntries(FALLBACK_SCOPE.filter(f => f !== INDEX && f !== PROXY).map(f => [f, read(f)]));

if (process.argv.includes('--self-test')) {
  // Each mutation must make checkSources fail. An anchor that does not match
  // is reported as NOTHING MUTATED, never as caught.
  const index = read(INDEX), proxy = read(PROXY);
  const MUTS = [
    ['helper drops the type check',   'index', "typeof s === 'string' && ", ''],
    ['helper drops the length check', 'index', 's.length > 0 && ', ''],
    ['a gate goes back to a literal', 'index', "if (!relaySecretMatches(authHeader, env))", "if (authHeader !== 'x-literal-x')"],
    ['the proxy falls back again',    'proxy', "&& relayAuth === env.RELAY_SHARED_SECRET;", "&& relayAuth === (env.RELAY_SHARED_SECRET || 'x-literal-x');"],
    ['the proxy opens on unset',      'proxy', "typeof env.RELAY_SHARED_SECRET === 'string' && env.RELAY_SHARED_SECRET.length > 0\n      && ", ''],
  ];
  let caught = 0, broken = 0;
  for (const [label, which, from, to] of MUTS) {
    const src = which === 'index' ? index : proxy;
    const n = src.split(from).length - 1;
    if (n < 1) { console.log(`FAIL        ${label}: anchor matched 0 times — NOTHING MUTATED`); broken++; continue; }
    const mutated = src.replace(from, to);
    const res = which === 'index' ? checkSources(mutated, proxy, others) : checkSources(index, mutated, others);
    const red = res.some(r => !r.pass);
    console.log(`${red ? 'CAUGHT    ' : 'NOT CAUGHT'}  ${label}`);
    if (red) caught++;
  }
  console.log(`\n${caught} of ${MUTS.length} mutations caught.`);
  const clean = checkSources(index, proxy, others).every(r => r.pass);
  console.log(clean ? 'clean source passes' : 'clean source FAILS — the check is red before any mutation');
  process.exit(caught === MUTS.length && !broken && clean ? 0 : 1);
}

const bad = report(checkSources(read(INDEX), read(PROXY), others));
console.log(bad ? `\n${bad} FAILED` : '\nPASS: every gate reads the binding and fails closed; no literal fallback remains.');
console.log('COVERAGE: src/index.js, src/analytics-engine.js and the proxy, statically, plus the helper run on 7 cases.');
console.log('It does NOT prove the deployed Workers hold the binding: scripts/worker-secret-names.sh does that.');
process.exit(bad ? 1 : 0);
