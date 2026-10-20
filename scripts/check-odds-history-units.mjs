#!/usr/bin/env node
// ODDS_HISTORY HOLDS ONE UNIT, AND IT IS DECIMAL
// (docs/CC-CMD-2026-10-19-odds-history-american-converted-twice.md).
//
// The sync (odds-backfill.js syncOddsToGameTables) reads every odds_history
// price as decimal. scripts/targeted-odds-fill.mjs asked the vendor for
// American odds, so all 211 of its rows were converted twice: 275 was stored
// as +27400, -345 as null, in both columns of 211 games.
//
//   A. every file that both fetches the vendor's odds and inserts into
//      odds_history asks for oddsFormat=decimal, explicitly, on every request.
//      A writer found nowhere is a FAILURE: an empty scan proves nothing.
//   B. on the 211 real rows, the sync's own decimalToAmerican (read from its
//      source) applied to the American prices gives exactly what was stored:
//      the mechanism, measured, not inferred.
//   C. the repair's American-to-decimal conversion, fed through that same
//      decimalToAmerican, gives the American price back on every real side.
//      That is what the sync will do with the converted rows, and with every
//      row the fill writes from now on.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { americanToDecimal, loadRows, syncDecimalToAmerican } from './repair-odds-american-units.mjs';

let failed = 0;
const pass = (m) => console.log(`  PASS  ${m}`);
const fail = (m) => { failed++; console.log(`  FAIL  ${m}`); };
const ok = (c, m) => (c ? pass(m) : fail(m));

// ── A. every odds_history writer asks for decimal ───────────────────────────
console.log('A. odds_history writers and the unit they request');
const KNOWN = ['.github/scripts/odds-backfill.js', 'scripts/targeted-odds-fill.mjs'];
const files = [];
const walk = (d) => {
  for (const n of readdirSync(d)) {
    const p = join(d, n);
    if (n === 'node_modules' || n.startsWith('.git') && d === '.') continue;
    if (statSync(p).isDirectory()) walk(p);
    else if (/\.(m?js)$/.test(n)) files.push(p);
  }
};
for (const d of ['src', 'scripts', '.github/scripts']) walk(d);
const INSERTS = /INSERT\s+(?:OR\s+\w+\s+)?INTO\s+odds_history\b/i;
// Every vendor odds request the code builds: a line that is not a comment and
// names a /v4/.../sports/... path, through the line that ends its statement.
// A comment quoting the path is not a request (the first version of this check
// read odds-backfill.js's header comment as one and failed on it).
const requests = (src) => {
  const lines = src.split('\n'), out = [];
  lines.forEach((l, i) => {
    if (/^\s*(\/\/|\*)/.test(l) || !/\/v4\/(?:historical\/)?sports\//.test(l)) return;
    let s = l;
    for (let j = i; !/;\s*(\/\/.*)?$/.test(lines[j]) && j < i + 6; ) s += '\n' + lines[++j];
    if (/\/v4\/(?:historical\/)?sports\/[^?\n]*\/odds\b/.test(s)) out.push(s);
  });
  return out;
};
// This file names the statement in its own messages; it is not a writer.
const inserters = files.filter(f => f !== 'scripts/check-odds-history-units.mjs' && INSERTS.test(readFileSync(f, 'latin1')));
const writers = inserters.filter(f => requests(readFileSync(f, 'latin1')).length > 0);
console.log(`     scanned ${files.length} files in src, scripts, .github/scripts; ${inserters.length} insert into odds_history; `
  + `${writers.length} of those fetch the vendor's odds: ${writers.join(', ') || 'none'}`);
ok(writers.length > 0, 'at least one writer was found (an empty scan is a failure, not a pass)');
for (const k of KNOWN) ok(writers.includes(k), `the known writer ${k} is still found by the scan`);
for (const f of writers) {
  const urls = requests(readFileSync(f, 'latin1'));
  ok(urls.length > 0, `${f}: its vendor odds request was located (${urls.length})`);
  for (const u of urls) {
    const fmt = (u.match(/oddsFormat=(\w+)/) || [])[1];
    ok(fmt === 'decimal', `${f}: requests oddsFormat=${fmt ?? '(none — the vendor default is not a contract)'}`);
  }
}

// ── B and C. the real rows ──────────────────────────────────────────────────
const d2a = syncDecimalToAmerican();
const rows = loadRows();
const sidesOf = (r) => [['home', r.home_ml, r.blob_home], ['away', r.away_ml, r.blob_away], ['draw', r.draw_ml, r.blob_draw]]
  .filter(([, a]) => a != null);

console.log('\nB. the measured mechanism: the sync converted American prices a second time');
let same = 0, sides = 0;
for (const r of rows) for (const [, a, stored] of sidesOf(r)) { sides++; if (d2a(a) === stored) same++; }
ok(same === sides && sides === 469, `decimalToAmerican(American) equals the stored blob on ${same} of ${sides} sides of ${rows.length} rows`);

console.log('\nC. a decimal row syncs back to its American price');
let back = 0;
const misses = [];
for (const r of rows) for (const [side, a] of sidesOf(r)) {
  if (d2a(americanToDecimal(a)) === a) back++; else misses.push(`${r.id} ${side} ${a}`);
}
ok(back === sides, `${back} of ${sides} sides come back exact${misses.length ? `; first misses: ${misses.slice(0, 3).join('; ')}` : ''}`);
for (const [a, want] of [[275, 275], [-345, -345], [100, 100], [-100000, -100000], [3000, 3000]]) {
  ok(d2a(americanToDecimal(a)) === want, `${a > 0 ? '+' : ''}${a} -> ${americanToDecimal(a)} -> ${want > 0 ? '+' : ''}${d2a(americanToDecimal(a))}`);
}

console.log(`\nCOVERAGE: ${writers.length} writer(s) of ${inserters.length} odds_history inserter(s) among ${files.length} files; `
  + `${rows.length} real rows, ${sides} sides (outbox/fixture-odds-american-targeted-2026-10-20.json).`);
console.log('Structural for A: it reads the request the code builds, not a live response.');
console.log(failed ? `\n${failed} FAILED` : '\nall checks passed');
process.exit(failed ? 1 : 0);
