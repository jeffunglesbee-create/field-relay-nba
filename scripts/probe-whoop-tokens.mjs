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
 * A LADDER, BECAUSE "unreadable" NAMES NO REMEDY. Run 35482911059 returned
 * Cloudflare error 7403 — "the given account is not valid or is not authorized
 * to access this service" — and the first version of this probe could only say
 * that nothing was known. Three different failures produce that one message: a
 * dead token, a token with no D1 scope, and a token scoped away from this
 * database. Each has a different one-line fix, so each gets its own state.
 *
 * @param {object}       r
 * @param {boolean}      r.tokenOk    /user/tokens/verify came back
 * @param {boolean}      r.d1ListOk   the account's D1 databases could be listed
 * @param {boolean|null} r.dbListed   is DB_ID among them (null when not listed)
 * @param {boolean}      r.controlOk  did sqlite_master come back
 * @param {boolean|null} r.listed     is TABLE in it (null when the control failed)
 * @param {number|null}  r.rows       COUNT(*), or null when not run or failed
 */
export function classify({ tokenOk, d1ListOk, dbListed, controlOk, listed, rows }) {
  if (!tokenOk)   return 'token-invalid';
  if (!d1ListOk)  return 'no-d1-scope';
  if (!dbListed)  return 'database-not-in-account';
  if (!controlOk) return 'no-access-to-this-database';
  if (!listed)    return 'absent';
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
    case 'token-invalid':
      return 'NOTHING IS KNOWN ABOUT THE TABLE, and the finding is about the secret: '
           + 'CLOUDFLARE_API_TOKEN did not verify. Fix: re-issue the token, or point the '
           + 'secret at the one deploy.yml is using.';
    case 'no-d1-scope':
      return 'NOTHING IS KNOWN ABOUT THE TABLE, and the finding is about the token\'s '
           + 'permissions: it verifies but cannot list this account\'s D1 databases. '
           + 'Fix: add D1:Read to it. Deploying a Worker with a D1 binding does not need '
           + 'that scope, which is why this has never surfaced before.';
    case 'database-not-in-account':
      return 'NOTHING IS KNOWN ABOUT THE TABLE, and the finding is about the ACCOUNT: D1 '
           + 'lists fine and this database is not in it. Either CLOUDFLARE_ACCOUNT_ID is '
           + 'not the account that owns f26669de, or the database is gone — and if it is '
           + 'gone, so is whoop_tokens, but that must be established, not inferred here.';
    case 'no-access-to-this-database':
      return 'NOTHING IS KNOWN ABOUT THE TABLE. The token reads D1 and this database is '
           + 'in the account, but sqlite_master on it did not come back. A token scoped '
           + 'to specific databases is the usual cause. Do not read an answer off this run.';
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
    if (got === want) console.log(`  PASS  ${label} -> ${JSON.stringify(got)}  (${why})`);
    else { bad++; console.log(`  FAIL  ${label}: got ${JSON.stringify(got)} want ${JSON.stringify(want)}  (${why})`); }
  };
  /** A run where everything above the named rung worked. */
  const ok = (over) => classify({ tokenOk: true, d1ListOk: true, dbListed: true, controlOk: true, listed: true, rows: 1, ...over });

  // Each rung, and each is checked with EVERY LOWER RUNG SET TO THE HAPPY VALUE,
  // so a rung that stopped being consulted would report the answer below it.
  one('dead token', ok({ tokenOk: false }), 'token-invalid', 'the secret itself, not the table');
  one('token verifies, no D1 scope', ok({ d1ListOk: false }), 'no-d1-scope', 'THE STATE RUN 35482911059 PROBABLY WAS; CF 7403 says only "not authorized"');
  one('D1 reads, this database is not in the account', ok({ dbListed: false }), 'database-not-in-account', 'wrong account id, or the database is gone');
  one('database is there, sqlite_master is not', ok({ controlOk: false }), 'no-access-to-this-database', 'a token scoped to some databases and not this one');
  one('THE OUTCOME THAT CLOSES IT', ok({ listed: false, rows: null }), 'absent', 'read off sqlite_master, which is the source and not a copy of it');
  one('THE OUTCOME THAT TRIVIALISES IT', ok({ rows: 0 }), 'empty', 'present and holding nothing');
  one('THE OUTCOME THAT IS ACTUALLY THE OWNER\'S', ok({ rows: 3 }), 'holds-rows', 'live OAuth tokens; a session does not delete these');
  one('listed but not countable', ok({ rows: null }), 'present-uncounted', 'one engine cannot both list a table and refuse to count it');

  // THE LADDER IS ORDERED, and that is the property, not the individual rungs.
  // A lower rung succeeding must never mask a higher one failing.
  one('a dead token outranks every happy answer below it',
      ok({ tokenOk: false, rows: 0 }), 'token-invalid',
      'otherwise an unauthenticated run reports "empty" and the question closes wrongly');
  one('a missing D1 scope outranks an absent table',
      ok({ d1ListOk: false, listed: false }), 'no-d1-scope',
      'THE DEFECT THIS LADDER EXISTS FOR: "cannot look" must not read as "nothing there"');

  one('zero rows is NOT absent',
      ok({ rows: 0 }) !== ok({ listed: false, rows: null }), true,
      'they lead to different sentences: one is a no-op drop, the other is nothing to drop');
  one('absent does not depend on the count',
      [ok({ listed: false, rows: 0 }), ok({ listed: false, rows: 99 })].join('/'), 'absent/absent',
      'if a table is not listed, whatever a count said came from somewhere else; comparing '
      + 'the two to each other would pass with both wrong in the same way');

  // The rows are secrets. These are the assertions that keep them off disk.
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

  // R5's lesson: an enumeration over states that have a `case` never reaches
  // `default`, so on its own it cannot notice default going wrong.
  const STATES = ['absent', 'empty', 'holds-rows', 'present-uncounted',
                  'token-invalid', 'no-d1-scope', 'database-not-in-account',
                  'no-access-to-this-database'];
  one('every enumerated state has a consequence',
      STATES.every(s => consequence(s) !== 'unknown state'), true,
      'a verdict the reader has to interpret is one that gets interpreted wrongly');
  one('AN UNENUMERATED STATE DOES NOT READ AS SUCCESS',
      /unknown/i.test(consequence('a-state-nobody-wrote')), true,
      'the line above is vacuous alone — it never reaches default');
  one('...and default is not any real state\'s text',
      STATES.some(s => consequence(s) === consequence('a-state-nobody-wrote')), false,
      'default must be distinguishable from every answer, not only from the good one');
  one('every state classify() can return is enumerated above',
      STATES.length, 8,
      'a state added to the ladder without a row here is a state nothing checks');

  console.log(bad ? `\n${bad} FAILED` : '\nself-test: 20/20');
  console.log('COVERAGE: the classifier ladder, the SQL shape, and the no-credentials');
  console.log('guard. It makes NO network call and cannot tell whether the token works.');
  process.exit(bad ? 1 : 0);
}

