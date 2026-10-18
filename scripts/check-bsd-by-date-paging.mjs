// /bsd/events/by-date pages and caches (docs/CC-CMD-2026-10-18-bsd-by-date-offset-and-cache.md).
//
// Before: offset was dropped, so offset=50 returned page one (count 211,
// `previous` null on 2026-10-10), and every call reached BSD. This asserts, on
// the DEPLOYED route:
//   1. page two is not page one: disjoint ids, and `previous` is set;
//   2. an identical second request is served from the edge (X-Cache: HIT);
//   3. a past day advertises 300 s and today 25 s.
// Every predicate is pure over recorded responses, so --self-test feeds each one
// a passing record and one built to break it (Rule 90, MUTATE-FIRST-A).
//
// Usage:  node scripts/check-bsd-by-date-paging.mjs [--self-test]
import { writeFileSync, mkdirSync } from 'node:fs'

const RELAY = 'https://field-relay-nba.jeffunglesbee.workers.dev'
const BUSY_DAY = '2026-10-10'   // 211 events, measured 2026-10-18

export const PREDICATES = {
  'page two is not page one: disjoint ids, and page two names a previous page': r => {
    const a = new Set(r.page0.ids), b = r.page1.ids
    return [r.page0.status === 200 && r.page1.status === 200 && a.size > 0 && b.length > 0
      && b.every(id => !a.has(id)) && r.page1.previous !== null,
      `page0 ${r.page0.ids.length} ids, page1 ${r.page1.ids.length} ids, overlap ${b.filter(id => a.has(id)).length}, previous ${r.page1.previous}`]
  },
  'an identical second request is served from the edge': r => [
    r.repeat.xcache === 'HIT', `X-Cache ${r.repeat.xcache}`],
  'a past day advertises 300 s and today 25 s': r => [
    /max-age=300\b/.test(r.page0.cacheControl) && /max-age=25\b/.test(r.today.cacheControl),
    `past ${r.page0.cacheControl}; today ${r.today.cacheControl}`],
}

const good = () => ({
  page0: { status: 200, ids: [1, 2, 3], previous: null, cacheControl: 'public, max-age=300' },
  page1: { status: 200, ids: [4, 5], previous: 'https://x/?offset=0', cacheControl: 'public, max-age=300' },
  repeat: { xcache: 'HIT' },
  today: { cacheControl: 'public, max-age=25' },
})
const MUTATIONS = {
  'page two is not page one: disjoint ids, and page two names a previous page': r => { r.page1 = { ...r.page0 } },
  'an identical second request is served from the edge': r => { r.repeat.xcache = 'MISS' },
  'a past day advertises 300 s and today 25 s': r => { r.today.cacheControl = 'public, max-age=300' },
}

const run = (record) => Object.entries(PREDICATES).map(([name, p]) => { const [pass, detail] = p(record); return { name, pass, detail } })

if (process.argv.includes('--self-test')) {
  let bad = 0
  for (const [name, p] of Object.entries(PREDICATES)) {
    const ok = p(good())[0]
    const broken = good(); MUTATIONS[name](broken)
    const caught = !p(broken)[0]
    console.log(`${ok && caught ? 'PASS' : 'FAIL'}  ${name} (holds ${ok}, mutation caught ${caught})`)
    if (!(ok && caught)) bad++
  }
  process.exit(bad ? 1 : 0)
}

const get = async (path) => {
  const r = await fetch(RELAY + path)
  const text = await r.text()
  let body = {}
  try { body = JSON.parse(text) } catch { body = {} }
  return { status: r.status, ids: (Array.isArray(body.results) ? body.results : []).map(e => e.id),
    previous: body.previous ?? null, cacheControl: r.headers.get('cache-control') ?? '', xcache: r.headers.get('x-cache') ?? '' }
}
const today = new Date().toISOString().slice(0, 10)
const record = {
  page0: await get(`/bsd/events/by-date?date=${BUSY_DAY}`),
  page1: await get(`/bsd/events/by-date?date=${BUSY_DAY}&offset=50`),
  repeat: await get(`/bsd/events/by-date?date=${BUSY_DAY}&offset=50`),
  today: await get(`/bsd/events/by-date?date=${today}`),
}
const results = run(record)
for (const r of results) console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name} — ${r.detail}`)
mkdirSync('outbox', { recursive: true })
writeFileSync('outbox/bsd-by-date-paging-latest.json', JSON.stringify({ at: new Date().toISOString(), busyDay: BUSY_DAY, today, record, results }, null, 2) + '\n')
process.exit(results.every(r => r.pass) ? 0 : 1)
