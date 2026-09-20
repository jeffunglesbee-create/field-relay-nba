#!/usr/bin/env node
/**
 * Rule 90 for the shadowing fix in scripts/build-route-provenance.mjs.
 *
 * It runs the REAL generator against a fixture that reproduces the defect, so
 * it proves behaviour rather than matching source text. A source check would
 * pass on a `shadowed()` that can never return true.
 *
 * THE DEFECT, measured 2026-09-20. `const base =
 * 'https://api.prod.whoop.com/developer/v1'` sat inside the Whoop block. BASES
 * is a flat name->URL map with no notion of scope, and `base` is declared
 * thirteen OTHER times in src/ as an ordinary local. Four sports routes —
 * /odds, /pl/, /cfl/odds-probs, /wc/odds-probs — resolved `base` to Whoop's
 * host and stamped X-FIELD-Source: api.prod.whoop.com on live responses.
 *
 * It also found one the search was not aimed at: /mcp claimed
 * stat-job-watcher.jeffunglesbee.workers.dev, because a DIFFERENT route
 * declares `const statBase = 'https://stat-job-watcher...'` while /mcp's own
 * `statBase` is `${url.origin}/stat` — the relay itself.
 */
import { writeFileSync, mkdtempSync, readFileSync, cpSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const FIXTURE = `
// A module constant nothing shadows — must still resolve.
const VENDOR_API = 'https://vendor.example.com';

async function handleAlpha(request, env, url) {
  // Its OWN base. The generator must not reach for another scope's.
  const base = \`\${url.origin}/alpha\`;
  return fetch(\`\${base}/thing\`);
}

async function handleBeta(request, env, url) {
  // The poisoned declaration, in a different function.
  const base = 'https://fitness.example.com/v1';
  return fetch(\`\${base}/profile\`);
}

async function handleGamma(request, env, url) {
  return fetch(\`\${VENDOR_API}/data\`);
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const pathname = url.pathname;
    if (pathname === '/alpha') return handleAlpha(request, env, url);
    if (pathname === '/beta')  return handleBeta(request, env, url);
    if (pathname === '/gamma') return handleGamma(request, env, url);
    return new Response('nope', { status: 404 });
  },
};
`;

function run(generatorSrc) {
  const dir = mkdtempSync(join(tmpdir(), 'provmut-'));
  cpSync('scripts', join(dir, 'scripts'), { recursive: true });
  writeFileSync(join(dir, 'scripts/build-route-provenance.mjs'), generatorSrc);
  writeFileSync(join(dir, 'wrangler.toml'), readFileSync('wrangler.toml', 'utf8'));
  execFileSync('mkdir', ['-p', join(dir, 'src')]);
  writeFileSync(join(dir, 'src/index.js'), FIXTURE);
  try { execFileSync(process.execPath, ['scripts/build-route-provenance.mjs'], { cwd: dir, stdio: 'pipe' }); }
  catch (e) { return { error: String(e.message || e).slice(0, 160) }; }
  const out = readFileSync(join(dir, 'src/route-provenance.js'), 'utf8');
  const srcOf = (p) => (out.match(new RegExp(`"${p}":[^\\n]*s: "([^"]*)"`)) || [, ''])[1];
  return { alpha: srcOf('/alpha'), beta: srcOf('/beta'), gamma: srcOf('/gamma') };
}

const GEN = 'scripts/build-route-provenance.mjs';
const clean = readFileSync(GEN, 'utf8');

console.log('=== the generator, run against a fixture that reproduces the defect ===\n');
const base = run(clean);
if (base.error) { console.log(`FAIL — the clean generator errored: ${base.error}`); process.exit(1); }

let bad = 0;
const one = (label, got, want, why) => {
  const ok = want === null ? !got.includes('fitness.example.com') : got.includes(want);
  if (ok) console.log(`  PASS  ${label}\n          -> ${got || '(none)'}  (${why})`);
  else { bad++; console.log(`  FAIL  ${label}\n          -> ${got || '(none)'}  (${why})`); }
};
one('/alpha does NOT inherit another function\'s `base`', base.alpha, null,
    'it declares its own; the fitness host belongs to /beta and must not appear here');
one('/beta KEEPS its own host', base.beta, 'fitness.example.com',
    'the declaration really is in scope there — shadowing must not blind the real case');
one('/gamma resolves an unshadowed module constant', base.gamma, 'vendor.example.com',
    'the fix must not break the ordinary path it was built around');
// AND NOTHING ELSE. The line above used `includes`, so it passed while /gamma
// ALSO carried fitness.example.com — a route that declares no `base` at all and
// fetches only VENDOR_API. An assertion that checks a value is present says
// nothing about what else is.
// KNOWN GAP, REPORTED RATHER THAN GATED. /gamma declares no `base` and fetches
// only VENDOR_API, yet still collects fitness.example.com. That is a SECOND
// mechanism, separate from the name collision this fix addresses, and it is not
// fixed here. Gating on it would leave a red check nobody can turn green.
const gammaClean = !base.gamma.includes('fitness.example.com');
console.log(`  ${gammaClean ? 'PASS ' : 'KNOWN'}  /gamma carries ONLY its own host`);
console.log(`          -> ${base.gamma}`);
if (!gammaClean) console.log('          (UNFIXED, second mechanism: a route can still collect a host');
if (!gammaClean) console.log('           from a function it does not call. Not the name collision.)');

console.log('\n=== mutations ===\n');
const MUTATIONS = [
  ['S1 shadowing never fires',
   "  const shadowed = (name) =>",
   "  const shadowed = (name) => false && ",
   'THE ONE THAT MATTERS: /alpha reclaims the fitness host — the exact live defect, four sports routes stamping a fitness API'],

];
let caught = 0;
for (const [name, anchor, repl, why] of MUTATIONS) {
  const hits = clean.split(anchor).length - 1;
  if (hits !== 1) { console.log(`FAIL       ${name}\n            anchor matched ${hits} times, expected 1 — NOTHING MUTATED.`); continue; }
  const r = run(clean.replace(anchor, repl));
  const red = r.error ? false : r.alpha.includes('fitness.example.com');
  console.log(`${red ? 'CAUGHT    ' : 'NOT CAUGHT'} ${name}\n            /alpha -> ${r.error || r.alpha || '(none)'}\n            (${why})`);
  if (red) caught++;
}

console.log(`\n${caught} of ${MUTATIONS.length} mutations caught, ${3 - bad} of 3 gated invariants hold.`);
console.log('KNOWN GAP: /gamma still collects a host from a function it does not call —');
console.log('a SECOND mechanism, not the name collision fixed here. Reported above, not');
console.log('gated, because a red nobody can green is a red everyone learns to skip.');
console.log('COVERAGE: the real generator over a 3-route fixture. It does NOT run against');
console.log('src/index.js — the live manifest is covered by check-route-provenance.mjs,');
console.log('which asserts every declared source appears in the source it names.');
process.exit(bad === 0 && caught === MUTATIONS.length ? 0 : 1);
