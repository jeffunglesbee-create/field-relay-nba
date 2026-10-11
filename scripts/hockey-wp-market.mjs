#!/usr/bin/env node
// docs/CC-CMD-2026-10-10-nhl-win-probability-from-xg.md — Task 3's baseline.
//
// THE GATE needs a de-vigged market probability per historical game. Three
// sources were eliminated by measurement first:
//
//   Odds API historical   — ceiling REACHED 2026-10-07; credits need approval.
//   field-archive (D1)    — no odds column in regular_season_games or
//                           postseason_games.
//   ESPN scoreboard       — carries no odds for a past game: 0 of 40 games
//                           across three 2024 dates.
//
// ESPN's SUMMARY pickcenter does carry one. But the first three games measured
// de-vig to an overround of 0.818 / 0.822 / 0.819 — BELOW 1, which no
// two-sided book offers. A deficit that size and that stable is a missing
// third leg: Unibet quotes hockey as a 3-way REGULATION market (home / draw /
// away), and wp-resolver.js:511's two-way normalisation over a three-way
// market does not produce P(home wins the game). It produces
// P(home wins in regulation | not a draw), which is a different number
// wearing the same name.
//
// So this script MEASURES the overround per provider per season before
// anything is trusted, and classifies rather than assumes. A market whose
// shape cannot be established is 'unusable' — not silently reconstructed.

