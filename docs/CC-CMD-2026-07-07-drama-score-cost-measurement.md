# CC-CMD: Measure dramaScoreLive() real CPU cost via isolated test route

**Date:** 2026-07-07 (corrected — see note below)
**Repo:** jeffunglesbee-create/field-relay-nba (sole)
**Branch:** main — commit directly, do not create a feature branch or PR

**Correction note:** the original version of this doc referenced
`jubilant-bassoon/index.html` via relative path (`../jubilant-bassoon/...`)
in its probe block and porting instructions. A Claude Code session
scoped to this repo has no cross-repo file access — that path would not
exist. Both functions are embedded verbatim below instead, the same
pattern already used successfully in `CC-CMD-2026-07-06-wiki-trending-
aggregator.md`'s team list. This was a real error caught before
execution, not a hypothetical.

**Purpose:** get a real, measured CPU-ms cost for `dramaScoreLive()` if
it were to move relay-side (per tonight's RUWT re-analysis — this is
measurement only, not the actual migration; nothing here changes
production behavior for any real user).

**Baseline, confirmed live this session, not estimated:** relay's
current traffic runs `cpuTimeP50: 984μs` / `cpuTimeP99: 20,424μs` (units
confirmed via GraphQL schema introspection — `AccountWorkersInvocationsAdaptiveQuantiles.cpuTimeP50`
description: "CPU time 50th percentile - microseconds"), on ~101,466
requests/day, against a 30M-CPU-ms/month included allowance on the
Workers Paid plan ($0.02/million ms overage).

## PROBE BLOCK
```bash
grep -n "^function dramaScoreLive\|^function applyQW1SituationBonus" src/*.js
```
Confirm neither name already exists in this repo (expect no matches —
this is net-new test code). Do not attempt to fetch or reference the
client repo; both functions are embedded verbatim below.

## TASK 1 — Add both functions verbatim, in a new file

Create `src/drama-score-test.js` with these two functions, copied
exactly as embedded here — do not modify the logic, do not "clean up"
anything, this must measure the real function as it actually runs:

