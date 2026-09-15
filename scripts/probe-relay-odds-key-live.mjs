// Is the WORKER's Odds API key still valid after the 2026-09-15 rotation?
//
// The key lives in TWO stores and only one of them was known to be updated:
//
//   GitHub Actions secret  ->  .github/scripts/odds-backfill.js
//                              PROVEN GOOD: run 35012664679 at 19:16Z read
//                              quota remaining=39534 successfully.
//   Cloudflare Worker secret -> env.ODDS_API_KEY in src/index.js, ambient-do.js,
//                              wp-resolver.js. NOT in wrangler.toml — a separate
//                              store, updated separately.
//
// The signal that prompted this: `${RELAY}/odds/v4/sports` returned 200 with 86
// sports at 17:23Z and 401 at 20:10Z (run 35017969042). The call is byte-
// identical between the two runs — same URL, same UA-only headers, no secret —
// so nothing in this repo changed it. The rotation happened in between.
//
// DO NOT REPORT THE CONCLUSION FROM THE CORRELATION (Rule 100). A 401 could be
// the relay's own gate refusing this caller rather than the vendor refusing the
// relay's key, and those want opposite fixes. This separates them:
//
//   * an UNGATED, CREDIT-FREE relay route that proxies to the vendor
//     -> a 401 here is the vendor rejecting the relay's key
//   * a route that needs no vendor call at all
//     -> a 200 here proves the relay itself is up and serving, so a 401 above
//        is not "the relay is down"
//
// Both statuses AND the first 200 characters of each body are printed, because
// "401" alone cannot say who said it.
//
// /v4/sports costs no credit — oddsBillablePath excludes it in src/index.js.
// READ-ONLY. No writes of any kind.

const RELAY = process.env.RELAY_BASE || 'https://field-relay-nba.jeffunglesbee.workers.dev';
const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

const PROBES = [
  { name: 'vendor passthrough  /odds/v4/sports', path: '/odds/v4/sports', tells: 'vendor key validity' },
  { name: 'relay liveness      /health',          path: '/health',         tells: 'is the worker serving at all' },
];

let vendorStatus = null, relayUp = null;

console.log(`=== relay odds key live probe  relay=${RELAY}  utc=${new Date().toISOString()} ===\n`);

for (const p of PROBES) {
  try {
    const res = await fetch(`${RELAY}${p.path}`, { headers: { 'User-Agent': UA } });
    const body = (await res.text().catch(() => '')).slice(0, 200).replace(/\s+/g, ' ');
    console.log(`  ${p.name}`);
    console.log(`      HTTP ${res.status}   (${p.tells})`);
    console.log(`      body: ${body || '(empty)'}\n`);
    if (p.path === '/odds/v4/sports') vendorStatus = res.status;
    if (p.path === '/health') relayUp = res.ok;
  } catch (e) {
    console.log(`  ${p.name}\n      TRANSPORT FAILURE: ${e.message}\n`);
  }
}

console.log('── VERDICT ──');
if (vendorStatus === null) {
  console.log('  UNDECIDED — the vendor passthrough did not answer at all.');
  process.exit(1);
}
if (vendorStatus === 200) {
  console.log('  The worker\'s ODDS_API_KEY is VALID. Whatever caused the 20:10Z 401');
  console.log('  has cleared or was transient; do not close the question on this alone —');
  console.log('  a transient 401 and a fixed one look identical from one green probe.');
  process.exit(0);
}
if (relayUp === true) {
  console.log(`  The worker is SERVING (/health ok) but its vendor call is ${vendorStatus}.`);
  console.log('  That points at the Cloudflare Worker secret ODDS_API_KEY still holding');
  console.log('  the PRE-ROTATION key. The GitHub Actions copy is already good (run');
  console.log('  35012664679). They are separate stores and were updated separately.');
  console.log('');
  console.log('  IMPACT IF SO: every worker-side Odds API caller is failing — AmbientDO');
  console.log('  in-play capture, the WP resolver, closing-odds capture. The nightly');
  console.log('  backfill is NOT affected; it uses the Actions secret.');
  console.log('');
  console.log('  FIX IS THE OWNER\'S: set the worker secret to the rotated key.');
  console.log('  Not reproduced here, and a session must not hold it.');
} else {
  console.log(`  The vendor call is ${vendorStatus} AND /health did not answer.`);
  console.log('  Cannot attribute to the key — the worker itself may be down.');
}
console.log('\nCOVERAGE: two routes. This does not test AmbientDO, the WP resolver or');
console.log('the cron writers directly; it tests the one passthrough they share a key');
console.log('with. A green here does not prove those three are healthy.');
process.exit(1);
