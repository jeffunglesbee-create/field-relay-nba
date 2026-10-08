// RECONCILE MUST RECORD WHAT IT DECIDED, AND IT MUST COUNT EVERY CALL ONCE.
//
// reconcileOddsCredit has five outcomes and recorded NONE of them until
// 2026-10-08. Four of the five write no correction at all — no-kv, no-response,
// no-header, bad-header — and `reconciled` with a zero delta returns before the
// correction block too. So "the estimate was handed back" and "the estimate was
// KEPT because the provider sent no receipt" were the same from outside the
// worker, and that is the question 2026-10-07 could not answer: by_site
// getWCPregameLambdas read 2536 against a provider that billed 514.
//
// Two halves, because they fail differently:
//   the ARITHMETIC — creditsKeptBy is pure and is imported and run here
//   the STRUCTURE  — the tally site, the no-read upsert, and array-or-null
//                    reporting live in a Worker and are checked as source
import { readFileSync } from 'node:fs';
import { creditsKeptBy, ODDS_BUDGET_SQL } from '../src/budget-helpers.js';

const SRC = process.env.BUDGET_HELPERS_SRC || 'src/budget-helpers.js';

export function structureFindings(src, sql) {
  const out = [];

  // ONE TALLY SITE. reconcileOddsCredit returns from six places; a tally added
  // before each `return out` is five chances to miss one, and a state that
  // never appears reads exactly like a state that never happened (Rule 99).
  if (!/export async function reconcileOddsCredit\([^)]*\)\s*\{\s*\n\s*const out = await _reconcileOddsCredit\(/.test(src)) {
    out.push('reconcileOddsCredit is not a wrapper around _reconcileOddsCredit — the tally is no longer structural');
  }
  if (!/async function _reconcileOddsCredit\(/.test(src)) {
    out.push('_reconcileOddsCredit is gone — the inner function the wrapper counts for');
  }
  const tallyCalls = (src.match(/ODDS_BUDGET_SQL\.reconcileTally/g) || []).length;
  if (tallyCalls !== 1) out.push(`the tally statement is used ${tallyCalls} time(s) in the source; exactly 1 keeps it to one site`);

  // The signature all nine external call sites pass.
  if (!/export async function reconcileOddsCredit\(env, estimated, resp, site = ''\)/.test(src)) {
    out.push("the exported signature changed — nine call sites pass (env, estimated, resp, site)");
  }

  // NO READ. The daily and monthly counters were both moved out of KV
  // read-modify-write because concurrent isolates lose counts; a tally that
  // read-then-wrote would reintroduce exactly that, one table over.
  if (/SELECT/i.test(sql)) out.push('the tally statement contains a SELECT — it must be a single upsert with no read');
  if (!/ON CONFLICT\(day, site, state, cache\) DO UPDATE/.test(sql)) {
    out.push('the tally statement has no ON CONFLICT(day, site, state, cache) DO UPDATE — concurrent isolates would lose counts');
  }
  if (!/n = n \+ 1/.test(sql)) out.push('the tally does not increment n');
  if (!/credits_kept = credits_kept \+ \?/.test(sql)) out.push('the tally does not accumulate credits_kept');

  // ARRAY OR NULL, NEVER []. Same rule degraded_open follows: "no decisions
  // today" and "the tally could not be read" are different answers, and an
  // empty array reads as the first.
  // Sliced to the END of the try/catch, not the first dedented brace: the lazy
  // match stopped at the inner `if` block's closing brace and cut the catch off,
  // so the catch assertion below failed against source that was correct. Found
  // by the unmutated positive control, which is what it is for.
  const read = src.match(/let reconcile = null;[\s\S]{0,900}?reconcile = null;\n        \}/);
  if (!read) out.push('no `let reconcile = null` read found in peekDailyOdds');
  else {
    if (!/Array\.isArray\(r && r\.results\) \? r\.results : null/.test(read[0])) {
      out.push('the reconcile read does not fall back to null — an unreadable tally must not report []');
    }
    if (!/catch \(_\) \{\s*\n\s*reconcile = null;/.test(read[0])) {
      out.push('the reconcile read does not set null in its catch');
    }
  }
  if (!/\n            reconcile,/.test(src)) out.push('reconcile is not on the /budget/odds response');

  // The table must be declared where the schema gate reads the DDL from.
  if (!/CREATE TABLE IF NOT EXISTS odds_reconcile_state/.test(src)) {
    out.push('odds_reconcile_state is not created in ensureOddsBudgetTables — the schema gate reads the DDL from there');
  }
  return out;
}

if (process.argv.includes('--self-test')) {
  let pass = 0, fail = 0, ran = 0;
  const ok = (label, cond, detail = '') => { ran++; cond ? (pass++, console.log(`  PASS  ${label}`))
    : (fail++, console.log(`  FAIL  ${label}${detail ? ' — ' + detail : ''}`)); };

  console.log('THE ARITHMETIC — creditsKeptBy, imported and run:');
  ok('a cache hit keeps nothing', creditsKeptBy('cache-hit', 4, null) === 0);
  ok('a receipt keeps what the provider billed', creditsKeptBy('reconciled', 4, 1) === 1);
  ok('a receipt of 0 keeps 0, not the estimate', creditsKeptBy('reconciled', 4, 0) === 0,
     'the 2026-09-05 case: /wc/odds-probs billed 0 against charged 4');
  ok('`reconciled` with no number keeps the estimate', creditsKeptBy('reconciled', 4, null) === 4,
     'a missing actual is not a zero bill (Rule 99)');
  for (const st of ['no-header', 'bad-header', 'no-response', 'no-kv', 'error', 'unresolved']) {
    ok(`${st} keeps the whole estimate`, creditsKeptBy(st, 4, null) === 4);
  }
  ok('an unknown future state keeps the estimate, the safe direction',
     creditsKeptBy('something-new', 4, null) === 4,
     'a new outcome must not silently report nothing kept');

  console.log('\nTHE STRUCTURE — the real source, unmutated:');
  const live = readFileSync(SRC, 'utf8');
  const f = structureFindings(live, ODDS_BUDGET_SQL.reconcileTally);
  ok('no findings against the live source', f.length === 0, JSON.stringify(f));

  console.log('\nMUTATIONS — each must be CAUGHT:');
  const M = (from, to, sql = ODDS_BUDGET_SQL.reconcileTally) =>
    structureFindings(live.replace(from, to), sql);
  ok('M1 the wrapper collapsed back into one function',
     M('const out = await _reconcileOddsCredit(', 'const out = ({}) || (').some((x) => x.includes('no longer structural')));
  ok('M2 a second tally site',
     M('console.warn(`[odds-reconcile-tally]', 'ODDS_BUDGET_SQL.reconcileTally; console.warn(`[odds-reconcile-tally]')
       .some((x) => x.includes('used 2 time(s)')));
  ok('M3 the upsert turned into a read-then-write',
     M('x', 'x', 'SELECT n FROM odds_reconcile_state WHERE day = ?').some((x) => x.includes('contains a SELECT')));
  ok('M4 ON CONFLICT dropped — concurrent isolates lose counts',
     M('x', 'x', 'INSERT INTO odds_reconcile_state (day) VALUES (?)').some((x) => x.includes('no ON CONFLICT')));
  ok('M5 the null fallback turned into []',
     M('Array.isArray(r && r.results) ? r.results : null', 'Array.isArray(r && r.results) ? r.results : []')
       .some((x) => x.includes('must not report []')));
  ok('M6 reconcile dropped from the response',
     M('\n            reconcile,', '\n').some((x) => x.includes('not on the /budget/odds response')));
  // The mutant renames the table to one ALREADY ALLOW-LISTED, deliberately.
  // The first version used `odds_reconcile_other`, and
  // check-script-created-tables.mjs scans scripts/ for every
  // `CREATE TABLE IF NOT EXISTS <name>` literal — so this fixture registered as
  // a sixth script-created table missing from ALLOWED_TABLES and failed that
  // gate. A mutation fixture that another gate reads as real source is a
  // defect in the fixture, not in the gate.
  ok('M7 the table no longer created',
     M('CREATE TABLE IF NOT EXISTS odds_reconcile_state', 'CREATE TABLE IF NOT EXISTS odds_budget_site')
       .some((x) => x.includes('not created in ensureOddsBudgetTables')));
  ok('M8 the exported signature changed',
     M("export async function reconcileOddsCredit(env, estimated, resp, site = '')",
       'export async function reconcileOddsCredit(env, opts)').some((x) => x.includes('signature changed')));

  console.log(fail ? `\n${fail} FAILED of ${ran}` : `\nself-test: ${ran}/${ran}`);
  console.log(`COVERAGE: ${ran} assertion(s) — creditsKeptBy RUN over every state it`);
  console.log(`names plus an unknown one, and the structure checked as source against`);
  console.log(`the live file with eight mutations. It does NOT connect to D1, so it`);
  console.log(`cannot say the table exists; /budget/odds reconcile is where that shows.`);
  process.exit(fail ? 1 : 0);
}

const found = structureFindings(readFileSync(SRC, 'utf8'), ODDS_BUDGET_SQL.reconcileTally);
if (found.length) {
  console.log(`FAIL  ${found.length} finding(s) in ${SRC}:`);
  found.forEach((x) => console.log(`   ${x}`));
  process.exit(1);
}
console.log(`PASS  reconcile counts every call once, with no read, and reports array-or-null (${SRC})`);
console.log(`COVERAGE: source and the pure arithmetic. The tally's live rows appear as`);
console.log(`\`reconcile\` on /budget/odds, which is where a kept estimate becomes visible.`);
