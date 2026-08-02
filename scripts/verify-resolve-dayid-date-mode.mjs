// One-shot CI probe (workflow_dispatch only). CC-CMD-2026-08-02-resolve-
// dayid-date-mode TASK 3: real, live verification of the new date-mode.
// Real, known pairing from this session's own pre-build probe
// (outbox/probe-bundesliga-matchday-date-text-result.json): season
// 2025-2026 matchday 33 real fixtures fell on 8-10 May 2026. Calls
// date-mode with date=2026-05-09 (the middle day, unambiguous) and
// cross-checks the resolved matchday + dayId against a direct call to
// the existing, untouched matchday-mode for matchday=33.

const RELAY_BASE = 'https://field-relay-nba.jeffunglesbee.workers.dev';
const SEASON = '2025-2026';
const KNOWN_DATE = '2026-05-09'; // real, from Matchday 33's actual fixture list
const EXPECTED_MATCHDAY = 33;

async function main() {
    console.log('=== verify-resolve-dayid-date-mode (TASK 3) ===\n');

    console.log('--- date-mode call ---');
    const t0 = Date.now();
    const dateR = await fetch(`${RELAY_BASE}/bundesliga-bapi/resolve-dayid?season=${SEASON}&date=${KNOWN_DATE}`);
    const dateBody = await dateR.json().catch(async () => ({ raw: await dateR.text() }));
    const dateMs = Date.now() - t0;
    console.log(JSON.stringify(dateBody, null, 2), `(${dateMs}ms)`);

    console.log('\n--- cross-check: existing matchday-mode call for matchday=33 ---');
    const mdR = await fetch(`${RELAY_BASE}/bundesliga-bapi/resolve-dayid?season=${SEASON}&matchday=${EXPECTED_MATCHDAY}`);
    const mdBody = await mdR.json().catch(async () => ({ raw: await mdR.text() }));
    console.log(JSON.stringify(mdBody, null, 2));

    console.log('\n--- date-mode called AGAIN (expect cache hit, fast) ---');
    const t1 = Date.now();
    const dateR2 = await fetch(`${RELAY_BASE}/bundesliga-bapi/resolve-dayid?season=${SEASON}&date=${KNOWN_DATE}`);
    const dateBody2 = await dateR2.json().catch(async () => ({ raw: await dateR2.text() }));
    const dateMs2 = Date.now() - t1;
    console.log(JSON.stringify(dateBody2, null, 2), `(${dateMs2}ms)`);

    const resolvedCorrectMatchday = dateBody?.matchday === EXPECTED_MATCHDAY;
    const dayIdMatchesCrossCheck = dateBody?.dayId && mdBody?.dayId && dateBody.dayId === mdBody.dayId;
    const comIdMatchesCrossCheck = dateBody?.comId && mdBody?.comId && dateBody.comId === mdBody.comId;
    const dateModeCacheHitConfirmed = dateBody2?.cached === true;
    const dateModeCacheFaster = dateMs2 < dateMs;
    const matchdayModeUntouchedShape = typeof mdBody?.matchday === 'number' && mdBody?.date === undefined;

    const out = {
        season: SEASON, knownDate: KNOWN_DATE, expectedMatchday: EXPECTED_MATCHDAY,
        dateModeFirst: dateBody, dateModeFirstMs: dateMs,
        matchdayModeCrossCheck: mdBody,
        dateModeSecond: dateBody2, dateModeSecondMs: dateMs2,
        resolvedCorrectMatchday, dayIdMatchesCrossCheck, comIdMatchesCrossCheck,
        dateModeCacheHitConfirmed, dateModeCacheFaster, matchdayModeUntouchedShape,
    };
    console.log('\n=== VERIFY_JSON_START ===');
    console.log(JSON.stringify(out));
    console.log('=== VERIFY_JSON_END ===');

    const fs = await import('fs');
    fs.writeFileSync('outbox/verify-resolve-dayid-date-mode-result.json', JSON.stringify(out, null, 2));

    console.log(`\nresolvedCorrectMatchday=${resolvedCorrectMatchday} dayIdMatchesCrossCheck=${dayIdMatchesCrossCheck} comIdMatchesCrossCheck=${comIdMatchesCrossCheck} dateModeCacheHitConfirmed=${dateModeCacheHitConfirmed} dateModeCacheFaster=${dateModeCacheFaster} matchdayModeUntouchedShape=${matchdayModeUntouchedShape}`);

    if (!resolvedCorrectMatchday || !dayIdMatchesCrossCheck || !comIdMatchesCrossCheck || !dateModeCacheHitConfirmed || !matchdayModeUntouchedShape) process.exit(1);
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
