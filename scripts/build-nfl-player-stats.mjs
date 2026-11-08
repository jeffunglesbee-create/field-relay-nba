#!/usr/bin/env node
// nfl/{year}/player-stats.json, built on a GitHub Actions runner and written to
// R2 FIELD_DATA. Replaces the Worker's runNFLR2Update player-stats task
// (src/nfl-r2.js), per option B of docs/CC-CMD-2026-11-03-nfl-r2-player-stats-oom.md.
//
// WHY A RUNNER. The Worker read nflverse's all-seasons player_stats.csv
// (33.4 MB) into one string and split it, peaking at 532 MB against a 128 MB
// limit: 45 out-of-memory kills over four Wednesdays (scripts/nfl-r2-memory-repro.mjs).
// That file also stops at the 2024 season, and its naive split misread 75,416
// of 134,470 lines. This reads the CURRENT season's weekly file
// (stats_player/stats_player_week_{year}.csv, 3.8 MB on 2026-11-08) with a
// quote-aware parser, on a machine with no 128 MB ceiling and no journalism
// cycle sharing the invocation.
//
// THE OUTPUT IS THE SAME CONTRACT. Same key, same envelope fields
// (updated, source, data, season, targetYear), same per-player fields and
// arithmetic as fetchPlayerStats did. The client reads data[*].pos, attempts,
// name, team and passingEPA (jubilant-bassoon nflNGSInit, `NFL_QB_STATS`).
// Two column names differ in the current file and are mapped, not guessed:
// `team` (was `recent_team`). A missing required column fails the run.
//
// THE YEAR is the relay route's own expression (src/index.js /nflverse/:
// month >= 7 ? year : year - 1), so the key written is the key read.
//
// Exit: 0 written and read back, 1 anything else (with the reason).
//   node scripts/build-nfl-player-stats.mjs                 (CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID)
//   node scripts/build-nfl-player-stats.mjs --dry-run <csv>  (build from a local file, write nothing)
//   node scripts/build-nfl-player-stats.mjs --self-test

import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'

const NFLVERSE_BASE = 'https://github.com/nflverse/nflverse-data/releases/download'
const BUCKET = 'field-relay-data'
// The URL the client fetches (jubilant-bassoon `_NFL_NGS_RELAY` + the file name).
const ROUTE = 'https://field-relay-nba.jeffunglesbee.workers.dev/nflverse/player-stats.json'
const REQUIRED = ['player_id', 'player_name', 'player_display_name', 'position', 'season', 'week', 'team',
  'attempts', 'completions', 'passing_yards', 'passing_epa', 'rushing_epa', 'receiving_epa',
  'target_share', 'air_yards_share', 'wopr', 'racr']

/** The relay route's year: src/index.js, GET /nflverse/ ("Dynamic year"). */
export function nflYear (d = new Date()) {
  return d.getMonth() >= 7 ? d.getFullYear() : d.getFullYear() - 1
}

/** RFC 4180: quoted fields, "" escapes, commas and newlines inside quotes, CRLF, BOM. */
export function parseCSV (text) {
  const s = text.replace(/^﻿/, '')
  const rows = []
  let row = []; let f = ''; let q = false
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (q) {
      if (c === '"') { if (s[i + 1] === '"') { f += '"'; i++ } else q = false } else f += c
    } else if (c === '"') q = true
    else if (c === ',') { row.push(f); f = '' }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && s[i + 1] === '\n') i++
      row.push(f); f = ''
      if (row.length > 1 || row[0] !== '') rows.push(row)
      row = []
    } else f += c
  }
  if (f !== '' || row.length) { row.push(f); rows.push(row) }
  if (q) throw new Error('unterminated quoted field')
  if (!rows.length) return { header: [], records: [] }
  const header = rows[0]
  const records = []
  for (let r = 1; r < rows.length; r++) {
    if (rows[r].length !== header.length) throw new Error(`line ${r + 1}: ${rows[r].length} fields, header has ${header.length}`)
    records.push(Object.fromEntries(header.map((h, k) => [h, rows[r][k]])))
  }
  return { header, records }
}

