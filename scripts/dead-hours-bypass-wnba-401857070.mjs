// One-shot CI probe (workflow_dispatch only), one-time authorized bypass --
// CC-CMD-2026-07-16-dead-hours-bypass. handleJournalismCycle's isLiveHours
// gate hard-returns during UTC dead hours (2:00-10:00) with no opts.force
// override (confirmed via direct code read), and Cloudflare Queue bindings
// aren't reachable from outside the Worker, so the deployed live per-game
// loop can't be re-invoked externally without a code change -- which this
// CC-CMD explicitly does not authorize. Uses the closest sanctioned,
// already-proven mechanism instead: /journalism/game-complete (no time
// gate, used successfully earlier tonight with synthetic test data), this
// time with the REAL final result for the one real game confirmed stuck --
// espn:401857070 (WNBA, Golden State Valkyries 88 @ Indiana Fever 75,
// final, confirmed live via /v2/games). The two other real WNBA games from
// tonight (401857068, 401857069) already have correct completion-trigger
// recaps -- confirmed via direct D1 query -- so only this one needs it.
//
// Disclosed, known difference from the real cron path: this route
// hardcodes source:'completion-trigger' (src/index.js ~L12862), not
// 'cron' -- the queue consumer's own default for an unset job.source is
// 'cron' (~L15145), which only the live per-game loop's own enqueue call
// would produce. Not fixable without a code change (out of scope for this
// one-time bypass); the resulting row will still contain the real 88-75
// result and flow through the full production pipeline (runQualityChain,
// the new judge, the fixed dateKey), same as every other real path.

const RELAY_BASE = 'https://field-relay-nba.jeffunglesbee.workers.dev';

// gameId is bare (no "espn:" prefix), matching the existing stale row's
// D1 id exactly (game_recap_wnba_401857070) -- the queue consumer builds
// the D1 id as `game_recap_${sport}_${job.eventId}` with job.eventId used
// RAW (unlike the KV key, which strips any prefix via stripKVIdPrefix).
// A prefixed id here would create a duplicate row via ON CONFLICT(id)
// instead of correctly updating the existing stale one -- confirmed via
// direct read of both the existing row and the INSERT statement, not
// assumed.
const job = {
    sport: 'wnba',
    gameId: '401857070',
    home: 'Indiana Fever',
    away: 'Golden State Valkyries',
    homeScore: 75,
    awayScore: 88,
};

async function main() {
    console.log('=== dead-hours-bypass: espn:401857070 (real game) ===');
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
    console.log('asynchronously -- check ARCHIVE_DB.briefs for id game_recap_wnba_401857070');
    console.log('after a short delay.');
}

main().catch(e => {
    console.error('FATAL:', e);
    process.exit(1);
});
