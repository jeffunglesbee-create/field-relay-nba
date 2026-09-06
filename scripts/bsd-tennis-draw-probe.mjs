// Can a tennis DRAW be reconstructed from what BSD serves?
//
// There is no bracket endpoint. The 2026-09-06 schema census read 217 declared
// paths and the tennis surface carries matches, h2h, point-by-point, players,
// rankings, tournaments and predictions — no /draw/ and no /bracket/. So a
// bracket is either derivable from matches or it is not available, and that is
// a question to measure before anyone designs one.
//
// FIVE THINGS A DRAW NEEDS. Each is checked separately, because "mostly" is not
// a bracket — a draw with one unknown edge renders wrong rather than partial.
//
//   1. Every match of one tournament, not just the live ones. If /matches/
//      cannot be filtered to a tournament and paged through its history, there
//      is nothing to build from.
//   2. A round label per match, and a vocabulary that ORDERS. "Round of 32"
//      before "Round of 16" has to be derivable, not guessed.
//   3. Round sizes that halve. 64, 32, 16, 8, 4, 2, 1. A round that does not
//      halve means byes, walkovers or missing rows, and each needs handling.
//   4. A winner per completed match. Without it no edge can be drawn.
//   5. Something that says WHICH match a winner feeds. This is the one that
//      usually does not exist — the others can be inferred, a parent link
//      cannot. Without it, edges are guessed from position, and a guessed
//      bracket is an invented one.
//
// Reports what it finds. A missing field is the FINDING, so this exits 0.

import fs from 'node:fs';

const BASE = process.env.BSD_BASE || 'https://sports.bzzoiro.com';
const TOKEN = process.env.BSD_API_TOKEN || '';
const TS = new Date().toISOString();
const out = { ts: TS, base: BASE, tokenPresent: Boolean(TOKEN), attempts: [], findings: {} };

