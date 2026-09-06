// What EXACTLY does a draw row look like on the LIST endpoint?
//
// The feasibility question was answered on 2026-09-06:
//   "YES — 126 edges resolve to exactly one next match by winner identity,
//    0 ambiguous; no parent-link field, and none needed"
//
// That verdict is about EDGES. It says nothing about what a bracket NODE can
// display, and the relay route about to be written has to map player names,
// seeds and scores out of rows it has never read. The one fixture this project
// holds for tennis (field-laboratory data/tennis-live.json) came from
// /matches/live/ — a DIFFERENT endpoint. Reading a player shape there and
// writing the draw route against it is exactly the source-versus-copy
// substitution this repo's own rules prohibit.
//
// Six questions, each with a printed answer, and coverage stated with every
// count (Rule 91) so a green line cannot be read as "all rows".
//
//   1. Which tournament ids are Grand Slams, and are men's and women's draws
//      separate ids or one id? A bracket for "the US Open" is two brackets or
//      one, and that is not a guess to make in a route.
//   2. On the LIST endpoint, what keys does player1 carry, and is `name`
//      present on every row?
//   3. Is there a seed anywhere? A draw without seeds still renders; a draw
//      with an invented seed field renders wrong.
//   4. The complete round vocabulary of ONE edition, including labels outside
//      the seven-round main draw. The 2026 ladder read Round of 128 = 66, and
//      66 is not 64. Two rows are unaccounted for and this prints them.
//   5. Does sets_detail survive on FINISHED list rows, or is it live-only?
//   6. Do the two ids of one slam (men's + women's) each halve cleanly on
//      their own, or does the anomaly follow the tournament?
//
// A missing field is the FINDING. Exits 0 on any answer; exits 1 only when it
// could not ask (no token, upstream down) — an unanswered question must not
// look like an answered one.

import fs from 'node:fs';

const BASE = process.env.BSD_BASE || 'https://sports.bzzoiro.com';
const TOKEN = process.env.BSD_API_TOKEN || '';
const TS = new Date().toISOString();
const out = { ts: TS, base: BASE, questions: {}, attempts: [] };

let calls = 0;
async function get(path, note) {
  if (calls >= 40) return { blocked: 'call budget exhausted' };
  calls++;
  const r = await fetch(`${BASE}${path}`, {
    headers: { Authorization: `Token ${TOKEN}`, Accept: 'application/json' },
    signal: AbortSignal.timeout(30000),
  });
  const text = await r.text();
  let json; try { json = JSON.parse(text); } catch {}
  out.attempts.push({ path, note, status: r.status, bytes: text.length });
  return { status: r.status, json };
}
const rowsOf = (j) => (Array.isArray(j) ? j : (j?.results ?? []));
const seasonOf = (m) => String(m?.season_id ?? String(m?.match_date ?? '').slice(0, 4));

async function pageAll(base, cap = 6) {
  let acc = [], path = base, pages = 0, declared = null;
  while (path && pages < cap) {
    const r = await get(path, `page ${pages}`);
    if (r.status !== 200) break;
    if (declared === null) declared = r.json?.count ?? null;
    const rows = rowsOf(r.json);
    if (!rows.length) break;
    acc = acc.concat(rows);
    const nx = r.json?.next;
    path = nx ? nx.replace(/^https?:\/\/[^/]+/, '') : null;
    pages++;
  }
  return { rows: acc, declared, pages, truncated: declared != null && acc.length < declared };
}

