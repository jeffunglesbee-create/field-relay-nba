#!/usr/bin/env node
// TASK 0 premise 2 of docs/CC-CMD-2026-10-22-nba-cdn-403-in-season.md: is the
// in-season 403 the relay's egress, or the URL? Fetched from a GitHub Actions
// runner, in one run, so the four answers are taken minutes apart at most:
//
//   direct, bare      cdn.nba.com with no headers
//   direct, headers   cdn.nba.com with the relay's NBA_HEADERS (read from src/index.js)
//   relay             the relay's /nba/ proxy of the same file
//   relay board       /v2/games?sport=nba for today's ET date
//
// plus ESPN's NBA scoreboard for the same date, the adapter TASK 1 would move
// to if the CDN refuses the Worker.
//
//   node scripts/nba-cdn-egress-probe.mjs              (network; CI)
//   node scripts/nba-cdn-egress-probe.mjs --self-test  (verdict only; no network)

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RELAY = 'https://field-relay-nba.jeffunglesbee.workers.dev';
const CDN = 'https://cdn.nba.com/static/json/liveData/scoreboard/todaysScoreboard_00.json';

// The verdict TASK 1 branches on. Only a 200 with games counts as the CDN
// serving: a 200 whose JSON has no scoreboard is not an answer either way.
export function verdict({ bare, headed, relay }) {
  const serves = (r) => r?.status === 200 && Number.isInteger(r.games);
  const refused = (r) => r?.status === 403;
  if ((serves(bare) || serves(headed)) && refused(relay)) return 'cdn-refuses-the-worker';
  if (refused(bare) && refused(headed) && refused(relay)) return 'url-or-headers-changed';
  if (serves(relay)) return 'relay-served';
  return 'inconclusive';
}

// The headers the relay sends, read from source so an edit there cannot leave
// this probe testing the old set.
export function relayHeaders(src) {
  const m = src.match(/const NBA_HEADERS = \{([\s\S]*?)\n\};/);
  if (!m) throw new Error('NBA_HEADERS not found in src/index.js');
  const out = {};
  for (const line of m[1].split('\n')) {
    const kv = line.match(/^\s*'([^']+)':\s*'([^']*)',?\s*$/);
    if (kv) out[kv[1]] = kv[2];
  }
  if (!Object.keys(out).length) throw new Error('NBA_HEADERS parsed to nothing');
  return out;
}

function etDate(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(now);
}

async function read(label, url, headers) {
  const t = Date.now();
  try {
    const r = await fetch(url, { headers, redirect: 'manual' });
    const body = await r.text();
    let games = null, source = null;
    try {
      const j = JSON.parse(body);
      if (Array.isArray(j?.scoreboard?.games)) games = j.scoreboard.games.length;
      else if (Array.isArray(j?.games)) games = j.games.length;
      else if (Array.isArray(j?.events)) games = j.events.length;
      source = j?.source ?? null;
    } catch (_) { /* not JSON */ }
    return { label, url, status: r.status, ms: Date.now() - t, bytes: body.length,
      type: r.headers.get('content-type'), server: r.headers.get('server'),
      games, source, head: games === null ? body.slice(0, 160).replace(/\s+/g, ' ') : undefined };
  } catch (e) {
    return { label, url, status: 0, ms: Date.now() - t, error: String(e?.message ?? e) };
  }
}

if (process.argv.includes('--self-test')) {
  const ok = (s, g = 3) => ({ status: s, games: g });
  const cases = [
    [{ bare: ok(200), headed: ok(200), relay: ok(403, null) }, 'cdn-refuses-the-worker', 'runner served, relay refused'],
    [{ bare: ok(403, null), headed: ok(200), relay: ok(403, null) }, 'cdn-refuses-the-worker', 'served only with the headers'],
    [{ bare: ok(403, null), headed: ok(403, null), relay: ok(403, null) }, 'url-or-headers-changed', 'everyone refused'],
    [{ bare: ok(200), headed: ok(200), relay: ok(200) }, 'relay-served', 'nothing to fix at the CDN'],
    [{ bare: ok(200, null), headed: ok(200, null), relay: ok(403, null) }, 'inconclusive', 'a 200 with no scoreboard is not an answer'],
    [{ bare: ok(0, null), headed: ok(0, null), relay: ok(403, null) }, 'inconclusive', 'the runner could not reach the CDN'],
  ];
  let pass = 0;
  for (const [input, want, why] of cases) {
    const got = verdict(input);
    const good = got === want;
    if (good) pass++;
    console.log(`${good ? 'PASS' : 'FAIL'}  ${want.padEnd(24)} got ${got}  (${why})`);
  }
  const src = fs.readFileSync(path.join(ROOT, 'src/index.js'), 'latin1');
  const h = relayHeaders(src);
  const hOk = h['User-Agent']?.startsWith('Mozilla/') && h.Origin === 'https://www.nba.com';
  console.log(`${hOk ? 'PASS' : 'FAIL'}  NBA_HEADERS read from src/index.js (${Object.keys(h).length} headers)`);
  console.log(`\nself-test: ${pass + (hOk ? 1 : 0)}/${cases.length + 1}`);
  process.exit(pass === cases.length && hOk ? 0 : 1);
}

const now = new Date();
const date = etDate(now);
const headers = relayHeaders(fs.readFileSync(path.join(ROOT, 'src/index.js'), 'latin1'));
const rows = [
  await read('direct, bare', CDN, {}),
  await read('direct, headers', CDN, headers),
  await read('relay', `${RELAY}/nba/liveData/scoreboard/todaysScoreboard_00.json`, {}),
  await read('relay board', `${RELAY}/v2/games?sport=nba&date=${date}`, {}),
  await read('espn', `https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard?dates=${date.replaceAll('-', '')}`, {}),
];
console.log(`=== NBA CDN egress probe  utc=${now.toISOString()}  ET date ${date} ===`);
for (const r of rows) console.log(JSON.stringify(r));
const v = verdict({ bare: rows[0], headed: rows[1], relay: rows[2] });
console.log(`\nVERDICT: ${v}`);
console.log('COVERAGE: one read of each URL from one GitHub-hosted runner at one instant. A runner IP is');
console.log('not a Cloudflare egress IP, which is the point; it is also one IP, not every runner\'s.');
