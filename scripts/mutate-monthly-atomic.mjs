// Rule 90 for scripts/check-monthly-atomic.mjs.
//
// This guards an 85,000-credit monthly limit on a metered account. Both ways of
// being wrong cost real money: a ceiling that fails open spends past the cap,
// and a seed that starts from zero hands the month a SECOND full ceiling. Every
// mutation below restores a state that would do one of those — or, since
// 2026-10-18, splits the day from the month again, or reads the wrong one.
//
// Mutants are written BESIDE the original and the check is pointed at them by
// environment variable: BUDGET_HELPERS_SRC for the helpers, and INDEX_SRC,
// WP_RESOLVER_SRC and AMBIENT_DO_SRC for the three wrappers, whose wiring
// assertions had no mutation at all until 2026-10-18.
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, resolve, dirname } from 'node:path';

const TARGETS = {
  helpers: { path: 'src/budget-helpers.js', env: 'BUDGET_HELPERS_SRC' },
  index:   { path: 'src/index.js',          env: 'INDEX_SRC' },
  wp:      { path: 'src/wp-resolver.js',    env: 'WP_RESOLVER_SRC' },
  ambient: { path: 'src/ambient-do.js',     env: 'AMBIENT_DO_SRC' },
};
const originals = Object.fromEntries(Object.entries(TARGETS).map(([k, t]) => [k, readFileSync(t.path, 'utf8')]));
const born = [];
const place = (target, text, tag) => {
  const p = join(dirname(TARGETS[target].path), `.mutant-${tag}-${Math.random().toString(36).slice(2, 8)}.js`);
  writeFileSync(p, text); born.push(p); return resolve(p);
};
process.on('exit', () => { for (const p of born) { try { unlinkSync(p); } catch (_e) {} } });

const run = (envs = {}) => {
  try {
    execFileSync(process.execPath, ['scripts/check-monthly-atomic.mjs'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, ...envs } });
    return true;
  } catch { return false; }
};

if (!run()) { console.log('FAIL — the check is already red on clean source.'); process.exit(1); }
const controlEnvs = Object.fromEntries(Object.entries(TARGETS).map(([k, t]) => [t.env, place(k, originals[k], 'control')]));
if (!run(controlEnvs)) {
  console.log('FAIL — UNMUTATED copies at the mutant locations are red, so no verdict below would mean anything.');
  process.exit(1);
}
console.log('baseline: the check passes on current source and on unmutated copies at the mutant locations\n');

const H = 'helpers';
const MONTH_CHARGE = "const SQL_MONTH_CHARGE = `UPDATE odds_budget_month SET used = used + ?\n             WHERE month = ? AND used + ? <= ?\n               AND (SELECT used FROM odds_budget WHERE day = ?) + ? <= ?\n            RETURNING used`;";
const ORDER = "export const ODDS_CHARGE_ORDER = ['seed', 'monthSeed', 'site', 'monthCharge', 'charge'];";
const order = (keys) => `export const ODDS_CHARGE_ORDER = [${keys.map((k) => `'${k}'`).join(', ')}];`;

