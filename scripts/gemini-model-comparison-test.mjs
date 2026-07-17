// One-shot CI probe (workflow_dispatch only). CC-CMD-2026-07-16-gemini-
// model-comparison TASK 1: real, bounded 5-game x 2-model test, using the
// relay's own /debug/gemini-model-test route (which builds the exact real
// game_recap prompt via buildGameCompletePrompt and calls both models).

const RELAY_BASE = 'https://field-relay-nba.jeffunglesbee.workers.dev';

// 5 real, distinct, recently-completed games (2026-07-14 to 2026-07-16),
// real variety across sports and score patterns -- confirmed live against
// ARCHIVE_DB.regular_season_games before selecting, not invented.
const GAMES = [
    { sport: 'wnba', home: 'Fever', away: 'Valkyries', homeScore: 75, awayScore: 88, note: 'espn:401857070' },
    { sport: 'wnba', home: 'Lynx', away: 'Sparks', homeScore: 96, awayScore: 87, note: 'espn:401857069' },
    { sport: 'soccer', home: 'England', away: 'Argentina', homeScore: 1, awayScore: 2, note: 'espn:760515 (WC26)' },
    { sport: 'soccer', home: 'France', away: 'Spain', homeScore: 0, awayScore: 2, note: 'espn:760514 (WC26)' },
    { sport: 'mlb', home: 'National', away: 'American', homeScore: 0, awayScore: 4, note: 'espn:401817370 (All-Star Game)' },
];

async function testGame(g) {
    const r = await fetch(`${RELAY_BASE}/debug/gemini-model-test`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(g),
    });
    return { status: r.status, body: await r.json().catch(async () => ({ raw: await r.text() })) };
}

async function main() {
    console.log('=== gemini-model-comparison-test (TASK 1) ===');
    const results = [];
    for (const g of GAMES) {
        console.log(`\n--- ${g.away} @ ${g.home} (${g.sport}, ${g.note}) ---`);
        const r = await testGame(g);
        console.log(JSON.stringify(r, null, 2));
        results.push({ game: g, result: r });
    }
    console.log('\n=== RAW_RESULTS_JSON_START ===');
    console.log(JSON.stringify(results));
    console.log('=== RAW_RESULTS_JSON_END ===');
}

main().catch(e => {
    console.error('FATAL:', e);
    process.exit(1);
});
