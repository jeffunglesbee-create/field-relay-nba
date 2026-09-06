// Every parameter FIELD sends to BSD must be one BSD documents.
//
// WHY THIS EXISTS
//
// Measured live 2026-09-06 (outbox/bsd-param-probe-latest.txt): BSD now returns
// HTTP 400 for a parameter it does not recognise, and names the set it accepts:
//
//   {"detail": "Unknown query parameter(s): field_nonsense_param.",
//    "accepted_parameters": ["date_from","date_to","league_id","limit","offset",
//                            "round","season_id","stage","status","team_id","team_name"]}
//
// `runBSDEndgameCapture` was sending `?date=`, which is NOT on that list. It
// returned 200 and filtered correctly, so nothing was broken — it was one
// tightening pass from a 400 on a cron path, resting on a parameter the server
// does not document.
//
// The interesting part is how it got there. A comment ~1850 lines away already
// said, dated and confirmed live 2026-08-01, that `date=` was silently ignored
// on this endpoint and that date_from/date_to was the working filter. One call
// site knew and the other did not, and nothing connected them. A guard is what
// connects them.
//
// WHAT IT DOES NOT DO, stated plainly: it cannot know when BSD changes the
// accepted set. That is a fact about someone else's server and belongs to
// bsd-param-probe.mjs, which asks. This only enforces the list as last measured
// — so a call site cannot drift from it without the drift being visible.
//
// Usage:  node scripts/bsd-param-guard.mjs [--self-test]

import { readFileSync } from 'node:fs'

// As returned by BSD itself on 2026-09-06. Not transcribed from documentation:
// this is the server's own error payload, which is the only authority that
// matters when the server is the thing rejecting.
const ACCEPTED = new Set([
  'date_from', 'date_to', 'league_id', 'limit', 'offset',
  'round', 'season_id', 'stage', 'status', 'team_id', 'team_name',
])

/** Query params sent to any sports.bzzoiro.com URL in a source string. */
export const paramsSentTo = src => {
  const out = []
  // Template literals, so `${...}` is part of the URL text. Stop at the closing
  // backtick, quote, or whitespace.
  for (const m of src.matchAll(/sports\.bzzoiro\.com\/[^\s`'"]*\?([^\s`'"]*)/g)) {
    for (const pair of m[1].split('&')) {
      const name = pair.split('=')[0]
      if (name && !name.includes('${')) out.push({ name, url: m[0].slice(0, 90) })
    }
  }
  return out
}

if (process.argv[1]?.endsWith('bsd-param-guard.mjs')) {
  let failed = 0
  const check = (name, pass, detail) => {
    console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${pass ? '' : `\n      → ${detail}`}`)
    if (!pass) failed++
  }

  if (process.argv.includes('--self-test')) {
    // The REAL line that prompted this, and the real line that replaced it.
    const bad = "`https://sports.bzzoiro.com/api/v2/events/?date=${today}&league_id=27`"
    const good = "`https://sports.bzzoiro.com/api/v2/events/?date_from=${d}&date_to=${d}&league_id=27`"
    check('the guard catches the parameter that actually occurred',
      paramsSentTo(bad).some(p => p.name === 'date' && !ACCEPTED.has(p.name)),
      JSON.stringify(paramsSentTo(bad)))
    check('and clears the documented replacement',
      paramsSentTo(good).every(p => ACCEPTED.has(p.name)),
      JSON.stringify(paramsSentTo(good)))
    check('a URL with no query string yields nothing',
      paramsSentTo('`https://sports.bzzoiro.com/api/v2/events/live/`').length === 0,
      'a bare path must not be read as carrying params')
    check('an interpolated param NAME is skipped rather than guessed',
      paramsSentTo('`https://sports.bzzoiro.com/api/v2/events/?${k}=1`').length === 0,
      'a name built at runtime cannot be checked statically, and must not be reported as a violation')
    process.exit(failed === 0 ? 0 : 1)
  }

  const src = readFileSync('src/index.js', 'utf8')
  const sent = paramsSentTo(src)
  const names = [...new Set(sent.map(p => p.name))].sort()
  const bad = sent.filter(p => !ACCEPTED.has(p.name))

  console.log(`\nBSD query parameters sent from src/index.js: ${names.join(', ') || '(none)'}`)
  console.log(`Accepted by BSD as of 2026-09-06:            ${[...ACCEPTED].sort().join(', ')}\n`)
  for (const p of bad) console.log(`  UNDOCUMENTED  ${p.name}\n      ${p.url}`)

  check('every parameter sent to BSD is one BSD documents',
    bad.length === 0,
    `${bad.length} undocumented: ${[...new Set(bad.map(p => p.name))].join(', ')}. `
    + 'BSD returns HTTP 400 for unknown parameters — see outbox/bsd-param-probe-latest.txt. '
    + 'If BSD has ADDED a parameter, re-run bsd-param-probe.yml and update ACCEPTED from its output.')

  console.log(`\n${failed === 0 ? 'ok' : `${failed} failure(s)`}\n`)
  process.exit(failed === 0 ? 0 : 1)
}
