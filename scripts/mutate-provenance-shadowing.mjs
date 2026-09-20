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

// TWO FILES CAN BE MUTATED, because the defect lives in two of them. The name
// collision is in the generator; the handler BOUNDARY that made /gamma collect
// another function's host is in scripts/lib/route-scan.mjs. A harness that can
// only mutate one of them cannot gate the other.
function run(generatorSrc, scanSrc) {
  const dir = mkdtempSync(join(tmpdir(), 'provmut-'));
  cpSync('scripts', join(dir, 'scripts'), { recursive: true });
  writeFileSync(join(dir, 'scripts/build-route-provenance.mjs'), generatorSrc);
  if (scanSrc) writeFileSync(join(dir, 'scripts/lib/route-scan.mjs'), scanSrc);
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
// AND NOTHING ELSE. The line above uses `includes`, so on its own it passed
// while /gamma ALSO carried fitness.example.com — a route that declares no
// `base` at all and fetches only VENDOR_API. An assertion that checks a value is
// present says nothing about what else is.
//
// GATED AS OF 2026-09-20, having been REPORTED-NOT-GATED for a day. The cause was
// found and it is not what the report guessed. It was never about name scoping:
// bodyOf() ended a delegated handler at the NEXT top-level `function`
// declaration, and handleGamma is the last function in the fixture, so its body
// ran to end of file and swallowed the whole dispatch block — including
// handleBeta, which /gamma does not call. Fixed in scripts/lib/route-scan.mjs by
// balancing braces through stripNonCode, the same correction functionBody()
// already carried.
const eq = (label, got, want, why) => {
  if (got === want) console.log(`  PASS  ${label}\n          -> ${got || '(none)'}  (${why})`);
  else { bad++; console.log(`  FAIL  ${label}\n          -> ${got || '(none)'}, wanted exactly ${want}  (${why})`); }
};
eq('/gamma carries ONLY its own host', base.gamma, 'vendor.example.com',
   'EXACT, not includes: the defect this caught was an EXTRA host, which an includes-assertion cannot see');

console.log('\n=== mutations ===\n');
const SCAN = 'scripts/lib/route-scan.mjs';
const cleanScan = readFileSync(SCAN, 'utf8');

const MUTATIONS = [
  { name: 'S1 shadowing never fires', file: GEN, subject: 'alpha',
    anchor: "  const shadowed = (name) =>",
    repl:   "  const shadowed = (name) => false && ",
    why: 'THE ONE THAT MATTERS for the name collision: /alpha reclaims the fitness host — the exact live defect, four sports routes stamping a fitness API' },

  { name: 'S2 a delegated handler ends at the next `function`, not at its own brace', file: SCAN, subject: 'gamma',
    anchor: "          if (seen && depth <= 0) { end = k + 1; break; }\n        }\n        return { text: lines.slice(fnLine, end).join('\\n'), via: d[1], resolved: true };",
    repl:   "          if (seen && depth <= 0) { end = k + 1; break; }\n        }\n        end = lines.length;\n        for (let k = fnLine + 1; k < lines.length; k++) {\n          if (/^(export\\s+)?(async\\s+)?function\\s/.test(lines[k])) { end = k; break; }\n        }\n        return { text: lines.slice(fnLine, end).join('\\n'), via: d[1], resolved: true };",
    why: 'THE ONE THAT MATTERS for the boundary: the pre-2026-09-20 rule restored. handleGamma is the last function in the fixture, so its body runs to EOF and /gamma collects handleBeta\'s host — a function it does not call' },
];

let caught = 0;
for (const { name, file, subject, anchor, repl, why } of MUTATIONS) {
  const src = file === GEN ? clean : cleanScan;
  const hits = src.split(anchor).length - 1;
  if (hits !== 1) { console.log(`FAIL       ${name}\n            anchor matched ${hits} times in ${file}, expected 1 — NOTHING MUTATED.`); continue; }
  const mutated = src.replace(anchor, repl);
  if (mutated === src) { console.log(`FAIL       ${name}\n            ${file} unchanged — NOTHING MUTATED.`); continue; }
  const r = file === GEN ? run(mutated, cleanScan) : run(clean, mutated);
  // Red means the fixture's WRONG host came back on the route this mutation
  // targets. Not "something changed" — the specific defect reappearing.
  const red = r.error ? false : String(r[subject] || '').includes('fitness.example.com');
  console.log(`${red ? 'CAUGHT    ' : 'NOT CAUGHT'} ${name}\n            /${subject} -> ${r.error || r[subject] || '(none)'}\n            (${why})`);
  if (red) caught++;
}

console.log(`\n${caught} of ${MUTATIONS.length} mutations caught, ${4 - bad} of 4 gated invariants hold.`);
console.log('NO KNOWN GAP. The /gamma leak reported here on 2026-09-19 as a "second');
console.log('mechanism" was the bodyOf() handler boundary, fixed 2026-09-20 and now gated');
console.log('by S2. Two files are mutated: the generator and scripts/lib/route-scan.mjs.');
console.log('COVERAGE: the real generator over a 3-route fixture. It does NOT run against');
console.log('src/index.js — the live manifest is covered by check-route-provenance.mjs,');
console.log('which asserts every declared source appears in the source it names.');
process.exit(bad === 0 && caught === MUTATIONS.length ? 0 : 1);
