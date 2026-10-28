#!/usr/bin/env node
/**
 * Rule 90 for scripts/check-odds-site-caps.mjs.
 *
 * This guards the odds budget, on a metered account. Every mutation below breaks
 * the guard in a way that would spend past a cap, refuse a call that had room,
 * file a refusal under the wrong limit, or leave a counter that disagrees with
 * the others; the check must go red for each. A mutation that leaves it green is a
 * check that could not have caught the defect, and this file exits non-zero.
 *
 * THE HARNESS'S OWN ANCHORS ARE ASSERTED. A mutation whose anchor is missing or
 * not unique applies NOTHING, and a check that is green on unmutated source would
 * then print a pass for it. Each one therefore fails the harness by name when its
 * anchor does not occur exactly once.
 *
 * Mutants are written BESIDE the original and the check is pointed at them with
 * BUDGET_HELPERS_SRC, or INDEX_SRC / AMBIENT_DO_SRC / WP_RESOLVER_SRC for the call
 * sites. A mutant counts as CAUGHT only when an assertion failed ("N of M passed."
 * with N < M and a FAIL line): a crash or a syntax error proves nothing about what
 * the check asserts, and is reported as a harness error.
 */
import { readFileSync, writeFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, resolve, dirname } from 'node:path';

const TARGETS = {
  helpers: { path: 'src/budget-helpers.js', env: 'BUDGET_HELPERS_SRC' },
  index:   { path: 'src/index.js',          env: 'INDEX_SRC' },
  ambient: { path: 'src/ambient-do.js',     env: 'AMBIENT_DO_SRC' },
  wp:      { path: 'src/wp-resolver.js',    env: 'WP_RESOLVER_SRC' },
};
const originals = Object.fromEntries(Object.entries(TARGETS).map(([k, t]) => [k, readFileSync(t.path, 'utf8')]));
const born = [];
const place = (target, text, tag) => {
  const p = join(dirname(TARGETS[target].path), `.mutant-${tag}-${Math.random().toString(36).slice(2, 8)}.js`);
  writeFileSync(p, text); born.push(p); return resolve(p);
};
// Mutants are removed on every way out. 'exit' handlers do not run on a signal
// unless the signal handler exits, so Ctrl-C and SIGTERM are routed through it.
process.on('exit', () => { for (const p of born) rmSync(p, { force: true }); });
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => process.exit(130));

// A smaller run than the check's default: each mutant is run once, and a defect
// of these kinds shows within a few hundred sequences. The unmutated control
// below runs at the same size, so the comparison is like for like.
// 'pass' | 'red' (an assertion failed) | 'error' (anything else).
const run = (envs = {}) => {
  let out = '', code = 0;
  try {
    out = execFileSync(process.execPath, ['scripts/check-odds-site-caps.mjs'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, SITE_CAP_SEQUENCES: '400', ...envs } });
  } catch (e) { out = String(e.stdout || ''); code = e.status ?? 1; }
  const m = /^(\d+) of (\d+) passed\.$/m.exec(out);
  if (code === 0) return m && m[1] === m[2] ? 'pass' : 'error';
  return m && Number(m[1]) < Number(m[2]) && /^FAIL  /m.test(out) ? 'red' : 'error';
};

if (run() !== 'pass') { console.log('FAIL — the check is already red on clean source.'); process.exit(1); }
const controlEnvs = Object.fromEntries(Object.entries(TARGETS).map(([k, t]) => [t.env, place(k, originals[k], 'control')]));
if (run(controlEnvs) !== 'pass') {
  console.log('FAIL — UNMUTATED copies at the mutant locations are red, so no verdict below would mean anything.');
  process.exit(1);
}
console.log('baseline: the check passes on current source and on unmutated copies at the mutant locations\n');

const GATE_SITE = "AND (SELECT used FROM odds_budget_site WHERE day = ? AND site = ?) + ? <= ?`;";
const GATE_MONTH = "AND (SELECT used FROM odds_budget_month WHERE month = ?) + ? <= ?\n";
const GATE_DAY = "WHERE (SELECT used FROM odds_budget WHERE day = ?) + ? <= ?\n              AND (SELECT used FROM odds_budget_month";
const EXISTS = 'AND EXISTS (SELECT 1 FROM odds_budget_gate WHERE token = ?)';

