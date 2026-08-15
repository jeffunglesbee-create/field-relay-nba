// Which NGS columns does ESPN's free JSON provide? (v2 — corrected)
//
// v1 had a real bug and it is worth stating plainly (Rule 77): the air-yards and
// YAC verdicts only consulted the PLAY-BY-PLAY field set, so they read ABSENT even
// though the athlete-statistics doc plainly returns `passingYardsAtCatch` (= air
// yards) and `passingYardsAfterCatch` (= YAC). v1 undercounted what ESPN gives.
// v2 consults BOTH the athlete-stat names and the play fields, and prints the raw
// receiving/rushing stat names too so the mapping is auditable, not asserted.
//
// Also tests ESPN's open fantasy player-universe endpoint (lm-api-reads, the
// "kona" player pool) — the legitimate open ESPN fantasy surface now that NFL.com
// fantasy has migrated to ESPN. Anonymous GET only.
//
// EQUIVALENT  — ESPN returns this exact quantity.
// DERIVABLE   — ESPN returns the primitives (season totals or per-play) to compute
//               it WITHOUT tracking.
// ABSENT      — needs 10Hz x/y tracking or the proprietary NGS expectation model.

const CORE = 'https://sports.core.api.espn.com/v2/sports/football/leagues/nfl';
const UA = 'Mozilla/5.0 (compatible; FIELD-probe/1.0)';
const SEASON = 2024, TYPE = 2;

const NGS = {
  passing: ['cpoe','aggressiveness','avgTimeToThrow','avgCompletedAirYards','avgAirYardsDiff','avgAirYardsToSticks','attempts','xCompPct'],
  receiving: ['avgSeparation','avgCushion','avgYAC','avgExpectedYAC','avgYACAboveExp','pctShareIntendedAirYards','targets','receptions','catchPct'],
  rushing: ['efficiency','pctVsStacked','avgTimeToLOS','rushYdsOverExp','rushYdsOverExpPerAtt','expectedRushYds','rushAttempts'],
};

const get = async (url, hdr={}) => {
  try {
    const r = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json', ...hdr }, signal: AbortSignal.timeout(30000) });
    const t = await r.text();
    try { return { status: r.status, json: JSON.parse(t), bytes: t.length }; }
    catch { return { status: r.status, raw: t.slice(0,120), bytes: t.length }; }
  } catch (e) { return { error: e.message }; }
};

function statNames(doc) {
  const out = new Set();
  for (const c of (doc?.splits?.categories || [])) for (const s of (c.stats || [])) if (s.name) out.add(`${c.name}.${s.name}`);
  return out;
}

(async () => {
  console.log(`=== espn-vs-ngs-field-map v2  utc=${new Date().toISOString()} ===\n`);

  const a = await get(`${CORE}/seasons/${SEASON}/types/${TYPE}/athletes/3139477/statistics`); // Mahomes
  const names = a.json ? statNames(a.json) : new Set();
  const nl = new Set([...names].map(n => n.toLowerCase()));
  console.log(`A. athlete statistics: status=${a.status}, ${names.size} fields`);
  for (const grp of ['passing','receiving','rushing']) {
    const g = [...names].filter(n => n.startsWith(grp)).map(n => n.split('.')[1]);
    if (g.length) console.log(`   ${grp}: ${g.join(', ')}`);
  }

  // A receiver + a RB so receiving/rushing names are real, not inferred from a QB.
  const rec = await get(`${CORE}/seasons/${SEASON}/types/${TYPE}/athletes/4262921/statistics`); // Ja'Marr Chase
  for (const n of (rec.json ? statNames(rec.json) : [])) nl.add(n.toLowerCase());
  const rb = await get(`${CORE}/seasons/${SEASON}/types/${TYPE}/athletes/4241457/statistics`); // Bijan Robinson
  for (const n of (rb.json ? statNames(rb.json) : [])) nl.add(n.toLowerCase());

  const has = (...needles) => [...nl].some(k => needles.every(nd => k.includes(nd)));
  const airYards = has('yardsatcatch') || has('airyards');
  const yac = has('yardsaftercatch');
  console.log(`\n   air-yards primitive present: ${airYards}   YAC primitive present: ${yac}\n`);

  const verdict = (col) => {
    const c = col.toLowerCase();
    if (['attempts','targets','receptions','rushattempts'].includes(c)) return ['EQUIVALENT','ESPN box stat'];
    if (c === 'catchpct') return ['EQUIVALENT','receptions/targets'];
    // air-yards family — now checks the athlete-stat set
    if (c==='avgcompletedairyards' || c==='avgairyardstosticks' || c==='pctshareintendedairyards' || c.includes('airyards'))
      return airYards ? ['DERIVABLE','ESPN season air yards (passingYardsAtCatch) / attempts'] : ['ABSENT','no air-yards field'];
    if (c==='avgairyardsdiff') return airYards ? ['DERIVABLE','air yards − yards-to-sticks (both derivable)'] : ['ABSENT','no air-yards field'];
    if (c==='avgyac') return yac ? ['DERIVABLE','ESPN season YAC / receptions'] : ['ABSENT','no YAC field'];
    if (['avgseparation','avgcushion','avgtimetothrow','avgtimetolos','efficiency','pctvsstacked'].includes(c))
      return ['ABSENT','needs 10Hz tracking (x/y)'];
    if (['cpoe','xcomppct','avgexpectedyac','avgyacaboveexp','rushydsoverexp','rushydsoverexpperatt','expectedrushyds','aggressiveness'].includes(c))
      return ['ABSENT','needs the NGS expectation model'];
    return ['ABSENT','unmapped'];
  };

  let eq=0,dv=0,ab=0;
  for (const [grp, cols] of Object.entries(NGS)) {
    console.log(`── ${grp} ──`);
    for (const col of cols) {
      const [v,why] = verdict(col);
      v==='EQUIVALENT'?eq++:v==='DERIVABLE'?dv++:ab++;
      console.log(`  ${v.padEnd(11)} ${col.padEnd(24)} ${why}`);
    }
  }
  console.log(`\nTOTALS: EQUIVALENT=${eq}  DERIVABLE=${dv}  ABSENT=${ab}  (of ${eq+dv+ab})`);
  console.log('free-from-ESPN = EQUIVALENT+DERIVABLE = '+(eq+dv)+'; only-via-nflverse = '+ab);

  // ── ESPN open fantasy player universe (kona) ───────────────────────────────
  console.log('\n=== ESPN fantasy player-universe endpoint (anonymous) ===');
  const kona = await get(
    `https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/2024/players?scoringPeriodId=0&view=players_wl`,
    { 'x-fantasy-filter': JSON.stringify({ players: { limit: 3 } }) });
  console.log(`  status=${kona.status} bytes=${kona.bytes ?? '-'}`);
  if (kona.json) {
    const arr = Array.isArray(kona.json) ? kona.json : (kona.json.players || []);
    console.log(`  players: ${Array.isArray(arr)?arr.length:'?'}`);
    if (arr[0]) console.log('  sample keys:', Object.keys(arr[0]).slice(0,12).join(', '));
  } else if (kona.raw) console.log('  raw:', kona.raw);
  process.exit(0);
})();
