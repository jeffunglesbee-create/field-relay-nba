// One-shot CI probe (workflow_dispatch only), diagnostic. Every isolated
// single-job D1 write tested so far has succeeded (a direct SQL probe,
// and one synthetic completion-trigger job). The per-game loop's jobs
// (which fail) are always enqueued 5+ at once and processed in the same
// queue batch (max_batch_size=5). This fires 5 synthetic completion-
// trigger jobs back-to-back to force them into the same batch, testing
// whether batch size/concurrency -- not job shape -- is the real
// variable.

const RELAY_BASE = 'https://field-relay-nba.jeffunglesbee.workers.dev';

const jobs = [1, 2, 3, 4, 5].map(n => ({
    sport: 'mlb',
    gameId: `espn:889000${n}`,
    home: `CCCMD Batch Home ${n}`,
    away: `CCCMD Batch Away ${n}`,
    homeScore: n,
    awayScore: n + 1,
}));

async function main() {
    console.log('=== force-batch-completion-test ===');
    for (const job of jobs) {
        const resp = await fetch(`${RELAY_BASE}/journalism/game-complete`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(job),
        });
        console.log(`${job.gameId}: status ${resp.status}`);
    }
    console.log('All 5 fired back-to-back.');
}

main().catch(e => {
    console.error('FATAL:', e);
    process.exit(1);
});