import { writeFileSync, mkdirSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

export const ESPN_SB  = 'https://site.api.espn.com/apis/site/v2/sports/hockey/nhl/scoreboard'
export const ESPN_SUM = 'https://site.api.espn.com/apis/site/v2/sports/hockey/nhl/summary'

// Lifted verbatim from src/wp-resolver.js:511 — the baseline must be the same
// arithmetic production serves, not a second implementation free to drift.
export const impliedFromAmerican = (price) =>
  !Number.isFinite(price) ? null
    : price > 0 ? 100 / (price + 100) : Math.abs(price) / (Math.abs(price) + 100)

export const overround = (homePrice, awayPrice) => {
  const h = impliedFromAmerican(homePrice), a = impliedFromAmerican(awayPrice)
  if (h === null || a === null) return null
  return h + a
}

// Thresholds are NOT picked by preference. --census reports the distribution
// first; these are set from it and the commit that sets them cites the numbers.
export const TWO_WAY_MIN   = 1.00   // a real two-sided book always overrounds
export const THREE_WAY_MAX = 0.95   // a missing draw leg costs far more than 5%

export const classifyMarket = (homePrice, awayPrice) => {
  const or = overround(homePrice, awayPrice)
  if (or === null) return { kind: 'absent', overround: null }
  if (or >= TWO_WAY_MIN)   return { kind: '2way',  overround: or }
  if (or <= THREE_WAY_MAX) return { kind: '3way',  overround: or }
  return { kind: 'ambiguous', overround: or }   // never guessed
}

// For a 3-way market the draw leg is missing from ESPN's two-team structure.
// Recovering P(home wins the GAME) needs two constants, and BOTH are measured
// from MoneyPuck rather than assumed (see scripts/hockey-wp-train.mjs):
//   tieRate     — share of games tied after regulation
//   otHomeShare — share of those won by the home side
// With k the true overround, implD/k = tieRate, so k = (implH+implA)/(1-tieRate).
export const reconstruct3Way = (homePrice, awayPrice, tieRate, otHomeShare) => {
  const h = impliedFromAmerican(homePrice), a = impliedFromAmerican(awayPrice)
  if (h === null || a === null) return null
  if (!(tieRate > 0 && tieRate < 1)) return null
  if (!(otHomeShare >= 0 && otHomeShare <= 1)) return null
  const k = (h + a) / (1 - tieRate)
  const pHomeReg = h / k, pAwayReg = a / k
  // pDraw is 1 - (h+a)/k, and k was DEFINED as (h+a)/(1-tieRate), so this is
  // identically tieRate. A `if (pDraw < 0) return null` guard stood here and
  // was removed rather than kept: it can never fire, and a check that cannot
  // fail is indistinguishable from one that is aimed at nothing (Rule 90).
  // Its own test is what exposed it.
  const pDraw = tieRate
  //
  // Writing it out makes the reconstruction's content plain:
  //   pHome = (1 - tieRate) * h/(h+a) + tieRate * otHomeShare
  // It is the TWO-WAY ratio shrunk toward otHomeShare. So it adds no
  // information the raw prices did not carry — it only recalibrates them.
  // Game ORDERING is therefore identical to the naive two-way de-vig, which
  // matters for how Task 3's result may be read: the reconstruction can change
  // Brier and reliability, and cannot change discrimination.
  return {
    pHome: pHomeReg + pDraw * otHomeShare,
    pHomeReg, pAwayReg, pDraw, k
  }
}

export const marketProb = (homePrice, awayPrice, tieRate, otHomeShare) => {
  const c = classifyMarket(homePrice, awayPrice)
  if (c.kind === '2way') {
    const h = impliedFromAmerican(homePrice), a = impliedFromAmerican(awayPrice)
    return { ...c, pHome: Math.round((h / (h + a)) * 1000) / 1000 }
  }
  if (c.kind === '3way') {
    const r = reconstruct3Way(homePrice, awayPrice, tieRate, otHomeShare)
    return r ? { ...c, pHome: Math.round(r.pHome * 1000) / 1000, detail: r }
             : { kind: 'unusable', overround: c.overround, pHome: null }
  }
  return { ...c, pHome: null }   // absent / ambiguous carry no number
}

// ESPN and MoneyPuck do not agree on team codes. The disagreement is small
// and enumerable, and the JOIN REPORT verifies the map rather than trusting
// it: scripts/hockey-wp-train.mjs prints codes_only_in_espn after mapping, and
// a non-empty list is a finding. A two-letter normalisation was rejected
// because NYI and NYR both collapse to NY.
export const ESPN_TO_MP = {
  NJ: 'NJD', LA: 'LAK', SJ: 'SJS', TB: 'TBL', UTAH: 'UTA',
  // 4 Nations Face-Off entries appear in the NHL scoreboard and are not NHL
  // clubs. Mapped to themselves so they survive into the artifact and fail to
  // join, rather than being silently dropped here.
  USA: 'USA', CAN: 'CAN', SWE: 'SWE', FIN: 'FIN'
}

export const normalizeTeam = (code) => code === null || code === undefined ? null : (ESPN_TO_MP[code] ?? code)

const getJson = async (url, calls) => {
  calls.n += 1
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(25000) })
    if (!r.ok) return { ok: false, status: r.status }
    return { ok: true, status: r.status, body: await r.json() }
  } catch (e) { return { ok: false, status: 0, error: String(e && e.message || e) } }
}

export const datesInRange = (fromIso, toIso) => {
  const out = []
  for (let d = new Date(fromIso + 'T00:00:00Z'); d <= new Date(toIso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + 1))
    out.push(d.toISOString().slice(0, 10).replace(/-/g, ''))
  return out
}

export const outcomeOf = (ev) => {
  const comp = ev.competitions?.[0] || {}
  if (!comp.status?.type?.completed) return null
  const cs = comp.competitors || []
  const home = cs.find(c => c.homeAway === 'home'), away = cs.find(c => c.homeAway === 'away')
  if (!home || !away) return null
  // Number(null) is 0 and Number('') is 0, both FINITE — so a finiteness check
  // alone turned a completed game with absent scores into a real 0-0 result
  // with homeWon = 0. Measured by this file's own self-test before it ran once
  // against live data. Absence is a sibling of the value, not the value zero.
  const raw = (v) => (v === null || v === undefined || v === '' ? null : Number(v))
  const hs = raw(home.score), as = raw(away.score)
  if (hs === null || as === null || !Number.isFinite(hs) || !Number.isFinite(as)) return null
  if (hs === as) return null   // a completed NHL game is never tied
  return {
    espnId: ev.id, date: (ev.date || '').slice(0, 10),
    home: normalizeTeam(home.team?.abbreviation ?? null),
    away: normalizeTeam(away.team?.abbreviation ?? null),
    homeRaw: home.team?.abbreviation ?? null, awayRaw: away.team?.abbreviation ?? null,
    homeScore: hs, awayScore: as, homeWon: hs > as ? 1 : 0
  }
}

