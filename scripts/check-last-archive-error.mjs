// One-shot CI probe (workflow_dispatch only). Reads GET /debug/last-archive-error
// directly -- /debug/* is on probe_relay_route's forbidden-prefix list, so this
// route needs CI-as-proxy even for a plain GET.

const RELAY_BASE = 'https://field-relay-nba.jeffunglesbee.workers.dev';

async function main() {
    console.log('=== check-last-archive-error ===');
    const r = await fetch(`${RELAY_BASE}/debug/last-archive-error`);
    console.log('status:', r.status);
    console.log(await r.text());
}

main().catch(e => {
    console.error('FATAL:', e);
    process.exit(1);
});