(async () => {
  console.log(`=== bsd-tennis-draw-shape-probe  utc=${TS} ===\n`);
  if (!TOKEN) { console.error('!! no BSD_API_TOKEN — cannot ask. This is not a "no".'); process.exit(1); }

  // Q1 — which ids are Grand Slams?
  // 8 pages, not 4. The first run read 400 of a declared 636 and said so, but
  // "which ids are Grand Slams" is a question a truncated read cannot answer.
  const tj = await pageAll('/tennis/api/v2/tournaments/?limit=100', 8);
  const slams = tj.rows.filter((t) => String(t?.category || '') === 'grand_slam')
                       .map((t) => ({ id: t.id, name: t.name, circuit: t.circuit, surface: t.surface }));
  out.questions.q1_grandSlamIds = { checked: tj.rows.length, declared: tj.declared,
                                    truncated: tj.truncated, slams };
  console.log(`Q1 grand slams: ${slams.length} of ${tj.rows.length} tournaments read`
            + ` (BSD declares ${tj.declared}, truncated=${tj.truncated})`);
  slams.forEach((s) => console.log(`     ${String(s.id).padStart(5)}  ${s.name}   circuit=${s.circuit}`));

  // Pick a slam edition to inspect. EXACT name, not /US Open/i — the first run
  // matched "US Open, Boys" (id 144) because the slam list is not ordered and
  // Boys sorts ahead of Men. The sample player it then printed was Jessica
  // Pegula, which is the tell a loose match leaves.
  const pick = slams.find((s) => s.name === 'US Open, Men')
            || slams.find((s) => /^US Open, /.test(s.name))
            || slams[0];
  if (!pick) { console.error('!! no grand_slam tournament found — cannot continue'); process.exit(1); }
  console.log(`\ninspecting: ${pick.id} ${pick.name}`);

  // `tournament`, NOT `tournament_id`. Measured by the feasibility probe on
  // 2026-09-06 and sitting in outbox/bsd-tennis-draw-probe-latest.json:
  //
  //   filter_tournament      200  400 rows  allSameTournament=true
  //   filter_tournament_id   200  366 rows  allSameTournament=false
  //   filter_tournament_ids  200  366 rows  allSameTournament=false
  //
  // The first run of THIS probe used tournament_id, read 363 unfiltered rows,
  // and reported "halves=false" for all eight slam ids — every one of them the
  // same 363 rows, because the parameter is accepted and dropped. That is the
  // same silent-drop this relay's by-date route was built to work around, and
  // the answer was already measured in this repo's own outbox. Written from
  // memory instead of read from the artifact: the defect the probe-first rule
  // names, committed while writing a probe.
  const mj = await pageAll(`/tennis/api/v2/matches/?tournament=${pick.id}&limit=100`, 8);
  const all = mj.rows;
  const seasons = {};
  for (const m of all) (seasons[seasonOf(m)] ??= []).push(m);
  const editions = Object.entries(seasons).sort((a, b) => b[1].length - a[1].length);
  const [edKey, edition] = editions[0] || ['?', []];
  out.questions.editionScope = { tournamentId: pick.id, name: pick.name,
    rowsRead: all.length, declared: mj.declared, truncated: mj.truncated,
    seasonsSeen: Object.fromEntries(editions.map(([k, v]) => [k, v.length])),
    editionJoined: edKey, editionMatches: edition.length };
  console.log(`  read ${all.length} of ${mj.declared} rows (truncated=${mj.truncated});`
            + ` seasons ${editions.map(([k, v]) => `${k}=${v}`).join(', ')}`);
  console.log(`  edition under inspection: ${edKey} (${edition.length} matches)`);
  const allMine = all.length > 0 && all.every((m) => m?.tournament?.id === pick.id);
  out.questions.editionScope.filterHeld = allMine;
  console.log(`  every fetched row belongs to ${pick.id}: ${allMine}`);
  if (!allMine) {
    const foreign = [...new Set(all.map((m) => m?.tournament?.id))].filter((x) => x !== pick.id);
    out.questions.editionScope.foreignTournamentIds = foreign.slice(0, 20);
    console.error(`!! the tournament filter did NOT hold — ${foreign.length} other tournament id(s)`
                + ` in the result. Every answer below would be about the wrong rows.`);
    fs.mkdirSync('outbox', { recursive: true });
    fs.writeFileSync('outbox/bsd-tennis-draw-shape-latest.json', JSON.stringify(out, null, 2));
    process.exit(1);
  }

  // Q2 — player object shape on THIS endpoint, and name coverage.
  const pKeys = [...new Set(edition.flatMap((m) => [m?.player1, m?.player2])
                                   .filter(Boolean).flatMap((p) => Object.keys(p)))].sort();
  const bothPresent = edition.filter((m) => m?.player1 && m?.player2).length;
  const bothNamed = edition.filter((m) => m?.player1?.name && m?.player2?.name).length;
  out.questions.q2_playerShape = { keys: pKeys, checked: edition.length, bothPresent, bothNamed };
  console.log(`\nQ2 player keys (list endpoint): ${pKeys.join(', ') || 'NONE'}`);
  console.log(`   both players present on ${bothPresent} of ${edition.length};`
            + ` both NAMED on ${bothNamed} of ${edition.length}`);
  const sample = edition.find((m) => m?.player1);
  out.questions.q2_sample = sample ? { player1: sample.player1, player2: sample.player2 } : null;
  if (sample) console.log(`   sample player1: ${JSON.stringify(sample.player1)}`);

  // Q3 — is there a seed?
  const mKeys = [...new Set(edition.flatMap((m) => Object.keys(m || {})))].sort();
  const seedish = [...mKeys, ...pKeys].filter((k) => /seed|rank/i.test(k));
  out.questions.q3_seedFields = { matchKeys: mKeys, seedCandidates: seedish };
  console.log(`\nQ3 seed/rank-ish fields anywhere on a row or player: `
            + `${seedish.length ? seedish.join(', ') : 'NONE'}`);

  // Q4 — the complete round vocabulary of one edition, and the unaccounted rows.
  const ORDER = ['Round of 128','Round of 64','Round of 32','Round of 16','Quarterfinals','Semifinals','Final'];
  const vocab = {};
  for (const m of edition) { const r = String(m?.round_name ?? '(absent)'); vocab[r] = (vocab[r] || 0) + 1; }
  const offLadder = Object.keys(vocab).filter((r) => !ORDER.includes(r));
  out.questions.q4_roundVocabulary = { vocab, offLadder };
  console.log(`\nQ4 round vocabulary of ${edKey} (${edition.length} matches):`);
  Object.entries(vocab).sort((a, b) => b[1] - a[1]).forEach(([k, v]) => console.log(`   ${String(v).padStart(4)} ${k}`));
  console.log(`   labels outside the 7-round main draw: ${offLadder.length ? offLadder.join(' | ') : 'none'}`);

  // The over-count. Print the actual rows, do not summarise them away.
  const over = ORDER.map((r) => ({ round: r, have: vocab[r] || 0 }))
                    .filter((x, i) => x.have && x.have !== (128 >> (i + 1)));
  out.questions.q4_roundsNotAtExpectedSize = over;
  console.log(`   rounds NOT at their canonical size: `
            + `${over.length ? over.map((x) => `${x.round}=${x.have}`).join(', ') : 'none'}`);
  if (over.length) {
    const worst = over[0].round;
    const rows = edition.filter((m) => m.round_name === worst);
    // Which of them look like duplicates of a player pairing?
    const seen = new Map();
    const dupes = [];
    for (const m of rows) {
      const k = [m?.player1?.id, m?.player2?.id].sort().join('-');
      if (seen.has(k)) dupes.push({ a: seen.get(k), b: m.id, key: k });
      else seen.set(k, m.id);
    }
    const noWinner = rows.filter((m) => m?.winner_id == null)
                         .map((m) => ({ id: m.id, status: m.status, date: m.match_date,
                                        p1: m?.player1?.name ?? null, p2: m?.player2?.name ?? null }));
    out.questions.q4_overCountDetail = { round: worst, rows: rows.length,
                                         duplicatePairings: dupes, rowsWithoutWinner: noWinner };
    console.log(`   ${worst}: ${rows.length} rows, ${dupes.length} duplicate pairing(s),`
              + ` ${noWinner.length} without winner_id`);
    noWinner.slice(0, 6).forEach((r) => console.log(`     no winner: ${r.id} ${r.status} ${r.p1} v ${r.p2}`));
  }

  // Q5 — sets_detail on FINISHED rows.
  const fin = edition.filter((m) => /finish|complete|ended/i.test(String(m?.status || '')));
  const withSets = fin.filter((m) => Array.isArray(m?.sets_detail) && m.sets_detail.length).length;
  out.questions.q5_setsDetailOnFinished = { finished: fin.length, withSetsDetail: withSets,
    sample: fin.find((m) => Array.isArray(m?.sets_detail) && m.sets_detail.length)?.sets_detail ?? null,
    statusVocabulary: [...new Set(edition.map((m) => String(m?.status)))].sort() };
  console.log(`\nQ5 sets_detail present on ${withSets} of ${fin.length} finished rows`);
  console.log(`   status vocabulary: ${out.questions.q5_setsDetailOnFinished.statusVocabulary.join(', ')}`);

  // Q6 — does every slam id halve on its own latest edition?
  const perSlam = [];
  // The eight most bracket-like: singles draws, not Boys/Girls/Wheelchairs/Quad.
  const singles = slams.filter((s) => !/Boys|Girls|Wheelchair|Quad|Doubles/i.test(s.name));
  for (const s of (singles.length ? singles : slams).slice(0, 8)) {
    const r = await pageAll(`/tennis/api/v2/matches/?tournament=${s.id}&limit=100`, 8);
    const bySeason = {};
    for (const m of r.rows) (bySeason[seasonOf(m)] ??= []).push(m);
    const top = Object.entries(bySeason).sort((a, b) => b[1].length - a[1].length)[0];
    if (!top) { perSlam.push({ id: s.id, name: s.name, edition: null }); continue; }
    const v = {};
    for (const m of top[1]) { const rn = String(m?.round_name); v[rn] = (v[rn] || 0) + 1; }
    const ladder = ORDER.filter((rn) => v[rn]).map((rn) => ({ round: rn, matches: v[rn] }));
    const halves = ladder.every((x, i) => i === 0 || x.matches * 2 === ladder[i - 1].matches);
    perSlam.push({ id: s.id, name: s.name, edition: top[0], matches: top[1].length,
                   rowsRead: r.rows.length, declared: r.declared, truncated: r.truncated,
                   ladder, halves });
    console.log(`\nQ6 ${String(s.id).padStart(5)} ${s.name} [${top[0]}] `
              + `${ladder.map((x) => `${x.round.replace('Round of ', 'R')}=${x.matches}`).join(' ')}`
              + `  halves=${halves}  (read ${r.rows.length}/${r.declared}, truncated=${r.truncated})`);
  }
  out.questions.q6_perSlamLadders = { checked: perSlam.length, singlesDraws: singles.length,
                                      ofAllSlamIds: slams.length, ladders: perSlam };

  fs.mkdirSync('outbox', { recursive: true });
  const stamp = TS.replace(/[:.]/g, '-');
  const body = JSON.stringify(out, null, 2);
  fs.writeFileSync(`outbox/bsd-tennis-draw-shape-${stamp}.json`, body);
  fs.writeFileSync('outbox/bsd-tennis-draw-shape-latest.json', body);
  console.log(`\nwrote outbox/bsd-tennis-draw-shape-${stamp}.json`);
  process.exit(0);
})().catch((e) => { console.error('shape probe failed:', e.stack); process.exit(1); });
