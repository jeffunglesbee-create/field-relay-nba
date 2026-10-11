#!/usr/bin/env node
// An individual-competitor event must never reach the archive catch-up write.
//
// WHY THIS EXISTS (field-laboratory docs/CC-CMD-2026-08-25-golf-sport-label.md)
//
// `handleJournalismCycle`'s LEAGUES table drives an ESPN scoreboard walk. Every
// entry but one is a team sport, and the per-event handling derives the two
// sides with:
//
//     const home = teams.find(t => t.homeAway === 'home') || teams[0];
//     const away = teams.find(t => t.homeAway === 'away') || teams[1];
//
// The fallback exists for neutral-site fixtures where ESPN omits `homeAway`. It
// cannot tell a neutral site from a leaderboard, so on a golf event it returns
// the first two PLAYERS. `home.team?.shortDisplayName` is then '' (a golf
// competitor carries `athlete`, not `team`), and the catch-up wrote:
//
//     sport='PGA Tour'  home=null  away=null  home_score=-6  away_score=-6
//     id='PGA Tour_2026-08-20_src401811963'  espn_event_id='401811963'
//
// -- the top two players of the BMW Championship's first round, stripped of
// their names and presented as a tie between two sides that do not exist. The
// same event is ALREADY archived correctly by the golf-aware [GOLF-BRIEF] path
// as sport='golf' with espn_event_id='golf_401811963'. Two rows, one event,
// one of them a category error: PGA Tour is a LEAGUE within golf, alongside the
// Korn Ferry, Champions, LPGA and DP World tours.
//
// Static, no network. Six assertions, all enumerated rather than sampled.

import { readFileSync } from 'node:fs';

const SRC = 'src/index.js';
const SELF_TEST = process.argv.includes('--self-test');

// ESPN top-level `sport` values whose competitors are TEAMS. Every LEAGUES
// entry must use one of these or carry `individual:true`.
//
// This is an allowlist, not a blocklist, deliberately. A blocklist of known
// individual sports would silently pass the first unfamiliar one; this makes an
// unrecognised sport an explicit decision at the moment it is added, which is
// the only moment anyone knows the answer.
const TEAM_SPORTS = new Set(['soccer', 'basketball', 'hockey', 'baseball', 'football']);

let failed = 0;
const check = (name, ok, detail) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
  if (!ok) { console.log(`      → ${detail}`); failed++; }
};

/** Parses the cron LEAGUES table out of a source string. */
export function parseLeagues(src) {
  const m = src.match(/const LEAGUES = \[(.*?)\n {2}\];/s);
  if (!m) return null;
  return [...m[1].matchAll(
    /\{sport:\s*'([^']+)',\s*league:\s*'([^']+)',\s*label:\s*'([^']+)'([^}]*)\}/g,
  )].map(x => ({
    sport: x[1], league: x[2], label: x[3],
    individual: /\bindividual\s*:\s*true\b/.test(x[4]),
  }));
}

