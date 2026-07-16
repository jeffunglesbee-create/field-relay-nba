// One-shot CI probe (workflow_dispatch only), diagnostic. Forces a
// genuinely fresh /journalism/game-complete job (new synthetic gameId,
// guaranteed not deduped) to test whether the D1 archive write succeeds
// or silently fails post the new telemetry instrumentation, isolating
// whether this specific route/path is still healthy right now.

const RELAY_BASE = 'https://field-relay-nba.jeffunglesbee.workers.dev';

const job = {
    sport: 'mlb',
    gameId: 'espn:8880002',
    home: 'CCCMD Test Braves',
    away: 'CCCMD Test Marlins',
    homeScore: 4,
    awayScore: 2,
};

async function main() {
    console.log('=== force-fresh-completion-test ===');
    console.log('POST', `${RELAY_BASE}/journalism/game-complete`);
    const resp = await fetch(`${RELAY_BASE}/journalism/game-complete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(job),
    });
    const text = await resp.text();
    console.log(`status: ${resp.status}`);
    console.log(`body: ${text}`);
}

main().catch(e => {
    console.error('FATAL:', e);
    process.exit(1);
});
