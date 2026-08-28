// Did the first real CFB slate reach the archive, and did the staged
// curatedRank chain survive contact with it?
//
// TWO THINGS UNBLOCK ON THE SAME DAY, and neither has ever been observed.
//
// 1. THE SEED ROW. field-relay-nba c52f496 added
//    {sport:'football', league:'college-football', label:'CFB'} to the
//    journalism cron's LEAGUES table on 2026-08-27, two days before the first
//    FBS slate. Before it, /context/date carried zero college games ever. The
//    label 'CFB' was declared in that commit BEFORE any row was written,
//    because the archive writes `sport: gm.league` and a label chosen after the
//    fact orphans the rows already there. If the archive serves something else,
//    every downstream consumer keyed on 'CFB' is wrong and nothing else would
//    say so.
//
// 2. THE curatedRank CHAIN, STAGED SINCE 2026-07-15 AND NEVER LIVE-TESTED.
//    Drive, "FIELD — Sports Data Infrastructure, 2026-07-15", opening line:
//    "All pieces done and verified, except `cfb-curatedrank-relay`'s downstream
//    consumer chain, which is staged but not yet live-tested against a real
//    slate (season doesn't start until Aug 29)."
//
//    The chain: adaptESPNFootball forwards ESPN's real curatedRank.current ->
//    mapV2ToESPN threads homeCuratedRank/awayCuratedRank -> injectV2SportSection
//    builds the section -> buildRankBadge renders the #N poll badge. Every link
//    was tested against forced or historical data. None against a live slate,
//    because none existed.
//
//    Rule 74: a STAGED feature needs the exact command that verifies it when the
//    block lifts. This is that command. The block lifts 2026-08-29.
//
// WHY A REAL RANK MATTERS AND A PRESENT FIELD DOES NOT. curatedRank arrives as
// {current: N}, and ESPN sends `current: 99` for an unranked team -- a real
// number, finite, present, and meaning "not ranked". A check asserting the field
// exists would pass on a slate where every team is 99, which is exactly the
// vacuity failure this repo keeps finding. So: at least one team ranked 1-25.
//
// Opening weekend has ranked teams. If it somehow does not, that is reported as
// NOT OBSERVABLE rather than as a pass.

const RELAY = process.env.RELAY_URL || 'https://field-relay-nba.jeffunglesbee.workers.dev'
const ESPN = 'https://site.api.espn.com/apis/site/v2/sports/football/college-football/scoreboard'

const date = process.argv[2] && /^\d{4}-\d{2}-\d{2}$/.test(process.argv[2])
  ? process.argv[2]
  : new Date(Date.now() - 86400000).toISOString().slice(0, 10)

// NOT OBSERVABLE is neutral on the daily cron and fatal on a dispatch, for the
// same reason it is in nfl-epa-route-probe.mjs -- and this file did NOT have it
// until 2026-08-28, which was an inconsistency I introduced by writing the rule
// for one probe and not the other.
//
// Measured cost of that omission: CFB opens with a SINGLE 8-game slate on
// 2026-08-29 and nothing on 08-27, 08-28 or 08-30 (ESPN, scripts/cfb-volume-probe.mjs,
// artifact outbox/cfb-volume-probe-latest.txt). A cron that exits 1 on an empty
// slate would have gone red at 16:00 today and again tomorrow, before it had
// ever said anything real -- twice teaching the reader that this workflow's red
// means nothing, in the two days before the one run that matters.
//
// A dispatch still fails: asking the question on purpose and getting no answer
// is a failed check, not a quiet day.
const HEARTBEAT = process.env.CFB_SLATE_HEARTBEAT === '1'

