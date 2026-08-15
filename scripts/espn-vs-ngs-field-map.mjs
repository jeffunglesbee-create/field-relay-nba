// Which NGS columns does ESPN's free JSON actually provide?
//
// Target list = the exact fields FIELD stores from nflverse NGS (read from
// jubilant-bassoon/outbox/nfl/ngs-*.json, 2026-08-15). For each, this asks the
// real ESPN endpoints and reports EQUIVALENT / DERIVABLE / ABSENT — measured from
// the responses, not judged from memory.
//
// ESPN surfaces probed (all public, no auth):
//   A. athlete season statistics  — sports.core .../athletes/{id}/statistics
//   B. play-by-play               — .../events/{id}/competitions/{id}/plays
//   C. athlete gamelog/overview   — site.web.api .../athletes/{id}/... (box)
//
// The classification rule, applied to what the responses actually contain:
//   EQUIVALENT  — ESPN returns this exact quantity (e.g. targets, receptions).
//   DERIVABLE   — ESPN returns the play-level PRIMITIVES to compute it without
//                 tracking (e.g. air yards per pass → avg air yards).
//   ABSENT      — needs 10Hz x/y tracking or a proprietary model ESPN doesn't
//                 expose (separation, cushion, time-to-throw, *-over-expected).
// The point of the run is to confirm which bucket each NGS field really lands in.

const CORE = 'https://sports.core.api.espn.com/v2/sports/football/leagues/nfl';
const UA = 'Mozilla/5.0 (compatible; FIELD-probe/1.0)';
const SEASON = 2024, TYPE = 2;

// The 30 NGS columns, minus the 3 identity fields (name/team/season).
const NGS = {
  passing: ['cpoe','aggressiveness','avgTimeToThrow','avgCompletedAirYards','avgAirYardsDiff','avgAirYardsToSticks','attempts','xCompPct'],
  receiving: ['avgSeparation','avgCushion','avgYAC','avgExpectedYAC','avgYACAboveExp','pctShareIntendedAirYards','targets','receptions','catchPct'],
  rushing: ['efficiency','pctVsStacked','avgTimeToLOS','rushYdsOverExp','rushYdsOverExpPerAtt','expectedRushYds','rushAttempts'],
};

const get = async (url) => {
  try {
    const r = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: AbortSignal.timeout(30000) });
    const t = await r.text();
    try { return { status: r.status, json: JSON.parse(t) }; }
    catch { return { status: r.status, raw: t.slice(0, 120) }; }
  } catch (e) { return { error: e.message }; }
};

// Collect every stat "name" ESPN exposes in an athlete statistics doc.
function statNames(doc) {
  const names = new Set();
  const cats = doc?.splits?.categories || [];
  for (const c of cats) for (const s of (c.stats || [])) if (s.name) names.add(`${c.name}.${s.name}`);
  return names;
}
// Collect every field key present on a play object.
function playFields(plays) {
  const keys = new Set();
  for (const p of plays.slice(0, 40)) {
    (function walk(o, pfx) {
      if (!o || typeof o !== 'object') return;
      for (const k of Object.keys(o)) {
        keys.add(pfx ? `${pfx}.${k}` : k);
        if (o[k] && typeof o[k] === 'object' && !Array.isArray(o[k])) walk(o[k], pfx ? `${pfx}.${k}` : k);
      }
    })(p, '');
  }
  return keys;
}

