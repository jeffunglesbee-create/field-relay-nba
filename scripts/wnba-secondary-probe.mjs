// CC-CMD-2026-08-09-wnba-secondary-source, Task 1.
//
// Does a viable WNBA secondary source EXIST? This script only answers that.
// It writes nothing and builds no adapter -- that CC-CMD explicitly allows
// "no viable secondary exists" as a complete outcome, and a partial adapter
// against a source that cannot serve would be worse than none.
//
// WHY THIS RUNS ON A RUNNER RATHER THAN VIA html_probe.
// The CC-CMD asks for CF-Worker egress, correctly, since Worker reachability
// is what matters. But the first pass via html_probe was INCONCLUSIVE and must
// not be read as a negative result:
//   cdn.wnba.com  .../todaysScoreboard_10.json -> HTTP 200 but an HTML error
//                                                 page, not JSON
//   cdn.nba.com   .../todaysScoreboard_10.json -> HTTP 403
//   cdn.nba.com   .../todaysScoreboard_00.json -> HTTP 403  <- the CONTROL,
//                                                 i.e. the NBA path this relay
//                                                 uses in production, also 403
// A control that fails invalidates the test. Two confounds explain it, and
// html_probe can vary neither:
//   1. src/index.js sends NBA_HEADERS -- a browser User-Agent plus Referer and
//      Origin of https://www.nba.com. html_probe sends none of that.
//   2. The existing comment above the NBA CDN fetch records that "CDN returns
//      403 in off-season (no scoreboard)", and August IS the NBA off-season.
//      So a 403 on the NBA control is the DOCUMENTED healthy behaviour, not
//      evidence of a block.
// This script therefore probes each candidate twice -- with and without the
// real NBA_HEADERS -- which separates "needs headers" from "unreachable".
// WNBA is in season in August, so unlike the NBA control an in-season WNBA
// endpoint should return real games if the path is right.
//
// Residual uncertainty, stated rather than glossed: a runner IP is not a
// Worker IP. A candidate that works here is a candidate, not a proven source.
// The decisive proof is the forced-failure artifact through the DEPLOYED relay
// in that CC-CMD's Task 3, which is where this ends up either way.

const HEADERS = {
    'User-Agent':      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'Referer':         'https://www.nba.com/standings',
    'Origin':          'https://www.nba.com',
    'Accept':          'application/json, text/plain, */*',
    'Accept-Language': 'en-US,en;q=0.9',
    'Cache-Control':   'no-cache',
    'Pragma':          'no-cache',
};

const DATE  = process.env.PROBE_DATE || new Date().toISOString().slice(0, 10);
const YMD   = DATE.replace(/-/g, '');
const [y, m, d] = DATE.split('-');

const CANDIDATES = [
    ['wnba-cdn-live',   `https://cdn.wnba.com/static/json/liveData/scoreboard/todaysScoreboard_10.json`],
    ['nba-cdn-league10', `https://cdn.nba.com/static/json/liveData/scoreboard/todaysScoreboard_10.json`],
    ['wnba-data-legacy', `https://data.wnba.com/data/10s/prod/v1/${YMD}/scoreboard.json`],
    ['wnba-stats-sbv2',  `https://stats.wnba.com/stats/scoreboardv2?GameDate=${m}%2F${d}%2F${y}&LeagueID=10&DayOffset=0`],
    ['wnba-cdn-sched',   `https://cdn.wnba.com/static/json/staticData/scheduleLeagueV2_10.json`],
    // CONTROL: the NBA path this relay really uses. Expected to 403 or return
    // an empty slate in August (off-season) -- that is documented healthy
    // behaviour and is printed so the other rows can be read against it.
    ['CONTROL-nba-cdn',  `https://cdn.nba.com/static/json/liveData/scoreboard/todaysScoreboard_00.json`],
];

// A source is only viable if it returns PARSEABLE JSON containing something
// game-shaped. HTTP 200 is not the bar -- cdn.wnba.com already returned 200
// with an HTML error page, which is precisely the "populated 200 that is not
// what you asked for" trap CC-CMD-2026-08-08-cfl-archive-collection warns
// about for ESPN's football/cfl route.
function assess(status, contentType, body) {
    if (status !== 200) return { viable: false, why: `HTTP ${status}` };
    if (!/json/i.test(contentType || '')) return { viable: false, why: `content-type ${contentType || '(none)'} — not JSON` };
    let j;
    try { j = JSON.parse(body); } catch (e) { return { viable: false, why: `unparseable JSON (${e.message})` }; }
    const games = j?.scoreboard?.games || j?.games || j?.resultSets?.[0]?.rowSet || j?.leagueSchedule?.gameDates;
    if (!Array.isArray(games)) return { viable: false, why: `parsed JSON but no recognisable games array (top keys: ${Object.keys(j).slice(0, 8).join(',')})` };
    return { viable: true, why: `${games.length} game-shaped entries`, sample: JSON.stringify(games[0] || null).slice(0, 300) };
}

console.log(`=== wnba-secondary-probe  date=${DATE}  utc=${new Date().toISOString()} ===`);
console.log('Each candidate probed twice: WITHOUT then WITH the real NBA_HEADERS.\n');

const viable = [];

for (const [name, url] of CANDIDATES) {
    console.log(`--- ${name}`);
    console.log(`    ${url}`);
    for (const [mode, headers] of [['bare', {}], ['hdrs', HEADERS]]) {
        try {
            // AbortSignal.timeout is not optional here: the first run of this
            // probe (31284308722) hung with no output. stats.wnba.com is known
            // to stall rather than refuse when it dislikes a request, and a
            // bare fetch has no default timeout, so one unresponsive candidate
            // silently blocks the whole probe.
            const r = await fetch(url, { headers, signal: AbortSignal.timeout(15000) });
            const ct = r.headers.get('content-type');
            const body = await r.text();
            const a = assess(r.status, ct, body);
            console.log(`    ${mode}: HTTP ${r.status} ${ct || ''} -> ${a.viable ? 'VIABLE' : 'no'} (${a.why})`);
            if (a.sample) console.log(`          sample: ${a.sample}`);
            if (a.viable && !name.startsWith('CONTROL')) viable.push(`${name} [${mode}]`);
        } catch (e) {
            console.log(`    ${mode}: threw — ${e.message}`);
        }
    }
    console.log('');
}

console.log('=== VERDICT ===');
if (viable.length) {
    console.log(`Viable candidates: ${viable.join(', ')}`);
    console.log('Next: Task 2 of CC-CMD-2026-08-09-wnba-secondary-source.');
} else {
    console.log('NO viable WNBA secondary among the probed candidates.');
    console.log('Per that CC-CMD Task 1, this is a COMPLETE outcome: stop, do not');
    console.log('build a partial adapter against a source that cannot serve.');
}
// Exit 0 either way: "no viable source" is a finding, not a job failure.
