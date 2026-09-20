#!/usr/bin/env node
/**
 * Does `whoop_tokens` exist, and does it hold anything?
 *
 * WHY THIS IS A PROBE AND NOT A DECISION. Whoop was removed from the worker on
 * 2026-09-19 (098b989) and the `DB` binding that reached its table on 2026-09-20
 * (712227d). What was left open was "drop the whoop_tokens table?", and it was
 * carried as an owner decision for a day. It is not a decision. It is a question
 * nobody asked: no `CREATE TABLE whoop_tokens` exists in any commit — the table
 * was created out of band, if it was created at all — and no session has ever
 * queried it. Three of the four outcomes below settle it without an owner.
 *
 * TRANSPORT: the Cloudflare D1 REST API, not the relay's /d1/execute route.
 * That route binds env.ARCHIVE_DB (field-archive, cc49101c) and has no path to
 * this database. The removed Whoop code used env.DB, whose database_id was
 * f26669de — byte-identical to WC2026_DB's, which is why removing the binding
 * removed a name rather than an access path. f26669de is therefore the only
 * database whoop_tokens could be in, and it is the one queried here.
 *
 * READ-ONLY, AND THE TOKEN COLUMNS ARE NEVER NAMED. whoop_tokens holds live
 * OAuth access and refresh tokens for a real account. This probe reads
 * sqlite_master and a COUNT(*). It must never select, print, or commit a token
 * value, and the self-test below fails if any SQL string names one.
 */
import { writeFileSync } from 'node:fs';

/** The database the removed `DB` binding pointed at — see the header. */
export const DB_ID   = 'f26669de-e772-4b56-a6d1-f8fdea08a4d4';
export const DB_NAME = 'wc2026 (formerly also bound as field-d1)';
export const TABLE   = 'whoop_tokens';

export const SQL = {
  /**
   * CONTROL, and it does double duty. It proves the token can read THIS
   * database — without it an empty answer is unreadable, since "no such table"
   * and "no permission" arrive looking the same — and it enumerates, so the
   * absence of whoop_tokens is read off the source rather than inferred from a
   * query that returned nothing.
   */
  A: "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name",
  /** SUBJECT. Count only. Never a column. */
  B: `SELECT COUNT(*) AS n FROM ${TABLE}`,
};

/**
 * @param {boolean} controlOk    did sqlite_master come back
 * @param {boolean|null} listed  is TABLE in it (null when the control failed)
 * @param {number|null} rows     COUNT(*), or null when it was not run or failed
 */
export function classify(controlOk, listed, rows) {
  if (!controlOk) return 'unreadable';
  if (!listed) return 'absent';
  if (rows === null) return 'present-uncounted';
  if (rows === 0) return 'empty';
  return 'holds-rows';
}

/** What each state means for the open question, so the reader need not derive it. */
export function consequence(state) {
  switch (state) {
    case 'absent':
      return 'NOTHING TO DROP. The table was never created. The open item closes here, '
           + 'with no owner decision and no write.';
    case 'empty':
      return 'THE DECISION IS EMPTY. The table exists and holds nothing, so dropping it '
           + 'removes a name and no data. Still a write, so still the owner\'s word — but '
           + 'nothing is at stake in it.';
    case 'holds-rows':
      return 'GENUINELY THE OWNER\'S CALL, and now with a count in hand. The rows are '
           + 'OAuth tokens for a real Whoop account. The client secret was rotated on '
           + '2026-09-19, so any refresh token here is already dead — but that is a '
           + 'reason the rows are worthless, not a reason a session may delete them.';
    case 'unreadable':
      return 'NOTHING IS KNOWN. sqlite_master did not come back, so the API token cannot '
           + 'read this database and an absent table is indistinguishable from an absent '
           + 'permission. Do not read an answer off this run.';
    case 'present-uncounted':
      return 'INCONSISTENT. sqlite_master lists the table and COUNT(*) on it failed. That '
           + 'cannot come from one engine. Fix the probe; do not read a verdict.';
    default:
      return 'unknown state';
  }
}

