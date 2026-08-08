// CC-CMD-2026-08-06-relay-web-fetch-proxy, Task 4.
// Plus: resolves the Worker-egress question left open by
// CC-CMD-2026-08-09-wnba-secondary-source.
//
// THE KEY POINT ABOUT WHERE THIS RUNS. This script runs on a GitHub runner,
// but that does NOT make it a runner-egress test. The runner is only the
// CLIENT: it calls the deployed relay, and the relay performs the outbound
// fetch from its own Cloudflare Worker egress. So what this measures is
// exactly what could not be measured before -- what THIS relay can reach.
//
// That distinction is the whole reason the WNBA CC-CMD stopped. cdn.wnba.com
// served real JSON to a runner (bare, no headers) and an HTML error page to a
// Worker, which pointed at egress rather than headers -- but the Worker that
// saw the error page was html_probe's, not this relay's.

const RELAY = process.env.RELAY_BASE || 'https://field-relay-nba.jeffunglesbee.workers.dev';
const AUTH  = { 'X-FIELD-Relay': 'field-relay-cron-2026' };

async function webFetch(target, opts = {}) {
  const r = await fetch(`${RELAY}/web-fetch?url=${encodeURIComponent(target)}`, {
    headers: opts.noAuth ? {} : AUTH,
    signal: AbortSignal.timeout(30000),
  });
  let body; try { body = await r.json(); } catch { body = null; }
  return { status: r.status, body };
}

const fail = [];
const ok = (cond, msg) => { console.log(`   ${cond ? 'PASS' : 'FAIL'}: ${msg}`); if (!cond) fail.push(msg); };

console.log(`=== web-fetch-verify  relay=${RELAY}  utc=${new Date().toISOString()} ===`);

// ── 1. Positive: a real public URL returns real extracted text ─────────────
console.log('\n--- 1. positive: real public URL ---');
{
  const { status, body } = await webFetch('https://example.com/');
  console.log(`   HTTP ${status} upstream=${body?.status} bytes=${body?.bytes} ct=${body?.contentType}`);
  console.log(`   text: ${JSON.stringify((body?.text || '').slice(0, 160))}`);
  ok(status === 200 && body?.ok === true, 'public URL fetched');
  ok(/example domain/i.test(body?.text || ''), 'extracted text contains real page content, not tags');
  ok(!/<html|<script/i.test(body?.text || ''), 'HTML tags were stripped, not passed through raw');
}

// ── 2. Negatives: each must be REJECTED, not silently proxied ──────────────
console.log('\n--- 2. negative cases ---');
for (const [label, target, expect] of [
  ['private IP 10/8',        'http://10.0.0.1/',                 400],
  ['loopback',               'http://127.0.0.1/',                400],
  ['cloud metadata',         'http://169.254.169.254/latest/',   400],
  ['IPv6 loopback',          'http://[::1]/',                    400],
  ['file scheme',            'file:///etc/passwd',               400],
  ['data scheme',            'data:text/plain,hello',            400],
  ['this relay itself',      `${RELAY}/health`,                  400],
]) {
  const { status, body } = await webFetch(target);
  console.log(`   ${label.padEnd(20)} -> HTTP ${status} ${JSON.stringify(body?.error || '').slice(0, 90)}`);
  ok(status === expect && body?.ok === false, `${label} rejected with ${expect}`);
}

// ── 2b. DNS-resolution guard: a PUBLIC hostname resolving to a private IP ──
// The string-check-only version of this guard would pass localtest.me straight
// through, because nothing about the name looks private. It resolves to
// 127.0.0.1. This is the case the CC-CMD singled out.
console.log('\n--- 2b. public hostname that resolves to a private IP ---');
{
  const { status, body } = await webFetch('http://localtest.me/');
  console.log(`   localtest.me -> HTTP ${status} ${JSON.stringify(body?.error || '')}`);
  ok(status === 400 && body?.ok === false, 'hostname resolving to 127.0.0.1 rejected by the DNS guard');
}

// ── 3. Auth gate ──────────────────────────────────────────────────────────
console.log('\n--- 3. auth gate ---');
{
  const { status, body } = await webFetch('https://example.com/', { noAuth: true });
  console.log(`   unauthenticated -> HTTP ${status} ${JSON.stringify(body?.error || '')}`);
  ok(status === 401, 'unauthenticated caller rejected — not an open proxy');
}

// ── 4. THE WORKER-EGRESS QUESTION ─────────────────────────────────────────
console.log('\n--- 4. WNBA sources, from THIS relay\'s Worker egress ---');
for (const [label, target] of [
  ['cdn.wnba.com scoreboard', 'https://cdn.wnba.com/static/json/liveData/scoreboard/todaysScoreboard_10.json'],
  ['cdn.wnba.com schedule',   'https://cdn.wnba.com/static/json/staticData/scheduleLeagueV2_10.json'],
  ['stats.wnba.com sbv2',     'https://stats.wnba.com/stats/scoreboardv2?GameDate=08%2F08%2F2026&LeagueID=10&DayOffset=0'],
]) {
  const { status, body } = await webFetch(target);
  const t = body?.text || '';
  let games = null;
  try { const j = JSON.parse(t); games = j?.scoreboard?.games?.length ?? j?.resultSets?.[0]?.rowSet?.length ?? j?.leagueSchedule?.gameDates?.length ?? null; } catch { /* not JSON */ }
  const blocked = /unable to process your request|Access Denied/i.test(t);
  console.log(`   ${label.padEnd(26)} HTTP ${status} upstream=${body?.status} bytes=${body?.bytes} ` +
              `parsedGames=${games} ${blocked ? '<- BLOCKED (error page)' : ''}`);
  if (t) console.log(`      starts: ${JSON.stringify(t.slice(0, 120))}`);
}
console.log('\n   Reading this: parsedGames>0 means THIS relay can reach the source and');
console.log('   a WNBA secondary is buildable in-Worker. An error page means Worker');
console.log('   egress really is blocked and the failover cannot live in the Worker.');

console.log('');
if (fail.length) { console.error(`${fail.length} FAILURES`); process.exit(1); }
console.log('PASS: all positive, negative, DNS-guard and auth assertions held.');
