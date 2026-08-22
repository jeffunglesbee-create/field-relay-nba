#!/usr/bin/env node
// Guards Layer 2f (prompt-example leakage) in src/journalism-quality.js.
//
// THE DEFECT, measured 2026-08-22 on the live desk in two user-facing EPL
// briefs: "Everton maintains a 107.7 DRTG, best in the NBA, despite playing
// soccer tonight" and "Brentford's 37 goals this season". Neither number was
// measured. Both are verbatim strings from FIELD_PROSE_STYLE's own examples --
// and "37 goals" came from the TIME-PERIOD ANCHORING rule's FORBIDDEN list, so
// the rule written to prevent unanchored numbers supplied one.
//
// WHY THE FALSE-POSITIVE CASE IS THE IMPORTANT ONE. "37 goals" is a real figure
// for a team that has scored 37 goals. A detector that flags the literal on
// sight would fire on correct prose and be switched off within a week. The
// discriminator is whether the number appears in the GAME CONTEXT as well as in
// the style block, so the third case below is the one that keeps this check
// honest -- it must stay green.
import { promptExampleLeaks, FIELD_PROSE_STYLE, FIELD_VOICE_REGISTER } from '../src/journalism-quality.js';

// A real prompt carries BOTH instruction blocks. Building test prompts from
// only one is what hid the live defect from the first version of this check.
const PROMPT_WITH_STYLE = (ctx) => `${FIELD_VOICE_REGISTER}\n${ctx}\n${FIELD_PROSE_STYLE}`;

const cases = [
  // The two REAL defects from the live desk. Context has no such figure.
  ['live defect 1', PROMPT_WITH_STYLE('[GAME] Everton v Crystal Palace 2-0.'),
   'Everton maintains a 107.7 DRTG, best in the NBA, despite playing soccer tonight.', ['107.7 DRTG']],
  ['live defect 2', PROMPT_WITH_STYLE('[GAME] Brentford v Spurs 3-0, 58th minute.'),
   "Spurs' 3 shots this match trail Brentford's 37 goals this season.", ['37 goals']],

  // THE FALSE-POSITIVE TEST: a team that genuinely has 37 goals, with the
  // figure present in the context. Must NOT flag.
  ['legit 37 goals', PROMPT_WITH_STYLE('[SEASON] Brentford 37 goals this season.'),
   "Brentford's 37 goals this season lead the table.", []],

  // Clean brief, nothing lifted.
  ['clean', PROMPT_WITH_STYLE('[GAME] Arsenal 3-0 Coventry. Saka scored.'),
   'Saka opened the scoring at the Emirates.', []],

  // THE LIVE DEFECT, reproduced. Brief game_recap_epl_401879321, 18:30:53, was
  // written AFTER Layer 2f deployed (18:28:35) and still carried this. The
  // source is the FIELD_VOICE_REGISTER exemplar ("Pavel Dorofeyev enters with
  // 37 goals this season"), which the first version of the detector did not
  // subtract -- so the leak sat in what it treated as game context.
  ['voice-register leak', PROMPT_WITH_STYLE('[GAME] Brentford v Spurs 3-0, 58th minute.'),
   "Spurs' 3 shots this match trail Brentford's 37 goals this season.", ['37 goals']],

  // THE PARAPHRASE CASE, from the live desk on 2026-08-22 19:17 ET. The Everton
  // brief read "contrasting their 37 goals last season" -- the same fabricated
  // exemplar figure with ONE word changed. The literal list held the full phrase
  // '37 goals this season' at the time, so this was invisible: an exact-string
  // match only ever catches the wording that happened to be observed first, and
  // the model paraphrases rather than quotes. This case is why the list now
  // holds numeric cores.
  ['paraphrased exemplar', PROMPT_WITH_STYLE('[GAME] Everton v Crystal Palace 2-0.'),
   'Everton maintains a clean sheet through 90 minutes, contrasting their 37 goals last season.', ['37 goals']],

  // The paraphrase case's own false-positive control: same wording, but the
  // figure IS in the context. Loosening to the numeric core is only safe because
  // of the absent-from-context condition, so that pairing is tested directly.
  ['legit paraphrase', PROMPT_WITH_STYLE('[SEASON] Everton scored 37 goals last season.'),
   'Everton built on their 37 goals last season.', []],

  // Multiple leaks at once.
  ['two leaks', PROMPT_WITH_STYLE('[GAME] Anything.'),
   'A 107.7 DRTG side that also went 5-for-6.', ['107.7 DRTG', '5-for-6']],
];

let bad = 0;
for (const [name, prompt, text, want] of cases) {
  const got = promptExampleLeaks(prompt, text);
  const ok = JSON.stringify(got.sort()) === JSON.stringify(want.slice().sort());
  if (!ok) bad++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name.padEnd(16)} got=${JSON.stringify(got)} want=${JSON.stringify(want)}`);
}
console.log(bad ? `\n${bad} case(s) FAILED` : '\nall cases pass');
process.exit(bad ? 1 : 0);
