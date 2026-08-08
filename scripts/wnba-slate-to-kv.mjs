// CC-CMD-2026-08-09-wnba-failover-via-kv, Task 2 — the PRODUCER.
//
// Runs on a GitHub runner because wnba.com blocks this relay's Cloudflare
// Worker egress. Measured, not assumed: /web-fetch on the deployed relay
// returned HTTP 200 carrying a 3839-byte HTML error page from two different
// Workers, while this same URL serves a runner real JSON with no headers at
// all (outbox/web-fetch-verify-20260808T234841Z.log).
//
// This is the CI-as-proxy pattern this repo already uses for VERIFICATION,
// applied to data transport instead. The runner fetches and adapts; KV carries
// the result; the relay serves it when ESPN fails.
//
// Imports the REAL adapter from src/index.js rather than reimplementing it, so
// there is exactly one definition of the WNBA V2 shape. A copy here would
// drift from the consumer and produce exactly the silent field mismatch
// CONTRACTS.md exists to prevent.

import { adaptWnbaCDN } from '../src/index.js';

const RELAY = process.env.RELAY_BASE || 'https://field-relay-nba.jeffunglesbee.workers.dev';
const AUTH  = 'field-relay-cron-2026';
const SRC   = 'https://cdn.wnba.com/static/json/liveData/scoreboard/todaysScoreboard_10.json';

const started = new Date().toISOString();
console.log(`=== wnba-slate-to-kv  utc=${started} ===`);

// 15s: this is a cron producer, not a user-facing path. Generous enough to
// tolerate a slow CDN, bounded so a stall does not hold a runner open.
const res = await fetch(SRC, { signal: AbortSignal.timeout(15000) });
console.log(`source: HTTP ${res.status} ${res.headers.get('content-type')}`);
const body = await res.text();

// The CDN serves JSON as text/plain, so content-type cannot be the gate --
// that exact mistake made an earlier probe of mine report a viable source as
// unusable. Parse the body and let the parse be the test.
let data;
try { data = JSON.parse(body); }
catch (e) {
    console.error(`FATAL: source did not return JSON (${e.message}). First 200 chars: ${body.slice(0, 200)}`);
    process.exit(1);
}

const raw = data?.scoreboard?.games || [];
const date = data?.scoreboard?.gameDate || new Date().toISOString().slice(0, 10);
const games = raw.map(adaptWnbaCDN);
console.log(`adapted ${games.length} game(s) for ${date}`);
for (const g of games) {
    console.log(`   ${g.away.abbr} @ ${g.home.abbr}  ${g.away.score}-${g.home.score}  ${g.state}/${g.periodLabel}  ${g.venue}`);
}

const put = await fetch(`${RELAY}/wnba/slate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-FIELD-Relay': AUTH },
    body: JSON.stringify({ date, fetchedAt: new Date().toISOString(), games }),
    signal: AbortSignal.timeout(20000),
});
const putBody = await put.json().catch(() => null);
console.log(`KV write: HTTP ${put.status} ${JSON.stringify(putBody)}`);

if (!put.ok || putBody?.ok !== true) {
    console.error('FATAL: KV write failed');
    process.exit(1);
}
console.log('PASS: slate stored.');