// The Worker's own helpers, unchanged, so the arithmetic matches.
function safeFloat (v, def = null) { const f = parseFloat(v); return isNaN(f) ? def : Math.round(f * 1000) / 1000 }
function safeInt (v, def = 0) { const f = parseInt(v); return isNaN(f) ? def : f }

/**
 * fetchPlayerStats's aggregation (src/nfl-r2.js, before its retirement), on
 * parsed records. One difference, stated: rows are taken in week order, so
 * "last week value" (target share, air yards share, wopr, racr) and team are the
 * latest week's, which the old code got only if the file happened to be sorted.
 */
export function aggregate (records, year) {
  const seasons = new Set(records.map(r => safeInt(r.season)))
  if (seasons.size !== 1 || !seasons.has(year)) throw new Error(`file holds seasons ${[...seasons].join(',')}, expected only ${year}`)
  const sorted = [...records].sort((a, b) => safeInt(a.week) - safeInt(b.week))
  const byPlayer = {}
  for (const row of sorted) {
    const pid = row.player_id
    const pos = (row.position || '').toUpperCase()
    const season = safeInt(row.season)
    if (!pid || !pos || !season) continue
    const p = byPlayer[pid] ||= { season }
    if (pos === 'QB') {
      p.name = row.player_display_name || row.player_name
      p.team = row.team
      p.pos = pos
      p.attempts = (p.attempts || 0) + safeInt(row.attempts, 0)
      p.completions = (p.completions || 0) + safeInt(row.completions, 0)
      p.passingYards = (p.passingYards || 0) + safeInt(row.passing_yards, 0)
      p.passingEPA = (p.passingEPA || 0) + (safeFloat(row.passing_epa, 0) || 0)
      p.rushingEPA = (p.rushingEPA || 0) + (safeFloat(row.rushing_epa, 0) || 0)
    } else if (['WR', 'TE', 'RB'].includes(pos)) {
      p.name = row.player_display_name || row.player_name
      p.team = row.team
      p.pos = pos
      p.receivingEPA = (p.receivingEPA || 0) + (safeFloat(row.receiving_epa, 0) || 0)
      p.targetShare = safeFloat(row.target_share, null)
      p.airYardsShare = safeFloat(row.air_yards_share, null)
      p.wopr = safeFloat(row.wopr, null)
      p.racr = safeFloat(row.racr, null)
    }
    p.weeks = (p.weeks || 0) + 1
  }
  const data = {}
  for (const [pid, p] of Object.entries(byPlayer)) {
    if (!p.name) continue
    data[pid] = {
      name: p.name, team: p.team, pos: p.pos, season: p.season, weeks: p.weeks,
      ...(p.pos === 'QB'
        ? {
            attempts: p.attempts, completions: p.completions, passingYards: p.passingYards,
            passingEPA: Math.round((p.passingEPA || 0) * 100) / 100,
            rushingEPA: Math.round((p.rushingEPA || 0) * 100) / 100
          }
        : {
            receivingEPA: Math.round((p.receivingEPA || 0) * 100) / 100,
            targetShare: p.targetShare, airYardsShare: p.airYardsShare, wopr: p.wopr, racr: p.racr
          })
    }
  }
  return data
}

export function build (csvText, year, updated) {
  const { header, records } = parseCSV(csvText)
  const missing = REQUIRED.filter(c => !header.includes(c))
  if (missing.length) throw new Error(`source is missing column(s): ${missing.join(', ')}`)
  const data = aggregate(records, year)
  const count = Object.keys(data).length
  if (count === 0) throw new Error('0 players: refusing to overwrite R2 with an empty table')
  const qbs = Object.values(data).filter(p => p.pos === 'QB' && p.attempts >= 100).length
  const maxWeek = Math.max(...records.map(r => safeInt(r.week)))
  const payload = { updated, source: `nflverse stats_player_week_${year}.csv via GitHub Actions`, data, season: year, targetYear: year }
  return { payload, count, qbs, rows: records.length, maxWeek }
}

// ── live ────────────────────────────────────────────────────────────────────

