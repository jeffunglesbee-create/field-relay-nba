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

// THE KEY-SET SIGNATURE FAILED ITS OWN STEP 0 AND IS KEPT AS A SECONDARY.
// `proof` appeared under BOTH archive_game_closing and odds_backfill, because
// odds_backfill adopted extractOddsForGame mid-August. A builder is not a
// writer. That refusal is the reason this file now has a better fingerprint.
const SIG = `CASE
    WHEN json_extract(closing_odds,'$._oddsProof') IS NOT NULL THEN 'proof'
    WHEN json_extract(closing_odds,'$.spread')    IS NOT NULL THEN 'spread-no-proof'
    ELSE 'neither' END`;

// THE POSITIVE FINGERPRINT, READ OUT OF THE WRITER RATHER THAN FITTED TO DATA.
//
// .github/scripts/odds-backfill.js — a THIRD writer, in CI rather than in the
// worker, which is why `grep src/*.js` found only two — builds ONE odds object
// per game and writes it to BOTH columns (`fields = isPast ? ['opening_odds',
// 'closing_odds'] : ['opening_odds']`). No other writer touches both. So an
// identical `captured_at` in the two columns is that writer's signature, and
// nothing else can produce it.
//
// Its `source` is `row.bookmaker || 'odds-api-historical'`, so the literal
// 'odds-api-historical' is a second, independent marker — present only when the
// provider row carried no bookmaker.
//
// AND ITS captured_at IS NOT A WRITE TIME. `row.snapshot_time || new
// Date().toISOString()` — when the provider gives no snapshot time it stamps
// the moment the backfill RAN, which for a game played days earlier is a
// days-late "closing" capture. Ten rows stamped 2026-08-11T01:58:26..39 for
// games played 2026-08-05, thirteen seconds apart and sequential, is what a
// loop calling new Date() per row looks like.
const SAME_CAPTURE = `(json_extract(opening_odds,'$.captured_at') IS NOT NULL
     AND json_extract(opening_odds,'$.captured_at')
       = json_extract(closing_odds,'$.captured_at'))`;
