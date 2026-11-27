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

// THE CLIENT'S DRAW-TAB DECISION, REPLAYED RATHER THAN MIRRORED.
//
// This used to compare two static name lists read out of jubilant-bassoon
// (_TENNIS_DRAW_NO_BRACKET and the keys of _TENNIS_DRAW_NAMED_RANK) with the
// main-draw count the draw route held for the LATEST season of each named
// event. That count moves between 0 and n inside every event's year, so no
// static list is right all year: the check was red on 2026-11-09 (WTA Finals),
// 11-16 (ATP Finals) and 11-23 (Davis Cup), a different event each week, each
// correct for its week, and none of them fixable by another list edit. The
// earlier amendment of 2026-10-07 (the senior Billie Jean King Cup) was the
// same class and was fixed the same way, five weeks before this recurred.
//
// What the client DECIDES is a function of the day's card, so that is what is
// checked. scripts/lib/client-tennis-split.cjs extracts the client's own picker
// from the DEPLOYED page (and from field.js on main, for agreement only), runs
// it over a day's by-date card, and asks the draw route whether a main-draw
// match was actually played that day:
//
//   I1  never offer a Draw tab for an event that has no main-draw match that day
//   I2  when a real main-draw event is on the card, offer some Draw tab
//
// over a pinned corpus of days (one per class: a named event on a knockout day,
// a named event on a round-robin day, a tier draw day, an empty day) plus the
// trailing 7 days, and it checks the client's round_name vocabulary against the
// relay's own draw payloads (V1: every main-draw round the relay serves is
// offered, V2: every round it serves outside the main draw is refused).
// A pin that does not reproduce, a pinned day that cannot be read (after one
// re-read), a trailing window of which fewer than 5 of 7 days were read, a vocabulary
// edition that cannot ground the vocabulary and a run with zero checks are harness
// errors and fail, distinct from drift. A trailing day that cannot be read, in a
// window that is otherwise read, is counted and named, and does not fail the run:
// one vendor fault on one date would otherwise hold a weekly run red for a week.
// A client this run could not read refuses rather than reporting no drift.
// docs/CC-CMD-2026-11-24-tennis-client-split-drift.md has the series.
//
// WHAT TO READ IN THE ARTIFACT. summary.clientDecisionReplay.status is one of
// ok | drift | refused | harness-error and is the key a reader checks:
// summary.clientSplitDrift is only the I1/I2/V1/V2 sentences and is [] on a
// refused, blind or failed run as well as on a clean one.

import { createRequire } from 'node:module';
const _require = createRequire(import.meta.url);
const { readClient, readOnceMore, runReplay, describeClient, RETRY_PAUSE_MS: DEFAULT_RETRY_PAUSE_MS } = _require('./lib/client-tennis-split.cjs');
// A relay read that threw or answered 5xx is made once more after this pause, never a 4xx (the answer is the answer).
// The environment variable exists so the self-test's child process does not wait.
const RETRY_PAUSE_MS = process.env.RETRY_PAUSE_MS === undefined ? DEFAULT_RETRY_PAUSE_MS : Number(process.env.RETRY_PAUSE_MS);

const out = { ts: TS, relay: RELAY, perTier: PER_TIER, tiers: {}, editions: [] };

