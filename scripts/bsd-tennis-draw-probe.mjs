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
      const r = await get(`/tennis/api/v2/matches/?${p}&limit=100`, `filter by ${p.split('=')[0]}`);
      const rows = rowsOf(r.json);
      const allMine = rows.length && rows.every((m) => m?.tournament?.id === slam.id);
      out.findings[`filter_${p.split('=')[0]}`] = { status: r.status, rows: rows.length, allSameTournament: Boolean(allMine) };
      console.log(`  ${p.split('=')[0].padEnd(15)} HTTP ${r.status}  ${rows.length} row(s)  allSameTournament=${Boolean(allMine)}`);
      if (allMine && rows.length > draw.length) draw = rows;
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

    out.findings.verdict = linkish.length
      ? 'PARTIAL — a candidate parent link exists; inspect it before designing edges'
      : 'DERIVABLE ONLY BY POSITION — no field names the match a winner feeds, so edges would be inferred from round order and seeding, never read';
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
