#!/usr/bin/env node
// READ-ONLY. Who wrote the closing lines that `change_log` does not name?
//
// CC-CMD-2026-09-14-closing-odds-captured-after-kickoff, Task 2 precondition.
//
// Task 1 measured 62 of 91 late rows with no change_log entry — including 53 of
// the 54 more than six hours late — and `odds_backfill` appearing zero times.
// A guard cannot be written against a writer nobody can name.
//
// THE BLOB IS THE FINGERPRINT, AND IT IS ALREADY IN THE ARCHIVE. Only two code
// paths in this repo write closing_odds, and they construct structurally
// different objects:
//
//   src/index.js extractOddsForGame  — always stamps `_oddsProof`; emits
//       `spread` ONLY when the book actually priced one (spreadFrom returns
//       falsy otherwise). `_oddsProof` was added in 3f0fe3d, 2026-06-29.
//   src/ambient-do.js _captureClosingOdds — never stamps `_oddsProof`; ALWAYS
//       emits `spread`, `moneyline` and `total`, with nulls inside when the
//       book priced nothing.
//
// So for any row captured after 2026-06-29:
//   `_oddsProof` present            -> extractOddsForGame  (archive_game_closing)
//   `spread` present, no proof      -> AmbientDO           (closing_odds_capture)
//   neither                         -> NEITHER writer in this repository
//
// THE ATTRIBUTED ROWS ARE THE LABELLED SET. The mapping above is read from
// source, then checked against every row change_log DOES name. If a signature
// and its change_log source disagree, the mapping is wrong and this probe says
// so instead of classifying anything.
//
// NO WRITE PATH. SELECT only, enforced.
import { writeFileSync } from 'node:fs';

const RELAY = process.env.RELAY_BASE || 'https://field-relay-nba.jeffunglesbee.workers.dev';
const GATE = process.env.RELAY_SHARED_SECRET;
const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const PROOF_ADDED = '2026-06-29';
const log = [];
const say = (s) => { console.log(s); log.push(s); };

async function d1(sql, params = []) {
  if (!GATE) throw new Error('RELAY_SHARED_SECRET is not set');
  if (!/^\s*SELECT\b/i.test(sql)) throw new Error('this probe issues SELECT only');
  const res = await fetch(`${RELAY}/d1/execute`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-FIELD-Relay': GATE, 'User-Agent': UA },
    body: JSON.stringify({ sql, params }),
  });
  const b = await res.json().catch(() => ({}));
  if (!res.ok || b.success === false) throw new Error(`d1 HTTP ${res.status}: ${JSON.stringify(b).slice(0, 400)}`);
  return b.results || [];
}

const TABLES = ['regular_season_games', 'postseason_games'];
const SIG = `CASE
    WHEN json_extract(closing_odds,'$._oddsProof') IS NOT NULL THEN 'proof'
    WHEN json_extract(closing_odds,'$.spread')    IS NOT NULL THEN 'spread-no-proof'
    ELSE 'neither' END`;
const SOURCE = (t) => `(SELECT cl.source FROM change_log cl
                         WHERE cl.game_id = ${t}.id AND cl.field = 'closing_odds'
                         ORDER BY cl.ts DESC LIMIT 1)`;
const CAP = `json_extract(closing_odds,'$.captured_at')`;

