// THE BATCH AND THE HELPER THAT READS IT MUST AGREE ON HOW MANY STATEMENTS
// THERE ARE.
//
// chargeMonthlyOdds built a two-statement batch and handed the results to
// chargedFromBatch, which was hard-coded to three. It threw on every monthly
// charge. The throw is caught by a degrade-open path, so nothing failed loudly:
// the charge landed (db.batch commits before anything reads results), the
// return value was lost, and the caller spent anyway. What that cost was the
// guard — `return false` on the 85,000 hard limit was unreachable, and so were
// the ODDS_THRESHOLDS warnings, so the monthly ceiling could not veto and no
// warning could fire. Measured as `month: odds budget batch returned 2
// result(s), expected 3` in degraded_open.reasons on /budget/odds.
//
// Reading did not catch this for weeks. The two facts are 460 lines apart and
// each is obviously correct on its own — which is the whole shape of the
// defect, and why this check compares them mechanically instead.
//
// Pure `findings(src)`, same convention as check-degrade-open-reason.mjs.
import { readFileSync } from 'node:fs';

const SRC = process.env.BUDGET_HELPERS_SRC || 'src/budget-helpers.js';

/** The statement keys inside a `db.batch([...])` literal, in source order. */
export function batchKeys(block) {
  return [...block.matchAll(/ODDS_BUDGET_SQL\.(\w+)/g)].map((m) => m[1]);
}

/** `['a','b']` out of a declared `export const NAME = ['a', 'b'];`. */
export function declaredOrder(src, name) {
  const m = new RegExp(`export const ${name}\\s*=\\s*\\[([^\\]]*)\\]`).exec(src);
  if (!m) return null;
  return [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
}

export function findings(src) {
  const out = [];

  // Every call EXCEPT the definition. `export function chargedFromBatch(`
  // matches the same shape, so it is excluded by what precedes it.
  const calls = [...src.matchAll(/chargedFromBatch\(([^)]*)\)/g)]
    .filter((m) => !/function\s+$/.test(src.slice(Math.max(0, m.index - 24), m.index)));

  // REFUSE RATHER THAN CHECK A SUBSET. If the call count moves, this file's
  // assumption about where the batches are has moved with it, and a silent
  // pass over the two it still recognises is the failure mode this repo keeps
  // finding (Rule 91).
  if (calls.length !== 2) {
    out.push(`expected 2 calls to chargedFromBatch, found ${calls.length} — a third charge path would be unchecked here`);
    return out;
  }

  for (const m of calls) {
    const args = m[1].split(',').map((s) => s.trim());
    const orderName = args[1] || 'ODDS_BUDGET_ORDER';   // the helper's default
    const order = declaredOrder(src, orderName);
    if (!order) {
      out.push(`${orderName} is passed to chargedFromBatch but not declared as an exported array of statement keys`);
      continue;
    }

    // Walk BACK to the batch whose results this call reads. Forward-scanning
    // from the batch would attach the wrong call when two batches sit in one
    // function, which chargeMonthlyOdds and the reconcile path both do.
    const before = src.slice(0, m.index);
    const at = before.lastIndexOf('db.batch([');
    if (at === -1) {
      out.push(`a chargedFromBatch call at offset ${m.index} has no db.batch([ before it — this check cannot see what it reads`);
      continue;
    }
    const close = src.indexOf(']);', at);
    const keys = batchKeys(src.slice(at, close === -1 ? src.length : close));

    if (keys.length !== order.length) {
      out.push(`batch of ${keys.length} statement(s) [${keys.join(', ')}] is read by chargedFromBatch with ${orderName} of ${order.length} [${order.join(', ')}] — it will throw on every call and degrade open`);
    } else if (keys.join(',') !== order.join(',')) {
      out.push(`batch statements [${keys.join(', ')}] do not match ${orderName} [${order.join(', ')}] — same length, different statements, so the charge may not be last`);
    }
  }
  return out;
}

