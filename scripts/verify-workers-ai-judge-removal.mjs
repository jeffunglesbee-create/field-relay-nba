// One-shot CI probe (workflow_dispatch only). CC-CMD-2026-07-20-cleanup-
// workers-ai-judge-routes TASK 3: real, live verification that the two
// removed routes genuinely 404 in production, and that the untouched
// sibling routes (still-active investigation, explicit scope boundary)
// still respond normally.

const RELAY_BASE = 'https://field-relay-nba.jeffunglesbee.workers.dev';

async function checkRemoved(path) {
    const r = await fetch(`${RELAY_BASE}${path}`, { method: 'GET' });
    return { path, status: r.status, removed: r.status === 404 };
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

    console.log('--- removed routes (expect 404) ---');
    const removed = await Promise.all([
        checkRemoved('/test/workers-ai-judge'),
        checkRemoved('/test/gemini-judge'),
    ]);
    console.log(JSON.stringify(removed, null, 2));

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
    console.log(JSON.stringify({ removed, untouched, allRemoved, allUntouched }));
    console.log('=== VERIFY_JSON_END ===');

    if (!allRemoved || !allUntouched) process.exit(1);
}

main().catch(e => {
    console.error('FATAL:', e);
    process.exit(1);
});
