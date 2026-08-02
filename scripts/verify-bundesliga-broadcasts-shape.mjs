// One-shot CI probe (workflow_dispatch only). CC-CMD-2026-08-02-proxy-
// bundesliga-broadcasts TASK 1: re-verify the x-api-key and real response
// shape fresh, for a genuinely current (comId, dayId) pair -- resolved via
// the already-live /bundesliga-bapi/resolve-dayid route, not assumed or
// reused from an earlier session's different matchday.

const RELAY_BASE = 'https://field-relay-nba.jeffunglesbee.workers.dev';
const SEASON = '2026-2027';
const MATCHDAY = 3; // a matchday not already used by verify-bundesliga-dayid.mjs's cache-hit test
const CANDIDATE_API_KEY = '60ETUJ4j5YagIHdu-PROD';

async function main() {
    console.log('=== verify-bundesliga-broadcasts-shape (TASK 1) ===\n');

    console.log(`--- resolving real (comId, dayId) for season=${SEASON} matchday=${MATCHDAY} ---`);
    const resolveR = await fetch(`${RELAY_BASE}/bundesliga-bapi/resolve-dayid?season=${SEASON}&matchday=${MATCHDAY}`);
    const resolveBody = await resolveR.json().catch(async () => ({ raw: await resolveR.text() }));
    console.log(JSON.stringify(resolveBody, null, 2));

    const { dayId, comId } = resolveBody || {};
    const resolveOk = resolveBody?.ok === true && !!dayId && !!comId;

    let broadcastsStatus = null, broadcastsBody = null, broadcastsError = null;
    if (resolveOk) {
        const broadcastsUrl = `https://wapp.bapi.bundesliga.com/broadcasts/${comId}/${dayId}`;
        console.log(`\n--- fetching real endpoint directly: ${broadcastsUrl} ---`);
        try {
            const r = await fetch(broadcastsUrl, {
                headers: {
                    'x-api-key': CANDIDATE_API_KEY,
                    'accept': 'application/json, text/plain, */*',
                    'accept-language': 'en-EN',
                },
            });
            broadcastsStatus = r.status;
            broadcastsBody = await r.json().catch(async () => ({ raw: (await r.text()).slice(0, 500) }));
        } catch (e) {
            broadcastsError = String(e).slice(0, 300);
        }
        console.log(JSON.stringify({ status: broadcastsStatus, body: broadcastsBody, error: broadcastsError }, null, 2));
    }

    const keyStillWorks = broadcastsStatus === 200;
    const realShapeKeys = broadcastsBody && typeof broadcastsBody === 'object' ? Object.keys(broadcastsBody) : [];

    console.log('\n=== VERIFY_JSON_START ===');
    console.log(JSON.stringify({
        season: SEASON, matchday: MATCHDAY,
        resolveOk, dayId, comId,
        broadcastsStatus, broadcastsBody, broadcastsError,
        keyStillWorks, realShapeKeys,
    }));
    console.log('=== VERIFY_JSON_END ===');

    console.log(`\nresolveOk=${resolveOk} keyStillWorks=${keyStillWorks} realShapeKeys=${JSON.stringify(realShapeKeys)}`);

    if (!resolveOk || !keyStillWorks) process.exit(1);
}

main().catch(e => {
    console.error('FATAL:', e);
    process.exit(1);
});
