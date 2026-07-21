// One-shot CI probe (workflow_dispatch only). CC-CMD-2026-07-20-cleanup-
// workers-ai-judge-routes TASK 3: real, live verification that the two
// removed routes genuinely stop responding in production, and that the
// untouched sibling routes (still-active investigation, explicit scope
// boundary) still respond normally.
//
// REAL FINDING (first run, 2026-07-21): this codebase has no generic 404
// catch-all. Every unmatched path falls through the whole route chain to
// the final /nba/* passthrough gate (src/index.js ~L16302-16306), which
// runs nbaAllowed(pathname) against NBA_ALLOWED_PREFIXES and returns
// `403 Path not allowed` (header X-RELAY-Error: path-not-whitelisted) for
// anything that doesn't match -- confirmed by direct code read, not
// assumed. A removed /test/* route therefore surfaces as 403, not 404 --
// this IS the real "equivalent not-found" signal the CC-CMD's own TASK 3
// wording allowed for, verified against this codebase's actual fallback
// architecture rather than a generic REST assumption.

const RELAY_BASE = 'https://field-relay-nba.jeffunglesbee.workers.dev';

async function checkRemoved(path) {
    const r = await fetch(`${RELAY_BASE}${path}`, { method: 'GET' });
    const relayError = r.headers.get('X-RELAY-Error');
    const removed = r.status === 404 || (r.status === 403 && relayError === 'path-not-whitelisted');
    return { path, status: r.status, relayError, removed };
}

async function checkUntouched(path, body) {
    const r = await fetch(`${RELAY_BASE}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });
    return { path, status: r.status, stillWorks: r.status !== 404 };
}

async function main() {
    console.log('=== verify-workers-ai-judge-removal (TASK 3) ===\n');

    console.log('--- removed routes (expect 403 path-not-whitelisted, this codebase\'s real not-found signal) ---');
    const removed = await Promise.all([
        checkRemoved('/test/workers-ai-judge'),
        checkRemoved('/test/gemini-judge'),
    ]);
    console.log(JSON.stringify(removed, null, 2));

    console.log('\n--- control: a definitely-never-existed random path, same signal expected ---');
    const control = await checkRemoved('/test/definitely-does-not-exist-control-check');
    console.log(JSON.stringify(control));

    console.log('\n--- untouched sibling routes (expect NOT 404, explicit scope boundary) ---');
    const untouched = await Promise.all([
        checkUntouched('/test/combined-generate-judge', { prompt: 'Write a two-sentence test brief about a routine regular season game.' }),
        checkUntouched('/test/prefilter', { brief: 'Tatum had 28 points on a quiet Tuesday night.' }),
    ]);
    console.log(JSON.stringify(untouched, null, 2));

    const allRemoved = removed.every(r => r.removed);
    const allUntouched = untouched.every(r => r.stillWorks);
    console.log(`\nallRemoved=${allRemoved} allUntouched=${allUntouched}`);

    console.log('\n=== VERIFY_JSON_START ===');
    console.log(JSON.stringify({ removed, control, untouched, allRemoved, allUntouched }));
    console.log('=== VERIFY_JSON_END ===');

    if (!allRemoved || !allUntouched) process.exit(1);
}

main().catch(e => {
    console.error('FATAL:', e);
    process.exit(1);
});
