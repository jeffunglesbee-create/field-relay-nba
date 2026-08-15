// Is the limit param actually bounding the ESPN fetch, or ignored?
// Verify returned 2615 players for limit=400 — investigate, don't rationalize.
const RELAY = process.env.RELAY_BASE || 'https://field-relay-nba.jeffunglesbee.workers.dev';
(async () => {
  for (const lim of [50, 400, 2000]) {
    const t0 = Date.now();
    const r = await fetch(`${RELAY}/fantasy/ownership?limit=${lim}`, { signal: AbortSignal.timeout(45000) });
    const body = await r.text();
    let count = '?'; try { count = JSON.parse(body).count; } catch {}
    console.log(`limit=${String(lim).padStart(4)}  ->  count=${String(count).padStart(5)}  served=${(body.length/1024).toFixed(0)}KB  ${Date.now()-t0}ms  x-source=${r.headers.get('x-field-proxy')||'-'}`);
  }
  console.log('\nIf count is identical regardless of limit -> ESPN ignores the filter limit for this view;');
  console.log('the served table is still small, but the SERVER fetch is unbounded. Decide: accept (small enough) or cap post-fetch.');
  process.exit(0);
})();
