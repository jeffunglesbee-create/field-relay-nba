// Seed the dead-pair ledger from the one fill that has already run.
//
// The 2026-09-19 fill bought ten pairs for 200 credits and four of them
// returned nothing usable. Its log records every outcome; nothing else does.
// Without this, the ledger starts empty and those four sort straight back to
// the top of the next plan.
//
// WHAT THIS DELIBERATELY DOES NOT CLAIM
//
// A ledger row is only true of the code that measured it, and the matcher
// fingerprint of that run is not recoverable. This clone is SHALLOW (87
// commits, grafted), so `git log -- src/odds-name-match.js` shows the file as
// created on 2026-09-20 by an automated commit — a graft artifact, not a
// history. There is no way from here to establish whether the matcher changed
// between that fill and now.
//
// So every seeded row carries `matcher_fp: seeded-from-log-20260919`, a value
// that can never equal a real hash. The consequence is exact and intended:
//
//   - a `no-events` row (a fact about the VENDOR's data) excludes immediately,
//     because it does not depend on our code at all;
//   - a `none-in-window`, `pool-exhausted` or `priced-zero` row does NOT
//     exclude. It is recorded as history and re-measured.
//
// None of the 2026-09-19 four is `no-events`, so THIS SEED SAVES NO CREDITS
// TODAY. Claiming otherwise would be asserting the matcher is unchanged, which
// is the untested premise this whole file exists to avoid. What it buys is
// that the first APPLY run after it writes real fingerprints, and from then on
// the exclusion is sound.
import { readFileSync } from 'node:fs';
import { classifyPair } from './lib/dead-pairs.cjs';

const LOG = process.argv.find(a => a.startsWith('--log='))?.split('=')[1]
  || 'outbox/targeted-odds-fill-20260919T032609Z.log';
const APPLY = process.argv.includes('--apply');
const RELAY = process.env.RELAY_BASE || 'https://field-relay-nba.jeffunglesbee.workers.dev';
const GATE = process.env.RELAY_SHARED_SECRET;
const SEED_FP = 'seeded-from-log-20260919';
const REQUEST_SHAPE = 'us|h2h,totals|12';

// `  2026-08-22 nfl   272 event(s), 0 in window -> 0 by name + 0 by elimination, 0/10 priced`
const LINE = /^\s{2}(\d{4}-\d{2}-\d{2})\s+(\S.*?)\s{2,}(\d+)\s+event\(s\),\s+(\d+)\s+in window\s+->.*?,\s+(\d+)\/(\d+)\s+priced\s*$/;
// `  2026-05-01 nfl: vendor returned 0 events (billed 20)`
const EMPTY = /^\s{2}(\d{4}-\d{2}-\d{2})\s+(\S.*?):\s+vendor returned 0 events/;

/**
 * Did the seed do its job? Extracted so it is testable, because the first
 * apply-mode run wrote ZERO of ten rows against a 401 and still exited 0 — the
 * workflow went green over a seed that seeded nothing. A partial write is a
 * failure too: a ledger missing rows vetoes fewer purchases than it should and
 * looks identical to one that is complete.
 */
export function seedVerdict(wrote, total) {
  if (typeof wrote !== 'number' || typeof total !== 'number' || total < 0 || wrote < 0) return 'unreadable';
  if (total === 0) return 'nothing-to-seed';
  if (wrote === 0) return 'wrote-nothing';
  if (wrote < total) return 'partial';
  return 'ok';
}

export function parseLog(text) {
  const rows = [];
  for (const raw of String(text).split('\n')) {
    let m = LINE.exec(raw);
    if (m) {
      const o = { events: +m[3], inWindow: +m[4], priced: +m[5], wanted: +m[6] };
      rows.push({ date: m[1], sport: m[2].trim().toLowerCase(), ...o, klass: classifyPair(o) });
      continue;
    }
    m = EMPTY.exec(raw);
    if (m) {
      const o = { events: 0, inWindow: 0, priced: 0, wanted: 1 };
      rows.push({ date: m[1], sport: m[2].trim().toLowerCase(), ...o, klass: 'no-events' });
    }
  }
  return rows;
}

