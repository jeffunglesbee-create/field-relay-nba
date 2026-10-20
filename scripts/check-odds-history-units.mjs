#!/usr/bin/env node
// ODDS_HISTORY HOLDS ONE UNIT, AND IT IS DECIMAL
// (docs/CC-CMD-2026-10-19-odds-history-american-converted-twice.md).
//
// The sync (odds-backfill.js syncOddsToGameTables) reads every odds_history
// price as decimal. scripts/targeted-odds-fill.mjs asked the vendor for
// American odds, so all 211 of its rows were converted twice: 275 was stored
// as +27400, -345 as null, in both columns of 211 games.
//
//   A. every vendor odds request in the runtime code asks for
//      oddsFormat=decimal, explicitly, in every place it names a format,
//      UNLESS its file is on AMERICAN_READERS below, a reviewed list of
//      files that read American prices and write no odds_history row. A
//      listed file that starts writing odds_history fails, and so does a
//      listed file that no longer requests anything (a stale exemption).
//      It is written this way round because a request and the INSERT it
//      feeds need not share a file: a writer split into a fetch helper and
//      an insert helper would pass a check that looks for both together
//      (the 2026-10-20 review built seven such writers).
//   B. the repair's American-to-decimal conversion, fed through the sync's
//      own decimalToAmerican (read from its source), gives the American
//      price back on every real side: what the sync does with the converted
//      rows, and with every row the fill writes from now on. The mechanism
//      of the damage itself is proven once, in the repair's self-test; it is
//      not pinned here, so hardening the sync cannot turn this gate red.

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { americanToDecimal, loadRows, syncDecimalToAmerican } from './repair-odds-american-units.mjs';

let failed = 0;
const ok = (c, m) => { if (c) console.log(`  PASS  ${m}`); else { failed++; console.log(`  FAIL  ${m}`); } };

// Read 2026-10-20. Each writes American prices into game-table blobs or
// prints them; none writes odds_history.
const AMERICAN_READERS = {
  'src/index.js': 'fetchSportOddsLive and _captureClosingOdds write American blobs into the game tables',
  'src/ambient-do.js': 'the closing capture writes an American closing_odds blob',
  'src/wp-resolver.js': 'reads American prices for win probability',
  'scripts/diagnose-cfb-name-join.mjs': 'a probe that prints the vendor payload',
  'scripts/odds-h2h-shape-probe.mjs': 'a probe that prints the h2h market shape',
  'scripts/odds-spread-shape-probe.mjs': 'a probe that prints the spread market shape',
};

// ── A ──────────────────────────────────────────────────────────────────────
console.log('A. every vendor odds request asks for decimal, or is a listed American reader');
const files = [];
const walk = (d) => {
  for (const n of readdirSync(d)) {
    const p = join(d, n);
    if (n === 'node_modules') continue;
    if (statSync(p).isDirectory()) walk(p);
    else if (/\.(m?js|cjs|ts)$/.test(n)) files.push(p);
  }
};
for (const d of ['src', 'scripts', '.github/scripts', 'workers']) if (existsSync(d)) walk(d);
// Checks and mutation harnesses carry request strings as fixtures; they are
// not runtime code, so they are counted out loud rather than scanned.
const harness = files.filter(f => /^scripts\/(check|mutate)-/.test(f));
const runtime = files.filter(f => !harness.includes(f));

/** Statements with comments removed: whole-line comments dropped, trailing
 *  // comments cut (not the // of a URL scheme). A comment that names a
 *  format is not a request (the review hid an American request behind one). */
const statements = (src) => {
  const out = []; let buf = '';
  for (let l of src.split('\n')) {
    if (/^\s*(\/\/|\*|\/\*)/.test(l)) continue;
    l = l.replace(/(^|[^:\\])\/\/.*$/, '$1');
    buf += l + '\n';
    if (/[;{}]\s*$/.test(l)) { out.push(buf); buf = ''; }
  }
  if (buf.trim()) out.push(buf);
  return out;
};
const requests = (src) => statements(src).filter(s => /\/odds\b/.test(s) && /(apiKey=|oddsFormat=)/.test(s));
const WRITES = /(?:INSERT(?:\s+OR\s+\w+)?|REPLACE)\s+INTO\s+["`[]?odds_history\b|UPDATE\s+["`[]?odds_history\b/i;

let requesting = 0;
for (const f of runtime) {
  const src = readFileSync(f, 'latin1');
  const reqs = requests(src);
  if (AMERICAN_READERS[f]) {
    ok(reqs.length > 0, `${f}: listed as an American reader and still requests odds (${reqs.length})`);
    ok(!WRITES.test(src), `${f}: a listed American reader writes no odds_history row`);
    continue;
  }
  if (!reqs.length) continue;
  requesting++;
  for (const s of reqs) {
    const fmts = [...s.matchAll(/oddsFormat=(\w+)/g)].map(m => m[1]);
    ok(fmts.length > 0 && fmts.every(x => x === 'decimal'),
      `${f}: asks for oddsFormat=${fmts.join('+') || '(none: the vendor default is not a contract)'}`);
  }
}
for (const f of Object.keys(AMERICAN_READERS)) ok(runtime.includes(f), `${f}: the listed American reader exists`);
for (const k of ['.github/scripts/odds-backfill.js', 'scripts/targeted-odds-fill.mjs']) {
  ok(WRITES.test(readFileSync(k, 'latin1')) && requests(readFileSync(k, 'latin1')).length > 0,
    `${k}: the known odds_history writer is still seen requesting and writing (an empty scan is a failure)`);
}

// ── B ──────────────────────────────────────────────────────────────────────
console.log('\nB. a decimal row syncs back to its American price');
const d2a = syncDecimalToAmerican();
const rows = loadRows();
let back = 0, sides = 0;
const misses = [];
for (const r of rows) for (const [side, a] of [['home', r.home_ml], ['away', r.away_ml], ['draw', r.draw_ml]]) {
  if (a == null) continue;
  sides++;
  if (d2a(americanToDecimal(a)) === a) back++; else misses.push(`${r.id} ${side} ${a}`);
}
ok(back === sides && sides === 469, `${back} of ${sides} real sides come back exact${misses.length ? `; first misses: ${misses.slice(0, 3).join('; ')}` : ''}`);
for (const a of [275, -345, 100, -100000, 3000]) {
  ok(d2a(americanToDecimal(a)) === a, `${a > 0 ? '+' : ''}${a} -> ${americanToDecimal(a)} -> ${d2a(americanToDecimal(a))}`);
}

console.log(`\nCOVERAGE: ${runtime.length} runtime files scanned (src, scripts, .github/scripts, workers; ${harness.length} check/mutate harnesses counted out); `
  + `${requesting} request decimal odds as writers or readers, ${Object.keys(AMERICAN_READERS).length} listed American readers; `
  + `${rows.length} real rows, ${sides} sides (outbox/fixture-odds-american-targeted-2026-10-20.json).`);
console.log('Structural for A: it reads the request the code builds, not a live response.');
console.log(failed ? `\n${failed} FAILED` : '\nall checks passed');
process.exit(failed ? 1 : 0);
