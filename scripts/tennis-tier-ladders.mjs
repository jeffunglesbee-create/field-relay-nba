// Does the draw model hold on EVERY tier FIELD can show, or only on slams?
//
// This replaces scripts/tennis-masters-ladders.mjs, which asked the same
// question of one tier and is strictly subsumed. Its artifact
// outbox/tennis-masters-ladders-latest.json stays as the frozen evidence for
// the entry-round fix; the script would now be a second place for the same
// logic to drift.
//
// WHY THE QUESTION KEEPS PAYING. Every edition anything here had read was a
// Grand Slam, and that hid a 128-ladder assumption for a day. A 96-draw Masters
// exposed it: nine of ten were flagged off-canonical on their entry round with
// not one match missing. Then the live page exposed the mirror four minutes
// later — a draw still being played is filling its innermost round, and
// US Open Women 2026's Quarterfinals=1 was reported as three missing matches.
//
// THE MODEL NOW UNDER TEST, on the deployed route, across every tier the client
// will actually select:
//
//   1. The ENTRY round (outermost present) has canonical null. It holds
//      whoever did not get a bye and there is nothing to compare it to.
//   2. The INNERMOST round of an unfinished draw has canonical null too.
//   3. Every round BETWEEN them is exactly 2^(levels above the final) — 32,
//      16, 8, 4, 2, 1 — whatever the draw size.
//
// Rule 3 is the one that can be refuted. A single interior round off its size
// is either a real hole (US Open Men 2025's R64=31, Toronto 2025's R32=15) or
// a refutation, and those look identical from one edition. So this reports the
// COUNT and every instance, and does not decide between them silently.
//
// Coverage is stated with the result (Rule 91): a cap per tier, the number of
// tournaments that tier holds, and the tiers this cannot reach.

import fs from 'node:fs';

const RELAY = process.env.RELAY_BASE || 'https://field-relay-nba.jeffunglesbee.workers.dev';
const PER_TIER = Number(process.env.PER_TIER || 5);
const TS = new Date().toISOString();
const ORDER = ['Round of 128', 'Round of 64', 'Round of 32', 'Round of 16',
               'Quarterfinals', 'Semifinals', 'Final'];

// The eight categories jubilant-bassoon's TENNIS_TIERS admits. utr and
// challenger are deliberately absent: the client drops them, so a draw is never
// requested for one and reading them here would measure something nothing shows.
const TIERS = ['grand_slam', 'masters_1000', 'atp_1000', 'wta_1000',
               'atp_500', 'wta_500', 'atp_250', 'wta_250'];

// TEAM EVENTS AND SEASON FINALS. The client admits these by NAME, not by
// category — TENNIS_NAMED in field.js — because they sit in `other` alongside
// wildcard playoffs and satellite events, so the category cannot be allowed or
// denied wholesale.
//
// They are read here because they are part of what FIELD shows, and because
// their SHAPE is the open question. Davis Cup and the BJK Cup are ties, the
// United Cup is groups then a knockout, and the ATP and WTA Finals are
// round-robin then semi-finals. None of those is a single-elimination draw, and
// the draw route's whole premise — a player appears in at most one match per
// round, so the winner is the link — does not obviously survive any of them.
//
// This does not assume it fails. It asks, and prints what comes back.
const NAMED = /^(ATP Finals|WTA Finals|Next Gen Finals|United Cup|Davis Cup|Billie Jean King Cup( Group I)?)$/;

const out = { ts: TS, relay: RELAY, perTier: PER_TIER, tiers: {}, editions: [] };

async function get(path, timeout = 60000) {
  const r = await fetch(`${RELAY}${path}`, { signal: AbortSignal.timeout(timeout) });
  const text = await r.text();
  let json; try { json = JSON.parse(text); } catch {}
  return { status: r.status, json, text };
}

