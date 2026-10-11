#!/usr/bin/env node
// docs/CC-CMD-2026-10-10-bsd-form-into-forecaster.md — Task 1, and ONLY Task 1.
//
// The document's own stop condition: "If `league_id` does not filter, STOP at
// Task 1 and report. Everything downstream assumes per-competition scope."
//
// So this answers two questions and ships nothing:
//   1. WHAT WINDOW does the form payload describe? The surface probe recorded
//      key NAMES only — from_date, to_date, requested and matches exist, and
//      their VALUES appear nowhere in the artifact. The span is named, not
//      measured.
//   2. DOES league_id FILTER, OR ONLY LABEL? A parameter accepted and silently
//      ignored is this vendor's documented behaviour:
//      scripts/bsd-tennis-date-probe.mjs found `date`, `match_date`,
//      `start_date`/`end_date` and `day` all returning HTTP 200 with the SAME
//      unfiltered page.
//
// THREE CONTROLS, not one. The document asks for "a DIFFERENT league_id"; one
// comparison cannot tell a filter from a coincidence:
//   A  no league_id at all   — what the default call actually returns
//   B  league_id=1  (EPL)    — the club's own competition
//   C  league_id=7  (UCL)    — a real competition it may not be in
//   D  league_id=99999999    — an id that cannot exist. If D equals A, the
//                              parameter is inert and B-vs-C proves nothing.
//
// Control D is the one that makes this falsifiable. Without it, "B and C differ"
// could still be two labels on one unfiltered page.

