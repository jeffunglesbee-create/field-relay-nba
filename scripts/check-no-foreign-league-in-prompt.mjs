#!/usr/bin/env node
// No sport's prompt may name another sport's league.
//
// WHY EVERY BRIEF KEPT GETTING CONTAMINATED. Sport-specific content in this file
// is UNIVERSAL BY DEFAULT and scoped BY EXCEPTION. Every addition reaches every
// sport until somebody remembers to gate it, and forgetting is silent — there is
// no error, no failing test, and the brief still reads plausibly. Measured over
// one day, the same shape in four places:
//
//   proseStyleFor      a rule reached every sport unless added to SPORT_SCOPED_RULES
//   proseStyleFor      a rule's EXAMPLE reached every sport even when the rule was scoped
//   voiceRegisterFor   a sport with no segment of its own received ALL of them
//   detectSportClass   a sport it did not recognise took the same path as the slate
//
// The last two put basketball and hockey exemplars into 905 of 1322 finalized
// games — 68.5%, MLB alone 830 — for as long as those functions have existed.
//
// THE DETECTOR ALREADY EXISTED AND WAS POINTED THE WRONG WAY. checkSportVocab
// finds wrong-sport vocabulary and has only ever been run on OUTPUT, as layer
// 2b. Run on the PROMPT it reports "inning" and "period" for five of seven
// sports — both false positives: it is a substring matcher, and "period" is
// matching the name of the TIME-PERIOD ANCHORING rule. A guard at that precision
// gets ignored, which is the same as not existing.
//
// LEAGUE NAMES ARE THE PRECISE MARKER. "NBA", "NHL", "PGA Tour" cannot appear in
// a soccer prompt for an innocent reason, and they are exactly what the live
// defect said: "Everton maintains a 107.7 DRTG, best in the NBA, despite playing
// soccer". Zero false positives across all seven sports today.
//
// This is ONE check over EVERY source, rather than one guard per source written
// after each incident. A new context source is covered the day it is added.
//
// --self-test runs the pre-fix ungated blocks and requires them red.

import { proseStyleFor, voiceRegisterFor, detectSportClass,
         FIELD_PROSE_STYLE, FIELD_VOICE_REGISTER } from '../src/journalism-quality.js'

let fail = 0
const check = (name, cond, detail = '') => {
  if (cond) console.log(`  ok   ${name}`)
  else { fail++; console.log(`  FAIL ${name}${detail ? '\n       ' + detail : ''}`) }
}

// Word-boundary matched, so "NBA" does not fire inside a longer token. Every
// entry is a league this relay actually briefs, read from the corpus.
export const LEAGUES = {
  basketball: ['NBA', 'WNBA'],
  hockey:     ['NHL'],
  baseball:   ['MLB'],
  football:   ['NFL', 'CFL'],
  soccer:     ['Premier League', 'EPL', 'La Liga', 'MLS', 'Serie A', 'Ligue 1', 'Bundesliga'],
  golf:       ['PGA Tour', 'PGA'],
}

// LEAGUE BOUNDARIES is the one legitimate exception and is exempt BY NAME. It
// names every league because it is the rule FORBIDDING cross-league mixing --
// "NBA winners advance to the NBA Finals to face another NBA team" -- and the
// file already records why it must not be scoped: removing it from a soccer
// prompt "would delete the guardrail, not the contamination". Exempting a whole
// line by prefix, not the league tokens globally, so a second rule quietly
// naming the NBA still fires.
const EXEMPT_PREFIX = '- LEAGUE BOUNDARIES'
const strip = (text) => text.split('\n').filter((l) => !l.startsWith(EXEMPT_PREFIX)).join('\n')

export const foreignLeagues = (rawText, cls) => {
  const text = strip(rawText)
  return Object.entries(LEAGUES)
    .filter(([c]) => c !== cls)
    .flatMap(([c, names]) => names
      .filter((n) => new RegExp(`\\b${n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(text))
      .map((n) => `${n} (${c})`))
}

// The sports this relay briefs, one per class plus the classes' second leagues.
const SPORTS = ['EPL', 'MLS', 'La Liga', 'NBA', 'WNBA', 'NHL', 'MLB', 'NFL', 'CFL', 'golf']

if (process.argv.includes('--self-test')) {
  console.log('self-test: the pre-fix ungated prompt goes red')

  // What an EPL prompt carried before the gating landed: every rule, every
  // exemplar. This is not a fixture — both exports are the real ungated blocks,
  // still live for the mixed-sport slate.
  const preFix = FIELD_VOICE_REGISTER + '\n' + FIELD_PROSE_STYLE
  const found = foreignLeagues(preFix, 'soccer')
  check('an ungated block handed to soccer names other leagues',
    found.length >= 2, JSON.stringify(found))
  check('...including the NBA, which is what the live defect said',
    found.some((f) => f.startsWith('NBA ')),
    '"Everton maintains a 107.7 DRTG, best in the NBA, despite playing soccer"')

  // And the control: the same block is CORRECT for the slate, which covers many
  // sports at once. A checker that reds everything proves nothing.
  check('the same block is not an error for the mixed-sport slate',
    detectSportClass(null) === null,
    'the slate has no class, so no league is foreign to it')

  // The matcher must be word-bounded, or it fires on any token containing a
  // league name and becomes the substring matcher this guard exists to replace.
  check('a league name inside a longer word does not fire',
    foreignLeagues('the NBAX index and PGAs', 'soccer').length === 0,
    JSON.stringify(foreignLeagues('the NBAX index and PGAs', 'soccer')))
  check('...but the bare name does',
    foreignLeagues('best in the NBA', 'soccer').length === 1)
} else {
  console.log(`no sport's prompt names another sport's league (${SPORTS.length} sports)`)
  for (const sport of SPORTS) {
    const cls = detectSportClass(sport)
    const prompt = voiceRegisterFor(sport) + '\n' + proseStyleFor(sport)
    const found = foreignLeagues(prompt, cls)
    check(`${sport} (${cls})`, found.length === 0,
      `carries ${found.join(', ')}\n       sport content is universal by default here — a new rule or exemplar reaches every sport until it is scoped`)
  }
  // The control: every sport must resolve to a class, or a null class makes
  // every league "foreign to nothing" and the loop above passes vacuously.
  const unclassed = SPORTS.filter((s) => !detectSportClass(s))
  check('every briefed sport resolves to a class',
    unclassed.length === 0,
    `${JSON.stringify(unclassed)} — an unclassified sport takes the slate's keep-everything path`)
  // And the matcher must be finding names somewhere, or it is broken.
  check('the matcher finds leagues when they are present',
    foreignLeagues(FIELD_PROSE_STYLE, 'soccer').length > 0,
    'the ungated block names the NBA; if this is clean the regex has stopped working')
}

console.log(fail ? `\n${fail} failed` : '\nall passed')
process.exit(fail ? 1 : 0)
