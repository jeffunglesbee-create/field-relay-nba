// The offline check for the BSD game join (docs/CC-CMD-2026-10-27-bsd-event-id-on-game-rows.md, Task 2), over the
// captured fixture AND a synthetic corpus. The fixture has no ambiguous pair, no reversed pair and no doubleheader,
// so a mutation deleting either guard would survive the fixture alone: the synthetic corpus is what makes each guard
// failable. scripts/mutate-bsd-game-join.mjs proves that, mutation by mutation.
//
// Every predicate is pure over what it is handed, and the module under test is chosen by `--module` so the mutation
// harness can aim this check at a broken copy.
//
// COVERAGE IS PRINTED WITH THE VERDICT (Rule 91): rows, events and the denominator of every ratio.
//
// Usage:  node scripts/check-bsd-game-join.mjs --offline [--module <path>]

import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { resolve } from 'node:path'

const FIXTURE = 'outbox/fixture-bsd-game-join-2026-08-29-09-05.json'
const FLOOR = 0.90
const arg = n => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : null }
const modPath = resolve(arg('--module') || 'src/bsd-game-join.js')
const J = await import(pathToFileURL(modPath).href)
const { joinGameToBsd, joinBatch, eventDaysFor, BSD_KICKOFF_REFUSE_MINUTES } = J

import { ORACLE } from './lib/bsd-game-join-oracle.mjs'

