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
  // THE FIRST VERSION LOOKED ONLY AT THE TOP LEVEL AND REPORTED ZERO DRAWS FOR
  // EVERY SOCCER ROW, INCLUDING ONES THE CC-CMD SAYS CARRY ONE. The real payload
  // nests the prices: {"source":"draftkings","moneyline":{"home":-210,"away":160}}.
  // A false zero here would have "confirmed" the 2026-08-23 two-way finding on
  // rows that are fine, which is worse than missing it.
  const pools = [odds, odds.moneyline, odds.h2h, odds.threeWay, odds.three_way].filter(
    p => p && typeof p === 'object');
  return pools.some(p => ['draw', 'draw_odds', 'drawOdds', 'tie', 'x'].some(
    k => p[k] !== undefined && p[k] !== null));
};

/** Which of four states an (opening, closing) pair is in.
 *
 *  jubilant-bassoon's movement line claims "unchanged from open" or a points
 *  shift, and both are claims about CHANGE — which needs two observations in a
 *  known order. ODDS-PROOF.md records 2026-08-09, when the "closing" snapshot
 *  was captured ~22 SECONDS BEFORE the opening one. Counting only how many rows
 *  HAVE a closing snapshot cannot see that; it looked like full coverage.
 *
 *  'none'        — no closing snapshot at all
 *  'untimed'     — a closing snapshot, but at least one captured_at missing or
 *                  unparseable, so the order cannot be verified
 *  'outOfOrder'  — both timestamped, closing NOT strictly after opening
 *  'sequence'    — both timestamped, closing strictly after opening
 */
export const sequenceOf = (o, c) => {
  if (!c) return 'none';
  const ot = o && o.captured_at ? Date.parse(o.captured_at) : NaN;
  const ct = c && c.captured_at ? Date.parse(c.captured_at) : NaN;
  if (!Number.isFinite(ot) || !Number.isFinite(ct)) return 'untimed';
  return ct > ot ? 'sequence' : 'outOfOrder';
};

export const summarise = rows => {
  const by = {};
  for (const g of rows) {
    const sport = g.sport ?? '(null)';
    const b = by[sport] = by[sport] || { rows: 0, withOpening: 0, withClosing: 0, withDraw: 0,
                                        seq: 0, untimed: 0, outOfOrder: 0, sample: null };
    b.rows++;
    let o = g.opening_odds;
    if (typeof o === 'string') { try { o = JSON.parse(o); } catch { o = null; } }
    let c = g.closing_odds;
    if (typeof c === 'string') { try { c = JSON.parse(c); } catch { c = null; } }
    if (o) { b.withOpening++; if (hasDraw(o)) b.withDraw++; if (!b.sample) b.sample = o; }
    if (c) b.withClosing++;
    const state = sequenceOf(o, c);
    if (state === 'sequence') b.seq++;
    else if (state === 'untimed') b.untimed++;
    else if (state === 'outOfOrder') b.outOfOrder++;
  }
  return by;
};

if (SELF_TEST) {
  check('a row with no odds counts as a row only',
    summarise([{ sport: 'MLS' }]).MLS.withOpening === 0);
  check('a JSON-STRING odds column is parsed, not treated as absent',
    summarise([{ sport: 'MLS', opening_odds: '{"home":100,"draw":240,"away":260}' }]).MLS.withOpening === 1,
    'D1 returns JSON columns as strings; treating them as absent would report a false zero');
  check('a draw price is detected at the top level', hasDraw({ home: 1, draw: 2, away: 3 }));
  // The shape the relay actually stores, read from a real committed payload.
  check('a draw price is detected INSIDE moneyline, the shape the relay stores',
    hasDraw({ source: 'draftkings', moneyline: { home: 150, draw: 240, away: 200 } }),
    'the first version missed this and reported zero draws for every soccer row');
  check('MUTATION: a nested TWO-WAY moneyline still reports no draw',
    hasDraw({ source: 'draftkings', moneyline: { home: -210, away: 160 } }) === false,
    'if nesting made everything look three-way the check would have no teeth at all');
  // MUTATION: the whole point of the three-outcome check.
  check('MUTATION: a two-way soccer payload is NOT counted as having a draw',
    hasDraw({ home: 1, away: 3 }) === false,
    'a two-way payload counted as three-way would smooth over the 2026-08-23 finding');
  check('null odds are not a draw', hasDraw(null) === false);
  check('no closing snapshot is not a sequence', sequenceOf({ captured_at: '2026-09-11T10:00:00Z' }, null) === 'none');
  check('a closing snapshot strictly later IS a sequence',
    sequenceOf({ captured_at: '2026-09-11T10:00:00Z' }, { captured_at: '2026-09-11T11:00:00Z' }) === 'sequence');
  check('MUTATION: closing captured 22s BEFORE opening is out of order, not a sequence',
    sequenceOf({ captured_at: '2026-09-11T10:01:39Z' }, { captured_at: '2026-09-11T10:01:17Z' }) === 'outOfOrder',
    'this is the literal 2026-08-09 ODDS-PROOF defect — counting withClosing alone called it full coverage');
  check('MUTATION: identical timestamps are ONE observation, not a sequence',
    sequenceOf({ captured_at: '2026-09-11T10:00:00Z' }, { captured_at: '2026-09-11T10:00:00Z' }) === 'outOfOrder');
  check('a missing captured_at leaves the order unverifiable',
    sequenceOf({}, { captured_at: '2026-09-11T11:00:00Z' }) === 'untimed');
  check('an unparseable captured_at leaves the order unverifiable',
    sequenceOf({ captured_at: 'whenever' }, { captured_at: '2026-09-11T11:00:00Z' }) === 'untimed');
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
  console.log('  sport label            rows  opening  closing  draw   seq  untimed  outOfOrder');
  for (const s of names) {
    const b = by[s];
    console.log(`  ${s.padEnd(22)} ${String(b.rows).padStart(4)} ${String(b.withOpening).padStart(8)} ${String(b.withClosing).padStart(8)} ${String(b.withDraw).padStart(5)}`
              + ` ${String(b.seq).padStart(5)} ${String(b.untimed).padStart(8)} ${String(b.outOfOrder).padStart(11)}`);
  }
  // seq + untimed + outOfOrder should equal closing. Printed, not asserted:
  // a mismatch is a finding about the data, not a reason to hide the row.
  const tot = names.reduce((a, s) => ({ closing: a.closing + by[s].withClosing,
    seq: a.seq + by[s].seq, untimed: a.untimed + by[s].untimed, ooo: a.ooo + by[s].outOfOrder }),
    { closing: 0, seq: 0, untimed: 0, ooo: 0 });
  console.log(`\n  of ${tot.closing} closing snapshot(s): ${tot.seq} a verified sequence, `
            + `${tot.untimed} unverifiable, ${tot.ooo} out of order`
            + (tot.seq + tot.untimed + tot.ooo === tot.closing ? '' : '   ← DOES NOT SUM TO closing'));
  const sample = names.map(s => by[s].sample).find(Boolean);
  if (sample) console.log(`\n  one real opening_odds payload: ${JSON.stringify(sample).slice(0, 220)}`);
  console.log(`\n  checked ${names.length} distinct sport label(s) on this date — every label present, not a sample`);
}

process.exit(failed === 0 ? 0 : 1);
