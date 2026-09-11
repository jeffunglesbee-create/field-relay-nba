// Per-sport odds coverage on a real date, read from the live relay.
//
// WHY: CC-CMD-2026-09-11 attributes "MLS 0 rows with odds" to the ambient
// ODDS_SPORT_KEYS map being six sports. `git log -L 67,80:src/ambient-do.js`
// shows that map was created in 043f4d6 with ELEVEN entries INCLUDING
// `mls: 'soccer_usa_mls'`, and those lines have never changed. The stated cause
// cannot be the cause, so the real one has to be measured rather than assumed.
//
// This reports, per sport on a date: rows, rows with opening odds, rows with a
// draw price, and THE DISTINCT `sport` LABELS SEEN — because a label the odds
// lookup cannot resolve (`MLS Soccer` where the map is keyed `mls`) produces
// exactly the observed symptom, and this repo has already had that defect once
// in briefs.sport.

const RELAY = process.env.RELAY_BASE || 'https://field-relay-nba.jeffunglesbee.workers.dev';
const DATES = (process.argv.find(a => a.startsWith('--dates='))?.split('=')[1] || '').split(',').filter(Boolean);
const SELF_TEST = process.argv.includes('--self-test');

let failed = 0;
const check = (n, ok, d) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}`); if (!ok) { failed++; if (d) console.log(`      → ${d}`); } };

/** Draw price present? Soccer is three-outcome; a two-way payload is the 2026-08-23 defect. */
export const hasDraw = odds => {
  if (!odds || typeof odds !== 'object') return false;
  return ['draw', 'draw_odds', 'drawOdds', 'tie'].some(k => odds[k] !== undefined && odds[k] !== null);
};

export const summarise = rows => {
  const by = {};
  for (const g of rows) {
    const sport = g.sport ?? '(null)';
    const b = by[sport] = by[sport] || { rows: 0, withOpening: 0, withClosing: 0, withDraw: 0, sample: null };
    b.rows++;
    let o = g.opening_odds;
    if (typeof o === 'string') { try { o = JSON.parse(o); } catch { o = null; } }
    let c = g.closing_odds;
    if (typeof c === 'string') { try { c = JSON.parse(c); } catch { c = null; } }
    if (o) { b.withOpening++; if (hasDraw(o)) b.withDraw++; if (!b.sample) b.sample = o; }
    if (c) b.withClosing++;
  }
  return by;
};

if (SELF_TEST) {
  check('a row with no odds counts as a row only',
    summarise([{ sport: 'MLS' }]).MLS.withOpening === 0);
  check('a JSON-STRING odds column is parsed, not treated as absent',
    summarise([{ sport: 'MLS', opening_odds: '{"home":100,"draw":240,"away":260}' }]).MLS.withOpening === 1,
    'D1 returns JSON columns as strings; treating them as absent would report a false zero');
  check('a draw price is detected', hasDraw({ home: 1, draw: 2, away: 3 }));
  // MUTATION: the whole point of the three-outcome check.
  check('MUTATION: a two-way soccer payload is NOT counted as having a draw',
    hasDraw({ home: 1, away: 3 }) === false,
    'a two-way payload counted as three-way would smooth over the 2026-08-23 finding');
  check('null odds are not a draw', hasDraw(null) === false);
  check('distinct labels are kept apart',
    Object.keys(summarise([{ sport: 'MLS' }, { sport: 'MLS Soccer' }])).length === 2,
    'a label the odds map cannot resolve must be visible AS a distinct label');
  console.log(`\n${failed === 0 ? 'SELF-TEST PASS' : `${failed} FAILING`}`);
  process.exit(failed === 0 ? 0 : 1);
}

if (!DATES.length) { console.error('pass --dates=YYYY-MM-DD,... or --self-test'); process.exit(1); }

for (const date of DATES) {
  const url = `${RELAY}/context/date/${date}`;
  let body;
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(25000) });
    const text = await r.text();
    if (!r.ok) { console.log(`\n${date}: HTTP ${r.status} — ${text.slice(0, 120)}`); failed++; continue; }
    body = JSON.parse(text);
  } catch (e) { console.log(`\n${date}: ERR ${e.message}`); failed++; continue; }

  const games = body?.games ?? {};
  const rows = [...(games.regular || []), ...(games.postseason || [])];
  console.log(`\n=== ${date} — ${rows.length} row(s) across regular+postseason`);
  const by = summarise(rows);
  const names = Object.keys(by).sort();
  console.log('  sport label            rows  opening  closing  draw');
  for (const s of names) {
    const b = by[s];
    console.log(`  ${s.padEnd(22)} ${String(b.rows).padStart(4)} ${String(b.withOpening).padStart(8)} ${String(b.withClosing).padStart(8)} ${String(b.withDraw).padStart(5)}`);
  }
  const sample = names.map(s => by[s].sample).find(Boolean);
  if (sample) console.log(`\n  one real opening_odds payload: ${JSON.stringify(sample).slice(0, 220)}`);
  console.log(`\n  checked ${names.length} distinct sport label(s) on this date — every label present, not a sample`);
}

process.exit(failed === 0 ? 0 : 1);