// ---- live ----
const ACCOUNT = process.env.CLOUDFLARE_ACCOUNT_ID;
const TOKEN   = process.env.CLOUDFLARE_API_TOKEN;
if (!ACCOUNT || !TOKEN) {
  console.error('CLOUDFLARE_ACCOUNT_ID / CLOUDFLARE_API_TOKEN not set — refusing to guess.');
  process.exit(1);
}

const CF = 'https://api.cloudflare.com/client/v4';
const AUTH = { Authorization: `Bearer ${TOKEN}` };

/** Any CF API call. NEVER prints the token or any body field but error codes. */
async function cf(path, init = {}) {
  try {
    const r = await fetch(`${CF}${path}`, { ...init, headers: { ...AUTH, ...(init.headers || {}) } });
    const text = await r.text();
    let body; try { body = JSON.parse(text); } catch { body = { raw: text.slice(0, 200) }; }
    return { ok: r.ok && body.success === true, status: r.status, body };
  } catch (e) {
    return { ok: false, status: 0, body: { errors: [{ message: String(e && e.message || e) }] } };
  }
}

/** The error codes only — a CF body can echo account identifiers. */
const why = (res) => (res.body?.errors || []).map(e => `${e.code ?? '?'} ${e.message ?? ''}`).join('; ').slice(0, 200)
                     || `HTTP ${res.status}`;

