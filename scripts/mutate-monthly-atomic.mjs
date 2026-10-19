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

// THE WRAPPER IS REPLACED WHOLE, NOT EDITED AT A LINE. These mutants first
// anchored on the exact line `return chargeOdds(env, units, site);`, so with
// this harness in deploy.yml a correct rewrite of a wrapper matched 0 anchors
// and blocked the deploy. A shape regex fixed that only for the spellings it
// knew. FN instead swaps the whole function, found by name exactly as the
// check finds it, for a body written here; the original signature line is
// kept. So no spelling of the current body can make a case go NOTHING MUTATED.
const FN = Symbol('the whole wrapper');
const WRAPPER_NAME = { index: 'consumeOddsCredit', wp: 'consumeOddsCredit', ambient: '_consumeAmbientOddsCredit' };
const KV_GUARD = 'if (!env || !env.FIELD_JOURNALISM) return true;';
function applyEdit(target, original, anchor, repl) {
  if (anchor === FN) {
    const i = original.indexOf(`async function ${WRAPPER_NAME[target]}(`);
    const j = i < 0 ? -1 : original.indexOf('\n}\n', i);
    if (i < 0 || j < 0) return { error: `${WRAPPER_NAME[target]} was not found — NOTHING MUTATED` };
    const sig = original.slice(i, original.indexOf('\n', i));
    const body = repl.map((l) => `    ${l}`).join('\n');
    return { text: `${original.slice(0, i)}${sig}\n${body}\n}${original.slice(j + 2)}` };
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
   FN, [KV_GUARD, 'if (!(await checkAndIncrementDailyOdds(env, units, site))) return false;', 'return chargeMonthlyOdds(env, units);'],
   'the day and the month charged by two calls, two batches, with room for a stop between them'],

  ['wp', 'W2 wp-resolver.js drops the site',
   FN, [KV_GUARD, 'return chargeOdds(env, units);'],
   "every wpResolver charge lands in by_site under 'unattributed', and nothing else notices"],

  // The verdict computed, then dropped: the charge lands but a refusal no
  // longer stops the call. Measured end to end on 2026-10-18: with the day at
  // its ceiling, a refused call reached the vendor with no counter moved.
  ['index', 'W5 index.js computes the verdict, then returns true',
   FN, [KV_GUARD, 'const charged = await chargeOdds(env, units, site);', 'return true;'],
   'every refusal from the 3,800 ceiling or the 85,000 limit is ignored: refused calls spend at the vendor'],

  ['wp', 'W6 wp-resolver.js keeps the return only in a comment',
   FN, [KV_GUARD, '// return chargeOdds(env, units, site);', 'await chargeOdds(env, units, site);', 'return true;'],
   'a commented-out return reads as delegation to a text match, and the verdict is dropped'],

  ['ambient', 'W3 ambient-do.js stops charging',
   FN, [KV_GUARD, 'return true;'],
   'the ambient live poll and the closing-odds capture spend at the vendor and charge no counter at all'],

  // From the 2026-10-19 review: each drops the verdict and each passed all 22
  // odds steps of deploy.yml while the check read the wrapper as text.
  ['ambient', 'X1 ambient-do.js returns early whenever KV is bound (one `!` deleted)',
   FN, ['if (!env || env.FIELD_JOURNALISM) return true;', 'return chargeOdds(env, units, site);'],
   'FIELD_JOURNALISM is bound in production, so every odds call returns true and charges nothing'],

  ['index', 'X2 index.js names the verdict, then overwrites it',
   FN, [KV_GUARD, 'let x = await chargeOdds(env, units, site);', 'x = true;', 'return x;'],
   'the charge lands, the refusal is overwritten, and the refused call spends'],

  ['wp', 'X3 wp-resolver.js logs a refusal and allows the call',
   FN, [KV_GUARD, 'const charged = await chargeOdds(env, units, site);', "if (!charged) { console.warn('[odds] veto ignored', site); return true; }", 'return charged;'],
   'a plausible log-and-allow edit: every refusal is logged and ignored'],

  ['ambient', 'X5 ambient-do.js returns true above the delegation',
   FN, [KV_GUARD, 'return true;', 'return chargeOdds(env, units, site);'],
   'the delegation is still in the text and never runs'],

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
   FN, [KV_GUARD, 'const charged = await chargeOdds(env, units, site);', 'return charged;']],
  ['wp', 'E2 wp-resolver.js awaits in the return',
   FN, [KV_GUARD, 'return await chargeOdds(env, units, site);']],
  ['ambient', 'E3 ambient-do.js names the verdict with let, then returns it',
   FN, [KV_GUARD, 'let ok = await chargeOdds(env, units, site);', 'return ok;']],
  ['index', 'E4 index.js tests the verdict and returns booleans',
   FN, [KV_GUARD, 'if (!(await chargeOdds(env, units, site))) return false;', 'return true;']],
  ['wp', 'E5 wp-resolver.js returns the promise from a const',
   FN, [KV_GUARD, 'const v = chargeOdds(env, units, site);', 'return v;']],
  ['ambient', 'E6 ambient-do.js with no semicolon (ASI)',
   FN, [KV_GUARD, 'return chargeOdds(env, units, site)']],
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
