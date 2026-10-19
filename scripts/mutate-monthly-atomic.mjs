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

// THE WRAPPER'S DELEGATION, FOUND BY SHAPE, NOT BY TEXT. These mutants used to
// anchor on the exact line `return chargeOdds(env, units, site);`. Once this
// harness ran in deploy.yml, a correct rewrite of a wrapper (`const charged =
// await chargeOdds(...); return charged;`) matched 0 anchors, reported NOTHING
// MUTATED, and blocked the deploy on correct code: measured 2026-10-19 by
// scripts/mutate-deploy-odds-wrappers.mjs. DELEG resolves to whichever
// accepted spelling the wrapper uses, and must find exactly one.
const DELEG = Symbol('the wrapper delegation');
const WRAPPER_NAME = { index: 'consumeOddsCredit', wp: 'consumeOddsCredit', ambient: '_consumeAmbientOddsCredit' };
function delegationSpan(target, text) {
  const i = text.indexOf(`async function ${WRAPPER_NAME[target]}(`);
  const j = i < 0 ? -1 : text.indexOf('\n}\n', i);
  if (i < 0 || j < 0) return { error: `${WRAPPER_NAME[target]} was not found` };
  const body = text.slice(i, j + 1);
  const forms = [
    /^([ \t]*)return\s+(?:await\s+)?chargeOdds\(\s*env\s*,\s*units\s*,\s*site\s*\)\s*;[^\n]*\n/gm,
    /^([ \t]*)(?:const|let)\s+([A-Za-z_$][\w$]*)\s*=\s*await\s+chargeOdds\(\s*env\s*,\s*units\s*,\s*site\s*\)\s*;[^\n]*\n(?:[^\n]*\n)*?\1return\s+\2\s*;[^\n]*\n/gm,
  ];
  const hits = forms.flatMap((re) => [...body.matchAll(re)]);
  if (hits.length !== 1) return { error: `found ${hits.length} delegation statement(s) in ${WRAPPER_NAME[target]}, expected 1` };
  const h = hits[0];
  return { start: i + h.index, end: i + h.index + h[0].length, indent: h[1] };
}
function applyEdit(target, original, anchor, repl) {
  if (anchor === DELEG) {
    const s = delegationSpan(target, original);
    if (s.error) return { error: `${s.error} — NOTHING MUTATED` };
    return { text: original.slice(0, s.start) + repl(s.indent) + original.slice(s.end) };
  }
  const hits = original.split(anchor).length - 1;
  if (hits !== 1) return { error: `anchor matched ${hits} times in ${TARGETS[target].path}, expected 1 — NOTHING MUTATED` };
  return { text: original.replace(anchor, repl) };
}

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

  [H, 'M19 the site\'s day predicate is bound with a literal 3',
   'bind(date, site, units, date, units, ceiling)',
   'bind(date, site, units, date, 3, ceiling)',
   'a 30-credit historical call is admitted to by_site on a day it overflows: the split runs ahead of the total'],

  [H, 'M20 the month\'s day predicate is bound with a literal 3',
   'bind(units, month, units, ODDS_HARD_LIMIT, date, units, ceiling)',
   'bind(units, month, units, ODDS_HARD_LIMIT, date, 3, ceiling)',
   'a 30-credit call charges the month on a day the day refuses it'],

  // The return value stays false, so a return-value check passes it. What
  // changes is that a day-veto KV error falls through into the month block,
  // which files the month's hard limit at 1,000 and burns its 60-day key.
  [H, 'M21 a day veto whose KV fails falls through to the month block',
   "                        { expirationTtl: 86400 });\n                }\n            } catch (e) {\n                // A day veto whose warning cannot be recorded is still a veto.\n                // Falling to the outer catch would degrade open with no counter\n                // charged and the month limit never asked.\n                console.warn(`[odds-daily-guard] veto held; warned key not recorded: ${_vetoErrText(e)}`);\n            }\n            return false;\n        }",
   "                        { expirationTtl: 86400 });\n                }\n                return false;\n            } catch (e) {\n                // A day veto whose warning cannot be recorded is still a veto.\n                // Falling to the outer catch would degrade open with no counter\n                // charged and the month limit never asked.\n                console.warn(`[odds-daily-guard] veto held; warned key not recorded: ${_vetoErrText(e)}`);\n            }\n        }",
   'the month hard-limit key is written on a day veto, so when the month really reaches 85,000 no HARD LIMIT warning fires'],

  [H, 'M17 a day veto whose warned key cannot be written degrades open',
   "                console.warn(`[odds-daily-guard] veto held; warned key not recorded: ${_vetoErrText(e)}`);",
   '                throw e;',
   'a KV 429 on the first ceiling hit lets a refused call spend at the vendor, with no counter charged and the month limit unasked'],

  [H, 'M18 a month veto whose limit key cannot be written degrades open',
   "                console.warn(`[odds-month-guard] veto held; limit key not recorded: ${_vetoErrText(e)}`);",
   '                throw e;',
   'past 85,000 a KV failure on the limit key lets the call spend anyway'],

  [H, 'M22 the veto warning\'s formatter can throw',
   "    try { return String(e && e.message || e).slice(0, 160); } catch (_) { return '(unprintable rejection)'; }",
   "    return String(e && e.message || e).slice(0, 160);",
   'a rejection String() cannot convert throws out of the veto catch into the outer one, which degrades open and lets the refused call spend'],

  ['index', 'W1 index.js consumeOddsCredit goes back to two calls',
   DELEG,
   (i) => `${i}if (!(await checkAndIncrementDailyOdds(env, units, site))) return false;\n${i}return chargeMonthlyOdds(env, units);\n`,
   'the day and the month charged by two calls, two batches, with room for a stop between them'],

  ['wp', 'W2 wp-resolver.js drops the site',
   DELEG,
   (i) => `${i}return chargeOdds(env, units);\n`,
   "every wpResolver charge lands in by_site under 'unattributed', and nothing else notices"],

  // The verdict computed, then dropped: the charge lands but a refusal no
  // longer stops the call. Measured end to end on 2026-10-18: with the day at
  // its ceiling, a refused call reached the vendor with no counter moved.
  ['index', 'W5 index.js computes the verdict, then returns true',
   DELEG,
   (i) => `${i}const charged = await chargeOdds(env, units, site);\n${i}return true;\n`,
   'every refusal from the 3,800 ceiling or the 85,000 limit is ignored: refused calls spend at the vendor'],

  ['wp', 'W6 wp-resolver.js keeps the return only in a comment',
   DELEG,
   (i) => `${i}// return chargeOdds(env, units, site);\n${i}await chargeOdds(env, units, site);\n${i}return true;\n`,
   'a commented-out return reads as delegation to a text match, and the verdict is dropped'],

  ['ambient', 'W3 ambient-do.js stops charging',
   DELEG,
   (i) => `${i}return true;\n`,
   'the ambient live poll and the closing-odds capture spend at the vendor and charge no counter at all'],

  // The anchor stops short of the rest of the import list on purpose: naming
  // reconcile's function here would put this file in check-odds-reconciled's
  // population, which it is not part of — it calls nothing.
  ['ambient', 'W4 ambient-do.js imports a removed charger again',
   "import { chargeOdds, oddsCreditCost, ",
   "import { chargeOdds, chargeMonthlyOdds, oddsCreditCost, ",
   'budget-helpers.js no longer exports it: esbuild fails with "No matching export" and the deploy gate passes on the old bundle'],
];

