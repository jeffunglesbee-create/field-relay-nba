// One-shot CI probe (workflow_dispatch only). CC-CMD-2026-08-02-proxy-
// bundesliga-broadcasts TASK 3: real, live verification of the new
// /bundesliga-bapi/broadcasts route -- resolves a real, current
// (comId, dayId) pair via the already-live resolve-dayid route, then
// calls the new broadcasts route with it and confirms real, non-error
// data comes back (not just a 200 with an unrelated/empty shape).

import { writeFileSync } from 'fs';

const RELAY_BASE = 'https://field-relay-nba.jeffunglesbee.workers.dev';
const SEASON = '2026-2027';
const MATCHDAY = 7; // distinct from prior probes' matchdays (1, 3, 5)

async function main() {
    console.log('=== verify-bundesliga-broadcasts-route (TASK 3) ===\n');

    const resolveR = await fetch(`${RELAY_BASE}/bundesliga-bapi/resolve-dayid?season=${SEASON}&matchday=${MATCHDAY}`);
    const resolveBody = await resolveR.json().catch(async () => ({ raw: await resolveR.text() }));
    console.log('resolve-dayid:', JSON.stringify(resolveBody, null, 2));

    const { dayId, comId } = resolveBody || {};
    const resolveOk = resolveBody?.ok === true && !!dayId && !!comId;

    let broadcastsStatus = null, broadcastsBody = null;
    if (resolveOk) {
        const broadcastsUrl = `${RELAY_BASE}/bundesliga-bapi/broadcasts?comId=${encodeURIComponent(comId)}&dayId=${encodeURIComponent(dayId)}`;
        console.log(`\n--- calling new relay route: ${broadcastsUrl} ---`);
        const r = await fetch(broadcastsUrl);
        broadcastsStatus = r.status;
        broadcastsBody = await r.json().catch(async () => ({ raw: await r.text() }));
        console.log(JSON.stringify(broadcastsBody, null, 2));
    }

    // Also confirm the route's own input validation (real negative case,
    // not just the happy path).
    console.log('\n--- calling route with an invalid comId (expect 400) ---');
    const badR = await fetch(`${RELAY_BASE}/bundesliga-bapi/broadcasts?comId=not-a-real-id&dayId=${encodeURIComponent(dayId || 'DFL-DAY-XXXXXX')}`);
    const badBody = await badR.json().catch(async () => ({ raw: await badR.text() }));
    console.log(JSON.stringify({ status: badR.status, body: badBody }, null, 2));

    const routeAvailableTrue = broadcastsBody?.available === true;
    const routeEchoesIds = broadcastsBody?.comId === comId && broadcastsBody?.dayId === dayId;
    const routeHasDataField = broadcastsBody && typeof broadcastsBody.data === 'object' && broadcastsBody.data !== null;
    const validationRejects400 = badR.status === 400;

    const out = {
        season: SEASON, matchday: MATCHDAY, resolveOk, dayId, comId,
        broadcastsStatus, broadcastsBody,
        routeAvailableTrue, routeEchoesIds, routeHasDataField,
        badRequestStatus: badR.status, badRequestBody: badBody, validationRejects400,
    };
    console.log('\n=== VERIFY_JSON_START ===');
    console.log(JSON.stringify(out));
    console.log('=== VERIFY_JSON_END ===');
    writeFileSync('outbox/verify-bundesliga-broadcasts-route-result.json', JSON.stringify(out, null, 2));

    console.log(`\nresolveOk=${resolveOk} routeAvailableTrue=${routeAvailableTrue} routeEchoesIds=${routeEchoesIds} routeHasDataField=${routeHasDataField} validationRejects400=${validationRejects400}`);

    if (!resolveOk || !routeAvailableTrue || !routeEchoesIds || !routeHasDataField || !validationRejects400) process.exit(1);
}

main().catch(e => {
    console.error('FATAL:', e);
    process.exit(1);
});