const HISTORICAL = `(json_extract(closing_odds,'$.source') = 'odds-api-historical')`;
const FINGERPRINT = `CASE
    WHEN ${SAME_CAPTURE} AND ${HISTORICAL} THEN 'backfill (both marks)'
    WHEN ${SAME_CAPTURE}                   THEN 'backfill (same captured_at)'
    WHEN ${HISTORICAL}                     THEN 'backfill (historical source)'
    ELSE 'not backfill' END`;
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
  say(`\n--- 0. signature AND fingerprint vs change_log source, where the answer is known`);
  let contradicted = false;
  for (const t of TABLES) {
    const rows = await d1(
      `SELECT ${SIG} sig, ${FINGERPRINT} fp, ${SOURCE(t)} src, COUNT(*) n,
              MIN(${CAP}) first_cap, MAX(${CAP}) last_cap
         FROM ${t}
        WHERE closing_odds IS NOT NULL AND ${SOURCE(t)} IS NOT NULL
        GROUP BY sig, fp, src ORDER BY src, fp, sig`);
    if (!rows.length) { say(`    ${t}: no attributed rows`); continue; }
    for (const r of rows)
      say(`    ${t}  ${String(r.src).padEnd(22)} ${r.fp.padEnd(30)} ${r.sig.padEnd(16)}`
        + ` ${String(r.n).padStart(4)}  (${String(r.first_cap).slice(0,10)} .. ${String(r.last_cap).slice(0,10)})`);
    // THE FINGERPRINT'S ONE CLAIM: only odds_backfill writes both columns from
    // one object. If a row any other writer is named for carries that mark, the
    // claim is false and nothing below may be believed.
    const wrong = rows.filter(r => r.fp !== 'not backfill' && r.src !== 'odds_backfill');
    const missed = rows.filter(r => r.fp === 'not backfill' && r.src === 'odds_backfill');
    for (const r of wrong) {
      contradicted = true;
      say(`    CONTRADICTION: ${r.n} row(s) marked '${r.fp}' are attributed to ${r.src}, not odds_backfill`);
    }
    for (const r of missed)
      say(`    NOTE: ${r.n} odds_backfill row(s) carry NO backfill mark — the fingerprint`
        + ` finds some of that writer's rows, not all of them (it is sufficient, not necessary)`);
  }
  if (contradicted) {
    say(`\n    NO CLASSIFICATION IS OFFERED. The fingerprint marks rows another writer`);
    say(`    is named for, so it does not identify odds_backfill. The descriptive`);
    say(`    steps below still run — a failed classifier is a reason to withhold a`);
    say(`    verdict, not a reason to withhold the data.`);
  }

  // ── 0b. WHEN DID EACH WRITER START LEAVING A TRACE? ──────────────────────
  //
  // THIS REPLACES THE FINGERPRINT, AND IT IS DATED RATHER THAN INFERRED.
  // Two independent blob signatures have now failed this probe's own step 0:
  // the key-set (a builder is shared between writers) and same-captured_at
  // (archive_game_closing also reads historical snapshots). Three writers, two
  // shared builders, overlapping timestamps — the blob does not carry
  // authorship, and a third guess would be fitting rather than measuring.
  //
  // What IS measurable: a row written before its writer began inserting into
  // change_log is unattributable BY CONSTRUCTION, not by loss. The first
  // attributed row per source dates that boundary.
  say(`\n--- 0b. first and last change_log entry per writer`);
  const starts = {};
  for (const t of TABLES) {
    const rows = await d1(
      `SELECT ${SOURCE(t)} src, COUNT(*) n, MIN(${CAP}) first_cap, MAX(${CAP}) last_cap
         FROM ${t} WHERE closing_odds IS NOT NULL AND ${SOURCE(t)} IS NOT NULL
        GROUP BY src ORDER BY first_cap`);
    for (const r of rows) {
      starts[r.src] = r.first_cap;
      say(`    ${t}  ${String(r.src).padEnd(22)} ${String(r.n).padStart(4)}`
        + `  ${String(r.first_cap).slice(0,10)} .. ${String(r.last_cap).slice(0,10)}`);
    }
  }
  const latestStart = Object.entries(starts).sort((a, b) => (a[1] < b[1] ? 1 : -1))[0];
  if (latestStart) {
    say(`\n    The last writer to start logging is ${latestStart[0]}, at ${String(latestStart[1]).slice(0,10)}.`);
    for (const t of TABLES) {
      const r = (await d1(
        `SELECT COUNT(*) n,
                SUM(CASE WHEN ${CAP} < ? THEN 1 ELSE 0 END) before_last_start
           FROM ${t} WHERE closing_odds IS NOT NULL AND ${SOURCE(t)} IS NULL`,
        [latestStart[1]]))[0] || {};
      say(`    ${t}: ${r.before_last_start} of ${r.n} unattributed rows were captured BEFORE that date`);
      say(`        — unattributable by construction, not by a lost write.`);
    }
  }

  // ── 1. THE UNATTRIBUTED ROWS, BY SIGNATURE ───────────────────────────────
  say(`\n--- 1. rows change_log does NOT name, by signature`);
  for (const t of TABLES) {
    const rows = await d1(
      `SELECT ${SIG} sig, ${FINGERPRINT} fp, COUNT(*) n,
              MIN(${CAP}) first_cap, MAX(${CAP}) last_cap,
              SUM(CASE WHEN ${CAP} < '${PROOF_ADDED}' THEN 1 ELSE 0 END) pre_proof
         FROM ${t}
        WHERE closing_odds IS NOT NULL AND ${SOURCE(t)} IS NULL
        GROUP BY sig, fp ORDER BY n DESC`);
    if (!rows.length) { say(`    ${t}: none`); continue; }
    for (const r of rows)
      say(`    ${t}  ${r.fp.padEnd(30)} ${r.sig.padEnd(16)} ${String(r.n).padStart(4)}`
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
      `SELECT ${SIG} sig, ${FINGERPRINT} fp, COUNT(*) n, MIN(${CAP}) first_cap, MAX(${CAP}) last_cap,
              SUM(CASE WHEN ${CAP} < '${PROOF_ADDED}' THEN 1 ELSE 0 END) pre_proof
         FROM ${t} WHERE ${LATE} AND ${SOURCE(t)} IS NULL
        GROUP BY sig, fp ORDER BY n DESC`);
    if (!rows.length) { say(`    ${t}: none`); continue; }
    for (const r of rows)
      say(`    ${t}  ${r.fp.padEnd(30)} ${r.sig.padEnd(16)} ${String(r.n).padStart(4)}`
        + `  (${String(r.first_cap).slice(0,10)} .. ${String(r.last_cap).slice(0,10)},`
        + ` ${r.pre_proof} captured before ${PROOF_ADDED})`);
    // Named rows, so a human can open one. A count cannot be opened.
    const eg = await d1(
      `SELECT id, ${FINGERPRINT} fp, ${SIG} sig, ${CAP} cap, start_time FROM ${t}
        WHERE ${LATE} AND ${SOURCE(t)} IS NULL ORDER BY ${CAP} DESC LIMIT 5`);
    for (const r of eg) say(`        e.g. ${r.id}  [${r.fp} / ${r.sig}]  cap ${r.cap}  start ${r.start_time}`);
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