import { writeFileSync, mkdirSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

export const BASE = 'https://sports.bzzoiro.com'
export const CALL_BUDGET = 8
export const TEAM_ID = 4784          // the EPL club the surface probe sampled
export const LEAGUE_EPL = 1          // src/index.js V2_LEAGUES: epl bsdLeagueId 1
export const LEAGUE_UCL = 7          // ucl bsdLeagueId 7
export const LEAGUE_IMPOSSIBLE = 99999999

// A stable fingerprint of the numbers a form payload carries. Two calls that
// agree here returned the same page whatever their parameters said.
export const fingerprint = (body) => {
  if (!body || typeof body !== 'object') return null
  const pick = (o) => {
    if (o === null || o === undefined) return null
    if (typeof o !== 'object') return o
    const out = {}
    for (const k of Object.keys(o).sort()) {
      const v = o[k]
      if (v === null || typeof v !== 'object') out[k] = v
    }
    return out
  }
  // THE ECHOED PARAMETER IS NOT DATA. `league_id` comes back exactly as sent,
  // so including it made every fingerprint differ from every other one and the
  // control vacuous — the first real run reported FILTERS on four payloads
  // whose only difference was the parameter echo. Compare the ANSWER, never
  // the question.
  return JSON.stringify({
    team_id: body.team_id ?? null,
    requested: body.requested ?? null,
    matches: body.matches ?? null,
    from_date: body.from_date ?? null,
    to_date: body.to_date ?? null,
    overall: pick(body.overall),
    home: pick(body.home),
    away: pick(body.away),
    vs_stronger: pick(body.vs_stronger),
    vs_weaker: pick(body.vs_weaker),
  })
}

// The verdict is derived, never written by hand.
export const classify = ({ aFp, bFp, cFp, dFp, statuses = [], aMatches = null, bMatches = null, cMatches = null, dMatches = null }) => {
  // A REFUSED CALL IS NOT A MEASUREMENT, and it must say WHY. Four 401s
  // fingerprint identically, and "all four agree" is one keystroke from
  // reading as "the parameter does nothing".
  const auth = statuses.filter(s => s === 401 || s === 403)
  if (auth.length) return { verdict: 'UNMEASURED', reason: `${auth.length} of ${statuses.length} calls were refused with ${[...new Set(auth)].join('/')} — an auth failure, not a finding` }
  if (!aFp || !bFp || !cFp) return { verdict: 'UNMEASURED', reason: 'one or more calls did not return a body' }

  // A THIRD OUTCOME THE DOCUMENT DID NOT ANTICIPATE, and the one that actually
  // happened: the parameter is accepted, it changes the answer, and every
  // value empties it — including the club's OWN league and an id that cannot
  // exist. That is neither filtering nor labelling. It is a parameter that
  // breaks the query, and it fires the document's stop condition just as
  // surely, because a per-competition scope cannot be built on it.
  const emptied = (m) => m === 0
  if (emptied(bMatches) && emptied(cMatches) && (dMatches === null || emptied(dMatches)) && !emptied(aMatches))
    return {
      verdict: 'ACCEPTED-BUT-EMPTIES',
      reason: `no league_id returns ${aMatches} matches; league_id=1 (the club's own competition) returns ${bMatches}, `
            + `league_id=7 returns ${cMatches}, and an impossible id returns ${dMatches}. The parameter is accepted and `
            + 'empties the result for every value. It does not filter.',
    }
  if (dFp !== null && dFp === aFp)
    return {
      verdict: 'LABELS-NOT-FILTERS',
      reason: 'an impossible league_id returned the SAME answer as no league_id at all, so the parameter is inert. '
            + 'Any difference between two real league_ids would be something other than filtering.',
    }
  if (bFp === cFp)
    return {
      verdict: 'LABELS-NOT-FILTERS',
      reason: 'two different real league_ids returned identical numbers',
    }
  return {
    verdict: 'FILTERS',
    reason: 'two different real league_ids returned different numbers, an impossible id did not reproduce the default page, '
          + 'and a real league_id returned a non-zero match count',
  }
}

// xG field names inside the aggregate blocks — Task 1 asks for these by name.
export const xgFieldsIn = (block) => {
  if (!block || typeof block !== 'object') return []
  return Object.keys(block).filter(k => /xg|expected_goal/i.test(k)).sort()
}

const get = async (url, token, calls) => {
  calls.n += 1
  try {
    const r = await fetch(url, {
      // `Token`, not `Bearer`. src/index.js authenticates every BSD call as
      // `Authorization: Token ${env.BSD_API_TOKEN}` (:2437, :3056, :4468).
      // Guessing `Bearer` returned 401 on all four calls of the first run —
      // which the classifier correctly refused to read as a verdict.
      headers: { 'Authorization': `Token ${token}`, 'Accept': 'application/json' },
      signal: AbortSignal.timeout(25000),
    })
    const text = await r.text()
    let body = null
    try { body = JSON.parse(text) } catch (_) {}
    return { ok: r.ok, status: r.status, body, bytes: text.length }
  } catch (e) { return { ok: false, status: 0, error: String(e && e.message || e), body: null } }
}

const main = async () => {
  const token = process.env.BSD_API_TOKEN
  if (!token) {
    console.error('FAIL: BSD_API_TOKEN absent — every answer would be UNKNOWN, not empty.')
    process.exit(1)
  }
  const started = new Date().toISOString()
  const calls = { n: 0 }
  const url = (lid) => `${BASE}/api/v2/teams/${TEAM_ID}/form/` + (lid === null ? '' : `?league_id=${lid}`)

  const A = await get(url(null), token, calls)
  const B = await get(url(LEAGUE_EPL), token, calls)
  const C = await get(url(LEAGUE_UCL), token, calls)
  const D = await get(url(LEAGUE_IMPOSSIBLE), token, calls)

  const fp = { aFp: fingerprint(A.body), bFp: fingerprint(B.body), cFp: fingerprint(C.body), dFp: fingerprint(D.body) }
  const cls = classify({
    ...fp,
    statuses: [A.status, B.status, C.status, D.status],
    aMatches: A.body?.matches ?? null, bMatches: B.body?.matches ?? null,
    cMatches: C.body?.matches ?? null, dMatches: D.body?.matches ?? null,
  })

  // THE WINDOW, read rather than assumed.
  const windowOf = (r, label) => ({
    label,
    status: r.status,
    requested: r.body?.requested ?? null,
    matches: r.body?.matches ?? null,
    league_id: r.body?.league_id ?? null,
    from_date: r.body?.from_date ?? null,
    to_date: r.body?.to_date ?? null,
    spanDays: (() => {
      const f = r.body?.from_date, t = r.body?.to_date
      if (!f || !t) return null
      const d1 = new Date(f), d2 = new Date(t)
      if (isNaN(d1) || isNaN(d2)) return null
      return Math.round((d2 - d1) / 86400000)
    })(),
  })

  const out = {
    cc_cmd: 'docs/CC-CMD-2026-10-10-bsd-form-into-forecaster.md',
    task: 'Task 1 only — nothing ships from this file',
    started_at: started,
    callBudget: CALL_BUDGET,
    callsMade: calls.n,
    teamId: TEAM_ID,
    calls: {
      A_no_league_id: windowOf(A, 'no league_id'),
      B_league_1_epl: windowOf(B, 'league_id=1 (EPL)'),
      C_league_7_ucl: windowOf(C, 'league_id=7 (UCL)'),
      D_league_impossible: windowOf(D, `league_id=${LEAGUE_IMPOSSIBLE} (cannot exist)`),
    },
    fingerprintsEqual: {
      'A==B': fp.aFp === fp.bFp,
      'A==D': fp.aFp === fp.dFp,
      'B==C': fp.bFp === fp.cFp,
    },
    league_id_verdict: cls.verdict,
    league_id_reason: cls.reason,
    // Task 1 also asks for the xG field names inside `overall`.
    xgFields: {
      overall: xgFieldsIn(A.body?.overall),
      home: xgFieldsIn(A.body?.home),
      away: xgFieldsIn(A.body?.away),
      vs_stronger: xgFieldsIn(A.body?.vs_stronger),
      vs_weaker: xgFieldsIn(A.body?.vs_weaker),
    },
    overallKeysVerbatim: A.body?.overall && typeof A.body.overall === 'object' ? Object.keys(A.body.overall).sort() : [],
    overallVerbatim: A.body?.overall ?? null,
    topLevelKeysVerbatim: A.body && typeof A.body === 'object' ? Object.keys(A.body) : [],
    coverage: `ONE club (team ${TEAM_ID}), FOUR calls. One club is not the vendor's policy — a per-competition `
            + `claim for other clubs or other leagues is not established by this run.`,
  }

  mkdirSync('outbox', { recursive: true })
  const ts = started.replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z')
  writeFileSync(`outbox/bsd-form-probe-${ts}.json`, JSON.stringify(out, null, 2))
  writeFileSync('outbox/bsd-form-probe-latest.json', JSON.stringify(out, null, 2))
  console.log(`wrote outbox/bsd-form-probe-${ts}.json`)
  console.log(`callsMade ${calls.n} of ${CALL_BUDGET}`)
  console.log(`league_id: ${cls.verdict} — ${cls.reason}`)
  console.log(`window: requested=${out.calls.A_no_league_id.requested} matches=${out.calls.A_no_league_id.matches} `
            + `from=${out.calls.A_no_league_id.from_date} to=${out.calls.A_no_league_id.to_date} spanDays=${out.calls.A_no_league_id.spanDays}`)
  console.log(`xG fields in overall: ${JSON.stringify(out.xgFields.overall)}`)
  console.log(out.coverage)
}

const _entryHref = process.argv[1] ? pathToFileURL(process.argv[1]).href : null
const _isEntry = _entryHref !== null && import.meta.url === _entryHref

const selfTest = () => {
  let pass = 0, fail = 0
  const t = (n, c) => { if (c) { pass++; console.log(`PASS  ${n}`) } else { fail++; console.log(`FAIL  ${n}`) } }

  const base = { team_id: 1, requested: 10, matches: 8, league_id: 1, from_date: '2026-08-01', to_date: '2026-10-10',
                 overall: { ppg: 2.1, xg_for: 1.8 }, home: { ppg: 2.4 }, away: { ppg: 1.8 }, vs_stronger: { ppg: 1.1 }, vs_weaker: { ppg: 2.6 } }

  t('two identical payloads fingerprint identically',
    fingerprint(base) === fingerprint(JSON.parse(JSON.stringify(base))))
  t('a changed number changes the fingerprint',
    fingerprint(base) !== fingerprint({ ...base, overall: { ppg: 2.2, xg_for: 1.8 } }))
  t('key ORDER does not change the fingerprint',
    fingerprint({ ...base, overall: { xg_for: 1.8, ppg: 2.1 } }) === fingerprint(base))
  t('a null body fingerprints to null rather than to a string',
    fingerprint(null) === null && fingerprint(undefined) === null)

  t('AN IMPOSSIBLE league_id REPRODUCING THE DEFAULT PAGE MEANS THE PARAMETER IS INERT',
    classify({ aFp: 'X', bFp: 'Y', cFp: 'Z', dFp: 'X' }).verdict === 'LABELS-NOT-FILTERS')
  t('...and that verdict wins even when the two real leagues differ',
    classify({ aFp: 'X', bFp: 'Y', cFp: 'Z', dFp: 'X' }).reason.includes('inert'))
  t('two real league_ids returning identical numbers is LABELS-NOT-FILTERS',
    classify({ aFp: 'X', bFp: 'Y', cFp: 'Y', dFp: 'Q' }).verdict === 'LABELS-NOT-FILTERS')
  t('different real leagues plus a non-reproducing impossible id is FILTERS',
    classify({ aFp: 'X', bFp: 'Y', cFp: 'Z', dFp: 'Q' }).verdict === 'FILTERS')
  t('a missing call yields UNMEASURED, never a filter verdict',
    classify({ aFp: null, bFp: 'Y', cFp: 'Z', dFp: 'Q' }).verdict === 'UNMEASURED')
  t('FOUR REFUSED CALLS ARE AN AUTH FAILURE, NOT "the parameter does nothing"',
    (() => {
      const c = classify({ aFp: null, bFp: null, cFp: null, dFp: null, statuses: [401, 401, 401, 401] })
      return c.verdict === 'UNMEASURED' && /auth failure/.test(c.reason) && /401/.test(c.reason)
    })())
  t('a 403 is named the same way',
    /403/.test(classify({ aFp: 'X', bFp: 'Y', cFp: 'Z', dFp: 'Q', statuses: [403, 200, 200, 200] }).reason))
  t('all-200 calls still reach a real verdict',
    classify({ aFp: 'X', bFp: 'Y', cFp: 'Z', dFp: 'Q', statuses: [200, 200, 200, 200],
               aMatches: 10, bMatches: 4, cMatches: 6, dMatches: 0 }).verdict === 'FILTERS')

  // THE REGRESSION. The echoed parameter made every fingerprint differ, so the
  // control could not fail and the first real run reported FILTERS over four
  // payloads that all said matches: 0.
  t('the echoed league_id is EXCLUDED from the fingerprint',
    fingerprint({ ...base, league_id: 1 }) === fingerprint({ ...base, league_id: 99999999 }))
  t('a parameter that empties the result for EVERY value is not FILTERS',
    (() => {
      const c = classify({ aFp: 'A', bFp: 'B', cFp: 'C', dFp: 'D', statuses: [200, 200, 200, 200],
                           aMatches: 10, bMatches: 0, cMatches: 0, dMatches: 0 })
      return c.verdict === 'ACCEPTED-BUT-EMPTIES' && /does not filter/.test(c.reason)
    })())
  t("...and that holds even though the club's OWN league was the one asked for",
    classify({ aFp: 'A', bFp: 'B', cFp: 'C', dFp: 'D', statuses: [200, 200, 200, 200],
               aMatches: 10, bMatches: 0, cMatches: 0, dMatches: 0 }).reason.includes("club's own competition"))
  t('a genuine filter — non-zero counts that differ — still reads FILTERS',
    classify({ aFp: 'A', bFp: 'B', cFp: 'C', dFp: 'D', statuses: [200, 200, 200, 200],
               aMatches: 10, bMatches: 6, cMatches: 4, dMatches: 0 }).verdict === 'FILTERS')

  t('xG field names are found by name, not assumed',
    (() => {
      const f = xgFieldsIn({ ppg: 1, xg_for: 2, expected_goals_against: 3, shots: 4 })
      return f.length === 2 && f.includes('xg_for') && f.includes('expected_goals_against')
    })())
  t('a block with no xG field reports an EMPTY list rather than a default name',
    xgFieldsIn({ ppg: 1 }).length === 0)
  t('an absent block reports empty rather than throwing',
    xgFieldsIn(null).length === 0 && xgFieldsIn(undefined).length === 0)

  console.log(`\n${pass}/${pass + fail} checks passed`)
  if (fail) process.exit(1)
}

if (_isEntry) {
  if (process.argv.includes('--self-test')) selfTest()
  else main().catch(e => { console.error(String(e && e.stack || e)); process.exit(1) })
}