if (process.argv.includes('--self-test')) {
  let bad = 0;
  const one = (label, got, want, why) => {
    if (got === want) console.log(`  PASS  ${label} -> ${got}  (${why})`);
    else { bad++; console.log(`  FAIL  ${label}: got ${JSON.stringify(got)} want ${JSON.stringify(want)}  (${why})`); }
  };

  one('control fails', classify(false, true, 5), 'unreadable',
      'the control is checked first; a listed table under a failed control is not a reading');
  one('control fails, nothing else known', classify(false, null, null), 'unreadable',
      'the ordinary shape of an auth failure');
  one('THE OUTCOME THAT CLOSES IT', classify(true, false, null), 'absent',
      'read off sqlite_master, which is the source and not a copy of it');
  one('THE OUTCOME THAT TRIVIALISES IT', classify(true, true, 0), 'empty',
      'present and holding nothing');
  one('THE OUTCOME THAT IS ACTUALLY THE OWNER\'S', classify(true, true, 3), 'holds-rows',
      'live OAuth tokens; a session does not delete these');
  one('listed but not countable', classify(true, true, null), 'present-uncounted',
      'one engine cannot both list a table and refuse to count it');

  // A zero count must not collapse into the absent branch, and an absent table
  // must not borrow a count. Both are the absence-collapse class (Rule 99).
  one('zero rows is NOT absent', classify(true, true, 0) !== classify(true, false, null), true,
      'they lead to different sentences: one is a no-op drop, the other is nothing to drop');
  one('absent does not depend on the count',
      [classify(true, false, 0), classify(true, false, 99)].join('/'), 'absent/absent',
      'if a table is not listed, whatever a count said came from somewhere else; comparing '
      + 'the two to each other would pass with both wrong in the same way');

  // The rows are secrets. This is the assertion that keeps them off disk.
  const everySql = Object.values(SQL).join(' | ').toLowerCase();
  one('NO SQL NAMES A TOKEN COLUMN',
      /access_token|refresh_token|client_secret|expires_at/.test(everySql), false,
      'whoop_tokens holds live OAuth credentials and this artifact is committed to a public repo');
  one('the subject query is a count, not a select of rows',
      /^select count\(\*\) as n from \w+$/.test(SQL.B.toLowerCase()), true,
      'SELECT * would put token values in the log');
  one('no statement can write',
      /\b(insert|update|delete|drop|alter|create|replace)\b/.test(everySql), false,
      'the whole point is that this run needs no approval');

  one('the database queried is the one the removed DB binding named',
      DB_ID, 'f26669de-e772-4b56-a6d1-f8fdea08a4d4',
      'from 712227d\'s diff; querying the archive database would answer a different question');

  // R5's lesson from probe-d1-returning: an enumeration over states that have a
  // `case` never reaches `default`, so it cannot notice default going wrong.
  const STATES = ['absent', 'empty', 'holds-rows', 'unreadable', 'present-uncounted'];
  one('every enumerated state has a consequence',
      STATES.every(s => consequence(s) !== 'unknown state'), true,
      'a verdict the reader has to interpret is one that gets interpreted wrongly');
  one('AN UNENUMERATED STATE DOES NOT READ AS SUCCESS',
      /unknown/i.test(consequence('a-state-nobody-wrote')), true,
      'the line above is vacuous alone — it never reaches default');
  one('...and default is not any real state\'s text',
      STATES.some(s => consequence(s) === consequence('a-state-nobody-wrote')), false,
      'default must be distinguishable from every answer, not only from the good one');

  console.log(bad ? `\n${bad} FAILED` : '\nself-test: 15/15');
  console.log('COVERAGE: the classifier, the SQL shape, and the no-credentials guard.');
  console.log('It makes NO network call and cannot tell whether the API token works.');
  process.exit(bad ? 1 : 0);
}

// ---- live ----
const ACCOUNT = process.env.CLOUDFLARE_ACCOUNT_ID;
const TOKEN   = process.env.CLOUDFLARE_API_TOKEN;
if (!ACCOUNT || !TOKEN) {
  console.error('CLOUDFLARE_ACCOUNT_ID / CLOUDFLARE_API_TOKEN not set — refusing to guess.');
  process.exit(1);
}

async function query(sql) {
  const url = `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}/d1/database/${DB_ID}/query`;
  try {
    const r = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ sql }),
    });
    const text = await r.text();
    let body; try { body = JSON.parse(text); } catch { body = { raw: text.slice(0, 300) }; }
    const rows = body?.result?.[0]?.results ?? null;
    return { ok: r.ok && body.success === true && Array.isArray(rows), status: r.status, rows, body };
  } catch (e) {
    return { ok: false, status: 0, rows: null, body: { error: String(e && e.message || e) } };
  }
}

const out = [];
const say = (s) => { out.push(s); console.log(s); };

say(`=== whoop_tokens: does it exist, does it hold anything  utc=${new Date().toISOString()} ===\n`);
say(`  database : ${DB_ID}`);
say(`             ${DB_NAME}`);
say(`  table    : ${TABLE}\n`);

const A = await query(SQL.A);
say(`  A control   sqlite_master table list      -> ${A.ok ? `ok, ${A.rows.length} tables` : `FAILED (${A.status})`}`);
if (!A.ok) say(`      ${JSON.stringify(A.body).slice(0, 300)}`);

const listed = A.ok ? A.rows.some(r => r.name === TABLE) : null;
if (A.ok) say(`              ${TABLE} listed              -> ${listed ? 'YES' : 'no'}`);

let rows = null;
if (listed) {
  const B = await query(SQL.B);
  rows = B.ok && B.rows.length ? Number(B.rows[0].n) : null;
  say(`  B subject   SELECT COUNT(*) FROM ${TABLE}  -> ${rows === null ? `FAILED (${B.status})` : `${rows} row(s)`}`);
  if (rows === null) say(`      ${JSON.stringify(B.body).slice(0, 300)}`);
} else if (A.ok) {
  say(`  B subject   NOT RUN — the table is not there, so there is nothing to count.`);
}

const state = classify(A.ok, listed, rows);
say(`\n  verdict: ${state}`);
say(`\n  ${consequence(state)}`);

if (A.ok) {
  say(`\n  tables in this database (${A.rows.length}): ${A.rows.map(r => r.name).join(', ')}`);
}

say(`\nCOVERAGE: ONE database of the two this worker binds — ${DB_ID.slice(0, 8)}, which is`);
say(`the one the removed \`DB\` binding named. field-archive (cc49101c) was NOT checked`);
say(`and does not need to be: the removed Whoop code reached its table through env.DB`);
say(`and through nothing else. Two statements, both SELECT. No row was read from`);
say(`${TABLE} itself — only its name and its count — so no credential is in this log.`);

const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+/, 'Z');
writeFileSync(`outbox/whoop-tokens-probe-${stamp}.log`, out.join('\n') + '\n');
console.log(`\nwrote outbox/whoop-tokens-probe-${stamp}.log`);

// A verdict that settles the question exits 0. 'unreadable' and
// 'present-uncounted' settle nothing and must not report as a green run.
process.exit(['absent', 'empty', 'holds-rows'].includes(state) ? 0 : 1);
