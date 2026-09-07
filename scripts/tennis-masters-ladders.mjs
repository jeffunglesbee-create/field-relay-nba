// What does the DEPLOYED draw route produce for a tier that is not a slam?
//
// The shape probe read BSD directly and reported Masters ladders like
// R128=35 R64=32 and R128=32 R64=34. Those are pre-exclusion numbers — that
// probe does not drop cancelled rows and the route does, so a 34 there may be
// 32 here. The question this answers cannot be answered from that probe.
//
// WHAT IS BEING TESTED. `canonical` on the route is 1 << (6 - roundIndex): a
// 128 ladder. A Masters is a 96 draw (32 byes) or a 56 draw, so its ENTRY round
// holds ~32 matches and the route calls that 29 short of a full round. The
// client renders that as "Round of 128 holds 35 matches where 64 make a full
// round", which is a false claim about missing matches, on every Masters, for
// roughly 44 weeks of the year.
//
// THE MODEL BEING CHECKED: every round EXCEPT the outermost one present holds
// exactly 2^(levels above the final) — 1, 2, 4, 8, 16, 32 — whatever the draw
// size, because byes only ever affect the entry round. If that holds on all ten
// editions after cancelled rows are excluded, `canonical` belongs on every
// round but the entry one, and the entry round's size is not a defect.
//
// A single edition breaking it refutes the model, and the output says which.

import fs from 'node:fs';

const RELAY = process.env.RELAY_BASE || 'https://field-relay-nba.jeffunglesbee.workers.dev';
const TS = new Date().toISOString();
const ORDER = ['Round of 128', 'Round of 64', 'Round of 32', 'Round of 16',
               'Quarterfinals', 'Semifinals', 'Final'];
// The ten masters_1000 ids, read from the 2026-09-06 category probe against a
// census of 637 tournaments. Not typed from memory.
const MASTERS = [
  [63, 'ATP Madrid Masters'], [67, 'ATP Rome Masters'], [130, 'Cincinnati'],
  [42, 'Indian Wells'], [45, 'Miami'], [56, 'Monte Carlo'],
  [693, 'Montreal'], [196, 'Paris'], [175, 'Shanghai'], [125, 'Toronto'],
];
const out = { ts: TS, relay: RELAY, editions: [] };

(async () => {
  console.log(`=== tennis-masters-ladders  utc=${TS} ===\n`);
  let held = 0, refuted = 0, unread = 0;

  for (const [tid, name] of MASTERS) {
    // No season: the route defaults to the latest it holds, which is the
    // edition a reader would be shown.
    const r = await fetch(`${RELAY}/bsd/tennis/draw?tournament=${tid}`,
                          { signal: AbortSignal.timeout(60000) });
    const text = await r.text();
    let d; try { d = JSON.parse(text); } catch {}
    const rec = { tid, name, status: r.status };
    out.editions.push(rec);
    if (r.status !== 200 || !d) {
      unread++;
      rec.body = text.slice(0, 300);
      console.log(`${String(tid).padStart(4)} ${name.padEnd(20)} HTTP ${r.status}  ${text.slice(0, 160)}`);
      continue;
    }
    const rounds = (d.rounds || []).slice().sort((a, b) => a.index - b.index);
    rec.season = d.season;
    rec.ladder = rounds.map((x) => `${x.round.replace('Round of ', 'R')}=${x.matches}`);
    rec.anomalies = (d.anomalies || []).map((a) => `${a.kind}${a.round ? ':' + a.round : ''}`);
    rec.mainDrawMatches = d.mainDrawMatches;
    rec.edges = (d.edges || []).length;

    // THE MODEL. Every round after the outermost present one must equal
    // 2^(levels above the final).
    const entry = rounds[0];
    const inner = rounds.slice(1);
    const bad = inner.filter((x) => x.matches !== (1 << (ORDER.length - 1 - x.index)));
    rec.entryRound = entry ? { round: entry.round, matches: entry.matches } : null;
    rec.innerRoundsOffModel = bad.map((x) => `${x.round}=${x.matches} want ${1 << (ORDER.length - 1 - x.index)}`);
    if (bad.length) refuted++; else held++;

    // What the route CURRENTLY calls off-canonical, which is the noise.
    const falseAnomalies = rounds.filter((x) => x === entry && x.matches !== x.canonical)
                                 .map((x) => `${x.round}: ${x.matches} vs canonical ${x.canonical}`);
    rec.entryRoundCalledAnomalous = falseAnomalies;

    console.log(`${String(tid).padStart(4)} ${name.padEnd(20)} ${d.season}  ${rec.ladder.join(' ')}`);
    console.log(`     entry: ${entry ? entry.round + '=' + entry.matches : '-'}`
              + `   inner off model: ${bad.length ? rec.innerRoundsOffModel.join(', ') : 'none'}`);
    if (falseAnomalies.length) console.log(`     route currently flags the ENTRY round: ${falseAnomalies.join('; ')}`);
    if (rec.anomalies.length) console.log(`     anomalies: ${rec.anomalies.join(', ')}`);
  }

  out.summary = { checked: MASTERS.length, modelHeld: held, modelRefuted: refuted, unread };
  console.log(`\nCOVERAGE: ${MASTERS.length} masters_1000 id(s) of 10 in that category,`
            + ` from a census of 637 tournaments. wta_1000, atp_500 and below are UNCHECKED.`);
  console.log(`model held on ${held}, refuted on ${refuted}, unread ${unread}`);
  console.log(refuted === 0 && held > 0
    ? '\nVERDICT: every round after the entry round is 2^(levels above the final).'
    + ' `canonical` belongs on those rounds and NOT on the entry round.'
    : refuted > 0
      ? `\nVERDICT: REFUTED on ${refuted} edition(s) — the model is wrong, see innerRoundsOffModel`
      : '\nVERDICT: UNKNOWN — nothing was read');

  fs.mkdirSync('outbox', { recursive: true });
  const body = JSON.stringify(out, null, 2);
  fs.writeFileSync(`outbox/tennis-masters-ladders-${TS.replace(/[:.]/g, '-')}.json`, body);
  fs.writeFileSync('outbox/tennis-masters-ladders-latest.json', body);
  process.exit(0);
})().catch((e) => { console.error('failed:', e.stack); process.exit(1); });
