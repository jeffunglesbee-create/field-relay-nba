// WHY is a player in two first-round matches?
//
// The player-twice guard added to /bsd/tennis/draw refused two of the three
// editions it was verified against:
//
//   135 US Open, Men 2025    player 390 in Round of 128 matches 8430 and 8423
//    14 Australian Open 2026 players 563 and 445, two R128 rows each
//    77 Roland Garros 2026   clean — 126 edges, 0 duplicates
//
// Two readings fit, and they call for opposite fixes.
//
//   (a) TWO EDITIONS LEAKED IN. The season partition failed and the guard is
//       doing exactly its job. Fix the partition.
//   (b) A CANCELLED FIXTURE WAS RESCHEDULED. One edition, one player, two rows
//       — one of them a match that was never played. The guard is too strict
//       and a cancelled row is not part of the draw.
//
// 8423 is already known to be `cancelled` — it is the Djere v Collignon row the
// shape probe printed under "rowsWithoutWinner". That makes (b) likely and does
// not make it measured: one row of five, in one of the two editions.
//
// This prints BOTH rows of every duplicate, in full, for all three editions. If
// every duplicate has exactly one cancelled row, (b) is the answer and the fix
// is to exclude cancelled rows from the draw. If any duplicate has two live
// rows, it is (a) and the partition is broken.
//
// The question decides the fix, so it is asked before the fix is written.

import fs from 'node:fs';

const BASE = process.env.BSD_BASE || 'https://sports.bzzoiro.com';
const TOKEN = process.env.BSD_API_TOKEN || '';
const TS = new Date().toISOString();
const ORDER = ['Round of 128','Round of 64','Round of 32','Round of 16','Quarterfinals','Semifinals','Final'];
const EDITIONS = [
  { tid: 135, season: '2025', name: 'US Open, Men' },
  { tid: 14,  season: '2026', name: 'Australian Open (ATP)' },
  { tid: 77,  season: '2026', name: 'Roland Garros (WTA)' },
  { tid: 76,  season: '2026', name: 'Roland Garros (ATP)' },
  { tid: 15,  season: '2026', name: 'Australian Open (WTA)' },
];
const out = { ts: TS, editions: [] };

async function pageAll(path, cap = 8) {
  let acc = [], next = path, pages = 0, declared = null;
  while (next && pages < cap) {
    const r = await fetch(`${BASE}${next}`, {
      headers: { Authorization: `Token ${TOKEN}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(30000),
    });
    if (!r.ok) break;
    const j = await r.json();
    if (declared === null) declared = j?.count ?? null;
    const rows = Array.isArray(j) ? j : (j?.results ?? []);
    if (!rows.length) break;
    acc = acc.concat(rows);
    next = j?.next ? j.next.replace(/^https?:\/\/[^/]+/, '') : null;
    pages++;
  }
  return { rows: acc, declared };
}

(async () => {
  console.log(`=== bsd-tennis-duplicate-rows  utc=${TS} ===\n`);
  if (!TOKEN) { console.error('!! no BSD_API_TOKEN — cannot ask'); process.exit(1); }

  let totalDupes = 0, dupesWithOneCancelled = 0, dupesWithTwoLive = 0;

  for (const e of EDITIONS) {
    const { rows, declared } = await pageAll(`/tennis/api/v2/matches/?tournament=${e.tid}&limit=100`);
    const edition = rows.filter((m) => String(m?.match_date ?? '').slice(0, 4) === e.season);
    const main = edition.filter((m) => ORDER.includes(String(m?.round_name)));
    const rec = { tid: e.tid, season: e.season, name: e.name,
                  rowsRead: rows.length, declared, editionRows: edition.length,
                  mainDrawRows: main.length, duplicates: [] };
    out.editions.push(rec);
    console.log(`── ${e.tid} ${e.name} ${e.season}: read ${rows.length}/${declared},`
              + ` edition ${edition.length}, main draw ${main.length}`);

    for (const rn of ORDER) {
      const group = main.filter((m) => m.round_name === rn);
      const byPlayer = new Map();
      for (const m of group) {
        for (const p of [m.player1, m.player2]) {
          if (!p?.id) continue;
          (byPlayer.get(p.id) || byPlayer.set(p.id, []).get(p.id)).push(m);
        }
      }
      for (const [pid, ms] of byPlayer) {
        if (ms.length < 2) continue;
        totalDupes++;
        const statuses = ms.map((m) => m.status);
        const cancelled = statuses.filter((s) => s === 'cancelled').length;
        const live = ms.length - cancelled;
        if (live === 1) dupesWithOneCancelled++; else dupesWithTwoLive++;
        const name = ms[0].player1?.id === pid ? ms[0].player1?.name : ms[0].player2?.name;
        rec.duplicates.push({ round: rn, playerId: pid, playerName: name,
          rows: ms.map((m) => ({ id: m.id, status: m.status, date: m.match_date,
            p1: m.player1?.name, p2: m.player2?.name, winner: m.winner_id })) });
        console.log(`   ${rn}: ${name} (#${pid}) in ${ms.length} rows`
                  + `  — ${cancelled} cancelled, ${live} not`);
        for (const m of ms) console.log(`      ${m.id}  ${String(m.status).padEnd(12)}`
                  + ` ${String(m.match_date).slice(0,10)}  ${m.player1?.name} v ${m.player2?.name}`
                  + `  winner=${m.winner_id ?? '-'}`);
      }
    }
    if (!rec.duplicates.length) console.log('   no duplicates');
  }

  out.summary = { totalDupes, dupesWithOneCancelled, dupesWithTwoLive,
                  editionsChecked: EDITIONS.length, ofGrandSlamIds: 14 };
  console.log(`\nSUMMARY across ${EDITIONS.length} editions (of 14 grand-slam ids):`);
  console.log(`  duplicate player-rounds:            ${totalDupes}`);
  console.log(`  ...where exactly one row is live:   ${dupesWithOneCancelled}`);
  console.log(`  ...where TWO OR MORE rows are live: ${dupesWithTwoLive}`);
  console.log(totalDupes === 0
    ? '\nVERDICT: no duplicates in these editions — nothing to decide'
    : dupesWithTwoLive === 0
      ? '\nVERDICT: (b) — every duplicate is a cancelled fixture beside its replacement.'
      + ' A cancelled row is not part of the draw and must be excluded before the guard runs.'
      : `\nVERDICT: (a) — ${dupesWithTwoLive} duplicate(s) have two live rows.`
      + ' Excluding cancelled rows would not be enough; the partition is wrong.');

  fs.mkdirSync('outbox', { recursive: true });
  const body = JSON.stringify(out, null, 2);
  fs.writeFileSync(`outbox/bsd-tennis-duplicate-rows-${TS.replace(/[:.]/g,'-')}.json`, body);
  fs.writeFileSync('outbox/bsd-tennis-duplicate-rows-latest.json', body);
  process.exit(0);
})().catch((e) => { console.error('probe failed:', e.stack); process.exit(1); });
