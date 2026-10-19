#!/usr/bin/env node
// Rule 90 for the deploy path itself: does deploy.yml stop a gutted odds wrapper?
//
// docs/CC-CMD-2026-10-18-odds-gate-reads-wrapper-bodies.md, done conditions 1
// and 2. Each of the three odds wrappers (consumeOddsCredit in src/index.js and
// src/wp-resolver.js, _consumeAmbientOddsCredit in src/ambient-do.js) is
// replaced WHOLE, found by name, its signature kept, by a body that:
//   - returns true                                   -> must turn deploy.yml red
//   - charges, then drops the verdict                -> must turn deploy.yml red
//   - returns early whenever KV is bound (one `!`)   -> must turn deploy.yml red
//   - names the verdict, then returns it             -> must stay GREEN
// and, since the final review pass of 2026-10-19, the guard SITES are edited in
// place (SITES below): a refusal that only logs, or a dropped verdict, must
// turn deploy.yml red; three correct rewrites of the ambient live poll's guard
// and charge must not. Site anchors are exact text, each asserted to match
// once, so a stale anchor FAILS as NOTHING MUTATED rather than passing.
// A site case may carry several `edits`, applied in order, each asserted
// unique in the text as it stands. That is how a guard is MOVED below its
// fetch (docs/CC-CMD-2026-10-19-odds-guard-before-fetch.md).
//
// `--only=<text>` runs only the cases whose name contains <text>, after the
// control. Such a run prints its own count and is never the full verdict.
// A CONTROL, HEAD unmutated, must be all green first, or no verdict is printed.
//
// The steps run are READ FROM deploy.yml AT HEAD, out of the same archive the
// cases run in: every step of the deploy job before "Deploy to Cloudflare
// Workers" whose command names an odds or budget script. Reading the working
// tree's deploy.yml while running HEAD's source would test wiring the commit
// does not contain (2026-10-19 review). Each case runs in a fresh committed
// `git archive` copy, so scripts that refuse a dirty tree see a clean one.
//
//   node scripts/mutate-deploy-odds-wrappers.mjs
import { readFileSync, writeFileSync, mkdtempSync, rmSync, symlinkSync, existsSync } from 'node:fs';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

const ROOT = resolve('.');
const DEPLOY_STEP = 'Deploy to Cloudflare Workers';
const ODDS_SCRIPT = /scripts\/[\w-]*(odds|monthly|ceiling|degrade|batch-order|budget|reconcile|lambdas|created-tables)[\w-]*\.mjs/;
const CONCURRENCY = 3;

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

