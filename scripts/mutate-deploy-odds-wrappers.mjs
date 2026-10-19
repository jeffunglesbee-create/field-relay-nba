#!/usr/bin/env node
// Rule 90 for the deploy path itself: does deploy.yml stop a gutted odds wrapper?
//
// docs/CC-CMD-2026-10-18-odds-gate-reads-wrapper-bodies.md, done conditions 1
// and 2. Each of the three odds wrappers (consumeOddsCredit in src/index.js and
// src/wp-resolver.js, _consumeAmbientOddsCredit in src/ambient-do.js) is given:
//   - `return true;`                                       must turn deploy.yml red
//   - `await chargeOdds(env, units, site); return true;`   must turn deploy.yml red
//   - `const charged = await chargeOdds(...); return charged;`  must stay GREEN
//
// The steps run are READ FROM deploy.yml, not copied here: every step of the
// deploy job before "Deploy to Cloudflare Workers" whose command names an odds
// or budget script. A step list in this file would test a copy of the wiring.
// Each case runs in a fresh committed copy of HEAD (git archive), so scripts
// that refuse a dirty tree see a clean one, and the anchor of each edit must
// match exactly once or the case reports NOTHING MUTATED.
//
//   node scripts/mutate-deploy-odds-wrappers.mjs
import { readFileSync, writeFileSync, mkdtempSync, rmSync, symlinkSync, existsSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

const ROOT = resolve('.');
const DEPLOY_STEP = 'Deploy to Cloudflare Workers';
const ODDS_SCRIPT = /scripts\/[\w-]*(odds|monthly|ceiling|degrade|batch-order|budget)[\w-]*\.mjs/;

async function loadYaml(file) {
  try {
    const m = await import('js-yaml');
    return (m.default ?? m).load(readFileSync(file, 'utf8'));
  } catch (_) {
    const r = spawnSync('python3', ['-c', 'import sys,yaml,json; print(json.dumps(yaml.safe_load(open(sys.argv[1])), default=str))', file], { encoding: 'utf8' });
    if (r.status !== 0) throw new Error(`cannot parse ${file}: ${r.stderr}`);
    return JSON.parse(r.stdout);
  }
}

const wf = await loadYaml('.github/workflows/deploy.yml');
const all = wf.jobs.deploy.steps;
const cut = all.findIndex((s) => s.name === DEPLOY_STEP);
if (cut < 0) { console.log(`FAIL — no "${DEPLOY_STEP}" step in deploy.yml's deploy job`); process.exit(1); }
const steps = all.slice(0, cut).filter((s) => typeof s.run === 'string' && ODDS_SCRIPT.test(s.run));
const needsSecret = steps.filter((s) => s.env && Object.values(s.env).some((v) => String(v).includes('secrets.')));
if (!steps.length || needsSecret.length) {
  console.log(`FAIL — ${steps.length} odds step(s) found, ${needsSecret.length} need a secret; this harness runs offline`);
  process.exit(1);
}

const W = {
  index:   { path: 'src/index.js',       anchor: '  return chargeOdds(env, units, site);\n}', indent: '  ' },
  wp:      { path: 'src/wp-resolver.js', anchor: '    return chargeOdds(env, units, site);\n}', indent: '    ' },
  ambient: { path: 'src/ambient-do.js',  anchor: '    return chargeOdds(env, units, site);\n}', indent: '    ' },
};
// CONTROL first: the unmutated copy must leave every step green, or a red
// verdict below could be a step that is red on clean source too.
const CASES = [{ key: null, expect: 'green', name: 'CONTROL: HEAD, unmutated' }];
for (const [key, w] of Object.entries(W)) {
  CASES.push({ key, expect: 'red',   name: `${w.path}: the wrapper returns true`, repl: `${w.indent}return true;\n}` });
  CASES.push({ key, expect: 'red',   name: `${w.path}: the charge runs, the verdict is dropped`, repl: `${w.indent}await chargeOdds(env, units, site);\n${w.indent}return true;\n}` });
  CASES.push({ key, expect: 'green', name: `${w.path}: the verdict is named, then returned (equivalent)`, repl: `${w.indent}const charged = await chargeOdds(env, units, site);\n${w.indent}return charged;\n}` });
}

const git = (cwd, ...a) => execFileSync('git', a, { cwd, stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8' });
const head = git(ROOT, 'rev-parse', '--short', 'HEAD').trim();
console.log(`deploy.yml at ${head}: ${steps.length} odds step(s) before "${DEPLOY_STEP}" (of ${cut} steps before it):`);
for (const s of steps) console.log(`  - ${s.name}`);
console.log('');

let ok = 0;
for (const c of CASES) {
  const w = c.key ? W[c.key] : null;
  const dir = mkdtempSync(join(tmpdir(), 'deploy-odds-'));
  try {
    execFileSync('bash', ['-c', `git -C "${ROOT}" archive HEAD | tar -x -C "${dir}"`]);
    if (existsSync(join(ROOT, 'node_modules'))) symlinkSync(join(ROOT, 'node_modules'), join(dir, 'node_modules'));
    if (w) {
      const text = readFileSync(join(dir, w.path), 'utf8');
      const hits = text.split(w.anchor).length - 1;
      if (hits !== 1) { console.log(`FAIL       ${c.name}\n           anchor matched ${hits} times — NOTHING MUTATED`); continue; }
      writeFileSync(join(dir, w.path), text.replace(w.anchor, c.repl));
    }
    git(dir, 'init', '-q'); git(dir, 'add', '-A');
    git(dir, '-c', 'user.email=harness@local', '-c', 'user.name=harness', 'commit', '-q', '-m', c.name);
    const red = [];
    for (const s of steps) {
      const r = spawnSync('bash', ['-e', '-c', s.run], { cwd: dir, encoding: 'utf8', timeout: 300_000 });
      // A timeout or a kill is reported as such, never counted as a catch.
      if (r.error || r.signal) { console.log(`FAIL       ${c.name}\n           step "${s.name}" did not finish (${r.error ? r.error.code : r.signal}) — no verdict`); red.length = 0; red.push(null); break; }
      if (r.status !== 0) red.push(s.name);
    }
    if (red[0] === null) continue;
    const pass = c.expect === 'red' ? red.length > 0 : red.length === 0;
    if (pass) ok++;
    const verdict = c.expect === 'red' ? (pass ? 'CAUGHT    ' : 'NOT CAUGHT') : (pass ? 'GREEN     ' : 'RED (BAD) ');
    console.log(`${verdict} ${c.name}`);
    for (const n of red) console.log(`           red step: ${n}`);
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

console.log(`\n${ok} of ${CASES.length} cases as expected: ${CASES.filter((c) => c.expect === 'red').length} mutants must turn deploy.yml red, ${CASES.filter((c) => c.expect === 'green').length} equivalents must leave it green.`);
console.log(`COVERAGE: ${steps.length} odds steps of deploy.yml's deploy job, the three odds wrappers. It does not run the deploy, the live verify job, or any step needing a secret.`);
process.exit(ok === CASES.length ? 0 : 1);