(async () => {
  say(`=== closing-odds authorship  ${new Date().toISOString()} ===`);
  say(`_oddsProof has been stamped by extractOddsForGame since ${PROOF_ADDED} (3f0fe3d).`);

  // ── 0. DOES THE MAPPING HOLD WHERE THE ANSWER IS KNOWN? ──────────────────
  // Signature crossed with the source change_log records. A signature that
  // appears under two different sources does not identify a writer, and the
  // classification below would be worthless. This runs first so it can say so.
  say(`\n--- 0. signature vs change_log source, on rows change_log NAMES`);
  let contradicted = false;
  for (const t of TABLES) {
    const rows = await d1(
      `SELECT ${SIG} sig, ${SOURCE(t)} src, COUNT(*) n,
              MIN(${CAP}) first_cap, MAX(${CAP}) last_cap
         FROM ${t}
        WHERE closing_odds IS NOT NULL AND ${SOURCE(t)} IS NOT NULL
        GROUP BY sig, src ORDER BY sig, src`);
    if (!rows.length) { say(`    ${t}: no attributed rows`); continue; }
    for (const r of rows)
      say(`    ${t}  ${r.sig.padEnd(16)} ${String(r.src).padEnd(22)} ${String(r.n).padStart(4)}`
        + `  (${String(r.first_cap).slice(0,10)} .. ${String(r.last_cap).slice(0,10)})`);
    const bySig = {};
    for (const r of rows) (bySig[r.sig] ||= new Set()).add(r.src);
    for (const [sig, srcs] of Object.entries(bySig))
      if (srcs.size > 1) {
        contradicted = true;
        say(`    CONTRADICTION: signature '${sig}' appears under ${[...srcs].join(' and ')}`);
      }
  }
  if (contradicted) {
    say(`\nSTOP: a signature maps to more than one writer, so it does not identify one.`);
    say(`      No classification is printed. The mapping read from source is wrong or incomplete.`);
    writeFileSync(`outbox/closing-odds-authorship-refused-${Date.now()}.log`, log.join('\n') + '\n');
    process.exit(1);
  }

  // ── 1. THE UNATTRIBUTED ROWS, BY SIGNATURE ───────────────────────────────
  say(`\n--- 1. rows change_log does NOT name, by signature`);
  for (const t of TABLES) {
    const rows = await d1(
      `SELECT ${SIG} sig, COUNT(*) n,
              MIN(${CAP}) first_cap, MAX(${CAP}) last_cap,
              SUM(CASE WHEN ${CAP} < '${PROOF_ADDED}' THEN 1 ELSE 0 END) pre_proof
         FROM ${t}
        WHERE closing_odds IS NOT NULL AND ${SOURCE(t)} IS NULL
        GROUP BY sig ORDER BY n DESC`);
    if (!rows.length) { say(`    ${t}: none`); continue; }
    for (const r of rows)
      say(`    ${t}  ${r.sig.padEnd(16)} ${String(r.n).padStart(4)}`
        + `  (${String(r.first_cap).slice(0,10)} .. ${String(r.last_cap).slice(0,10)},`
        + ` ${r.pre_proof} captured before ${PROOF_ADDED})`);
  }

  // ── 2. THE SAME, NARROWED TO THE LATE ONES ───────────────────────────────
  // These are the 91 Task 1 counted. The 62 with no change_log entry are the
  // set this probe exists to name.
  const JD = (x) => `julianday(replace(replace(${x}, 'T', ' '), 'Z', ''))`;
  const LATE = `closing_odds IS NOT NULL AND start_time IS NOT NULL
      AND ${JD(CAP)} IS NOT NULL AND ${JD('start_time')} IS NOT NULL
      AND ${JD(CAP)} >= ${JD('start_time')}`;
  say(`\n--- 2. the LATE rows change_log does not name`);
  for (const t of TABLES) {
    const rows = await d1(
      `SELECT ${SIG} sig, COUNT(*) n, MIN(${CAP}) first_cap, MAX(${CAP}) last_cap,
              SUM(CASE WHEN ${CAP} < '${PROOF_ADDED}' THEN 1 ELSE 0 END) pre_proof
         FROM ${t} WHERE ${LATE} AND ${SOURCE(t)} IS NULL
        GROUP BY sig ORDER BY n DESC`);
    if (!rows.length) { say(`    ${t}: none`); continue; }
    for (const r of rows)
      say(`    ${t}  ${r.sig.padEnd(16)} ${String(r.n).padStart(4)}`
        + `  (${String(r.first_cap).slice(0,10)} .. ${String(r.last_cap).slice(0,10)},`
        + ` ${r.pre_proof} captured before ${PROOF_ADDED})`);
    // Named rows, so a human can open one. A count cannot be opened.
    const eg = await d1(
      `SELECT id, ${SIG} sig, ${CAP} cap, start_time FROM ${t}
        WHERE ${LATE} AND ${SOURCE(t)} IS NULL ORDER BY ${CAP} DESC LIMIT 5`);
    for (const r of eg) say(`        e.g. ${r.id}  [${r.sig}]  cap ${r.cap}  start ${r.start_time}`);
  }

  const p = `outbox/closing-odds-authorship-${new Date().toISOString().replace(/[:.]/g, '-')}.log`;
  writeFileSync(p, log.join('\n') + '\n');
  console.log(`\nwrote ${p}`);
})().catch(e => {
  console.error(`\nFAILED: ${e.message}`);
  log.push(`FAILED: ${e.message}`);
  writeFileSync(`outbox/closing-odds-authorship-failed-${Date.now()}.log`, log.join('\n') + '\n');
  process.exit(1);
});