const MUTATIONS = [
  // Placeholder-PRESERVING: dropping `AND used + ? <= ?` outright leaves fewer
  // placeholders than binds, and the check went red on a bind-count crash
  // rather than on the ceiling. `AND (? + ?) IS NOT NULL` keeps both binds, so
  // the only thing that changes is that the limit no longer binds.
  [H, 'M1 the month limit leaves the charge statement', MONTH_CHARGE,
   MONTH_CHARGE.replace('WHERE month = ? AND used + ? <= ?', 'WHERE month = ? AND (? + ?) IS NOT NULL'),
   'THE 85,000 LIMIT STOPS BINDING. Every charge returns a row, so nothing is ever vetoed and the month spends past the cap on a metered account'],

  [H, 'M2 the ceiling becomes a strict inequality',
   '             WHERE month = ? AND used + ? <= ?',
   '             WHERE month = ? AND used + ? < ?',
   'a charge landing exactly ON the ceiling is refused, so the last legitimate credits of every month are unspendable'],

  // Placeholder-preserving for the same reason as M1: `VALUES (?, 0)` drops a
  // placeholder, and the check would go red on its bind count, not the seed.
  [H, 'M3 the seed starts the month at zero',
   'const SQL_MONTH_SEED   = \'INSERT OR IGNORE INTO odds_budget_month (month, used) VALUES (?, ?)\';',
   'const SQL_MONTH_SEED   = \'INSERT OR IGNORE INTO odds_budget_month (month, used) VALUES (?, 0 * ?)\';',
   'THE FINANCIALLY DANGEROUS ONE: odds:credits:2026-09 stood near 60,948 of 85,000 at cutover, and a fresh row at 0 hands the month a SECOND full ceiling before the hard limit binds again'],

  [H, 'M4 the seed stops being idempotent',
   "const SQL_MONTH_SEED   = 'INSERT OR IGNORE INTO odds_budget_month (month, used) VALUES (?, ?)';",
   "const SQL_MONTH_SEED   = 'INSERT OR REPLACE INTO odds_budget_month (month, used) VALUES (?, ?)';",
   'every isolate re-seeding the month would reset it to the carried KV value, erasing the whole month of D1 charges on each new isolate'],

  [H, 'M5 the correction carries the ceiling',
   "const SQL_FIX_MONTH    = 'UPDATE odds_budget_month SET used = MAX(0, used + ?) WHERE month = ?';",
   "const SQL_FIX_MONTH    = 'UPDATE odds_budget_month SET used = MAX(0, used + ?) WHERE month = ? AND used + ? <= 85000';",
   'a refund refused because the month is capped leaves the ledger permanently above the bill — a correction is not a charge'],

  [H, 'M6 the correction can drive the counter negative',
   "const SQL_FIX_MONTH    = 'UPDATE odds_budget_month SET used = MAX(0, used + ?) WHERE month = ?';",
   "const SQL_FIX_MONTH    = 'UPDATE odds_budget_month SET used = used + ? WHERE month = ?';",
   'a lost race would hand back headroom that was genuinely spent'],

  [H, 'M7 the threshold ladder is dropped in the collapse',
   'const ODDS_THRESHOLDS = [',
   'const _UNUSED_THRESHOLDS = [',
   'index.js and wp-resolver.js each fired these warnings from their own copy; a refactor that quietly loses them is the behaviour change Rule 69 exists for'],

  [H, 'M8 the hard limit goes back to a per-file literal',
   'export const ODDS_HARD_LIMIT = 85000;',
   'const ODDS_HARD_LIMIT = 85000;',
   'four hand-synced copies is how the limit came to be written out four times, each with a comment asking the next person to keep it in step'],

  // ── 2026-10-18: the day and the month in one batch ──────────────────────
  [H, 'M9 the month loses the day predicate',
   '               AND (SELECT used FROM odds_budget WHERE day = ?) + ? <= ?\n',
   '               AND ? IS NOT NULL AND ? IS NOT NULL AND ? IS NOT NULL\n',
   'a day-vetoed call charges the month: the month runs AHEAD of the day, the mirror of the gap this change closes'],

  [H, 'M10 monthCharge runs after charge',
   ORDER, order(['seed', 'monthSeed', 'site', 'charge', 'monthCharge']),
   'the month reads the POST-charge day total, so at the exact boundary the day charges and the month refuses — the month short again'],

  [H, 'M11 the day seed runs after monthCharge',
   ORDER, order(['monthSeed', 'site', 'monthCharge', 'seed', 'charge']),
   'on a fresh day the site and the month compare against NULL and refuse while the day charges — every first call of a day lost from two counters'],

  [H, 'M12 site runs after charge',
   ORDER, order(['seed', 'monthSeed', 'monthCharge', 'charge', 'site']),
   'the site reads the POST-charge total and refuses at the boundary while the day charges — the split falls behind the total'],

  [H, 'M13 the month is read from the last result',
   "results?.[ODDS_CHARGE_ORDER.indexOf('monthCharge')]",
   'results?.[results.length - 1]',
   "the last result is the DAY's charge: the 50/75/90% warnings compare a day's total against 42,500 and never fire, and a month veto reads as a charge"],

  [H, 'M14 the month veto is asked first',
   '        if (!dayCharged) {\n',
   "        if (!monthOut.charged) { await env.FIELD_JOURNALISM.put(`odds:credits:${month}:warned:limit`, new Date().toISOString()); return false; }\n        if (!dayCharged) {\n",
   "monthCharge returns no row on a day veto too, so a day veto is filed as a month veto: the limit key written, the day's key never, ceiling_reached_at null on a day that refused calls"],

  [H, 'M15 a second batch appears in the charger',
   '        const dayCharged = chargedFromBatch(results, ODDS_CHARGE_ORDER);\n',
   '        await db.batch([db.prepare(ODDS_BUDGET_SQL.monthSeed).bind(month, carriedMonth)]);\n        const dayCharged = chargedFromBatch(results, ODDS_CHARGE_ORDER);\n',
   'two batches is two commits, and a stop between them is the 2,766-credit month gap of 2026-10-18'],

  // ── the wiring, which had no mutation at all ─────────────────────────────
  [H, 'M16 the month\'s day predicate is bound with 0 units',
   'bind(units, month, units, ODDS_HARD_LIMIT, date, units, ceiling)',
   'bind(units, month, units, ODDS_HARD_LIMIT, date, 0, ceiling)',
   'one credit below the day boundary the month charges and the day refuses: the month runs ahead of the day on every capped day'],

  [H, 'M17 a day veto whose warned key cannot be written degrades open',
   "                console.warn(`[odds-daily-guard] veto held; warned key not recorded: ${String(e && e.message || e).slice(0, 160)}`);",
   '                throw e;',
   'a KV 429 on the first ceiling hit lets a refused call spend at the vendor, with no counter charged and the month limit unasked'],

  [H, 'M18 a month veto whose limit key cannot be written degrades open',
   "                console.warn(`[odds-month-guard] veto held; limit key not recorded: ${String(e && e.message || e).slice(0, 160)}`);",
   '                throw e;',
   'past 85,000 a KV failure on the limit key lets the call spend anyway'],

  ['index', 'W1 index.js consumeOddsCredit goes back to two calls',
   '  return chargeOdds(env, units, site);\n}',
   '  if (!(await checkAndIncrementDailyOdds(env, units, site))) return false;\n  return chargeMonthlyOdds(env, units);\n}',
   'the day and the month charged by two calls, two batches, with room for a stop between them'],

  ['wp', 'W2 wp-resolver.js drops the site',
   '    return chargeOdds(env, units, site);\n}',
   '    return chargeOdds(env, units);\n}',
   "every wpResolver charge lands in by_site under 'unattributed', and nothing else notices"],

  ['ambient', 'W3 ambient-do.js stops charging',
   '    return chargeOdds(env, units, site);\n}',
   '    return true;\n}',
   'the ambient live poll and the closing-odds capture spend at the vendor and charge no counter at all'],

  // The anchor stops short of the rest of the import list on purpose: naming
  // reconcile's function here would put this file in check-odds-reconciled's
  // population, which it is not part of — it calls nothing.
  ['ambient', 'W4 ambient-do.js imports a removed charger again',
   "import { chargeOdds, oddsCreditCost, ",
   "import { chargeOdds, chargeMonthlyOdds, oddsCreditCost, ",
   'budget-helpers.js no longer exports it: esbuild fails with "No matching export" and the deploy gate passes on the old bundle'],
];

