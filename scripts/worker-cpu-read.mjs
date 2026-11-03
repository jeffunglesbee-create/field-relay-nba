#!/usr/bin/env node
// How much CPU do this account's Workers and Durable Objects actually use, and
// has any invocation hit a runtime limit? Read-only: the Cloudflare GraphQL
// Analytics API, never a Worker route.
//
// WHY THIS EXISTS (2026-11-03). The owner asked whether MoonBit or Zig had a
// case in FIELD. The only case either could make is CPU, and no document in
// the four repos records a CPU measurement or a 1102. A rewrite argued from an
// unmeasured cost is the assumption this repo's rules exist to stop, so this
// measures first.
//
// WHAT IT READS
//   workersInvocationsAdaptive   per Worker per UTC day: requests by invocation
//                                status, and every cpuTime*/wallTime* quantile
//                                the schema offers
//   durableObjectsPeriodicGroups per DO namespace per day: summed cpuTime
// The field lists are taken from the schema by introspection, not written from
// memory, and each quantile's own schema description is printed so the unit is
// the API's word rather than this file's.
//
// THE ANSWER THAT MATTERS is the count of `exceeded*` statuses: exceededResources
// (1102/1027, "most commonly excessive CPU time") and exceededMemory (the 128 MB
// limit). Zero means no invocation in the window hit a limit, whatever the
// percentiles say. The first run counted exceededResources alone and called the
// relay clean while it carried 45 exceededMemory invocations; the prefix match is
// why a third limit status would not be missed the same way.
//
// PERCENTILES ARE KEPT PER STATUS. A Worker's worst daily p99 across all statuses
// is usually its failures' p99: the first run reported the relay at 5.4 s CPU,
// which was the p99 of 45 out-of-memory invocations, not of its 2.9 million
// successful ones. Success is reported on its own line, failures on theirs.
//
// WHAT IT DOES NOT MEASURE, printed with every result (Rule 91): CPU per ROUTE
// or per cron handler. The dataset is per Worker. A heavy route is visible only
// as that Worker's tail. Adaptive datasets are sampled; the counts are
// Cloudflare's estimates.
//
// Exit: 0 measured, 1 query or auth failure (body printed), 2 nothing to read.
//   node scripts/worker-cpu-read.mjs              (CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID, DAYS)
//   node scripts/worker-cpu-read.mjs --self-test

import { readFileSync } from 'node:fs'

const GQL = 'https://api.cloudflare.com/client/v4/graphql'
const DAY_MS = 86400000

/** Unwrap NON_NULL/LIST wrappers to the named type. */
export function named (t) {
  let x = t
  while (x && !x.name && x.ofType) x = x.ofType
  return x ? x.name : null
}

/** Quantile fields worth asking for, ordered by metric then percentile. */
export function pickQuantiles (names) {
  const pct = n => Number(n.replace(/^.*P/, '').padEnd(3, '0'))
  return names
    .filter(n => /^(cpuTime|wallTime)P\d+$/.test(n))
    .sort((a, b) => a.replace(/P\d+$/, '').localeCompare(b.replace(/P\d+$/, '')) || pct(a) - pct(b))
}

/**
 * rows: [{ day, scriptName, status, requests, errors, quantiles: {field: n} }]
 * -> per Worker: totals, requests by status, and per status per quantile the
 *    worst day.
 * Quantiles from different days are never averaged: a day's p99 is only that
 * day's, so the honest summary is the largest one and the day it came from.
 */
export function summarise (rows, qFields) {
  const by = {}
  for (const r of rows) {
    const w = by[r.scriptName] ||= { requests: 0, errors: 0, status: {}, worst: {}, days: new Set() }
    const ws = w.worst[r.status] ||= {}
    w.requests += r.requests
    w.errors += r.errors
    w.status[r.status] = (w.status[r.status] || 0) + r.requests
    w.days.add(r.day)
    for (const f of qFields) {
      const v = r.quantiles?.[f]
      if (typeof v !== 'number') continue
      if (!ws[f] || v > ws[f].value) ws[f] = { value: v, day: r.day }
    }
  }
  return by
}

