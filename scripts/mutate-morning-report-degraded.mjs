#!/usr/bin/env node
// Rule 90: scripts/check-morning-report-degraded.mjs has to fail when the thing it
// guards is broken. Each mutation below breaks one claim in src/analytics-engine.js,
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
    anchor: '{ degraded: true, degraded_reason: degradedReason, proxy_failure: proxyFailure }',
    replace: '{ degraded_reason: degradedReason, proxy_failure: proxyFailure }',
    expect: 'an HTTP failure is recorded as degraded' },

  { name: 'M2  a guard rejection is no longer marked degraded',
    anchor: '{ degraded: true, degraded_reason: degradedReason, guard:',
    replace: '{ degraded_reason: degradedReason, guard:',
    expect: 'a guard rejection is recorded as degraded' },

  { name: 'M3  the two reasons are swapped',
    anchor: "!prose ? 'prose-empty' : (substitutions.length > 0 ? 'team-name-guard' : null)",
    replace: "!prose ? 'team-name-guard' : (substitutions.length > 0 ? 'prose-empty' : null)",
    expect: 'an HTTP failure is recorded as degraded, reason prose-empty' },

  { name: 'M4  a good morning stops saying so',
    anchor: '{ degraded: false }',
    replace: '{}',
    expect: 'a good morning writes degraded:false' },

  { name: 'M5  the template text changes',
    anchor: '`Quiet night across the slate for ${date}. Tomorrow brings another set.`;',
    replace: '`Quiet night across the slate for ${date}.`;',
    expect: 'a rejected answer is replaced by the template' },

  { name: 'M6  a rejected answer stops counting its AI call',
    anchor: 'return { aiCalls: prose ? 1 : 0, briefText, outcome };',
    replace: 'return { aiCalls: (prose && briefText === prose) ? 1 : 0, briefText, outcome };',
    expect: 'a rejected answer still counts its AI call' },

  { name: 'M7  the qualifier rule stops matching a city',
    anchor: "([A-Z][a-zA-Z']*)",
    replace: '(ZZZZ)',
    expect: 'a city-qualified name is caught' },

  { name: 'M8  the missing-team rule is dropped',
    anchor: 'const missingTeam = [g.home, g.away].filter(name => !teamPresent(prose, name));',
    replace: 'const missingTeam = [];',
    expect: 'a missing team is caught' },

  { name: 'M9  the guard stops rejecting',
    anchor: 'const briefText = (prose && substitutions.length === 0)',
    replace: 'const briefText = (prose)',
    expect: 'a rejected answer is replaced by the template' },

  { name: 'M10 phase 5 sends something other than the built prompt',
    anchor: 'callProxyDetailed(env, prompt, { maxTokens: 250 })',
    replace: "callProxyDetailed(env, 'x', { maxTokens: 250 })",
    expect: 'phase 5 sends the built prompt' },

  { name: 'M11 the recompute route loses the outcome',
    anchor: 'aiCalls: r.aiCalls, outcome: r.outcome };',
    replace: 'aiCalls: r.aiCalls };',
    expect: 'recompute returns before, aiCalls 1 and the outcome' },

  { name: 'M12 an HTTP status is dropped from the failure',
    anchor: 'failure: `http-${resp.status}`',
    replace: "failure: 'http'",
    expect: 'an HTTP status is kept in the failure' },

  { name: 'M13 the matched qualifier text is replaced by a constant',
    anchor: 'return m ? m[0] : null;',
    replace: "return m ? 'x' : null;",
    expect: 'with the text that tripped the rule' },

  { name: 'M14 only home-first scores are checked',
    anchor: 'if (!prose.includes(awayFirst) && !prose.includes(homeFirst)) continue;',
    replace: 'if (!prose.includes(homeFirst)) continue;',
    expect: 'a score written away-first is checked' },

  { name: 'M15 no prose crashes the guard instead of passing through',
    anchor: 'if (!prose) return [];',
    replace: '',
    expect: 'no prose is not a guard finding' },

  { name: 'M16 the model header is no longer read',
    anchor: "const model = resp.headers.get('X-FIELD-Model');",
    replace: 'const model = null;',
    expect: 'the model that answered is reported' },

  { name: 'M17 whitespace-only text counts as an answer',
    anchor: '.trim() || null;',
    replace: ';',
    expect: 'an empty content array is no-text' },

  { name: 'M18 the guard stops logging its rejection',
    anchor: "console.error('[ANALYTICS] morning_report rejected:",
    replace: "console.log('[ANALYTICS] morning_report rejected:",
    expect: 'a guard rejection is logged once' },

  { name: 'M19 the rejected prose is stored in the public value',
    anchor: 'guard: { offenders: substitutions.length, first: substitutions[0] }',
    replace: 'guard: { offenders: substitutions.length, first: substitutions[0], prose }',
    expect: 'the rejected prose is not stored' },
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
