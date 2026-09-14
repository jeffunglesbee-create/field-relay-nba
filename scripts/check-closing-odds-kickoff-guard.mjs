#!/usr/bin/env node
// CC-CMD-2026-09-14-closing-odds-captured-after-kickoff, Task 2 gate.
//
// `closing_odds` claims to be the last price before kickoff. MEASURED
// 2026-09-14: 91 of 877 askable rows were captured at or AFTER kickoff, one by
// 64 days, because no writer compared its snapshot against the start time.
//
// THIS IS A SOURCE GATE, NOT A DATA GATE. The 91 existing rows are Task 3 and
// need owner authorisation; this stops more being made. It asserts the guard
// exists in each writer, and — because a guard that compares text is worse than
// none — that the comparison is on instants.
import { readFileSync } from 'node:fs';

const RELAY = 'src/index.js';
const BACKFILL = '.github/scripts/odds-backfill.js';
let checked = 0, failed = 0;
const ok = (name, cond) => {
  checked++; if (!cond) failed++;
  console.log(`${cond ? 'ok  ' : 'FAIL'}  ${name}`);
};
const src = (p) => readFileSync(p, 'utf8');
// Comments legitimately discuss `new Date()` and string comparison; a gate that
// reads prose has already been red twice in this repo for exactly that.
const decomment = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const relay = decomment(src(RELAY));
const backfill = decomment(src(BACKFILL));

// ── archive_game_closing ───────────────────────────────────────────────────
ok('the relay compares the capture against kickoff before writing closing_odds',
   /_preKickoff/.test(relay));
ok('and the write is gated on it',
   /if\s*\(\s*odds\s*&&\s*_preKickoff\s*\)/.test(relay));
// THE COMPARISON MUST BE ON INSTANTS. start_time arrives as `...T20:05Z` and as
// `...T23:00:00+00:00`; compared as text 'Z' sorts above ':' and a capture
// thirty seconds late reads as early. That defect shipped in the probe that
// found this one.
ok('on parsed instants, not on strings',
   /Date\.parse\(\s*odds\?\.captured_at/.test(relay)
   && /Date\.parse\(\s*start_time\s*\)/.test(relay));
// An unparseable date yields NaN and every comparison is false. The guard must
// require finite values so NaN refuses the write rather than passing it.
ok('and an unreadable date refuses the write rather than allowing it',
   /Number\.isFinite\(\s*_capMs\s*\)/.test(relay)
   && /Number\.isFinite\(\s*_kickMs\s*\)/.test(relay));

// ── odds-backfill.js ───────────────────────────────────────────────────────
ok('the backfill distinguishes a measured snapshot time from a fabricated one',
   /const measuredCapture = row\.snapshot_time \|\| null/.test(backfill));
ok('and writes closing_odds only when the snapshot time was measured',
   /isPast && measuredCapture/.test(backfill));
// The fallback is still correct for opening_odds, where an invented captured_at
// is a provenance wart rather than a false claim. Asserted so a later session
// does not "tidy" it away and silently drop opening coverage.
ok('while opening_odds keeps its fallback, which is a wart and not a false claim',
   /captured_at: measuredCapture \|\| new Date\(\)\.toISOString\(\)/.test(backfill));

// ── the write that could lose its own record ───────────────────────────────
// Reconstructing the authorship of 62 rows took two failed fingerprints and a
// dated elimination argument. The write succeeding while its record vanishes is
// what made that necessary.
ok('a failed change_log insert is reported, not swallowed',
   !/\)\.catch\(\(\)\s*=>\s*\{\}\)/.test(backfill));
ok('and it names the row it could not attribute',
   /unattributable/.test(backfill));

console.log(`\n${failed ? 'FAILED' : 'PASS'}: ${checked - failed}/${checked} assertions`
          + ` — 2 writers gated on kickoff, 1 swallowed record opened`);
process.exit(failed ? 1 : 0);
