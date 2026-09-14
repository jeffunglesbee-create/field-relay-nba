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
const AMBIENT = 'src/ambient-do.js';
const MARK = 'src/odds-kickoff.js';
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
const ambient = decomment(src(AMBIENT));

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

// ── THE MARK: every writer labels by the same rule ─────────────────────────
// The 91 late rows are not a population, they are the subset where the defect
// is provable — 877 had a start_time to check against, 530 did not. A row that
// carries its own verdict is readable without that asymmetry.
const WRITERS = [['relay', relay, RELAY], ['backfill', backfill, BACKFILL],
                 ['ambient-do', ambient, AMBIENT]];
for (const [name, body, file] of WRITERS) {
  // IMPORTED, NOT JUST CALLED. `node --check` parses a call to an undefined
  // identifier without complaint — it did exactly that for a deleted `SOURCE`
  // and again for this very import on 2026-09-14. A syntax check is not an
  // execution, so the import is asserted separately from the call.
  ok(`${name} imports the shared kickoff mark`,
     /import \{[^}]*stampKickoff[^}]*\} from ['"][^'"]*odds-kickoff\.js['"]/.test(body));
  ok(`${name} stamps it onto the odds it writes`, /stampKickoff\(/.test(body));
}
// One rule in one file. Three copies of a comparison is three chances to
// disagree, and this repo has the cost model case study for that.
ok('and the rule lives in exactly one module',
   /export function kickoffMark/.test(src(MARK))
   && WRITERS.every(([, b]) => !/Date\.parse\(.*captured_at.*\)[\s\S]{0,80}Date\.parse/.test(b) || b === relay));

// The two writers that cannot verify must still be able to READ kickoff, or
// the mark they write is unverified for a reason that is not the game's.
ok('ambient-do reads start_time for the row it is about to write',
   /SELECT id, start_time FROM/.test(ambient));
ok('the backfill reads start_time alongside the game date',
   /AS game_start_time/.test(backfill));

// Both writers whose silence made 62 rows unattributable now say so.
//
// THE SHAPE, NOT THE WORD. The first version of this assertion only looked for
// "unattributable", and mutation K12 walked straight through it: re-adding the
// empty catch left the word sitting in a dead arrow function beside it. A check
// that a string exists somewhere in a file is not a check that a code path is
// gone.
ok('ambient-do reports a failed change_log insert too',
   !/\)\.catch\(\(\)\s*=>\s*\{\s*\/\*[\s\S]*?\*\/\s*\}\)/.test(ambient)
   && !/\)\.catch\(\(\)\s*=>\s*\{\}\)/.test(ambient));
ok('and names the row it could not attribute', /unattributable/.test(ambient));

console.log(`\n${failed ? 'FAILED' : 'PASS'}: ${checked - failed}/${checked} assertions`
          + ` — 3 writers marking kickoff, 2 gated, 2 swallowed records opened`);
process.exit(failed ? 1 : 0);
