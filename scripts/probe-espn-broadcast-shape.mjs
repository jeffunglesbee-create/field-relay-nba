// One-shot CI probe (workflow_dispatch only). Fetches real ESPN scoreboard
// data for a few sports and prints the raw broadcasts/geoBroadcasts shape
// for the first event with any broadcast data, so the V2 adapter fix
// (CC-CMD-2026-07-16-broadcast-chip-durable-fix TASK 3) is built against
// real, confirmed field shapes -- not assumed.

const TARGETS = [
    { label: 'MLB', url: 'https://site.api.espn.com/apis/site/v2/sports/baseball/mlb/scoreboard' },
    { label: 'WNBA', url: 'https://site.api.espn.com/apis/site/v2/sports/basketball/wnba/scoreboard' },
    { label: 'NFL', url: 'https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard' },
];

async function main() {
    console.log('=== probe-espn-broadcast-shape ===');
    for (const t of TARGETS) {
        console.log(`\n--- ${t.label} ---`);
        try {
            const r = await fetch(t.url, { headers: { 'User-Agent': 'FIELD/1.0' } });
            console.log('status:', r.status);
            if (!r.ok) continue;
            const d = await r.json();
            const events = d.events || [];
            console.log('event count:', events.length);
            let found = false;
            for (const ev of events) {
                const comp = ev.competitions?.[0];
                if (!comp) continue;
                const bc = comp.broadcasts;
                const gbc = comp.geoBroadcasts;
                if ((bc && bc.length) || (gbc && gbc.length)) {
                    console.log('event id:', ev.id, ev.shortName || ev.name);
                    console.log('broadcasts:', JSON.stringify(bc));
                    console.log('geoBroadcasts:', JSON.stringify(gbc));
                    found = true;
                    break;
                }
            }
            if (!found) console.log('(no event with broadcasts/geoBroadcasts in this scoreboard)');
        } catch (e) {
            console.log('FETCH ERROR:', e.message);
        }
    }
}

main().catch(e => {
    console.error('FATAL:', e);
    process.exit(1);
});
