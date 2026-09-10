// CC-CMD-2026-09-07-session-health-queue-coverage — TASK 3.
//
// Calls the DEPLOYED session_health tool and prints its queue block verbatim.
// The done condition is the live response, not a local reproduction of the
// query — a local run would be testing this session's code against this
// session's expectations.

const RELAY = process.env.RELAY_BASE || 'https://field-relay-nba.jeffunglesbee.workers.dev';
const MCP = process.env.FIELD_MCP_SECRET;
if (!MCP) { console.error('FIELD_MCP_SECRET is not set. This script will not guess it.'); process.exit(1); }

const r = await fetch(`${RELAY}/mcp`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${MCP}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call',
                           params: { name: 'session_health', arguments: {} } }),
});
const text = await r.text();
if (!r.ok) { console.error(`HTTP ${r.status}: ${text.slice(0, 500)}`); process.exit(1); }

let health;
try {
    const body = JSON.parse(text);
    health = JSON.parse(body.result.content[0].text);
} catch (e) {
    console.error(`could not parse session_health: ${e.message}`);
    console.error(text.slice(0, 800));
    process.exit(1);
}

const q = health.cc_cmd_queue;
console.log('--- cc_cmd_queue, verbatim from the live session_health ---');
console.log(JSON.stringify(q, null, 2));

let failed = 0;
const check = (n, ok, d) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}`); if (!ok) { failed++; if (d) console.log(`      → ${d}`); } };

check('the queue block is present and not "unavailable"',
    q && typeof q === 'object', `got ${JSON.stringify(q)}`);
if (!q || typeof q !== 'object') process.exit(1);

check('the three counts account for every row',
    q.open + q.undetermined + q.closed === q.total,
    `${q.open} + ${q.undetermined} + ${q.closed} !== ${q.total}`);

check('coverage is DECLARED — returned and truncated are both present',
    typeof q.returned === 'number' && typeof q.truncated === 'boolean',
    `returned=${q.returned} truncated=${q.truncated}`);

check('returned matches the items actually in the payload',
    q.returned === (q.items || []).length,
    `returned=${q.returned}, items=${(q.items || []).length} — the old code applied the stale `
    + 'filter after the LIMIT, so this could not have held');

// The key the CC-CMD calls permanently invisible.
const keys = [...(q.items || []), ...(q.undetermined_items || [])].map(x => x.key);
check("'playground-weatherpoll-wrong-endpoint' is accounted for",
    keys.includes('playground-weatherpoll-wrong-endpoint'),
    `not in the payload. keys: ${JSON.stringify(keys)}`);

check("'queue-deadcode-and-ambiguous' is accounted for",
    keys.includes('queue-deadcode-and-ambiguous'),
    `not in the payload. keys: ${JSON.stringify(keys)}`);

check('undetermined is non-empty — the bucket is reached on real data',
    q.undetermined > 0,
    'zero undetermined on the live table means the vocabulary absorbed the unclassifiable');

console.log(`\n${failed === 0 ? 'PASS' : `${failed} FAILING`}`);
process.exit(failed === 0 ? 0 : 1);
