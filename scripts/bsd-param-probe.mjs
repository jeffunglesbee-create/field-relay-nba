// Does BSD still IGNORE a parameter it does not understand, or reject it now?
//
// WHY THIS EXISTS
//
// Two things collided on 2026-09-06.
//
// FIRST, the repo contradicts itself. src/index.js has a comment, dated and
// confirmed live on 2026-08-01, saying:
//
//   Uses date_from/date_to, not date= -- confirmed live 2026-08-01 that BSD's
//   /api/v2/events/ silently ignores a bare date= param (returns an unfiltered,
//   non-date-ordered page instead), which would have matched teams' games from
//   the wrong date via the team-name-only lookup below.
//
// And roughly 1850 lines earlier, `runBSDEndgameCapture` calls:
//
//   https://sports.bzzoiro.com/api/v2/events/?date=${today}&league_id=27
//
// The same parameter, on the same endpoint, one site avoiding it for a measured
// reason and the other still using it. Both cannot be right. If the comment
// holds, that call has been reading an unfiltered page and only its 80-120
// minute time-window filter has been keeping the result plausible.
//
// SECOND, BSD's August newsletter says the API now "rejects parameters it
// doesn't understand instead of quietly ignoring them". That would turn a wrong
// result into a hard failure — better, but a change either way, and the claim
// the endgame site rests on is five weeks old.
//
// Reading cannot settle it. This is a cross-boundary fact about someone else's
// server, so it gets a command.
//
// CI-only: the sandbox cannot reach sports.bzzoiro.com.
//
// Usage:  BSD_API_TOKEN=... node scripts/bsd-param-probe.mjs [YYYY-MM-DD]

const TOKEN = process.env.BSD_API_TOKEN
if (!TOKEN) { console.error('BSD_API_TOKEN is unset — nothing probed.'); process.exit(1) }

const BASE = 'https://sports.bzzoiro.com/api/v2/events/'
const date = process.argv[2] || new Date().toISOString().slice(0, 10)

const call = async (label, qs) => {
  const url = `${BASE}?${qs}`
  let r
  try {
    r = await fetch(url, {
      headers: { Authorization: `Token ${TOKEN}`, 'User-Agent': 'FIELD/1.0', Accept: 'application/json' },
      signal: AbortSignal.timeout(20_000),
    })
  } catch (e) {
    return { label, qs, error: e.message }
  }
  const rate = ['ratelimit-limit', 'ratelimit-remaining', 'ratelimit-reset', 'x-ratelimit-limit']
    .filter(h => r.headers.get(h) !== null)
  if (!r.ok) return { label, qs, status: r.status, rate, body: (await r.text()).slice(0, 700) }

  const j = await r.json()
  const rows = j?.results ?? j?.data ?? (Array.isArray(j) ? j : [])

  // THE DATE FIELD IS DISCOVERED, NOT GUESSED.
  //
  // The first version of this probe guessed `date | start_time | starts_at |
  // datetime`. None of them exist on a BSD row, so it extracted ZERO dates from
  // a 50-row control page and then reported "0 distinct date(s)" for every call
  // — which its own verdict logic read as "filtered to one date".
  //
  // An extractor that cannot see is indistinguishable from a filter that works,
  // and this probe was written to catch precisely that substitution somewhere
  // else. So the field is found by looking for an ISO date in the row, and the
  // key it was found under is printed, so the next reader sees what was read.
  const dateFieldOf = row => Object.entries(row ?? {})
    .find(([, v]) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v))?.[0] ?? null
  const dateField = dateFieldOf(rows[0])
  const dates = dateField
    ? [...new Set(rows.map(e => String(e[dateField]).slice(0, 10)))].sort()
    : []

  return {
    label, qs, status: r.status, rate, count: rows.length,
    dateField,
    // Named so a reader cannot mistake "none found" for "one date".
    unreadable: rows.length > 0 && dates.length === 0,
    keys: rows.length && !dateField ? Object.keys(rows[0]).slice(0, 14) : null,
    dates: dates.slice(0, 6), distinctDates: dates.length,
  }
}

// THE PROBE PICKS ITS OWN DATE.
//
// The first run asked about today, and league_id=27 is the World Cup, which had
// no fixtures. Both date-filtered calls returned 0 rows, and with nothing to
// filter, filtering and ignoring are the same empty page. The question was
// unanswerable and the probe answered it anyway.
//
// So the unfiltered control runs FIRST, and the date under test is taken from a
// row it actually returned. That needs no knowledge of which league is playing
// when, and it guarantees the date has at least one fixture — which is what
// makes an empty filtered response mean something.
const control = await call('league_id only         (the control: unfiltered by date)', `league_id=27`)
const probeDate = control.dates?.[0] || date
if (control.dates?.length) {
  console.log(`\n  control page carries ${control.distinctDates} date(s) in field `
    + `'${control.dateField}'; probing ${probeDate}`
    + (probeDate === date ? '' : ` instead of ${date}, which has no fixtures`))
}

