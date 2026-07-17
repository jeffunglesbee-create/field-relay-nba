// One-shot CI probe (workflow_dispatch only). Sanity-checks the new
// X-FIELD-Test-Model override on field-claude-proxy before running the
// full CC-CMD-2026-07-16-gemini-model-comparison test.
//
// Round 2: gemini-3.5-flash returned output_tokens:0 / empty text at
// max_tokens:50 in round 1 despite real ~5.3s latency -- investigating
// whether this is a hidden "thinking" token budget consuming
// maxOutputTokens before visible text, by testing at progressively
// higher token budgets, including the proxy's own real default (2500,
// what /journalism/game-complete's real game-recap calls actually use).

const PROXY_URL = 'https://field-claude-proxy.jeffunglesbee.workers.dev';

async function callProxy(prompt, testModel, maxTokens) {
    const headers = {
        'Content-Type': 'application/json',
        'X-FIELD-Relay': 'field-relay-cron-2026',
    };
    if (testModel) headers['X-FIELD-Test-Model'] = testModel;
    const r = await fetch(PROXY_URL, {
        method: 'POST',
        headers,
        body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: maxTokens, messages: [{ role: 'user', content: prompt }] }),
    });
    const text = await r.text();
    return { status: r.status, model: r.headers.get('X-FIELD-Model'), latencyMs: r.headers.get('X-FIELD-Latency-Ms'), body: text };
}

async function main() {
    console.log('=== gemini-model-sanity-check round 2 ===');
    for (const maxTokens of [300, 2500]) {
        console.log(`--- gemini-3.5-flash, max_tokens=${maxTokens} ---`);
        const r = await callProxy('Say the word banana and nothing else.', 'gemini-3.5-flash', maxTokens);
        console.log(JSON.stringify(r, null, 2));
    }
}

main().catch(e => {
    console.error('FATAL:', e);
    process.exit(1);
});
