// One-shot CI probe (workflow_dispatch only) — forces a synthetic game
// completion through the REAL, deployed production pipeline
// (/journalism/game-complete -> JOURNALISM_QUEUE -> runQualityChain ->
// ARCHIVE_DB.briefs) so the CC-CMD-2026-07-16-journalism-quality-gate-
// redesign fix can be verified with real quality_score data written by
// the full pipeline, not just an isolated function call. Same technique as
// CC-CMD-2026-07-15-brief-game-kv-followup's synthetic completion test
// (fresh, never-before-seen gameId guarantees no dedup skip).
//
// This session's interactive sandbox blocks direct egress to
// field-relay-nba.jeffunglesbee.workers.dev; this runner does not.
//
// Writes exactly ONE real row to ARCHIVE_DB.briefs (id
// game_recap_mlb_espn:8880001) -- clearly test-labeled team names, easy
// to identify and clean up (DELETE FROM briefs WHERE game_id LIKE
// '%8880001%'). See docs/CC-CMD-2026-07-16-jq-judge-live-verify-and-
// calibration-watch.md.

const RELAY_BASE = 'https://field-relay-nba.jeffunglesbee.workers.dev';

const job = {
    sport: 'mlb',
    gameId: 'espn:8880001',
    home: 'CCCMD Test Athletics',
    away: 'CCCMD Test Rangers',
    homeScore: 5,
    awayScore: 3,
};

async function main() {
    console.log('=== jq-calibration-force-probe ===');
    console.log('POST', `${RELAY_BASE}/journalism/game-complete`);
    console.log('body:', JSON.stringify(job));

    const resp = await fetch(`${RELAY_BASE}/journalism/game-complete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(job),
    });
    const text = await resp.text();
    console.log(`status: ${resp.status}`);
    console.log(`body: ${text}`);
    console.log('');
    console.log('Job enqueued (fire-and-forget, 202 expected). Queue consumer runs');
    console.log('asynchronously -- check ARCHIVE_DB.briefs for id');
    console.log(`game_recap_${job.sport}_${job.gameId} after a short delay.`);
}

main().catch(e => {
    console.error('FATAL:', e);
    process.exit(1);
});