async function getOnce(path, timeout) {
  const r = await fetch(`${RELAY}${path}`, { signal: AbortSignal.timeout(timeout) });
  const text = await r.text();
  let json; try { json = JSON.parse(text); } catch {}
  return { status: r.status, json, text };
}
// Every relay read here decides something (the census, an edition, a card, a draw), and the one run that can clear
// silently-dead-crons is a weekly one, so a transient 5xx or a dropped connection is read once more.
async function get(path, timeout = 60000) {
  return readOnceMore(() => getOnce(path, timeout), { pauseMs: RETRY_PAUSE_MS });
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
  let modelHeld = 0, interiorHoles = [], unread = [], splitDrift = [];

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
  // Read the client BEFORE judging anything against it, so the output says
  // which declarations the verdict used rather than leaving a reader to assume.
  // The replay itself runs after the census below, so a failure in it cannot
  // stop the rest of the reading being written.
  const client = await readClient();
  out.clientSplit = { deployed: describeClient(client.deployed), source: describeClient(client.source),
                      refusals: client.refusals };
  console.log('\n── the client\'s Draw-tab decision, EXTRACTED FROM THE CLIENT');
  for (const k of ['deployed', 'source']) {
    const r = client[k];
    console.log(`   ${k.toUpperCase().padEnd(9)} ${r ? `read ${r.anchorsPresent.join(', ')}`
      + ` | optional anchors absent ${JSON.stringify(r.anchorsAbsent)}` : 'REFUSED'}`);
  }
  client.refusals.forEach((r) => console.log(`   REFUSED: ${r}`));

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
  console.log('   (informational: whether one of these reaches the Draw tab is decided per day'
            + ' by the replay below, not by anything in this census)');
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

  // ── THE REPLAY ───────────────────────────────────────────────────────────
  // Against the DEPLOYED client only: it is the page a reader loads. When it
  // was refused there is nothing to replay, the refusal is already recorded and
  // fails the run, and guessing from the source would be the fallback that let
  // a stale copy stand for three weeks.
  let replay = null, replayRefusal = null;
  if (client.deployed) {
    try {
      replay = await runReplay({ relayGet: get, deployed: client.deployed, source: client.source,
                                 today: TS.slice(0, 10) });
    } catch (e) { replayRefusal = e.message; }
  }
  out.replay = replay;
  console.log('\n── the replay: pinned days, then the trailing window');
  if (replay) {
    console.log(`   window ${replay.window.from} .. ${replay.window.to} (${replay.window.trailing} days, UTC)`);
    for (const p of replay.pins) {
      console.log(`   pin ${p.id.padEnd(18)} ${p.date}  ${p.reproduced ? 'reproduced' : 'DOES NOT REPRODUCE'}`
                + `${p.problems.length ? ' — ' + p.problems.join('; ') : ''}`);
    }
    for (const d of replay.days) {
      console.log(`   ${d.date} ${(d.pin ?? d.window).padEnd(18)} rows=${String(d.rows).padStart(3)}`
                + ` candidates=${d.candidates.length} pick=${d.pick ?? '-'} drawable=${JSON.stringify(d.drawable)}`
                + ` I1=${d.i1} I2=${d.i2}${d.truncated ? ' CARD-TRUNCATED' : ''}`);
    }
    replay.unreadDays.forEach((u) => console.log(`   unread day ${u.date}: ${u.why}`));
    replay.truthUnread.forEach((u) => console.log(`   unread draw ${u.tid}/${u.season}: ${u.why}`));
    console.log(`   vocabulary (${replay.vocabulary.edition.name} ${replay.vocabulary.edition.season}): main-draw names ${JSON.stringify(replay.vocabulary.main)};`
              + ` outside names ${JSON.stringify(replay.vocabulary.outside)}`);
    console.log(`   COVERAGE (replay): ${replay.coverageLine}`);
    console.log(`   card rows dated on another day than the card's: ${replay.coverage.rowsOffDay}`);
    console.log(`   source decides like deployed on every replayed day : ${replay.sourceAgreesWithDeployed === null
      ? 'UNKNOWN — the source was refused or no day was read' : replay.sourceAgreesWithDeployed}`);
  } else {
    console.log(`   NOT RUN — ${replayRefusal ?? 'the deployed client was refused'}`);
  }
  const harnessErrors = replay ? replay.harness.slice() : [];
  if (replayRefusal !== null) harnessErrors.push(`the replay refused to run: ${replayRefusal}`);
  if (replay) splitDrift.push(...replay.violations.map((v) => v.text));

  const checked = out.editions.length;
  const read = out.editions.filter((e) => e.status === 200).length;
  const edgeBad = out.editions.filter((e) => e.status === 200 && e.edgesDeclaredNull === false);
  // The client's source on main deciding differently from the page a reader
  // loads means two versions of the client disagree: a fix on main that has not
  // shipped, or a revert on main of one that has. Which is for the reader to
  // say. Reported apart from drift because it is a different finding, and
  // because the verdict above was drawn from the deployed page alone.
  const contradictory = [];
  if (replay && replay.sourceAgreesWithDeployed === false) {
    // No direction is claimed: a fix on main that has not shipped and a revert on main of one that has look the same here.
    contradictory.push(`the client's source and its deployed page decide differently on`
                     + ` ${replay.sourceDiffs.map((x) => x.date).join(', ')}`);
  }
  // ok | drift | refused | harness-error: what the client Draw-tab replay found, in one word, so that a refused,
  // blind or failed run is not read as clean from an empty clientSplitDrift. Refusals first (the client was not
  // read), then harness errors (it was read and the harness could not see), then drift (including the source and the
  // deployed page disagreeing).
  const replayStatus = client.refusals.length ? 'refused'
    : harnessErrors.length ? 'harness-error'
    : splitDrift.length || contradictory.length ? 'drift' : 'ok';
  out.summary = { tiersDeclared: TIERS.length, editionsRequested: checked, editionsRead: read,
                  modelHeld, interiorHoles, unread, edgeRuleViolations: edgeBad.length,
                  // The violations of I1, I2, V1 and V2 as sentences. [] here is
                  // NOT a clean run on its own: a refused, blind or failed run
                  // leaves it []. Read clientDecisionReplay.status.
                  clientSplitDrift: splitDrift,
                  // Rule 99: a client this run could not read is not a client
                  // with no drift. These are listed separately from drift so a
                  // reader never has to infer which happened.
                  clientSplitRefusals: client.refusals,
                  clientSplitContradictions: contradictory,
                  // Rule 91: what the verdict above covers, in the artifact and
                  // not in a comment. Zero checks fails the run.
                  clientDecisionReplay: replay
                    ? { status: replayStatus, ran: true, coverageLine: replay.coverageLine, coverage: replay.coverage, window: replay.window,
                        vocabulary: replay.vocabulary, pins: replay.pins, violations: replay.violations, harness: harnessErrors,
                        unreadDays: replay.unreadDays, truthUnread: replay.truthUnread,
                        sourceAgreesWithDeployed: replay.sourceAgreesWithDeployed, sourceDiffs: replay.sourceDiffs }
                    : { status: replayStatus, ran: false, reason: replayRefusal ?? 'the deployed client was refused', harness: harnessErrors } };

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
  // Not a claim that the client matches the relay: the replay's own coverage line says what it did and did not see.
  console.log(`client Draw-tab replay status: ${replayStatus}${replayStatus === 'ok'
    ? ' — no I1, I2, V1 or V2 violation on the days and names replayed; see COVERAGE (replay) above for what that covers and what it cannot see'
    : replayStatus === 'refused' ? ' — a client this run could not read; nothing is known about drift'
    : replayStatus === 'harness-error' ? ' — the replay could not see (see HARNESS below); nothing is known about drift' : ''}`);
  splitDrift.forEach((x) => console.log(`   DRIFT: ${x}`));
  contradictory.forEach((x) => console.log(`   CONTRADICTION: ${x}`));
  client.refusals.forEach((x) => console.log(`   REFUSAL: ${x}`));
  harnessErrors.forEach((x) => console.log(`   HARNESS: ${x}`));

  fs.mkdirSync('outbox', { recursive: true });
  const body = JSON.stringify(out, null, 2);
  fs.writeFileSync(`outbox/tennis-tier-ladders-${TS.replace(/[:.]/g, '-')}.json`, body);
  fs.writeFileSync('outbox/tennis-tier-ladders-latest.json', body);
  // An edge-rule violation is a contract break and fails. So is a violation of
  // I1, I2, V1 or V2: it means jubilant-bassoon is hiding a real draw, or offering
  // a tab with nothing behind it, and neither repo can notice on its own. An
  // interior hole is a finding about the vendor's data and does not fail.
  //
  // A REFUSAL ALSO FAILS, and so does a HARNESS ERROR (a pin that no longer
  // reproduces, a pinned day nobody could read, a trailing window read less than 5 of 7, a vocabulary edition
  // that cannot ground the vocabulary, a replay that ran zero checks). A run
  // that could not read the client, or could not see, knows nothing about drift,
  // and the one outcome worse than red is a green meaning "I could not look".
  process.exit(edgeBad.length || splitDrift.length || contradictory.length
            || client.refusals.length || harnessErrors.length ? 1 : 0);
})().catch((e) => { console.error('failed:', e.stack); process.exit(1); });
