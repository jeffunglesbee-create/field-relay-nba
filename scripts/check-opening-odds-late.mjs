#!/usr/bin/env node
/**
 * Every reader that prints an "opening" line honours the after-kickoff mark
 * (docs/CC-CMD-2026-10-19-cfb-saturday-coverage-and-join-probe.md, TASK A2, relay half).
 *
 * THE DEFECT. The opening side of the table was scoped out of CC-CMD-2026-09-14, so the sentences that say
 * "opened ..." took the blob as it came. Measured 2026-10-29 on regular_season_games from 2026-09-16: priced
 * opening lines carrying the late mark, CFB 116 of 183, NHL 97 of 202, NBA 15 of 69, NFL 4 of 33. The CI
 * backfill writes the SAME blob into both columns, so a game that kicked off before the 23:59Z snapshot has an
 * "opening" captured during the game, and " Odds: opened home -526 / away +369." was prose about an in-play price.
 *
 * WHAT IS RUN, and what is only read. EXECUTED on six REAL blobs (outbox/fixture-opening-odds-marks-20261029.json,
 * copied verbatim from field-archive): the three helpers in src/odds-consumer-rules.js, computeOddsStory, the real
 * buildBackfillPrompt (cut out of src/index.js and run), and the real source text of the three other sites that
 * cannot be called whole: the debrief block of buildGameCompletePrompt, the cron's debrief block, the slate
 * annotation loop, and findGame's lineMovement. The non-late output is compared with strings frozen from the
 * code BEFORE this change, byte for byte, so the rewrite is shown not to have moved what it should not.
 *
 * THE PREDICATE IS late_minutes, not `verified: false`. kickoffMark writes verified:false both for a line captured
 * after kickoff AND for a kickoff nobody could read (late_minutes null). One real MLS row of the second kind is in
 * the fixture, and the check asserts the two predicates DISAGREE on it.
 *
 * INDEX_SRC / RULES_SRC / STORY_SRC point the check at copies; scripts/mutate-opening-odds-late.mjs uses them.
 */
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const INDEX = resolve(process.env.INDEX_SRC || 'src/index.js');
const RULES = resolve(process.env.RULES_SRC || 'src/odds-consumer-rules.js');
const STORY = resolve(process.env.STORY_SRC || 'src/odds-story.js');
const R = await import(pathToFileURL(RULES).href);
const { computeOddsStory } = await import(pathToFileURL(STORY).href);
const indexText = readFileSync(INDEX, 'utf8');
const fx = JSON.parse(readFileSync('outbox/fixture-opening-odds-marks-20261029.json', 'utf8'));
const by = Object.fromEntries(fx.rows.map(r => [r.kind, r]));
const open = (k) => JSON.parse(by[k].opening_odds), close = (k) => JSON.parse(by[k].closing_odds);

const results = [];
const check = (name, ok, detail = '') => { results.push([name, !!ok, detail]); };

// ── The fixture is what it says ──
check('fixture: six real rows, every blob parses', fx.rows.length === 6 && fx.rows.every(r => { try { JSON.parse(r.opening_odds); JSON.parse(r.closing_odds); return true; } catch { return false; } }));
check('fixture: the denominators it was drawn from are recorded', fx.denominators_2026_09_16_to_10_29 === undefined && fx['denominators_2026-09-16_to_10-29'].CFB.verified_false === 116 && fx['denominators_2026-09-16_to_10-29'].CFB.priced === 183);

// ── knownLateOpening: the minutes decide, not verified:false ──
const LATE = { cfb_late: true, nhl_late: true, cfb_verified: false, nba_verified: false, mlb_unmarked: false, mls_unreadable_kickoff: false };
for (const [k, want] of Object.entries(LATE)) check(`knownLateOpening(${k}) is ${want}`, R.knownLateOpening(open(k)) === want);
check('knownLateOpening and knownPostKickoff DISAGREE on the real MLS row whose kickoff nobody could read (verified false, late_minutes null)',
  R.knownPostKickoff(open('mls_unreadable_kickoff')) === true && R.knownLateOpening(open('mls_unreadable_kickoff')) === false);
for (const [what, v, want] of [['null', null, false], ['undefined', undefined, false], ['{}', {}, false], ['late_minutes 0 (captured AT kickoff)', { _kickoff: { verified: false, late_minutes: 0 } }, true],
  ['late_minutes a string', { _kickoff: { late_minutes: '25' } }, false], ['late_minutes NaN', { _kickoff: { late_minutes: NaN } }, false],
  ['verified:false with minutes absent', { _kickoff: { verified: false } }, false]])
  check(`knownLateOpening(${what}) is ${want}`, R.knownLateOpening(v) === want);

