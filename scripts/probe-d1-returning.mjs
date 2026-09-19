#!/usr/bin/env node
/**
 * Task 0b of CC-CMD-2026-09-18-atomic-odds-counter: does this D1 support
 * RETURNING? The whole atomicity argument in Task 2 rests on
 *
 *     UPDATE odds_budget SET used = used + ?2
 *      WHERE day = ?1 AND used + ?2 <= ?3
 *      RETURNING used;
 *
 * being one statement that both charges and decides. SQLite has RETURNING
 * since 3.35; this repo uses ON CONFLICT DO UPDATE in six places and RETURNING
 * in none, so its availability here was never established.
 *
 * THREE STATEMENTS, AND THE THIRD IS THE POINT. A single failing RETURNING
 * query proves nothing — it could be the table, the column, the auth, the
 * route. So the probe runs a control and a discriminator beside it:
 *
 *   A  SELECT 1                              route + auth reachable at all
 *   C  the same UPDATE, WITHOUT RETURNING    the UPDATE path itself works
 *   B  the same UPDATE, WITH RETURNING       the one variable
 *
 * If B fails while A and C pass, the difference between B and C is the word
 * RETURNING and nothing else. Without C, "B failed" is not a finding.
 *
 * ZERO ROWS BY CONSTRUCTION. Both UPDATEs carry `WHERE 1 = 0` and set a column
 * to itself, so neither can change a row even if the WHERE were ignored. This
 * is a live archive database and the probe must not be able to touch it.
 */
import { writeFileSync } from 'node:fs';

const TABLE = 'odds_backfill_progress';  // in the route's ALLOWED_TABLES
const COL   = 'games_processed';
const KEY   = 'date';

export const SQL = {
  A: 'SELECT 1 AS ok',
  C: `UPDATE ${TABLE} SET ${COL} = ${COL} WHERE 1 = 0`,
  B: `UPDATE ${TABLE} SET ${COL} = ${COL} WHERE 1 = 0 RETURNING ${KEY}`,
};

/** -> one of the five states. Pure; every branch is self-tested below. */
export function classify(a, c, b) {
  if (!a) return 'route-unreachable';
  if (!c && !b) return 'update-path-blocked';
  if (!c && b) return 'inconsistent';
  if (c && !b) return 'no-returning';
  return 'returning-supported';
}

/** What each state means for Task 2, so the reader does not have to derive it. */
export function consequence(state) {
  switch (state) {
    case 'returning-supported':
      return 'Task 2 stands as written. One batch, charge and decide in one statement.';
    case 'no-returning':
      return 'Task 2 CHANGES: batch() plus a follow-up SELECT, and the atomicity '
           + 'argument must be RE-MADE rather than assumed — a SELECT after a batch '
           + 'is a second read and reopens the window the RETURNING closed.';
    case 'update-path-blocked':
      return 'Nothing is known about RETURNING. The UPDATE itself failed, so B and C '
           + 'differ by more than one word. Fix the probe, do not read a verdict.';
    case 'route-unreachable':
      return 'Nothing is known. The control failed, so no statement reached D1.';
    case 'inconsistent':
      return 'RETURNING succeeded where the plain UPDATE failed. That cannot happen '
           + 'from one engine and means the two calls did not hit the same thing.';
    default:
      return 'unknown state';
  }
}

