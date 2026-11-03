#!/usr/bin/env node
// Runs the relay's real runNFLR2Update (src/nfl-r2.js) with every nflverse
// fetch served from a local copy, and prints its peak JS heap. The proof for
// docs/CC-CMD-2026-11-03-relay-exceeded-memory.md and the done condition of
// docs/CC-CMD-2026-11-03-nfl-r2-player-stats-oom.md.
//
// Measured 2026-11-03 against the 33,447,747-byte player_stats.csv:
//   uncapped                     peak 532 MB heap (36 MB before the call)
//   node --max-old-space-size=128   FATAL ... JavaScript heap out of memory
//   a 2,000-row cut, capped at 128  peak 14 MB, completes
// A Worker's limit is 128 MB for the whole isolate, so a heap peak alone
// already over it is sufficient; one under it is necessary, not sufficient.
//
//   curl -sSL -o /tmp/ps.csv https://github.com/nflverse/nflverse-data/releases/download/player_stats/player_stats.csv
//   node --max-old-space-size=128 scripts/nfl-r2-memory-repro.mjs /tmp/ps.csv
// Any URL other than player_stats.csv answers 404, as two of the three did live
// on 2026-11-03.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const csvPath = process.argv[2]
if (!csvPath) { console.log('usage: nfl-r2-memory-repro.mjs <player_stats.csv>'); process.exit(1) }
const csv = readFileSync(csvPath, 'utf8')
globalThis.fetch = async (url) => String(url).includes('player_stats/player_stats.csv')
  ? new Response(csv, { status: 200 })
  : new Response('Not Found', { status: 404 })
const puts = []
const env = { FIELD_DATA: { put: async (k, v) => { puts.push([k, v.length]) } } }
const { runNFLR2Update } = await import(fileURLToPath(new URL('../src/nfl-r2.js', import.meta.url)))
let peak = 0
const t = setInterval(() => { peak = Math.max(peak, process.memoryUsage().heapUsed) }, 5)
const base = process.memoryUsage().heapUsed
const r = await runNFLR2Update(env)
clearInterval(t)
peak = Math.max(peak, process.memoryUsage().heapUsed)
const mb = n => Math.round(n / 1048576)
console.log(JSON.stringify({ csvBytes: csv.length, baselineHeapMB: mb(base), peakHeapMB: mb(peak), results: r.results, puts }))
console.log(mb(peak) < 128 ? `UNDER 128 MB heap (necessary, not sufficient)` : `OVER 128 MB heap: a Worker running this runs out of memory`)
process.exit(mb(peak) < 128 ? 0 : 1)
