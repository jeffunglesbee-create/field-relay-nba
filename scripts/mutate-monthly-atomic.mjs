// Rule 90 for scripts/check-monthly-atomic.mjs.
//
// This guards an 85,000-credit monthly limit on a metered account. Both ways of
// being wrong cost real money: a ceiling that fails open spends past the cap,
// and a seed that starts from zero hands the month a SECOND full ceiling. Every
// mutation below restores a state that would do one of those.
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, resolve, dirname } from 'node:path';

const SRC = 'src/budget-helpers.js';
const original = readFileSync(SRC, 'utf8');
const DIR = dirname(SRC);
const born = [];
const place = (text, tag) => {
  const p = join(DIR, `.mutant-${tag}-${Math.random().toString(36).slice(2, 8)}.js`);
  writeFileSync(p, text); born.push(p); return resolve(p);
};
process.on('exit', () => { for (const p of born) { try { unlinkSync(p); } catch (_e) {} } });

const run = (path) => {
  try {
    execFileSync(process.execPath, ['scripts/check-monthly-atomic.mjs'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, BUDGET_HELPERS_SRC: path } });
    return true;
  } catch { return false; }
};

if (!run(resolve(SRC))) { console.log('FAIL — the check is already red on clean source.'); process.exit(1); }
if (!run(place(original, 'control'))) {
  console.log('FAIL — an UNMUTATED copy at the mutant location is red, so no verdict below would mean anything.');
  process.exit(1);
}
console.log('baseline: the check passes on current source and on an unmutated copy at the mutant location\n');

const MUTATIONS = [
  ['M1 the ceiling leaves the charge statement',
   "const SQL_MONTH_CHARGE = `UPDATE odds_budget_month SET used = used + ?\n             WHERE month = ? AND used + ? <= ?\n            RETURNING used`;",
   "const SQL_MONTH_CHARGE = `UPDATE odds_budget_month SET used = used + ?\n             WHERE month = ?\n            RETURNING used`;",
   'THE 85,000 LIMIT STOPS BINDING. Every charge returns a row, so nothing is ever vetoed and the month spends past the cap on a metered account'],

  ['M2 the ceiling becomes a strict inequality',
   '             WHERE month = ? AND used + ? <= ?',
   '             WHERE month = ? AND used + ? < ?',
   'a charge landing exactly ON the ceiling is refused, so the last legitimate credits of every month are unspendable'],

  ['M3 the seed starts the month at zero',
   'const SQL_MONTH_SEED   = \'INSERT OR IGNORE INTO odds_budget_month (month, used) VALUES (?, ?)\';',
   'const SQL_MONTH_SEED   = \'INSERT OR IGNORE INTO odds_budget_month (month, used) VALUES (?, 0)\';',
   'THE FINANCIALLY DANGEROUS ONE: odds:credits:2026-09 stood near 60,948 of 85,000 at cutover, and a fresh row at 0 hands the month a SECOND full ceiling before the hard limit binds again'],

  ['M4 the seed stops being idempotent',
   "const SQL_MONTH_SEED   = 'INSERT OR IGNORE INTO odds_budget_month (month, used) VALUES (?, ?)';",
   "const SQL_MONTH_SEED   = 'INSERT OR REPLACE INTO odds_budget_month (month, used) VALUES (?, ?)';",
   'every isolate re-seeding the month would reset it to the carried KV value, erasing the whole month of D1 charges on each new isolate'],

  ['M5 the correction carries the ceiling',
   "const SQL_FIX_MONTH    = 'UPDATE odds_budget_month SET used = MAX(0, used + ?) WHERE month = ?';",
   "const SQL_FIX_MONTH    = 'UPDATE odds_budget_month SET used = MAX(0, used + ?) WHERE month = ? AND used + ? <= 85000';",
   'a refund refused because the month is capped leaves the ledger permanently above the bill — a correction is not a charge'],

  ['M6 the correction can drive the counter negative',
   "const SQL_FIX_MONTH    = 'UPDATE odds_budget_month SET used = MAX(0, used + ?) WHERE month = ?';",
   "const SQL_FIX_MONTH    = 'UPDATE odds_budget_month SET used = used + ? WHERE month = ?';",
   'a lost race would hand back headroom that was genuinely spent'],

  ['M7 the threshold ladder is dropped in the collapse',
   'const ODDS_THRESHOLDS = [',
   'const _UNUSED_THRESHOLDS = [',
   'index.js and wp-resolver.js each fired these warnings from their own copy; a refactor that quietly loses them is the behaviour change Rule 69 exists for'],

  ['M8 the hard limit goes back to a per-file literal',
   'export const ODDS_HARD_LIMIT = 85000;',
   'const ODDS_HARD_LIMIT = 85000;',
   'four hand-synced copies is how the limit came to be written out four times, each with a comment asking the next person to keep it in step'],
];

let caught = 0;
for (const [name, anchor, repl, why] of MUTATIONS) {
  const hits = original.split(anchor).length - 1;
  if (hits !== 1) { console.log(`FAIL       ${name}\n            anchor matched ${hits} times, expected 1 — NOTHING MUTATED.`); continue; }
  const mutated = original.replace(anchor, repl);
  if (mutated === original) { console.log(`FAIL       ${name}\n            file unchanged — NOTHING MUTATED.`); continue; }
  const path = place(mutated, 'm');
  if (readFileSync(path, 'utf8') === original) { console.log(`FAIL       ${name}\n            the written copy is identical — NOTHING MUTATED.`); continue; }
  const red = !run(path);
  console.log(`${red ? 'CAUGHT    ' : 'NOT CAUGHT'} ${name}\n            (${why})`);
  if (red) caught++;
}

console.log(`\n${caught} of ${MUTATIONS.length} mutations caught.`);
console.log('COVERAGE: the month statements and the single charger in src/budget-helpers.js.');
console.log('It does NOT cover whether D1 supplies a transaction under concurrent isolates.');
process.exit(caught === MUTATIONS.length ? 0 : 1);
