#!/usr/bin/env node
// READ-ONLY. Where did the 22 archived captured_at values come from?
//
// RULE 42. Three readings were on the table and all three were argued from
// timestamps: the history row acquired a snapshot_time later, a later run wrote
// the blob, the JOIN paired the wrong rows. A fourth round of timestamp
// archaeology would produce a fourth reading.
//
// What the rows are literally showing is two DIFFERENT SHAPES in one column:
//
//     2026-08-22T10:00:52.499Z    milliseconds  — JS new Date().toISOString()
//     2026-08-22T23:54:46Z        whole seconds — the vendor's own form
//
// Shape is provenance, and it is in the data rather than in a story about it.
// So this probe stops asking WHEN and asks two questions it can settle:
//
//   A. FORMAT CENSUS. How many snapshot_time values carry milliseconds, and how
//      many archived captured_at values do? If the ms-form appears in
//      odds_history at all, `new Date()` output has been written INTO that
//      column and the writer is not reading a vendor measurement.
//
//   B. THE PRICES, WHICH NOTHING HAS LOOKED AT YET. For each of the 22: does
//      the blob's moneyline equal the history row's moneyline?
//        match   -> same capture event, so the row was REWRITTEN in place and
//                   INSERT OR IGNORE is not the only writer of odds_history
//        differ  -> two different captures, so the blob never came from this row
//      One comparison, and it decides between the readings without a clock.
//
// NO WRITE PATH. SELECT only, enforced.
import { writeFileSync } from 'node:fs';

const RELAY = process.env.RELAY_BASE || 'https://field-relay-nba.jeffunglesbee.workers.dev';
const GATE = process.env.RELAY_SHARED_SECRET;
const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const log = [];
const say = (s) => { console.log(s); log.push(s); };

async function d1(sql, params = []) {
  if (!GATE) throw new Error('RELAY_SHARED_SECRET is not set');
  if (!/^\s*SELECT\b/i.test(sql)) throw new Error('this probe issues SELECT only');
  const res = await fetch(`${RELAY}/d1/execute`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-FIELD-Relay': GATE, 'User-Agent': UA },
    body: JSON.stringify({ sql, params }),
  });
  const b = await res.json().catch(() => ({}));
  if (!res.ok || b.success === false) throw new Error(`d1 HTTP ${res.status}: ${JSON.stringify(b).slice(0, 400)}`);
  return b.results || [];
}

const ARCHIVE = `SELECT id, closing_odds, opening_odds FROM regular_season_games WHERE closing_odds IS NOT NULL
                 UNION ALL
                 SELECT id, closing_odds, opening_odds FROM postseason_games     WHERE closing_odds IS NOT NULL`;
// A millisecond fraction is what new Date().toISOString() adds and what the
// vendor's whole-second form does not have.
const MS_FORM = `GLOB '*.[0-9][0-9][0-9]Z'`;

