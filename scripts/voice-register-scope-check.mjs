#!/usr/bin/env node
// Locks voiceRegisterFor(sport) — CC-CMD-2026-08-22-brief-sport-contamination.
//
// Five of the seven voice exemplars are basketball or hockey. Every soccer brief
// was handed all seven, directly beneath "SPORT BOUNDARY: write ONLY EPL
// content". This check holds three properties:
//   a) a brief sees the exemplars for its own sport, and no others;
//   b) a sport with no exemplar of its own (baseball, football) still gets all
//      of them, so segmentation never empties the register;
//   c) layer 2f still reports a leaked literal from a GATED prompt — the same
//      subset-vs-joined-string hazard fixed for the style block.
//
// Run: node scripts/voice-register-scope-check.mjs
import {
  voiceRegisterFor, proseStyleFor, FIELD_VOICE_REGISTER,
  VOICE_REGISTER_SEGMENTS, promptExampleLeaks, PROMPT_EXAMPLE_LITERALS,
} from '../src/journalism-quality.js';

let pass = 0, fail = 0;
const ok = (label, cond, detail = '') => {
  if (cond) { console.log(`PASS  ${label}`); pass++; }
  else { console.error(`FAIL  ${label}${detail ? ' — ' + detail : ''}`); fail++; }
};
const exemplars = t => (t.match(/— Exemplar ([A-G])/g) || []).map(m => m.slice(-1)).join('');

// a) segmentation is lossless — the ungated register is exactly the segments.
ok('ungated register === every segment joined',
  FIELD_VOICE_REGISTER === VOICE_REGISTER_SEGMENTS.flatMap(s => s.lines).join('\n'));
ok('ungated register carries all seven exemplars',
  exemplars(FIELD_VOICE_REGISTER) === 'ABCDEFG', exemplars(FIELD_VOICE_REGISTER));

// b) per-sport scoping.
const CASES = [
  ['EPL', 'DE'], ['La Liga', 'DE'], ['MLS', 'DE'], ['WC26', 'DE'],
  ['NBA', 'ABF'], ['WNBA', 'ABF'],
  ['NHL', 'CG'],
  ['MLB', 'ABCDEFG'], ['NFL', 'ABCDEFG'],   // no exemplar of their own -> keep all
];
for (const [sport, want] of CASES) {
  const got = exemplars(voiceRegisterFor(sport));
  ok(`${sport} sees exemplars ${want}`, got === want, `got ${got}`);
}
ok('soccer keeps the INTERNATIONAL SOCCER CONVENTION',
  /INTERNATIONAL SOCCER CONVENTION/.test(voiceRegisterFor('EPL')));
ok('basketball drops the INTERNATIONAL SOCCER CONVENTION',
  !/INTERNATIONAL SOCCER CONVENTION/.test(voiceRegisterFor('NBA')));

// c) universal teaching survives every gate — segmentation must not delete it.
for (const sport of ['EPL', 'NBA', 'NHL', 'MLB']) {
  const t = voiceRegisterFor(sport);
  ok(`${sport} keeps framing, anti-exemplar, grammar and priority`,
    /FIELD VOICE FRAMING/.test(t) && /ANTI-EXEMPLAR/.test(t) &&
    /NUMBERS-IN-PROSE GRAMMAR/.test(t) && /PRIORITY/.test(t));
}

// d) the coupling hazard, for the register this time.
const gated = voiceRegisterFor('EPL') + '\n' + proseStyleFor('EPL') +
  '\nGame data: Everton 2 Crystal Palace 0';
const atRisk = PROMPT_EXAMPLE_LITERALS.filter(l => gated.includes(l));
ok('gated soccer prompt still carries tracked literals', atRisk.length > 0);
for (const lit of atRisk) {
  ok(`2f reports "${lit}" from a gated soccer prompt`,
    promptExampleLeaks(gated, `Everton, a ${lit} side, held on.`).includes(lit));
}
// e) CC-CMD-2026-08-23-prompt-numeral-mining. The universal segments reach every
// brief in every sport by design, so a real-looking figure sitting in them is
// mineable by all of them. They now carry ## placeholders instead.
//
// This assertion is why the at-risk count above is allowed to fall: it dropped
// from 34 to 30 assertions when four literals left the register, and without
// this line that drop would look like coverage quietly shrinking.
const universal = VOICE_REGISTER_SEGMENTS.filter(s => s.sport === null).flatMap(s => s.lines).join('\n');
const stillThere = PROMPT_EXAMPLE_LITERALS.filter(l => l !== '##' && universal.includes(l));
ok('no tracked literal survives in the universal segments', stillThere.length === 0,
  stillThere.join(', '));

// A placeholder is only safe if copying it is detectable. Without this, the fix
// would trade a plausible fabrication for an invisible one.
ok('2f reports the placeholder itself if a draft copies it',
  promptExampleLeaks(gated, 'Everton, a ## goals side, held on.').includes('##'));

// The teaching must survive the substitution — six patterns, both halves of each.
ok('all six numbers-in-prose patterns and their wire/FIELD pairs survive',
  (universal.match(/PATTERN \d/g) || []).length === 6 &&
  (universal.match(/Wire copy:/g) || []).length === 6 &&
  /ANTI-EXEMPLAR/.test(universal));

ok('2f stays silent when the figure is real game context',
  promptExampleLeaks(gated + '\nEverton have 37 goals this season',
    'Everton, a 37 goals side, held on.').length === 0);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