let caught = 0;
for (const [target, name, anchor, repl, why] of MUTATIONS) {
  const original = originals[target];
  const hits = original.split(anchor).length - 1;
  if (hits !== 1) { console.log(`FAIL       ${name}\n            anchor matched ${hits} times in ${TARGETS[target].path}, expected 1 — NOTHING MUTATED.`); continue; }
  const mutated = original.replace(anchor, repl);
  if (mutated === original) { console.log(`FAIL       ${name}\n            file unchanged — NOTHING MUTATED.`); continue; }
  const path = place(target, mutated, 'm');
  if (readFileSync(path, 'utf8') === original) { console.log(`FAIL       ${name}\n            the written copy is identical — NOTHING MUTATED.`); continue; }
  const red = !run({ [TARGETS[target].env]: path });
  console.log(`${red ? 'CAUGHT    ' : 'NOT CAUGHT'} ${name}\n            (${why})`);
  if (red) caught++;
}

console.log(`\n${caught} of ${MUTATIONS.length} mutations caught.`);
console.log('COVERAGE: the five charge statements, their order and the single charger in');
console.log('src/budget-helpers.js, and the three wrappers that delegate to it. It does NOT');
console.log('cover whether D1 supplies a transaction under concurrent isolates.');
process.exit(caught === MUTATIONS.length ? 0 : 1);