function r2url (key) {
  return `https://api.cloudflare.com/client/v4/accounts/${process.env.CLOUDFLARE_ACCOUNT_ID}/r2/buckets/${BUCKET}/objects/${key}`
}
const auth = () => ({ Authorization: `Bearer ${process.env.CLOUDFLARE_API_TOKEN}` })
const sha = s => createHash('sha256').update(s).digest('hex').slice(0, 16)

function describe (text) {
  try {
    const j = JSON.parse(text)
    return `updated ${j.updated}, season ${j.season ?? '(none)'}, players ${Object.keys(j.data || {}).length}, source "${j.source}"`
  } catch (e) { return `not JSON (${text.length} bytes): ${e.message}` }
}

async function live () {
  for (const k of ['CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_ACCOUNT_ID']) {
    if (!process.env[k]) throw new Error(`${k} is not set`)
  }
  const year = nflYear()
  const key = `nfl/${year}/player-stats.json`
  const src = `${NFLVERSE_BASE}/stats_player/stats_player_week_${year}.csv`
  const res = await fetch(src, { headers: { 'User-Agent': 'FIELD-Sports-Intelligence/1.0' } })
  if (!res.ok) throw new Error(`source ${src}: HTTP ${res.status}`)
  const csv = await res.text()
  const b = build(csv, year, new Date().toISOString())
  console.log(`source: ${src} (${csv.length} bytes, ${b.rows} rows, weeks 1-${b.maxWeek})`)
  console.log(`built: ${b.count} players, ${b.qbs} QBs with 100+ attempts (the client's threshold)`)

  const before = await fetch(r2url(key), { headers: auth() })
  console.log(`R2 ${key} before: ${before.status === 200 ? describe(await before.text()) : `HTTP ${before.status}`}`)

  const body = JSON.stringify(b.payload)
  const put = await fetch(r2url(key), { method: 'PUT', headers: { ...auth(), 'Content-Type': 'application/json' }, body })
  const putText = await put.text()
  if (!put.ok) throw new Error(`R2 PUT ${key}: HTTP ${put.status}: ${putText.slice(0, 400)}`)

  const after = await fetch(r2url(key), { headers: auth() })
  const afterText = await after.text()
  if (after.status !== 200) throw new Error(`R2 read-back ${key}: HTTP ${after.status}`)
  if (sha(afterText) !== sha(body)) throw new Error(`R2 read-back ${key}: content differs from what was written (${sha(afterText)} != ${sha(body)})`)
  console.log(`R2 ${key} after: ${describe(afterText)} (read back, sha256 ${sha(body)} matches)`)

  // End to end: what the client is served. The route is R2-first, so it must
  // answer these exact bytes, from R2.
  const served = await fetch(`${ROUTE}?v=${Date.now()}`)
  const servedText = await served.text()
  const xs = served.headers.get('x-source')
  if (served.status !== 200 || xs !== 'r2' || sha(servedText) !== sha(body)) {
    throw new Error(`route ${ROUTE}: HTTP ${served.status}, X-Source ${xs}, sha256 ${sha(servedText)} (wrote ${sha(body)})`)
  }
  console.log(`route: ${ROUTE} serves the written bytes (HTTP 200, X-Source r2, sha256 ${sha(body)})`)
  console.log(`WRITTEN AND SERVED: ${key}`)
}

// ── self-test ───────────────────────────────────────────────────────────────

