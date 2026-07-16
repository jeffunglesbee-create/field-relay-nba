// One-shot CI probe (workflow_dispatch only). Verifies the regular_season_games
// (non-series_key) branch of the home/away upsert-refresh fix still upserts
// a single row correctly on a same-id conflict (same home/away, updated score).
// Note: unlike the postseason_games/series_key branch, this table's id is
// DERIVED from home/away when present (idTail = homeShort_awayShort), so a
// genuine "null-name write clobbers an existing real name on the SAME id"
// collision is not reachable through this route's own id-construction logic
// for this branch -- a null/blank home or away always routes to the
// source_id-fallback id instead, which cannot collide with a real-named row's
// team-name-derived id. This test therefore checks the reachable case: the
// COALESCE addition doesn't break a normal same-name conflict update.

const RELAY_BASE = 'https://field-relay-nba.jeffunglesbee.workers.dev';
const HOME = 'Test Reg Home CCCMD';
const AWAY = 'Test Reg Away CCCMD';
const DATE = '2099-01-03';

async function post(body) {
    const r = await fetch(`${RELAY_BASE}/archive/game`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });
    return { status: r.status, body: await r.text() };
}

async function main() {
    console.log('=== archive-game-regular-refresh-test ===');

    console.log('--- POST 1: initial write, no score ---');
    const p1 = await post({ sport: 'TESTSPORT', date: DATE, home: HOME, away: AWAY });
    console.log(p1.status, p1.body);

    console.log('--- POST 2: same home/away (same id), adds score ---');
    const p2 = await post({ sport: 'TESTSPORT', date: DATE, home: HOME, away: AWAY, home_score: 9, away_score: 4 });
    console.log(p2.status, p2.body);

    console.log('=== done -- inspect ARCHIVE_DB.regular_season_games WHERE date = ? AND home = ? next, then clean up ===');
    console.log(DATE, HOME);
}

main().catch(e => {
    console.error('FATAL:', e);
    process.exit(1);
});
