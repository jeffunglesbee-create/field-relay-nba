#!/usr/bin/env node
// Rule 90: scripts/check-morning-report-degraded.mjs has to fail when the thing it
// guards is broken. Each mutation below breaks one claim in Phase 5 of src/analytics-engine.js
// (the row, the paragraph, the model call, the counts, the log) or in callProxyDetailed,
// runs the check, requires it to go red for the stated reason, then restores the file.
//
// The anchor of every mutation must occur exactly once, or NOTHING is mutated and
// the run fails: a "not caught" with no mutation applied would be worse than no test
// (Rule 90, the corollary for the harness).
import { readFileSync, writeFileSync, copyFileSync, unlinkSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const FILE = 'src/analytics-engine.js';
const CHECK = 'scripts/check-morning-report-degraded.mjs';

const MUTATIONS = [
  { name: 'M1  an empty answer is no longer marked degraded',
    anchor: "? { degraded: true, degraded_reason: 'prose-empty', proxy_failure: proxyFailure }",
    replace: "? { degraded_reason: 'prose-empty', proxy_failure: proxyFailure }",
    expect: 'an HTTP failure is recorded as degraded' },

  { name: 'M2  a morning with no usable pick is no longer marked degraded',
    anchor: "? { degraded: true, degraded_reason: 'bad-structure', structure:",
    replace: "? { degraded_reason: 'bad-structure', structure:",
    expect: 'a morning with no usable pick is recorded as degraded' },

  { name: 'M3  a missing context is no longer marked degraded',
    anchor: "? { degraded: true, degraded_reason: 'no-context' }",
    replace: "? { degraded_reason: 'no-context' }",
    expect: 'a missing context is recorded as degraded' },

  { name: 'M4  a good morning stops saying so',
    anchor: ': { degraded: false, cited: composed.cited,',
    replace: ': { cited: composed.cited,',
    expect: 'a good morning writes degraded:false' },

  { name: 'M5  the template text changes',
    anchor: '`Quiet night across the slate for ${date}. Tomorrow brings another set.`;',
    replace: '`Quiet night across the slate for ${date}.`;',
    expect: 'an HTTP failure writes the template' },

  { name: 'M6  an empty answer counts an AI call',
    anchor: 'return { aiCalls: prose ? 1 : 0, briefText, outcome };',
    replace: 'return { aiCalls: 1, briefText, outcome };',
    expect: 'an empty answer counts no AI call' },

  { name: 'M7  an answer with no usable pick stops counting its AI call',
    anchor: 'return { aiCalls: prose ? 1 : 0, briefText, outcome };',
    replace: 'return { aiCalls: composed ? 1 : 0, briefText, outcome };',
    expect: 'an answer with no usable pick still counts its AI call' },

  { name: 'M8  the model is asked for a morning when there is no game to cite',
    anchor: 'if (prepared.citable.length > 0) {',
    replace: 'if (true) {',
    expect: 'asks the model for nothing' },

  { name: 'M9  the model\'s own answer is printed instead of the relay\'s composition',
    anchor: '? composed.text',
    replace: '? prose',
    expect: 'a good morning prints the headline' },

  { name: 'M10 the composition is thrown away and the template written',
    anchor: 'const composed = finished ? finished.composed : null;',
    replace: 'const composed = null;',
    expect: 'a good morning prints the headline' },

  { name: 'M11 the recompute route loses the outcome',
    anchor: 'aiCalls: r.aiCalls, outcome: r.outcome };',
    replace: 'aiCalls: r.aiCalls };',
    expect: 'recompute returns before, aiCalls 1 and the outcome' },

  { name: 'M12 an HTTP status is dropped from the failure',
    anchor: 'failure: `http-${resp.status}`',
    replace: "failure: 'http'",
    expect: 'an HTTP status is kept in the failure' },

  { name: 'M13 phase 5 goes back to the old token allowance',
    anchor: '{ maxTokens: MR_MAX_TOKENS }',
    replace: '{ maxTokens: 250 }',
    expect: 'phase 5 makes exactly one proxy call, with the production model, max_tokens and secret header' },

  { name: 'M14 phase 5 sends something other than the prepared prompt',
    anchor: 'callProxyDetailed(env, prepared.prompt,',
    replace: "callProxyDetailed(env, 'x',",
    expect: 'phase 5 sends the prepared prompt' },

  { name: 'M15 dropped lines are no longer recorded on a good morning',
    anchor: ', ...(dropped.length > 0 ? { dropped } : {}) };',
    replace: ' };',
    expect: 'is recorded by key and reason on a good morning' },

  { name: 'M16 bad-structure loses its list of dropped ids',
    anchor: 'structure: { recognized: finished.parsed.recognized, dropped } }',
    replace: 'structure: { recognized: finished.parsed.recognized } }',
    expect: 'bad-structure names the ids it dropped and why' },

  { name: 'M17 the model\'s answer is stored in the public value of a bad-structure row',
    anchor: 'structure: { recognized: finished.parsed.recognized, dropped } }',
    replace: 'structure: { recognized: finished.parsed.recognized, dropped, text: prose } }',
    expect: 'the answer text is not stored in the value' },

  { name: 'M18 the dropped text is stored in the public value of a good row',
    anchor: ', ...(dropped.length > 0 ? { dropped } : {}) };',
    replace: ', ...(dropped.length > 0 ? { dropped, prose } : {}) };',
    expect: 'the dropped text is not stored' },

  { name: 'M19 a refused line stops being logged',
    anchor: 'console.error(`[ANALYTICS] morning_report ${composed',
    replace: 'console.log(`[ANALYTICS] morning_report ${composed',
    expect: 'is logged once' },

  { name: 'M20 the log carries the answer\'s text',
    anchor: "|| 'none'}`);",
    replace: "|| 'none'} ${prose}`);",
    expect: 'without their text' },

  { name: 'M21 a good morning stops naming the games it cited',
    anchor: 'cited: composed.cited, ',
    replace: '',
    expect: 'a good morning names the games it cited' },

  { name: 'M22 a night with no game is marked degraded',
    anchor: '? { degraded: false, no_games: true }',
    replace: "? { degraded: true, degraded_reason: 'no-games' }",
    expect: 'a night with no game is not degraded' },

  { name: 'M23 the two reasons are swapped',
    anchor: "degraded_reason: 'prose-empty', proxy_failure: proxyFailure }",
    replace: "degraded_reason: 'bad-structure', proxy_failure: proxyFailure }",
    expect: 'an HTTP failure is recorded as degraded, reason prose-empty' },

  { name: 'M24 a missing context is read as a night with no game',
    anchor: 'const outcome = !ctx',
    replace: 'const outcome = false',
    expect: 'a missing context is recorded as degraded, reason no-context' },

  { name: 'M25 KV is given the model\'s answer, not the composition',
    anchor: 'briefText,\n                { expirationTtl: KV_REPORT_TTL_SECS },',
    replace: 'prose,\n                { expirationTtl: KV_REPORT_TTL_SECS },',
    expect: 'a good morning stores the same text in D1 and in KV' },

  { name: 'M26 the word count is not written',
    anchor: 'word_count: briefText.split(/\\s+/).filter(Boolean).length, stars: stars?.stars',
    replace: 'word_count: 0, stars: stars?.stars',
    expect: 'word_count and stars are still written' },

  { name: 'M27 the star rating is not written',
    anchor: 'stars: stars?.stars || null',
    replace: 'stars: null',
    expect: 'word_count and stars are still written' },

  { name: 'M28 phase 3\'s game is not excluded from the cited games',
    anchor: 'const prepared = prepareMorningReport(date, { stars, truthIs, ctx });',
    replace: 'const prepared = prepareMorningReport(date, { stars, truthIs: null, ctx });',
    expect: 'the truth game is printed once' },

  { name: 'M29 an empty answer is parsed as if it were an answer',
    anchor: 'if (prose) finished = finishMorningReport(prose, prepared, truthIs);',
    replace: 'finished = finishMorningReport(prose, prepared, truthIs);',
    expect: 'an empty answer is not logged as a refused one' },

  { name: 'M30 the headline is not given to the composition',
    anchor: 'finishMorningReport(prose, prepared, truthIs)',
    replace: 'finishMorningReport(prose, prepared, null)',
    expect: 'a good morning prints the headline' },

  { name: 'M31 the model header is no longer read',
    anchor: "const model = resp.headers.get('X-FIELD-Model');",
    replace: 'const model = null;',
    expect: 'the model that answered is reported' },

  { name: 'M32 whitespace-only text counts as an answer',
    anchor: '.trim() || null;',
    replace: ';',
    expect: 'an empty content array is no-text' },
];

let bad = 0;
for (const m of MUTATIONS) {
  const BAK = `${FILE}.mutbak`;
  const before = readFileSync(FILE, 'utf8');
  const hits = before.split(m.anchor).length - 1;
  if (hits !== 1) {
    bad++;
    console.error(`  ANCHOR  ${m.name}\n          anchor occurs ${hits} time(s), expected 1. NOTHING WAS MUTATED.`);
    continue;
  }
  const after = before.replace(m.anchor, () => m.replace);
  if (after === before) { bad++; console.error(`  NO EFFECT  ${m.name}`); continue; }
  copyFileSync(FILE, BAK);
  writeFileSync(FILE, after);
  let out = '', code = 0;
  try { out = execFileSync('node', [CHECK], { encoding: 'utf8' }); }
  catch (e) { code = e.status ?? 1; out = `${e.stdout || ''}${e.stderr || ''}`; }
  finally { copyFileSync(BAK, FILE); unlinkSync(BAK); }
  const red = out.split('\n').filter(l => l.startsWith('FAIL'));
  if (code === 0) { bad++; console.error(`  NOT CAUGHT  ${m.name}`); }
  else if (!red.some(l => l.includes(m.expect))) {
    bad++;
    console.error(`  WRONG REASON  ${m.name}\n          no FAIL line mentioned "${m.expect}".\n${red.join('\n') || out.split('\n').slice(0, 6).join('\n')}`);
  } else console.log(`  caught  ${m.name}\n          by "${m.expect}" (${red.length} red)`);
}

execFileSync('node', ['--check', FILE]);
console.log(`\nran ${MUTATIONS.length} mutation(s) against ${CHECK}; ${FILE} restored and parsing`);
process.exit(bad ? 1 : 0);
