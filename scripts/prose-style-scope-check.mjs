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
  FIELD_VOICE_REGISTER, promptExampleLeaks, PROMPT_EXAMPLE_LITERALS, styleRuleVariants} from '../src/journalism-quality.js';

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

// 6 — GATING EXTENDED TO THE STYLE LINES (2026-08-24, authorised separately
//     from the CC-CMD, whose scope boundary forbade it).
//
// Every tracked literal reaching a prompt must belong to that prompt's sport.
// Before: an EPL prompt carried 5 basketball/baseball/hockey figures, and a GOLF
// prompt carried all six -- golf has no detectSportClass branch, so it fell into
// the same ungated path as the mixed-sport slate.
const OWN = {
  EPL: [], NFL: [], golf: [], CFL: [], atp: [],
  NBA:  ['107.7 DRTG', '29.0 PPG', '28.2 PPG', '48 minutes'],
  WNBA: ['107.7 DRTG', '29.0 PPG', '28.2 PPG', '48 minutes'],
  NHL:  ['93.5% penalty kill'],
  MLB:  ['5-for-6'],
};
for (const [sport, own] of Object.entries(OWN)) {
  const got = PROMPT_EXAMPLE_LITERALS.filter(l => l !== '##' && proseStyleFor(sport).includes(l));
  ok(`${sport}: carries only its own figures${own.length ? '' : ' (none)'}`,
    got.length === own.length && own.every(o => got.includes(o)),
    `got ${JSON.stringify(got)}, expected ${JSON.stringify(own)}`);
}
// The slate brief legitimately covers many sports at once and keeps everything.
// Without this the gating could be "fixed" by emptying the rules entirely.
ok('the mixed-sport slate still carries every example',
  PROMPT_EXAMPLE_LITERALS.filter(l => l !== '##' && proseStyleFor(null).includes(l)).length === 6);
// A rule must not lose its LESSON when it loses an example.
ok('a universal rule survives the loss of its example',
  proseStyleFor('EPL').includes('- STYLE: numbers over adjectives.')
  && proseStyleFor('EPL').includes('- TIME-PERIOD ANCHORING'),
  'scoping the rule rather than the example would delete a lesson every sport needs');
// And each example goes to the ONE sport it belongs to, not to none.
ok('basketball keeps the Wembanyama example, baseball keeps Jung Hoo Lee',
  proseStyleFor('NBA').includes('28.2 PPG') && !proseStyleFor('NBA').includes('5-for-6')
  && proseStyleFor('MLB').includes('5-for-6') && !proseStyleFor('MLB').includes('28.2 PPG'),
  'the first version scoped both together and baseball lost its own correct example');
// The split of CITE ANALYTICS, which the file flagged as a carry-forward.
// 8 — CITE GOLF ANALYTICS, authored 2026-08-24.
ok('golf receives its own analytics rule',
  proseStyleFor('golf').includes('- CITE GOLF ANALYTICS:'),
  'detectSportClass must classify golf for a golf-scoped rule to reach it');
for (const other of ['EPL', 'NBA', 'NHL', 'MLB', 'NFL'])
  ok(`${other} does not receive the golf rule`,
    !proseStyleFor(other).includes('CITE GOLF ANALYTICS'));
// Every figure it names is read from the block the assembler emits, not from
// general golf knowledge. These three are the contract.
ok('the golf rule names the block it reads and the three fields in it',
  ['[GOLF CONTEXT]', 'position', 'to-par', 'thru']
    .every(t => proseStyleFor('golf').includes(t)),
  'a rule citing a tag the data never emits instructs the model to invent one');
// E is what src/index.js renders when toPar is null. A model treating it as
// missing drops a real score.
ok('the golf rule says E is a score, not a missing value',
  /"E" is even par, a real score and not a missing value/.test(proseStyleFor('golf')));
// thru means the round is in progress. This is the golf equivalent of the
// finality defect Dim 11 exists to catch.
ok('the golf rule forbids presenting an unfinished round as final',
  /has NOT finished the round/.test(proseStyleFor('golf')));
// And it adds no new mineable figure — the reason every positive exemplar in
// this file that carries a real number is a literal the model has been measured
// mining.
ok('the golf rule carries no real figure',
  !/\d/.test(proseStyleFor('golf').split('\n').find(l => l.startsWith('- CITE GOLF ANALYTICS:')).replace(/#+/g, '')),
  'a rule written today has no reason to add a new mineable literal');

ok('CITE ANALYTICS is split and each half reaches only its sport',
  proseStyleFor('NHL').includes('CITE HOCKEY ANALYTICS')
  && !proseStyleFor('EPL').includes('CITE HOCKEY ANALYTICS')
  && proseStyleFor('EPL').includes('CITE SOCCER ANALYTICS')
  && proseStyleFor('MLB').includes('CITE BASEBALL ANALYTICS'));

// 7 — THE VARIANT LIST MUST COVER THE EMITTER.
//
// Layer 2f subtracts the instructions before searching for a leak. It does that
// by subtracting each style rule, and a rule the subtraction does not know about
// stays in what 2f treats as game context -- so every literal in it looks like
// real data and 2f goes silent. That happened in the commit that extended the
// gating: shortening a rule made it a non-member of PROSE_STYLE_RULES.
//
// This is the edge that keeps them tied: every line proseStyleFor emits, for
// every sport, must appear in styleRuleVariants().
const variants = new Set(styleRuleVariants());
const uncovered = [];
for (const sport of ['EPL', 'NBA', 'NHL', 'MLB', 'WNBA', 'NFL', 'golf', 'CFL', 'atp', null])
  for (const line of proseStyleFor(sport).split('\n'))
    if (line && !variants.has(line)) uncovered.push(`${sport || 'slate'}: ${line.slice(0, 70)}…`);
ok('every line proseStyleFor emits is a known rule variant',
  uncovered.length === 0,
  uncovered.join('\n       ') + '\n       an unknown variant is not subtracted, so layer 2f goes blind on it');
// And the control: the variant list must be larger than the rule list, or the
// generator produced nothing and the line above passes trivially.
ok('the variant list actually contains shortened forms',
  styleRuleVariants().length > FIELD_PROSE_STYLE.split('\n').length,
  `${styleRuleVariants().length} variants for ${FIELD_PROSE_STYLE.split('\n').length} rules`);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