// EQUIVALENTS: the same behaviour, spelled differently. Each must leave the
// check GREEN, or wiring it into deploy.yml blocks a deploy on correct code.
const EQUIVALENTS = [
  ['index', 'E1 index.js names the verdict, then returns it',
   DELEG, (i) => `${i}const charged = await chargeOdds(env, units, site);\n${i}return charged;\n`],
  ['wp', 'E2 wp-resolver.js awaits in the return',
   DELEG, (i) => `${i}return await chargeOdds(env, units, site);\n`],
  ['ambient', 'E3 ambient-do.js names the verdict with let, then returns it',
   DELEG, (i) => `${i}let ok = await chargeOdds(env, units, site);\n${i}return ok;\n`],
];
let equivalentFails = 0;
for (const [target, name, anchor, repl] of EQUIVALENTS) {
  const e = applyEdit(target, originals[target], anchor, repl);
  if (e.error) { console.log(`FAIL       ${name}\n            ${e.error}`); equivalentFails++; continue; }
  const green = run({ [TARGETS[target].env]: place(target, e.text, 'eq') });
  console.log(`${green ? 'GREEN     ' : 'RED (BAD) '} ${name}`);
  if (!green) equivalentFails++;
}
console.log('');

let caught = 0;
for (const [target, name, anchor, repl, why] of MUTATIONS) {
  const original = originals[target];
  const e = applyEdit(target, original, anchor, repl);
  if (e.error) { console.log(`FAIL       ${name}\n            ${e.error}`); continue; }
  const mutated = e.text;
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
console.log(`${EQUIVALENTS.length - equivalentFails} of ${EQUIVALENTS.length} equivalent rewrites stayed green.`);
process.exit(caught === MUTATIONS.length && equivalentFails === 0 ? 0 : 1);
