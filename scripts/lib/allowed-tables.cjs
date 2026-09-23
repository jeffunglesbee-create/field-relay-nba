// The /d1/execute allow-list, parsed from src/index.js.
//
// Extracted 2026-09-23 because two gates need it and the module that held it
// has a CLI. check-script-created-tables.mjs imported allowedTables from
// check-odds-budget-schema.mjs, whose body runs `if (process.argv.includes
// ('--self-test'))` — so `check-script-created-tables.mjs --self-test` printed
// the OTHER file's 12/12 and exited before its own assertions ever ran. A
// check reporting a result it did not produce is the exact defect these gates
// exist to prevent, committed inside one of them.
'use strict';

/**
 * @returns {string[]} the table names, or [] when the list cannot be found.
 *
 * COMMENTS ARE STRIPPED FIRST, and that is not tidiness. On 2026-09-23 a
 * comment was added INSIDE the array explaining a new entry, and it contained
 * the word `403'd`. That apostrophe opened a quote that closed on the next
 * one, so the parser returned thirteen real tables and, as a fourteenth,
 * the string:
 *
 *   "d here — the guard working — and spent nothing.\n                "
 *
 * The genuinely new table was never parsed at all, and
 * check-odds-budget-schema.mjs printed "OK: all readable from CI" against that
 * list. A gate that reads a corrupt list and reports OK is worse than no gate,
 * because it is believed.
 */
function allowedTables(src) {
  const m = String(src).match(/const ALLOWED_TABLES = \[([^\]]*)\]/);
  if (!m) return [];
  const body = m[1]
    .replace(/\/\*[\s\S]*?\*\//g, '')   // block comments
    .replace(/\/\/[^\n]*/g, '');          // line comments, apostrophes and all
  return [...body.matchAll(/'([^']+)'/g)].map(x => x[1]);
}

module.exports = { allowedTables };
