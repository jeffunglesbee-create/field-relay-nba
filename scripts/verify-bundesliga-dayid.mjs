// One-shot CI probe (workflow_dispatch only). CC-CMD-2026-08-02-add-
// browser-rendering-bundesliga-dayid TASK 5: real, live verification.
// Calls the new /bundesliga-bapi/resolve-dayid route for 2 distinct real
// matchdays, confirms each returns the correct real DFL-DAY-XXX (cross-
// checked against the fresh 2026-08-02 re-verification: matchday 1 ->
// DFL-DAY-004CBT, matchday 5 -> DFL-DAY-004CBX), then re-calls matchday 1
// a second time and confirms it hits cache (fast, cached:true) rather
// than re-rendering (real timing evidence, not assumed).

const RELAY_BASE = 'https://field-relay-nba.jeffunglesbee.workers.dev';
const SEASON = '2026-2027';
const EXPECTED = { 1: 'DFL-DAY-004CBT', 5: 'DFL-DAY-004CBX' };

async function resolve(matchday) {
    const t0 = Date.now();
    const r = await fetch(`${RELAY_BASE}/bundesliga-bapi/resolve-dayid?season=${SEASON}&matchday=${matchday}`);
    const body = await r.json().catch(async () => ({ raw: await r.text() }));
    return { status: r.status, body, wallMs: Date.now() - t0 };
}

async function main() {
    console.log('=== verify-bundesliga-dayid (TASK 5) ===\n');

    console.log('--- matchday 1 (expect cold render, cache miss) ---');
    const md1First = await resolve(1);
    console.log(JSON.stringify(md1First, null, 2));

    console.log('\n--- matchday 5 (expect cold render, cache miss, distinct dayId) ---');
    const md5First = await resolve(5);
    console.log(JSON.stringify(md5First, null, 2));

    console.log('\n--- matchday 1 AGAIN (expect cache hit, fast) ---');
    const md1Second = await resolve(1);
    console.log(JSON.stringify(md1Second, null, 2));

    const md1Correct = md1First.body?.dayId === EXPECTED[1] && md1Second.body?.dayId === EXPECTED[1];
    const md5Correct = md5First.body?.dayId === EXPECTED[5];
    const distinctIds = md1First.body?.dayId !== md5First.body?.dayId;
    const cacheHitConfirmed = md1Second.body?.cached === true;
    const cacheHitFaster = md1Second.wallMs < md1First.wallMs;

    console.log('\n=== VERIFY_JSON_START ===');
    console.log(JSON.stringify({
        md1First, md5First, md1Second,
        md1Correct, md5Correct, distinctIds,
        cacheHitConfirmed, cacheHitFaster,
        md1FirstMs: md1First.wallMs, md1SecondMs: md1Second.wallMs,
    }));
    console.log('=== VERIFY_JSON_END ===');

    console.log(`\nmd1Correct=${md1Correct} md5Correct=${md5Correct} distinctIds=${distinctIds} cacheHitConfirmed=${cacheHitConfirmed} cacheHitFaster=${cacheHitFaster} (${md1First.wallMs}ms -> ${md1Second.wallMs}ms)`);

    if (!md1Correct || !md5Correct || !distinctIds || !cacheHitConfirmed) process.exit(1);
}

main().catch(e => {
    console.error('FATAL:', e);
    process.exit(1);
});
