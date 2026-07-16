// One-shot CI probe (workflow_dispatch only) -- diagnostic only, no
// authorization needed to READ a result (POST /journalism/run is the
// real, existing, synchronous-response route; not a code change).
// handleJournalismCycle's slate_{dateKey}_cron brief (D1) has not
// updated since 00:00:47 UTC, ~11h of real elapsed time and dozens of
// */5 cron ticks ago, spanning both of tonight's fixes (dateKey
// ET-anchor, UPSERT gap) -- neither explains this. The fire-and-forget
// cron path (ctx.waitUntil) gives no visibility into why. This route
// calls the exact same function synchronously and returns its actual
// result object (or the caught top-level exception message), which is
// the most direct diagnostic signal available without log-tail access.

const RELAY_BASE = 'https://field-relay-nba.jeffunglesbee.workers.dev';

async function main() {
    console.log('=== journalism-run-diagnostic ===');
    console.log('POST', `${RELAY_BASE}/journalism/run?force=true`);

    const t0 = Date.now();
    const resp = await fetch(`${RELAY_BASE}/journalism/run?force=true`, { method: 'POST' });
    const elapsed = Date.now() - t0;
    const text = await resp.text();
    console.log(`status: ${resp.status}`);
    console.log(`elapsed_ms: ${elapsed}`);
    console.log(`body: ${text}`);
}

main().catch(e => {
    console.error('FATAL:', e);
    process.exit(1);
});