/** Does the catch-up loop refuse a flagged entry, and can it see the flag? */
// THE SECOND GATE, one loop earlier than the archive one.
// docs/CC-CMD-2026-08-25-golf-slate-line.md. The archive gate sits at the
// catch-up WRITE, so a flagged event is still walked, still run through
// buildGameLine, and still pushed into `gameLines` — which is the journalism
// PROMPT. Measured on the live feed 2026-10-11 (run 38142889937): the line
// read `-15 @ -16 · Final · Golf Chnl`, two scores either side of an @ and no
// names, because golf competitors carry `athlete` and `homeAway` is null on
// all 72 of them.
export function slateGateState(src) {
  return {
    // The gate, before the fetch rather than at gameLines.push: gameMeta is
    // pushed in the same block and the odds step indexes one array by the
    // other's position, so a push-only gate would desynchronise them.
    gated: /for \(const \{sport,league,label,individual\} of LEAGUES\) \{[\s\S]{0,3000}?if \(individual\) continue;/.test(src),
    // `individual` must be destructured in THAT loop's head, not just the
    // catch-up's. Both loops iterate LEAGUES and only one used to carry it.
    destructured: /for \(const \{sport,league,label,individual\} of LEAGUES\)/.test(src),
    // And the gate has to sit above the ESPN call it is meant to skip.
    //
    // SCOPED TO THE LOOP THAT HOLDS THE GATE. Written first as
    // `indexOf(fetch, gateIndex) > gateIndex` over the whole file, which
    // passed its own mutation: there is a SECOND LEAGUES walk further down
    // (the per-game brief enqueue) with its own identical fetch, so any gate
    // position had some later fetch to point at. The self-test below moves the
    // gate under gameLines.push and the loose version still reported
    // beforeFetch true — an assertion satisfiable without testing its claim.
    beforeFetch: (() => {
      const head = src.indexOf('for (const {sport,league,label,individual} of LEAGUES)');
      if (head < 0) return false;
      const win = src.slice(head, head + 4000);
      const g = win.indexOf('if (individual) continue;');
      const f = win.indexOf('/sports/${sport}/${league}/scoreboard?dates=${espnDate}');
      return g >= 0 && f >= 0 && g < f;
    })(),
  };
}

// buildGolfCronContext had exactly ONE occurrence for weeks — its own
// definition — while twenty lines of its body sat copied inline at the slate
// prompt. The CC-CMD read that single hit as "golf is absent from the prompt";
// golf was always there, through the copy. The Rule 63 defect was duplication.
// This asserts the duplicate has not come back: the function is defined once,
// called at least once, and the inline copy's signature string is gone.
export function golfBuilderState(src) {
  const defs = (src.match(/function buildGolfCronContext\(/g) || []).length;
  const uses = (src.match(/buildGolfCronContext\(/g) || []).length;
  return {
    definedOnce: defs === 1,
    hasCaller: uses - defs >= 1,
    // The copy's own give-away line. If this string reappears outside the
    // function, the inline block is back.
    noInlineCopy: (src.match(/Use leaderboard positions and scores only/g) || []).length === 1,
  };
}

export function gateState(src) {
  return {
    // The gate itself.
    gated: /if \(gm\.individual\) continue;/.test(src),
    // Without this the flag never reaches `gm`, and the gate above is dead
    // code that always reads undefined -- passing every event through.
    carried: /gameMeta\.push\(\{[^}]*\bindividual,/s.test(src),
    // And without this, `individual` is never destructured from the table row,
    // so the value pushed is always undefined. Three links, all required.
    destructured: /for \(const \{sport,league,label,individual\} of LEAGUES\)/.test(src),
  };
}

if (SELF_TEST) {
  const good = readFileSync(SRC, 'utf8');
  const g = gateState(good);
  check('the real source has all three links',
    g.gated && g.carried && g.destructured, JSON.stringify(g));

  // Each link removed on its own must be detected. A check that only notices
  // all three missing at once would pass the half-applied fix, which is the
  // realistic way this breaks.
  check('removing the gate is detected',
    !gateState(good.replace('if (gm.individual) continue;', '')).gated, 'still reported gated');
  // Deletes the `individual,` line from the push, which is the exact shape of
  // a half-applied fix: flag on the table, gate in the loop, nothing carrying
  // the value between them. The first version of this mutation inserted a
  // character AFTER `sport,` and left `individual,` in place, so it reported
  // PASS while proving nothing -- caught by this self-test failing.
  check('removing the carry is detected',
    !gateState(good.replace(/\n\s*individual,\n/, '\n')).carried,
    'still reported carried');
  check('removing the destructure is detected',
    !gateState(good.replace('{sport,league,label,individual}', '{sport,league,label}')).destructured,
    'still reported destructured');

  // And the table parser must notice a flag going missing -- the shape of the
  // pre-fix source, which is what this whole check exists to refuse.
  const unflagged = good.replace(", individual:true}", "}");
  const rows = parseLeagues(unflagged);
  check('an unflagged individual-sport row is detected',
    rows !== null && rows.some(r => !TEAM_SPORTS.has(r.sport) && !r.individual),
    'the pre-fix table parsed as compliant');

  // ── the slate gate ──────────────────────────────────────────────────────
  const sg = slateGateState(good);
  check('the real source gates the slate walk too',
    sg.gated && sg.destructured && sg.beforeFetch, JSON.stringify(sg));
  check('removing the slate gate is detected',
    !slateGateState(good.replace('if (individual) continue;', '')).gated,
    'still reported gated with the line deleted');
  // A gate BELOW the fetch would skip the push and still spend the call. The
  // CC-CMD's own wording ("gate gameLines.push") describes exactly that.
  check('a gate placed after the fetch is detected',
    !slateGateState(good
      .replace('if (individual) continue;', '')
      .replace('gameLines.push(line);', 'if (individual) continue; gameLines.push(line);')).beforeFetch,
    'a gate below the ESPN call passed the before-fetch assertion');

  // ── the golf builder ────────────────────────────────────────────────────
  const gb = golfBuilderState(good);
  check('buildGolfCronContext is defined once and called',
    gb.definedOnce && gb.hasCaller && gb.noInlineCopy, JSON.stringify(gb));
  check('losing the only caller is detected',
    !golfBuilderState(good.replace('golfContext = await buildGolfCronContext(espnDate, env, golfData);', "golfContext = '';")).hasCaller,
    'still reported as having a caller with the call deleted');
  check('the inline copy coming back is detected',
    !golfBuilderState(good + "\n// Use leaderboard positions and scores only — never reference strokes gained.\n").noInlineCopy,
    'a second copy of the give-away line was not noticed');

  process.exit(failed === 0 ? 0 : 1);
}

const src = readFileSync(SRC, 'utf8');
const rows = parseLeagues(src);

check('the LEAGUES table parses', Array.isArray(rows) && rows.length > 0,
  rows === null ? 'const LEAGUES = [...] not found' : '0 rows parsed');
if (!rows || !rows.length) process.exit(1);

// Enumerated, not sampled: an entry silently dropped from the table would
// otherwise pass every assertion below by not being there.
// 21 -> 22 on 2026-08-27: CFB seeded (c52f496,
// CC-CMD-2026-08-21-archive-seed-coverage's `cfb` UNDECIDED entry, decided).
// It is a team sport and carries no `individual` flag, so the two assertions
// this file actually exists for are unchanged -- the ratchet fired on the count
// alone, which is the point of a ratchet.
const EXPECTED = 22;
check(`the table still has ${EXPECTED} entries`,
  rows.length === EXPECTED,
  `${rows.length} entries — if this is a deliberate add or removal, update EXPECTED in the same commit`);

const unknownSport = rows.filter(r => !TEAM_SPORTS.has(r.sport) && !r.individual);
check('every entry is a known team sport or is flagged individual',
  unknownSport.length === 0,
  unknownSport.map(r => `${r.label} (sport='${r.sport}')`).join('; ') +
  ' — add it to TEAM_SPORTS if its ESPN competitors are two sides, or mark it individual:true');

const flagged = rows.filter(r => r.individual);
check('the flagged entries are exactly the non-team ones',
  flagged.every(r => !TEAM_SPORTS.has(r.sport)),
  flagged.filter(r => TEAM_SPORTS.has(r.sport)).map(r => r.label).join('; ') +
  ' — a team sport marked individual would drop real games from the archive');

const sg = slateGateState(src);
check('the slate walk refuses a flagged event', sg.gated && sg.beforeFetch,
  `gated=${sg.gated} beforeFetch=${sg.beforeFetch} — without both, a golf event reaches gameLines and the journalism prompt gets a line with two empty names`);
check('the flag is destructured in the slate loop', sg.destructured,
  'the loop head does not carry `individual`, so the gate reads undefined and passes everything');

const gb = golfBuilderState(src);
check('buildGolfCronContext is defined once, called, and not duplicated inline',
  gb.definedOnce && gb.hasCaller && gb.noInlineCopy,
  `definedOnce=${gb.definedOnce} hasCaller=${gb.hasCaller} noInlineCopy=${gb.noInlineCopy} — ` +
  'a second copy of its body inline is how this function spent weeks looking uncalled');

const g = gateState(src);
check('the catch-up refuses a flagged event', g.gated,
  'the `if (gm.individual) continue;` gate is gone — golf rows will be archived again');
check('the flag reaches the catch-up', g.carried && g.destructured,
  `carried=${g.carried} destructured=${g.destructured} — the gate reads undefined without both, and passes everything`);

console.log(`\n${rows.length} LEAGUES entries, ${flagged.length} individual-competitor: ` +
  (flagged.map(r => r.label).join(', ') || 'none'));
process.exit(failed === 0 ? 0 : 1);
