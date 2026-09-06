// Does the deployed /bsd/tennis/draw actually assemble a draw?
//
// Rule 89: every assertion below names the artifact that proves it. Not
// "the route returns a bracket" — a specific ladder, a specific edge count
// derived from the response's own nodes, and a named champion.
//
// Rule 90: each assertion is paired with the mutation that would break it,
// stated in the assertion itself rather than in a comment, so a check that
// cannot fail is visible from its own output.
//
// Rule 91: coverage is printed beside every result. This checks THREE
// editions of 636 tournaments. That denominator appears in the output.

import fs from 'node:fs';

const RELAY = process.env.RELAY_BASE || 'https://field-relay-nba.jeffunglesbee.workers.dev';
const TS = new Date().toISOString();
const out = { ts: TS, relay: RELAY, checks: [], editions: [] };
let failed = 0;

const check = (name, ok, detail = '') => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name}${ok || !detail ? '' : `\n         → ${detail}`}`);
  out.checks.push({ name, ok, detail: ok ? undefined : detail });
  if (!ok) failed++;
};

async function get(path) {
  const r = await fetch(`${RELAY}${path}`, { signal: AbortSignal.timeout(60000) });
  const text = await r.text();
  let json; try { json = JSON.parse(text); } catch {}
  return { status: r.status, json, text };
}

// The three editions this was measured against on 2026-09-06, with the ladder
// each one actually has. A ladder written from what a slam SHOULD look like
// would be 64/32/16/8/4/2/1 and would fail on five of the six read.
// LADDERS AFTER CANCELLED ROWS ARE EXCLUDED. The first version of this table
// read 65/31 and 66/32 for the first two rounds, which is what BSD serves
// before the withdrawal rows are taken out. Measured 2026-09-06 across five
// editions: every duplicate first-round row is a cancelled fixture beside its
// finished replacement, six of six, none with two live rows.
//
// So the first round is 64 everywhere. US Open Men 2025's Round of 64 stays at
// 31 — that one is a row BSD genuinely does not serve, and writing 32 here to
// make the table tidy would be the smoothing this route exists to refuse.
const EXPECT = [
  { tid: 135, season: '2025', name: 'US Open, Men',
    ladder: [64, 31, 16, 8, 4, 2, 1] },
  { tid: 77, season: '2026', name: 'Roland Garros',
    ladder: [64, 32, 16, 8, 4, 2, 1] },
  { tid: 14, season: '2026', name: 'Australian Open',
    ladder: [64, 32, 16, 8, 4, 2, 1] },
];
const ORDER = ['Round of 128', 'Round of 64', 'Round of 32', 'Round of 16',
               'Quarterfinals', 'Semifinals', 'Final'];

(async () => {
  console.log(`=== verify-tennis-draw  utc=${TS}  relay=${RELAY} ===\n`);

  // ── the guards, first. A route whose happy path works and whose guards do
  //    not is a route that will forward an unfiltered page the first time a
  //    caller mistypes a parameter.
  const noTid = await get('/bsd/tennis/draw');
  check('a missing tournament is a 400, not an unfiltered page',
        noTid.status === 400, `got ${noTid.status}: ${noTid.text.slice(0, 200)}`);
  const badSeason = await get('/bsd/tennis/draw?tournament=135&season=25');
  check('a two-digit season is a 400', badSeason.status === 400,
        `got ${badSeason.status}: ${badSeason.text.slice(0, 200)}`);
  const badTid = await get('/bsd/tennis/draw?tournament=abc');
  check('a non-numeric tournament is a 400', badTid.status === 400,
        `got ${badTid.status}: ${badTid.text.slice(0, 200)}`);

  for (const e of EXPECT) {
    console.log(`\n── ${e.tid} ${e.name} ${e.season} ──`);
    const r = await get(`/bsd/tennis/draw?tournament=${e.tid}&season=${e.season}`);
    const d = r.json;
    const rec = { tid: e.tid, season: e.season, status: r.status };
    out.editions.push(rec);
    if (r.status !== 200 || !d) {
      check(`${e.tid}/${e.season} answers 200`, false, `${r.status}: ${r.text.slice(0, 400)}`);
      continue;
    }
    check(`${e.tid}/${e.season} answers 200`, true);

    // THE LADDER, exactly. Not "seven rounds are present" — the counts.
    const got = ORDER.map((rn) => (d.rounds || []).find((x) => x.round === rn)?.matches ?? 0);
    rec.ladder = got;
    check(`${e.tid}/${e.season} ladder is ${e.ladder.join('/')}`,
          JSON.stringify(got) === JSON.stringify(e.ladder),
          `got ${got.join('/')}`);

    // The response's node list and its round table must agree. They are
    // computed from the same array, so a disagreement means one of them is
    // being built from something else.
    const nodesPerRound = ORDER.map((rn) => (d.nodes || []).filter((n) => n.round === rn).length);
    check(`${e.tid}/${e.season} the round table counts the nodes it shipped`,
          JSON.stringify(nodesPerRound) === JSON.stringify(got),
          `rounds=${got.join('/')} nodes=${nodesPerRound.join('/')}`);

    // EVERY EDGE IS RE-DERIVED FROM THE NODES THE RESPONSE SHIPPED. This is
    // the assertion that matters: the relay's join is recomputed here from
    // its own output, so an edge it invented has nowhere to hide.
    const byId = new Map((d.nodes || []).map((n) => [n.id, n]));
    let wrongEdge = null, edgesRederived = 0;
    for (const ed of d.edges || []) {
      const from = byId.get(ed.from), to = byId.get(ed.to);
      if (!from || !to) { wrongEdge = `edge ${ed.from}->${ed.to} names a node not in the response`; break; }
      if (from.winnerId !== ed.playerId) { wrongEdge = `edge ${ed.from}->${ed.to} carries player ${ed.playerId}, but ${ed.from}'s winner is ${from.winnerId}`; break; }
      if (to.p1?.id !== ed.playerId && to.p2?.id !== ed.playerId) { wrongEdge = `player ${ed.playerId} is not in match ${ed.to}`; break; }
      if (to.roundIndex !== from.roundIndex + 1) { wrongEdge = `edge ${ed.from}->${ed.to} skips a round`; break; }
      edgesRederived++;
    }
    rec.edges = (d.edges || []).length;
    rec.edgesRederived = edgesRederived;
    check(`${e.tid}/${e.season} all ${rec.edges} edges re-derive from the shipped nodes`,
          wrongEdge === null && edgesRederived === rec.edges, wrongEdge || 'none re-derived');

    // ...and no edge is MISSING. The check above passes on an empty edge list,
    // which is the vacuous-forall hole this repo has filled three times.
    let expectedEdges = 0;
    for (const n of d.nodes || []) {
      if (n.winnerId == null || n.roundIndex < 0 || n.roundIndex === 6) continue;
      const next = (d.nodes || []).filter((x) => x.roundIndex === n.roundIndex + 1
        && (x.p1?.id === n.winnerId || x.p2?.id === n.winnerId));
      if (next.length === 1) expectedEdges++;
    }
    check(`${e.tid}/${e.season} every joinable winner produced an edge (${expectedEdges})`,
          expectedEdges > 0 && rec.edges === expectedEdges,
          `response shipped ${rec.edges}, recomputed ${expectedEdges}`);

    // A player in two matches of one round would mean two editions were mixed.
    // The route refuses this with a 409, so a 200 means it did not happen —
    // and this recomputes it rather than trusting that.
    let dup = null;
    for (const rn of ORDER) {
      const seen = new Set();
      for (const n of (d.nodes || []).filter((x) => x.round === rn)) {
        for (const pid of [n.p1?.id, n.p2?.id]) {
          if (pid == null) continue;
          if (seen.has(pid)) { dup = `player ${pid} twice in ${rn}`; break; }
          seen.add(pid);
        }
      }
      if (dup) break;
    }
    check(`${e.tid}/${e.season} no player appears twice in one round`, dup === null, dup || '');

    // The season partition held: every date in the edition is in that year.
    const strayYears = [...new Set((d.nodes || []).map((n) => String(n.date || '').slice(0, 4)))]
      .filter((y) => y && y !== e.season);
    check(`${e.tid}/${e.season} every node's date is in the requested season`,
          strayYears.length === 0, `also saw ${strayYears.join(', ')}`);

    // Anomalies are DECLARED, not hidden. Off-canonical rounds must each have
    // an entry — this is the promise the route makes about not smoothing.
    const off = (d.rounds || []).filter((x) => x.matches !== x.canonical).map((x) => x.round);
    const declared = (d.anomalies || []).filter((a) => a.kind === 'roundNotAtCanonicalSize').map((a) => a.round);
    rec.offCanonical = off;
    check(`${e.tid}/${e.season} every off-canonical round is declared an anomaly`
        + ` (${off.length ? off.join(', ') : 'none off-canonical'})`,
          off.every((x) => declared.includes(x)) && declared.every((x) => off.includes(x)),
          `off=${off.join('|')} declared=${declared.join('|')}`);

    const fin = (d.nodes || []).find((n) => n.round === 'Final');
    const champ = fin && fin.winnerId != null
      ? [fin.p1, fin.p2].find((p) => p?.id === fin.winnerId)?.name : null;
    rec.champion = champ;
    console.log(`     champion: ${champ ?? '(final unplayed)'}`
              + `  edges: ${rec.edges}  rowsRead: ${d.rowsRead}/${d.declaredCount}`
              + `  truncated: ${d.truncated}`);
    check(`${e.tid}/${e.season} the read was not truncated`, d.truncated === false,
          `rowsRead=${d.rowsRead} declared=${d.declaredCount}`);
  }

  console.log(`\nCOVERAGE: 3 editions checked, of 14 grand-slam tournament ids`
            + ` in a census of 636 tournaments. The other 633 are UNCHECKED.`);
  out.coverage = { editionsChecked: 3, grandSlamIds: 14, tournamentsInCensus: 636 };

  fs.mkdirSync('outbox', { recursive: true });
  const body = JSON.stringify(out, null, 2);
  fs.writeFileSync(`outbox/verify-tennis-draw-${TS.replace(/[:.]/g, '-')}.json`, body);
  fs.writeFileSync('outbox/verify-tennis-draw-latest.json', body);
  console.log(`\n${out.checks.filter((c) => c.ok).length}/${out.checks.length} checks passed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error('verify failed:', e.stack); process.exit(1); });
