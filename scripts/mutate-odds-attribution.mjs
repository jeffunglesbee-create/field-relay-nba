#!/usr/bin/env node
// Rule 90 for the attribution layer. The failure that matters is silent: a call
// that stops naming itself, or a name that stops being reported, leaves the
// daily total intact and only the SPLIT wrong — which is exactly the state the
// whole task exists to leave behind.

import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';

const CHECK  = 'scripts/check-odds-attribution.mjs';
const SELF   = [CHECK, '--self-test'];
const HELPER = 'src/budget-helpers.js';
const INDEX  = 'src/index.js';
const AMBIENT = 'src/ambient-do.js';
const WPRES   = 'src/wp-resolver.js';
const WATCH   = 'scripts/watch-odds-attribution-gap.mjs';
const WSELF   = [WATCH, '--self-test'];
const sh = (c, a) => execFileSync(c, a, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

for (const f of [CHECK, HELPER, INDEX, AMBIENT]) {
  if (spawnSync('git', ['diff', '--quiet', '--', f]).status !== 0) {
    console.error(`FAIL — ${f} has unstaged changes; restore would lose them.`); process.exit(1);
  }
  if (!sh('git', ['ls-files', '--', f]).trim()) {
    console.error(`FAIL — ${f} is untracked; \`git add\` it first.`); process.exit(1);
  }
}
for (const c of [SELF, [CHECK]]) {
  if (spawnSync('node', c, { stdio: 'ignore' }).status !== 0) {
    console.error(`FAIL — ${c.join(' ')} is already red on clean source.`); process.exit(1);
  }
}
console.log(`baseline: ${CHECK} passes on itself and on the repo\n`);

const MUTATIONS = [
  { file: INDEX, check: [CHECK], name: 'A1  the public /odds proxy stops naming itself',
    anchor: "oddsCreditCost(targetUrl), 'oddsProxyRoute')",
    replace: 'oddsCreditCost(targetUrl))',
    catches: 'the ninth call site — the one I missed by grep and the check found' },

  { file: AMBIENT, check: [CHECK], name: 'A2  the closing capture stops naming itself',
    anchor: "oddsCreditCost(url), 'ambientCaptureClosingOdds')",
    replace: 'oddsCreditCost(url))',
    catches: 'a live consumer drops into the unattributed bucket' },

  { file: INDEX, check: [CHECK], name: 'A3  a site is passed that nothing declares',
    anchor: "oddsCreditCost(_liveUrl), 'fetchSportOddsLive')",
    replace: "oddsCreditCost(_liveUrl), 'somethingElse')",
    catches: 'by_site grows a key /budget/odds never reports and the sum stops matching' },

  { file: HELPER, check: [CHECK], name: 'A4  a declared site is removed from ODDS_SITES',
    anchor: "    'fetchSportOddsLive', 'fetchSportOddsHistorical', 'wpResolver',",
    replace: "    'fetchSportOddsHistorical', 'wpResolver',",
    catches: 'a real consumer spends into a bucket the readout omits' },

  { file: CHECK, check: SELF, name: 'A5  the await requirement is dropped',
    anchor: "      if (!/await\\s+$/.test(before)) continue;",
    replace: '      if (false) continue;',
    catches: 'prose mentions count as call sites again — three false defects last time' },

  { file: CHECK, check: SELF, name: 'A6  a variable site passes as a name',
    anchor: "const isSiteLiteral = (a) => /^'[a-zA-Z][a-zA-Z0-9_]*'$/.test(a || '');",
    replace: 'const isSiteLiteral = (a) => !!(a || \'\');',
    catches: 'a variable writes an unpredictable KV key — absence in a different costume' },

  // ── the 2026-09-16 defect: two vocabularies for nine consumers ────────────
  { file: AMBIENT, check: [CHECK], name: 'A7  the live-odds reconcile goes back to its own name',
    anchor: "oddsCreditCost(buildUrl('')), r, 'ambientFetchLiveOdds')",
    replace: "oddsCreditCost(buildUrl('')), r, '_fetchLiveOdds')",
    catches: 'the literal that shipped — the guard charged one key and the correction named another' },

  { file: WPRES, check: [CHECK], name: 'A8  the wp-resolver reconcile goes back to its own name',
    anchor: "oddsCreditCost(_url), r, 'wpResolver')",
    replace: "oddsCreditCost(_url), r, 'wp-resolver:fetchSportOddsLive')",
    catches: 'a colon in a site name — _siteKey strips it, so the written key matched no declared site' },

  { file: INDEX, check: [CHECK], name: 'A9  the proxy reconcile and the proxy guard disagree',
    anchor: "oddsCreditCost(targetUrl), _proxyResp, 'oddsProxyRoute')",
    replace: "oddsCreditCost(targetUrl), _proxyResp, 'odds-proxy')",
    catches: 'the fourth divergence, and the one that looked most like a deliberate name' },

  { file: INDEX, check: [CHECK], name: 'A10 a reconcile names a DIFFERENT declared site',
    anchor: "reconcileOddsCredit(env, oddsCreditCost(url), r, 'fetchSportOddsHistorical')",
    replace: "reconcileOddsCredit(env, oddsCreditCost(url), r, 'fetchSportOddsLive')",
    catches: 'both names are valid and declared — only the guard/reconcile SET equality catches this' },

  { file: HELPER, check: [CHECK], name: 'A11 reconcile stops correcting the site counter',
    anchor: '        await _bumpSite(env, site, out.delta);',
    replace: '        // await _bumpSite(env, site, out.delta);',
    catches: 'site counters go back to holding the estimate while used holds the billed cost' },

  // ── the daily watch on the LIVE gap, which the static check cannot see ───
  { file: WATCH, check: WSELF, name: 'A13 the gap check stops caring about sign',
    anchor: '  return Math.abs(gap) <= allowed',
    replace: '  return gap <= allowed',
    catches: 'a NEGATIVE gap passes — the exact 2026-09-16 shape, the sum outgrowing its total' },

  { file: WATCH, check: WSELF, name: 'A14 a null by_site_sum is coerced to a number',
    anchor: "  if (typeof sum !== 'number' || !Number.isFinite(sum)) {",
    replace: '  if (false) {',
    catches: 'Number(null) is 0, so an unknown split prints a fully-measured gap' },

  { file: WATCH, check: WSELF, name: 'A15 a silent day reads as health',
    anchor: '  if (used === 0) {',
    replace: '  if (false) {',
    catches: 'used 0 and sum 0 gives gap 0 and a green run on a day nothing spent (Rule 99)' },

  { file: WATCH, check: WSELF, name: 'A16 an unreadable site is summed around',
    anchor: '  if (Array.isArray(daily.unreadable_sites) && daily.unreadable_sites.length) {',
    replace: '  if (false) {',
    catches: 'a corrupt counter disappears into a gap that looks like ordinary drift' },

  { file: WATCH, check: WSELF, name: 'A18 the watcher reads today instead of a closed day',
    anchor: "export const defaultDate = (now = Date.now()) =>\n  new Date(now - 86400000).toISOString().slice(0, 10);",
    replace: "export const defaultDate = (now = Date.now()) =>\n  new Date(now).toISOString().slice(0, 10);",
    catches: 'a partial day judged as a complete one — and at a 104-405 min delay, the WRONG partial day' },

  { file: WATCH, check: WSELF, name: 'A19 a silently ignored date parameter passes',
    anchor: "  return { ok: daily.date === want, got: daily.date };",
    replace: '  return { ok: true, got: daily.date };',
    catches: 'an older deployed worker returns today and every field below is read as the requested day' },

  { file: WATCH, check: WSELF, name: 'A17 the floor swallows every morning gap',
    anchor: 'export const FLOOR = 25;',
    replace: 'export const FLOOR = 100000;',
    catches: 'the tolerance grows until nothing can fail it — the way this watch ends quietly' },

  { file: HELPER, check: [CHECK], name: 'A12 the site counter stops being clamped at zero',
    anchor: 'String(Math.max(0, cur + units))',
    replace: 'String(cur + units)',
    catches: 'a lost race drives a site counter negative and hands back spend that happened' },

];

let caught = 0;
for (const mut of MUTATIONS) {
  const original = fs.readFileSync(mut.file, 'utf8');
  const hits = original.split(mut.anchor).length - 1;
  if (hits !== 1) {
    console.log(`FAIL       ${mut.name}\n            anchor matched ${hits} times, expected 1 — NOTHING MUTATED.`);
    continue;
  }
  fs.writeFileSync(mut.file, original.replace(mut.anchor, mut.replace));
  if (fs.readFileSync(mut.file, 'utf8') === original) {
    console.log(`FAIL       ${mut.name}\n            file unchanged — NOTHING MUTATED.`);
    sh('git', ['checkout', '--', mut.file]); continue;
  }
  const red = spawnSync('node', mut.check, { encoding: 'utf8' }).status !== 0;
  sh('git', ['checkout', '--', mut.file]);
  console.log(`${red ? 'CAUGHT    ' : 'NOT CAUGHT'} ${mut.name}\n            (${mut.catches})`);
  if (red) caught++;
}

console.log(`\n${caught} of ${MUTATIONS.length} mutations caught.`);
console.log(`COVERAGE: the naming requirement, the declared-site list, guard/reconcile set`);
console.log(`equality, and that reconcile writes the site counter clamped. It does NOT`);
console.log(`verify the KV write SUCCEEDS at runtime, nor that a name describes the right`);
console.log(`consumer. watch-odds-attribution-gap.mjs reads the live gap daily for that.`);
process.exit(caught === MUTATIONS.length ? 0 : 1);
