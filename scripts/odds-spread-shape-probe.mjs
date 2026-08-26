#!/usr/bin/env node
// Does the Odds API return a `price` beside `point` on spread outcomes?
//
// CC-CMD-2026-08-25-spread-price-capture asks the relay to store
// `spread.homePrice` / `spread.awayPrice` because extractOddsForGame reads
// `o.point` and discards `o.price`. That sentence is inherited (Rule 72) and
// the CC-CMD's own step 1 says: probe first, do not write from this document.
//
// SECOND QUESTION, and it is the one that may matter more. A Drive doc,
// "FIELD — 'Gumbo' Odds API Savings Analysis", May 26 2026, states of MLB
// spreads: "Always -1.5 in baseball. Tells FIELD almost nothing about
// competitive balance. DEAD WEIGHT for MLB." If that holds, then the
// laboratory's favouriteAgreement is comparing a moneyline against a handicap
// baseball does not vary, and the ten one-sided disagreements it found are not
// a feed artefact at all -- they are the rubric asking a question MLB's run
// line cannot answer. Same response, no extra credit, so this probe measures it.
//
// It reports the SHAPE and nothing else. It asserts neither premise: asserting
// one would make a false premise look like a broken probe.
//
// COST (Rule 78), and this repo has a scar: a June session shipped two Odds API
// helpers with no caching and burned 19,999 of 20,000 credits in one sitting.
// This never touches api.the-odds-api.com directly. It goes through the relay's
// own /odds proxy and its 3600s edge cache (ODDS_TTL_ODDS), so a sport key any
// cron already fetched within the hour costs ZERO credits and a cold one costs
// a single credit. One region, one market, one bookmaker, two sport keys.

const RELAY = process.env.RELAY_BASE || 'https://field-relay-nba.jeffunglesbee.workers.dev'
const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'

// The keys the relay maps (src/index.js ~6010-6024). MLB first: it is 515 of
// the 643 games the census judged, and the sport the Gumbo claim is about.
const SPORTS = ['baseball_mlb', 'basketball_wnba']
const BOOK = 'draftkings'   // ODDS_PREFERRED_BOOK — the book extractOddsForGame picks

const out = { probed_at: new Date().toISOString(), relay: RELAY, sports: {}, price_verdict: null, point_verdict: null, error: null }

const get = async (path) => {
  const r = await fetch(`${RELAY}${path}`, { headers: { 'User-Agent': UA, Accept: 'application/json' } })
  const body = await r.text()
  if (!r.ok) throw new Error(`HTTP ${r.status} on ${path}: ${body.slice(0, 200)}`)
  return JSON.parse(body)
}

try {
  for (const sport of SPORTS) {
    const games = await get(
      `/odds/v4/sports/${sport}/odds?regions=us&markets=spreads&oddsFormat=american&bookmakers=${BOOK}`)
    const rows = []
    for (const g of (Array.isArray(games) ? games : []).slice(0, 8)) {
      const bk = (g.bookmakers || []).find(b => b.key === BOOK) || (g.bookmakers || [])[0]
      const sp = (bk?.markets || []).find(m => m.key === 'spreads')
      if (!sp) continue
      // Matched exactly as extractOddsForGame matches them, so a name that does
      // not match here is a name that would not match there either.
      const h = (sp.outcomes || []).find(o => o.name === g.home_team)
      const a = (sp.outcomes || []).find(o => o.name === g.away_team)
      rows.push({
        game: `${g.away_team} @ ${g.home_team}`,
        book: bk.key,
        matched_both: !!(h && a),
        // The raw outcomes, verbatim. The CC-CMD asks for these pasted.
        raw_outcomes: sp.outcomes || [],
        home_point: h?.point ?? null, home_price: h?.price ?? null,
        away_point: a?.point ?? null, away_price: a?.price ?? null,
        // Is the handicap the |1.5| the Gumbo doc claims MLB never departs from?
        abs_point: h ? Math.abs(h.point) : null,
      })
    }
    out.sports[sport] = { games_returned: Array.isArray(games) ? games.length : 0, sampled: rows }
  }

  const matched = Object.values(out.sports).flatMap(s => s.sampled).filter(r => r.matched_both)

  out.price_verdict = matched.length === 0
    ? 'NOT OBSERVABLE — no game with a spreads market from this book right now (off-day or out of window). Says nothing about the premise.'
    : matched.every(r => Number.isFinite(r.home_price) && Number.isFinite(r.away_price))
      ? `PREMISE HOLDS — all ${matched.length} matched spread markets carry a finite price on BOTH sides beside point. The capture is safe to write.`
      : matched.some(r => Number.isFinite(r.home_price) && Number.isFinite(r.away_price))
        ? `MIXED — ${matched.filter(r => Number.isFinite(r.home_price) && Number.isFinite(r.away_price)).length} of ${matched.length} carry a price on both sides. The capture must stay optional per side.`
        : `PREMISE FALSE — none of ${matched.length} matched spread markets carries a price. There is nothing to capture and the ask needs a different market.`

  // The Gumbo claim, measured only over MLB, which is what it was about.
  const mlb = (out.sports['baseball_mlb']?.sampled || []).filter(r => r.abs_point !== null)
  out.point_verdict = mlb.length === 0
    ? 'NOT OBSERVABLE — no MLB spread sampled. The Gumbo claim stays unverified.'
    : mlb.every(r => r.abs_point === 1.5)
      ? `GUMBO CLAIM HOLDS — all ${mlb.length} sampled MLB handicaps are |1.5|. The point carries no favourite signal in MLB; only the price does.`
      : `GUMBO CLAIM DOES NOT HOLD — ${mlb.filter(r => r.abs_point !== 1.5).length} of ${mlb.length} sampled MLB handicaps are not |1.5| (${[...new Set(mlb.map(r => r.abs_point))].sort((x, y) => x - y).join(', ')}). MLB does vary its run line.`
} catch (e) {
  out.error = String(e.message || e)
}

const stamp = out.probed_at.replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z')
const { writeFileSync } = await import('node:fs')
writeFileSync(`outbox/odds-spread-shape-${stamp}.json`, JSON.stringify(out, null, 2) + '\n')
console.log(JSON.stringify(out, null, 2))
console.log(`\nwrote outbox/odds-spread-shape-${stamp}.json`)
console.log(`\nPRICE:  ${out.price_verdict ?? out.error}`)
console.log(`POINT:  ${out.point_verdict ?? out.error}`)
// A fetch failure is a failed probe and must not read as a finding about the
// feed. A "premise false" verdict is a real answer and exits 0.
if (out.error) { console.error('\nPROBE FAILED — nothing above is established.'); process.exit(1) }
