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
// ONE CALL SITE SINCE 2026-10-18. The day, the site and the month are one
// five-statement batch in chargeOdds
// (docs/CC-CMD-2026-10-18-odds-charge-survives-cancellation.md), so there is one
// chargedFromBatch call, and two new ways to read the wrong statement that a
// length comparison cannot see:
//   - the batch and its order reshuffled TOGETHER, so they still agree, with
//     `charge` no longer last — chargedFromBatch reads the last statement as
//     the day's verdict;
//   - the month's verdict read from the LAST result, which is now the DAY's
//     charge. The month's 50/75/90% ladder would then compare a day's total
//     against cutoffs from 42,500 up and never fire.
//
// NINE STATEMENTS SINCE 2026-10-28 (Task 3 of
// docs/CC-CMD-2026-09-16-odds-spend-attribution.md, then its refusal record): seed,
// monthSeed, siteSeed, snapshot, GATE, refusal, siteCharge, monthCharge, charge. The
// refusal's own position is asserted in check-odds-budget-batch.mjs. The gate decides over the
// PRE-charge totals and the three charges obey it, so the one thing no single
// statement shows is that the snapshot and the gate run BEFORE every charge. A
// charge moved ahead of the gate changes the totals the gate reads, and the batch
// then disagrees with the model only on the boundary. Checked below, and by
// scripts/check-odds-site-caps.mjs by running it.
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

/** The order chargedFromBatch falls back to, read from its own signature. It
 *  was a literal 'ODDS_BUDGET_ORDER' here, which is right only for as long as
 *  nobody changes the helper's default — a copy of the source, not the source. */
export function helperDefault(src) {
  const m = /export function chargedFromBatch\(results, order = (\w+)\)/.exec(src);
  return m ? m[1] : null;
}

