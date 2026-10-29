#!/usr/bin/env node
/**
 * Rule 90 for scripts/check-odds-label-split.mjs.
 *
 * Each mutation below puts one of the three relabelled routes back on a cron's
 * label, or on another route's, by changing a call site or the guard's mapping in a
 * copy of src/index.js. The check must go red for every one. A mutation that leaves
 * it green is a check that could not have caught the defect, and this file exits
 * non-zero.
 *
 * THE HARNESS'S OWN ANCHORS ARE ASSERTED. A mutation whose anchor is missing or not
 * unique applies NOTHING, and a check that is green on unmutated source would then
 * print a pass for it. Each fails the harness by name when its anchor does not
 * occur exactly once.
 *
 * A mutant counts as CAUGHT only when an assertion failed ("N of M passed." with
 * N < M and a FAIL line). A crash or a syntax error proves nothing about what the
 * check asserts and is reported as a harness error.
 */
import { readFileSync, writeFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, resolve, dirname } from 'node:path';

const INDEX = 'src/index.js';
const original = readFileSync(INDEX, 'utf8');
const born = [];
const place = (text, tag) => {
  const p = join(dirname(INDEX), `.mutant-${tag}-${Math.random().toString(36).slice(2, 8)}.js`);
  writeFileSync(p, text); born.push(p); return resolve(p);
};
// Removed on every way out; 'exit' handlers do not run on a signal unless the
// signal handler exits.
process.on('exit', () => { for (const p of born) rmSync(p, { force: true }); });
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => process.exit(130));

// 'pass' | 'red' (an assertion failed) | 'error' (anything else).
const run = (envs = {}) => {
  let out = '', code = 0;
  try {
    out = execFileSync(process.execPath, ['scripts/check-odds-label-split.mjs'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, ...envs } });
  } catch (e) { out = String(e.stdout || ''); code = e.status ?? 1; }
  const m = /^(\d+) of (\d+) passed\.$/m.exec(out);
  if (code === 0) return m && m[1] === m[2] ? 'pass' : 'error';
  return m && Number(m[1]) < Number(m[2]) && /^FAIL  /m.test(out) ? 'red' : 'error';
};

if (run() !== 'pass') { console.log('FAIL — the check is already red on clean source.'); process.exit(1); }
if (run({ INDEX_SRC: place(original, 'control') }) !== 'pass') {
  console.log('FAIL — an UNMUTATED copy at the mutant location is red, so no verdict below would mean anything.');
  process.exit(1);
}
console.log('baseline: the check passes on current source and on an unmutated copy at the mutant location\n');

const GUARD_LIVE = "        site === 'identityMismatches' ? 'identityMismatches' : 'fetchSportOddsLive'))) {";
const RECON_LIVE = "    site === 'identityMismatches' ? 'identityMismatches' : 'fetchSportOddsLive');";
const GUARD_HIST_GAME = "      : site === 'archiveGameClosing' ? 'archiveGameClosing' : 'fetchSportOddsHistorical'))) {";
const RECON_HIST = "    site === 'archiveOddsBackfill' ? 'archiveOddsBackfill'\n  : site === 'archiveGameClosing' ? 'archiveGameClosing' : 'fetchSportOddsHistorical');";