let calls = 0;
async function get(path, note) {
  if (!TOKEN) return { blocked: 'no BSD_API_TOKEN' };
  if (calls >= 30) return { blocked: 'call budget exhausted' };
  calls++;
  try {
    const r = await fetch(`${BASE}${path}`, {
      headers: { Authorization: `Token ${TOKEN}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(30000),
    });
    const text = await r.text();
    let json; try { json = JSON.parse(text); } catch {}
    out.attempts.push({ path, note, status: r.status, bytes: text.length });
    return { status: r.status, json, bytes: text.length };
  } catch (e) { out.attempts.push({ path, note, error: String(e.message) }); return { error: e.message }; }
}

const rowsOf = (j) => (Array.isArray(j) ? j : (j?.results ?? j?.matches ?? []));

(async () => {
  console.log(`=== bsd-tennis-draw-probe  utc=${TS} ===\n`);
  if (!TOKEN) console.log('!! no token — every finding below is UNKNOWN, not false\n');

  // Find a tournament worth asking about: a Grand Slam, from the census names.
  const tj = await get('/tennis/api/v2/tournaments/?limit=100', 'find a slam');
  const tours = rowsOf(tj.json);
  const slam = tours.find((t) => /US Open, Men/i.test(t?.name || ''))
            || tours.find((t) => (t?.category || '') === 'grand_slam')
            || tours[0];
  out.findings.tournament = slam ? { id: slam.id, name: slam.name, category: slam.category } : null;
  console.log(`tournament: ${slam ? `${slam.id} ${slam.name} (${slam.category})` : 'NONE FOUND'}`);
  if (!slam) { out.findings.verdict = 'UNKNOWN — no tournament to ask about'; }

  // 1. CAN THE MATCHES BE FILTERED TO ONE TOURNAMENT?
  // Several parameter spellings, because guessing one and reporting its 400 as
  // "not supported" is how the 2026-09-06 param probe read 0 dates from 50 rows.
  let draw = [];
  if (slam) {
    for (const p of [`tournament_id=${slam.id}`, `tournament=${slam.id}`, `tournament_ids=${slam.id}`]) {
      // PAGE IT. The first run fetched limit=100 and stopped, then reported
      // "Round of 128: 37 matches" and "sizes halve: false" — but 1+2+4+8+16+32
      // is 63, and 63+37 is exactly 100. The top round was cut off by the fetch
      // and the truncation was reported as a property of the draw. A probe that
      // does not page turns its own page size into a finding.
      let acc = [];
      let path = `/tennis/api/v2/matches/?${p}&limit=100`;
      let status = null;
      for (let page = 0; page < 4 && path; page++) {
        const r = await get(path, `filter by ${p.split('=')[0]} page ${page}`);
        status = r.status ?? status;
        const rows = rowsOf(r.json);
        if (!rows.length) break;
        acc = acc.concat(rows);
        const nx = r.json?.next;
        path = nx ? nx.replace(/^https?:\/\/[^/]+/, '') : null;
      }
      const allMine = acc.length && acc.every((m) => m?.tournament?.id === slam.id);
      out.findings[`filter_${p.split('=')[0]}`] = { status, rows: acc.length, allSameTournament: Boolean(allMine) };
      console.log(`  ${p.split('=')[0].padEnd(15)} HTTP ${status}  ${acc.length} row(s)  allSameTournament=${Boolean(allMine)}`);
      if (allMine && acc.length > draw.length) draw = acc;
    }
  }
  out.findings.drawRowsFetched = draw.length;

  if (!draw.length) {
    out.findings.verdict = 'NO — matches cannot be filtered to one tournament, so there is nothing to build a draw from';
    console.log('\nVERDICT: ' + out.findings.verdict);
  } else {
    // 2. ROUND LABELS AND THEIR VOCABULARY
    const rounds = {};
    for (const m of draw) { const r = String(m?.round_name ?? '(absent)'); rounds[r] = (rounds[r] || 0) + 1; }
    out.findings.roundVocabulary = rounds;
    console.log('\nround vocabulary:');
    Object.entries(rounds).sort((a, b) => b[1] - a[1]).forEach(([k, v]) => console.log(`  ${String(v).padStart(4)} ${k}`));

    // 3. DO THE SIZES HALVE?
    const ORDER = ['Round of 128','Round of 64','Round of 32','Round of 16','Quarterfinals','Semifinals','Final'];
    // Counted across every fetched row, so this is the SERIES ladder, not one
    // draw's. The per-edition ladder is computed below and is the one that
    // should halve; reporting only this one is how "sizes halve: false" was
    // published twice about data where every round halves perfectly.
    const ladder = ORDER.filter((r) => rounds[r]).map((r) => ({ round: r, matches: rounds[r] }));
    const halves = ladder.every((x, i) => i === 0 || x.matches * 2 === ladder[i - 1].matches);
    out.findings.ladder = ladder;
    out.findings.sizesHalve = halves;
    console.log(`\nladder: ${ladder.map((x) => `${x.round}=${x.matches}`).join(' -> ') || '(none matched the known vocabulary)'}`);
    console.log(`sizes halve cleanly: ${halves}`);

    // 4. IS THERE A WINNER?
    const withWinner = draw.filter((m) => m?.winner_id != null).length;
    const finished = draw.filter((m) => /finish|complete|ended/i.test(String(m?.status || ''))).length;
    out.findings.winnerCoverage = { withWinner, finished, total: draw.length };
    console.log(`\nwinner_id present on ${withWinner} of ${draw.length} (${finished} look finished)`);

    // 5. THE ONE THAT DECIDES IT — a parent link.
    // Field names are DISCOVERED, not guessed at: every key on a match is
    // scanned for anything that could name a next match or a draw position.
    const keys = [...new Set(draw.flatMap((m) => Object.keys(m || {})))].sort();
    const linkish = keys.filter((k) => /next|parent|feeds|slot|position|seed_no|draw|bracket|node/i.test(k));
    out.findings.allMatchKeys = keys;
    out.findings.parentLinkCandidates = linkish;
    console.log(`\nmatch keys carrying a next/parent/slot/draw hint: ${linkish.length ? linkish.join(', ') : 'NONE'}`);

    // 6. THE TEST THE FIRST RUN DID NOT RUN, and the one that decides it.
    //
    // "No parent link" is not the same as "not derivable". In a single-
    // elimination draw the WINNER is the link: a player appears in at most one
    // match per round, so the winner of an R64 match appears in exactly one R32
    // match, and that is the edge — READ from the data, not inferred from
    // seeding or position. The first run's verdict said edges would have to be
    // guessed positionally. That was a claim about a join it never attempted.
    //
    // The check: for every completed match whose round has a next round, does
    // its winner appear in EXACTLY ONE match of that next round? Zero means the
    // player went out or the round is unplayed. Two or more would mean the join
    // is ambiguous and a bracket built on it would draw a false edge.
    const idxOf = (r) => ORDER.indexOf(String(r));
    const playersOf = (m) => [m?.player1?.id, m?.player2?.id].filter((x) => x != null);

    // SCOPE TO ONE EDITION FIRST. This is the third scoping defect this probe
    // has produced and the most misleading: the second run reported
    // "ambiguous on 106 matches" and a verdict of NO. The ladder said why and
    // was not read — `Final=2`. Two finals. Tournament id 15 is the Australian
    // Open SERIES, not one edition, so 400 rows spanned several years and every
    // round was doubled. A player who reached the quarter-finals in two
    // different years appears in two "Semifinals" matches, and the join called
    // that ambiguity in the data.
    //
    // It was ambiguity in the QUESTION. A draw is one tournament in one year.
    const seasonOf = (m) => String(m?.season_id ?? String(m?.match_date ?? '').slice(0, 4) ?? '?');
    const seasons = {};
    for (const m of draw) (seasons[seasonOf(m)] ??= []).push(m);
    const editions = Object.entries(seasons).sort((a, b) => b[1].length - a[1].length);
    out.findings.seasonsSeen = Object.fromEntries(editions.map(([k, v]) => [k, v.length]));
    console.log(`\nseasons in the fetched rows: ${editions.map(([k, v]) => `${k}=${v}`).join(', ')}`);
    const [editionKey, edition] = editions[0] || ['?', []];
    out.findings.editionJoined = { season: editionKey, matches: edition.length };
    console.log(`joining ONE edition: ${editionKey} (${edition.length} matches)`);

    const byRound = {};
    for (const m of edition) (byRound[String(m?.round_name)] ??= []).push(m);

    const join = { resolved: 0, championOrOut: 0, ambiguous: 0, unusableRound: 0, examples: [] };
    for (const m of edition) {
      const ri = idxOf(m?.round_name);
      if (ri < 0 || ri === ORDER.length - 1) continue;      // unknown round, or the Final
      if (m?.winner_id == null) continue;
      const next = byRound[ORDER[ri + 1]];
      if (!next || !next.length) { join.unusableRound++; continue; }
      const hits = next.filter((n) => playersOf(n).includes(m.winner_id));
      if (hits.length === 1) {
        join.resolved++;
        if (join.examples.length < 3) {
          join.examples.push(`${m.round_name} winner ${m.winner_id} -> ${ORDER[ri + 1]} match ${hits[0].id}`);
        }
      } else if (hits.length === 0) join.championOrOut++;
      else { join.ambiguous++; }
    }
    // The ladder that actually has to halve: one edition.
    const eRounds = {};
    for (const m of edition) { const r = String(m?.round_name ?? '(absent)'); eRounds[r] = (eRounds[r] || 0) + 1; }
    const eLadder = ORDER.filter((r) => eRounds[r]).map((r) => ({ round: r, matches: eRounds[r] }));
    out.findings.editionLadder = eLadder;
    out.findings.editionSizesHalve = eLadder.every((x, i) => i === 0 || x.matches * 2 === eLadder[i - 1].matches);
    console.log(`edition ladder: ${eLadder.map((x) => `${x.round}=${x.matches}`).join(' -> ')}`);
    console.log(`edition sizes halve: ${out.findings.editionSizesHalve}`);

    out.findings.winnerJoin = join;
    console.log(`\nedge join by winner identity:`);
    console.log(`  resolved to exactly one next match: ${join.resolved}`);
    console.log(`  winner absent from the next round (lost or champion): ${join.championOrOut}`);
    console.log(`  AMBIGUOUS (winner in 2+ next-round matches): ${join.ambiguous}`);
    console.log(`  next round had no rows: ${join.unusableRound}`);
    join.examples.forEach((e) => console.log(`    e.g. ${e}`));

    // Ambiguity is the disqualifier, not the absence of a parent field.
    out.findings.verdict =
      join.ambiguous > 0
        ? `NO — the winner join is ambiguous on ${join.ambiguous} match(es); an edge would be a guess`
        : join.resolved === 0
          ? 'UNKNOWN — no completed match resolved to a next-round match; nothing was actually joined'
          : `YES — ${join.resolved} edges resolve to exactly one next match by winner identity, ${join.ambiguous} ambiguous`
            + `${linkish.length ? `; a parent-link field also exists (${linkish.join(', ')})` : '; no parent-link field, and none needed'}`;
    console.log(`\nVERDICT: ${out.findings.verdict}`);
  }

  fs.mkdirSync('outbox', { recursive: true });
  const stamp = TS.replace(/[:.]/g, '-');
  const body = JSON.stringify(out, null, 2);
  fs.writeFileSync(`outbox/bsd-tennis-draw-probe-${stamp}.json`, body);
  if (out.attempts.some((a) => a.status === 200)) fs.writeFileSync('outbox/bsd-tennis-draw-probe-latest.json', body);
  console.log(`\nwrote outbox/bsd-tennis-draw-probe-${stamp}.json`);
  process.exit(0);
})().catch((e) => { console.error('draw probe failed:', e.stack); process.exit(1); });
