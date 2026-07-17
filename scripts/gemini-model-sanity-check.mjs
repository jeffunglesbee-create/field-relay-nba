// One-shot CI probe (workflow_dispatch only). Sanity-checks the new
// X-FIELD-Test-Model override on field-claude-proxy before running the
// full CC-CMD-2026-07-16-gemini-model-comparison test.

const PROXY_URL = 'https://field-claude-proxy.jeffunglesbee.workers.dev';

async function callProxy(prompt, testModel) {
    const headers = {
        'Content-Type': 'application/json',
        'X-FIELD-Relay': 'field-relay-cron-2026',
    };
    if (testModel) headers['X-FIELD-Test-Model'] = testModel;
    const r = await fetch(PROXY_URL, {
        method: 'POST',
        headers,
        body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 50, messages: [{ role: 'user', content: prompt }] }),
    });
    const text = await r.text();
    return { status: r.status, model: r.headers.get('X-FIELD-Model'), latencyMs: r.headers.get('X-FIELD-Latency-Ms'), body: text };
}

async function main() {
    console.log('=== gemini-model-sanity-check ===');
    console.log('--- default (no override) ---');
    const a = await callProxy('Say the word banana and nothing else.', null);
    console.log(JSON.stringify(a, null, 2));

    console.log('--- override: gemini-3.5-flash ---');
    const b = await callProxy('Say the word banana and nothing else.', 'gemini-3.5-flash');
    console.log(JSON.stringify(b, null, 2));
}

main().catch(e => {
    console.error('FATAL:', e);
    process.exit(1);
});
