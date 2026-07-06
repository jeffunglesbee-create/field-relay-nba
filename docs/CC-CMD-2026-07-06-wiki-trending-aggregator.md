# CC-CMD: Relay-side Wikimedia pageviews aggregator (relay side)

**Date:** 2026-07-06
**Repo:** jeffunglesbee-create/field-relay-nba (sole)
**Branch:** main — commit directly, do not create a feature branch or PR
**Depends on:** nothing. **Unblocks:** a separate jubilant-bassoon
CC-CMD that replaces the client's direct per-team fetches with one call
to this new endpoint.

**Source — real, previously-scoped, never-shipped.** Checked chats/Drive
per this session's own instruction before writing this: a June 3 2026
WPT session ("PM-26 CLS reduction") documented median CLS work and
flagged, as an explicit carry-forward item, "PM-26-D — Wikimedia
Pageviews relay-side aggregator" with the exact same rationale below —
scoped ~75 min, two commits — and it was never built. Confirmed via
direct grep of `field-relay-nba` just now: zero Wikimedia-related code
exists here today. This CC-CMD is that carry-forward, finally executed.

**Real, current problem, not theoretical:** `fetchWikiSignificance()` in
`jubilant-bassoon/index.html` makes one direct browser-to-`wikimedia.org`
`fetch()` per distinct team on today's schedule (both home and away, for
every game card), with no server-side batching. A typical day with
15-20 games across multiple sports produces 20-40+ simultaneous direct
external fetches on a cold cache, competing for the browser's connection
pool during/after the page's critical load window — and the June 3 WPT
run measured roughly half of these failing with HTTP 429
(rate-limited), meaning half that network effort is pure waste on every
affected load.

