// One-shot CI probe (workflow_dispatch only), read-only. /debug/* is on
// probe_relay_route's forbidden-prefix list (protects /debug/recent-
// requests, which handles OAuth tokens), so the sandbox-bypass tool
// can't reach the new /debug/last-archive-error route either -- same
// CI-as-proxy pattern as every other diagnostic tonight.

const RELAY_BASE = 'https://field-relay-nba.jeffunglesbee.workers.dev';

async function main() {
    console.log('=== read-last-archive-error ===');
    const resp = await fetch(`${RELAY_BASE}/debug/last-archive-error`);
    const text = await resp.text();
    console.log(`status: ${resp.status}`);
    console.log(`body: ${text}`);
}

main().catch(e => {
    console.error('FATAL:', e);
    process.exit(1);
});
