// What does seeding CFB actually cost, and does groups=80 matter?
//
// PROBE BEFORE BUILD (Rule 68). Adding a CFB row to the journalism cron's
// LEAGUES table makes every tick fetch the college-football scoreboard and
// archive-write every event on it. Two things must be measured first, not
// assumed, because both change the shape of the change:
//
//   1. VOLUME. CFB runs 60-130+ games on a Saturday against ~15 for MLB. The
//      cron fires every 15 minutes. A seed row is not "one row" if it triples
//      what a Saturday tick walks.
//
//   2. groups=80. V2_LEAGUES line 1212 says "groups=80 on college-football
//      scopes to FBS -- avoids FCS/D2/D3 flooding results (confirmed the
//      default returns the same count today, but the explicit param is the
//      correct, robust choice, not relying on undocumented default behavior
//      that could change)."
//
//      That string is the ONLY occurrence of groups=80 in the entire relay. It
//      is a comment. Nothing appends the parameter -- not /v2/games, not the
//      cron loop. jubilant-bassoon DOES append it (FETCH_LEAGUES groupsParam,
//      CC-CMD-2026-08-02-add-football-to-date-fixtures-sweep), so the client and
//      the relay ask ESPN different questions about the same competition.
//
//      The comment's own claim -- that the default matches groups=80 -- was
//      "confirmed today" on 2026-07-03, on a date with no CFB season underway.
//      Rule 72: re-verify it in season before relying on it.
//
// This prints the numbers. It decides nothing.

const ESPN = 'https://site.api.espn.com/apis/site/v2/sports/football/college-football/scoreboard'

// Real Saturdays of the 2026 season, plus the opening week the fixtures-sweep
// CC-CMD verified against (2026-08-29, 8 FBS games) so one row is comparable to
// a measurement already in the record.
const DATES = process.argv.slice(2).filter(a => /^\d{8}$/.test(a))
const dates = DATES.length ? DATES : ['20260829', '20260905', '20260912', '20260919']

const count = async (url) => {
  try {
    const r = await fetch(url)
    if (!r.ok) return { n: null, why: `HTTP ${r.status}` }
    const j = await r.json()
    return { n: (j.events || []).length }
  } catch (e) { return { n: null, why: e.message } }
}

console.log('\n  date        unscoped   groups=80   delta   what the delta is')
console.log('  ' + '-'.repeat(66))

let anyData = false, anyDelta = false, maxScoped = 0
for (const d of dates) {
  const bare = await count(`${ESPN}?dates=${d}`)
  const fbs = await count(`${ESPN}?dates=${d}&groups=80`)
  if (bare.n !== null && fbs.n !== null) {
    anyData = true
    const delta = bare.n - fbs.n
    if (delta !== 0) anyDelta = true
    maxScoped = Math.max(maxScoped, fbs.n)
    console.log(`  ${d}  ${String(bare.n).padStart(8)}  ${String(fbs.n).padStart(9)}  ${String(delta).padStart(6)}   ${delta === 0 ? 'nothing — the default already scopes' : 'non-FBS events the seed would archive'}`)
  } else {
    console.log(`  ${d}  ${(bare.why || 'ok').padStart(8)}  ${(fbs.why || 'ok').padStart(9)}       ?   not answered`)
  }
}

console.log('')
if (!anyData) {
  console.log('  NOT OBSERVABLE — ESPN answered for no date. Nothing is concluded.')
  process.exit(1)
}
console.log(`  Peak FBS slate measured: ${maxScoped} game(s).`)
console.log(`  The cron fires every 15 min, so a seed row walks that many events`)
console.log(`  ~96 times on such a day, per archive-write site.`)
console.log('')
console.log(anyDelta
  ? '  groups=80 CHANGES THE RESULT. Seeding CFB without appending it would\n' +
    '  archive non-FBS events, and the relay currently appends it nowhere.'
  : '  groups=80 changed nothing on the dates measured. The V2_LEAGUES comment\n' +
    '  holds today. It is still an undocumented default the relay relies on and\n' +
    '  the client does not — jubilant-bassoon appends the param explicitly.')
console.log('')