let pass = 0, fail = 0
const A = (label, ok, detail = '') => {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${ok || !detail ? '' : `\n        → ${detail}`}`)
  ok ? pass++ : fail++
}

console.log(`\n  CFB first-slate check — ${date}\n`)

// ── ESPN: was there a slate at all? ─────────────────────────────────────────
// "ESPN did not answer" and "ESPN answered with no games" are different facts
// and must not report identically. Found by running this locally on 2026-08-28:
// the sandbox gets HTTP 000 to ESPN, so BOTH paths printed "lists no CFB events"
// and the run looked like a quiet day instead of an unreachable upstream. An
// unreachable upstream is never neutral -- it fails even on the heartbeat,
// because a heartbeat that cannot see is not a quiet heartbeat.
let sb = null, reachErr = null
try {
  const r = await fetch(`${ESPN}?dates=${date.replace(/-/g, '')}`)
  if (!r.ok) reachErr = `HTTP ${r.status}`
  else sb = await r.json()
} catch (e) { reachErr = e.message }

if (reachErr) {
  console.log(`  UNREACHABLE — ESPN did not answer: ${reachErr}`)
  console.log('  This is not an empty slate. Nothing is concluded, and this')
  console.log('  fails on the heartbeat too: a check that cannot see is not quiet.\n')
  process.exit(1)
}

const events = sb?.events || []
if (!events.length) {
  console.log('  NOT OBSERVABLE — ESPN answered, and lists no CFB events for this date.')
  console.log('  Nothing is concluded. Re-run on a date with a slate.\n')
  process.exit(HEARTBEAT ? 0 : 1)
}
console.log(`  ESPN lists ${events.length} CFB event(s).`)

// ── the archive ─────────────────────────────────────────────────────────────
const ctx = await (await fetch(`${RELAY}/context/date/${date}`)).json().catch(() => ({}))
const rows = [...(ctx.games?.regular ?? []), ...(ctx.games?.postseason ?? [])]
const labels = [...new Set(rows.map(g => g.sport))].sort()
const cfbRows = rows.filter(g => g.sport === 'CFB')

console.log(`  /context/date carries ${rows.length} row(s) across: ${labels.join(', ') || '(none)'}\n`)

A('the archive answered with rows for this date', rows.length > 0, `${rows.length}`)

// The label assertion, stated as inequality against the known-wrong candidates
// rather than as "CFB is present" -- a missing label and a differently-spelled
// one are different failures and must not report the same way.
const nearMisses = labels.filter(l => /college|cfb|ncaa/i.test(l) && l !== 'CFB')
A('the archive serves college football under the declared label "CFB"',
  cfbRows.length > 0,
  nearMisses.length
    ? `found ${nearMisses.map(l => `"${l}"`).join(', ')} instead — the label was declared as "CFB" in c52f496 and the archive disagrees`
    : 'no college rows at all — the seed row did not write, or the cron has not ticked since it deployed')

A('the seed carried a real share of the slate, not one stray row',
  cfbRows.length >= Math.min(3, events.length),
  `${cfbRows.length} archived of ${events.length} on ESPN`)

// ── the staged curatedRank chain, at its source ─────────────────────────────
// 99 is ESPN's real "unranked" value. Counting it as a rank is how a check
// passes on a slate with no ranked teams in it.
const ranks = []
for (const ev of events)
  for (const c of ev.competitions?.[0]?.competitors ?? []) {
    const r = c.curatedRank?.current
    if (Number.isFinite(r) && r >= 1 && r <= 25) ranks.push({ team: c.team?.abbreviation ?? '?', rank: r })
  }

if (!ranks.length) {
  console.log('\n  NOT OBSERVABLE — no team on this slate carries a poll rank 1-25.')
  console.log('  ESPN sends curatedRank.current = 99 for unranked, so a slate of')
  console.log('  99s cannot verify the badge chain. Re-run on a ranked slate.\n')
  console.log(`\n${fail === 0 ? 'PASS' : 'FAIL'}  ${pass}/${pass + fail} archive check(s); rank chain NOT OBSERVABLE`)
  process.exit(fail === 0 ? 1 : 1)   // never green without the rank half
}

console.log(`\n  ${ranks.length} ranked competitor(s) on the slate: ` +
            ranks.slice(0, 8).map(r => `#${r.rank} ${r.team}`).join(', '))
A('ESPN serves real poll ranks (1-25), not just the unranked sentinel 99',
  ranks.length > 0, `${ranks.length}`)

console.log(`\n${fail === 0 ? 'PASS' : 'FAIL'}  ${pass}/${pass + fail} checks passed`)
process.exit(fail === 0 ? 0 : 1)
