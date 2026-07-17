// One-shot CI probe (workflow_dispatch only). CC-CMD-2026-07-16-gemini-
// model-comparison TASK 2: scores all 10 real outputs from TASK 1
// (gemini-model-comparison-test.mjs) on FIELD's own real instruments --
// scoreProse (numeric) and the voice judge (qualitative PASS/FAIL) --
// imported directly, same pattern as the existing jq-judge-live-probe.mjs.
// Not the full runQualityChain retry chain, which would mutate the exact
// text being scored -- scores the real output text as-is, per TASK 2's
// explicit "use the actual scoring functions on actual output text".

import { scoreProse, _buildVoiceJudgePrompt } from '../src/journalism-quality.js';

const PROXY_URL = 'https://field-claude-proxy.jeffunglesbee.workers.dev';

async function judgeVerdict(text) {
    const r = await fetch(PROXY_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-FIELD-Relay': 'field-relay-cron-2026' },
        body: JSON.stringify({
            model: 'claude-haiku-4-5-20251001', max_tokens: 100,
            messages: [{ role: 'user', content: _buildVoiceJudgePrompt(text) }],
        }),
    });
    if (!r.ok) return `[judge call failed: HTTP ${r.status}]`;
    const d = await r.json().catch(() => null);
    const verdict = d ? (d.content || []).filter(c => c.type === 'text').map(c => c.text).join('').trim() : null;
    return verdict || '[judge returned no text]';
}

// RESULTS is pasted in from TASK 1's saved output (results.json), embedded
// here so this script is self-contained for a single CI dispatch.
import { readFileSync } from 'fs';
const RESULTS = JSON.parse(readFileSync(new URL('./gemini-comparison-results.json', import.meta.url)));

async function scoreOne(text, sport, game) {
    if (!text) return { score: null, judge: '[no text to score]' };
    const score = await scoreProse(text, { sport, game });
    const judge = await judgeVerdict(text);
    return { score, judge };
}

async function main() {
    console.log('=== gemini-model-comparison-score (TASK 2) ===\n');
    const summary = [];
    for (const entry of RESULTS) {
        const g = entry.game;
        const r = entry.result.body;
        const lite = r['gemini-3.1-flash-lite'];
        const flash = r['gemini-3.5-flash'];
        const gameCtx = { home: g.home, away: g.away, homeScore: g.homeScore, awayScore: g.awayScore };

        console.log(`--- ${g.away} @ ${g.home} (${g.sport}) ---`);

        const liteScored = await scoreOne(lite?.text, g.sport, gameCtx);
        console.log(`  3.1-flash-lite: scoreProse=${liteScored.score}  judge=${JSON.stringify(liteScored.judge)}`);

        const flashScored = await scoreOne(flash?.text, g.sport, gameCtx);
        console.log(`  3.5-flash:      scoreProse=${flashScored.score}  judge=${JSON.stringify(flashScored.judge)}`);
        console.log('');

        summary.push({
            game: `${g.away} @ ${g.home}`, sport: g.sport,
            lite: { ...liteScored, tokensIn: lite?.usage?.input_tokens, tokensOut: lite?.usage?.output_tokens, latencyMs: lite?.latencyMs },
            flash: { ...flashScored, tokensIn: flash?.usage?.input_tokens, tokensOut: flash?.usage?.output_tokens, latencyMs: flash?.latencyMs },
        });
    }

    console.log('=== SUMMARY_JSON_START ===');
    console.log(JSON.stringify(summary));
    console.log('=== SUMMARY_JSON_END ===');
}

main().catch(e => {
    console.error('FATAL:', e);
    process.exit(1);
});
