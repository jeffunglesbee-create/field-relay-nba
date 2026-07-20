// One-shot CI probe (workflow_dispatch only). CC-CMD-2026-07-19-mls-sub-
// impact-metric PRE-BUILD PROBE: re-verify the real ESPN summary payload
// shape for keyEvents[] (Goal/Substitution), participants[] ordering on
// Substitution events, rosters[] position.abbreviation ("SUB" placeholder
// for incoming subs), and the core athlete endpoint's real position for a
// substitute -- before trusting this doc's claims, per Rule 72.

const SUMMARY_URL = 'https://site.api.espn.com/apis/site/v2/sports/soccer/usa.1/summary?event=761664';
const CORE_ATHLETE_URL = (id) => `https://sports.core.api.espn.com/v2/sports/soccer/leagues/usa.1/athletes/${id}`;

async function main() {
    console.log('=== probe-mls-sub-impact-shape ===\n');

    const r = await fetch(SUMMARY_URL, { headers: { 'User-Agent': 'FIELD/1.0' } });
    console.log(`summary status: ${r.status}`);
    const data = await r.json();

    const keyEvents = data.keyEvents || [];
    console.log(`\nkeyEvents count: ${keyEvents.length}`);
    const types = new Set(keyEvents.map(e => e.type?.text));
    console.log(`distinct type.text values: ${JSON.stringify([...types])}`);

    console.log('\n--- Goal / Penalty events (text field, for score-parsing regex) ---');
    for (const e of keyEvents) {
        if (e.type?.text === 'Goal' || e.type?.text === 'Penalty - Scored') {
            console.log(JSON.stringify({
                type: e.type?.text, clock: e.clock?.displayValue, period: e.period?.number,
                team: e.team?.displayName, text: e.text,
            }));
        }
    }

    console.log('\n--- Substitution events (participants[] ordering check) ---');
    const subs = keyEvents.filter(e => e.type?.text === 'Substitution');
    console.log(`substitution count: ${subs.length}`);
    for (const e of subs) {
        console.log(JSON.stringify({
            clock: e.clock?.displayValue, period: e.period?.number, team: e.team?.displayName,
            participants: (e.participants || []).map(p => ({ athleteId: p.athlete?.id, name: p.athlete?.displayName })),
        }));
    }

    console.log('\n--- rosters[] position.abbreviation for the same sub player IDs ---');
    const rosters = data.rosters || [];
    const subAthleteIds = new Set(subs.flatMap(e => (e.participants || []).map(p => p.athlete?.id)));
    for (const teamRoster of rosters) {
        for (const entry of teamRoster.roster || []) {
            const id = entry.athlete?.id || entry.athlete?.$ref || entry.athleteId || entry.id;
            if (subAthleteIds.has(id) || subAthleteIds.has(String(id))) {
                console.log(JSON.stringify({
                    athleteId: id, name: entry.athlete?.displayName,
                    positionAbbr: entry.position?.abbreviation, starter: entry.starter,
                }));
            }
        }
    }
    // Also dump the raw shape of one roster entry, unfiltered, in case the ID field differs from assumed.
    console.log('\n--- raw first roster entry (structure check) ---');
    console.log(JSON.stringify(rosters[0]?.roster?.[0] || null));

    console.log('\n--- core athlete endpoint for one incoming sub (real position.name) ---');
    const firstSubIn = subs[0]?.participants?.[0]?.athlete?.id;
    if (firstSubIn) {
        const ar = await fetch(CORE_ATHLETE_URL(firstSubIn), { headers: { 'User-Agent': 'FIELD/1.0' } });
        console.log(`athlete ${firstSubIn} status: ${ar.status}`);
        if (ar.ok) {
            const ad = await ar.json();
            console.log(JSON.stringify({ displayName: ad.displayName, position: ad.position }));
        }
    } else {
        console.log('no substitution participants found to test');
    }
}

main().catch(e => {
    console.error('FATAL:', e);
    process.exit(1);
});
