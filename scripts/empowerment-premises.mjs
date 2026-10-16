#!/usr/bin/env node
// The premise pass for field-laboratory docs/CC-CMD-2026-10-15-empowerment-metrics.md,
// Tasks 1-3, run BEFORE any of their types are built (lab CLAUDE.md Rule 100:
// list the load-bearing premises and the one command that would refute each,
// and run those commands first). JSON counting only: no metric is computed
// here. The metrics are F# in field-laboratory, and this pass decides what they
// may assume.
//
// Each premise is a count with its denominator, so a reader can see what was
// measured and over how much (Rule 91). Every counter has a synthetic input in
// --self-test that drives it non-zero, and a clean input that keeps it at zero
// (Rule 90): a counter that cannot move is not reported.
//
//   SOCCER (BSD captures in R2, every non-shell capture, both files):
//     P1 xg      — is `xg` a number on every shot; how many are 0, estimated
//     P2 added   — is stoppage encoded as min + added at 45, 90 AND 105
//     P3 stage   — which period markers occur together (FT beside ET or PEN?)
//     P4 kickoff — does every capture's event carry a kickoff time
//     P5 own goals, P6 shootout kicks in the shotmap
//     T1-T3      — Tactical Lock: any clock below the minute; restart events
//   NHL (2025-26 regular season, every 4th game id):
//     N1-N6      — shift rows, roster positions, credited keys, TOI bands
//
// The R2 walk is field-laboratory's own scripts/probe-empowerment.mjs, fetched
// by the workflow at one lab commit (recorded in the artifact) and imported
// from LAB_PROBE_PATH. Runs 38962367310 and 38963130231 used a copy of it,
// because the lab was private then; it went public on 2026-10-16, and a copy is
// not the source. The artifact still counts the captures uploaded by Task 0's
// census time, which the source counted as 786.