(async () => {
  say(`=== captured_at provenance  relay=${RELAY}  utc=${new Date().toISOString()} ===`);

  // --- A. format census
  const ohFmt = await d1(
    `SELECT CASE WHEN snapshot_time ${MS_FORM} THEN 'milliseconds (new Date)' ELSE 'whole seconds (vendor)' END AS shape,
            COUNT(*) AS n, MIN(snapshot_time) AS lo, MAX(snapshot_time) AS hi
       FROM odds_history GROUP BY shape ORDER BY n DESC`);
  say(`\n--- A1. odds_history.snapshot_time by shape`);
  for (const r of ohFmt) say(`    ${String(r.shape).padEnd(26)} ${String(r.n).padStart(5)}   ${r.lo} .. ${r.hi}`);

  const arFmt = await d1(
    `SELECT CASE WHEN json_extract(g.closing_odds,'$.captured_at') ${MS_FORM}
                 THEN 'milliseconds (new Date)' ELSE 'whole seconds (vendor)' END AS shape,
            COUNT(*) AS n
       FROM (${ARCHIVE}) g GROUP BY shape ORDER BY n DESC`);
  say(`\n--- A2. archived closing_odds.captured_at by shape (all rows, not just the 22)`);
  for (const r of arFmt) say(`    ${String(r.shape).padEnd(26)} ${String(r.n).padStart(5)}`);

  // --- B. the prices
  const rows = await d1(
    `SELECT g.id,
            json_extract(g.closing_odds,'$.captured_at')     AS blob_at,
            json_extract(g.closing_odds,'$.moneyline.home')  AS blob_home,
            json_extract(g.closing_odds,'$.moneyline.away')  AS blob_away,
            json_extract(g.closing_odds,'$.total.over')      AS blob_total,
            json_extract(g.closing_odds,'$.source')          AS blob_source,
            json_extract(g.opening_odds,'$.captured_at')     AS open_at,
            oh.id AS oh_id, oh.snapshot_time, oh.snapshot_type,
            oh.home_ml, oh.away_ml, oh.over_under, oh.bookmaker, oh.commence_time
       FROM (${ARCHIVE}) g
       JOIN odds_history oh ON oh.game_id = g.id
      WHERE json_extract(g.closing_odds,'$.captured_at') <> oh.snapshot_time
      ORDER BY blob_at DESC`);

  let same = 0, differ = 0, unreadable = 0;
  const shown = [];
  for (const r of rows) {
    const bh = r.blob_home, ah = r.home_ml, ba = r.blob_away, aa = r.away_ml;
    if (bh == null || ah == null) { unreadable++; continue; }
    const pricesMatch = Number(bh) === Number(ah) && Number(ba) === Number(aa);
    if (pricesMatch) same++; else differ++;
    if (shown.length < 8) shown.push(
      `    ${r.id}\n`
      + `      blob     ${r.blob_at}  ml ${bh}/${ba}  ou ${r.blob_total}  src ${r.blob_source}\n`
      + `      history  ${r.snapshot_time} (${r.snapshot_type})  ml ${ah}/${aa}  ou ${r.over_under}  bk ${r.bookmaker}\n`
      + `      opening  ${r.open_at}\n`
      + `      oh.id    ${r.oh_id}   commence ${r.commence_time}\n`
      + `      -> prices ${pricesMatch ? 'MATCH — same capture, so the row was rewritten'
                                       : 'DIFFER — the blob is a different capture'}`);
  }

  say(`\n--- B. do the prices agree, for the ${rows.length} row(s) whose timestamps do not?`);
  say(`    prices MATCH  (same capture event, row rewritten since) : ${same}`);
  say(`    prices DIFFER (blob is a different capture entirely)    : ${differ}`);
  say(`    unreadable (a moneyline missing on one side)            : ${unreadable}`);
  for (const s of shown) say(s);

  // --- C. does the blob's captured_at match the OPENING blob's instead?
  const openMatch = await d1(
    `SELECT COUNT(*) AS n FROM (${ARCHIVE}) g
       JOIN odds_history oh ON oh.game_id = g.id
      WHERE json_extract(g.closing_odds,'$.captured_at') <> oh.snapshot_time
        AND json_extract(g.closing_odds,'$.captured_at') = json_extract(g.opening_odds,'$.captured_at')`);
  say(`\n--- C. of those, how many carry the SAME captured_at as their own opening_odds`);
  say(`    ${openMatch[0]?.n ?? 0} of ${rows.length}`);
  say(`    (one snapshot written to two columns is the shape the 2026-08-21 guard`);
  say(`     was added to stop; it is checked here rather than assumed either way.)`);

  say(`\nCOVERAGE: A1 counts every odds_history row; A2 every archived closing line`);
  say(`    in both tables. B and C cover all ${rows.length} rows whose captured_at differs`);
  say(`    from their joined snapshot_time — no sampling; at most 8 are printed.`);

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const path = `outbox/captured-at-provenance-${stamp}.log`;
  writeFileSync(path, log.join('\n') + '\n');
  console.log(`\nwrote ${path}`);
})().catch(e => { console.error('FAIL:', e.message); process.exit(1); });