export function findings(src) {
  const out = [];

  // Every call EXCEPT the definition. `export function chargedFromBatch(`
  // matches the same shape, so it is excluded by what precedes it.
  const calls = [...src.matchAll(/chargedFromBatch\(([^)]*)\)/g)]
    .filter((m) => !/function\s+$/.test(src.slice(Math.max(0, m.index - 24), m.index)));

  // REFUSE RATHER THAN CHECK A SUBSET. If the call count moves, this file's
  // assumption about where the batch is has moved with it, and a silent pass
  // over the one it still recognises is the failure mode this repo keeps
  // finding (Rule 91).
  if (calls.length !== 1) {
    out.push(`expected 1 call to chargedFromBatch, found ${calls.length} — a second charge path would be unchecked here`);
    return out;
  }

  const fallback = helperDefault(src);
  if (!fallback) {
    out.push("chargedFromBatch's default order could not be read from its signature — a call that omits the order would be checked against a guess");
    return out;
  }

  for (const m of calls) {
    const args = m[1].split(',').map((s) => s.trim());
    const orderName = args[1] || fallback;   // the helper's REAL default
    const order = declaredOrder(src, orderName);
    if (!order) {
      out.push(`${orderName} is passed to chargedFromBatch but not declared as an exported array of statement keys`);
      continue;
    }

    // Walk BACK to the batch whose results this call reads. Forward-scanning
    // from the batch would attach the wrong call when two batches sit in one
    // function, which the reconcile path does.
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

    // THE SNAPSHOT AND THE GATE RUN BEFORE EVERY CHARGE. The gate compares each
    // limit with the PRE-charge total; a charge that ran first would change what
    // the gate reads, and the snapshot, which names the refusing limit from the
    // same totals, would read them moved. That is the hard rule. That the snapshot
    // precedes the gate is a CONVENTION (reads before the first write): the gate
    // writes only its own row, so a snapshot after it would still read unmoved
    // counters. It is enforced because it is the order the reasoning was done in,
    // not because the reverse is known to misbehave.
    {
      const at = (k) => order.indexOf(k);
      const firstCharge = Math.min(...['siteCharge', 'monthCharge', 'charge'].map(at).map((i) => (i === -1 ? Infinity : i)));
      if (at('snapshot') === -1 || at('gate') === -1 || !(at('snapshot') < at('gate') && at('gate') < firstCharge)) {
        out.push(`${orderName} [${order.join(', ')}] must run snapshot, then gate, before siteCharge, monthCharge and charge — the gate decides over the PRE-charge totals`);
      }
    }

    // THE CHARGE MUST BE LAST, asserted on its own. The comparison above passes
    // when the batch and the order are reshuffled the same way.
    if (order.at(-1) !== 'charge' || keys.at(-1) !== 'charge') {
      out.push(`charge must be last: ${orderName} ends in '${order.at(-1)}' and the batch in '${keys.at(-1)}' — chargedFromBatch reads the LAST statement as the day's verdict`);
    }

    // THE MONTH IS READ BY NAME. A month verdict taken from the last result
    // reads the DAY's charge, and the threshold ladder silently stops firing.
    const fnStart = src.lastIndexOf('\nasync function ', m.index);
    const fnEnd = src.indexOf('\n}\n', m.index);
    const charger = src.slice(fnStart < 0 ? 0 : fnStart, fnEnd < 0 ? src.length : fnEnd);
    const mi = src.indexOf('function _monthFromBatch(');
    const mj = mi < 0 ? -1 : src.indexOf('\n}\n', mi);
    if (mi < 0 || mj < 0) {
      out.push("_monthFromBatch was not found — the month verdict's read cannot be checked");
    } else {
      // CODE ONLY, AND THE WHOLE INDEX. A substring test passed with the name
      // left in a comment and with `indexOf('monthCharge') + 1` -- both read
      // the DAY's charge. So:
      // - the parameter is read from the signature, not assumed to be `results`;
      // - the lookup must be exactly `[ORDER.indexOf('monthCharge')]` or
      //   `.at(ORDER.indexOf('monthCharge'))`, in any quote style;
      // - and the parameter may appear exactly twice, the signature and that
      //   lookup. `.slice(-1)[0]`, `[...p].pop()` and `.findLast()` read the last
      //   row without `[` or `.at(`, so every use is counted, with quoted strings
      //   blanked. An extra harmless use, an `Array.isArray(p)` guard, also fails:
      //   fail closed. A lookup hoisted into a local fails too, deliberately.
      const reader = src.slice(mi, mj).replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
      const param = (/^function _monthFromBatch\(\s*([\w$]+)/.exec(reader) || [])[1] || 'results';
      const p = param.replace(/\$/g, '\\$');
      // `g` is the backreference number of the quote group in its alternative.
      const lookup = (g) => `${orderName}\\.indexOf\\(\\s*(['"\`])monthCharge\\${g}\\s*\\)`;
      const byName = new RegExp(`(?<![.\\w$])${p}\\s*(?:(?:\\?\\.)?\\s*\\[\\s*${lookup(1)}\\s*\\]|\\??\\.\\s*at\\s*\\(\\s*${lookup(2)}\\s*\\))`);
      const code = reader.replace(/'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"/g, "''");
      const uses = code.match(new RegExp(`(?<![\\w$])(?<![^.]\\.)${p}(?![\\w$])`, 'g')) || [];
      if (!order.includes('monthCharge')) {
        out.push(`${orderName} has no 'monthCharge' -- the month verdict's lookup would be -1, the DAY's charge`);
      }
      if (!byName.test(reader) || uses.length !== 2) {
        out.push(`the month verdict is not read at ${orderName}.indexOf('monthCharge') — a read from the last result is the DAY's charge, and the month's 50/75/90% warnings would never fire (_monthFromBatch uses '${param}' ${uses.length} time(s); exactly 2 are allowed, the signature and the by-name read)`);
      }
      if (!/_monthFromBatch\(results\)/.test(charger)) {
        out.push('the charger does not read its month verdict through _monthFromBatch(results) — the month read is unchecked');
      }
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
  // Each [from, to] pair must match exactly once and change the text, or the
  // mutation reports itself as NOT APPLIED rather than as a verdict.
  const M = (...pairs) => {
    let text = live;
    for (const [from, to] of pairs) {
      if (!text.includes(from)) return [`MUTATION ANCHOR NOT FOUND: ${from.slice(0, 60)}`];
      if (text.split(from).length - 1 !== 1) return [`MUTATION ANCHOR NOT UNIQUE: ${from.slice(0, 60)}`];
      const next = text.replace(from, to);
      if (next === text) return [`MUTATION NOT APPLIED: ${from.slice(0, 60)}`];
      text = next;
    }
    return findings(text);
  };
  const ORDER = "export const ODDS_CHARGE_ORDER = ['seed', 'monthSeed', 'siteSeed', 'snapshot', 'gate', 'refusal', 'siteCharge', 'monthCharge', 'charge'];";
  const order = (...keys) => `export const ODDS_CHARGE_ORDER = [${keys.map((k) => `'${k}'`).join(', ')}];`;
  const MONTH_LINE = '            db.prepare(ODDS_BUDGET_SQL.monthCharge).bind(units, month, token),\n';
  const CHARGE_LINE = '            db.prepare(ODDS_BUDGET_SQL.charge).bind(units, date, token),\n';

  // THE DEFECT ITSELF, put back: the order dropped, so the five results are
  // read against the helper's three-statement default.
  ok('M1 the charge call drops its order and falls back to the default',
     M(['chargedFromBatch(results, ODDS_CHARGE_ORDER)', 'chargedFromBatch(results)'])
       .some((x) => x.includes('throw on every call and degrade open')));

  // The other direction: the batch grows, the order does not.
  ok('M2 a statement added to the batch',
     M([MONTH_LINE, MONTH_LINE + '            db.prepare(ODDS_BUDGET_SQL.fixMonth).bind(0, month),\n'])
       .some((x) => x.includes('throw on every call')));

  // The order grows, the batch does not.
  ok('M3 a key added to the declared order',
     M([ORDER, order('seed', 'monthSeed', 'siteSeed', 'snapshot', 'gate', 'refusal', 'siteCharge', 'monthCharge', 'charge', 'fixMonth')])
       .some((x) => x.includes('throw on every call')));

  // Same length, wrong statements — the charge would not be last.
  ok('M4 the order reshuffled so the charge is not last',
     M([ORDER, order('seed', 'monthSeed', 'siteSeed', 'snapshot', 'gate', 'refusal', 'siteCharge', 'charge', 'monthCharge')])
       .some((x) => x.includes('do not match')));

  // A second charge path must make this refuse, not quietly check one of two.
  ok('M5 a second chargedFromBatch call refuses rather than checking a subset',
     M(['export const ODDS_CHARGE_ORDER', 'function _x(r) { return chargedFromBatch(r); }\nexport const ODDS_CHARGE_ORDER'])
       .some((x) => x.includes('found 2')));

  // And the declaration going missing must be named, not crash.
  ok('M6 an undeclared order is reported rather than thrown on',
     M([ORDER, ''])
       .some((x) => x.includes('not declared as an exported array')));

  // The one M4 cannot see: batch and order reshuffled TOGETHER, so they agree.
  ok('M7 the batch and the order reordered together, charge no longer last',
     M([MONTH_LINE + CHARGE_LINE, CHARGE_LINE + MONTH_LINE],
       [ORDER, order('seed', 'monthSeed', 'siteSeed', 'snapshot', 'gate', 'refusal', 'siteCharge', 'charge', 'monthCharge')])
       .some((x) => x.includes('charge must be last')));

  // THE GATE AFTER A CHARGE, the batch and the order moved together so they
  // agree and the charge is still last. Only the ordering rule sees it.
  const GATE_LINE = /            db\.prepare\(ODDS_BUDGET_SQL\.gate\)[^\n]*\n/.exec(live)?.[0];
  const REFUSAL_LINE = /            db\.prepare\(ODDS_BUDGET_SQL\.refusal\)[^\n]*\n/.exec(live)?.[0];
  const SITE_CHARGE_LINE = '            db.prepare(ODDS_BUDGET_SQL.siteCharge).bind(units, date, site, token),\n';
  ok('M18 the gate runs after the site charge (batch and order moved together)',
     !!GATE_LINE && !!REFUSAL_LINE && M([GATE_LINE + REFUSAL_LINE + SITE_CHARGE_LINE, REFUSAL_LINE + SITE_CHARGE_LINE + GATE_LINE],
                      [ORDER, order('seed', 'monthSeed', 'siteSeed', 'snapshot', 'refusal', 'siteCharge', 'gate', 'monthCharge', 'charge')])
       .some((x) => x.includes('must run snapshot, then gate')));
  ok('M19 the snapshot runs after the gate (the convention: reads before the first write)',
     M([ORDER, order('seed', 'monthSeed', 'siteSeed', 'gate', 'snapshot', 'refusal', 'siteCharge', 'monthCharge', 'charge')])
       .some((x) => x.includes('do not match') || x.includes('must run snapshot, then gate')));

  // A statement dropped from the batch: the month seed, the one that stops a
  // fresh month starting at zero.
  ok('M8 the month seed dropped from the batch',
     M(['            db.prepare(ODDS_BUDGET_SQL.monthSeed).bind(month, carriedMonth),\n', ''])
       .some((x) => x.includes('throw on every call')));

  // The month verdict read from the last result — the day's charge.
  ok('M9 the month verdict read from the last result',
     M(["results?.[ODDS_CHARGE_ORDER.indexOf('monthCharge')]", 'results?.[results.length - 1]'])
       .some((x) => x.includes('month verdict is not read')));

  // The two a substring test passed: an off-by-one that lands on the DAY's
  // charge, and the name kept only in a comment.
  ok('M12 the month verdict read one past monthCharge (the day)',
     M(["results?.[ODDS_CHARGE_ORDER.indexOf('monthCharge')]", "results?.[ODDS_CHARGE_ORDER.indexOf('monthCharge') + 1]"])
       .some((x) => x.includes('month verdict is not read')));
  ok('M13 the month verdict read from the last result, the name left in a comment',
     M(["results?.[ODDS_CHARGE_ORDER.indexOf('monthCharge')];", "results?.at(-1); // ODDS_CHARGE_ORDER.indexOf('monthCharge');"])
       .some((x) => x.includes('month verdict is not read')));

  // The last row read without `[` or `.at(`, the by-name lookup kept as dead
  // code so a lookup test alone would pass.
  const LOOKUP = "const r = results?.[ODDS_CHARGE_ORDER.indexOf('monthCharge')];";
  ok('M14 the last row read by .slice(-1)[0], the lookup kept as dead code',
     M([LOOKUP, "const r = (results?.[ODDS_CHARGE_ORDER.indexOf('monthCharge')], results.slice(-1)[0]);"])
       .some((x) => x.includes('month verdict is not read')));
  ok('M15 the last row read by [...results].pop(), the lookup kept in a void',
     M([LOOKUP, "void results?.[ODDS_CHARGE_ORDER.indexOf('monthCharge')]; const r = [...results].pop();"])
       .some((x) => x.includes('month verdict is not read')));
  ok('M16 .at() one past monthCharge',
     M([LOOKUP, "const r = results?.at(ODDS_CHARGE_ORDER.indexOf('monthCharge') + 1);"])
       .some((x) => x.includes('month verdict is not read')));
  ok('M17 the order loses monthCharge',
     M([ORDER, order('seed', 'monthSeed', 'siteSeed', 'snapshot', 'gate', 'siteCharge', 'charge')])
       .some((x) => x.includes("has no 'monthCharge'")));

  // EQUIVALENT REWRITES must stay green: the check rejects reading the wrong
  // row, not a spelling.
  const noMonth = (f) => !f.some((x) => x.includes('month verdict is not read'));
  ok('E1 the parameter renamed is still the by-name read',
     noMonth(M(["function _monthFromBatch(results) {\n    const r = results?.[", "function _monthFromBatch(rs) {\n    const r = rs?.["])));
  ok('E2 .at(lookup) is the by-name read',
     noMonth(M([LOOKUP, "const r = results?.at(ODDS_CHARGE_ORDER.indexOf('monthCharge'));"])));
  ok('E3 a double-quoted key is the by-name read',
     noMonth(M([LOOKUP, 'const r = results?.[ODDS_CHARGE_ORDER.indexOf("monthCharge")];'])));

  // The charger stops reading the month through the checked helper.
  ok('M10 the charger reads the month some other way',
     M(['const monthOut = _monthFromBatch(results);', 'const monthOut = { charged: true, used: null };'])
       .some((x) => x.includes('does not read its month verdict')));

  // The helper's default is read, not assumed: an unreadable signature is named.
  ok("M11 chargedFromBatch's default becomes unreadable",
     M(['export function chargedFromBatch(results, order = ODDS_BUDGET_ORDER)', 'export function chargedFromBatch(results, order)'])
       .some((x) => x.includes('default order could not be read')));

  // POSITIVE CONTROL for the same change: a no-arg call against a default that
  // really is the five-statement order is CORRECT, and the old hard-coded
  // 'ODDS_BUDGET_ORDER' fallback would have reported it as a mismatch.
  ok('C1 a no-arg call is checked against the helper\'s REAL default',
     M(['export function chargedFromBatch(results, order = ODDS_BUDGET_ORDER)', 'export function chargedFromBatch(results, order = ODDS_CHARGE_ORDER)'],
       ['chargedFromBatch(results, ODDS_CHARGE_ORDER)', 'chargedFromBatch(results)']).length === 0);

  console.log(fail ? `\n${fail} FAILED of ${ran}` : `\nself-test: ${ran}/${ran}`);
  console.log(`COVERAGE: ${ran} assertion(s) over ${SRC} — the 1 chargedFromBatch call`);
  console.log(`site, its batch, the charge-last rule and the month's by-name read, as`);
  console.log(`SOURCE. It does NOT execute a batch and it does not see runtime shapes: a D1`);
  console.log(`call that returns fewer results than it was given statements is a different`);
  console.log(`failure and still reaches the degrade path.`);
  process.exitCode = fail ? 1 : 0;
} else {
  const found = findings(readFileSync(SRC, 'utf8'));
  if (found.length) {
    console.log(`FAIL  ${found.length} finding(s) in ${SRC}:`);
    found.forEach((x) => console.log(`   ${x}`));
    process.exitCode = 1;
  } else {
    console.log(`PASS  the chargedFromBatch call site agrees with its batch, charge is last, and the month is read by name (${SRC})`);
    console.log(`COVERAGE: 1 call site, as source. Runtime result-count mismatches are not`);
    console.log(`visible here — those still surface as degraded_open.reasons on /budget/odds.`);
  }
}