import { writeFileSync, mkdirSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

const RELAY = process.env.RELAY_URL || 'https://field-relay-nba.jeffunglesbee.workers.dev'
const BSD_BASE = 'https://sports.bzzoiro.com'
const NHL_WEB = 'https://api-web.nhle.com'
const NHL_STATS = 'https://api.nhle.com'
const OUT = 'outbox/empowerment-premises-latest.json'
const TIMEOUT_MS = 30_000
// Task 0's census time: captures uploaded at or before it are the "786".
const TASK0_AT = '2026-10-16T09:35:05.514Z'
// Every BSD league id the capture writer has a slug for (src/index.js
// V2_LEAGUES bsdLeagueId values, plus wc26's league_id=27 used by the WC
// by-date fetch). Used only to fetch kickoff rows for P4.
const BSD_LEAGUES = [1, 3, 4, 5, 6, 7, 8, 12, 18, 27]
const NHL_SEASON_FIRST = 2025020001, NHL_STRIDE = 4, NHL_GAMES = 328

// ── small helpers ───────────────────────────────────────────────────────────
const inc = (o, k, n = 1) => { o[k] = (o[k] ?? 0) + n; return o }
const isInt = (v) => typeof v === 'number' && Number.isInteger(v)
const isNum = (v) => typeof v === 'number' && Number.isFinite(v)
const quantiles = (xs, qs) => {
  const s = [...xs].sort((a, b) => a - b)
  return Object.fromEntries(qs.map(q => [`p${Math.round(q * 100)}`, s.length ? s[Math.min(s.length - 1, Math.floor(q * s.length))] : null]))
}

// ── soccer ─────────────────────────────────────────────────────────────────
// Period texts that are a finishing marker, and ones that name extra time or
// a shootout. Both lists are matched against what the census prints, and the
// raw text histogram is in the artifact so an unexpected word is visible.
export const FINISH = /^(FT|AET|AP|PEN|Ended|Full[ -]?time|After extra time|After penalties)$/i
export const EXTRA = /^(ET|AET|Extra[ -]?time|PEN|AP|Penalties|After extra time|After penalties)$/i
export const SHOOTOUT = /^(PEN|AP|Penalties|After penalties)$/i
// field-laboratory TIME_KEY minus the minute-grain names: what a clock BELOW
// the minute would be called if one were present.
export const SUBMINUTE_KEY = /^(t|ts|uts|time|timestamp|frame|frameid|frame_id|sec|second|period_second)$/i
const KICKOFF_KEY = /kick|start|event_date|^date$|^time$/i

export function soccerPremises(captures, events = null) {
  const P1 = { shots: 0, xg_number: 0, xg_null: 0, xg_absent: 0, xg_other_type: 0, xg_zero: 0, xg_negative: 0,
    estimated: 0, estimated_zero: 0, min_not_whole_number: 0, min_string: 0, added_absent: 0, added_null: 0,
    added_not_whole_number: 0, home_not_boolean: 0, captures_with_a_gap: [] }
  const P2 = { added_shots_by_min: {}, added_incidents_by_min: {}, shots_beyond_90_without_extra_marker: 0,
    shots_at_105_with_added: 0, shots_106_plus: 0, shots_over_120: 0, incidents_at_105_with_added: {}, captures_with_extra_marker: 0, examples: [] }
  const P3 = { period_text_sets: {}, period_texts: {}, finishing_and_live: 0, finishing_without_both_scores: 0,
    ft_beside_extra_marker: 0, ft_beside_shootout_marker: 0, ft_only_level_score_with_extra_marker: 0, no_incidents: 0 }
  const P4 = { stats_top_keys: {}, incidents_top_keys: {}, kickoff_like_keys: {}, captures: 0, event_row_found: 0,
    event_date_parseable: 0, event_row_keys: {}, missing_examples: [] }
  const P5 = { own_goal_incidents: 0, shot_goal_same_minute_credited_side: 0, shot_goal_same_minute_other_side: 0,
    shot_goal_same_minute_none: 0, shot_keys: {}, gtype_values: {}, sit_values: {}, own_goal_row_gtype: {}, own_goal_incident_goal_types: {},
    own_goal_rows_by_gtype_xg: {} }
  const P3x = { extra_markers: {} }
  const P6 = { captures_with_shootout_marker: 0, shots_at_120_plus_in_shootout_captures_by_sit: {}, penalty_sit_at_120_plus: 0 }
  const T = { subminute_keys: {}, incident_types: {}, sequence_events: {}, sequence_events_with_a_time_key: 0, sequence_events_total: 0 }
  const shared = { minutes: 0, captures_with_one: 0, zero_xg_shots_by_side_of_a_same_minute_pair: 0 }

  const walkKeys = (o, where, depth = 0) => {
    if (!o || typeof o !== 'object' || depth > 6) return
    if (Array.isArray(o)) { for (const x of o.slice(0, 400)) walkKeys(x, where, depth + 1); return }
    for (const [k, v] of Object.entries(o)) {
      if (SUBMINUTE_KEY.test(k)) inc(T.subminute_keys, `${where}:${k}`)
      walkKeys(v, where, depth + 1)
    }
  }

  for (const c of captures) {
    const shots = Array.isArray(c.stats?.shotmap) ? c.stats.shotmap : []
    const incs = Array.isArray(c.incidents?.incidents) ? c.incidents.incidents : null
    const gaps = new Set()
    for (const k of Object.keys(c.stats ?? {})) { inc(P4.stats_top_keys, k); if (KICKOFF_KEY.test(k)) inc(P4.kickoff_like_keys, `stats:${k}`) }
    for (const k of Object.keys(c.incidents ?? {})) { inc(P4.incidents_top_keys, k); if (KICKOFF_KEY.test(k)) inc(P4.kickoff_like_keys, `incidents:${k}`) }
    walkKeys(c.stats, 'stats'); walkKeys(c.incidents, 'incidents')

    // P1
    for (const s of shots) {
      P1.shots++
      for (const k of Object.keys(s)) inc(P5.shot_keys, k)
      if (!('xg' in s)) { P1.xg_absent++; gaps.add('xg') }
      else if (s.xg === null) { P1.xg_null++; gaps.add('xg') }
      else if (!isNum(s.xg)) { P1.xg_other_type++; gaps.add('xg') }
      else { P1.xg_number++; if (s.xg === 0) P1.xg_zero++; if (s.xg < 0) { P1.xg_negative++; gaps.add('xg<0') } }
      if (s.xg_estimated === true) { P1.estimated++; if (s.xg === 0) P1.estimated_zero++ }
      if ('gtype' in s) inc(P5.gtype_values, String(s.gtype))
      inc(P5.sit_values, String(s.sit))
      if (!isInt(s.min)) { P1.min_not_whole_number++; gaps.add('min'); if (typeof s.min === 'string') P1.min_string++ }
      if (!('added' in s)) P1.added_absent++
      else if (s.added === null) P1.added_null++
      else if (!isInt(s.added)) { P1.added_not_whole_number++; gaps.add('added') }
      if (typeof s.home !== 'boolean') { P1.home_not_boolean++; gaps.add('home') }
    }
    if (gaps.size) P1.captures_with_a_gap.push({ slug: c.slug, id: c.id, gaps: [...gaps] })

    // P3 and the markers P2/P6 need
    const periods = (incs ?? []).filter(i => i?.type === 'period')
    if (!incs) P3.no_incidents++
    const texts = periods.map(p => `${String(p.text ?? '').trim()}${p.is_live === true ? '(live)' : ''}`)
    for (const t of texts) inc(P3.period_texts, t)
    inc(P3.period_text_sets, [...new Set(texts)].sort().join(',') || '(none)')
    const finishing = periods.filter(p => FINISH.test(String(p.text ?? '').trim()))
    const extra = periods.some(p => EXTRA.test(String(p.text ?? '').trim()))
    const shootout = periods.some(p => SHOOTOUT.test(String(p.text ?? '').trim()))
    const live = periods.some(p => p.is_live === true)
    const ft = periods.filter(p => /^FT$/i.test(String(p.text ?? '').trim()))
    if (finishing.length && live) P3.finishing_and_live++
    if (finishing.length && !finishing.some(p => isInt(p.home_score) && isInt(p.away_score))) P3.finishing_without_both_scores++
    if (ft.length && extra) P3.ft_beside_extra_marker++
    if (ft.length && shootout) P3.ft_beside_shootout_marker++
    if (ft.length && extra && finishing.every(p => /^FT$/i.test(String(p.text ?? '').trim())) && ft.some(p => isInt(p.home_score) && p.home_score === p.away_score)) P3.ft_only_level_score_with_extra_marker++
    if (extra) P2.captures_with_extra_marker++
    if (extra) for (const p of periods) inc(P3x.extra_markers, `${String(p.text ?? '').trim()}${p.is_live === true ? '(live)' : ''}@${p.minute}:${isInt(p.home_score) && isInt(p.away_score) ? (p.home_score === p.away_score ? 'level' : 'decided') : 'no-score'}`)

    // P2
    for (const s of shots) {
      if (!isInt(s.min)) continue
      if (isInt(s.added) && s.added > 0) inc(P2.added_shots_by_min, [45, 90, 105, 120].includes(s.min) ? String(s.min) : 'elsewhere')
      if (s.min >= 91 && !extra) { P2.shots_beyond_90_without_extra_marker++; if (P2.examples.length < 10) P2.examples.push({ slug: c.slug, id: c.id, min: s.min, added: s.added ?? null, why: 'min>=91 with no extra-time marker' }) }
      if (s.min === 105 && isInt(s.added) && s.added > 0) P2.shots_at_105_with_added++
      if (s.min >= 106) P2.shots_106_plus++
      if (s.min > 120) P2.shots_over_120++
      if (!isInt(s.added) && s.added != null && P2.examples.length < 10) P2.examples.push({ slug: c.slug, id: c.id, min: s.min, added: s.added, why: 'added not a whole number' })
    }
    for (const i of incs ?? []) {
      if (i?.type === 'period') continue
      if (isInt(i?.added_time) && i.added_time > 0 && isInt(i.minute)) {
        inc(P2.added_incidents_by_min, [45, 90, 105, 120].includes(i.minute) ? String(i.minute) : 'elsewhere')
        if (i.minute === 105) inc(P2.incidents_at_105_with_added, String(i.type))
      }
    }

    // P5
    for (const i of incs ?? []) {
      if (i?.type !== 'goal' || !/own/i.test(String(i.goal_type ?? ''))) continue
      P5.own_goal_incidents++
      inc(P5.own_goal_incident_goal_types, String(i.goal_type))
      const rows = shots.filter(s => s.type === 'goal' && s.min === i.minute && (s.added ?? null) === (i.added_time ?? null))
      if (!rows.length) P5.shot_goal_same_minute_none++
      for (const r of rows) {
        if (r.home === i.is_home) P5.shot_goal_same_minute_credited_side++; else P5.shot_goal_same_minute_other_side++
        inc(P5.own_goal_row_gtype, String(r.gtype))
        inc(P5.own_goal_rows_by_gtype_xg, `${r.gtype}:${r.xg === null ? 'null' : r.xg > 0 ? 'positive' : 'other'}`)
      }
    }

    // P6
    if (shootout) {
      P6.captures_with_shootout_marker++
      for (const s of shots) if (isInt(s.min) && s.min >= 120) inc(P6.shots_at_120_plus_in_shootout_captures_by_sit, `${String(s.sit ?? '(none)')}@${s.min}+${s.added ?? 0}`)
    }
    for (const s of shots) if (isInt(s.min) && s.min >= 120 && /pen/i.test(String(s.sit ?? ''))) P6.penalty_sit_at_120_plus++

    // T: incident types and restart events
    for (const i of incs ?? []) {
      inc(T.incident_types, String(i?.type))
      for (const e of Array.isArray(i?.sequence) ? i.sequence : []) {
        T.sequence_events_total++
        inc(T.sequence_events, String(e?.event))
        if (e && Object.keys(e).some(k => SUBMINUTE_KEY.test(k) || /^(min|minute)$/i.test(k))) T.sequence_events_with_a_time_key++
      }
    }

    // shared minutes (ruling 1)
    const buckets = new Map()
    for (const s of shots) if (isInt(s.min) && typeof s.home === 'boolean') {
      const k = `${s.min}+${isInt(s.added) ? s.added : 0}`
      const b = buckets.get(k) ?? { h: 0, a: 0, zero: 0 }
      if (s.home) b.h++; else b.a++
      if (s.xg === 0) b.zero++
      buckets.set(k, b)
    }
    let any = false
    for (const b of buckets.values()) if (b.h && b.a) { shared.minutes++; any = true; shared.zero_xg_shots_by_side_of_a_same_minute_pair += b.zero }
    if (any) shared.captures_with_one++

    // P4: the event row
    P4.captures++
    if (events) {
      const row = events.get(String(c.id))
      if (row) {
        P4.event_row_found++
        if (typeof row.event_date === 'string' && !Number.isNaN(Date.parse(row.event_date))) P4.event_date_parseable++
      } else if (P4.missing_examples.length < 15) P4.missing_examples.push(`${c.slug}/${c.id}`)
    }
  }
  if (events) for (const row of events.values()) for (const k of Object.keys(row)) inc(P4.event_row_keys, k)
  P1.captures_with_a_gap_count = P1.captures_with_a_gap.length
  P1.captures_with_a_gap = P1.captures_with_a_gap.slice(0, 50)
  return { P1, P2, P3: { ...P3, ...P3x }, P4, P5, P6, T, shared }
}

// ── NHL ────────────────────────────────────────────────────────────────────
const ATTEMPT = { 'goal': 'scoringPlayerId', 'shot-on-goal': 'shootingPlayerId', 'missed-shot': 'shootingPlayerId', 'blocked-shot': 'shootingPlayerId' }
export const mmss = (s) => { const m = /^(\d{1,2}):(\d{2})$/.exec(String(s ?? '')); return m ? Number(m[1]) * 60 + Number(m[2]) : null }
export const bandOf = (T) => (T < 720 ? 'under_720' : T < 1080 ? '720_1079' : 'from_1080')

export function nhlPremises(games) {
  const N = { games: games.length, pbp_present: 0, shifts_present: 0, game_state: {}, game_type: {},
    roster_spots: 0, roster_without_position: 0, positions: {},
    attempts: {}, attempts_without_credit: 0, attempts_without_clock: 0, attempts_beyond_regulation: 0,
    credited_not_in_roster: 0, credited_to_goalie: 0, credited_skater_without_regulation_shifts: 0,
    penalties: 0, penalties_without_committed: 0,
    shift_total_mismatch: 0, shift_games_without_rows: 0, shift_rows_by_type: {}, shift_rows_517: 0,
    shift_517_unreadable_time: 0, shift_517_end_before_start: 0, shift_517_zero_length: 0, shift_517_other_game: 0,
    shift_517_beyond_regulation: 0, games_with_a_bad_517_row: 0, bad_row_examples: [] }
  const toi = []
  const bands = {}
  const deciles = []
  for (const g of games) {
    const pbp = g.pbp, sh = g.shifts
    if (pbp) N.pbp_present++
    if (sh) N.shifts_present++
    if (!pbp || !sh) continue
    inc(N.game_state, String(pbp.gameState)); inc(N.game_type, String(pbp.gameType))
    const pos = new Map()
    for (const r of pbp.rosterSpots ?? []) {
      N.roster_spots++
      if (typeof r?.positionCode !== 'string' || !r.positionCode) N.roster_without_position++
      else inc(N.positions, r.positionCode)
      if (r?.playerId != null) pos.set(String(r.playerId), r.positionCode ?? null)
    }
    // shifts
    const rows = Array.isArray(sh.data) ? sh.data : []
    if (isInt(sh.total) && sh.total !== rows.length) N.shift_total_mismatch++
    if (!rows.length) N.shift_games_without_rows++
    let bad = false
    const shiftsOf = new Map()
    for (const r of rows) {
      inc(N.shift_rows_by_type, String(r?.typeCode))
      if (r?.typeCode !== 517) continue
      N.shift_rows_517++
      if (String(r.gameId) !== String(g.id)) { N.shift_517_other_game++; bad = true }
      const a = mmss(r.startTime), b = mmss(r.endTime)
      const why = a === null || b === null ? 'unreadable' : b < a ? 'end<start' : null
      if (why === 'unreadable') { N.shift_517_unreadable_time++; bad = true }
      else if (why === 'end<start') { N.shift_517_end_before_start++; bad = true }
      else if (a === b) N.shift_517_zero_length++
      if (why && N.bad_row_examples.length < 12) N.bad_row_examples.push({ game: g.id, player: r.playerId, period: r.period, start: r.startTime, end: r.endTime, why })
      if (!isInt(r.period)) { bad = true; continue }
      if (r.period >= 4) { N.shift_517_beyond_regulation++; continue }
      if (why) continue
      const base = (r.period - 1) * 1200
      const list = shiftsOf.get(String(r.playerId)) ?? []
      list.push([base + a, base + b]); shiftsOf.set(String(r.playerId), list)
    }
    if (bad) N.games_with_a_bad_517_row++
    const T = new Map()
    for (const [p, list] of shiftsOf) T.set(p, list.reduce((n, [a, b]) => n + (b - a), 0))
    const tau = (p, t) => (shiftsOf.get(p) ?? []).reduce((n, [a, b]) => n + Math.max(0, Math.min(t - a, b - a)), 0)
    // per skater: first and last third counts
    const thirds = new Map()
    for (const play of pbp.plays ?? []) {
      const kind = play?.typeDescKey
      if (kind === 'penalty') { N.penalties++; if (play.details?.committedByPlayerId == null) N.penalties_without_committed++; continue }
      const key = ATTEMPT[kind]
      if (!key) continue
      inc(N.attempts, kind)
      const pid = play.details?.[key]
      if (pid == null) { N.attempts_without_credit++; continue }
      const per = play.periodDescriptor?.number, clk = mmss(play.timeInPeriod)
      if (!isInt(per) || clk === null) { N.attempts_without_clock++; continue }
      if (per >= 4) { N.attempts_beyond_regulation++; continue }
      if (!pos.has(String(pid))) { N.credited_not_in_roster++; continue }
      const position = pos.get(String(pid))
      if (position === 'G') { N.credited_to_goalie++; continue }
      const Tp = T.get(String(pid)) ?? 0
      if (Tp === 0) { N.credited_skater_without_regulation_shifts++; continue }
      const t = (per - 1) * 1200 + clk, x = tau(String(pid), t)
      const o = thirds.get(String(pid)) ?? { first: 0, last: 0 }
      if (3 * x < Tp) o.first++; else if (3 * x >= 2 * Tp) o.last++
      thirds.set(String(pid), o)
    }
    for (const [p, Tp] of T) {
      if (pos.get(p) === 'G' || !pos.has(p)) continue
      toi.push(Tp)
      const o = thirds.get(p) ?? { first: 0, last: 0 }
      const b = bands[bandOf(Tp)] ??= { skater_games: 0, first: 0, last: 0 }
      b.skater_games++; b.first += o.first; b.last += o.last
      deciles.push({ T: Tp, ...o })
    }
  }
  const qs = quantiles(toi, [0.05, 0.1, 0.25, 0.5, 0.75, 0.9, 0.95])
  const sorted = deciles.sort((a, b) => a.T - b.T)
  const byDecile = Array.from({ length: 10 }, (_, d) => {
    const part = sorted.slice(Math.floor(d * sorted.length / 10), Math.floor((d + 1) * sorted.length / 10))
    return { decile: d + 1, toi_from: part[0]?.T ?? null, toi_to: part[part.length - 1]?.T ?? null, skater_games: part.length,
      first: part.reduce((n, x) => n + x.first, 0), last: part.reduce((n, x) => n + x.last, 0) }
  })
  return { ...N, regulation_toi_seconds: { skater_games: toi.length, ...qs }, bands, by_toi_decile: byDecile }
}



// ── fetch ──────────────────────────────────────────────────────────────────
async function getJson(url, headers = {}, tries = 3) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, { headers: { Accept: 'application/json', 'User-Agent': 'FIELD-premises/1.0', ...headers }, signal: AbortSignal.timeout(TIMEOUT_MS) })
      if (r.status === 429 || r.status >= 500) { await new Promise(res => setTimeout(res, 1000 * 2 ** i)); continue }
      if (!r.ok) return { ok: false, status: r.status }
      return { ok: true, status: r.status, json: JSON.parse(await r.text()) }
    } catch (e) {
      if (i === tries - 1) return { ok: false, status: 0, error: String(e).slice(0, 120) }
    }
  }
  return { ok: false, status: 429 }
}

