#!/usr/bin/env node
// Read-only: which (sport label, date) pairs does the archive hold for labels matching a LIKE pattern, and how many of those rows already carry a bsd_event_id?
// Counts and dates only, from the relay's own archive (ESPN-sourced rows; no BSD data is read or written). SELECT through the authenticated /d1/execute, the way
// scripts/espn-core-mirror.mjs reads it. Written for docs/CC-CMD-2026-10-27-bsd-event-id-on-game-rows.md (the UEFA labels and the EFL Championship): which dates must a
// fixture capture, and what does the archive hold for a label before anything is changed.
//
//   RELAY_SHARED_SECRET=... node scripts/read-archive-label-dates.mjs --like "UEFA%,EFL%"      writes outbox/archive-label-dates-<stamp>.json
//   node scripts/read-archive-label-dates.mjs --self-test
import fs from 'node:fs';
import http from 'node:http';
import { pathToFileURL } from 'node:url';

const TABLES = ['regular_season_games', 'postseason_games'];
export const LIKE = /^[A-Za-z0-9 %.-]{1,40}$/;

/** The one statement per table and pattern. A pattern is bound, never spliced in, and must look like a label. */
export function queryFor(table, like) {
  if (!TABLES.includes(table)) throw new Error(`not a game table: ${table}`);
  if (!LIKE.test(like)) throw new Error(`not a label pattern: ${JSON.stringify(like)}`);
  return { sql: `SELECT sport, date, COUNT(*) AS n, COUNT(bsd_event_id) AS joined FROM ${table} WHERE sport LIKE ? GROUP BY sport, date ORDER BY date, sport`, params: [like] };
}

/** { sport, date, n, joined } rows from a d1 answer, or null when the answer is not a results array (a failed read is never "no rows"). */
export function rowsOf(body) {
  if (body === null || typeof body !== 'object' || !Array.isArray(body.results)) return null;
  const out = [];
  for (const r of body.results) {
    if (r === null || typeof r !== 'object' || typeof r.sport !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(String(r.date)) || !Number.isInteger(r.n) || !Number.isInteger(r.joined)) return null;
    out.push({ sport: r.sport, date: String(r.date), n: r.n, joined: r.joined });
  }
  return out;
}

/** Totals per label and per table, and the distinct dates, from the rows. */
export function summarise(byTable) {
  const labels = Object.create(null);
  const dates = new Set();
  for (const [table, rows] of Object.entries(byTable)) {
    for (const r of rows) {
      labels[r.sport] ??= { rows: 0, joined: 0, dates: new Set(), tables: Object.create(null) };
      const l = labels[r.sport];
      l.rows += r.n; l.joined += r.joined; l.dates.add(r.date); l.tables[table] = (l.tables[table] ?? 0) + r.n;
      dates.add(r.date);
    }
  }
  return {
    labels: Object.fromEntries(Object.entries(labels).map(([k, v]) => [k, { rows: v.rows, joined: v.joined, dates: v.dates.size, firstDate: [...v.dates].sort()[0], lastDate: [...v.dates].sort().at(-1), tables: v.tables }])),
    dates: [...dates].sort(),
  };
}

async function d1(relay, secret, sql, params) {
  const r = await fetch(`${relay}/d1/execute`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-FIELD-Relay': secret }, body: JSON.stringify({ sql, params }), signal: AbortSignal.timeout(30000), redirect: 'manual' });
  const text = await r.text();
  let body;
  try { body = JSON.parse(text); } catch { throw new Error(`d1 HTTP ${r.status}, not JSON`); }
  if (r.status !== 200 || body.success === false || body.ok === false) throw new Error(`d1 HTTP ${r.status}`);
  return body;
}

export async function read({ relay, secret, likes }) {
  const byTable = Object.create(null);
  for (const table of TABLES) {
    byTable[table] = [];
    for (const like of likes) {
      const q = queryFor(table, like);
      const rows = rowsOf(await d1(relay, secret, q.sql, q.params));
      if (rows === null) throw new Error(`the ${table} read for ${like} did not answer a results array of well-formed rows`);
      byTable[table].push(...rows);
    }
  }
  return byTable;
}

async function main() {
  const i = process.argv.indexOf('--like');
  const likes = (i > 0 ? process.argv[i + 1] : '').split(',').map((s) => s.trim()).filter(Boolean);
  if (likes.length === 0) { console.error('--like "PATTERN[,PATTERN]" is required'); process.exit(1); }
  const secret = process.env.RELAY_SHARED_SECRET;
  if (!secret) { console.error('RELAY_SHARED_SECRET is not set'); process.exit(1); }
  const relay = process.env.RELAY_URL || 'https://field-relay-nba.jeffunglesbee.workers.dev';
  const byTable = await read({ relay, secret, likes });
  const s = summarise(byTable);
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const out = { ts: new Date().toISOString(), likes, tablesRead: TABLES, ...s, rowsByTable: byTable };
  fs.mkdirSync('outbox', { recursive: true });
  fs.writeFileSync(`outbox/archive-label-dates-${stamp}.json`, JSON.stringify(out, null, 2));
  console.log(`labels: ${Object.entries(s.labels).map(([k, v]) => `${k}: ${v.rows} rows on ${v.dates} dates (${v.joined} with a bsd_event_id), ${v.firstDate} to ${v.lastDate}`).join(' | ') || 'none'}; ${s.dates.length} distinct dates; tables read: ${TABLES.join(', ')}`);
  if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `dates=${s.dates.join(',')}\n`);
}