/** Every runtime-limit status, by prefix: { exceededResources: n, exceededMemory: n, ... } */
export function limitHits (w) {
  return Object.fromEntries(Object.entries(w.status).filter(([k]) => k.startsWith('exceeded')))
}
export function exceeded (w) { return Object.values(limitHits(w)).reduce((a, b) => a + b, 0) }
const hitText = w => Object.entries(limitHits(w)).map(([k, v]) => `${k} ${v}`).join(', ')

export function render ({ summary, qFields, qDesc, doRows, days, limits }) {
  const out = []
  const names = Object.keys(summary).sort((a, b) => summary[b].requests - summary[a].requests)
  out.push(`COVERAGE: ${names.length} Worker(s), ${days} UTC day(s), per Worker and per DO namespace. CPU per route or per cron handler is NOT measured (the dataset is per Worker). Counts are Cloudflare's sampled estimates.`)
  out.push('')
  out.push('Units, from the schema\'s own descriptions:')
  for (const f of qFields) out.push(`  ${f}: ${qDesc[f] || '(no description in schema)'}`)
  out.push('')
  for (const n of names) {
    const w = summary[n]
    const lim = limits[n] ? `cpu_ms limit ${limits[n]} (wrangler.toml)` : 'limit not read'
    out.push(`== ${n}  requests ${w.requests}  errors ${w.errors}  limit hits ${exceeded(w)}${exceeded(w) ? ` (${hitText(w)})` : ''}  days with traffic ${w.days.size}  [${lim}]`)
    const st = Object.entries(w.status).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(', ')
    out.push(`   by status: ${st}`)
    const ok = w.worst.success || {}
    for (const f of qFields) {
      if (ok[f]) out.push(`   success, worst daily ${f}: ${ok[f].value} on ${ok[f].day}`)
    }
    for (const st of Object.keys(w.worst).filter(k => k !== 'success').sort()) {
      const parts = qFields.filter(f => /^cpuTimeP(50|99)$/.test(f) && w.worst[st][f]).map(f => `${f} ${w.worst[st][f].value} on ${w.worst[st][f].day}`)
      out.push(`   ${st} (${w.status[st]}): worst daily ${parts.join(', ') || 'no cpu quantile'}`)
    }
  }
  out.push('')
  if (doRows === null) out.push('Durable Objects: NOT MEASURED (durableObjectsPeriodicGroups.sum.cpuTime is not in the schema)')
  else {
    const ns = {}
    for (const r of doRows) {
      const k = r.namespace
      const e = ns[k] ||= { total: 0, worstDay: null, worst: -1 }
      e.total += r.cpuTime
      if (r.cpuTime > e.worst) { e.worst = r.cpuTime; e.worstDay = r.day }
    }
    out.push(`Durable Objects, summed cpuTime per namespace (${Object.keys(ns).length} namespace(s); unit: ${qDesc.__doCpu || 'no description in schema'}):`)
    for (const [k, e] of Object.entries(ns).sort((a, b) => b[1].total - a[1].total)) {
      out.push(`  ${k}: total ${e.total}, worst day ${e.worstDay} at ${e.worst}`)
    }
  }
  out.push('')
  const hit = names.filter(n => exceeded(summary[n]) > 0)
  out.push(hit.length
    ? `VERDICT: ${hit.length} of ${names.length} Worker(s) hit a runtime limit in ${days} day(s): ${hit.map(n => `${n} (${hitText(summary[n])})`).join('; ')}`
    : `VERDICT: no runtime-limit invocation on any of ${names.length} Worker(s) in ${days} day(s)`)
  return out.join('\n')
}

/** The relay's own cpu_ms from wrangler.toml; the only limit this repo can read. */
export function relayLimit (toml) {
  const name = toml.match(/^name\s*=\s*"([^"]+)"/m)?.[1]
  const cpu = toml.match(/^\s*cpu_ms\s*=\s*(\d+)/m)?.[1]
  return name && cpu ? { [name]: Number(cpu) } : {}
}