// THE REGEX IS THE RISKY PART. It returns [] on any format drift, and [] reads
// as "no dead pairs" — the absence collapse, in the one place where it would
// silently restore the 20-credits-forever behaviour this ledger exists to end.
// The refusal below catches a total failure; this self-test catches a PARTIAL
// one, where some lines still parse and the census quietly changes.
if (process.argv.includes('--self-test')) {
  const rows = parseLog(readFileSync('outbox/targeted-odds-fill-20260919T032609Z.log', 'utf8'));
  const census = {};
  for (const r of rows) census[r.klass] = (census[r.klass] || 0) + 1;
  const want = { partial: 2, complete: 4, 'priced-zero': 1, 'vendor-exhausted': 1, 'none-in-window': 2 };
  let bad = 0;
  const eq = (l, g, w) => {
    if (JSON.stringify(g) === JSON.stringify(w)) console.log(`ok    ${l}`);
    else { bad++; console.log(`FAIL  ${l}\n        got  ${JSON.stringify(g)}\n        want ${JSON.stringify(w)}`); }
  };
  eq('the committed fill log parses to all ten pairs', rows.length, 10);
  eq('and to the class census the log itself shows',
    Object.fromEntries(Object.keys(want).map(k => [k, census[k] || 0])), want);
  eq('the two NFL pairs that returned 272 events and nothing in window',
    rows.filter(r => r.klass === 'none-in-window').map(r => `${r.date} ${r.sport}`),
    ['2026-08-22 nfl', '2026-08-28 nfl']);
  eq('the CFB pair whose 80 in-window events priced nothing is NOT filed with them',
    rows.find(r => r.date === '2026-09-12').klass, 'priced-zero');
  eq('a log with no outcome lines parses to nothing, never to a silent success',
    parseLog('=== header ===\nmode: DRY RUN\n').length, 0);

  // WRITING NOTHING IS NOT SUCCESS. The first apply-mode run 401'd all ten rows
  // and exited 0; the workflow went green over a seed that seeded nothing.
  eq('writing none of ten is a failure', seedVerdict(0, 10), 'wrote-nothing');
  eq('writing some of ten is also a failure — a partial ledger reads as complete',
    seedVerdict(7, 10), 'partial');
  eq('writing all ten is the only success', seedVerdict(10, 10), 'ok');
  eq('an empty log is neither success nor failure', seedVerdict(0, 0), 'nothing-to-seed');
  eq('a non-numeric count is unreadable, not a pass', seedVerdict(null, 10), 'unreadable');
  console.log(`\nCOVERAGE: parseLog against the one committed fill log — 1 file, 10 lines.`);
  console.log('It does NOT cover the D1 write, which needs the relay secret and runs in CI.');
  process.exit(bad ? 1 : 0);
}

if (process.argv[1] && process.argv[1].endsWith('seed-dead-pairs.mjs')) {
  const rows = parseLog(readFileSync(LOG, 'utf8'));
  console.log(`=== seed dead-pair ledger from ${LOG} ===`);
  console.log(`mode: ${APPLY ? '*** APPLY — writes to D1 ***' : 'DRY RUN (parses and classifies, writes nothing)'}\n`);
  if (!rows.length) {
    console.log('REFUSING: the log parsed to zero rows. Either the format changed or the');
    console.log('wrong file was given; writing nothing is the only safe reading of that.');
    process.exit(1);
  }
  const byClass = {};
  for (const r of rows) {
    byClass[r.klass] = (byClass[r.klass] || 0) + 1;
    console.log(`  ${r.date}  ${String(r.sport).padEnd(22)} `
      + `${String(r.events).padStart(3)} ev, ${String(r.inWindow).padStart(3)} in window, `
      + `${r.priced}/${r.wanted} priced  ->  ${r.klass}`);
  }
  console.log(`\n  ${rows.length} pair(s): ${Object.entries(byClass).map(([k, v]) => `${k} ${v}`).join(' · ')}`);

  // COVERAGE IN THE OUTPUT (Rule 91). The count that matters is not how many
  // rows were written but how many of them will actually stop a purchase.
  // VENDOR CLASSES ONLY. A matcher-class row seeded from this log carries a
  // sentinel fingerprint and cannot exclude; a vendor-class one does not depend
  // on our code at all, so it excludes immediately and correctly.
  const excluding = rows.filter(r => ['no-events', 'vendor-exhausted'].includes(r.klass)).length;
  console.log(`  rows that will exclude a purchase today       : ${excluding}`);
  console.log(`  rows recorded but NOT excluding (matcher fp unknown): `
    + rows.filter(r => ['none-in-window', 'pool-exhausted', 'priced-zero'].includes(r.klass)).length);
  console.log(`  credits this seed saves today                 : ${excluding * 20}`);

  if (!APPLY) { console.log('\nDRY RUN — nothing written. Re-run with --apply.'); process.exit(0); }
  if (!GATE) { console.log('\nREFUSING: RELAY_SHARED_SECRET is unset. An unset secret must 401, not look set.'); process.exit(1); }

  let wrote = 0;
  for (const r of rows) {
    const res = await fetch(`${RELAY}/d1/execute`, {
      method: 'POST',
      // X-FIELD-Relay, copied from the d1() helper in targeted-odds-fill.mjs
      // rather than remembered. The first version sent 'x-field-gate' and the
      // route 401'd all ten rows — the convention was three lines from code
      // being edited in the same session (Rule 62).
      headers: { 'Content-Type': 'application/json', 'X-FIELD-Relay': GATE },
      body: JSON.stringify({ sql:
        `INSERT OR REPLACE INTO odds_fill_dead_pairs
           (sport, date, klass, events, in_window, priced, wanted,
            params_fp, matcher_fp, credits_spent, measured_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
        params: [r.sport, r.date, r.klass, r.events, r.inWindow, r.priced, r.wanted,
                 REQUEST_SHAPE, SEED_FP, 20, '2026-09-19T03:26:09Z'] }),
    });
    if (!res.ok) { console.log(`  ! ${r.date} ${r.sport}: HTTP ${res.status}`); continue; }
    wrote++;
  }
  console.log(`\n  ${wrote} of ${rows.length} row(s) written with matcher_fp=${SEED_FP}.`);
  console.log(`  That fingerprint can never equal a real hash, so every matcher-class row`);
  console.log(`  above is history rather than a veto, exactly as intended.`);

  const v = seedVerdict(wrote, rows.length);
  console.log(`\n  verdict: ${v}`);
  if (v !== 'ok') {
    console.error(`FAIL — the seed wrote ${wrote} of ${rows.length}. A ledger missing rows`);
    console.error(`vetoes fewer purchases than it should and is indistinguishable from a`);
    console.error(`complete one. Nothing downstream can tell.`);
    process.exit(1);
  }
}