(async () => {
  console.log(`=== tennis-tier-ladders  utc=${TS}  relay=${RELAY} ===\n`);

  // The tournament census. /bsd/tennis/tournaments pages the whole thing and
  // reports its own truncation, so this asks once rather than re-implementing
  // the paging a route already owns (Rule 60).
  const cr = await get('/bsd/tennis/tournaments', 60000);
  const all = cr.status === 200 ? (cr.json?.results ?? []) : [];
  out.census = { status: cr.status, read: cr.json?.read ?? all.length,
                 declared: cr.json?.declaredCount ?? null,
                 truncated: cr.json?.truncated ?? null, pages: cr.json?.pages ?? null };
  console.log(`census: ${out.census.read} tournament(s) read of ${out.census.declared} declared,`
            + ` ${out.census.pages} page(s), truncated=${out.census.truncated}\n`);
  if (!all.length) {
    console.error('!! no tournaments read — nothing can be answered. This is not a "no".');
    fs.mkdirSync('outbox', { recursive: true });
    fs.writeFileSync('outbox/tennis-tier-ladders-latest.json', JSON.stringify(out, null, 2));
    process.exit(1);
  }

  const singles = (t) => !/Doubles|Boys|Girls|Wheelchair|Quad/i.test(t?.name || '');
  let modelHeld = 0, interiorHoles = [], unread = [];

  for (const tier of TIERS) {
    const inTier = all.filter((t) => String(t?.category) === tier);
    const pick = inTier.filter(singles).slice(0, PER_TIER);
    out.tiers[tier] = { tournamentsInTier: inTier.length, singles: inTier.filter(singles).length,
                        checked: pick.length };
    console.log(`── ${tier}: ${inTier.length} in census, `
              + `${inTier.filter(singles).length} singles, checking ${pick.length}`);
    if (!inTier.length) { console.log('   (no tournament carries this category)'); continue; }

    for (const t of pick) {
      const r = await get(`/bsd/tennis/draw?tournament=${t.id}`);
      const rec = { tier, tid: t.id, name: t.name, status: r.status };
      out.editions.push(rec);
      if (r.status !== 200 || !r.json) {
        unread.push(`${tier} ${t.id} ${t.name} HTTP ${r.status}`);
        rec.body = r.text.slice(0, 200);
        console.log(`   ${String(t.id).padStart(5)} ${String(t.name).slice(0, 26).padEnd(28)} HTTP ${r.status}  ${r.text.slice(0, 110)}`);
        continue;
      }
      const d = r.json;
      const rounds = (d.rounds || []).slice().sort((a, b) => a.index - b.index);
      rec.season = d.season;
      rec.complete = d.complete;
      rec.ladder = rounds.map((x) => `${x.round.replace('Round of ', 'R')}=${x.matches}`);
      rec.entry = rounds.find((x) => x.entryRound)?.round ?? null;
      rec.openInnermost = rounds.find((x) => x.openInnermostRound)?.round ?? null;

      // RULE 3, the refutable one. Interior = neither edge.
      const interior = rounds.filter((x) => !x.entryRound && !x.openInnermostRound);
      const off = interior.filter((x) => x.matches !== (1 << (6 - x.index)));
      rec.interiorOff = off.map((x) => `${x.round}=${x.matches} want ${1 << (6 - x.index)}`);
      if (off.length) interiorHoles.push(`${tier} ${t.id} ${t.name} ${d.season}: ${rec.interiorOff.join(', ')}`);
      else modelHeld++;

      // Rules 1 and 2, which are structural and should never be violated.
      rec.edgesDeclaredNull = rounds.every((x) =>
        (x.entryRound || x.openInnermostRound) ? x.canonical === null : x.canonical !== null);

      console.log(`   ${String(t.id).padStart(5)} ${String(t.name).slice(0, 26).padEnd(28)} ${d.season}`
                + ` ${rec.ladder.join(' ').padEnd(46)} complete=${d.complete}`
                + ` interiorOff=${off.length ? rec.interiorOff.join('|') : 'none'}`);
      if (!rec.edgesDeclaredNull) console.log(`        !! an edge round carries a canonical size, or an interior round does not`);
    }
  }

  // ── TEAM EVENTS AND SEASON FINALS ────────────────────────────────────────
  const named = all.filter((t) => NAMED.test(String(t?.name || '')));
  out.namedEvents = { matched: named.length,
                      names: [...new Set(named.map((t) => t.name))].sort(),
                      // Filled below. A team event with zero main-draw rounds
                      // is not a draw that failed — it is a format that has no
                      // draw, and lumping the two together is how a Davis Cup
                      // tie would read as a broken bracket.
                      withKnockout: [], withoutKnockout: [] };
  console.log(`\n── team events and season finals: ${named.length} tournament(s) match by name`);
  console.log(`   ${out.namedEvents.names.join(' | ') || '(none)'}`);
  console.log("   NOTE: the client's draw picker keys on category rank, and the"
            + " 'other' category has none — so none of these can currently reach"
            + ' the Draw tab. Verified in field.js: _tennisDrawPick does'
            + ' `if (rank == null) continue;`.');
  for (const t of named.slice(0, 8)) {
    const r = await get(`/bsd/tennis/draw?tournament=${t.id}`);
    const rec = { tier: 'named', tid: t.id, name: t.name, status: r.status };
    out.editions.push(rec);
    if (r.status !== 200 || !r.json) {
      rec.body = r.text.slice(0, 400);
      console.log(`   ${String(t.id).padStart(5)} ${String(t.name).slice(0, 26).padEnd(28)} HTTP ${r.status}  ${r.text.slice(0, 160)}`);
      continue;
    }
    const d = r.json;
    const rounds = (d.rounds || []).slice().sort((a, b) => a.index - b.index);
    rec.season = d.season;
    rec.complete = d.complete;
    rec.ladder = rounds.map((x) => `${x.round.replace('Round of ', 'R')}=${x.matches}`);
    rec.mainDrawMatches = d.mainDrawMatches;
    rec.roundsOutsideMainDraw = d.roundsOutsideMainDraw;
    const interior = rounds.filter((x) => !x.entryRound && !x.openInnermostRound);
    const off = interior.filter((x) => x.matches !== (1 << (6 - x.index)));
    rec.interiorOff = off.map((x) => `${x.round}=${x.matches} want ${1 << (6 - x.index)}`);
    rec.edgesDeclaredNull = rounds.every((x) =>
      (x.entryRound || x.openInnermostRound) ? x.canonical === null : x.canonical !== null);
    // COUNTED, like every other edition. The first run of this block did not
    // touch modelHeld, so the summary read "interior rounds at their size: 20
    // of 27" on a run where nothing failed — seven editions looked like seven
    // failures because the loop that read them never incremented the counter.
    // A number that only some of its subjects can move is not a count.
    if (off.length) interiorHoles.push(`named ${t.id} ${t.name} ${d.season}: ${rec.interiorOff.join(', ')}`);
    else modelHeld++;
    (d.mainDrawMatches > 0 ? out.namedEvents.withKnockout : out.namedEvents.withoutKnockout)
      .push(`${t.id} ${t.name} (${d.mainDrawMatches} match(es))`);
    console.log(`   ${String(t.id).padStart(5)} ${String(t.name).slice(0, 26).padEnd(28)} ${d.season}`
              + ` ${(rec.ladder.join(' ') || '(no main-draw round)').padEnd(46)}`
              + ` mainDraw=${d.mainDrawMatches} outside=${JSON.stringify(d.roundsOutsideMainDraw)}`);
    if (off.length) console.log(`        interior off: ${rec.interiorOff.join(', ')}`);
  }

  const checked = out.editions.length;
  const read = out.editions.filter((e) => e.status === 200).length;
  const edgeBad = out.editions.filter((e) => e.status === 200 && e.edgesDeclaredNull === false);
  out.summary = { tiersDeclared: TIERS.length, editionsRequested: checked, editionsRead: read,
                  modelHeld, interiorHoles, unread, edgeRuleViolations: edgeBad.length };

  console.log(`\nCOVERAGE: ${read} edition(s) read of ${checked} requested, across`
            + ` ${TIERS.length} declared tier(s), capped at ${PER_TIER} per tier,`
            + ` from a census of ${out.census.declared}. utr and challenger are NOT`
            + ` checked — the client drops them, so no draw is ever requested for one.`);
  console.log(`\ninterior rounds at their size: ${modelHeld} of ${read}`);
  console.log(`team events WITH a knockout the draw route can render:`);
  out.namedEvents.withKnockout.forEach((x) => console.log(`   ${x}`));
  console.log(`team events with NO main-draw round — a format, not a failure:`);
  out.namedEvents.withoutKnockout.forEach((x) => console.log(`   ${x}`));
  if (interiorHoles.length) {
    console.log(`interior rounds SHORT (a hole, or a refutation — this does not decide):`);
    interiorHoles.forEach((h) => console.log(`   ${h}`));
  }
  if (unread.length) { console.log(`unread:`); unread.forEach((u) => console.log(`   ${u}`)); }
  console.log(`edge-rule violations (an edge with a size, or an interior without one): ${edgeBad.length}`);

  fs.mkdirSync('outbox', { recursive: true });
  const body = JSON.stringify(out, null, 2);
  fs.writeFileSync(`outbox/tennis-tier-ladders-${TS.replace(/[:.]/g, '-')}.json`, body);
  fs.writeFileSync('outbox/tennis-tier-ladders-latest.json', body);
  // An edge-rule violation is a contract break and fails. An interior hole is a
  // finding about the vendor's data and does not.
  process.exit(edgeBad.length ? 1 : 0);
})().catch((e) => { console.error('failed:', e.stack); process.exit(1); });