async function soccerLive(lab) {
  const failedPages = []
  const listPage = async (prefix) => {
    const r = await getJson(`${RELAY}/bsd/r2/list?prefix=${encodeURIComponent(prefix)}`)
    if (r.ok && Array.isArray(r.json?.keys)) return r.json
    failedPages.push(prefix); return null
  }
  const budget = { calls: 0 }
  const walk = await lab.slugWalk(listPage, 12000, budget)
  const keys = []; let capped = walk.capped
  for (const r of await lab.pool(walk.slugs, 4, (sl) => lab.enumerate(listPage, `bsd/${sl}/`, 12000, undefined, budget))) { keys.push(...r.keys); capped = capped || r.capped }
  const comps = lab.groupCaptures(keys)
  const size = new Map(keys.map(k => [k.key, k.size]))
  const nonShell = []
  for (const [slug, v] of Object.entries(comps)) for (const [id, e] of Object.entries(v.events))
    if (e.files.includes('stats.json') && (size.get(`bsd/${slug}/${id}/stats.json`) ?? 0) >= lab.SHELL_BYTES) nonShell.push({ slug, id, uploaded: e.uploaded, hasIncidents: e.files.includes('incidents.json') })
  let readFailures = 0
  const read = async (key) => { const r = await getJson(`${RELAY}/bsd/r2/read?key=${encodeURIComponent(key)}`); if (!r.ok) readFailures++; return r.ok ? r.json : null }
  const captures = await lab.pool(nonShell, 6, async (x) => ({ ...x,
    stats: await read(`bsd/${x.slug}/${x.id}/stats.json`),
    incidents: x.hasIncidents ? await read(`bsd/${x.slug}/${x.id}/incidents.json`) : null }))
  const readable = captures.filter(c => c.stats)

  // P4: kickoff rows, from BSD directly (the relay's /bsd/events/season cannot
  // page). One league at a time over the capture window, following `next`.
  let events = null, eventsNote = 'BSD_API_TOKEN absent: P4 kickoff coverage UNMEASURED'
  const token = process.env.BSD_API_TOKEN
  if (token) {
    events = new Map(); const pages = {}
    const first = nonShell.map(x => x.uploaded).sort()[0]?.slice(0, 10)
    const from = new Date(Date.parse(first) - 5 * 86400000).toISOString().slice(0, 10)
    const to = new Date().toISOString().slice(0, 10)
    let failed = 0
    for (const lid of BSD_LEAGUES) {
      let next = `/api/v2/events/?league_id=${lid}&date_from=${from}&date_to=${to}&limit=100`, n = 0
      while (next && n < 60) {
        const r = await getJson(next.startsWith('http') ? next : `${BSD_BASE}${next}`, { Authorization: `Token ${token}` })
        if (!r.ok) { failed++; break }
        for (const row of r.json?.results ?? []) if (row?.id != null) events.set(String(row.id), row)
        next = r.json?.next || null; n++
      }
      pages[lid] = n
    }
    eventsNote = `event rows for league ids ${BSD_LEAGUES.join(',')}, ${from} to ${to}: ${events.size} rows, pages ${JSON.stringify(pages)}${failed ? `, ${failed} league fetch(es) FAILED` : ''}`
  }
  const premises = soccerPremises(readable, events)
  const task0 = nonShell.filter(x => String(x.uploaded) <= TASK0_AT).length
  const complete = !capped && failedPages.length === 0 && readFailures === 0
  return { premises, eventsNote, complete, task0_count: task0,
    coverage: `${readable.length} of ${nonShell.length} non-shell captures read (stats.json; incidents.json for ${readable.filter(c => c.incidents).length} of ${nonShell.filter(x => x.hasIncidents).length} that have one); ${task0} uploaded at or before Task 0's census (${TASK0_AT}); ${walk.slugs.length} slugs, ${budget.calls} list calls${capped ? ', CAPPED' : ''}${failedPages.length ? `, ${failedPages.length} list page(s) failed` : ''}${readFailures ? `, ${readFailures} read(s) failed` : ''}` }
}