// ── The frozen old outputs, for the rows that are NOT late (byte for byte) ──
const GOLD = {
  cfb_verified: { debrief: ' Odds: opened home -323 / away +255, closed home -323 / away +255.', ot: ' Odds: opened home -323 / away +255, closed home -323 / away +255. Went to OT.', parts: ['ML -323/255', 'O/U 52.5'] },
  nba_verified: { debrief: ' Odds: opened home -106 / away -110, closed home -106 / away -110.', ot: ' Odds: opened home -106 / away -110, closed home -106 / away -110. Went to OT.', parts: ['ML -106/-110', 'O/U 230.5'] },
  mlb_unmarked: { debrief: ' Odds: opened home -180 / away +148, closed home -180 / away +148.', ot: ' Odds: opened home -180 / away +148, closed home -180 / away +148. Went to OT.', parts: ['opened -1.5', 'ML -180/148', 'O/U 8'] },
  mls_unreadable_kickoff: { debrief: ' Odds: opened home +155 / away +145.', ot: ' Odds: opened home +155 / away +145. Went to OT.', parts: ['ML 155/145', 'O/U 2.5'] },
};
for (const [k, g] of Object.entries(GOLD)) {
  check(`debriefOddsLine(${k}) is byte for byte what the inline code printed before`, R.debriefOddsLine(open(k), close(k), false) === g.debrief, String(R.debriefOddsLine(open(k), close(k), false)));
  check(`...and with OT (${k})`, R.debriefOddsLine(open(k), close(k), true) === g.ot);
  check(`openingOddsParts(${k}) is what the inline code built before`, JSON.stringify(R.openingOddsParts(open(k))) === JSON.stringify(g.parts), JSON.stringify(R.openingOddsParts(open(k))));
}
// ── ...and what is new: an opening known late says nothing ──
for (const k of ['cfb_late', 'nhl_late']) {
  check(`debriefOddsLine(${k}) is null (it printed " Odds: opened home ... " before)`, R.debriefOddsLine(open(k), close(k), false) === null && R.debriefOddsLine(open(k), close(k), true) === null);
  check(`openingOddsParts(${k}) is empty (it printed "ML ..., O/U ..." under "odds:" before)`, R.openingOddsParts(open(k)).length === 0);
}
check('a valid opening with a closing known LATE keeps the opening and drops the close (unchanged behaviour)',
  R.debriefOddsLine(open('cfb_verified'), close('cfb_late'), false) === ' Odds: opened home -323 / away +255.');
check('no opening: null', R.debriefOddsLine(null, close('mlb_unmarked'), false) === null && R.debriefOddsLine(undefined, null, true) === null);
check('openingOddsParts(null) is empty', R.openingOddsParts(null).length === 0 && R.openingOddsParts(undefined).length === 0);
// The real blobs carry a negative spread at most, so the sign of a positive one and a pick'em are stated here.
check('openingOddsParts: a positive spread keeps its plus, a pick\'em prints 0, the order is spread, moneyline, total',
  JSON.stringify(R.openingOddsParts({ spread: { home: 3 }, moneyline: { home: 130, away: -150 }, total: { over: 45 } })) === JSON.stringify(['opened +3', 'ML 130/-150', 'O/U 45'])
  && JSON.stringify(R.openingOddsParts({ spread: { home: 0 } })) === JSON.stringify(['opened 0']), JSON.stringify(R.openingOddsParts({ spread: { home: 3 }, moneyline: { home: 130, away: -150 }, total: { over: 45 } })));

// ── computeOddsStory: movement from a price taken during the game is not movement ──
const goldStory = '[ODDS STORY] Total moved 0.5 (opened 8, closed 7.5) — under pressure.';
check('computeOddsStory(mlb_unmarked) is unchanged', computeOddsStory(by.mlb_unmarked.opening_odds, by.mlb_unmarked.closing_odds) === goldStory, computeOddsStory(by.mlb_unmarked.opening_odds, by.mlb_unmarked.closing_odds));
check('computeOddsStory: a late opening and a valid closing narrate nothing', computeOddsStory(by.nhl_late.opening_odds, by.mlb_unmarked.closing_odds) === '');
const stripped = open('nhl_late'); delete stripped._kickoff;
const unmarked = computeOddsStory(stripped, by.mlb_unmarked.closing_odds);
check('...and that silence comes from the MARK: the same opening without it narrates a movement (the check is not vacuous)', /ML moved 60 pts/.test(unmarked), unmarked);
check('computeOddsStory still accepts a JSON string and an object', computeOddsStory(open('mlb_unmarked'), close('mlb_unmarked')) === goldStory);