const results = []
results.push(await call('bare date=            (the endgame call site)', `date=${probeDate}&league_id=27`))
results.push(await call('date_from/date_to      (the WC round/weather site)', `date_from=${probeDate}&date_to=${probeDate}&league_id=27`))
results.push(await call('a parameter that cannot exist', `date_from=${probeDate}&date_to=${probeDate}&league_id=27&field_nonsense_param=1`))
results.push(control)

console.log(`\nBSD /api/v2/events/ parameter behaviour — probed ${new Date().toISOString()} for ${probeDate}\n`)
for (const r of results) {
  if (r.error) { console.log(`  ${r.label}\n      ERROR ${r.error}\n`); continue }
  console.log(`  ${r.label}`)
  console.log(`      HTTP ${r.status}${r.count !== undefined ? `  ${r.count} row(s)` : ''}`
    + (r.count ? `, ${r.distinctDates} distinct date(s) from field '${r.dateField ?? '(none found)'}'` : ''))
  if (r.unreadable) console.log(`      CANNOT READ DATES — ${r.count} row(s) carry no ISO date. keys: ${r.keys?.join(', ')}`)
  if (r.dates?.length) console.log(`      dates: ${r.dates.join(', ')}${r.distinctDates > 6 ? ' …' : ''}`)
  if (r.body) console.log(`      body: ${r.body.replace(/\s+/g, ' ')}`)
  console.log(`      RateLimit headers: ${r.rate.length ? r.rate.join(', ') : 'none'}`)
  console.log('')
}

// --- the verdicts, stated rather than left to the reader ---------------------
const [bare, range, bogus] = results
const say = (q, a) => console.log(`  ${q}\n      ${a}\n`)

console.log('VERDICTS\n')

// TWO WAYS THIS PROBE CANNOT ANSWER, both of which it reported through on its
// first run (2026-09-06, committed as 074c6b8) instead of saying so.
//
//   The extractor could not see a date field, so every call showed "0 distinct
//   dates" and the verdict read that as successful filtering.
//
//   league_id=27 is the World Cup and the probed date had no WC fixtures, so
//   the date-filtered calls returned 0 rows. With nothing to filter, filtering
//   and ignoring look identical.
//
// Neither is a failure of the API. Both are the probe having no evidence, and a
// probe with no evidence must say that rather than pick a verdict.
const blocked =
  results.some(r => r.unreadable) ? 'the date field could not be read from a non-empty page'
  : (bare.count === 0 && range.count === 0 && control.count > 0)
    ? `no fixtures for league_id=27 on ${probeDate}, so a filtered and an ignored page are both empty`
    : null

if (blocked) {
  console.log(`  NOT ANSWERABLE from this run: ${blocked}.`)
  console.log('  The unknown-parameter question below is unaffected — it turns on a status code.\n')
}

if (blocked) say('Is a bare date= rejected now?', `UNKNOWN — ${blocked}.`)
else if (bare.status === undefined) say('Is a bare date= rejected now?', 'UNKNOWN — the call errored.')
else if (bare.status >= 400) {
  say('Is a bare date= rejected now?',
    `YES — HTTP ${bare.status}. src/index.js runBSDEndgameCapture sends exactly this and is BROKEN in production.`)
} else if (bare.distinctDates > 1) {
  say('Is a bare date= rejected now?',
    `NO — HTTP ${bare.status}, and it returned ${bare.distinctDates} distinct dates for a single-date request. `
    + 'The 2026-08-01 finding STILL HOLDS: the parameter is ignored, and runBSDEndgameCapture is reading an '
    + 'unfiltered page. Its 80-120 minute window filter is the only thing making the result look right.')
} else {
  say('Is a bare date= rejected now?',
    `NO — HTTP ${bare.status} and ${bare.distinctDates} distinct date(s). The parameter now appears to FILTER. `
    + 'That contradicts the 2026-08-01 comment, which should be corrected rather than trusted.')
}

if (bogus.status >= 400) {
  say('Does BSD reject an unknown parameter, as the August newsletter says?',
    `YES — HTTP ${bogus.status} for a parameter that cannot exist. Every call site must send only documented params.`)
} else {
  say('Does BSD reject an unknown parameter, as the August newsletter says?',
    `NO — HTTP ${bogus.status}, ${bogus.count} row(s). The newsletter's claim does not hold on this endpoint yet.`)
}

say('Does date_from/date_to still filter?',
  blocked ? `UNKNOWN — ${blocked}.` :
  range.status >= 400 ? `NO — HTTP ${range.status}. This is the site the WC round/weather join depends on.`
    : `${range.distinctDates} distinct date(s) across ${range.count} row(s) — `
      + (range.distinctDates <= 1 ? 'filtering correctly.' : 'NOT filtering; the WC join is reading other dates.'))

say('Control — league_id only, no date filter at all',
  control.status >= 400 ? `HTTP ${control.status}` : `${control.count} row(s), ${control.distinctDates} distinct date(s). `
    + 'A bare date= that matches THIS shape is a parameter being ignored.')

console.log(`  RateLimit headers present: ${results.some(r => r.rate?.length) ? 'yes' : 'no'}\n`)
