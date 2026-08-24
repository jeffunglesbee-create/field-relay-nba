#!/usr/bin/env node
// A forbidden example must not be copyable prose.
//
// THE MEASURED LEAK. An EPL brief read:
//
//   "Spurs' 3 shots this match trail Brentford's 37 goals this season"
//
// That sentence was not invented. It is verbatim the counter-example inside the
// ONE WINDOW PER COMPARISON rule — the rule shipped on 2026-08-23 specifically
// to stop cross-window comparisons:
//
//   "Spurs' 3 shots this match trail Brentford's 37 goals this season" is not a
//   comparison — it sets one match against one season...
//
// THE RULE WAS ITS OWN ATTACK SURFACE. It taught by printing the broken sentence,
// and because the sentence carried real club names and a real-looking figure, the
// copy read as plausible EPL prose rather than as obvious garbage. TIME-PERIOD
// ANCHORING one line up did the same thing: it forbade "25.0 points", "26.0 PPG"
// and "37 goals" by printing all three.
//
// CC-CMD-2026-08-23-prompt-numeral-mining aimed this at FIELD_VOICE_REGISTER's
// universal segments. Measured at HEAD, those segments carry no mineable figure
// at all — an earlier session already converted them to ## — and 10 of the 11
// tracked literals reaching a gated EPL prompt came from proseStyleFor instead.
// Worse than the ask assumed: the register's are in a block labelled AVOID THIS,
// while these sit in blocks labelled write like this.
//
// THE RULE THIS ENFORCES: a string a prompt tells the model NOT to write must be
// non-instantiable. No real club, no real player, no figure that could pass for
// this game's statistic. `##` placeholders satisfy it, are the convention the
// voice register already uses, and are caught by promptExampleLeaks if copied —
// so a model that copies one produces something visibly broken rather than
// plausibly wrong.
//
// --self-test replays the real pre-fix sentence and requires it to go red.

import { proseStyleFor, voiceRegisterFor, PROMPT_EXAMPLE_LITERALS as LITERALS }
  from '../src/journalism-quality.js'

let fail = 0
const check = (name, cond, detail = '') => {
  if (cond) console.log(`  ok   ${name}`)
  else { fail++; console.log(`  FAIL ${name}${detail ? '\n       ' + detail : ''}`) }
}

// Quoted strings sitting in a position the surrounding text marks as forbidden.
// Three constructs, all present in the style block today.
export const negativeExamples = (block) => {
  const out = []
  for (const line of String(block).split('\n')) {
    // 1. `"X" is not a comparison` / `"X" is not ...`
    for (const m of line.matchAll(/"([^"]+)"\s+is not\b/g)) out.push(m[1])
    // 2. Anything quoted between `Bare numbers like` and `ARE FORBIDDEN`.
    const span = /Bare numbers like(.*?)ARE FORBIDDEN/s.exec(line)
    if (span) for (const m of span[1].matchAll(/"([^"]+)"/g)) out.push(m[1])
    // 3. The rejected half of `write "X" not "Y"`.
    for (const m of line.matchAll(/\bnot\s+"([^"]+)"/g)) out.push(m[1])
  }
  return out
}

// Instantiable = carries a digit run that is not a `#` placeholder. A number the
// model can lift and present as this game's statistic.
export const instantiable = (s) => /\d/.test(String(s).replace(/#+/g, ''))

const SPORTS = ['EPL', 'NBA', 'NHL', 'MLB', 'WNBA', 'NFL']

if (process.argv.includes('--self-test')) {
  console.log('self-test: the sentence that actually leaked goes red')

  // VERBATIM, from src/journalism-quality.js before 2026-08-24.
  const PRE_FIX = '- ONE WINDOW PER COMPARISON (mandatory): a comparison must measure both '
    + 'sides over the SAME time period. "Spurs\' 3 shots this match trail Brentford\'s 37 goals '
    + 'this season" is not a comparison — it sets one match against one season.'
  const found = negativeExamples(PRE_FIX)
  check('the pre-fix counter-example is extracted',
    found.length === 1 && found[0].includes('Brentford'), JSON.stringify(found))
  check('...and is judged instantiable',
    instantiable(found[0]), 'a real club plus a real-looking figure reads as plausible prose')

  const PRE_FIX_2 = '- TIME-PERIOD ANCHORING: Bare numbers like "25.0 points", "26.0 PPG", '
    + '"37 goals" without a clear timeframe ARE FORBIDDEN.'
  const f2 = negativeExamples(PRE_FIX_2)
  check('the forbidden-list examples are extracted',
    f2.length === 3, JSON.stringify(f2))
  check('...and all three are instantiable',
    f2.every(instantiable), JSON.stringify(f2.filter((x) => !instantiable(x))))

  // The placeholder form must pass, or the rule is unsatisfiable.
  check('a ## placeholder is NOT instantiable',
    !instantiable("the home side's ## shots this match trail the away side's ## goals this season"))
  check('...and neither is #-for-#',
    !instantiable('#-for-# with # RBIs'))
  // The control: a checker that calls everything clean passes the line above
  // while proving nothing.
  check('a bare real figure IS instantiable', instantiable('37 goals'))

  // And the extractor must not fire on a POSITIVE exemplar, which legitimately
  // carries a real figure and is caught by promptExampleLeaks instead.
  check('a positive exemplar is not extracted as a negative one',
    negativeExamples('- STYLE: numbers over adjectives. "Brunson\'s 29.0 PPG this series" reads well.').length === 0)
} else {
  console.log('no forbidden example is copyable prose')
  for (const sport of SPORTS) {
    const block = proseStyleFor(sport) + '\n' + voiceRegisterFor(sport)
    const neg = negativeExamples(block)
    const bad = neg.filter(instantiable)
    check(`${sport}: ${neg.length} forbidden example(s), none instantiable`,
      bad.length === 0,
      bad.map((b) => `  "${b}"`).join('\n       ')
        + '\n       a model that copies this produces plausible prose, not visible breakage')
  }
  // The extractor must be finding something, or every line above is vacuous.
  const total = SPORTS.reduce((n, s) => n + negativeExamples(proseStyleFor(s) + '\n' + voiceRegisterFor(s)).length, 0)
  check(`the extractor found forbidden examples to check (${total})`,
    total > 0, 'zero means the constructs moved and this check has stopped working')
  // A tracked literal must never sit in a negative position: it is there to be
  // detected in OUTPUT, and printing it as a forbidden example teaches it.
  const inNeg = []
  for (const sport of SPORTS)
    for (const ex of negativeExamples(proseStyleFor(sport) + '\n' + voiceRegisterFor(sport)))
      for (const lit of LITERALS) if (lit !== '##' && ex.includes(lit)) inNeg.push(`${sport}: "${ex}" carries ${lit}`)
  check('no tracked literal is printed as a forbidden example',
    inNeg.length === 0, inNeg.join('\n       '))
}

console.log(fail ? `\n${fail} failed` : '\nall passed')
process.exit(fail ? 1 : 0)
