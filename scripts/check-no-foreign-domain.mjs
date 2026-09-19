#!/usr/bin/env node
/**
 * FIELD is a sports intelligence relay. Code for something else does not belong
 * in it, and the cost of the last instance was not the dead code.
 *
 * WHAT WHOOP ACTUALLY COST, measured 2026-09-19 before removal:
 *
 *   - `WHOOP_CLIENT_SECRET`, a live OAuth client secret, sat in `[vars]` in
 *     wrangler.toml — tracked, in a PUBLIC repo, deployed as a plaintext
 *     environment variable rather than a Cloudflare secret, since the commit
 *     that added the feature.
 *   - It was the ONLY consumer of the `DB` binding. So `DB` looked like a live
 *     database with real usage, and CC-CMD-2026-09-18 told a session to put the
 *     odds budget in it on that basis.
 *   - 3 routes, 22 lines, ZERO references in jubilant-bassoon, named in no
 *     contract or CLAUDE.md.
 *
 * Nothing was watching for any of it, because every guard here asks whether the
 * code is CORRECT. None asked whether it BELONGS.
 *
 * WHAT THIS CHECKS, and what it deliberately does not: a declared list of
 * foreign vendor hostnames, matched against worker source. It is not a
 * classifier and cannot tell a sports API from a fitness one — a human adds a
 * name when a domain is ruled out of scope. A guessing version would fire on
 * every third-party sports vendor the relay legitimately calls.
 *
 * READ-ONLY.
 */
import { readFileSync, readdirSync } from 'node:fs';

// Ruled out of scope by the owner, with the date and the reason.
export const FOREIGN = [
  { host: 'whoop.com', ruled: '2026-09-19', why: 'fitness tracker; not part of FIELD. Removed with 3 routes, 22 lines and a plaintext OAuth secret in [vars].' },
];

export function hitsIn(src, foreign = FOREIGN) {
  return foreign.filter(f => src.toLowerCase().includes(f.host.toLowerCase()));
}

export function verdict(scanned, hits) {
  // An empty scan is a FAILURE: a matcher that reads no files finds nothing,
  // which is indistinguishable from a clean tree.
  if (scanned === 0) return 'nothing-scanned';
  if (!FOREIGN.length) return 'no-declarations';
  return hits.length ? 'foreign-domain-present' : 'ok';
}

if (process.argv.includes('--self-test')) {
  let bad = 0;
  const one = (l, got, want, why) => {
    if (JSON.stringify(got) === JSON.stringify(want)) console.log(`  PASS  ${l} -> ${JSON.stringify(got)}  (${why})`);
    else { bad++; console.log(`  FAIL  ${l}: got ${JSON.stringify(got)} want ${JSON.stringify(want)}  (${why})`); }
  };
  const F = [{ host: 'example-fit.com', ruled: '2026-01-01', why: 'test' }];
  one('a declared host is found', hitsIn("fetch('https://api.example-fit.com/v1')", F).length, 1, 'the shape the real one had');
  one('CASE DOES NOT HIDE IT', hitsIn('API.EXAMPLE-FIT.COM', F).length, 1, 'a rename to uppercase must not evade the check');
  one('an undeclared vendor is not flagged', hitsIn("fetch('https://site.api.espn.com/x')", F).length, 0,
      'this is a declared list, NOT a classifier — it cannot tell a sports vendor from a fitness one and must not try');
  one('nothing scanned is a failure', verdict(0, []), 'nothing-scanned',
      'a matcher reading no files finds nothing, which looks exactly like a clean tree');
  one('a hit fails', verdict(3, [F[0]]), 'foreign-domain-present', 'the declared host came back');
  one('clean passes', verdict(3, []), 'ok', 'files were read and none matched');
  one('WHOOP IS DECLARED', FOREIGN.some(f => f.host === 'whoop.com'), true,
      'the list must carry the instance it was written for, or it is a mechanism with no content');
  one('every declaration carries a date and a reason',
      FOREIGN.every(f => /^\d{4}-\d{2}-\d{2}$/.test(f.ruled) && f.why && f.why.length > 20), true,
      'a host on a banned list with no reason gets deleted by the next person who needs it');
  console.log(bad ? `\n${bad} FAILED` : '\nself-test: 8/8');
  console.log(`COVERAGE: the matcher and the verdict over ${FOREIGN.length} declared host(s).`);
  console.log('It CANNOT find a foreign vendor nobody has declared — that judgement is');
  console.log('a human\'s, and a guessing version would fire on every sports API here.');
  process.exit(bad ? 1 : 0);
}

const files = readdirSync('src').filter(f => f.endsWith('.js')).map(f => `src/${f}`);
const found = [];
for (const f of files) {
  for (const h of hitsIn(readFileSync(f, 'utf8'))) found.push({ file: f, ...h });
}
// wrangler.toml too: the secret lived there, not in the code.
let cfg = [];
try { cfg = hitsIn(readFileSync('wrangler.toml', 'utf8')).map(h => ({ file: 'wrangler.toml', ...h })); } catch (_) {}
const hits = [...found, ...cfg];
const v = verdict(files.length, hits);

console.log('=== no out-of-scope vendor in the relay ===\n');
console.log(`  files scanned     : ${files.length} in src/, plus wrangler.toml`);
console.log(`  declared foreign  : ${FOREIGN.map(f => f.host).join(', ')}`);
console.log(`  present           : ${hits.length}`);
for (const h of hits) console.log(`      ${h.file}: ${h.host}  — ruled out ${h.ruled}`);
console.log(`\n  verdict: ${v}`);
console.log(`\nCOVERAGE: ${files.length} file(s) in src/ plus wrangler.toml, against ${FOREIGN.length}`);
console.log('DECLARED host(s). It is a list, not a classifier: it cannot find a foreign');
console.log('vendor nobody has declared, and does not try — that judgement is a human\'s.');

if (v !== 'ok') {
  console.log(`\nFAIL: ${v}`);
  for (const h of hits) console.log(`      ${h.file} references ${h.host}. ${h.why}`);
  process.exit(1);
}
console.log('\nOK: no declared out-of-scope vendor appears in the relay.');