const main = async () => {
  const args = process.argv.slice(2)
  const argOf = (k, d) => { const a = args.find(x => x.startsWith(`--${k}=`)); return a ? a.slice(k.length + 3) : d }
  const census = args.includes('--census')
  const from = argOf('from', '2024-10-08')
  const to   = argOf('to',   census ? '2024-10-12' : '2025-04-17')
  const perDateCap = Number(argOf('per-date', census ? '6' : '999'))
  const budget = Number(argOf('budget', census ? '60' : '2000'))
  const concurrency = Number(argOf('concurrency', '6'))

  const calls = { n: 0 }
  const started = new Date().toISOString()
  // A census needs dates ACROSS seasons, not a contiguous range: the question
  // is whether any provider ever quotes two-way, and a single week cannot
  // answer it. --dates takes an explicit list for that.
  const datesArg = argOf('dates', '')
  const dates = datesArg ? datesArg.split(',').map(x => x.trim()).filter(Boolean)
                         : datesInRange(from, to)
  const games = []
  const providerStats = {}
  let truncated = false

  for (const d of dates) {
    if (calls.n >= budget) { truncated = true; break }
    const sb = await getJson(`${ESPN_SB}?dates=${d}`, calls)
    if (!sb.ok) continue
    const evs = (sb.body.events || []).slice(0, perDateCap)
    const outcomes = evs.map(outcomeOf).filter(Boolean)

    for (let i = 0; i < outcomes.length; i += concurrency) {
      if (calls.n >= budget) { truncated = true; break }
      const slice = outcomes.slice(i, i + concurrency)
      const sums = await Promise.all(slice.map(o => getJson(`${ESPN_SUM}?event=${o.espnId}`, calls)))
      slice.forEach((o, j) => {
        const s = sums[j]
        // WITHOUT THIS STATUS A FAILED FETCH READS AS "NO ODDS". The first
        // full-season build reported 0 of 1317 games carrying a provider and
        // the number was unreadable: nothing in the artifact distinguished
        // ESPN serving no pickcenter from this script failing to ask. The
        // season boundary turned out to be the real cause, but it was found by
        // comparing two artifacts, not by reading one — which is the defect.
        const row = { ...o, summaryStatus: s.status ?? 0, summaryOk: !!s.ok, providers: [] }
        if (s.ok) {
          for (const pc of (s.body.pickcenter || [])) {
            const name = pc?.provider?.name ?? 'unknown'
            const hp = pc?.homeTeamOdds?.moneyLine, ap = pc?.awayTeamOdds?.moneyLine
            const c = classifyMarket(hp, ap)
            row.providers.push({ provider: name, homeMoneyLine: hp ?? null, awayMoneyLine: ap ?? null, ...c })
            const st = providerStats[name] || (providerStats[name] = { n: 0, kinds: {}, overrounds: [] })
            st.n += 1
            st.kinds[c.kind] = (st.kinds[c.kind] || 0) + 1
            if (c.overround !== null) st.overrounds.push(+c.overround.toFixed(4))
          }
        }
        games.push(row)
      })
    }
  }

  for (const [, st] of Object.entries(providerStats)) {
    const o = st.overrounds.slice().sort((a, b) => a - b)
    st.overround_min = o[0] ?? null
    st.overround_median = o.length ? o[Math.floor(o.length / 2)] : null
    st.overround_max = o[o.length - 1] ?? null
    st.overround_mean = o.length ? +(o.reduce((a, b) => a + b, 0) / o.length).toFixed(4) : null
    delete st.overrounds
  }

  const withAny = games.filter(g => g.providers.length > 0).length
  const fetchFailed = games.filter(g => g.summaryOk === false).length
  const servedNoOdds = games.filter(g => g.summaryOk === true && g.providers.length === 0).length
  const out = {
    cc_cmd: 'docs/CC-CMD-2026-10-10-nhl-win-probability-from-xg.md',
    purpose: census ? 'census: establish the market shape per provider before trusting any de-vig'
                    : 'build: the de-vigged market baseline for Task 3',
    started_at: started, finished_at: null,
    range: datesArg ? { explicit_dates: dates } : { from, to, dates: dates.length },
    callsMade: null, callBudget: budget, truncated,
    thresholds: { TWO_WAY_MIN, THREE_WAY_MAX },
    games_total: games.length,
    games_with_any_provider: withAny,
    providerStats,
    games
  }
  out.callsMade = calls.n
  out.finished_at = new Date().toISOString()
  // Rule 91: the denominator prints where the result is read.
  out.fetch_failed = fetchFailed
  out.served_no_odds = servedNoOdds
  out.coverage = `${withAny} of ${games.length} completed games carry a pickcenter provider — ` +
    `${servedNoOdds} were served and carried none, ${fetchFailed} could not be fetched at all; ` +
    `${dates.length} dates requested, ${truncated ? 'TRUNCATED at the call budget' : 'all walked'}`

  mkdirSync('outbox', { recursive: true })
  const ts = started.replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z')
  const file = `outbox/hockey-wp-market-${census ? 'census' : 'baseline'}-${ts}.json`
  writeFileSync(file, JSON.stringify(out, null, 2))
  writeFileSync(`outbox/hockey-wp-market-${census ? 'census' : 'baseline'}-latest.json`, JSON.stringify(out, null, 2))
  console.log(`wrote ${file}`)
  console.log(out.coverage)
  console.log(`callsMade ${out.callsMade} of ${budget}`)
  for (const [name, st] of Object.entries(providerStats))
    console.log(`  ${name}: n=${st.n} kinds=${JSON.stringify(st.kinds)} overround min/med/max=${st.overround_min}/${st.overround_median}/${st.overround_max}`)
}