const git = (cwd, ...a) => execFileSync('git', a, { cwd, stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8' });
const head = git(ROOT, 'rev-parse', '--short', 'HEAD').trim();
const dirty = git(ROOT, 'status', '--porcelain', '--', 'src', 'scripts', '.github').trim();
if (dirty) console.log(`NOTE: uncommitted changes under src/, scripts/ or .github/ are NOT tested; this runs HEAD ${head}.\n`);

function freshCopy() {
  const dir = mkdtempSync(join(tmpdir(), 'deploy-odds-'));
  execFileSync('bash', ['-c', `git -C "${ROOT}" archive HEAD | tar -x -C "${dir}"`]);
  return dir;
}

// The step list, from HEAD's deploy.yml.
const listDir = freshCopy();
const wf = await loadYaml(join(listDir, '.github/workflows/deploy.yml'));
const guardSites = ['src/index.js', 'src/ambient-do.js', 'src/wp-resolver.js']
  .reduce((n, f) => n + (readFileSync(join(listDir, f), 'utf8').match(/!\s*\(\s*await\s+(?:consumeOddsCredit|_consumeAmbientOddsCredit)\(/g) || []).length, 0);
rmSync(listDir, { recursive: true, force: true });
const all = wf.jobs.deploy.steps;
const cut = all.findIndex((s) => s.name === DEPLOY_STEP);
if (cut < 0) { console.log(`FAIL — no "${DEPLOY_STEP}" step in deploy.yml's deploy job`); process.exit(1); }
const before = all.slice(0, cut);
const runnable = before.filter((s) => typeof s.run === 'string' && !(s.env && Object.values(s.env).some((v) => String(v).includes('secrets.'))));
const steps = runnable.filter((s) => ODDS_SCRIPT.test(s.run));
if (!steps.length) { console.log('FAIL — no odds step found before the deploy step'); process.exit(1); }

const W = {
  index:   { path: 'src/index.js',       name: 'consumeOddsCredit' },
  wp:      { path: 'src/wp-resolver.js', name: 'consumeOddsCredit' },
  ambient: { path: 'src/ambient-do.js',  name: '_consumeAmbientOddsCredit' },
};
const KV = 'if (!env || !env.FIELD_JOURNALISM) return true;';
const BODIES = [
  { expect: 'red',   label: 'the wrapper returns true',                        body: [KV, 'return true;'] },
  { expect: 'red',   label: 'the charge runs, the verdict is dropped',         body: [KV, 'await chargeOdds(env, units, site);', 'return true;'] },
  { expect: 'red',   label: 'returns early whenever KV is bound (one `!` gone)', body: ['if (!env || env.FIELD_JOURNALISM) return true;', 'return chargeOdds(env, units, site);'] },
  { expect: 'green', label: 'the verdict is named, then returned (equivalent)', body: [KV, 'const charged = await chargeOdds(env, units, site);', 'return charged;'] },
];
const AMB_CHARGE = "            if (!(await _consumeAmbientOddsCredit(this.env, oddsCreditCost(buildUrl('')), 'ambientFetchLiveOdds'))) return;";
const PROXY_IF = "if (oddsBillablePath(cleanPath) && !(await consumeOddsCredit(env, oddsCreditCost(targetUrl), 'oddsProxyRoute'))) {";
const PROXY_RET = "                return new Response(JSON.stringify({ ok: false, guarded: true,\n                    error: 'odds credit guard declined this call' }),\n                    { status: 429, headers: { 'X-RELAY-Error': 'odds-credit-guard', ...CORS, 'Content-Type': 'application/json' } });";
const SITES = [
  { expect: 'green', file: 'src/ambient-do.js', label: 'live poll: the cost hoisted into a const (equivalent)', from: AMB_CHARGE,
    to: "            const liveCost = oddsCreditCost(buildUrl(''));\n            if (!(await _consumeAmbientOddsCredit(this.env, liveCost, 'ambientFetchLiveOdds'))) return;" },
  { expect: 'green', file: 'src/ambient-do.js', label: 'live poll: the charge wrapped across lines (equivalent)', from: AMB_CHARGE,
    to: "            if (!(await _consumeAmbientOddsCredit(\n                this.env, oddsCreditCost(buildUrl('')), 'ambientFetchLiveOdds'))) return;" },
  { expect: 'green', file: 'src/ambient-do.js', label: 'live poll: the 404 guard written with braces (equivalent)',
    from: '        if (ODDS_LIVE_PATH_404) return;', to: '        if (ODDS_LIVE_PATH_404) { return; }' },
  { expect: 'red', file: 'src/index.js', label: '/odds/* proxy: charged, the verdict dropped', from: PROXY_IF,
    to: "if (oddsBillablePath(cleanPath)) await consumeOddsCredit(env, oddsCreditCost(targetUrl), 'oddsProxyRoute');\n            if (false) {" },
  { expect: 'red', file: 'src/index.js', label: '/odds/* proxy: the refusal only logs', from: PROXY_RET,
    to: "                console.warn('[odds proxy] over budget');" },
  { expect: 'red', file: 'src/wp-resolver.js', label: 'wp-resolver: the refusal only logs',
    from: '        return { games: [], quotaRemaining: null, ok: false, guarded: true };', to: "        console.warn('[wp-resolver] over budget');" },
  { expect: 'red', file: 'src/ambient-do.js', label: 'closing capture: the refusal logs and no longer returns',
    from: "            console.warn('[closing-odds] odds credit guard declined — skipping capture');\n            return;",
    to: "            console.warn('[closing-odds] odds credit guard declined — skipping capture');" },
  // The guard moved BELOW its fetch, or the fetch started above it: the refusal
  // arrives after the vendor has billed. Six shapes from the 2026-10-19 second
  // review, most plausible first. All six must turn deploy.yml red.
  { expect: 'red', file: 'src/index.js', label: 'fetchSportOddsLive: the guard moved below the fetch (S1)', edits: [
    [`  if (!(await consumeOddsCredit(env, oddsCreditCost(_liveUrl), 'fetchSportOddsLive'))) {\n    return { games: [], quotaRemaining: null, ok: false, guarded: true };\n  }\n`, ''],
    [`  await reconcileOddsCredit(env, _est, r, 'fetchSportOddsLive');`,
     `  if (!(await consumeOddsCredit(env, oddsCreditCost(_liveUrl), 'fetchSportOddsLive'))) {\n    return { games: [], quotaRemaining: null, ok: false, guarded: true };\n  }\n  await reconcileOddsCredit(env, _est, r, 'fetchSportOddsLive');`],
  ] },
  { expect: 'red', file: 'src/index.js', label: '/odds/* proxy: a special case returns relayFetch above the guard (P1)', edits: [
    [PROXY_IF, `if (cleanPath.startsWith('/v4/events/')) return relayFetch(targetUrl, { 'Accept': 'application/json' }, 60, 'odds', ctx);\n            ${PROXY_IF}`],
  ] },
  { expect: 'red', file: 'src/index.js', label: '/odds/* proxy: relayFetch moved above the guard (P2)', edits: [
    [`            const _proxyResp = await relayFetch(targetUrl, { 'Accept': 'application/json' }, oddsCacheTtl(cleanPath), 'odds', ctx);\n`, ''],
    [`            ${PROXY_IF}`, `            const _proxyResp = await relayFetch(targetUrl, { 'Accept': 'application/json' }, oddsCacheTtl(cleanPath), 'odds', ctx);\n            ${PROXY_IF}`],
  ] },
  { expect: 'red', file: 'src/ambient-do.js', label: 'closing capture: the guard moved below the fetch (S4)', edits: [
    [`        if (!(await _consumeAmbientOddsCredit(this.env, oddsCreditCost(url), 'ambientCaptureClosingOdds'))) {\n            console.warn('[closing-odds] odds credit guard declined — skipping capture');\n            return;\n        }\n`, ''],
    [`            await reconcileOddsCredit(this.env, oddsCreditCost(url), r, 'ambientCaptureClosingOdds');`,
     `            if (!(await _consumeAmbientOddsCredit(this.env, oddsCreditCost(url), 'ambientCaptureClosingOdds'))) {\n                console.warn('[closing-odds] odds credit guard declined — skipping capture');\n                return;\n            }\n            await reconcileOddsCredit(this.env, oddsCreditCost(url), r, 'ambientCaptureClosingOdds');`],
  ] },
  { expect: 'red', file: 'src/wp-resolver.js', label: 'wp-resolver: the fetch started above the guard, awaited below it (S2)', edits: [
    [`    const r = await fetch(\n        _url,\n        { cf: { cacheTtl: 900, cacheEverything: true } }\n    );`, `    const r = await _p;`],
    [`    if (!(await consumeOddsCredit(env, oddsCreditCost(_url), 'wpResolver'))) {`,
     `    const _p = fetch(\n        _url,\n        { cf: { cacheTtl: 900, cacheEverything: true } }\n    );\n    if (!(await consumeOddsCredit(env, oddsCreditCost(_url), 'wpResolver'))) {`],
  ] },
  { expect: 'red', file: 'src/index.js', label: 'getWCPregameLambdas: the verdict named before the fetch, tested after it (S5)', edits: [
    [`    if (!(await consumeOddsCredit(env, oddsCreditCost(_wcUrl), 'getWCPregameLambdas'))) return null;`,
     `    const _wcOk = await consumeOddsCredit(env, oddsCreditCost(_wcUrl), 'getWCPregameLambdas');`],
    [`        await reconcileOddsCredit(env, oddsCreditCost(_wcUrl), r, 'getWCPregameLambdas');`,
     `        if (!_wcOk) return null;\n        await reconcileOddsCredit(env, oddsCreditCost(_wcUrl), r, 'getWCPregameLambdas');`],
  ] },
];
const CASES = [];
for (const [key, w] of Object.entries(W)) for (const b of BODIES) CASES.push({ key, expect: b.expect, name: `${w.path}: ${b.label}`, body: b.body });
for (const t of SITES) CASES.push({ site: t, expect: t.expect, name: `${t.file}: ${t.label}` });
const ONLY = (process.argv.find((a) => a.startsWith('--only=')) || '').slice('--only='.length);
const RUN = ONLY ? CASES.filter((c) => c.name.includes(ONLY)) : CASES;
if (ONLY && !RUN.length) { console.log(`FAIL — --only=${ONLY} matched no case`); process.exit(1); }

function replaceWrapper(text, w, body) {
  const i = text.indexOf(`async function ${w.name}(`);
  const j = i < 0 ? -1 : text.indexOf('\n}\n', i);
  if (i < 0 || j < 0) return null;
  const sig = text.slice(i, text.indexOf('\n', i));
  return `${text.slice(0, i)}${sig}\n${body.map((l) => `    ${l}`).join('\n')}\n}${text.slice(j + 2)}`;
}

const runStep = (dir, s) => new Promise((res) => {
  const p = spawn('bash', ['-e', '-c', s.run], { cwd: dir, stdio: 'ignore' });
  const t = setTimeout(() => p.kill('SIGKILL'), 300_000);
  p.on('close', (code, signal) => { clearTimeout(t); res({ code, signal }); });
});

async function runCase(c) {
  const dir = freshCopy();
  try {
    if (existsSync(join(ROOT, 'node_modules'))) symlinkSync(join(ROOT, 'node_modules'), join(dir, 'node_modules'));
    if (c.key) {
      const w = W[c.key];
      const next = replaceWrapper(readFileSync(join(dir, w.path), 'utf8'), w, c.body);
      if (next == null) return { c, error: `${w.name} was not found in ${w.path} — NOTHING MUTATED` };
      writeFileSync(join(dir, w.path), next);
    }
    if (c.site) {
      let t = readFileSync(join(dir, c.site.file), 'utf8');
      for (const [from, to] of c.site.edits || [[c.site.from, c.site.to]]) {
        const n = t.split(from).length - 1;
        if (n !== 1) return { c, error: `anchor matched ${n} times in ${c.site.file}, expected 1 — NOTHING MUTATED: ${from.trim().slice(0, 70)}` };
        t = t.replace(from, to);
      }
      writeFileSync(join(dir, c.site.file), t);
      const chk = spawnSync('node', ['--check', c.site.file], { cwd: dir, encoding: 'utf8' });
      if (chk.status !== 0) return { c, error: `the mutant does not parse: ${chk.stderr.split('\n').find(Boolean)}` };
    }
    git(dir, 'init', '-q'); git(dir, 'add', '-A');
    git(dir, '-c', 'user.email=harness@local', '-c', 'user.name=harness', 'commit', '-q', '-m', c.name);
    const red = [];
    for (const s of steps) {
      const r = await runStep(dir, s);
      // A kill is no verdict: by signal, or as bash -e's 128+n when the killed
      // command was not the last line of a multi-line run (2026-10-19 review).
      if (r.signal || (r.code ?? 0) >= 128) return { c, error: `step "${s.name}" was killed (${r.signal || `status ${r.code}`}) — no verdict` };
      if (r.code !== 0) red.push(s.name);
    }
    return { c, red };
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

console.log(`deploy.yml at ${head}: running ${steps.length} odds steps of the ${runnable.length} runnable steps (no secret) before "${DEPLOY_STEP}":`);
for (const s of steps) console.log(`  - ${s.name}`);
console.log('');

const control = await runCase({ key: null, expect: 'green', name: 'CONTROL: HEAD, unmutated' });
if (control.error || control.red.length) {
  console.log(`FAIL       CONTROL: HEAD, unmutated — ${control.error || `red on clean source: ${control.red.join('; ')}`}`);
  console.log('No mutant verdict is printed: a step red on clean source would read as a catch.');
  process.exit(1);
}
console.log('GREEN      CONTROL: HEAD, unmutated');

const results = new Array(RUN.length);
let next = 0;
await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
  while (next < RUN.length) { const k = next++; results[k] = await runCase(RUN[k]); }
}));

let ok = 0;
for (const r of results) {
  const c = r.c;
  if (r.error) { console.log(`FAIL       ${c.name}\n           ${r.error}`); continue; }
  const pass = c.expect === 'red' ? r.red.length > 0 : r.red.length === 0;
  if (pass) ok++;
  console.log(`${c.expect === 'red' ? (pass ? 'CAUGHT    ' : 'NOT CAUGHT') : (pass ? 'GREEN     ' : 'RED (BAD) ')} ${c.name}`);
  for (const n of r.red) console.log(`           red step: ${n}`);
}
const reds = RUN.filter((c) => c.expect === 'red').length;
if (ONLY) console.log(`\nPARTIAL RUN (--only=${ONLY}): ${RUN.length} of ${CASES.length} cases. Not a verdict on the harness.`);
console.log(`\n${ok} of ${RUN.length} cases as expected (control green first): ${reds} mutants must turn a step red, ${RUN.length - reds} equivalents must leave all ${steps.length} odds steps green.`);
// Counted, not typed (2026-10-19 review): the guard sites in HEAD's source, and
// which of them a must-red site case actually bites.
const siteOf = (t) => t.label.split(':')[0];
const redSites = new Set(SITES.filter((t) => t.expect === 'red').map(siteOf));
const greenOnly = new Set(SITES.filter((t) => t.expect === 'green').map(siteOf).filter((x) => !redSites.has(x)));
console.log(`COVERAGE: ${steps.length} of ${runnable.length} runnable pre-deploy steps (the odds ones), ${Object.keys(W).length} of 3 wrappers mutated, ${BODIES.length} bodies each, plus ${SITES.length} site cases: a must-red edit at ${redSites.size} of the ${guardSites} guard sites in HEAD (${[...redSites].join(', ')}), must-stay-green edits only at ${[...greenOnly].join(', ') || 'none'}. Every guard site, these included, is also made log-only and moved below its fetch by check-odds-calls-guarded's own self-test, which is one of the steps run. Not run: the other ${runnable.length - steps.length} runnable steps, ${before.length - runnable.length} steps needing a secret or with no command, the deploy, and the live verify job.`);
process.exit(ok === RUN.length ? 0 : 1);
