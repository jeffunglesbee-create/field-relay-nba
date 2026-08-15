// POST-BUILD verification (Rule 68/89) for GET /fantasy/ownership.
// Done condition: the LIVE route returns ok:true, a non-empty table, and
// ownership values that are real percentages — with named artifacts, not "works".

const RELAY = process.env.RELAY_BASE || 'https://field-relay-nba.jeffunglesbee.workers.dev';

(async () => {
  console.log(`=== verify-fantasy-ownership  utc=${new Date().toISOString()} ===\n`);
  const r = await fetch(`${RELAY}/fantasy/ownership?limit=400`, { signal: AbortSignal.timeout(45000) });
  const proxy = r.headers.get('X-FIELD-Proxy');
  const ttl = r.headers.get('X-Cache-TTL');
  const d = await r.json();
  const ids = Object.keys(d.players || {});
  const sample = ids.map(id => d.players[id]).filter(p => typeof p.percentOwned === 'number');
  const top = sample.sort((a, b) => b.percentOwned - a.percentOwned)[0];
  const bad = sample.filter(p => p.percentOwned < 0 || p.percentOwned > 100);

  const checks = [
    ['HTTP 200',                       r.status === 200],
    ['ok:true',                        d.ok === true],
    ['X-FIELD-Proxy stamped',          proxy === 'relay-fantasy-ownership'],
    ['6h cache TTL',                   ttl === '21600'],
    ['count > 100 players',            (d.count || 0) > 100],
    ['every percentOwned in [0,100]',  bad.length === 0],
    ['top player owned > 50%',         top && top.percentOwned > 50],
    ['a player carries proTeamId',     sample.some(p => p.proTeamId != null)],
    ['source names ESPN',             /ESPN/.test(d.source || '')],
  ];

  console.log(`status=${r.status}  X-FIELD-Proxy=${proxy}  count=${d.count}  season=${d.season}`);
  if (top) console.log(`most-owned: ${top.name} (proTeamId ${top.proTeamId}) owned=${top.percentOwned}% started=${top.percentStarted}% adp=${top.adp}`);
  console.log();
  let pass = true;
  for (const [label, ok] of checks) { console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}`); pass = pass && ok; }

  // Cache proof: second hit should be edge-served (fast, identical count).
  const t0 = Date.now();
  const r2 = await fetch(`${RELAY}/fantasy/ownership?limit=400`, { signal: AbortSignal.timeout(45000) });
  const d2 = await r2.json();
  const cacheOk = d2.count === d.count && d2.updated === d.updated;
  console.log(`  ${cacheOk ? 'PASS' : 'WARN'}  second hit identical (edge-cached), ${Date.now() - t0}ms`);

  console.log(`\n=== RESULT: ${pass ? 'PASS' : 'FAIL'} ===`);
  process.exit(pass ? 0 : 1);
})().catch(e => { console.error('FAILED:', e.stack || e.message); process.exit(1); });
