// One-shot CI probe (workflow_dispatch only). Sets up two real completions
// for the sweepKVBriefs id-mismatch fix test (CC-CMD-2026-07-16-sweep-kv-
// briefs-id-mismatch TASK 2). Both create real, matching KV+D1 pairs via the
// actual production pipeline; the D1 side of each is then deliberately
// desynced/deleted (via direct D1 query, outside this script) to construct
// the two required forced-condition scenarios before the next real cron tick.

const RELAY_BASE = 'https://field-relay-nba.jeffunglesbee.workers.dev';

const jobs = [
    { sport: 'mlb', gameId: '8880201', home: 'CCCMD Sweep Repair Home', away: 'CCCMD Sweep Repair Away', homeScore: 4, awayScore: 3 },
    { sport: 'mlb', gameId: '8880202', home: 'CCCMD Sweep Insert Home', away: 'CCCMD Sweep Insert Away', homeScore: 2, awayScore: 1 },
];

async function main() {
    console.log('=== kv-sweep-fix-setup ===');
    for (const job of jobs) {
        console.log(`--- POST /journalism/game-complete: ${job.gameId} ---`);
        const r = await fetch(`${RELAY_BASE}/journalism/game-complete`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(job),
        });
        console.log(r.status, await r.text());
    }
}

main().catch(e => {
    console.error('FATAL:', e);
    process.exit(1);
});
