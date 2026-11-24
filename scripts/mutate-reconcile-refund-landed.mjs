#!/usr/bin/env node
/**
 * Rule 90 (MUTATE-FIRST-A) for scripts/check-reconcile-refund-landed.mjs.
 *
 * Each mutation puts one piece of the fix back to the defect (or breaks it a different way) in a COPY of
 * src/budget-helpers.js, and the check is run against the copy through BUDGET_HELPERS_SRC. The check must go red for
 * every one. A mutation that leaves it green is a check that could not have caught that defect, and this file exits
 * non-zero.
 *
 * THE HARNESS'S OWN ANCHORS ARE ASSERTED. A mutation whose anchor is missing or occurs more than once applies NOTHING,
 * and a check that is green on unmutated source would then print a pass for it. Each fails the harness by name when its
 * anchor does not occur exactly once, and a mutant that is byte-identical to the source is refused.
 *
 * A mutant counts as CAUGHT only when an assertion failed ("N of M passed." with N < M and a FAIL line). A crash or a
 * syntax error proves nothing about what the check asserts and is reported as a harness error. The CONTROL (the
 * unmutated source) must pass first, or nothing below means anything.
 *
 * Which cases catch which is printed, so a mutant caught only by a case that has nothing to do with it shows up.
 */
import { readFileSync, writeFileSync, rmSync, mkdtempSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

const SRC = process.env.BUDGET_HELPERS_SRC || 'src/budget-helpers.js';
const original = readFileSync(SRC, 'utf8');
const dir = mkdtempSync(join(tmpdir(), 'reconcile-landed-'));
process.on('exit', () => rmSync(dir, { recursive: true, force: true }));
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => process.exit(130));

const run = (file) => {
  let out = '', code = 0;
  try { out = execFileSync(process.execPath, ['scripts/check-reconcile-refund-landed.mjs'], { env: { ...process.env, BUDGET_HELPERS_SRC: file }, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }); }
  catch (e) { code = e.status ?? 1; out = (e.stdout || '') + (e.stderr || ''); }
  const m = /(\d+) of (\d+) passed\./.exec(out);
  const fails = [...out.matchAll(/^FAIL\s+([A-K]\d{0,2})\s/gm)].map((x) => x[1]);
  const verdict = code === 0 && m && m[1] === m[2] ? 'pass' : (m && +m[1] < +m[2] && fails.length ? 'red' : 'error');
  return { verdict, fails: [...new Set(fails)], tail: out.trim().split('\n').slice(-3).join(' | ') };
};

let bad = 0;
const control = run(resolve(SRC));
if (control.verdict !== 'pass') { console.log(`FAIL  CONTROL: the unmutated source does not pass (${control.verdict}: ${control.tail})`); process.exit(1); }
console.log('ok    CONTROL: the unmutated source passes');