async function d1Query(sql) {
  const res = await cf(`/accounts/${ACCOUNT}/d1/database/${DB_ID}/query`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sql }) });
  const rows = res.body?.result?.[0]?.results ?? null;
  return { ...res, ok: res.ok && Array.isArray(rows), rows };
}

const out = [];
const say = (s) => { out.push(s); console.log(s); };

say(`=== whoop_tokens: does it exist, does it hold anything  utc=${new Date().toISOString()} ===\n`);
say(`  database : ${DB_ID}`);
say(`             ${DB_NAME}`);
say(`  table    : ${TABLE}\n`);

// Rung 1 — is the secret a working token at all.
const V = await cf('/user/tokens/verify');
say(`  1 token     /user/tokens/verify            -> ${V.ok ? 'ok' : `FAILED (${why(V)})`}`);

// Rung 2 — can it read D1 on this account, and is this database one of them.
let L = { ok: false }, dbListed = null, names = [];
if (V.ok) {
  L = await cf(`/accounts/${ACCOUNT}/d1/database?per_page=100`);
  const dbs = Array.isArray(L.body?.result) ? L.body.result : [];
  say(`  2 d1 scope  list the account's databases   -> ${L.ok ? `ok, ${dbs.length} database(s)` : `FAILED (${why(L)})`}`);
  if (L.ok) {
    dbListed = dbs.some(d => d.uuid === DB_ID);
    names = dbs.map(d => d.name);
    say(`              ${DB_ID.slice(0, 8)} among them         -> ${dbListed ? 'YES' : 'no'}`);
  }
} else {
  say(`  2 d1 scope  NOT RUN — the token did not verify.`);
}

// Rung 3 — the control, which is also the enumeration.
let A = { ok: false }, listed = null;
if (dbListed) {
  A = await d1Query(SQL.A);
  say(`  3 control   sqlite_master table list       -> ${A.ok ? `ok, ${A.rows.length} tables` : `FAILED (${why(A)})`}`);
  if (A.ok) {
    listed = A.rows.some(r => r.name === TABLE);
    say(`              ${TABLE} listed               -> ${listed ? 'YES' : 'no'}`);
  }
} else {
  say(`  3 control   NOT RUN — a rung above it failed, so its answer would not be readable.`);
}

// Rung 4 — the subject. Count only, never a column.
let rows = null;
if (listed) {
  const B = await d1Query(SQL.B);
  rows = B.ok && B.rows.length ? Number(B.rows[0].n) : null;
  say(`  4 subject   SELECT COUNT(*) FROM ${TABLE}   -> ${rows === null ? `FAILED (${why(B)})` : `${rows} row(s)`}`);
} else if (A.ok) {
  say(`  4 subject   NOT RUN — the table is not there, so there is nothing to count.`);
} else {
  say(`  4 subject   NOT RUN — rung 3 did not answer.`);
}

const state = classify({ tokenOk: V.ok, d1ListOk: L.ok, dbListed, controlOk: A.ok, listed, rows });
say(`\n  verdict: ${state}`);
say(`\n  ${consequence(state)}`);

if (L.ok)  say(`\n  D1 databases on this account (${names.length}): ${names.join(', ')}`);
if (A.ok)  say(`  tables in ${DB_ID.slice(0, 8)} (${A.rows.length}): ${A.rows.map(r => r.name).join(', ')}`);

say(`\nCOVERAGE: ONE database of the two this worker binds — ${DB_ID.slice(0, 8)}, the one the`);
say(`removed \`DB\` binding named. field-archive (cc49101c) was NOT checked and does not`);
say(`need to be: the removed Whoop code reached its table through env.DB and through`);
say(`nothing else. Every statement is a SELECT or a GET. No row was read from ${TABLE}`);
say(`itself — only its name and its count — and no response body is printed beyond`);
say(`database names and error codes, so no credential is in this log.`);

const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+/, 'Z');
writeFileSync(`outbox/whoop-tokens-probe-${stamp}.log`, out.join('\n') + '\n');
console.log(`\nwrote outbox/whoop-tokens-probe-${stamp}.log`);

// A verdict that settles the question exits 0. 'unreadable' and
// 'present-uncounted' settle nothing and must not report as a green run.
process.exit(['absent', 'empty', 'holds-rows'].includes(state) ? 0 : 1);