if (process.argv.includes('--self-test')) {
  let ran = 0, fail = 0;
  const ok = (name, cond, detail = '') => {
    ran++; if (!cond) { fail++; console.log(`  FAIL  ${name}${detail ? `\n          ${detail}` : ''}`); }
    else console.log(`  ok    ${name}`);
  };

  console.log('THE REAL SOURCE, unmutated:');
  const live = readFileSync(SRC, 'utf8');
  ok('no findings against the live source', findings(live).length === 0, JSON.stringify(findings(live)));

  console.log('\nMUTATIONS — each must be CAUGHT:');
  const M = (from, to) => {
    if (!live.includes(from)) return [`MUTATION ANCHOR NOT FOUND: ${from.slice(0, 60)}`];
    if (live.split(from).length - 1 !== 1) return [`MUTATION ANCHOR NOT UNIQUE: ${from.slice(0, 60)}`];
    return findings(live.replace(from, to));
  };

  // THE DEFECT ITSELF, put back.
  ok('M1 the monthly call reverts to the daily order',
     M('chargedFromBatch(results, ODDS_MONTH_ORDER)', 'chargedFromBatch(results)')
       .some((x) => x.includes('throw on every call and degrade open')));

  // The other direction: the batch grows, the order does not.
  ok('M2 a statement added to the monthly batch',
     M('db.prepare(ODDS_BUDGET_SQL.monthCharge).bind(units, month, units, ODDS_HARD_LIMIT),',
       'db.prepare(ODDS_BUDGET_SQL.monthCharge).bind(units, month, units, ODDS_HARD_LIMIT),\n            db.prepare(ODDS_BUDGET_SQL.fixMonth).bind(0, month),')
       .some((x) => x.includes('throw on every call')));

  // The order grows, the batch does not.
  ok('M3 a key added to the declared monthly order',
     M("export const ODDS_MONTH_ORDER = ['monthSeed', 'monthCharge'];",
       "export const ODDS_MONTH_ORDER = ['monthSeed', 'monthCharge', 'fixMonth'];")
       .some((x) => x.includes('throw on every call')));

  // Same length, wrong statements — the charge would not be last.
  ok('M4 the daily order reshuffled so the charge is not last',
     M("export const ODDS_BUDGET_ORDER = ['seed', 'site', 'charge'];",
       "export const ODDS_BUDGET_ORDER = ['seed', 'charge', 'site'];")
       .some((x) => x.includes('do not match')));

  // A third charge path must make this refuse, not quietly check two of three.
  ok('M5 a third chargedFromBatch call refuses rather than checking a subset',
     M('export const ODDS_MONTH_ORDER',
       'function _x(r) { return chargedFromBatch(r); }\nexport const ODDS_MONTH_ORDER')
       .some((x) => x.includes('found 3')));

  // And the declaration going missing must be named, not crash.
  ok('M6 an undeclared order is reported rather than thrown on',
     M("export const ODDS_MONTH_ORDER = ['monthSeed', 'monthCharge'];", '')
       .some((x) => x.includes('not declared as an exported array')));

  console.log(fail ? `\n${fail} FAILED of ${ran}` : `\nself-test: ${ran}/${ran}`);
  console.log(`COVERAGE: ${ran} assertion(s) over ${SRC} — the 2 chargedFromBatch call`);
  console.log(`sites and their batches, as SOURCE. It does NOT execute a batch and it does`);
  console.log(`not see runtime shapes: a D1 call that returns fewer results than it was`);
  console.log(`given statements is a different failure and still reaches the degrade path.`);
  process.exitCode = fail ? 1 : 0;
} else {
  const found = findings(readFileSync(SRC, 'utf8'));
  if (found.length) {
    console.log(`FAIL  ${found.length} finding(s) in ${SRC}:`);
    found.forEach((x) => console.log(`   ${x}`));
    process.exitCode = 1;
  } else {
    console.log(`PASS  both chargedFromBatch call sites agree with their batch's statement count (${SRC})`);
    console.log(`COVERAGE: 2 call site(s), as source. Runtime result-count mismatches are not`);
    console.log(`visible here — those still surface as degraded_open.reasons on /budget/odds.`);
  }
}