```javascript
function applyQW1SituationBonus(eData, sport){
  if(!eData) return 0;
  const sp = (sport||'').toLowerCase();
  const sit = eData.situation || {};
  const diff = Math.abs((eData.homeScore||0) - (eData.awayScore||0));
  const period = parseInt(eData.period)||1;
  let sitBonus = 0;

  const isFinalPeriod = (
    (sp.includes('nba')||sp.includes('basketball')) && period >= 4 ||
    (sp.includes('nhl')||sp.includes('hockey'))     && period >= 3 ||
    (sp.includes('mlb')||sp.includes('baseball'))   && period >= 9 ||
    (sp.includes('nfl')||sp.includes('football'))   && period >= 4
  );

  if(sp.includes('nhl')||sp.includes('hockey')){
    const homePull = sit.homeGoaliePulled||false;
    const awayPull = sit.awayGoaliePulled||false;
    if(homePull || awayPull) sitBonus += 22;
    else if((sit.homePowerPlay||sit.awayPowerPlay) && diff===0) sitBonus += 18;
    else if((sit.homePowerPlay||sit.awayPowerPlay) && diff<=1)  sitBonus += 15;
    if(sit.delayedPenalty && diff<=1) sitBonus += 8;
  }

  if(sp.includes('mlb')||sp.includes('baseball')){
    const runners = [eData.onFirst,eData.onSecond,eData.onThird].filter(Boolean).length;
    const risp    = eData.onSecond||eData.onThird;
    if(runners===3 && eData.outs===2)  sitBonus += isFinalPeriod ? 20 : 12;
    else if(runners===3)               sitBonus += isFinalPeriod ? 15 :  8;
    else if(risp && eData.outs===2)    sitBonus += isFinalPeriod ? 10 :  6;
    if(eData.balls===3 && eData.strikes===2 && risp) sitBonus += 8;
    if(eData.outs===2 && period>=7)    sitBonus += 5;
  }

  if(sp.includes('nba')||sp.includes('basketball')){
    if(isFinalPeriod){
      if((sit.homeFoulsBonus||sit.awayFoulsBonus) && diff<=5) sitBonus += 10;
      const sc = parseFloat(sit.shotClock||'99');
      if(sc<=8 && diff<=6) sitBonus += 8;
    }
  }

  if(sp.includes('nfl')||sp.includes('football')){
    const dnDist = (sit.shortDownDistanceText||sit.downDistanceText||'').toLowerCase();
    const in2min = dnDist.includes('2-minute')||dnDist.includes('2 minute');
    if(dnDist.includes('4th') && in2min)                  sitBonus += isFinalPeriod ? 15 : 10;
    else if(dnDist.includes('4th'))                       sitBonus += isFinalPeriod ?  8 :  5;
    if(sit.isRedZone && in2min && diff<=7)                sitBonus += 10;
    else if(sit.isRedZone)                                sitBonus +=  5;
  }

  if(sp.includes('soccer')||sp.includes('league')||sp.includes('mls')||
     sp.includes('liga')||sp.includes('ligue')||sp.includes('premier')||
     /world.cup|fifa/i.test(sp)){
    if((eData.clock||'').includes('+')) sitBonus += 8;
    const _adv = eData._wcAdvProb;
    if(_adv){
      const _minAdv = Math.min(_adv.homeAdvance??1, _adv.awayAdvance??1);
      if(_minAdv < 0.20) sitBonus += 15;
      else if(_minAdv < 0.40) sitBonus += 8;
      const _open = eData._wcOpeningAdvProb;
      if(_open){
        const _minOpen = Math.min(_open.homeAdvance??1, _open.awayAdvance??1);
        if((_minOpen - _minAdv) >= 0.20) sitBonus += 8;
      }
    }
  }

  return sitBonus;
}

function dramaScoreLive(eData, sport){
  if(!eData) return 0;
  const state = eData.state || 'pre';
  if(state === 'post') return 0;
  if(state === 'pre')  return 0;

  const diff = Math.abs((eData.homeScore||0) - (eData.awayScore||0));
  const period = parseInt(eData.period)||1;
  const sp = (sport||'').toLowerCase();

  let base;
  if(sp.includes('mlb') || sp.includes('baseball')){
    base = diff===0?1.0 : diff===1?0.85 : diff===2?0.55 : diff<=4?0.28 : 0.08;
  } else if(sp.includes('soccer')||sp.includes('league')||sp.includes('mls')||
            sp.includes('liga')||sp.includes('ligue')||sp.includes('premier')||
            sp.includes('wc26')||sp.includes('world cup')){
    base = diff===0?1.0 : diff===1?0.72 : diff===2?0.32 : 0.06;
  } else {
    base = diff===0?1.0 : diff<=3?0.82 : diff<=7?0.52 : diff<=14?0.22 : 0.05;
  }

  let timeBonus = 0;
  const clock = eData.clock||'';
  const mins = parseFloat((clock.match(/^(\d+)/)||[0,0])[1])||12;

  if(sp.includes('nba')||sp.includes('basketball')){
    if(period>4) timeBonus=22;
    else if(period>=3 && mins<2) timeBonus=18;
    else if(period===4) timeBonus=10;
    else if(period===3) timeBonus=5;
  } else if(sp.includes('nhl')||sp.includes('hockey')){
    if(period>3) timeBonus=25;
    else if(period===3 && mins<5) timeBonus=18;
    else if(period===3) timeBonus=8;
  } else if(sp.includes('mlb')||sp.includes('baseball')){
    if(period>=10) timeBonus=22;
    else if(period>=9) timeBonus=16;
    else if(period>=7) timeBonus=7;
  } else if(sp.includes('soccer')||sp.includes('league')||sp.includes('mls')||
            sp.includes('liga')||sp.includes('ligue')||sp.includes('premier')||
            sp.includes('wc26')||sp.includes('world cup')){
    const minNum = parseInt(clock)||0;
    if(period>=3) timeBonus=24;
    else if(minNum>=90) timeBonus=18;
    else if(minNum>=80) timeBonus=10;
    else if(minNum>=70) timeBonus=5;
  } else if(sp.includes('nfl')||sp.includes('football')){
    if(period>4) timeBonus=20;
    else if(period===4 && mins<2) timeBonus=18;
    else if(period===4) timeBonus=8;
    else if(period===2 && mins<2) timeBonus=5;
  } else if(sp.includes('australian')||sp.includes('afl')){
    base = diff===0?1.0 : diff<6?0.82 : diff<=18?0.60 : diff<=36?0.28 : 0.05;
    const q=period;
    if(q>=4 && mins<5) timeBonus=22;
    else if(q>=4)      timeBonus=14;
    else if(q===3)     timeBonus=5;
  } else if(sp.includes('cfl')||sp.includes('canadian football')){
    base = diff===0?1.0 : diff<=3?0.88 : diff<=8?0.62 : diff<=16?0.28 : 0.06;
    if(period>4) timeBonus=22;
    else if(period===4 && mins<2) timeBonus=20;
    else if(period===4) timeBonus=10;
    else if(period===2 && mins<2) timeBonus=6;
  }
  if(sp.includes('wnba')) {
    base = diff===0?1.0 : diff<=3?0.82 : diff<=7?0.52 : diff<=14?0.22 : 0.05;
    if(period>4) timeBonus=22;
    else if(period>=3 && mins<2) timeBonus=18;
    else if(period===4) timeBonus=10;
    else if(period===3) timeBonus=5;
  }
  if(sp.includes('tennis')||sp.includes('atp')||sp.includes('wta')) {
    base = diff===0?1.0 : diff===1?0.70 : 0.20;
    if(period>=3) timeBonus=18;
    else if(period>=2) timeBonus=8;
  }

  let sitBonus = applyQW1SituationBonus(eData, sport);

  // NOTE: weather-bonus branch (wxCache/weatherDramaModifier) deliberately
  // omitted here — it depends on a client-only global with no relay
  // equivalent. This measurement is of the core computation without it;
  // real-world cost for outdoor-sport games during active weather would
  // be marginally higher. State this in the outbox, don't hide it.

  // NOTE: upset-factor bonus (soccer, FIFA rank-based) also omitted —
  // it depends on _fifaRankCache, a client-side cache populated by a
  // separate async fetchTeamRank() flow not included here. Same
  // disclosure requirement as the weather bonus.

  const raw = base*52 + timeBonus + sitBonus;
  let wpBonus = 0;
  const wpNow  = eData?.wp      ?? null;
  const wpPrev = eData?.wp_prev ?? null;
  if (wpNow !== null && wpPrev !== null) {
    const wpDelta = Math.abs(wpNow - wpPrev) * 100;
    wpBonus = Math.min(wpDelta * 1.5, 25);
  }
  return Math.min(100, Math.round(raw + wpBonus));
}

module.exports = { dramaScoreLive, applyQW1SituationBonus };
```

