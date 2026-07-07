// TEST-ONLY — measure dramaScoreLive() CPU cost at relay side.
// Both functions ported verbatim from jubilant-bassoon/index.html.
// TWO KNOWN OMISSIONS (see outbox for disclosure):
//   1. weather-bonus branch (wxCache/weatherDramaModifier) — client-only global,
//      no relay equivalent. Real-world cost marginally higher for outdoor games
//      during active weather events.
//   2. upset-factor bonus (soccer, FIFA rank-based) — depends on _fifaRankCache,
//      a client-side async cache. No relay equivalent. Both gaps are bounded and
//      known, not hidden.
// This file MUST be removed or gated before any real relay-side migration ships.

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

export { dramaScoreLive, applyQW1SituationBonus };