// ── live ────────────────────────────────────────────────────────────────────

async function gql (query, variables) {
  const r = await fetch(GQL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.CLOUDFLARE_API_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables })
  })
  const text = await r.text()
  let body
  try { body = JSON.parse(text) } catch (e) { throw new Error(`HTTP ${r.status}, not JSON: ${text.slice(0, 400)}`) }
  if (!r.ok || body.errors?.length) throw new Error(`HTTP ${r.status}: ${JSON.stringify(body.errors || body).slice(0, 800)}`)
  return body.data
}

const TYPE_Q = `query($n:String!){ __type(name:$n){ fields { name description type { kind name ofType { kind name ofType { kind name ofType { kind name } } } } } } }`

async function fieldsOf (typeName) {
  const d = await gql(TYPE_Q, { n: typeName })
  if (!d.__type) throw new Error(`schema has no type ${typeName}`)
  return d.__type.fields
}

async function childType (typeName, field) {
  const f = (await fieldsOf(typeName)).find(x => x.name === field)
  return f ? named(f.type) : null
}

async function live () {
  for (const k of ['CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_ACCOUNT_ID']) {
    if (!process.env[k]) { console.log(`FAIL: ${k} is not set`); process.exit(1) }
  }
  const days = Math.min(Math.max(Number(process.env.DAYS || 7), 1), 30)
  const account = process.env.CLOUDFLARE_ACCOUNT_ID

  const root = (await gql('{ __schema { queryType { name } } }')).__schema.queryType.name
  const viewer = await childType(root, 'viewer')
  const acct = await childType(viewer, 'accounts')

  const wia = await childType(acct, 'workersInvocationsAdaptive')
  if (!wia) { console.log('FAIL: workersInvocationsAdaptive is not in the schema'); process.exit(1) }
  const wiaFields = await fieldsOf(wia)
  const sub = name => named(wiaFields.find(x => x.name === name)?.type)
  const qType = sub('quantiles')
  const qAll = await fieldsOf(qType)
  const qFields = pickQuantiles(qAll.map(f => f.name))
  const qDesc = Object.fromEntries(qAll.filter(f => qFields.includes(f.name)).map(f => [f.name, f.description]))
  const sumNames = (await fieldsOf(sub('sum'))).map(f => f.name)
  const dimNames = (await fieldsOf(sub('dimensions'))).map(f => f.name)
  for (const need of ['scriptName', 'status']) {
    if (!dimNames.includes(need)) { console.log(`FAIL: dimension ${need} is not in the schema`); process.exit(1) }
  }
  const sums = ['requests', 'errors'].filter(n => sumNames.includes(n))
  if (!qFields.length) { console.log('FAIL: no cpuTime/wallTime quantile in the schema'); process.exit(1) }

  const now = Date.now()
  const end0 = Math.floor(now / DAY_MS) * DAY_MS   // today's UTC midnight
  const rows = []
  for (let i = days; i >= 1; i--) {
    const s = new Date(end0 - i * DAY_MS)
    const e = new Date(end0 - (i - 1) * DAY_MS - 1000)
    const day = s.toISOString().slice(0, 10)
    const d = await gql(`query($a:String!,$s:Time!,$e:Time!){ viewer { accounts(filter:{accountTag:$a}) {
      workersInvocationsAdaptive(limit:10000, filter:{datetime_geq:$s, datetime_leq:$e}) {
        dimensions { scriptName status } sum { ${sums.join(' ')} } quantiles { ${qFields.join(' ')} } } } } }`,
    { a: account, s: s.toISOString(), e: e.toISOString() })
    for (const r of d.viewer.accounts[0]?.workersInvocationsAdaptive || []) {
      rows.push({ day, scriptName: r.dimensions.scriptName, status: r.dimensions.status, requests: r.sum.requests || 0, errors: r.sum.errors || 0, quantiles: r.quantiles })
    }
  }
  if (!rows.length) { console.log(`NOTHING MEASURED: 0 rows in ${days} day(s). Not a pass.`); process.exit(2) }

  // Durable Objects: summed cpuTime per namespace per day, if the schema has it.
  let doRows = null
  const dpg = await childType(acct, 'durableObjectsPeriodicGroups')
  if (dpg) {
    const dpgFields = await fieldsOf(dpg)
    const dsub = name => named(dpgFields.find(x => x.name === name)?.type)
    const dSum = await fieldsOf(dsub('sum'))
    const dDims = (await fieldsOf(dsub('dimensions'))).map(f => f.name)
    const cpu = dSum.find(f => f.name === 'cpuTime')
    if (cpu && dDims.includes('date')) {
      qDesc.__doCpu = cpu.description
      const nsDim = dDims.includes('namespaceId') ? 'namespaceId' : null
      const d = await gql(`query($a:String!,$s:Date!,$e:Date!){ viewer { accounts(filter:{accountTag:$a}) {
        durableObjectsPeriodicGroups(limit:10000, filter:{date_geq:$s, date_leq:$e}) {
          dimensions { date ${nsDim || ''} } sum { cpuTime } } } } }`,
      { a: account, s: new Date(end0 - days * DAY_MS).toISOString().slice(0, 10), e: new Date(end0 - DAY_MS).toISOString().slice(0, 10) })
      let names = {}
      if (nsDim) names = await namespaceNames(account)
      doRows = (d.viewer.accounts[0]?.durableObjectsPeriodicGroups || []).map(r => ({
        day: r.dimensions.date,
        namespace: nsDim ? (names[r.dimensions[nsDim]] || r.dimensions[nsDim]) : '(all namespaces)',
        cpuTime: r.sum.cpuTime || 0
      }))
    }
  }

  let limits = {}
  try { limits = relayLimit(readFileSync('wrangler.toml', 'utf8')) } catch (e) { console.log(`wrangler.toml not read: ${e.message}`) }
  console.log(render({ summary: summarise(rows, qFields), qFields, qDesc, doRows, days, limits }))
}

