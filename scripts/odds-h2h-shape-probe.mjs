#!/usr/bin/env node
// Does the Odds API price three outcomes for association football?
//
// THE PREMISE THIS TESTS WAS NEVER MEASURED. CC-CMD-2026-08-23-soccer-three-way-odds
// states "The Odds API's soccer feed prices all three outcomes (h2h with a draw
// selection); the draw price is being dropped somewhere between the feed and
// opening_odds.moneyline." The relay fix (5a2bacc) was built on that sentence.
// Rule 72 makes an inherited claim a hypothesis until probed, and this session's
// sandbox 403s *.workers.dev, so CI is the only place it can be checked.
//
// If the premise is FALSE -- if the feed hands this account two outcomes for
// soccer -- then drawPriceFrom is correct and will simply never fire, and the
// ask needs a different fix (a different market key, or a region that carries
// the three-way). Better to learn that here than from a follow-up reading "not
// yet" for a week.
//
// COST, and this repo has a scar (Rule 78). A June session wrote two Odds API
// helpers with no caching and burned 19,999 of 20,000 credits in one sitting.
// This probe goes through the relay's own /odds proxy, which serves from a
// 3600s edge cache (ODDS_TTL_ODDS) -- so if any cron has fetched the same sport
// key within the hour it costs ZERO credits, and at worst one. It requests a
// single sport, a single region and a single market, and never the direct API.
//
// It reports the SHAPE and nothing else. It does not assert three outcomes:
// asserting the premise would make a false premise look like a broken probe.

const RELAY = process.env.RELAY_BASE || 'https://field-relay-nba.jeffunglesbee.workers.dev'
const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'

// The keys the relay itself maps for soccer (src/index.js ~5982-5995). MLS
// first: it is the competition the CC-CMD measured, and the one in season.
const SPORTS = ['soccer_usa_mls', 'soccer_epl']
const BOOK = 'draftkings'   // ODDS_PREFERRED_BOOK — the book extractOddsForGame picks

const out = { probed_at: new Date().toISOString(), relay: RELAY, sports: {}, verdict: null, error: null }

const get = async (path) => {
  const r = await fetch(`${RELAY}${path}`, { headers: { 'User-Agent': UA, Accept: 'application/json' } })
  const body = await r.text()
  if (!r.ok) throw new Error(`HTTP ${r.status} on ${path}: ${body.slice(0, 200)}`)
  return JSON.parse(body)
}

try {
  for (const sport of SPORTS) {
    // One region, one market, one book. `oddsFormat=american` matches the
    // convention extractOddsForGame stores and the CC-CMD's own table.
    const games = await get(
      `/odds/v4/sports/${sport}/odds?regions=us&markets=h2h&oddsFormat=american&bookmakers=${BOOK}`)
    const rows = []
    for (const g of (Array.isArray(games) ? games : []).slice(0, 5)) {
      const bk = (g.bookmakers || []).find(b => b.key === BOOK) || (g.bookmakers || [])[0]
      const h2h = (bk?.markets || []).find(m => m.key === 'h2h')
      if (!h2h) continue
      const names = (h2h.outcomes || []).map(o => o.name)
      rows.push({
        game: `${g.away_team} @ ${g.home_team}`,
        book: bk.key,
        outcome_count: names.length,
        outcome_names: names,
        // The exact question drawPriceFrom answers: is there an entry that is
        // neither team? Reported as the NAME, so a future reader knows what the
        // feed calls it without this probe having to guess.
        third_selection: names.find(n => n !== g.home_team && n !== g.away_team) ?? null,
        prices: Object.fromEntries((h2h.outcomes || []).map(o => [o.name, o.price])),
      })
    }
    out.sports[sport] = { games_returned: Array.isArray(games) ? games.length : 0, sampled: rows }
  }

  // A verdict over everything sampled, in the three honest states.
  const all = Object.values(out.sports).flatMap(s => s.sampled)
  out.verdict = all.length === 0
    ? 'NOT OBSERVABLE — no soccer game with an h2h market from this book right now (off-day or out of window). Says nothing about the premise.'
    : all.every(r => r.outcome_count === 3)
      ? `PREMISE HOLDS — every one of ${all.length} sampled soccer h2h markets prices three outcomes. drawPriceFrom will fire.`
      : all.some(r => r.outcome_count === 3)
        ? `MIXED — ${all.filter(r => r.outcome_count === 3).length} of ${all.length} price three outcomes. The fix works where they do; the rest need explaining.`
        : `PREMISE FALSE — none of ${all.length} sampled soccer h2h markets prices three outcomes. drawPriceFrom is correct and will never fire; the ask needs a different market key or region.`
} catch (e) {
  out.error = String(e.message || e)
}

const stamp = out.probed_at.replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z')
const { writeFileSync } = await import('node:fs')
writeFileSync(`outbox/odds-h2h-shape-${stamp}.json`, JSON.stringify(out, null, 2) + '\n')
console.log(JSON.stringify(out, null, 2))
console.log(`\nwrote outbox/odds-h2h-shape-${stamp}.json`)
console.log(`\nVERDICT: ${out.verdict ?? out.error}`)
// A fetch failure is a failed probe and must not read as a finding about the
// feed. A "premise false" verdict is a real answer and exits 0 — it is
// information, not a broken run.
if (out.error) { console.error('\nPROBE FAILED — nothing above is established.'); process.exit(1) }