const _entryHref = process.argv[1] ? pathToFileURL(process.argv[1]).href : null
const _isEntry = _entryHref !== null && import.meta.url === _entryHref

const selfTest = () => {
  let pass = 0, fail = 0
  const t = (n, c) => { if (c) { pass++; console.log(`PASS  ${n}`) } else { fail++; console.log(`FAIL  ${n}`) } }

  t('a -110/-110 pair is a two-way market and de-vigs to 0.5',
    (() => { const m = marketProb(-110, -110, 0.23, 0.55); return m.kind === '2way' && m.pHome === 0.5 })())
  t('a real two-sided book overrounds above 1',
    overround(-110, -110) > 1)
  t('the measured ESPN pair is classified 3way, NOT de-vigged two ways',
    classifyMarket(102, 210).kind === '3way')
  t('the measured ESPN overround reproduces 0.8176',
    Math.abs(overround(102, 210) - 0.8176) < 0.0005)
  t('a 3way reconstruction sums its three legs to one',
    (() => { const r = reconstruct3Way(102, 210, 0.23, 0.55); return Math.abs(r.pHomeReg + r.pAwayReg + r.pDraw - 1) < 1e-9 })())
  t('the reconstructed draw leg equals the measured tie rate',
    (() => { const r = reconstruct3Way(102, 210, 0.23, 0.55); return Math.abs(r.pDraw - 0.23) < 1e-9 })())
  t('a higher home price yields a lower home probability',
    marketProb(102, 210, 0.23, 0.55).pHome > marketProb(220, -104, 0.23, 0.55).pHome)
  t('an ambiguous overround carries NO number rather than a guess',
    (() => { const m = marketProb(-105, 108, 0.23, 0.55); return m.kind === 'ambiguous' && m.pHome === null })())
  t('an absent price is absent, not 0.5 (Rule 99)',
    (() => { const m = marketProb(null, -110, 0.23, 0.55); return m.kind === 'absent' && m.pHome === null })())
  t('reconstruction refuses an out-of-range tie rate rather than returning a number',
    reconstruct3Way(102, 210, 0, 0.55) === null && reconstruct3Way(102, 210, 1.2, 0.55) === null)
  t('reconstruction refuses an out-of-range OT share',
    reconstruct3Way(102, 210, 0.23, 1.4) === null)
  t('the draw leg is identically the tie rate, for any prices',
    (() => {
      const a = reconstruct3Way(-400, 300, 0.99, 0.5), b = reconstruct3Way(102, 210, 0.07, 0.5)
      return Math.abs(a.pDraw - 0.99) < 1e-12 && Math.abs(b.pDraw - 0.07) < 1e-12
    })())
  t('the reconstruction equals the two-way ratio shrunk toward otHomeShare',
    (() => {
      const h = impliedFromAmerican(102), a = impliedFromAmerican(210)
      const closed = (1 - 0.23) * (h / (h + a)) + 0.23 * 0.55
      return Math.abs(reconstruct3Way(102, 210, 0.23, 0.55).pHome - closed) < 1e-12
    })())
  t('reconstruction preserves the two-way ORDERING of two games',
    (() => {
      const r = (hp, ap) => reconstruct3Way(hp, ap, 0.23, 0.55).pHome
      const naive = (hp, ap) => { const h = impliedFromAmerican(hp), a = impliedFromAmerican(ap); return h / (h + a) }
      return (r(102, 210) > r(220, -104)) === (naive(102, 210) > naive(220, -104))
    })())
  t('datesInRange is inclusive at both ends',
    (() => { const d = datesInRange('2024-10-08', '2024-10-10'); return d.length === 3 && d[0] === '20241008' && d[2] === '20241010' })())
  t('an unfinished game yields no outcome rather than a 0',
    outcomeOf({ id: '1', competitions: [{ status: { type: { completed: false } }, competitors: [] }] }) === null)
  t('ESPN NJ maps to MoneyPuck NJD, and an already-three-letter code is left alone',
    normalizeTeam('NJ') === 'NJD' && normalizeTeam('CAR') === 'CAR')
  t('the New York pair survive normalisation as distinct codes',
    normalizeTeam('NYI') !== normalizeTeam('NYR'))
  t('a 4 Nations entry maps to itself rather than being dropped',
    normalizeTeam('SWE') === 'SWE')
  t('an absent code normalises to null, not to a string',
    normalizeTeam(null) === null && normalizeTeam(undefined) === null)
  t('outcomeOf applies the crosswalk and keeps the raw code beside it',
    (() => {
      const o = outcomeOf({ id: '1', competitions: [{ status: { type: { completed: true } },
        competitors: [{ homeAway: 'home', score: '3', team: { abbreviation: 'NJ' } },
                      { homeAway: 'away', score: '1', team: { abbreviation: 'LA' } }] }] })
      return o.home === 'NJD' && o.homeRaw === 'NJ' && o.away === 'LAK' && o.awayRaw === 'LA'
    })())

  t('a completed game yields homeWon from the scores',
    (() => {
      const o = outcomeOf({ id: '9', date: '2024-10-08T23:00Z', competitions: [{ status: { type: { completed: true } },
        competitors: [{ homeAway: 'home', score: '4', team: { abbreviation: 'CAR' } }, { homeAway: 'away', score: '1', team: { abbreviation: 'TOR' } }] }] })
      return o.homeWon === 1 && o.home === 'CAR' && o.away === 'TOR'
    })())
  t('a completed game with no score yields no outcome',
    outcomeOf({ id: '9', competitions: [{ status: { type: { completed: true } },
      competitors: [{ homeAway: 'home', score: null }, { homeAway: 'away', score: null }] }] }) === null)

  console.log(`\n${pass}/${pass + fail} checks passed`)
  if (fail) process.exit(1)
}

if (_isEntry) {
  if (args_has_self_test()) selfTest()
  else main().catch(e => { console.error(e); process.exit(1) })
}
function args_has_self_test() { return process.argv.includes('--self-test') }