(async () => {
  console.log(`=== espn-vs-ngs-field-map  utc=${new Date().toISOString()} ===\n`);

  // ── discover a valid QB athlete id (Mahomes 3139477) and a real event ──────
  const ATHLETE = 3139477;
  const aStats = await get(`${CORE}/seasons/${SEASON}/types/${TYPE}/athletes/${ATHLETE}/statistics`);
  const names = aStats.json ? statNames(aStats.json) : new Set();
  console.log(`A. athlete statistics (Mahomes ${SEASON}): status=${aStats.status}, ${names.size} stat fields`);
  const passingStats = [...names].filter(n => n.startsWith('passing')).map(n => n.split('.')[1]);
  console.log(`   passing stat names: ${passingStats.slice(0, 30).join(', ')}\n`);

  // ── one completed event's play-by-play, to see per-play primitives ─────────
  const sb = await get(`https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?dates=20240908`);
  const eid = sb.json?.events?.[0]?.id;
  let pf = new Set();
  if (eid) {
    const comp = sb.json.events[0].competitions[0].id;
    const plays = await get(`${CORE}/events/${eid}/competitions/${comp}/plays?limit=350`);
    const items = plays.json?.items || [];
    pf = playFields(items);
    console.log(`B. play-by-play (event ${eid}): status=${plays.status}, ${items.length} plays, ${pf.size} distinct fields`);
    const interesting = [...pf].filter(k => /yard|air|down|distance|type|clock|start|end|stat|team/i.test(k));
    console.log(`   play fields (filtered): ${interesting.slice(0, 24).join(', ')}\n`);
  } else {
    console.log('B. play-by-play: could not resolve an event id\n');
  }

  // ── the classification, field by field ─────────────────────────────────────
  const namesLc = new Set([...names].map(n => n.toLowerCase()));
  const pfLc = new Set([...pf].map(n => n.toLowerCase()));
  const has = (set, ...needles) => [...set].some(k => needles.every(nd => k.includes(nd.toLowerCase())));

  // What ESPN box stats cover (EQUIVALENT), and what play primitives enable (DERIVABLE).
  const verdict = (col) => {
    const c = col.toLowerCase();
    // Plain box-score quantities ESPN publishes directly.
    if (['attempts','targets','receptions','rushattempts'].includes(c)) return ['EQUIVALENT','ESPN box stat'];
    if (c === 'catchpct') return ['EQUIVALENT','ESPN box (receptions/targets)'];
    // Air-yards family: derivable IF play-by-play carries per-pass air yards.
    if (c.includes('airyards') || c === 'avgcompletedairyards' || c === 'pctshareintendedairyards')
      return has(pfLc, 'airyard') || has(pfLc, 'air')
        ? ['DERIVABLE','play-level air yards present']
        : ['ABSENT','ESPN PBP carries no air-yards field'];
    // Everything else in NGS is tracking- or model-derived.
    if (['avgseparation','avgcushion','avgtimetothrow','avgtimetolos','efficiency','pctvsstacked'].includes(c))
      return ['ABSENT','needs 10Hz tracking (x/y) — not in any ESPN feed'];
    if (['cpoe','xcomppct','avgexpectedyac','avgyacaboveexp','rushydsoverexp','rushydsoverexpperatt','expectedrushyds','aggressiveness'].includes(c))
      return ['ABSENT','needs the NGS expectation model'];
    if (c === 'avgyac') return has(pfLc,'yardsafter') ? ['DERIVABLE','ESPN YAC present'] : ['ABSENT','no YAC field in ESPN PBP'];
    return ['ABSENT','unmapped'];
  };

  let eq=0, dv=0, ab=0;
  for (const [group, cols] of Object.entries(NGS)) {
    console.log(`── ${group} ──`);
    for (const col of cols) {
      const [v, why] = verdict(col);
      if (v==='EQUIVALENT') eq++; else if (v==='DERIVABLE') dv++; else ab++;
      console.log(`  ${v.padEnd(11)} ${col.padEnd(24)} ${why}`);
    }
  }
  console.log(`\nTOTALS: EQUIVALENT=${eq}  DERIVABLE=${dv}  ABSENT=${ab}  (of ${eq+dv+ab} NGS metric fields)`);
  console.log('EQUIVALENT+DERIVABLE = free from ESPN. ABSENT = only via nflverse (which republishes it CC-BY).');
  process.exit(0);
})();
