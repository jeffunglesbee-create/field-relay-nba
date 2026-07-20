// One-shot CI probe. Follow-up to probe-mls-sub-impact-shape.mjs: the goal
// event `text` field uses full club names ("Los Angeles Football Club")
// that differ from `team.displayName` ("LAFC") on the keyEvent itself --
// need the real competitor/team field that matches the text's naming so
// score-differential parsing can map parsed names back to home/away
// reliably, not by assuming text order == home/away order.

const SUMMARY_URL = 'https://site.api.espn.com/apis/site/v2/sports/soccer/usa.1/summary?event=761664';

async function main() {
    const r = await fetch(SUMMARY_URL, { headers: { 'User-Agent': 'FIELD/1.0' } });
    const data = await r.json();
    const competitors = data?.header?.competitions?.[0]?.competitors || [];
    console.log('=== competitors[].team fields ===');
    for (const c of competitors) {
        console.log(JSON.stringify({
            homeAway: c.homeAway, id: c.id,
            team: {
                displayName: c.team?.displayName,
                name: c.team?.name,
                shortDisplayName: c.team?.shortDisplayName,
                abbreviation: c.team?.abbreviation,
                location: c.team?.location,
                nickname: c.team?.nickname,
            },
        }));
    }
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