const fold = s => String(s ?? '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '')
const nm = t => (t && typeof t === 'object' ? t.name : t)

const results = []
const check = (name, pass, detail = '') => { results.push({ name, pass, detail }); console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${pass ? '' : '\n      -> ' + detail}`) }

// ---- the fixture -------------------------------------------------------------------------------------------------
const fx = JSON.parse(readFileSync(FIXTURE, 'utf8'))
let totalRows = 0, totalEvents = 0
const byId = new Map()
for (const d of fx.dates) {
  const events = eventDaysFor(d.date).flatMap(day => d.events[day] || [])
  totalRows += d.rows.length; totalEvents += events.length
  const { results: rs, counts } = joinBatch(d.rows, events)
  d.rs = rs; d.counts = counts; d.eventsUsed = events
  rs.forEach((r, i) => byId.set(d.rows[i].id, { row: d.rows[i], r, events }))
  const ratio = counts.joined / counts.rows
  const unmatched = rs.map((r, i) => ({ r, row: d.rows[i] })).filter(x => x.r.how !== 'joined')
  check(`${d.date}: joined ${counts.joined} of ${counts.rows} soccer rows is at least ${FLOOR * 100}%`, ratio >= FLOOR,
    `${(ratio * 100).toFixed(1)}%; not joined: ${unmatched.slice(0, 8).map(x => `${x.row.home} v ${x.row.away} [${x.r.how}]`).join('; ')}`)
  check(`${d.date}: no row is ambiguous, refused on kickoff or left to the sport guard`, counts.ambiguous === 0 && counts.refusedKickoff === 0 && counts.notSoccer === 0, JSON.stringify(counts))
}
console.log(`      coverage: ${fx.dates.length} dates, ${totalRows} soccer rows, ${totalEvents} BSD events (both UTC days)`)

// An independent oracle: rows whose names equal an event's names by plain string equality, with no resolver, must
// resolve to that very event.
const strictPairs = []
for (const d of fx.dates) for (let i = 0; i < d.rows.length; i++) {
  const row = d.rows[i]
  const hits = d.eventsUsed.filter(e => fold(nm(e.home_team)) === fold(row.home) && fold(nm(e.away_team)) === fold(row.away))
  if (hits.length === 1) strictPairs.push({ row, id: String(hits[0].id) })
}
const strictBad = strictPairs.filter(p => byId.get(p.row.id).r.bsd_event_id !== p.id)
check(`every row whose names equal an event's names by plain string equality joins that event (${strictPairs.length} such rows)`, strictPairs.length >= 12 && strictBad.length === 0,
  `${strictPairs.length} pairs, ${strictBad.length} wrong: ${strictBad.slice(0, 3).map(p => p.row.id).join(', ')}`)

const present = ORACLE.filter(([id]) => byId.has(id)), absent = ORACLE.filter(([id]) => !byId.has(id))
const oracleBad = present.filter(([id, ev]) => byId.get(id).r.bsd_event_id !== String(ev))
check(`the oracle pairs present in the live archive join their fixed event (${present.length} of ${ORACLE.length} present)`, present.length >= 9 && oracleBad.length === 0,
  `wrong: ${oracleBad.map(([id, ev]) => `${id} wants ${ev} got ${byId.get(id).r.bsd_event_id}`).join('; ')}`)
if (absent.length) console.log(`      oracle rows absent from the live archive, named: ${absent.map(a => a[0]).join(', ')}`)

// Two rows may share an event only when they are the SAME fixture written twice (the archive holds such pairs under
// two id schemes). Two different fixtures on one event is a wrong join.
{
  const groups = new Map()
  for (const d of fx.dates) d.rows.forEach((row, i) => { const e = d.rs[i].bsd_event_id; if (e) (groups.get(e) || groups.set(e, []).get(e)).push({ row, d }) })
  const shared = [...groups].filter(([, v]) => v.length > 1)
  // Same fixture == the two rows' kickoff-free pair resolves to the same event with BOTH sides naming the event's teams
  // in the same orientation; a wrong share would put a row on an event whose teams it does not name. So check each row
  // individually against its event through the resolver the join used.
  const wrong = []
  for (const [, v] of shared) for (const x of v) {
    const ev = x.d.eventsUsed.find(e => String(e.id) === String(x.d.rs[x.d.rows.indexOf(x.row)].bsd_event_id))
    const again = joinGameToBsd(x.row, [ev])
    if (again.how !== 'joined') wrong.push(x.row.id)
  }
  console.log(`      events shared by two rows (the same fixture twice in the archive): ${shared.length}`)
  check('a row sharing an event with another row still names that event\'s teams, in order', wrong.length === 0, wrong.join(', '))
}

// ---- the synthetic corpus ---------------------------------------------------------------------------------------
const row = (home, away, start_time = '2026-09-05T14:00Z', sport = 'EPL') => ({ id: `${home}-${away}`, sport, home, away, start_time })
const ev = (id, home, away, event_date = '2026-09-05T14:00:00+00:00') => ({ id, home_team: home, away_team: away, event_date })
const t = (name, got, want) => check(name, got === want, `got ${JSON.stringify(got)}, wanted ${JSON.stringify(want)}`)

t('S1 a reversed pair does not join', joinGameToBsd(row('Everton', 'Fulham'), [ev(1, 'Fulham', 'Everton')]).how, 'unmatched')
t('S1 the same pair in order joins', joinGameToBsd(row('Everton', 'Fulham'), [ev(1, 'Everton', 'Fulham')]).bsd_event_id, '1')
t('S2 two events for one name pair are ambiguous, not the first', joinGameToBsd(row('Everton', 'Fulham'), [ev(1, 'Everton', 'Fulham'), ev(2, 'Everton', 'Fulham')]).how, 'ambiguous')
t('S3 the same two teams twice in the window are ambiguous: the kickoff does not choose', joinGameToBsd(row('Everton', 'Fulham'), [ev(1, 'Everton', 'Fulham'), ev(2, 'Everton', 'Fulham', '2026-09-06T14:00:00+00:00')]).how, 'ambiguous')
t('S3 one event on the right names but a day later is refused, not joined', joinGameToBsd(row('Everton', 'Fulham'), [ev(2, 'Everton', 'Fulham', '2026-09-06T14:00:00+00:00')]).how, 'refused-kickoff')
t('S4 an event on the next UTC day joins when that day is supplied', joinGameToBsd(row('Seattle', 'Chicago', '2026-09-06T00:30Z', 'MLS'), [ev(7, 'Seattle Sounders FC', 'Chicago Fire', '2026-09-06T00:30:00+00:00')]).bsd_event_id, '7')
t('S4 eventDaysFor names the day and the next, across a month end', JSON.stringify(eventDaysFor('2026-08-31')), JSON.stringify(['2026-08-31', '2026-09-01']))
t('S5 a baseball row named Tigers never reaches a football club', joinGameToBsd(row('Detroit Tigers', 'Boston Red Sox', '2026-09-05T14:00Z', 'MLB'), [ev(9, 'Hull City', 'Boston Red Sox')]).how, 'not-soccer')
{
  const r = joinGameToBsd(row('Everton', 'Fulham', null), [ev(1, 'Everton', 'Fulham')])
  t('S6 a row with no start_time joins and says its kickoff was not judged', `${r.how}/${r.kickoff}`, 'joined/unjudged')
}
t(`S7 a gap of exactly the refusal (${BSD_KICKOFF_REFUSE_MINUTES} min) still joins`, joinGameToBsd(row('Everton', 'Fulham', '2026-09-05T14:00Z'), [ev(1, 'Everton', 'Fulham', `2026-09-05T${String(14 + BSD_KICKOFF_REFUSE_MINUTES / 60).padStart(2, '0')}:00:00+00:00`)]).how, 'joined')
t(`S7 a gap one minute past it is refused`, joinGameToBsd(row('Everton', 'Fulham', '2026-09-05T14:00Z'), [ev(1, 'Everton', 'Fulham', `2026-09-05T${String(14 + BSD_KICKOFF_REFUSE_MINUTES / 60).padStart(2, '0')}:01:00+00:00`)]).how, 'refused-kickoff')
t('S8 a missing instant refuses nothing', joinGameToBsd(row('Everton', 'Fulham', undefined), [ev(1, 'Everton', 'Fulham', undefined)]).how, 'joined')
t('S9 names that do not resolve are unmatched even when exactly one event kicks off at that instant', joinGameToBsd(row('Zzz United', 'Qqq City'), [ev(5, 'Aaa Rovers', 'Bbb Town')]).how, 'unmatched')

const failed = results.filter(r => !r.pass)
console.log(`\n${results.length - failed.length}/${results.length} checks passed`)
process.exit(failed.length ? 1 : 0)
