// CC-CMD-2026-08-09-wnba-failover-via-kv, Task 4.
//
// Runner is only the CLIENT; every assertion is about the DEPLOYED relay.
import { adaptWnbaCDN } from '../src/index.js';

const RELAY = process.env.RELAY_BASE || 'https://field-relay-nba.jeffunglesbee.workers.dev';
const AUTH  = { 'X-FIELD-Relay': 'field-relay-cron-2026' };
const DATE  = process.env.PROBE_DATE || new Date().toISOString().slice(0, 10);

const fail = [];
const ok = (c, m) => { console.log(`   ${c ? 'PASS' : 'FAIL'}: ${m}`); if (!c) fail.push(m); };
const get = async (qs, hdrs = {}) => {
  const r = await fetch(`${RELAY}/v2/games?sport=wnba&date=${DATE}${qs}`, { headers: hdrs, signal: AbortSignal.timeout(30000) });
  return { status: r.status, body: await r.json().catch(() => null) };
};

console.log(`=== wnba-failover-verify  date=${DATE}  utc=${new Date().toISOString()} ===`);

// ── 5. Producer wrote, consumer can read the SAME slate ───────────────────
// Runs first: the forced-failure test below is meaningless if KV is empty.
console.log('\n--- 5. producer -> KV ---');
const { execSync } = await import('node:child_process');
try { console.log(execSync('node scripts/wnba-slate-to-kv.mjs', { encoding: 'utf8' })); }
catch (e) { console.log(e.stdout || e.message); fail.push('producer failed'); }

// ── 1. Forced failure -> KV secondary serves ──────────────────────────────
console.log('\n--- 1. forced failure ---');
{
  const { status, body } = await get('&_forcePrimaryFail=1', AUTH);
  console.log(`   HTTP ${status} source=${body?.source} count=${body?.count} fetchedAt=${body?.fetchedAt} staleSeconds=${body?.staleSeconds}`);
  const g = (body?.games || [])[0];
  if (g) console.log(`   sample: ${g.id} ${g.away?.abbr}@${g.home?.abbr} ${g.away?.score}-${g.home?.score} ${g.state}/${g.periodLabel} streams=${g.streams?.length}`);
  ok(status === 200, 'forced failure returns HTTP 200');
  ok(body?.source === 'wnba-kv', `source is wnba-kv (got ${body?.source})`);
  ok(typeof body?.staleSeconds === 'number', 'staleSeconds present — staleness is surfaced, not hidden');
  ok(body?.staleSeconds < 600, `staleSeconds ${body?.staleSeconds} under the 5-min cron bound (+slack)`);
  if (body?.count > 0) ok(String(g?.id || '').startsWith('wnba:'), 'game id carries the wnba: prefix');
  else console.log('   NOTE: zero games — a real WNBA off-day proves the path but not the payload.');
}

// ── 2. Normal path unchanged ──────────────────────────────────────────────
console.log('\n--- 2. normal path ---');
{
  const { status, body } = await get('');
  console.log(`   HTTP ${status} source=${body?.source} count=${body?.count}`);
  ok(body?.source === 'espn-wc', `normal source still espn-wc (got ${body?.source}) — the failover must NOT be the default`);
  ok(body?.staleSeconds === undefined, 'no staleness fields on the live path');
}

// ── 3. Key-path parity against the ESPN primary ───────────────────────────
console.log('\n--- 3. key parity vs adaptESPNBasketball output (live ESPN game) ---');
{
  const { body } = await get('');
  const espnGame = (body?.games || [])[0];
  const sample = adaptWnbaCDN({
    gameId: '1022600236', gameStatus: 3, period: 4, gameClock: '',
    gameTimeUTC: '2026-08-08T17:00:00Z', arenaName: 'Target Center',
    homeTeam: { teamCity: 'Minnesota', teamName: 'Lynx', teamTricode: 'MIN', score: 80, periods: [] },
    awayTeam: { teamCity: 'Las Vegas', teamName: 'Aces', teamTricode: 'LVA', score: 75, periods: [] },
  });
  const paths = (v, p = '') => (v === null || typeof v !== 'object') ? []
    : Array.isArray(v) ? (v.length ? paths(v[0], `${p}[]`) : [])
    : Object.keys(v).flatMap(k => [`${p}${k}`, ...paths(v[k], `${p}${k}.`)]);
  if (!espnGame) { console.log('   SKIP: no live ESPN game to compare against — proves nothing.'); }
  else {
    const missing = paths(espnGame).filter(k => !new Set(paths(sample)).has(k))
      .filter(k => !k.startsWith('situation.') && !k.startsWith('streams['));
    console.log(`   missing from KV adapter: ${JSON.stringify(missing)}`);
    ok(missing.length === 0, 'KV adapter emits the primary\'s full key set');
  }
  ok(Array.isArray(sample.streams) && sample.streams.length === 0,
     'streams is an empty ARRAY, not undefined — the shape holds even with no broadcast data');
}

console.log('');
if (fail.length) { fail.forEach(f => console.error(`FAIL: ${f}`)); process.exit(1); }
console.log('PASS: all assertions held.');
