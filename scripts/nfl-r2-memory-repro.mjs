#!/usr/bin/env node
// Runs the relay's real runNFLR2Update with every nflverse fetch served from a
// local copy, and prints its peak JS heap. The function was retired from the
// Worker on 2026-11-08; this loads the last real version, `git show
// 00c4866:src/nfl-r2.js`, so the measurement stays reproducible. The proof for
// docs/CC-CMD-2026-11-03-relay-exceeded-memory.md and the done condition of
// docs/CC-CMD-2026-11-03-nfl-r2-player-stats-oom.md.
//
// Measured 2026-11-03 against the 33,447,747-byte player_stats.csv:
//   uncapped                     peak 532 MB heap (36 MB before the call)
//   node --max-old-space-size=128   FATAL ... JavaScript heap out of memory
//   a 2,000-row cut, capped at 128  peak 14 MB, completes
// A Worker's limit is 128 MB for the whole isolate. Node's heap peak is
// evidence, not the Worker's measurement: the Worker completed the job at least
// once (R2 held its 2026-11-04T12:00:23Z write) while failing 45 times in 30 days.
// Under 128 MB here is necessary, not sufficient.
//
//   curl -sSL -o /tmp/ps.csv https://github.com/nflverse/nflverse-data/releases/download/player_stats/player_stats.csv
//   node --max-old-space-size=128 scripts/nfl-r2-memory-repro.mjs /tmp/ps.csv
// Any URL other than player_stats.csv answers 404, as two of the three did live
// on 2026-11-03.
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const csvPath = process.argv[2]
if (!csvPath) { console.log('usage: nfl-r2-memory-repro.mjs <player_stats.csv>'); process.exit(1) }
const csv = readFileSync(csvPath, 'utf8')
globalThis.fetch = async (url) => String(url).includes('player_stats/player_stats.csv')
  ? new Response(csv, { status: 200 })
  : new Response('Not Found', { status: 404 })
const puts = []
const env = { FIELD_DATA: { put: async (k, v) => { puts.push([k, v.length]) } } }
const oldSrc = execFileSync('git', ['show', '00c4866:src/nfl-r2.js'], { encoding: 'utf8' })
const modPath = join(mkdtempSync(join(tmpdir(), 'nfl-r2-')), 'nfl-r2.mjs')
writeFileSync(modPath, oldSrc)
const { runNFLR2Update } = await import(modPath)
let peak = 0
const t = setInterval(() => { peak = Math.max(peak, process.memoryUsage().heapUsed) }, 5)
const base = process.memoryUsage().heapUsed
const r = await runNFLR2Update(env)
clearInterval(t)
peak = Math.max(peak, process.memoryUsage().heapUsed)
const mb = n => Math.round(n / 1048576)
console.log(JSON.stringify({ csvBytes: csv.length, baselineHeapMB: mb(base), peakHeapMB: mb(peak), results: r.results, puts }))
console.log(mb(peak) < 128 ? `UNDER 128 MB heap (necessary, not sufficient)` : `OVER 128 MB heap in Node. Not the Worker's own figure: the Worker completed this job at least once (2026-11-04T12:00Z) and failed 45 times in 30 days`)
process.exit(mb(peak) < 128 ? 0 : 1)