// ── Source text: cut a function or a statement out of index.js by anchors that must be unique ──
const once = (anchor) => {
  const n = indexText.split(anchor).length - 1;
  if (n !== 1) throw new Error(`ANCHOR ${JSON.stringify(anchor.slice(0, 80))} occurs ${n} times in ${INDEX}`);
  return indexText.indexOf(anchor);
};
const between = (from, to) => { const i = once(from); const j = indexText.indexOf(to, i); if (j < 0) throw new Error(`no ${to} after ${from}`); return indexText.slice(i, j + to.length); };

// A section that cannot be cut out or run is a FAILED check, never a crashed one.
const section = (name, fn) => { try { fn(); } catch (e) { check(`${name}: could not be cut out of the source and run`, false, String(e.message).slice(0, 160)); } };

// buildBackfillPrompt, whole: the real function, with the constants it reads
section('buildBackfillPrompt', () => {
  const start = once('function buildBackfillPrompt(date, games, seriesNarratives) {');
  const end = indexText.indexOf('\n}\n', start) + 2;
  const fn = new Function('JQ_STYLE', 'openingOddsParts', 'voiceRegisterFor', `${indexText.slice(start, end)}\nreturn buildBackfillPrompt;`)('- JQ', R.openingOddsParts, () => '');
  const game = (kind, extra = {}) => ({ league: by[kind].sport, sport: by[kind].sport, home: by[kind].home, away: by[kind].away, home_score: 3, away_score: 2, opening_odds: by[kind].opening_odds, ...extra });
  const prompt = fn('2026-09-17', [game('cfb_verified'), game('cfb_late'), game('nhl_late'), game('mlb_unmarked')], {});
  const line = (home) => (prompt.split('\n').find(l => l.includes(` @ ${home} `) || l.includes(` @ ${home} |`)) || '');
  check('buildBackfillPrompt: a game with a verified opening keeps its "odds:" fragment, unchanged', /odds: ML -323\/255, O\/U 52\.5/.test(line('Texas Tech')), line('Texas Tech'));
  check('buildBackfillPrompt: a game whose opening was captured after kickoff has NO "odds:" fragment (CFB)', line('Pitt') !== '' && !/odds:/.test(line('Pitt')), line('Pitt'));
  check('buildBackfillPrompt: ...and none for the NHL game', line('Maple Leafs') !== '' && !/odds:/.test(line('Maple Leafs')), line('Maple Leafs'));
  check('buildBackfillPrompt: an unmarked MLB opening is still printed, with its spread', /odds: opened -1\.5, ML -180\/148, O\/U 8/.test(line('Guardians')), line('Guardians'));
});

// The debrief block of buildGameCompletePrompt, and the cron's copy of it: the real two statements, run
for (const [name, from, to, ctxName, pushName] of [
  ['buildGameCompletePrompt debrief', 'const oddsLine = debriefOddsLine(', 'if (oddsLine) lines.push(oddsLine);', 'debriefCtx', 'lines'],
  ['cron debrief block', 'const _oddsLine = debriefOddsLine(', 'if (_oddsLine) _lines.push(_oddsLine);', '_dc', '_lines'],
]) section(name, () => {
  const code = between(from, to);
  const run = (kind, ot) => {
    const ctx = { opening_odds_parsed: open(kind), closing_odds_parsed: close(kind), went_to_ot: ot };
    const out = [];
    new Function(ctxName, pushName, 'debriefOddsLine', code)(ctx, out, R.debriefOddsLine);
    return out;
  };
  check(`${name}: a verified opening is printed exactly as before (with OT)`, JSON.stringify(run('cfb_verified', true)) === JSON.stringify([GOLD.cfb_verified.ot]), JSON.stringify(run('cfb_verified', true)));
  check(`${name}: an opening captured after kickoff adds no line (CFB, NHL)`, run('cfb_late', false).length === 0 && run('nhl_late', true).length === 0);
  check(`${name}: the closing, the opening and the OT flag are passed in that order`, JSON.stringify(run('mlb_unmarked', false)) === JSON.stringify([GOLD.mlb_unmarked.debrief]));
  // The real rows carry the same moneyline in both columns, which would hide a swap of the two arguments.
  const distinct = (ot) => {
    const ctx = { opening_odds_parsed: { moneyline: { home: -110, away: -110 } }, closing_odds_parsed: { moneyline: { home: -150, away: 130 } }, went_to_ot: ot };
    const out = []; new Function(ctxName, pushName, 'debriefOddsLine', code)(ctx, out, R.debriefOddsLine); return out;
  };
  check(`${name}: an opening that differs from the closing is printed as the opening, the closing as the close`, JSON.stringify(distinct(false)) === JSON.stringify([' Odds: opened home -110 / away -110, closed home -150 / away +130.']), JSON.stringify(distinct(false)));
  check(`${name}: ...and the OT flag reaches the line`, JSON.stringify(distinct(true)) === JSON.stringify([' Odds: opened home -110 / away -110, closed home -150 / away +130. Went to OT.']));
});

