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
// asUtc lives in its own module so the TZ case can spawn a child that imports
// the REAL function. M38 was NOT CAUGHT while the child carried an inline copy.
const UTCLIB  = 'scripts/lib/utc.mjs';
const sh = (c, a) => execFileSync(c, a, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

// `git checkout --` restores from the INDEX, so the index is what must hold a
// good copy — a staged-but-uncommitted file is fine, an unstaged edit is not.
for (const f of [MODULE, CRON, FILL, WATCHER, UTCLIB]) {
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
    anchor: '    if (a.every((t, i) => v[off + i].startsWith(t))) return true;',
    replace: '    if (v.join("").startsWith(a.join(""))) return true;',
    catches: 'N Colorado / C Connecticut / Illinois St stop matching' },

  { file: MODULE, check: CHECK, name: 'M2  the prefix direction is flipped',
    anchor: '    if (a.every((t, i) => v[off + i].startsWith(t))) return true;',
    replace: '    if (a.every((t, i) => t.startsWith(v[off + i]))) return true;',
    catches: 'the mascot token would have to prefix the archive token' },

  { file: MODULE, check: CHECK, name: 'M3  every archive token becomes some archive token',
    anchor: '    if (a.every((t, i) => v[off + i].startsWith(t))) return true;',
    replace: '    if (a.some((t, i) => v[off + i].startsWith(t))) return true;',
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

  { file: MODULE, check: CHECK, name: 'M7  the empty-name refusal is dropped',
    anchor: '  if (!a.length) return false;',
    replace: '  if (false) return false;',
    catches: 'every() on [] is vacuously true, so an empty archive name matches everything' },

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

  // ── M24-M27 REPLACED 2026-09-16. They tested daySpendVerdict, which asked
  // one question badly: the PROVIDER's cumulative delta against OUR ledger's
  // ceiling, prorated. M24 in particular defended the proration, and proration
  // of a daily cap was itself the defect — it failed a real day that sat at 42%
  // of its ceiling. The mutations move with the predicates they aim at.
  { file: WATCHER, check: WATCH_CHECK, name: 'M24 integrity compares the provider against a ceiling again',
    anchor: '  const escaped = providerDelta - ledgerDelta;',
    replace: '  const escaped = providerDelta - Math.round(3800 * elapsedH / 24);',
    catches: 'the two-population comparison returns — a busy evening reads as a breach' },

  { file: WATCHER, check: WATCH_CHECK, name: 'M25 a missing reading collapses to zero',
    anchor: "const _num = (v) => (v === null || v === undefined || String(v).trim() === ''\n  ? null : (Number.isFinite(Number(v)) ? Number(v) : null));",
    replace: 'const _num = (v) => Number(v);',
    catches: 'Number(null) is 0, so an absent reading reads as a counter reset' },

  // Re-anchored 2026-09-17 when the branch gained RESET_FLOOR. The harness
  // refused to report a result rather than pass on an anchor that matched
  // nothing — which is the corollary working, not a nuisance.
  { file: WATCHER, check: WATCH_CHECK, name: 'M26 a monthly reset is reported as escaped spend',
    anchor: "  if (providerDelta < -RESET_FLOOR || ledgerDelta < -RESET_FLOOR) {",
    replace: '  if (false) {',
    catches: 'the month rolling over fires a false alarm every month' },

  { file: WATCHER, check: WATCH_CHECK, name: 'M27 the first reading passes as a measured zero',
    anchor: "  if (!prev) return { state: 'no_baseline', over: false };",
    replace: "  if (!prev) return { state: 'ledger_captured_all', over: false };",
    catches: 'a series of one reports a divergence it never measured' },

  // ── CI spend subtracted from the escape, 2026-09-17 ─────────────────────
  // ── the degrade-open witness, 2026-09-18 ────────────────────────────────
  { file: WATCHER, check: WATCH_CHECK, name: 'M43 an unreadable degrade counter reads as none',
    anchor: "  if (now === null) return { state: 'unreadable', credits: null };",
    replace: "  if (now === null) return { state: 'none', credits: 0 };",
    catches: 'the watch prints "no guard degraded" on no evidence and eliminates a candidate it never tested' },

  { file: WATCHER, check: WATCH_CHECK, name: 'M44 the cumulative counter is read as a level',
    anchor: '  const delta = now - was;',
    replace: '  const delta = now;',
    catches: 'a day-long total is attributed to one interval, so any escape looks explained' },

  { file: WATCHER, check: WATCH_CHECK, name: 'M45 a midnight rollover is clamped instead of flagged',
    anchor: "  if (delta < 0) return { state: 'unreadable', credits: null };",
    replace: '  if (delta < 0) return { state: \'none\', credits: 0 };',
    catches: 'the reading that spans midnight claims no degradation, which is the one that cannot know' },

  { file: WATCHER, check: WATCH_CHECK, name: 'M46 a missing baseline is treated as zero',
    anchor: "  if (was === null) return { state: 'unreadable', credits: null };",
    replace: '  if (was === null) return { state: \'none\', credits: 0 };',
    catches: 'readings that predate the field report their whole daily total as this interval\'s' },

  { file: WATCHER, check: WATCH_CHECK, name: 'M41 any negative delta is called a month reset',
    anchor: '  if (providerDelta < -RESET_FLOOR || ledgerDelta < -RESET_FLOOR) {',
    replace: '  if (providerDelta < 0 || ledgerDelta < 0) {',
    catches: 'the shape that shipped for 13 minutes — a 2-credit reconcile refund announced as a monthly roll-over' },

  { file: WATCHER, check: WATCH_CHECK, name: 'M42 the reset floor is raised until a real roll is missed',
    anchor: 'export const RESET_FLOOR = 1000;',
    replace: 'export const RESET_FLOOR = 10000000;',
    catches: 'a genuine month roll is reported as a colossal escape every month' },

  { file: WATCHER, check: WATCH_CHECK, name: 'M36 the escape is judged before subtracting CI',
    anchor: '  const unexplained = escaped - Math.max(0, Number(outsideLedger) || 0);',
    replace: '  const unexplained = escaped;',
    catches: 'the backfill doing its job is charged to "a guard stopped guarding" — two populations again' },

  { file: WATCHER, check: WATCH_CHECK, name: 'M37 a negative outsideLedger can manufacture leakage',
    anchor: 'escaped - Math.max(0, Number(outsideLedger) || 0)',
    replace: 'escaped - (Number(outsideLedger) || 0)',
    catches: 'a bad input inflates the residual instead of being clamped' },

  { file: UTCLIB, check: WATCH_CHECK, name: 'M38 a SQLite timestamp is parsed as local time',
    anchor: "  return Date.parse(/[TZ]/.test(s) ? s : s.replace(' ', 'T') + 'Z');",
    replace: '  return Date.parse(s);',
    catches: 'no zone marker, so the window shifts by hours and runs move in or out of it' },

  { file: WATCHER, check: WATCH_CHECK, name: 'M39 an undated progress row is subtracted anyway',
    anchor: '    if (!Number.isFinite(at)) { undated++; continue; }',
    replace: '    if (!Number.isFinite(at)) { credits += Number(r.credits_used) || 0; continue; }',
    catches: 'a row that cannot be placed inflates the subtraction and shrinks the residual on no evidence' },

  { file: WATCHER, check: WATCH_CHECK, name: 'M40 the interval bound is dropped',
    anchor: '    if (at < from || at > to) continue;',
    replace: '    if (false) continue;',
    catches: 'every backfill run ever is subtracted from one interval, and the residual goes negative' },

  { file: WATCHER, check: WATCH_CHECK, name: 'M33 the ceiling check starts prorating',
    anchor: '    state: used > ceiling ? \'over_ceiling\' : \'within_ceiling\',',
    replace: '    state: used > ceiling * 0.3 ? \'over_ceiling\' : \'within_ceiling\',',
    catches: 'the watch models a cap the guard does not enforce — the 2026-09-16 false alarm' },

  { file: WATCHER, check: WATCH_CHECK, name: 'M34 a null daily counter reads as a clean day',
    anchor: "  if (used === null || ceiling === null || ceiling <= 0) return { state: 'unreadable', over: false };",
    replace: '  if (false) return {};',
    catches: 'Number(null) is 0 and 0 is under every ceiling' },

  { file: WATCHER, check: WATCH_CHECK, name: 'M35 the escape tolerance grows until nothing can fail',
    anchor: 'export const ESCAPE_FLOOR = 50;',
    replace: 'export const ESCAPE_FLOOR = 1000000;',
    catches: 'the way this watch ends quietly — raising the bar instead of reading it' },

  { file: WATCHER, check: WIRING, name: 'M28 a failing pairing verdict exits before recording the spend',
    anchor: "  console.log(`2026-09-16. Investigate the matcher before the budget (Rule 77).`);",
    replace: "  console.log(`2026-09-16. Investigate the matcher before the budget (Rule 77).`);\n  process.exit(1);",
    catches: 'the day you most want the cost of is the day it is not recorded' },

  { file: WATCHER, check: WIRING, name: 'M29 an unknown pairing baseline is coerced to zero',
    anchor: '  const basePaired = prev.games_paired_in_window;',
    replace: '  const basePaired = prev.games_paired_in_window ?? 0;',
    catches: 'a reading that predates the counter reports a difference it cannot know' },
  { file: WATCHER, check: WIRING, name: 'M32 a partial window total is published as a total',
    anchor: '  games_paired_in_window: gamesTotal.skipped ? null : gamesTotal.sum,',
    replace: '  games_paired_in_window: gamesTotal.sum,',
    catches: 'the sum of the readable rows is stored under the name of the whole window' },

  { file: MODULE, check: CHECK, name: 'M30 the window goes back to anchoring at index 0',
    anchor: '  for (let off = 0; off + a.length <= v.length; off++) {\n    if (a.every((t, i) => v[off + i].startsWith(t))) return true;\n  }\n  return false;',
    replace: '  return a.every((t, i) => v[i].startsWith(t));',
    catches: 'the shape that paired 0 of 26 in production on 2026-09-15' },

  { file: MODULE, check: CHECK, name: 'M31 the window stops being contiguous',
    anchor: '    if (a.every((t, i) => v[off + i].startsWith(t))) return true;',
    replace: '    if (a.every((t) => v.some(x => x.startsWith(t)))) return true;',
    catches: 'tokens match anywhere in any order — Red Jays finds Red Sox and Blue Jays' },

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
