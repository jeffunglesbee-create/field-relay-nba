// One-shot CI probe (workflow_dispatch only). Round 3: the proxy fell back
// to Claude on the gemini-3.5-flash test call with the real Gemini error
// swallowed -- now reads the new X-FIELD-Gemini-Error diagnostic header to
// see what actually failed.

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
    return {
        status: r.status,
        model: r.headers.get('X-FIELD-Model'),
        latencyMs: r.headers.get('X-FIELD-Latency-Ms'),
        geminiError: r.headers.get('X-FIELD-Gemini-Error'),
        body: text,
    };
}

async function main() {
    console.log('=== gemini-model-sanity-check round 3 ===');
    const r = await callProxy('Say the word banana and nothing else.', 'gemini-3.5-flash', 300);
    console.log(JSON.stringify(r, null, 2));
}

main().catch(e => {
    console.error('FATAL:', e);
    process.exit(1);
});