/** DO namespace id -> "Class (script)". A failure is printed, and ids stand in. */
async function namespaceNames (account) {
  const r = await fetch(`https://api.cloudflare.com/client/v4/accounts/${account}/workers/durable_objects/namespaces?per_page=100`, {
    headers: { Authorization: `Bearer ${process.env.CLOUDFLARE_API_TOKEN}` }
  })
  const body = await r.json().catch(e => ({ parseError: e.message }))
  if (!r.ok || !body.success) { console.log(`DO namespace names not read: HTTP ${r.status}; ids shown instead`); return {} }
  return Object.fromEntries(body.result.map(n => [n.id, `${n.class || n.name} (${n.script || '?'})`]))
}

// ── self-test ───────────────────────────────────────────────────────────────

function selfTest () {
  let n = 0; let failed = 0
  const t = (name, ok) => { n++; if (!ok) failed++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`) }

  t('named() unwraps NON_NULL(LIST(NON_NULL(X)))', named({ kind: 'NON_NULL', name: null, ofType: { kind: 'LIST', name: null, ofType: { kind: 'NON_NULL', name: null, ofType: { kind: 'OBJECT', name: 'X' } } } }) === 'X')
  t('pickQuantiles keeps only cpuTime/wallTime, ordered by percentile', JSON.stringify(pickQuantiles(['wallTimeP99', 'cpuTimeP999', 'cpuTimeP50', 'memoryUsageBytesP99', 'cpuTimeP99', 'cpuTime', 'requestDurationP50'])) === JSON.stringify(['cpuTimeP50', 'cpuTimeP99', 'cpuTimeP999', 'wallTimeP99']))

  const q = ['cpuTimeP50', 'cpuTimeP99']
  const rows = [
    { day: '2026-11-01', scriptName: 'a', status: 'success', requests: 100, errors: 0, quantiles: { cpuTimeP50: 3, cpuTimeP99: 40 } },
    { day: '2026-11-02', scriptName: 'a', status: 'success', requests: 50, errors: 0, quantiles: { cpuTimeP50: 5, cpuTimeP99: 90 } },
    { day: '2026-11-02', scriptName: 'a', status: 'exceededResources', requests: 2, errors: 2, quantiles: { cpuTimeP50: 300, cpuTimeP99: 310 } },
    { day: '2026-11-02', scriptName: 'b', status: 'success', requests: 7, errors: 0, quantiles: { cpuTimeP50: 1, cpuTimeP99: 2 } }
  ]
  const s = summarise(rows, q)
  t('requests sum across days and statuses', s.a.requests === 152 && s.b.requests === 7)
  t('exceededResources is counted from the status dimension', exceeded(s.a) === 2 && exceeded(s.b) === 0)
  t('the success worst daily p99 is the largest success day, failures excluded', s.a.worst.success.cpuTimeP99.value === 90 && s.a.worst.success.cpuTimeP99.day === '2026-11-02')
  t('a failure status keeps its own worst', s.a.worst.exceededResources.cpuTimeP99.value === 310)
  t('quantiles from different days are not averaged', s.a.worst.success.cpuTimeP50.value === 5)
  const mem = summarise([...rows, { day: '2026-11-02', scriptName: 'b', status: 'exceededMemory', requests: 3, errors: 3, quantiles: { cpuTimeP50: 9, cpuTimeP99: 9 } }], q)
  t('exceededMemory is a limit hit too', exceeded(mem.b) === 3 && JSON.stringify(limitHits(mem.a)) === '{"exceededResources":2}')

  const txt = render({ summary: s, qFields: q, qDesc: { cpuTimeP50: 'unit word' }, doRows: [{ day: 'd1', namespace: 'N', cpuTime: 4 }, { day: 'd2', namespace: 'N', cpuTime: 9 }], days: 2, limits: { a: 300000 } })
  t('the verdict names a Worker that exceeded', /VERDICT: 1 of 2 Worker\(s\) hit a runtime limit in 2 day\(s\): a \(exceededResources 2\)/.test(txt))
  t('success and failure lines are separate', /success, worst daily cpuTimeP99: 90 on 2026-11-02/.test(txt) && /exceededResources \(2\): worst daily cpuTimeP50 300 on 2026-11-02, cpuTimeP99 310/.test(txt))
  t('the memory verdict names exceededMemory', /b \(exceededMemory 3\)/.test(render({ summary: mem, qFields: q, qDesc: {}, doRows: null, days: 2, limits: {} })))
  t('coverage is printed with the result (Rule 91)', /^COVERAGE: 2 Worker\(s\), 2 UTC day\(s\)/m.test(txt) && /per route or per cron handler is NOT measured/.test(txt))
  t('the schema\'s own unit description is printed', /cpuTimeP50: unit word/.test(txt))
  t('a DO namespace is summed with its worst day', /N: total 13, worst day d2 at 9/.test(txt))
  t('the relay limit is labelled, others say not read', /== a .*\[cpu_ms limit 300000/.test(txt) && /== b .*\[limit not read\]/.test(txt))

  const clean = render({ summary: summarise(rows.filter(r => r.status !== 'exceededResources'), q), qFields: q, qDesc: {}, doRows: null, days: 2, limits: {} })
  t('with no exceeded rows the verdict says none', /VERDICT: no runtime-limit invocation on any of 2 Worker\(s\)/.test(clean))
  t('missing DO data is NOT MEASURED, not zero', /Durable Objects: NOT MEASURED/.test(clean))

  t('relayLimit reads name and cpu_ms', JSON.stringify(relayLimit('name = "r"\n[limits]\ncpu_ms      = 300000\n')) === '{"r":300000}')
  t('relayLimit returns nothing when cpu_ms is absent', JSON.stringify(relayLimit('name = "r"\n')) === '{}')

  console.log(`self-test: ${n - failed}/${n}`)
  process.exit(failed ? 1 : 0)
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop())) {
  if (process.argv.includes('--self-test')) selfTest()
  else live().catch(e => { console.log(`FAIL: ${e.message}`); process.exit(1) })
}