**Target time:** ~50 min (real feature build, not a quick fix — size
the CC-CMD's own confidence expectations accordingly)

## PROBE BLOCK
```bash
grep -rn "wikimedia\|WIKI_TITLES" src/*.js   # confirm zero existing relay-side code (expect no matches)
```

## TASK 1 — New endpoint: `GET /wiki/trending?date=YYYY-MM-DD`

Returns a single JSON object mapping team name → trending data for
**every** team below, computed the same way the client currently does
(8-day trailing window, `spikeRatio = todayViews / avgViews`,
`trending = spikeRatio > 2.0`). Cache the full day's result in
`env.FIELD_JOURNALISM` KV (reuse this binding — it's already used for
other daily-cadence data in this file; don't introduce a new KV
namespace for one feature) under key `wiki:trending:{date}`, TTL 26
hours (slightly over a day, covering timezone-boundary requests near
midnight without needing exact-UTC-day precision).

On a cache miss, fetch every team below server-side, **with real
spacing between requests** (e.g., a small delay or limited concurrency
batch — do not fire all ~86 as one `Promise.all`, which risks
reproducing the exact rate-limiting problem this CC-CMD exists to
eliminate, just moved from the client to the relay). On a cache hit,
return the cached payload with zero external calls.

**Use this exact team → title mapping — copied verbatim from the real,
current client source (`jubilant-bassoon/index.html`'s `WIKI_TITLES`
constant) so relay and client data never drift apart. Do not
re-derive or guess team-name-to-Wikipedia-title mappings — copy this
exactly:**

```javascript
const WIKI_TITLES={
  // NBA
  'New York Knicks':'New_York_Knicks','Cleveland Cavaliers':'Cleveland_Cavaliers',
  'San Antonio Spurs':'San_Antonio_Spurs','Oklahoma City Thunder':'Oklahoma_City_Thunder',
  'Boston Celtics':'Boston_Celtics','Milwaukee Bucks':'Milwaukee_Bucks',
  'Indiana Pacers':'Indiana_Pacers','Miami Heat':'Miami_Heat',
  'Philadelphia 76ers':'Philadelphia_76ers','Orlando Magic':'Orlando_Magic',
  'Denver Nuggets':'Denver_Nuggets','Minnesota Timberwolves':'Minnesota_Timberwolves',
  'Dallas Mavericks':'Dallas_Mavericks','Los Angeles Lakers':'Los_Angeles_Lakers',
  'Golden State Warriors':'Golden_State_Warriors','Los Angeles Clippers':'Los_Angeles_Clippers',
  'Phoenix Suns':'Phoenix_Suns','Sacramento Kings':'Sacramento_Kings',
  'Memphis Grizzlies':'Memphis_Grizzlies','New Orleans Pelicans':'New_Orleans_Pelicans',
  'Houston Rockets':'Houston_Rockets','Atlanta Hawks':'Atlanta_Hawks',
  'Chicago Bulls':'Chicago_Bulls','Brooklyn Nets':'Brooklyn_Nets',
  'Toronto Raptors':'Toronto_Raptors','Detroit Pistons':'Detroit_Pistons',
  // NHL
  'Carolina Hurricanes':'Carolina_Hurricanes','Montreal Canadiens':'Montreal_Canadiens',
  'Vegas Golden Knights':'Vegas_Golden_Knights','Colorado Avalanche':'Colorado_Avalanche',
  'Florida Panthers':'Florida_Panthers','New York Rangers':'New_York_Rangers',
  'Dallas Stars':'Dallas_Stars','Edmonton Oilers':'Edmonton_Oilers',
  'Boston Bruins':'Boston_Bruins','Toronto Maple Leafs':'Toronto_Maple_Leafs',
  'Tampa Bay Lightning':'Tampa_Bay_Lightning','New York Islanders':'New_York_Islanders',
  'Winnipeg Jets':'Winnipeg_Jets','Nashville Predators':'Nashville_Predators',
  'Washington Capitals':'Washington_Capitals','Pittsburgh Penguins':'Pittsburgh_Penguins',
  // MLB
  'New York Yankees':'New_York_Yankees','Los Angeles Dodgers':'Los_Angeles_Dodgers',
  'Philadelphia Phillies':'Philadelphia_Phillies','Houston Astros':'Houston_Astros',
  'San Diego Padres':'San_Diego_Padres','New York Mets':'New_York_Mets',
  'Athletics':'Oakland_Athletics','Boston Red Sox':'Boston_Red_Sox',
  'Chicago Cubs':'Chicago_Cubs','San Francisco Giants':'San_Francisco_Giants',
  'Baltimore Orioles':'Baltimore_Orioles','Cleveland Guardians':'Cleveland_Guardians',
  'Texas Rangers':'Texas_Rangers_(baseball)','Atlanta Braves':'Atlanta_Braves',
  'Milwaukee Brewers':'Milwaukee_Brewers','Cincinnati Reds':'Cincinnati_Reds',
  'Minnesota Twins':'Minnesota_Twins','Seattle Mariners':'Seattle_Mariners',
  'St. Louis Cardinals':'St._Louis_Cardinals','Detroit Tigers':'Detroit_Tigers',
  'Arizona Diamondbacks':'Arizona_Diamondbacks','Tampa Bay Rays':'Tampa_Bay_Rays',
  'Kansas City Royals':'Kansas_City_Royals','Toronto Blue Jays':'Toronto_Blue_Jays',
  // EPL
  'Arsenal':'Arsenal_F.C.','Manchester City':'Manchester_City_F.C.',
  'Liverpool':'Liverpool_F.C.','Manchester United':'Manchester_United_F.C.',
  'Chelsea':'Chelsea_F.C.','Tottenham Hotspur':'Tottenham_Hotspur_F.C.',
  'Newcastle United':'Newcastle_United_F.C.','Aston Villa':'Aston_Villa_F.C.',
  'Brighton & Hove Albion':'Brighton_%26_Hove_Albion_F.C.',
  'West Ham United':'West_Ham_United_F.C.','Everton':'Everton_F.C.',
  'Crystal Palace':'Crystal_Palace_F.C.','Fulham':'Fulham_F.C.',
  'Brentford':'Brentford_F.C.','Wolverhampton':'Wolverhampton_Wanderers_F.C.',
  'Nottingham Forest':'Nottingham_Forest_F.C.',
  // EFL
  'Hull City':'Hull_City_A.F.C.','Bolton Wanderers':'Bolton_Wanderers_F.C.',
  'Sunderland':'Sunderland_A.F.C.','Burnley':'Burnley_F.C.',
};
```

Response shape per team (matching the client's current per-team result
object exactly, so the client-side swap is a pure data-source change):
```json
{ "Boston Celtics": { "todayViews": 12345, "avgViews": 8000, "spikeRatio": 1.5, "trending": false }, ... }
```
Teams whose fetch fails individually should return `null` for that
team's value, not fail the whole response — one bad Wikipedia article
title must never take down the other ~85 teams' data.

## TASK 2 — Verification

- `node --check src/index.js`
- Call the real endpoint live, cold (first call of a new date, or
  after manually clearing the KV key) — confirm it actually fetches
  from Wikimedia and returns real, non-null data for a sample of teams
  you can cross-check by hand.
- Call it again immediately after — confirm the second call is served
  from KV cache (near-instant response, and ideally confirm via a
  temporary log or timing comparison that zero new Wikimedia requests
  fired on the cache-hit path).
- Confirm the response includes every team in the list above — not a
  subset.

## DONE CONDITIONS
- [ ] Probe block confirms zero existing Wikimedia code before starting
- [ ] `/wiki/trending?date=` endpoint built, using the exact team list above verbatim
- [ ] KV caching with ~26h TTL, keyed by date
- [ ] Real request spacing/batching on cache miss — not one unthrottled `Promise.all` of ~86 calls
- [ ] Individual team fetch failures don't break the whole response
- [ ] Verified live: cold call fetches real data, warm call serves from cache
- [ ] Outbox written, explicitly noting a separate jubilant-bassoon CC-CMD is needed to consume this (client still does direct per-team fetches until that ships)

## CONFIDENCE SCORING TABLE
+30  Endpoint built correctly, exact team list used verbatim
+25  KV caching correct, real TTL, keyed by date
+20  Real throttling/spacing on cache-miss fetch, not a naive fan-out that reproduces the original problem server-side
+15  Verified live: both cold-fetch and warm-cache-hit paths confirmed with real evidence, not just code review
+10  Individual-team-failure isolation confirmed (one bad title doesn't break the rest)

## ONE-LINER
git remote get-url origin | grep -q field-relay-nba || { echo "WRONG REPO -- this CC-CMD targets field-relay-nba"; exit 1; }
git pull. Read docs/CC-CMD-2026-07-06-wiki-trending-aggregator.md. Build
the /wiki/trending?date= endpoint exactly as specified, using the exact
embedded team list (do not re-derive it), with real KV caching and
throttled server-side fetching on a cache miss. Verify both the cold
and warm-cache paths live with real evidence. State in the outbox that
a separate jubilant-bassoon CC-CMD is still needed to make the client
actually use this instead of its current direct per-team fetches. Do
not commit unless confidence >= 95. If score < 95, report verbatim and
stop.