const MUTANTS = [
  ['M1  the gate stops asking about the SITE (cap + 1e9)', GATE_SITE, "AND (SELECT used FROM odds_budget_site WHERE day = ? AND site = ?) + ? <= ? + 1000000000`;"],
  ['M2  the gate stops asking about the MONTH', GATE_MONTH, "AND (SELECT used FROM odds_budget_month WHERE month = ?) + ? <= ? + 1000000000\n"],
  ['M3  the gate stops asking about the DAY', GATE_DAY, "WHERE (SELECT used FROM odds_budget WHERE day = ?) + ? <= ? + 1000000000\n              AND (SELECT used FROM odds_budget_month"],
  ['M4  the site charge applies whether or not the gate passed', `WHERE day = ? AND site = ?\n               ${EXISTS}\`;`, "WHERE day = ? AND site = ?\n               AND (? IS NOT NULL)`;"],
  ['M5  the month charge applies whether or not the gate passed', `WHERE month = ?\n               ${EXISTS}\n            RETURNING used\`;`, "WHERE month = ?\n               AND (? IS NOT NULL)\n            RETURNING used`;"],
  ['M6  the day charge applies whether or not the gate passed', `WHERE day = ?\n               ${EXISTS}\n            RETURNING used\`;`, "WHERE day = ?\n               AND (? IS NOT NULL)\n            RETURNING used`;"],
  ['M7  every call carries the SAME token (a refused call finds a stale match)', 'const token = crypto.randomUUID();', "const token = 'fixed-token';"],
  ['M8  the gate row is never replaced (INSERT OR IGNORE)', 'INSERT OR REPLACE INTO odds_budget_gate', 'INSERT OR IGNORE INTO odds_budget_gate'],
  ['M9  the veto reason asks the month before the day',
    "    if (row.day_used + units > dayCeiling) return 'day';\n    if (row.month_used + units > ODDS_HARD_LIMIT) return 'month';",
    "    if (row.month_used + units > ODDS_HARD_LIMIT) return 'month';\n    if (row.day_used + units > dayCeiling) return 'day';"],
  ['M10 the site boundary is off by one (>= for >)', "if (row.site_used + units > siteCeiling) return 'site';", "if (row.site_used + units >= siteCeiling) return 'site';"],
  ['M11 the closing capture cap is ten times too high', '    ambientCaptureClosingOdds: 400,', '    ambientCaptureClosingOdds: 4000,'],
  ['M12 a grant raises the site cap on every date', ".filter(g => g.date === date && g.siteExtra", '.filter(g => g.siteExtra'],
  ['M13 an uncapped site is capped at 0', 'if (base === null) return NO_SITE_CEILING;', 'if (base === null) return 0;'],
  ['M14 the site statement is dropped from the batch', "'monthSeed', 'siteSeed', 'snapshot'", "'monthSeed', 'snapshot'"],
  ['M15 the DECLARED order puts the snapshot after the charges (the prepared order is untouched, so the two disagree)',
    "['seed', 'monthSeed', 'siteSeed', 'snapshot', 'gate', 'refusal', 'siteCharge', 'monthCharge', 'charge']",
    "['seed', 'monthSeed', 'siteSeed', 'gate', 'refusal', 'siteCharge', 'monthCharge', 'snapshot', 'charge']"],
  ['M16 a site veto writes the DAY stamp', 'return `odds:daily:${date}:warned:site:${safe}`;', 'return `odds:daily:${date}:warned`;'],
  ['M17 a site veto lets the call through', "            return false;\n        }\n\n        // Both charged.", "            return true;\n        }\n\n        // Both charged."],
  ['M18 the gate checks the site against 1 credit, not the call\'s units', 'ODDS_HARD_LIMIT, date, site, units, siteCeiling),', 'ODDS_HARD_LIMIT, date, site, 1, siteCeiling),'],
  ['M19 the gate\'s month limit is 1,000 too generous', 'month, units, ODDS_HARD_LIMIT, date, site,', 'month, units, ODDS_HARD_LIMIT + 1000, date, site,'],
  ['M20 a verdict and a reason that disagree are believed (no throw)', "if (dayCharged !== (veto === null)) {", "if (false) {"],
  ['M21 the site charge loses its gate predicate AND its placeholder (a bind-count mismatch)', `WHERE day = ? AND site = ?\n               ${EXISTS}\`;`, "WHERE day = ? AND site = ?`;"],
  ['M22 the site charge runs ahead of the gate in the batch (the order array unchanged)',
    "            db.prepare(ODDS_BUDGET_SQL.gate).bind(token, date, units, ceiling, month, units, ODDS_HARD_LIMIT, date, site, units, siteCeiling),\n            db.prepare(ODDS_BUDGET_SQL.refusal).bind(date, date, units, ceiling, month, units, ODDS_HARD_LIMIT, site, new Date().toISOString(), token),\n            db.prepare(ODDS_BUDGET_SQL.siteCharge).bind(units, date, site, token),",
    "            db.prepare(ODDS_BUDGET_SQL.siteCharge).bind(units, date, site, token),\n            db.prepare(ODDS_BUDGET_SQL.gate).bind(token, date, units, ceiling, month, units, ODDS_HARD_LIMIT, date, site, units, siteCeiling),\n            db.prepare(ODDS_BUDGET_SQL.refusal).bind(date, date, units, ceiling, month, units, ODDS_HARD_LIMIT, site, new Date().toISOString(), token),"],
  ['M23 units that are not a number are passed to the gate', "if (typeof units !== 'number' || !Number.isFinite(units) || units < 0) {", 'if (false) {'],
  ['M24 a site that is not a string is passed to the gate', "if (typeof site !== 'string' || site === '') {", 'if (false) {'],
  ['M25 a site veto whose stamp cannot be recorded degrades open', "console.warn(`[odds-site-guard] veto held; stamp not recorded: ${_vetoErrText(e)}`);", 'throw e;'],
  ['M26 the site veto warning formats with a bare String()', '[odds-site-guard] veto held; stamp not recorded: ${_vetoErrText(e)}', '[odds-site-guard] veto held; stamp not recorded: ${String(e)}'],
  ['M27 the verdict/reason guard only looks one way', 'if (dayCharged !== (veto === null)) {', 'if (dayCharged && veto !== null) {'],
  ['M28 the veto reason is computed against the standing ceiling, not the granted one', 'const veto = _vetoFromBatch(results, units, ceiling, siteCeiling);', 'const veto = _vetoFromBatch(results, units, ODDS_DAILY_CEILING, siteCeiling);'],
  ['M29 the day grant never expires', '        .filter(g => g.date === today)', '        .filter(g => true)'],
  ['M30 the standing day ceiling is raised', 'const ODDS_DAILY_CEILING = 3800;', 'const ODDS_DAILY_CEILING = 3900;'],
  ['M31 two grants for one site and date resolve last-wins', ".reduce((n, g) => n + (Number(g.siteExtra[site]) || 0), 0);", ".reduce((n, g) => (Number(g.siteExtra[site]) || 0), 0);"],
  ['M32 the day correction carries a ceiling', "'UPDATE odds_budget SET used = MAX(0, used + ?) WHERE day = ?'", "'UPDATE odds_budget SET used = MAX(0, used + ?) WHERE day = ? AND used + ? <= 3800'"],
  ['M33 the month correction carries a ceiling', "'UPDATE odds_budget_month SET used = MAX(0, used + ?) WHERE month = ?'", "'UPDATE odds_budget_month SET used = MAX(0, used + ?) WHERE month = ? AND used + ? <= 85000'"],
  ['M34 the site correction carries a cap', 'ON CONFLICT(day, site) DO UPDATE SET used = MAX(0, used + ?)`;', 'ON CONFLICT(day, site) DO UPDATE SET used = MAX(0, used + ?) WHERE used + ? <= 400`;'],
  // THE CALL SITES. A capped consumer whose charge label is renamed to another
  // declared site is uncapped; check-odds-attribution catches one side renamed, not
  // the label this check reads.
  ['M35 fetchSportOddsHistorical is charged under another declared site', "      : site === 'archiveGameClosing' ? 'archiveGameClosing' : 'fetchSportOddsHistorical'))) {", "      : site === 'archiveGameClosing' ? 'archiveGameClosing' : 'oddsProxyRoute'))) {", 'index'],
  ['M36 the closing capture is charged under another declared site', "_consumeAmbientOddsCredit(this.env, oddsCreditCost(url), 'ambientCaptureClosingOdds')", "_consumeAmbientOddsCredit(this.env, oddsCreditCost(url), 'ambientFetchLiveOdds')", 'ambient'],
  ['M37 the WC lambdas are charged under another declared site', "consumeOddsCredit(env, oddsCreditCost(_wcUrl), 'getWCPregameLambdas')", "consumeOddsCredit(env, oddsCreditCost(_wcUrl), 'handleWCOddsProbs')", 'index'],
  ['M38 the live odds are charged under another declared site', "site === 'identityMismatches' ? 'identityMismatches' : 'fetchSportOddsLive'))) {", "site === 'identityMismatches' ? 'identityMismatches' : 'oddsProxyRoute'))) {", 'index'],
  // The split labels (2026-10-28): a leaf of the closed ternary renamed so it no longer
  // matches its own condition is an unnamed site to the gate, and the cap is then dead.
  ['M39 the identity route is no longer charged under its own label', "site === 'identityMismatches' ? 'identityMismatches' : 'fetchSportOddsLive'))) {", "site === 'identityMismatches' ? 'oddsProxyRoute' : 'fetchSportOddsLive'))) {", 'index'],
  ['M40 the odds-backfill route is no longer charged under its own label', "        site === 'archiveOddsBackfill' ? 'archiveOddsBackfill'\n      : site === 'archiveGameClosing'", "        site === 'archiveOddsBackfill' ? 'oddsProxyRoute'\n      : site === 'archiveGameClosing'", 'index'],
  ['M41 the archive-game closing is no longer charged under its own label', "      : site === 'archiveGameClosing' ? 'archiveGameClosing' : 'fetchSportOddsHistorical'))) {", "      : site === 'archiveGameClosing' ? 'oddsProxyRoute' : 'fetchSportOddsHistorical'))) {", 'index'],
  // THE REFUSAL RECORD (fix 3 E, 2026-10-28). The counters and the verdict are
  // untouched by each of these; only the record, or the comparison that reads it,
  // is wrong.
  ['M42 the refusal is recorded on every call', "            WHERE NOT EXISTS (SELECT 1 FROM odds_budget_gate WHERE token = ?)", "            WHERE EXISTS (SELECT 1 FROM odds_budget_gate WHERE token = ?)"],
  ['M43 repeats are not counted', "ON CONFLICT(day, scope, site) DO UPDATE SET n = n + 1", "ON CONFLICT(day, scope, site) DO UPDATE SET n = 1"],
  ['M44 the latest refusal overwrites the first', "ON CONFLICT(day, scope, site) DO UPDATE SET n = n + 1", "ON CONFLICT(day, scope, site) DO UPDATE SET n = n + 1, first_at = excluded.first_at"],
  ['M45 the refusal is filed under the caller that was not turned away', "ODDS_HARD_LIMIT, site, new Date().toISOString(), token)", "ODDS_HARD_LIMIT, 'unattributed', new Date().toISOString(), token)"],
  ['M46 the refusal asks the month before the day (predicates AND binds reordered together)',
   [["CASE WHEN (SELECT used FROM odds_budget WHERE day = ?) + ? > ? THEN 'day'\n                          WHEN (SELECT used FROM odds_budget_month WHERE month = ?) + ? > ? THEN 'month'", "CASE WHEN (SELECT used FROM odds_budget_month WHERE month = ?) + ? > ? THEN 'month'\n                          WHEN (SELECT used FROM odds_budget WHERE day = ?) + ? > ? THEN 'day'"], ["ODDS_BUDGET_SQL.refusal).bind(date, date, units, ceiling, month, units, ODDS_HARD_LIMIT, site, new Date().toISOString(), token)", "ODDS_BUDGET_SQL.refusal).bind(date, month, units, ODDS_HARD_LIMIT, date, units, ceiling, site, new Date().toISOString(), token)"]]],
  ['M46b the refusal\'s two predicates are swapped and the binds left (wrong totals, so every refusal is filed under the site)',
   "CASE WHEN (SELECT used FROM odds_budget WHERE day = ?) + ? > ? THEN 'day'\n                          WHEN (SELECT used FROM odds_budget_month WHERE month = ?) + ? > ? THEN 'month'", "CASE WHEN (SELECT used FROM odds_budget_month WHERE month = ?) + ? > ? THEN 'month'\n                          WHEN (SELECT used FROM odds_budget WHERE day = ?) + ? > ? THEN 'day'"],
  ['M47 the record is never compared with the reason', "        if (recorded !== veto) {", "        if (false) {"],
  ['M48 the record is read from the wrong statement', "const r = results?.[ODDS_CHARGE_ORDER.indexOf('refusal')];", "const r = results?.[ODDS_CHARGE_ORDER.indexOf('gate')];"],
  ['M49 a refusal the record does not name is read as no refusal', "    if (r.results.length === 0) return null;\n    const scope = r.results[0].scope;", "    const scope = r.results[0]?.scope ?? null;\n    if (scope === null) return null;"],
];

