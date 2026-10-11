#!/usr/bin/env node
// docs/CC-CMD-2026-10-10-bsd-broadcasts-territory.md — Tasks 3 and 5.
//
// TASK 3 IS THIS DOCUMENT'S GATE AND ITS PREMISE WAS NEVER MEASURED. The
// surface probe recorded `country_code` as a KEY NAME and set
// `territory.scoped: true` from its presence. Presence is not population: the
// same artifact proved, twice, that this vendor serves a field and leaves it
// empty — `attendance` is null on 193 of 193 rows and `round_name` is an empty
// string on 193 of 193. The document's own stop condition turns on the value:
//
//   "If `country_code` is null on most rows, STOP and report before building a
//    filter on it. A territory filter over mostly-unstated territory is a
//    confident wrong answer."
//
// So the rate is measured here, with a denominator, before either route ships.
//
// TASK 5: does the endpoint serve rows for NON-FOOTBALL sports, and does it
// reach the North American leagues where FIELD's holes actually are? BSD's
// basketball list includes the NBA and WNBA; its 13 hockey leagues do not
// include the NHL. The answer may be "soccer only" — worth having, provided
// nobody plans an NBA fix on it.

import { writeFileSync, mkdirSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

export const BASE = 'https://sports.bzzoiro.com'
export const CALL_BUDGET = 30
export const TV_CHANNEL_ID = 583   // the channel the surface probe sampled

// Four states, not two. Absent / null / empty-string / populated.
export const fieldState = (v) => {
  if (v === undefined) return 'absent'
  if (v === null) return 'null'
  if (typeof v === 'string' && v.trim() === '') return 'empty-string'
  return 'populated'
}

// The rate Task 3 asks for, with its denominator, and each absence kept apart.
export const territoryRate = (rows) => {
  const counts = { absent: 0, null: 0, 'empty-string': 0, populated: 0 }
  const values = {}
  for (const r of rows) {
    const st = fieldState(r?.country_code)
    counts[st] += 1
    if (st === 'populated') values[r.country_code] = (values[r.country_code] || 0) + 1
  }
  const total = rows.length
  const stated = counts.populated
  return {
    rows_total: total,
    counts,
    country_code_populated: stated,
    non_null_rate: total ? +(stated / total).toFixed(4) : null,
    rate_denominator: total,
    distinct_values: Object.keys(values).sort(),
    value_counts: values,
    // The document's stop condition, evaluated here rather than by a reader.
    stop_condition_fires: total === 0 ? null : stated / total <= 0.5,
    verdict: total === 0
      ? 'UNMEASURED — no broadcast rows were returned at all, so the rate is not zero, it is unknown'
      : (stated / total <= 0.5
          ? `STOP — country_code is stated on only ${stated} of ${total} rows. A territory filter over mostly-unstated territory is a confident wrong answer.`
          : `country_code is stated on ${stated} of ${total} rows. The territory field is real.`),
  }
}

const get = async (path, token, calls) => {
  calls.n += 1
  try {
    const r = await fetch(`${BASE}${path}`, {
      headers: { 'Authorization': `Token ${token}`, 'Accept': 'application/json' },
      signal: AbortSignal.timeout(25000),
    })
    const text = await r.text()
    let body = null
    try { body = JSON.parse(text) } catch (_) {}
    return { ok: r.ok, status: r.status, body }
  } catch (e) { return { ok: false, status: 0, error: String(e && e.message || e), body: null } }
}

const rowsOf = (body) => {
  if (!body) return []
  if (Array.isArray(body)) return body
  for (const k of ['results', 'data', 'broadcasts', 'rows']) if (Array.isArray(body?.[k])) return body[k]
  return []
}

const main = async () => {
  const token = process.env.BSD_API_TOKEN
  if (!token) { console.error('FAIL: BSD_API_TOKEN absent — every answer would be UNKNOWN, not empty.'); process.exit(1) }
  const started = new Date().toISOString()
  const calls = { n: 0 }
  const day = (process.argv.find(a => a.startsWith('--date=')) || `--date=${started.slice(0, 10)}`).slice(7)

  // ── football events for the day ──────────────────────────────────────────
  const list = await get(`/api/v2/events/?date_from=${day}&date_to=${day}&limit=100`, token, calls)
  const evRows = rowsOf(list.body)
  const sample = evRows.slice(0, 12).map(r => r.id ?? r.event_id).filter(Boolean)

  const perEvent = []
  let allRows = []
  for (const id of sample) {
    if (calls.n >= CALL_BUDGET - 6) break
    const r = await get(`/api/v2/events/${id}/broadcasts/`, token, calls)
    const rows = rowsOf(r.body)
    allRows = allRows.concat(rows)
    perEvent.push({
      eventId: id, status: r.status, rowCount: rows.length,
      rowKeysVerbatim: rows[0] ? Object.keys(rows[0]).sort() : [],
      countryCodes: [...new Set(rows.map(x => x?.country_code ?? null))],
    })
  }

  // ── the tv-channels endpoint the surface probe sampled ───────────────────
  const chan = await get(`/api/v2/tv-channels/${TV_CHANNEL_ID}/broadcasts/`, token, calls)
  const chanRows = rowsOf(chan.body)

  // ── Task 5: non-football sports, one call each ───────────────────────────
  const task5 = {}
  for (const sport of ['basketball', 'hockey']) {
    if (calls.n >= CALL_BUDGET) break
    const l = await get(`/${sport}/api/v2/events/?date_from=${day}&date_to=${day}&limit=20`, token, calls)
    const rs = rowsOf(l.body)
    const first = rs[0]?.id ?? rs[0]?.event_id ?? null
    let b = { status: null, rowCount: 0 }
    if (first && calls.n < CALL_BUDGET) {
      const br = await get(`/${sport}/api/v2/events/${first}/broadcasts/`, token, calls)
      b = { status: br.status, rowCount: rowsOf(br.body).length,
            rowKeysVerbatim: rowsOf(br.body)[0] ? Object.keys(rowsOf(br.body)[0]).sort() : [] }
    }
    task5[sport] = {
      eventsListStatus: l.status, eventsSeen: rs.length, sampledEventId: first,
      broadcastsStatus: b.status, broadcastRowCount: b.rowCount,
      rowKeysVerbatim: b.rowKeysVerbatim ?? [],
      verdict: first === null ? 'no events returned for this date — UNMEASURED, not unsupported'
        : b.status === 200 && b.rowCount > 0 ? 'serves broadcast rows'
        : b.status === 200 ? 'answered 200 with ZERO rows — served and empty, not unsupported'
        : `did not serve: HTTP ${b.status}`,
    }
  }

  const out = {
    cc_cmd: 'docs/CC-CMD-2026-10-10-bsd-broadcasts-territory.md',
    tasks: 'Task 3 (the gate) and Task 5 (coverage)',
    started_at: started, date_probed: day,
    callBudget: CALL_BUDGET, callsMade: calls.n,
    football: {
      eventsSeen: evRows.length, eventsSampled: perEvent.length,
      perEvent,
      task3_eventBroadcasts: territoryRate(allRows),
    },
    tvChannel: {
      channelId: TV_CHANNEL_ID, status: chan.status, rowCount: chanRows.length,
      rowKeysVerbatim: chanRows[0] ? Object.keys(chanRows[0]).sort() : [],
      task3_channelBroadcasts: territoryRate(chanRows),
    },
    task5_nonFootball: task5,
    coverage: `${perEvent.length} football events on ${day}, plus tv-channel ${TV_CHANNEL_ID}, plus one sampled event `
            + `each for basketball and hockey. Not a survey of the vendor's policy.`,
  }

  mkdirSync('outbox', { recursive: true })
  const ts = started.replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z')
  writeFileSync(`outbox/bsd-broadcasts-probe-${ts}.json`, JSON.stringify(out, null, 2))
  writeFileSync('outbox/bsd-broadcasts-probe-latest.json', JSON.stringify(out, null, 2))
  console.log(`wrote outbox/bsd-broadcasts-probe-${ts}.json`)
  console.log(`callsMade ${calls.n} of ${CALL_BUDGET}`)
  console.log(`event broadcasts : ${out.football.task3_eventBroadcasts.verdict}`)
  console.log(`channel broadcasts: ${out.tvChannel.task3_channelBroadcasts.verdict}`)
  for (const [s, v] of Object.entries(task5)) console.log(`task5 ${s}: ${v.verdict}`)
  console.log(out.coverage)
}

const _entryHref = process.argv[1] ? pathToFileURL(process.argv[1]).href : null
const _isEntry = _entryHref !== null && import.meta.url === _entryHref

const selfTest = () => {
  let pass = 0, fail = 0
  const t = (n, c) => { if (c) { pass++; console.log(`PASS  ${n}`) } else { fail++; console.log(`FAIL  ${n}`) } }

  t('absent, null and empty-string are three different states, none of them populated',
    fieldState(undefined) === 'absent' && fieldState(null) === 'null'
    && fieldState('') === 'empty-string' && fieldState('  ') === 'empty-string'
    && fieldState('US') === 'populated')

  t('the rate carries its denominator',
    (() => {
      const r = territoryRate([{ country_code: 'US' }, { country_code: null }, { country_code: 'GB' }, { country_code: '' }])
      return r.rate_denominator === 4 && r.country_code_populated === 2 && r.non_null_rate === 0.5
    })())
  t('NO ROWS AT ALL IS UNMEASURED, never a rate of zero',
    (() => {
      const r = territoryRate([])
      return r.non_null_rate === null && r.stop_condition_fires === null && /not zero, it is unknown/.test(r.verdict)
    })())
  t("THE DOCUMENT'S STOP CONDITION FIRES when country_code is stated on half or fewer",
    territoryRate([{ country_code: 'US' }, { country_code: null }]).stop_condition_fires === true)
  t('...and its verdict says STOP in those words',
    /^STOP —/.test(territoryRate([{ country_code: null }, { country_code: null }]).verdict))
  t('a well-populated field does NOT fire the stop condition',
    (() => {
      const r = territoryRate([{ country_code: 'US' }, { country_code: 'US' }, { country_code: 'GB' }, { country_code: null }])
      return r.stop_condition_fires === false && r.non_null_rate === 0.75
    })())
  t('the distinct territories are reported, not just the count',
    (() => {
      const r = territoryRate([{ country_code: 'US' }, { country_code: 'GB' }, { country_code: 'US' }])
      return r.distinct_values.join(',') === 'GB,US' && r.value_counts.US === 2
    })())
  t('an empty string is NOT counted as a stated territory',
    territoryRate([{ country_code: '' }]).country_code_populated === 0)
  t('a row missing the key entirely is counted absent, not null',
    territoryRate([{}]).counts.absent === 1 && territoryRate([{}]).counts.null === 0)

  console.log(`\n${pass}/${pass + fail} checks passed`)
  if (fail) process.exit(1)
}

if (_isEntry) {
  if (process.argv.includes('--self-test')) selfTest()
  else main().catch(e => { console.error(String(e && e.stack || e)); process.exit(1) })
}
