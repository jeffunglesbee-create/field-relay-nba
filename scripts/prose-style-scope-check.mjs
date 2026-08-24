#!/usr/bin/env node
// Locks the two behaviors shipped for CC-CMD-2026-08-22-brief-sport-contamination.
//
// 1. A soccer brief's style block names no basketball metric and no non-soccer
//    league example. (The filed defect: a live EPL brief read "Everton maintains
//    a 107.7 DRTG, best in the NBA, despite playing soccer tonight" -- the CITE
//    NBA ANALYTICS example, verbatim.)
// 2. promptExampleLeaks (layer 2f) still fires on a SPORT-GATED prompt. Gating
//    the block changes what the prompt carries, and 2f used to subtract the
//    joined FIELD_PROSE_STYLE string to tell instructions from game data. A
//    subset no longer matches that string, so 10 of the 16 tracked literals
//    would have gone silently undetectable -- the detector dying in the same
//    commit that reduced the leaks. Per-rule subtraction is what prevents it.
//
// Run: node scripts/prose-style-scope-check.mjs
import {
  proseStyleFor, FIELD_PROSE_STYLE, PROSE_STYLE_RULES,
  FIELD_VOICE_REGISTER, promptExampleLeaks, PROMPT_EXAMPLE_LITERALS,
} from '../src/journalism-quality.js';

let pass = 0, fail = 0;
const ok = (label, cond, detail = '') => {
  if (cond) { console.log(`PASS  ${label}`); pass++; }
  else { console.error(`FAIL  ${label}${detail ? ' — ' + detail : ''}`); fail++; }
};

const FOREIGN = /\b(DRTG|ORTG|NBA|NHL|NFL|MLB|WNBA)\b/;
const SOCCER = ['EPL', 'La Liga', 'MLS', 'Bundesliga', 'UEFA', 'Serie A', 'WC26'];

// 1 — every soccer label gets a block clean of foreign metrics/leagues, EXCEPT
// the LEAGUE BOUNDARIES rule, which names every league in order to forbid
// mixing them. Subtract that one rule before testing.
const boundaries = PROSE_STYLE_RULES.find(r => r.startsWith('- LEAGUE BOUNDARIES'));
ok('LEAGUE BOUNDARIES rule still exists', !!boundaries);
for (const sport of SOCCER) {
  const block = proseStyleFor(sport).split(boundaries).join(' ');
  ok(`${sport} style block names no foreign league or rating metric`,
    !FOREIGN.test(block), (block.match(FOREIGN) || [])[0]);
}

// 2 — basketball keeps what it needs; nothing was deleted globally.
ok('NBA keeps CITE NBA ANALYTICS', /107\.7 DRTG/.test(proseStyleFor('NBA')));
ok('WNBA keeps CITE NBA ANALYTICS', /107\.7 DRTG/.test(proseStyleFor('WNBA')));
ok('unknown sport gets every rule (mixed slate brief unchanged)',
  proseStyleFor(null) === FIELD_PROSE_STYLE &&
  proseStyleFor(null).split('\n').length === PROSE_STYLE_RULES.length);

// 3 — the coupling hazard. Every tracked literal that survives into a gated
// soccer block must still be reported when a draft echoes it.
const epl = proseStyleFor('EPL');
const gatedPrompt = FIELD_VOICE_REGISTER + '\n' + epl + '\nGame data: Everton 2 Crystal Palace 0';
const atRisk = PROMPT_EXAMPLE_LITERALS.filter(l => epl.includes(l));
ok('gated soccer block still carries literals from universal rules', atRisk.length > 0);
for (const lit of atRisk) {
  ok(`2f reports "${lit}" leaked into a gated soccer brief`,
    promptExampleLeaks(gatedPrompt, `Everton, a ${lit} side, held on.`).includes(lit));
}

// 4 — the discriminator still holds: a figure genuinely in the game context is
// not a leak. Without this, per-rule subtraction would just be a blunter filter.
ok('2f stays silent when the figure is real game context',
  promptExampleLeaks(gatedPrompt + '\nEverton have 37 goals this season',
    'Everton, a 37 goals side, held on.').length === 0);

// 5 — CC-CMD-2026-08-23-prompt-numeral-mining, retargeted.
//
// That ask aimed at FIELD_VOICE_REGISTER's universal segments. Measured at HEAD
// they carry no mineable figure at all -- an earlier session had already
// converted them to ## -- and 10 of the 11 tracked literals reaching a gated EPL
// prompt came from proseStyleFor instead. Worse than the ask assumed: the
// register's numbers sat in a block labelled AVOID THIS, while these sat in
// blocks the model is told to emulate.
//
// THIS ASSERTION IS WHY THE at-risk COUNT ABOVE IS ALLOWED TO FALL. It dropped
// from 23 to 19 when five literals left the style block, and the voice-register
// check carries the same note for the same reason at 34 -> 30. Without a line
// asserting the REMOVAL, a per-literal loop shrinking looks identical to
// coverage quietly disappearing -- and 0 failed either way.
const negIn = (block) => {
  const out = [];
  for (const line of String(block).split('\n')) {
    for (const m of line.matchAll(/"([^"]+)"\s+is not\b/g)) out.push(m[1]);
    const span = /Bare numbers like(.*?)ARE FORBIDDEN/s.exec(line);
    if (span) for (const m of span[1].matchAll(/"([^"]+)"/g)) out.push(m[1]);
    for (const m of line.matchAll(/\bnot\s+"([^"]+)"/g)) out.push(m[1]);
  }
  return out;
};
for (const sport of ['EPL', 'NBA', 'NHL', 'MLB']) {
  const bad = negIn(proseStyleFor(sport)).filter(x => /\d/.test(x.replace(/#+/g, '')));
  ok(`${sport}: no forbidden example in the style block carries a real figure`,
    bad.length === 0, bad.map(b => `"${b}"`).join(' '));
}
// And the extractor must find something, or the four lines above are vacuous.
ok('the forbidden-example extractor found examples to check',
  negIn(proseStyleFor('EPL')).length > 0,
  'zero means the constructs moved and this stopped checking anything');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