## TASK 2 — Isolated test route with precise, self-contained timing

Add `GET /test/drama-score-cost` (test-only — not linked from any
production path, not called by any existing client code). On each
request:

1. Fetch today's live games from the relay's own existing `/v2/games`
   internal logic (reuse, don't refetch from scratch) for whatever
   sports currently have live games.
2. For each live game, run `dramaScoreLive()` and measure wall-clock
   time immediately before/after with `performance.now()` around the
   computation only — not around the data fetch.
3. Return the real per-call timings directly in the JSON response:
   `{ gameCount, timings: [...], min, max, avg, p50, omittedBonuses:
   ["weather", "soccer-upset-factor"] }` — measured in milliseconds,
   computed from the actual timing array, not estimated.

## VERIFICATION

- `node --check src/drama-score-test.js` and wherever the route gets wired.
- Call the real, deployed route live, at least twice, at different
  times (ideally when different numbers of games are live) — report
  the actual returned numbers, not a single sample treated as
  definitive.
- Cross-check: does the measured per-call cost, multiplied by a
  realistic invocation estimate (once per live game per relay poll
  cycle — check the actual current polling cadence rather than assume
  it), fit comfortably within remaining CPU-ms headroom implied by the
  baseline above? Show the arithmetic, don't just assert a conclusion.

## DONE CONDITIONS
- [ ] Probe block confirms no naming collision before adding the new file
- [ ] Both functions added exactly as embedded above, zero cross-repo file access attempted
- [ ] Test-only route added, not wired into any production path
- [ ] Real per-call timings measured via `performance.now()`, isolated from data-fetch time
- [ ] Called live at least twice, real numbers reported both times
- [ ] Cost arithmetic shown against the real baseline headroom, not just concluded
- [ ] Outbox written, explicitly noting both omitted bonuses and that this route should be removed or gated before any real migration decision ships

## CONFIDENCE SCORING TABLE
+25  Functions added exactly as embedded, no cross-repo access attempted
+30  Timing isolated correctly around computation only, using performance.now()
+25  Real live measurement, called more than once, real numbers reported
+10  Cost arithmetic shown against real baseline, not asserted
+10  Outbox flags this as test-only and discloses both omitted bonuses

## ONE-LINER
git remote get-url origin | grep -q field-relay-nba || { echo "WRONG REPO -- this CC-CMD targets field-relay-nba"; exit 1; }
git pull. Read docs/CC-CMD-2026-07-07-drama-score-cost-measurement.md.
Both dramaScoreLive() and applyQW1SituationBonus() are embedded verbatim
in the doc -- do not attempt to read them from jubilant-bassoon, that
repo is not available in this session. Add them exactly as shown to a
new src/drama-score-test.js, wire a test-only GET /test/drama-score-cost
route that measures real per-call CPU cost via performance.now() against
real live game data. Call it live at least twice and report the actual
numbers. Show the cost arithmetic against the real baseline (cpuTimeP50
984us, 30M CPU-ms/month included). This route is test-only and must be
flagged for removal before any real migration ships. Do not commit
unless confidence >= 95. If score < 95, report verbatim and stop.
