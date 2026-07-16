// One-shot CI probe (workflow_dispatch only) — proves the qualitative voice
// judge added in CC-CMD-2026-07-16-journalism-quality-gate-redesign works
// against a real LLM response, not just a mocked callProxy. This session's
// interactive sandbox blocks direct egress to field-claude-proxy (host not
// in allowlist); GitHub Actions runners have unrestricted egress, so this
// runs the same runQualityChain() call CI-side instead (Rule 68, CI-as-proxy).
//
// Read-only against production: calls runQualityChain() as a plain function
// against 3 synthetic drafts (not via any relay HTTP route), so nothing is
// written to D1/KV. Output goes to the job log only.
//
// See docs/CC-CMD-2026-07-16-jq-judge-live-verify-and-calibration-watch.md.

import { runQualityChain } from '../src/journalism-quality.js';

const JOURNALISM_CLAUDE_PROXY = 'https://field-claude-proxy.jeffunglesbee.workers.dev';

const callProxy = async (promptText) => {
    const resp = await fetch(JOURNALISM_CLAUDE_PROXY, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-FIELD-Relay': 'field-relay-cron-2026' },
        body: JSON.stringify({
            model: 'claude-haiku-4-5-20251001', max_tokens: 400,
            messages: [{ role: 'user', content: promptText }],
        }),
    });
    if (!resp.ok) {
        console.error(`  [proxy HTTP ${resp.status}]`, await resp.text().catch(() => ''));
        return null;
    }
    const data = await resp.json().catch(() => null);
    return data ? (data.content || []).filter(c => c.type === 'text').map(c => c.text).join('').trim() || null : null;
};

// Wrap callProxy to log every raw response the judge sees, so we can inspect
// real format-following reliability, not just the parsed PASS/FAIL outcome.
function loggedProxy(label) {
    let n = 0;
    return async (promptText) => {
        n++;
        const isJudgeCall = promptText.includes('DRAFT:') && promptText.includes('PASS');
        const result = await callProxy(promptText);
        if (isJudgeCall) {
            console.log(`  [${label} judge-call #${n}] raw response: ${JSON.stringify((result || '').slice(0, 200))}`);
        }
        return result;
    };
}

const cases = [
    {
        label: 'wire-copy',
        sport: 'nhl',
        text: 'Stanley Cup Final Game 1 begins tonight at Lenovo Center as the 39-26-17 Golden Knights face the 53-22-7 Hurricanes. Pavel Dorofeyev enters with 37 goals this season, while Seth Jarvis has 32 goals this season.',
    },
    {
        label: 'real-voice',
        sport: 'nba',
        text: 'The Spurs and Knicks haven\'t met for a championship since Tim Duncan was the future. Wembanyama at 23.2 and 9 is the headline; Brunson grinding out 26 a night is the warning. New York\'s defense gives up nothing easy in the half-court, which is awkward — that\'s where San Antonio\'s offense lives.',
    },
    {
        label: 'borderline',
        sport: 'mlb',
        text: 'Nola takes the mound tonight carrying a 5.72 ERA, and the Phillies need him to find something. Vasquez counters with a 3.28 ERA of his own, which tells you where the smart money probably is. Camden Yards has been a hitter\'s park all year, so neither bullpen should expect an easy night.',
    },
];

async function main() {
    console.log('=== jq-judge-live-probe ===');
    console.log('Target:', JOURNALISM_CLAUDE_PROXY);
    console.log('');

    for (const c of cases) {
        console.log(`--- Case: ${c.label} (sport=${c.sport}) ---`);
        const t0 = Date.now();
        const result = await runQualityChain(c.text, c.text, loggedProxy(c.label), { sport: c.sport });
        console.log(`  elapsed_ms: ${Date.now() - t0}`);
        console.log(`  layers_fired: ${JSON.stringify(result.layers_fired)}`);
        console.log(`  retries: ${result.retries}`);
        console.log(`  score (descriptive only): ${result.score}`);
        console.log(`  final_text: ${result.text.slice(0, 220)}${result.text.length > 220 ? '...' : ''}`);
        console.log('');
    }

    console.log('=== done ===');
}

main().catch(e => {
    console.error('FATAL:', e);
    process.exit(1);
});
