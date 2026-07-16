// One-shot CI probe (workflow_dispatch only). Triggers a real journalism
// cycle, waits for the queue to process, then immediately checks
// /integrity/game-briefs (both dry-run and repair=true) to test the new
// endpoint against fresh, real KV data before it can expire.

const RELAY_BASE = 'https://field-relay-nba.jeffunglesbee.workers.dev';

async function main() {
    console.log('=== trigger-and-check-integrity ===');

    console.log('--- Triggering /journalism/run?force=true ---');
    const runResp = await fetch(`${RELAY_BASE}/journalism/run?force=true`, { method: 'POST' });
    console.log('status:', runResp.status);
    console.log(await runResp.text());

    console.log('--- Waiting 45s for queue processing ---');
    await new Promise(r => setTimeout(r, 45000));

    const today = new Date().toISOString().slice(0, 10);
    console.log(`--- Checking /integrity/game-briefs?date=${today} (dry run) ---`);
    const dryResp = await fetch(`${RELAY_BASE}/integrity/game-briefs?date=${today}`);
    const dryBody = await dryResp.text();
    console.log('status:', dryResp.status);
    console.log(dryBody);

    let dry;
    try { dry = JSON.parse(dryBody); } catch (_) { dry = null; }

    if (dry && dry.divergentCount > 0) {
        console.log('--- Divergence found, testing repair=true ---');
        const repairResp = await fetch(`${RELAY_BASE}/integrity/game-briefs?date=${today}&repair=true`);
        const repairBody = await repairResp.text();
        console.log('status:', repairResp.status);
        console.log(repairBody);
    } else {
        console.log('--- No divergence found this run -- nothing to repair-test ---');
    }
}

main().catch(e => {
    console.error('FATAL:', e);
    process.exit(1);
});