// The slate annotation loop: the real statements that turn a stored blob into " [ODDS: ...]"
section('slate annotation', () => {
  const code = between('const odds = JSON.parse(raw);', "oddsAnnotations[i] = ` [ODDS: ${parts.join(', ')}]`;");
  const annotate = (kind) => { const oddsAnnotations = []; new Function('raw', 'i', 'oddsAnnotations', 'openingOddsParts', code)(by[kind].opening_odds, 0, oddsAnnotations, R.openingOddsParts); return oddsAnnotations[0]; };
  check('slate annotation: a verified opening is annotated exactly as before', annotate('cfb_verified') === ' [ODDS: ML -323/255, O/U 52.5]', String(annotate('cfb_verified')));
  check('slate annotation: an unmarked MLB opening keeps its spread', annotate('mlb_unmarked') === ' [ODDS: opened -1.5, ML -180/148, O/U 8]', String(annotate('mlb_unmarked')));
  check('slate annotation: an opening captured after kickoff gets NO annotation (CFB, NHL)', annotate('cfb_late') === undefined && annotate('nhl_late') === undefined);
});

// findGame's lineMovement
section('lineMovement', () => {
  const code = between('lineMovement: (openingOdds && closingOdds', '} : null,');
  const movement = (o, c) => new Function('openingOdds', 'closingOdds', 'knownLateOpening', `return ({ ${code} });`)(o, c, R.knownLateOpening).lineMovement;
  const syn = (late, home) => ({ spread: { home }, ...(late ? { _kickoff: { verified: false, late_minutes: 12 } } : {}) });
  check('lineMovement: a normal opening and closing give the movement', JSON.stringify(movement(syn(false, -3), syn(false, -4.5))) === JSON.stringify({ spreadOpen: -3, spreadClose: -4.5, moved: true }), JSON.stringify(movement(syn(false, -3), syn(false, -4.5))));
  check('lineMovement: an opening captured after kickoff gives null, not a "spreadOpen"', movement(syn(true, -3), syn(false, -4.5)) === null);
  check('lineMovement: no closing gives null', movement(syn(false, -3), null) === null);
});

// ── WIRING: the prose lives in one place, and every reader goes through it ──
const count = (re, text = indexText) => (text.match(re) || []).length;
check('wiring: debriefOddsLine is called at exactly two sites (the prompt builder and the cron)', count(/debriefOddsLine\(/g) === 2, String(count(/debriefOddsLine\(/g)));
check('wiring: openingOddsParts is called at exactly two sites (the backfill prompt and the slate annotation)', count(/openingOddsParts\(/g) === 2, String(count(/openingOddsParts\(/g)));
check('wiring: findGame consults knownLateOpening', count(/knownLateOpening\(openingOdds\)/g) === 1);
check('wiring: no reader formats an opening inline any more: no "Odds: opened", no `opened ${`, no `ML ${…moneyline`', count(/Odds: opened/g) === 0 && count(/`opened \$\{/g) === 0 && count(/`ML \$\{[a-z.]*moneyline/g) === 0, `${count(/Odds: opened/g)} / ${count(/`opened \$\{/g)} / ${count(/`ML \$\{[a-z.]*moneyline/g)}`);
const storyText = readFileSync(STORY, 'utf8');
check('wiring: odds-story.js imports knownLateOpening and uses it before it narrates', /import \{ knownLateOpening \} from '\.\/[^']+'/.test(storyText) && storyText.indexOf('knownLateOpening(open)') > 0 && storyText.indexOf('knownLateOpening(open)') < storyText.indexOf('const parts = [];'));
const ctxText = readFileSync('src/context-assembler.js', 'utf8');
check('wiring: the two callers of computeOddsStory (the assembler and the odds-story view) both go through it', count(/computeOddsStory\(row\.opening_odds/g, ctxText) === 1 && count(/computeOddsStory\(row\.opening_odds/g) === 1);
check('wiring: index.js imports the three helpers from odds-consumer-rules.js', /import \{[^}]*debriefOddsLine[^}]*openingOddsParts[^}]*knownLateOpening[^}]*\} from '\.\/odds-consumer-rules\.js'/.test(indexText));

let failed = 0;
for (const [name, ok, detail] of results) {
  if (!ok) { failed++; console.log(`FAIL  ${name}${detail ? '  [' + detail + ']' : ''}`); }
}
console.log('executed on six real blobs: the three helpers, computeOddsStory, buildBackfillPrompt (whole), and the real statements of 4 sites (2 debrief blocks, the slate loop, lineMovement).');
console.log('NOT executed: the surrounding functions of those four statements (they need a live D1 and a cycle); their wiring is read above.');
console.log(`${results.length - failed} of ${results.length} passed.`);
process.exit(failed ? 1 : 0);