let missed = 0, nothing = 0, errored = 0;
for (const [name, anchor, repl, target = 'helpers'] of MUTANTS) {
  const original = originals[target];
  // One anchor and one replacement, or an array of [anchor, replacement] pairs applied in turn when a
  // faithful mutation has to change two places (a statement and the binds that feed it).
  const pairs = Array.isArray(anchor) ? anchor : [[anchor, repl]];
  let text = original, bad = null;
  for (const [a, r] of pairs) {
    const count = text.split(a).length - 1;
    if (count !== 1) { bad = `the anchor occurs ${count} times in ${TARGETS[target].path}, not once`; break; }
    text = text.replace(a, () => r);
  }
  if (bad) {
    nothing++;
    console.log(`NOTHING MUTATED  ${name}\n        ${bad}`);
    continue;
  }
  if (text === original) { nothing++; console.log(`NOTHING MUTATED  ${name}`); continue; }
  // M21 removes a placeholder: the SQL then fails or misbehaves inside chargeOdds,
  // which is a failed assertion in the check like any other.
  const verdict = run({ [TARGETS[target].env]: place(target, text, name.slice(0, 3).trim()) });
  const label = verdict === 'red' ? 'CAUGHT    ' : verdict === 'pass' ? 'NOT CAUGHT' : 'HARNESS ERROR (no assertion failed; a crash is not a catch)';
  console.log(`${label}  ${name}`);
  if (verdict === 'pass') missed++;
  if (verdict === 'error') errored++;
}
const caughtN = MUTANTS.length - missed - nothing - errored;
console.log(`\nmutations: ${caughtN} of ${MUTANTS.length} caught${missed ? `, ${missed} SURVIVED` : ''}${errored ? `, ${errored} harness error(s)` : ''}${nothing ? `, ${nothing} not applied` : ''}`);
console.log('COVERAGE: each mutant ran the check at 400 sequences of 25 calls (the check runs 2,000 by default; the boundary, stamp, granted-day,');
console.log('input and call-site cases do not depend on that number). Mutated: src/budget-helpers.js, and copies of src/index.js and src/ambient-do.js');
console.log('for the call-site label cases. NOT mutated: src/wp-resolver.js, whose label (wpResolver) is uncapped.');
process.exit(missed || nothing || errored ? 1 : 0);