const MUTANTS = [
  // THE ROUTES. A route that stops passing its selector compiles, lints and passes
  // every static gate, and spends the cron's cap again.
  ['L1 the identity route stops passing its selector', "fetchSportOddsLive(env, sportKey, 'identityMismatches')", 'fetchSportOddsLive(env, sportKey)'],
  ['L2 the odds-backfill route stops passing its selector', "runOddsBackfillForDate(env, date, 'archiveOddsBackfill')", 'runOddsBackfillForDate(env, date)'],
  ['L3 the archive-game route stops passing its selector', "fetchSportOddsHistorical(env, oddsSportKey, date, 'archiveGameClosing')", 'fetchSportOddsHistorical(env, oddsSportKey, date)'],
  ['L4 the backfill loop stops passing the selector through', 'await fetchSportOddsHistorical(env, sportKey, isoDate, site);', 'await fetchSportOddsHistorical(env, sportKey, isoDate);'],
  // A route passing the cron's own label, or a sibling's.
  ['L5 the identity route passes the cron label', "fetchSportOddsLive(env, sportKey, 'identityMismatches')", "fetchSportOddsLive(env, sportKey, 'fetchSportOddsLive')"],
  ['L6 the odds-backfill route passes the archive-game label', "runOddsBackfillForDate(env, date, 'archiveOddsBackfill')", "runOddsBackfillForDate(env, date, 'archiveGameClosing')"],
  ['L7 the archive-game route passes the odds-backfill label', "fetchSportOddsHistorical(env, oddsSportKey, date, 'archiveGameClosing')", "fetchSportOddsHistorical(env, oddsSportKey, date, 'archiveOddsBackfill')"],
  // THE MAPPING. The guard and the reconcile must agree: a charge filed under one
  // label and a correction under another leaves two ledgers that disagree.
  ['L8 the live guard no longer maps the identity selector', GUARD_LIVE, "        'fetchSportOddsLive'))) {"],
  ['L9 the live reconcile no longer maps the identity selector', RECON_LIVE, "    'fetchSportOddsLive');"],
  ['L10 the historical guard no longer maps the archive-game selector', GUARD_HIST_GAME, "      : 'fetchSportOddsHistorical'))) {"],
  ['L11 the historical reconcile no longer maps either selector', RECON_HIST, "    'fetchSportOddsHistorical');"],
  // THE CRON PATHS, the other direction: a default moved onto a route's label lets the first
  // anonymous GETs starve the cron.
  ['L15 the live fetch defaults to the identity route\'s label', "async function fetchSportOddsLive(env, sportKey, site = 'fetchSportOddsLive') {", "async function fetchSportOddsLive(env, sportKey, site = 'identityMismatches') {"],
  // (No mutant for fetchSportOddsHistorical's own default: it has none. Both callers name the label, and a default
  // that nothing reaches is dead code that no check can tell from a mutant with the same behaviour.)
  ['L17 the backfill defaults to the odds-backfill route\'s label', "async function runOddsBackfillForDate(env, isoDate, site = 'fetchSportOddsHistorical') {", "async function runOddsBackfillForDate(env, isoDate, site = 'archiveOddsBackfill') {"],
  ['L18 the opening-odds snapshot passes the identity selector', "const { games, quotaRemaining, ok } = await fetchSportOddsLive(env, sportKey);", "const { games, quotaRemaining, ok } = await fetchSportOddsLive(env, sportKey, 'identityMismatches');"],
  ['L19 the dead-hour backfill is called with the odds-backfill selector', "oddsResult = await runOddsBackfillForDate(env, oddsDate);", "oddsResult = await runOddsBackfillForDate(env, oddsDate, 'archiveOddsBackfill');"],
  ['L20 our own guard\'s refusal is reported as a vendor failure', "report.sports[sport] = guarded\n", "report.sports[sport] = false\n"],
  // THE GATE on /archive/odds-backfill (2026-10-29).
  ['L22 the gate is removed',
   "                if (!mcpBearerMatches(request.headers.get('Authorization'), env))\n                    return new Response('Unauthorized', { status: 401, headers: CORS });\n",
   ""],
  ['L23 an unset or empty relay secret opens the helper', "return typeof s === 'string' && s.length > 0 && typeof header === 'string' && header.replace('Bearer ', '') === s;", "return typeof header === 'string' && header.replace('Bearer ', '') === s;"],
  ['L24 the helper compares the published relay secret', "const s = env && env.FIELD_MCP_SECRET;", "const s = env && env.RELAY_SHARED_SECRET;"],
  ['L25 the gate answers but does not stop the route', "                    return new Response('Unauthorized', { status: 401, headers: CORS });\n                const date = url.searchParams.get('date');", "                    void new Response('Unauthorized', { status: 401, headers: CORS });\n                const date = url.searchParams.get('date');"],
  // THE DEBUG ROUTE that prepares the charge's statements itself.
  ['L12 the debug route\'s refusal probe is admitted instead of refused',
   "['gate', db.prepare(ODDS_BUDGET_SQL.gate).bind(token, DAY, 1, ceiling, MON, 1, MONTH_LIMIT, DAY, PROBE_SITE, 1, ceiling)],",
   "['gate', db.prepare(ODDS_BUDGET_SQL.gate).bind(token, DAY, 1, CEILING, MON, 1, MONTH_LIMIT, DAY, PROBE_SITE, 1, CEILING)],"],
  ['L13 the debug route leaves its refusal rows behind',
   "                        env.ARCHIVE_DB.prepare('DELETE FROM odds_budget_refusal WHERE day = ?').bind(DAY),\n", ''],
  ['L21 the debug route sends the charge without the month seed',
   "                    ['monthSeed', db.prepare(ODDS_BUDGET_SQL.monthSeed).bind(MON, 0)],\n", ''],
  ['L14 the debug route sends the charge without the refusal statement',
   "                    ['refusal', db.prepare(ODDS_BUDGET_SQL.refusal).bind(DAY, DAY, 1, ceiling, MON, 1, MONTH_LIMIT, PROBE_SITE, new Date().toISOString(), token)],\n", ''],
];

let missed = 0, nothing = 0, errored = 0;
for (const [name, anchor, repl] of MUTANTS) {
  const count = original.split(anchor).length - 1;
  if (count !== 1) {
    nothing++;
    console.log(`NOTHING MUTATED  ${name}\n        the anchor occurs ${count} times in ${INDEX}, not once`);
    continue;
  }
  const text = original.replace(anchor, () => repl);
  if (text === original) { nothing++; console.log(`NOTHING MUTATED  ${name}`); continue; }
  const verdict = run({ INDEX_SRC: place(text, name.slice(0, 3).trim()) });
  const label = verdict === 'red' ? 'CAUGHT    ' : verdict === 'pass' ? 'NOT CAUGHT' : 'HARNESS ERROR (no assertion failed; a crash is not a catch)';
  console.log(`${label}  ${name}`);
  if (verdict === 'pass') missed++;
  if (verdict === 'error') errored++;
}
const caughtN = MUTANTS.length - missed - nothing - errored;
console.log(`\nmutations: ${caughtN} of ${MUTANTS.length} caught${missed ? `, ${missed} SURVIVED` : ''}${errored ? `, ${errored} harness error(s)` : ''}${nothing ? `, ${nothing} not applied` : ''}`);
console.log('COVERAGE: three routes, the two functions they reach, and the debug route that prepares the charge itself, mutated in a copy of src/index.js. NOT mutated: src/budget-helpers.js');
console.log('(the caps; scripts/mutate-odds-site-caps.mjs owns those) and the routes\' other writes.');
process.exit(missed || nothing || errored ? 1 : 0);
