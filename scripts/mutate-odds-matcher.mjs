#!/usr/bin/env node
// Rule 90 for src/odds-name-match.js. Each mutation is a plausible way the
// matcher could be wrong; every one must turn check-odds-matcher.mjs red.
//
// Anchor discipline as in mutate-backfill-registry.mjs: exactly-one-match
// asserted, the replacement confirmed on disk, `git checkout --` to restore.
// A NOT CAUGHT with nothing mutated is worse than no test.

import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';

const MODULE  = 'src/odds-name-match.js';
const CHECK   = 'scripts/check-odds-matcher.mjs';
const WIRING  = 'scripts/check-odds-matcher-wiring.mjs';
const CRON    = '.github/scripts/odds-backfill.js';
const FILL    = 'scripts/targeted-odds-fill.mjs';
const WATCHER = 'scripts/watch-odds-pairing-rate.mjs';
const WATCH_CHECK = [WATCHER, '--self-test'];
const sh = (c, a) => execFileSync(c, a, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

// `git checkout --` restores from the INDEX, so the index is what must hold a
// good copy — a staged-but-uncommitted file is fine, an unstaged edit is not.
for (const f of [MODULE, CRON, FILL, WATCHER]) {
  if (spawnSync('git', ['diff', '--quiet', '--', f]).status !== 0) {
    console.error(`FAIL — ${f} has unstaged changes; restore would lose them. Stage or revert first.`);
    process.exit(1);
  }
  if (!sh('git', ['ls-files', '--', f]).trim()) {
    console.error(`FAIL — ${f} is untracked; there is nothing to restore it from. \`git add\` it first.`);
    process.exit(1);
  }
}

// Both checks must be green on clean source, or every "CAUGHT" below is noise.
for (const c of [[CHECK], [WIRING], WATCH_CHECK]) {
  if (spawnSync('node', c, { stdio: 'ignore' }).status !== 0) {
    console.error(`FAIL — ${c.join(' ')} is already red on clean source. Fix that first.`);
    process.exit(1);
  }
}
console.log(`baseline: ${CHECK} and ${WIRING} both pass on clean source\n`);

const MUTATIONS = [
  { file: MODULE, check: CHECK, name: 'M1  per-token prefix becomes whole-string prefix (the pre-2026-09-16 shape)',
    anchor: '  return a.every((t, i) => v[i].startsWith(t));',
    replace: '  return v.join("").startsWith(a.join(""));',
    catches: 'N Colorado / C Connecticut / Illinois St stop matching' },

  { file: MODULE, check: CHECK, name: 'M2  the prefix direction is flipped',
    anchor: '  return a.every((t, i) => v[i].startsWith(t));',
    replace: '  return a.every((t, i) => t.startsWith(v[i]));',
    catches: 'the mascot token would have to prefix the archive token' },

  { file: MODULE, check: CHECK, name: 'M3  every archive token becomes some archive token',
    anchor: '  return a.every((t, i) => v[i].startsWith(t));',
    replace: '  return a.some((t, i) => v[i].startsWith(t));',
    catches: 'one matching token is enough — mass ambiguity' },

  { file: MODULE, check: CHECK, name: 'M4  apostrophes are split on instead of removed',
    anchor: "    .replace(/[\\u2019'.]/g, '')\n",
    replace: '',
    catches: "Hawai'i tokenises to [hawai, i] and never reaches Hawaii Rainbow Warriors" },

  { file: MODULE, check: CHECK, name: 'M5  the ambiguity guard picks the first candidate',
    anchor: "  if (straight.length > 1)   return { event: null, swapped: false, ambiguous: true, candidates: straight };",
    replace: "  if (straight.length > 1)   return { event: straight[0], swapped: false, ambiguous: false, candidates: straight };",
    catches: 'Ohio resolves to Ohio Bobcats by payload order, silently' },

  { file: MODULE, check: CHECK, name: 'M6  the orientation-swap branch is dropped',
    anchor: "  const swapped = list.filter(e =>\n    nameMatches(game.away, e.home_team) && nameMatches(game.home, e.away_team));",
    replace: '  const swapped = [];',
    catches: 'a reversed vendor pairing returns no event' },

  { file: MODULE, check: CHECK, name: 'M7  the token-count refusal is dropped',
    anchor: '  if (!a.length || a.length > v.length) return false;',
    replace: '  if (!a.length) return false;',
    catches: 'a longer archive name reads past the end of the vendor tokens' },

  { file: MODULE, check: CHECK, name: 'M8  normalisation stops lowercasing',
    anchor: "    .toLowerCase()\n    .replace(/[\\u2019'.]/g, '')",
    replace: "    .replace(/[\\u2019'.]/g, '')",
    catches: 'the [^a-z0-9 ] class then eats every capital letter' },

  // ── the price reader ──────────────────────────────────────────────────────
  { file: MODULE, check: CHECK, name: 'M9  prices are keyed off the outcome ORDER instead of the team name',
    anchor: '    const o = list.find(x => key(x.name) === k);',
    replace: '    const o = list[0];',
    catches: 'home and away both take the first outcome — a 50/50 silent swap' },

  { file: MODULE, check: CHECK, name: 'M10 the home/away prices are transposed',
    anchor: "    home: priceOf(event?.home_team),\n    away: priceOf(event?.away_team),",
    replace: "    home: priceOf(event?.away_team),\n    away: priceOf(event?.home_team),",
    catches: 'every stored favourite becomes the underdog' },

  { file: MODULE, check: CHECK, name: 'M11 a missing outcome yields 0 rather than null',
    anchor: '    return o && o.price != null ? Number(o.price) : null;',
    replace: '    return o && o.price != null ? Number(o.price) : 0;',
    catches: 'absence collapses into an even-money price (Rule 99)' },

  // ── the call sites ────────────────────────────────────────────────────────
  { file: CRON, check: WIRING, name: 'M12 the cron gets its private normTeam back',
    anchor: 'import { matchSlate, h2hPrices }',
    replace: 'function normTeam(s) { return String(s || "").toLowerCase(); }\nimport { matchSlate, h2hPrices }',
    catches: 'a private normalizer beside the shared one' },

  { file: CRON, check: WIRING, name: 'M13 the cron reverts to a local events.find matcher',
    anchor: '    const slate = matchSlate(sportGames, events, isoDate);',
    replace: '    const slate = { byGameId: new Map(), stage1: 0, stage2: 0, unmatched: 0, ambiguous: 0, poolSize: 0, droppedOutOfWindow: 0 };',
    catches: 'the cron pairs nothing at all' },

  // ── the slate window and elimination ──────────────────────────────────────
  { file: MODULE, check: CHECK, name: 'M15 the date window is removed — every future fixture is a candidate again',
    anchor: '  return list.filter(e => ok.has(String(e?.commence_time || \'\').slice(0, 10)));',
    replace: '  return list;',
    catches: 'GA Southern sees a second Clemson game a week later and goes ambiguous' },

  { file: MODULE, check: CHECK, name: 'M16 the window forgets the next day — an evening slate loses its late games',
    anchor: '  const ok = new Set([isoDate, d2]);',
    replace: '  const ok = new Set([isoDate]);',
    catches: 'the 10 events kicking off after midnight UTC leave the pool' },

  { file: MODULE, check: CHECK, name: 'M17 stage 2 takes the first candidate instead of requiring exactly one',
    anchor: '    if (c.length !== 1) continue;            // 0 or many: not forced, never guessed',
    replace: '    if (!c.length) continue;',
    catches: 'a row with several candidates resolves by payload order' },

  { file: MODULE, check: CHECK, name: 'M18 stage 2 ignores what stage 1 already spent',
    anchor: '  const free = pool.filter(e => !claimed.has(e.id));',
    replace: '  const free = pool.slice();',
    catches: 'elimination is not elimination — a claimed event is offered twice' },

  { file: MODULE, check: CHECK, name: 'M19 the two-rows-one-event collision is resolved by order',
    anchor: "    if ((wantedBy.get(event.id) || []).length !== 1) { ambiguous++; continue; }",
    replace: '    if (false) { ambiguous++; continue; }',
    catches: 'both rows take the same event and the result depends on iteration order' },

  { file: MODULE, check: CHECK, name: 'M20 stage 2 matches on the abbreviated side too',
    anchor: "      ...free.filter(e => nameMatches(g.home, e.home_team)),\n      ...free.filter(e => nameMatches(g.away, e.away_team)),",
    replace: "      ...free.filter(e => nameMatches(g.home, e.home_team) || nameMatches(g.away, e.away_team)\n                       || nameMatches(g.home, e.away_team) || nameMatches(g.away, e.home_team)),",
    catches: 'a looser candidate set produces collisions the guard then refuses' },

  // ── the pairing-rate watcher ──────────────────────────────────────────────
  { file: WATCHER, check: WATCH_CHECK, name: 'M21 the watcher stops caring that credits were spent',
    anchor: '  return (rows || []).filter(r => Number(r.credits_used) > 0 && Number(r.games_processed) === 0);',
    replace: '  return (rows || []).filter(r => Number(r.games_processed) === 0);',
    catches: 'a date that spent nothing is reported as a burned date' },

  { file: WATCHER, check: WATCH_CHECK, name: 'M22 the watcher compares without coercing',
    anchor: '  return (rows || []).filter(r => Number(r.credits_used) > 0 && Number(r.games_processed) === 0);',
    replace: "  return (rows || []).filter(r => r.credits_used > 0 && r.games_processed === 0);",
    catches: "D1 returns '0' as a string and === 0 never fires — the watcher passes forever" },

  { file: WATCHER, check: WATCH_CHECK, name: 'M23 the watcher treats zero pairings as merely low',
    anchor: '  return (rows || []).filter(r => Number(r.credits_used) > 0 && Number(r.games_processed) === 0);',
    replace: '  return (rows || []).filter(r => Number(r.credits_used) > 0 && Number(r.games_processed) < 0);',
    catches: 'nothing can ever be flagged — a check that cannot fail' },

  { file: WATCHER, check: WATCH_CHECK, name: 'M24 the spend verdict stops prorating by elapsed time',
    anchor: '  const allowance = ceiling * (elapsedH / 24);',
    replace: '  const allowance = ceiling;',
    catches: 'a half-day delta is judged against a full day and under-reports' },

  { file: WATCHER, check: WATCH_CHECK, name: 'M25 a missing provider reading collapses to zero',
    anchor: "  const num = (v) => (v === null || v === undefined || String(v).trim() === ''\n    ? null : (Number.isFinite(Number(v)) ? Number(v) : null));",
    replace: '  const num = (v) => Number(v);',
    catches: 'Number(null) is 0, so an absent reading reads as a counter reset' },

  { file: WATCHER, check: WATCH_CHECK, name: 'M26 a monthly reset is reported as overspend',
    anchor: "  if (delta < 0) return { state: 'provider_counter_reset', over: false, delta, elapsedH };",
    replace: '  // reset case removed',
    catches: 'the month rolling over fires a false alarm every month' },

  { file: WATCHER, check: WATCH_CHECK, name: 'M27 the first reading passes as a measured zero',
    anchor: "  if (!prev) return { state: 'no_baseline', over: false };",
    replace: "  if (!prev) return { state: 'within_ceiling', over: false };",
    catches: 'a series of one reports a spend it never measured' },

  { file: WATCHER, check: WIRING, name: 'M28 a failing pairing verdict exits before recording the spend',
    anchor: "  console.log(`2026-09-16. Investigate the matcher before the budget (Rule 77).`);",
    replace: "  console.log(`2026-09-16. Investigate the matcher before the budget (Rule 77).`);\n  process.exit(1);",
    catches: 'the day you most want the cost of is the day it is not recorded' },

  { file: FILL, check: WIRING, name: 'M14 the fill stops importing the shared matcher',
    anchor: "import { matchSlate, h2hPrices } from '../src/odds-name-match.js';",
    replace: '// import removed',
    catches: 'the live-write path drifts off the shared module' },
];

let caught = 0;
for (const mut of MUTATIONS) {
  const file = mut.file, check = mut.check;
  const original = fs.readFileSync(file, 'utf8');
  const hits = original.split(mut.anchor).length - 1;
  if (hits !== 1) {
    console.log(`FAIL       ${mut.name}\n            anchor matched ${hits} times, expected 1 — NOTHING MUTATED.`);
    continue;
  }
  fs.writeFileSync(file, original.replace(mut.anchor, mut.replace));
  if (fs.readFileSync(file, 'utf8') === original) {
    console.log(`FAIL       ${mut.name}\n            file unchanged after write — NOTHING MUTATED.`);
    sh('git', ['checkout', '--', file]);
    continue;
  }

  const r = spawnSync('node', Array.isArray(check) ? check : [check], { encoding: 'utf8' });
  const red = r.status !== 0;
  sh('git', ['checkout', '--', file]);

  console.log(`${red ? 'CAUGHT    ' : 'NOT CAUGHT'} ${mut.name}`);
  console.log(`            (${mut.catches})`);
  if (red) caught++;
}

console.log(`\n${caught} of ${MUTATIONS.length} mutations caught.`);
const byFile = {};
for (const m of MUTATIONS) byFile[m.file] = (byFile[m.file] || 0) + 1;
console.log(`COVERAGE: ${Object.entries(byFile).map(([f, n]) => `${n} in ${f}`).join(', ')}.`);
console.log(`Offline only — no mutation here exercises a LIVE vendor payload or a D1 write.`);
process.exit(caught === MUTATIONS.length ? 0 : 1);