const M = (id, what, old, neu) => ({ id, what, edits: [[old, neu]] });
const MM = (id, what, ...edits) => ({ id, what, edits });   // several edits, each anchor asserted to occur exactly once
const mutants = [
  M('M1', 'the mirror failure always reaches the outer catch again (the defect, restored)',
    "if (!landed) throw e;", 'throw e;'),
  M('M2', 'the batch resolving no longer marks the correction landed',
    "                landed = true;\n", ''),
  M('M3', 'the flag starts true, so a rejected batch counts as landed',
    "let landed = false;", "let landed = true;"),
  M('M4', 'landed is claimed BEFORE the batch resolves',
    "const db = env.ARCHIVE_DB;\n                await db.batch([", "const db = env.ARCHIVE_DB;\n                landed = true;\n                await db.batch(["),
  M('M5', 'a landed refund with a failed mirror loses its note',
    "out.note = 'KV mirror failed after the D1 correction landed';", ''),
  M('M6', "the mirror's WRITE escapes the inner try (only its read is covered)",
    "if (!landed) throw e;", "if (!landed || /PUT/.test(String(e && e.message))) throw e;"),
  M('M7', 'a POSITIVE correction (receipt above the estimate) is not marked landed',
    "                landed = true;\n", "                landed = out.delta < 0;\n"),
  M('M8', 'a failed mirror after a landed refund still marks the state error',
    "out.note = 'KV mirror failed after the D1 correction landed';", "out.state = 'error'; out.note = 'KV mirror failed after the D1 correction landed';"),
  M('M9', 'the persisted tally row carries a hard-coded state, not the one returned',
    ".bind(new Date().toISOString().slice(0, 10), site || '(unnamed)', out.state,", ".bind(new Date().toISOString().slice(0, 10), site || '(unnamed)', 'reconciled',"),
  M('M10', 'a rejected batch is flipped to `error` (the regression an adversarial review found in the first version of this fix)',
    "console.warn(`[odds-reconcile] D1 correction failed for ${site} delta=${out.delta}: ${String(e.message || e).slice(0, 120)}`);", "console.warn(`[odds-reconcile] D1 correction failed for ${site} delta=${out.delta}: ${String(e.message || e).slice(0, 120)}`); out.state = 'error';"),
  M('M11', 'the public note carries the KV error text',
    "out.note = 'KV mirror failed after the D1 correction landed';", "out.note = 'KV mirror failed after the D1 correction landed: ' + String(e && e.message || e);"),
  M('M12', 'chargeOdds returns true without charging (a vacuous precondition)',
    "async function chargeOdds(env, units = 1, site = 'unattributed') {\n", "async function chargeOdds(env, units = 1, site = 'unattributed') {\n    return true;\n"),
  MM('M13', 'landed is hoisted to MODULE scope: set by one call, never reset (state shared across calls in an isolate)',
    ["        let landed = false;\n        try {", "        try {"],
    ["async function _reconcileOddsCredit(env, estimated, resp, site = '') {", "let landed = false;\nasync function _reconcileOddsCredit(env, estimated, resp, site = '') {"]),
  M('M14', '_bumpSite stops swallowing its own errors (a KV outage then fails the reconcile)',
    "    } catch (_) {\n        // Attribution must never fail a fetch.", "    } catch (_) {\n        throw _;\n        // Attribution must never fail a fetch."),
  M('M15', 'the wrapper rethrows a failed tally write (which fails the fetch at every call site)',
    "console.warn(`[odds-reconcile-tally] ${site} state=${out.state}: ${String(e && e.message || e).slice(0, 120)}`);", "throw e;"),
  M('M16', 'the tally stops accumulating: credits_kept is overwritten, not added to',
    "credits_kept = credits_kept + ?`;", "credits_kept = ?`;"),
  M('M17', 'the day correction carries 0',
    "db.prepare(ODDS_BUDGET_SQL.fixDay).bind(out.delta,", "db.prepare(ODDS_BUDGET_SQL.fixDay).bind(0,"),
  M('M18', 'the month correction is dropped from the batch',
    "db.prepare(ODDS_BUDGET_SQL.fixMonth).bind(out.delta, month.slice('odds:credits:'.length)),", ''),
  M('M19', "the mirror's write is dropped (the injected write fault never fires)",
    "await env.FIELD_JOURNALISM.put(key, String(next), { expirationTtl: 60 * 86400 });", ''),
  M('M20', 'the persisted cache column is hard-coded',
    "String(cache), kept, kept)", "'none', kept, kept)"),
];

for (const m of mutants) {
  let text = original, anchorBad = null;
  for (const [old, neu] of m.edits) {
    const count = text.split(old).length - 1;
    if (count !== 1) { anchorBad = `ANCHOR: occurs ${count} times, not once (${JSON.stringify(old.slice(0, 70))}); nothing was mutated`; break; }
    text = text.replace(old, () => neu);
  }
  if (anchorBad) { bad++; console.log(`FAIL  ${m.id} ${anchorBad}`); continue; }
  if (text === original) { bad++; console.log(`FAIL  ${m.id} the mutant is identical to the source`); continue; }
  const file = join(dir, `${m.id}.js`);
  writeFileSync(file, text);
  const r = run(file);
  if (r.verdict === 'red') console.log(`ok    ${m.id} CAUGHT by ${r.fails.join(', ')} — ${m.what}`);
  else { bad++; console.log(`FAIL  ${m.id} ${r.verdict.toUpperCase()} — ${m.what}\n        ${r.tail}`); }
}
console.log(`\n${mutants.length - bad} of ${mutants.length} mutants caught (control passed).`);
process.exit(bad === 0 ? 0 : 1);