// ---------------------------------------------------------------- self-test: the pure parts, then a stub relay
async function selfTest() {
  let failed = 0, n = 0;
  const eq = (name, got, want) => { n++; if (JSON.stringify(got) !== JSON.stringify(want)) { failed++; console.log(`FAIL  ${name}\n      got  ${JSON.stringify(got)}\n      want ${JSON.stringify(want)}`); } };
  eq('queryFor binds the pattern and names the table', queryFor('regular_season_games', 'UEFA%'), { sql: 'SELECT sport, date, COUNT(*) AS n, COUNT(bsd_event_id) AS joined FROM regular_season_games WHERE sport LIKE ? GROUP BY sport, date ORDER BY date, sport', params: ['UEFA%'] });
  for (const bad of ["x'; DROP TABLE t; --", '', 'a'.repeat(41), 'UEFA%\n']) { let msg = null; try { queryFor('regular_season_games', bad); } catch (e) { msg = e.message; } eq(`a pattern that is not a label is refused: ${JSON.stringify(bad).slice(0, 20)}`, /not a label pattern/.test(msg ?? ''), true); }
  { let msg = null; try { queryFor('users', 'UEFA%'); } catch (e) { msg = e.message; } eq('a table that is not a game table is refused', /not a game table/.test(msg ?? ''), true); }
  eq('rowsOf reads well-formed rows', rowsOf({ results: [{ sport: 'UEFA Champions League', date: '2026-09-16', n: 4, joined: 0 }] }), [{ sport: 'UEFA Champions League', date: '2026-09-16', n: 4, joined: 0 }]);
  eq('rowsOf: an empty results array is an empty answer, not a failure', rowsOf({ results: [] }), []);
  for (const [name, body] of [['no results array', {}], ['null', null], ['a row with no sport', { results: [{ date: '2026-09-16', n: 1, joined: 0 }] }], ['a date that is not a date', { results: [{ sport: 'x', date: '16/09/2026', n: 1, joined: 0 }] }], ['a count that is text', { results: [{ sport: 'x', date: '2026-09-16', n: '1', joined: 0 }] }]]) eq(`rowsOf refuses ${name}`, rowsOf(body), null);
  const s = summarise({ regular_season_games: [{ sport: 'A', date: '2026-09-02', n: 3, joined: 1 }, { sport: 'A', date: '2026-09-01', n: 2, joined: 0 }, { sport: 'B', date: '2026-09-02', n: 1, joined: 1 }], postseason_games: [{ sport: 'A', date: '2026-09-03', n: 4, joined: 0 }] });
  eq('summarise: per label rows, joined, dates, range and tables', s.labels, { A: { rows: 9, joined: 1, dates: 3, firstDate: '2026-09-01', lastDate: '2026-09-03', tables: { regular_season_games: 5, postseason_games: 4 } }, B: { rows: 1, joined: 1, dates: 1, firstDate: '2026-09-02', lastDate: '2026-09-02', tables: { regular_season_games: 1 } } });
  eq('summarise: the distinct dates, sorted', s.dates, ['2026-09-01', '2026-09-02', '2026-09-03']);
  // a stub relay: answers per statement, and refuses the wrong secret
  const seen = [];
  const server = http.createServer((req, res) => {
    let b = ''; req.on('data', (d) => { b += d; });
    req.on('end', () => {
      const j = JSON.parse(b || '{}'); seen.push({ secret: req.headers['x-field-relay'], sql: j.sql, params: j.params });
      if (req.headers['x-field-relay'] !== 'good') { res.writeHead(401); res.end('{"error":"no"}'); return; }
      const table = /FROM (\w+)/.exec(j.sql)[1];
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ success: true, results: table === 'regular_season_games' ? [{ sport: 'UEFA Champions League', date: '2026-09-16', n: 4, joined: 0 }] : [] }));
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const relay = `http://127.0.0.1:${server.address().port}`;
  const got = await read({ relay, secret: 'good', likes: ['UEFA%', 'EFL%'] });
  eq('read: both tables, both patterns, in order, with the secret on every request', [seen.length, seen.every((x) => x.secret === 'good'), seen.map((x) => x.params[0])], [4, true, ['UEFA%', 'EFL%', 'UEFA%', 'EFL%']]);
  eq('read: the rows of each table', [got.regular_season_games.length, got.postseason_games.length], [2, 0]);
  let refused = null; try { await read({ relay, secret: 'bad', likes: ['UEFA%'] }); } catch (e) { refused = e.message; }
  eq('read: a refused secret throws, it is not an empty answer', /d1 HTTP 401/.test(refused ?? ''), true);
  server.closeAllConnections(); await new Promise((r) => server.close(r));
  console.log(failed === 0 ? `ok ${n} assertions` : `${failed} of ${n} FAILED`);
  return failed === 0 ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.includes('--self-test')) selfTest().then((c) => process.exit(c));
  else main().catch((e) => { console.error('read-archive-label-dates failed:', String(e && e.message ? e.message : e).replace(process.env.RELAY_SHARED_SECRET || '\u0000', '[redacted]')); process.exit(1); });
}