async function nhlLive() {
  const ids = Array.from({ length: NHL_GAMES }, (_, k) => NHL_SEASON_FIRST + NHL_STRIDE * k)
  const out = new Array(ids.length); let next = 0
  await Promise.all(Array.from({ length: 4 }, async () => {
    while (next < ids.length) {
      const i = next++, id = ids[i]
      const [p, s] = await Promise.all([getJson(`${NHL_WEB}/v1/gamecenter/${id}/play-by-play`), getJson(`${NHL_STATS}/stats/rest/en/shiftcharts?cayenneExp=gameId=${id}`)])
      out[i] = { id, pbp: p.ok ? p.json : null, shifts: s.ok ? s.json : null }
    }
  }))
  const premises = nhlPremises(out)
  return { premises, coverage: `${premises.pbp_present} of ${ids.length} play-by-play and ${premises.shifts_present} of ${ids.length} shift charts read (2025-26 regular season, ids ${ids[0]}+${NHL_STRIDE}k to ${ids[ids.length - 1]})` }
}

// ── self-test ──────────────────────────────────────────────────────────────
function selfTest() {
  let failed = 0, ran = 0
  const check = (name, ok) => { ran++; if (!ok) failed++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`) }
  const per = (text, live, h, a, minute = 90) => ({ type: 'period', text, is_live: live, home_score: h, away_score: a, minute })
  const shot = (min, home, xg, extra = {}) => ({ min, home, xg, type: 'miss', ...extra })
  const clean = { slug: 'x', id: '1', stats: { shotmap: [shot(10, true, 0.1), shot(20, false, 0.2), shot(45, true, 0.1, { added: 2 })] },
    incidents: { incidents: [per('HT', false, 0, 0, 45), per('FT', false, 1, 0)] } }
  const z = soccerPremises([clean], new Map([['1', { id: 1, event_date: '2026-07-01T19:00:00Z' }]]))
  check('a clean capture has no gap, no ET, no shared minute', z.P1.captures_with_a_gap_count === 0 && z.P2.shots_beyond_90_without_extra_marker === 0 && z.shared.minutes === 0 && z.P3.ft_beside_extra_marker === 0)
  check('a clean capture: 3 shots, all numbers, added at 45 counted', z.P1.shots === 3 && z.P1.xg_number === 3 && z.P2.added_shots_by_min['45'] === 1)
  check('a clean capture: its event row is found with a kickoff', z.P4.event_row_found === 1 && z.P4.event_date_parseable === 1)
  const dirty = { slug: 'y', id: '2', stats: { shotmap: [shot(10, true, null), shot('11', true, 0.1), shot(12, 'h', 0), shot(13, true, 0, { xg_estimated: true }),
    shot(13, false, 0.05), shot(92, true, 0.1), shot(105, true, 0.1, { added: 1 }), shot(107, false, 0.1), shot(121, true, 0.7, { sit: 'penalty' }), shot(20, true, 0.1, { added: '2' })] },
    incidents: { incidents: [per('FT', false, 1, 1), per('Extra time', true, 1, 1, 105), per('PEN', false, null, null, 120),
      { type: 'card', minute: 105, added_time: 2, is_home: true }, { type: 'goal', goal_type: 'ownGoal', minute: 13, is_home: false, sequence: [{ event: 'pass', uts: 5 }] }] } }
  const d = soccerPremises([dirty], new Map())
  check('xg null, non-number minute and non-boolean side are each a gap', d.P1.xg_null === 1 && d.P1.min_string === 1 && d.P1.home_not_boolean === 1 && d.P1.captures_with_a_gap_count === 1)
  check('a string added is not a whole number', d.P1.added_not_whole_number === 1)
  check('xg 0 and estimated-at-0 are counted', d.P1.xg_zero === 2 && d.P1.estimated === 1 && d.P1.estimated_zero === 1)
  check('105+added is counted, 106+ and 121 are counted', d.P2.shots_at_105_with_added === 1 && d.P2.shots_106_plus === 2 && d.P2.shots_over_120 === 1)
  check('an incident at 105 with added is counted by type', d.P2.incidents_at_105_with_added.card === 1)
  check('FT beside an extra-time marker, live beside finishing, a level FT', d.P3.ft_beside_extra_marker === 1 && d.P3.finishing_and_live === 1 && d.P3.ft_only_level_score_with_extra_marker === 0 && d.P3.ft_beside_shootout_marker === 1)
  check('a finishing marker with null scores is not a both-scores finish', soccerPremises([{ ...clean, incidents: { incidents: [per('FT', false, null, 1)] } }]).P3.finishing_without_both_scores === 1)
  check('FT as the only finish, level, beside ET', soccerPremises([{ ...clean, incidents: { incidents: [per('FT', false, 1, 1), per('ET', true, 1, 1, 105)] } }]).P3.ft_only_level_score_with_extra_marker === 1)
  check('a minute-92 shot in a capture with no ET marker is named', soccerPremises([{ ...clean, stats: { shotmap: [shot(92, true, 0.1)] } }]).P2.shots_beyond_90_without_extra_marker === 1)
  check('a shared minute is counted once, with its 0-xG shots', d.shared.minutes === 1 && d.shared.zero_xg_shots_by_side_of_a_same_minute_pair === 1)
  check('an own goal with no shotmap goal row is counted as none', d.P5.own_goal_incidents === 1 && d.P5.shot_goal_same_minute_none === 1)
  check('an own goal with a shotmap goal row on the credited side', soccerPremises([{ ...dirty, stats: { shotmap: [shot(13, false, 0.1, { type: 'goal' })] } }]).P5.shot_goal_same_minute_credited_side === 1)
  check('a shootout capture counts its 120+ shots by sit and clock', d.P6.captures_with_shootout_marker === 1 && d.P6.shots_at_120_plus_in_shootout_captures_by_sit['penalty@121+0'] === 1 && d.P6.penalty_sit_at_120_plus === 1)
  check('gtype and sit values are tallied, and an own-goal row names its gtype', soccerPremises([{ ...dirty, stats: { shotmap: [shot(13, false, 0.1, { type: 'goal', gtype: 'own', sit: 'regular' })] } }]).P5.own_goal_row_gtype.own === 1 && d.P5.sit_values.penalty === 1)
  check('an extra-time capture lists its period markers with minute and score shape', d.P3.extra_markers['Extra time(live)@105:level'] === 1 && d.P3.extra_markers['PEN@120:no-score'] === 1)
  check('a sub-minute key in a sequence event is found', d.T.subminute_keys['incidents:uts'] === 1 && d.T.sequence_events_with_a_time_key === 1)
  check('a missing event row is named', d.P4.event_row_found === 0 && d.P4.missing_examples[0] === 'y/2')

  const roster = [{ playerId: 1, positionCode: 'C' }, { playerId: 2, positionCode: 'D' }, { playerId: 4, positionCode: 'L' }, { playerId: 9, positionCode: 'G' }, { playerId: 3 }]
  const row = (playerId, period, s, e, typeCode = 517, gameId = 100) => ({ playerId, period, startTime: s, endTime: e, typeCode, gameId })
  const play = (typeDescKey, period, timeInPeriod, details) => ({ typeDescKey, periodDescriptor: { number: period }, timeInPeriod, details })
  const g = { id: 100, pbp: { gameState: 'OFF', gameType: 2, rosterSpots: roster, plays: [
    play('shot-on-goal', 1, '01:00', { shootingPlayerId: 1 }), play('goal', 3, '19:00', { scoringPlayerId: 1 }),
    play('missed-shot', 2, '05:00', {}), play('blocked-shot', 4, '01:00', { shootingPlayerId: 1 }), play('shot-on-goal', 1, '02:00', { shootingPlayerId: 9 }),
    play('shot-on-goal', 1, '02:00', { shootingPlayerId: 77 }), play('shot-on-goal', 1, '02:00', { shootingPlayerId: 4 }),
    play('shot-on-goal', 1, '02:00', { shootingPlayerId: 2 }), play('shot-on-goal', 1, '05:00', { shootingPlayerId: 2 }), play('missed-shot', 1, '10:00', { shootingPlayerId: 2 }), play('penalty', 1, '03:00', {}), play('goal', 1, 'xx', { scoringPlayerId: 1 })] },
    shifts: { total: 9, data: [row(2, 1, '00:00', '15:00'), row(1, 2, '01:00', '9:9x'), row(1, 1, '00:00', '10:00'), row(1, 3, '15:00', '20:00'), row(9, 1, '00:00', '20:00'), row(1, 2, 'bad', '01:00'), row(1, 2, '05:00', '04:00'), row(1, 4, '00:00', '01:00'), row(1, 1, '00:00', '00:00', 505)] } }
  const n = nhlPremises([g])
  check('NHL: a roster spot without a position is counted', n.roster_without_position === 1 && n.positions.G === 1)
  check('NHL: an uncredited attempt, a beyond-regulation one, an unclocked one', n.attempts_without_credit === 1 && n.attempts_beyond_regulation === 1 && n.attempts_without_clock === 1)
  check('NHL: credited to a goalie, to a stranger, to a skater with no shifts', n.credited_to_goalie === 1 && n.credited_not_in_roster === 1 && n.credited_skater_without_regulation_shifts === 1)
  check('NHL: an unreadable start, an unreadable end and an end before start are counted', n.shift_517_unreadable_time === 2 && n.shift_517_end_before_start === 1 && n.games_with_a_bad_517_row === 1)
  check('NHL: a non-517 row and a total mismatch are counted', n.shift_rows_by_type['505'] === 1 && n.shift_total_mismatch === 0 && nhlPremises([{ ...g, shifts: { ...g.shifts, total: 11 } }]).shift_total_mismatch === 1)
  check('NHL: the penalty without a committed player is counted', n.penalties === 1 && n.penalties_without_committed === 1)
  check('NHL: a period-4 shift is counted and kept out of T', n.shift_517_beyond_regulation === 1)
  // player 1: T = 600 (P1) + 300 (P3) = 900 s. The 01:00 shot: tau 60, 3*60 < 900, first third.
  // The 19:00 goal of P3: t = 2400+1140 = 3540, tau = 600 + 240 = 840, 3*840 >= 1800, last third.
  // player 2: T = 900. 02:00 is first; 05:00 sits ON 3*tau = T, so middle; 10:00 sits ON
  // 3*tau = 2T, so last. Both boundaries are exercised.
  check('NHL: thirds of own ice time, both boundaries exact', n.bands['720_1079']?.first === 2 && n.bands['720_1079']?.last === 2)
  check('NHL: a goalie is not a skater-game', n.regulation_toi_seconds.skater_games === 2)
  console.log(`\n${failed === 0 ? 'OK' : 'FAILED'} — ${ran - failed}/${ran} self-tests`)
  return failed
}

async function main() {
  if (process.argv.includes('--self-test')) { process.exitCode = selfTest() ? 1 : 0; return }
  const ranAt = new Date().toISOString()
  const lab = await import(pathToFileURL(process.env.LAB_PROBE_PATH || '/tmp/lab/scripts/probe-empowerment.mjs').href)
  const [soccer, nhl] = await Promise.all([soccerLive(lab), nhlLive()])
  const art = { cc_cmd: 'field-laboratory docs/CC-CMD-2026-10-15-empowerment-metrics.md (Tasks 1-3, premise pass)', ran_at: ranAt,
    relay: RELAY, r2_walk: `field-laboratory scripts/probe-empowerment.mjs at ${process.env.LAB_SHA || 'unknown'}`, run_id: process.env.GITHUB_RUN_ID || null,
    soccer: { coverage: soccer.coverage, census_complete: soccer.complete,
      task0_check: `${soccer.task0_count} non-shell captures uploaded at or before ${TASK0_AT}; Task 0's census counted 786`, kickoff_rows: soccer.eventsNote, ...soccer.premises },
    nhl: { coverage: nhl.coverage, ...nhl.premises } }
  mkdirSync('outbox', { recursive: true })
  writeFileSync(OUT, JSON.stringify(art, null, 2) + '\n')
  console.log(`SOCCER: ${soccer.coverage}`)
  console.log(`  kickoff: ${soccer.eventsNote}`)
  console.log(`NHL: ${nhl.coverage}`)
  console.log(`wrote ${OUT}`)
  process.exitCode = soccer.complete && nhl.premises.pbp_present === NHL_GAMES && nhl.premises.shifts_present === NHL_GAMES ? 0 : 1
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main()
