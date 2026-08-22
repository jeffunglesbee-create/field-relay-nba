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
const PROMPT_WITH_STYLE = (ctx) => `${ctx}\n${FIELD_PROSE_STYLE}`;

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