function selfTest () {
  let n = 0; let failed = 0
  const t = (name, ok) => { n++; if (!ok) failed++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`) }
  const throws = (fn, re) => { try { fn(); return false } catch (e) { return re.test(e.message) } }

  t('nflYear is the route\'s: Nov 2026 -> 2026, Mar 2027 -> 2026, Aug 2027 -> 2027',
    nflYear(new Date(2026, 10, 8)) === 2026 && nflYear(new Date(2027, 2, 1)) === 2026 && nflYear(new Date(2027, 7, 1)) === 2027)

  const p = parseCSV('﻿a,b,c\r\n1,"x, y",3\n4,"say ""hi""",6\n7,"two\nlines",9\n')
  t('a quoted comma stays in its field', p.records[0].b === 'x, y' && p.records[0].c === '3')
  t('"" inside quotes is one quote', p.records[1].b === 'say "hi"')
  t('a newline inside quotes stays in its field', p.records[2].b === 'two\nlines' && p.records.length === 3)
  t('BOM and CRLF are handled', p.header[0] === 'a' && p.records[0].a === '1')
  t('a short line fails, never shifts columns', throws(() => parseCSV('a,b,c\n1,2\n'), /2 fields, header has 3/))
  t('an unterminated quote fails', throws(() => parseCSV('a,b\n1,"open\n'), /unterminated/))

  const head = REQUIRED.join(',')
  const line = o => REQUIRED.map(c => o[c] ?? '').map(v => (/[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : v)).join(',')
  const qb = (week, att, epa, team) => line({ player_id: 'q1', player_name: 'J.Doe', player_display_name: 'John Doe, Jr.', position: 'QB', season: 2026, week, team, attempts: att, completions: 10, passing_yards: 100, passing_epa: epa, rushing_epa: 0.5 })
  const wr = (week, ts) => line({ player_id: 'w1', player_name: 'A.B', player_display_name: 'A B', position: 'WR', season: 2026, week, team: 'KC', receiving_epa: 1.2345, target_share: ts })
  const csv = [head, qb(2, 60, 3.3333, 'NYJ'), wr(2, 0.31), qb(1, 50, 2.2222, 'BUF'), wr(1, 0.2), line({ player_id: 'k1', player_name: 'K', player_display_name: 'K', position: 'K', season: 2026, week: 1, team: 'KC' })].join('\n')
  const b = build(csv, 2026, 'T')
  const q = b.payload.data.q1
  t('QB totals sum across weeks, with the old rounding', q.attempts === 110 && q.completions === 20 && q.passingYards === 200 && q.passingEPA === 5.56 && q.rushingEPA === 1)
  t('a display name holding a comma survives (the old parser\'s failure)', q.name === 'John Doe, Jr.')
  t('team and last-week values come from the latest week, whatever the file order', q.team === 'NYJ' && b.payload.data.w1.targetShare === 0.31)
  t('weeks counts rows; receivers keep their own fields', q.weeks === 2 && b.payload.data.w1.receivingEPA === 2.47 && !('attempts' in b.payload.data.w1))
  t('a position the old code did not keep is still dropped', !('k1' in b.payload.data))
  t('the envelope is the old one: updated, source, data, season, targetYear', JSON.stringify(Object.keys(b.payload)) === '["updated","source","data","season","targetYear"]' && b.payload.season === 2026)
  t('the client threshold count is reported', b.qbs === 1)
  t('a missing required column fails', throws(() => build(csv.replace('team', 'recent_team'), 2026, 'T'), /missing column\(s\): team/))
  t('a file from another season fails', throws(() => build(csv, 2025, 'T'), /expected only 2025/))
  t('no players refuses to overwrite', throws(() => build(head + '\n' + line({ player_id: 'k1', player_name: 'K', player_display_name: 'K', position: 'K', season: 2026, week: 1, team: 'KC' }), 2026, 'T'), /0 players/))

  console.log(`self-test: ${n - failed}/${n}`)
  process.exit(failed ? 1 : 0)
}

const arg = process.argv[2]
const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop())
if (!isMain) { /* imported: export only */ } else if (arg === '--self-test') selfTest()
else if (arg === '--dry-run') {
  const csv = readFileSync(process.argv[3], 'utf8')
  const year = Number(process.env.YEAR || nflYear())
  const b = build(csv, year, new Date().toISOString())
  console.log(JSON.stringify({ rows: b.rows, maxWeek: b.maxWeek, players: b.count, qbs100: b.qbs, bytes: JSON.stringify(b.payload).length, sample: Object.values(b.payload.data).filter(p => p.pos === 'QB').sort((x, y) => y.attempts - x.attempts).slice(0, 3) }, null, 1))
} else live().catch(e => { console.log(`FAIL: ${e.message}`); process.exit(1) })