if (process.argv.includes('--self-test')) {
  let bad = 0;
  const one = (label, got, want, why) => {
    if (got === want) console.log(`  PASS  ${label} -> ${got}  (${why})`);
    else { bad++; console.log(`  FAIL  ${label}: got ${got} want ${want}  (${why})`); }
  };
  one('control fails', classify(false, true, true), 'route-unreachable', 'nothing reached D1; B passing is not readable');
  one('control fails, everything fails', classify(false, false, false), 'route-unreachable', 'the control is checked first on purpose');
  one('THE ANSWER WE WANT', classify(true, true, true), 'returning-supported', 'control ok, plain UPDATE ok, RETURNING ok');
  one('THE ANSWER THAT CHANGES TASK 2', classify(true, true, false), 'no-returning', 'the ONLY difference between C and B is the word RETURNING');
  one('the UPDATE itself is blocked', classify(true, false, false), 'update-path-blocked', 'B and C differ by more than one word, so B proves nothing');
  one('RETURNING works but plain UPDATE does not', classify(true, false, true), 'inconsistent', 'one engine cannot do this; the calls diverged');

  one('B and C differ by exactly one clause',
      SQL.B.replace(` RETURNING ${KEY}`, '') === SQL.C, true,
      'if this drifts, the discriminator stops discriminating and the verdict is noise');
  one('both UPDATEs are zero-row by construction',
      SQL.B.includes('WHERE 1 = 0') && SQL.C.includes('WHERE 1 = 0'), true,
      'a live archive DB; the probe must be unable to change a row');
  one('and both set a column to itself',
      SQL.B.includes(`SET ${COL} = ${COL}`) && SQL.C.includes(`SET ${COL} = ${COL}`), true,
      'belt and braces: a no-op even if the WHERE were ignored');
  one('the table is one the route allows',
      TABLE === 'odds_backfill_progress', true,
      'ALLOWED_TABLES in the /d1/execute handler; anything else returns 403, not a D1 answer');

  one('every state has a consequence',
      ['returning-supported','no-returning','update-path-blocked','route-unreachable','inconsistent']
        .every(s => consequence(s) !== 'unknown state'), true,
      'a verdict the reader has to interpret is a verdict that gets interpreted wrongly');
  // THE LINE ABOVE IS VACUOUS ON ITS OWN. It only visits states that have a
  // real `case`, so it never reaches `default` — mutation R5 rewrote default
  // to the happy answer and this suite stayed green. An unenumerated state must
  // not be able to read as success.
  one('AN UNENUMERATED STATE DOES NOT READ AS SUCCESS',
      /unknown/i.test(consequence('a-state-nobody-wrote')), true,
      'R5: default returning a real consequence makes a state nobody thought of report PASS');
  one('...and it is not any real state\'s text',
      ['returning-supported','no-returning','update-path-blocked','route-unreachable','inconsistent']
        .some(s => consequence(s) === consequence('a-state-nobody-wrote')), false,
      'the default must be distinguishable from every answer, not just from the good one');

  console.log(bad ? `\n${bad} FAILED` : '\nself-test: 13/13');
  console.log('COVERAGE: the classifier and the SQL shape. It does NOT make a network');
  console.log('call, and it cannot tell whether the route is up.');
  process.exit(bad ? 1 : 0);
}

// ---- live ----
const BASE = process.env.RELAY_BASE || 'https://field-relay-nba.jeffunglesbee.workers.dev';
const AUTH = process.env.RELAY_GATE;
if (!AUTH) { console.error('RELAY_GATE not set — refusing to guess the header value.'); process.exit(1); }

async function run(sql) {
  try {
    const r = await fetch(`${BASE}/d1/execute`, {
      method: 'POST',
      headers: { 'X-FIELD-Relay': AUTH, 'Content-Type': 'application/json' },
      body: JSON.stringify({ sql }),
    });
    const text = await r.text();
    let body; try { body = JSON.parse(text); } catch { body = { raw: text.slice(0, 300) }; }
    return { ok: r.ok && body.success === true, status: r.status, body };
  } catch (e) {
    return { ok: false, status: 0, body: { error: String(e && e.message || e) } };
  }
}

const out = [];
const say = (s) => { out.push(s); console.log(s); };

say(`=== D1 RETURNING support  utc=${new Date().toISOString()} ===\n`);
say(`  database via /d1/execute : ARCHIVE_DB (field-archive)`);
say(`  table                    : ${TABLE}\n`);

const A = await run(SQL.A);
say(`  A control   SELECT 1                     -> ${A.ok ? 'ok' : `FAILED (${A.status})`}`);
if (!A.ok) say(`      ${JSON.stringify(A.body).slice(0, 200)}`);

const C = await run(SQL.C);
say(`  C plain     UPDATE ... WHERE 1 = 0       -> ${C.ok ? 'ok' : `FAILED (${C.status})`}`);
if (!C.ok) say(`      ${JSON.stringify(C.body).slice(0, 200)}`);

const B = await run(SQL.B);
say(`  B subject   ... RETURNING ${KEY}          -> ${B.ok ? 'ok' : `FAILED (${B.status})`}`);
if (!B.ok) say(`      ${JSON.stringify(B.body).slice(0, 200)}`);

const state = classify(A.ok, C.ok, B.ok);
say(`\n  verdict: ${state}`);
say(`\n  ${consequence(state)}`);

say(`\nCOVERAGE: THREE statements against ARCHIVE_DB (field-archive), which is NOT`);
say(`the database Task 2 targets. /d1/execute binds env.ARCHIVE_DB and has no path`);
say(`to env.DB (field-d1) at all, and odds_budget is not in its ALLOWED_TABLES, so`);
say(`Task 0b as written cannot be run. RETURNING is a property of the D1 engine`);
say(`rather than of one database, so this answer transfers — but it is an`);
say(`inference across databases and is labelled as one, not measured on field-d1.`);
say(`Rows changed: zero, by construction (WHERE 1 = 0, and SET ${COL} = ${COL}).`);

const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+/, 'Z');
writeFileSync(`outbox/d1-returning-probe-${stamp}.log`, out.join('\n') + '\n');
console.log(`\nwrote outbox/d1-returning-probe-${stamp}.log`);
process.exit(state === 'returning-supported' || state === 'no-returning' ? 0 : 1);
