// One-shot CI probe (workflow_dispatch only). Live write-twice + null-guard
// test for the /archive/game home/away upsert-refresh fix
// (CC-CMD-2026-07-16-archive-game-upsert-team-refresh). Disposable test
// series_key, cleaned up after. Mirrors the verification style of the prior
// CC-CMD-2026-07-15-archive-game-series-upsert-key dispatch.

const RELAY_BASE = 'https://field-relay-nba.jeffunglesbee.workers.dev';
const SERIES_KEY = 'TEST-CCCMD-TEAMREFRESH_SF-99';
const ROUND = 'semifinal';
const DATE = '2099-01-02';

async function post(body) {
    const r = await fetch(`${RELAY_BASE}/archive/game`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });
    return { status: r.status, body: await r.text() };
}

async function main() {
    console.log('=== archive-game-team-refresh-test ===');

    console.log('--- POST 1: placeholder names ---');
    const p1 = await post({
        sport: 'MLS', series_key: SERIES_KEY, round: ROUND, date: DATE,
        home: 'TBC Home', away: 'TBC Away',
    });
    console.log(p1.status, p1.body);

    console.log('--- POST 2: real names + score (the actual fix under test) ---');
    const p2 = await post({
        sport: 'MLS', series_key: SERIES_KEY, round: ROUND, date: DATE,
        home: 'Test FC Alpha', away: 'Test FC Beta', home_score: 2, away_score: 1,
    });
    console.log(p2.status, p2.body);

    console.log('--- POST 3: null names on conflict (the guard under test) ---');
    const p3 = await post({
        sport: 'MLS', series_key: SERIES_KEY, round: ROUND, date: DATE,
        home: null, away: null, home_score: 3, away_score: 2,
    });
    console.log(p3.status, p3.body);

    console.log('=== done -- inspect ARCHIVE_DB.postseason_games WHERE series_key = ? next, then clean up ===');
    console.log(SERIES_KEY);
}

main().catch(e => {
    console.error('FATAL:', e);
    process.exit(1);
});
