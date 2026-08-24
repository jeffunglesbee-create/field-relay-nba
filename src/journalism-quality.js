// ═══════════════════════════════════════════════════════════════════════════
// FIELD Journalism Quality Module — JQ v3 (Jun 8 2026, 300-point scale)
// ═══════════════════════════════════════════════════════════════════════════
// Ports the full client-side journalism quality chain to the relay so that
// the live-browser path (J3 brief, J5 Night Owl, J2 series, MLB brief, Stakes
// brief) flows through the relay's quality gate before reaching the user.
//
// Patent posture: relay enforces journalism quality structurally, not via
// prompt-only guidance. Per ADR-002, this is editorial QUALITY enforcement
// (Boolean rule application: "contains banned phrase Y/N"), not editorial
// INTELLIGENCE (interest level computation). Rule enforcement is acceptable.
//
// All functions are pure — no DOM, no localStorage, no Web Crypto. Safe to
// run in the Cloudflare Worker runtime with 30ms CPU budget.
// ═══════════════════════════════════════════════════════════════════════════

// ── Layer 1: BANNED_PHRASES (mirrors browser FIELD_PROSE_STYLE) ─────────────
// ── Scoring eras ────────────────────────────────────────────────────────────
// CC-CMD-2026-08-13-jq-density-unit-fix TASK 3.
//
// Every entry here marks a change to `scoreProse` that makes scores on either
// side of it NON-COMPARABLE. This table exists because the previous such
// change did not record one, and the cost was measurable: two calibration
// rechecks (2026-07-16, 2026-07-17) burned themselves out asking "is the
// quality trend real" when the mlb_game mean fell 203.2 → 135.4 across the
// 6aed3bb boundary. Rescoring the corpus under one rubric later showed the
// two eras differ by 0.9 points on a 300-point scale — the entire 68-point
// drop was the formula. A rolling window that spans a boundary is comparing
// two different instruments and cannot tell you about the prose.
//
// Consumed by /quality/report, so anyone reading an alert sees the boundaries
// their window may straddle. Add an entry BEFORE deploying any scoreProse
// change that moves scores.
export const SCORING_ERAS = [
  {
    era: 2,
    from: '2026-07-16T01:36:49Z',
    deploy: '6aed3bb',
    change: 'Dim 1 redefined per-sentence; Dim 4 clamped to [0,1] (was unbounded). AMENDED 2026-08-24: this entry recorded one of 6aed3bb\'s two changes. The commit\'s own subject line names the other -- "replace 3b\'s numeric retry-accept gate with a qualitative voice judge" -- which deleted `const THRESHOLD = opts.scoreThreshold || 240` and the `score < THRESHOLD` retry trigger. That was right; the composite it gated scored this file\'s labeled anti-exemplar 214 and its real Exemplar A 136. But it orphaned ten call sites still passing scoreThreshold, plus getQualityTarget and loadQualityCalibration upstream of them, and nothing noticed for 39 days: measured 2026-08-24, a floor of 999 accepted a score of 126 with zero retries. AN ERA ENTRY MUST RECORD WHAT A COMMIT DID TO THE RETRY PATH, not only to the score, because a scoring change and a gating change are both changes to what quality means. Removed in 3536aca along with the guard that would have caught it, scripts/check-opts-keys-are-read.mjs.',
    measuredEffect: 'mlb_game stored mean 203.2 -> 135.4 (n=325 pre / 267 post); rescored delta +0.9',
    recordedRetroactively: true,
  },
  {
    era: 3,
    from: '2026-08-13T03:20:00Z',
    deploy: 'CC-CMD-2026-08-13-jq-density-unit-fix',
    change: "Dim 4 ratio unit: (properNouns+numbers)/sent -> numbers/sent, matching the FIELD_PROSE_STYLE rule it cites",
    measuredEffect: 'Dim 4 floored 91.2% -> 7.9% of briefs; mean contribution 0.35 -> 9.89 of 16 pts (n=592)',
    recordedRetroactively: false,
  },
  {
    era: 4,
    from: '2026-08-23T15:00:00Z',
    deploy: 'CC-CMD-2026-08-20-brief-data-quality ask 6b',
    change: 'SCALE reweighted toward the dimensions that separate finished prose from in-progress prose: arc 45->55, ctx 25->32, temporal 20->25, funded by voice 30->20, density 16->10, matchup 30->24. Nominal total unchanged at 300.',
    // Measured on the SAME 190 rows before and after, so this is a before/after
    // on identical prose rather than two samples that could differ for their own
    // reasons. scoreProse's total is linear in the per-dimension fractions, so
    // both weightings were evaluated from one scoring pass.
    measuredEffect: 'RECORDED AS 6.4 -> 11.5 pts; THE LIVE EFFECT IS 4.5 pts at 1.8x the standard error, which the script itself calls INDISTINGUISHABLE from noise (n=80/class, 2026-08-24, outbox/rescore-quality-6b-20260824T051526Z.json). The 11.5 was a candidate weighting evaluated arithmetically as sum(dim_k * SCALE_k), and scoreProse does not read SCALE for dims 6-10, so it simulated an instrument that was never deployed. Proof in one file: the 04:58 manifest reports current gap 4.5 from scoreProse and 8.6 from the same-named candidate; after SCALE was corrected the 05:15 manifest reports 4.5 for both. Only density 16->10 was ever applied, density being a dim 1-5. Reweighting ceiling is 38.2 against the real scale (was quoted 41.6 against the declared one).',
    recordedRetroactively: false,
    // Added 2026-08-24, and it corrects this entry rather than superseding it.
    //
    // Five of the six weights this era changed were never read by the scorer.
    // The `change` string above says "arc 45->55, ctx 25->32, temporal 20->25,
    // funded by voice 30->20, density 16->10, matchup 30->24" -- and every
    // from-value is the code's real ceiling, which is the tell: the era wrote
    // new numbers into a table scoreProse does not consult for dims 6-10.
    // `density 16->10` is the one that landed, because density is a dim 1-5 and
    // those ARE multiplied by SCALE.
    //
    // The measured effect above stands: it came from rescoring 190 real rows,
    // not from the constants. What was wrong is the attribution -- the gap moved
    // 6.4 -> 11.5 on the strength of the dims 1-5 changes alone.
    //
    // NO SCORE MOVED when SCALE was corrected on 2026-08-24, for the same reason
    // the reweighting did not move one: nothing reads those five. So this is a
    // correction to the record and NOT a new era. An era boundary fragments
    // /quality/report's calibration window, and there is no instrument change
    // here to justify one.
    //
    // The reweighting ceiling of 41.6 quoted above was computed against the
    // declared weights, so its arithmetic needs redoing against the real scale
    // before it is cited again. The bound is real; the number is not yet.
    correctedOn: '2026-08-24T04:00:00Z',
    correction: 'SCALE dims 6-10 were documentation, not weights: arc 55->45, ctx 32->25, temporal 25->20, voice 20->30, matchup 24->30, restoring the values the code actually reaches. Declared total 300->294. No score changes -- scoreProse reads SCALE only for dims 1-5. Guarded from here by scripts/check-scale-matches-implementation.mjs.',
  },
  {
    era: 5,
    from: '2026-08-24T05:45:00Z',
    deploy: 'CC-CMD-2026-08-23-finality-dimension',
    change: 'Dim 11 added: finality agreement, 20 points, the first dimension that reads game state. Funded entirely from the two proxies it replaces -- arc 45->33 (literals 10/10/10/15 -> 8/8/8/9), ctx 25->17 (8/8/9 -> 6/6/5). Nominal total unchanged at 294. Scores prose-vs-fact AGREEMENT both ways: a recap reading as final on a finished game and a brief hedging about a live one both score 20; either mismatch scores 0; self-contradicting prose scores 0 under its own verdict; unknown finality and no-finality-reading abstain at 10.',
    // THE JUSTIFICATION IS A MEASUREMENT OF THE OLD INSTRUMENT, not a projection
    // of the new one. Era 4's recorded effect was the latter and described a
    // weighting scoreProse never applied; this states what the rubric could not
    // do, measured on real rows, before anything changed.
    measuredEffect: 'BEFORE -> AFTER, same script, same 128 fact-stratified rows, artifacts outbox/rescore-quality-6b-20260824T053829Z.json and -20260824T121117Z.json. THE HEADLINE: the LIVE_LANG prose gap collapsed from -14.1 at 4.4x the standard error to -0.2 at 0.1x (rescored.gap_rescored in both manifests). CORRECTED 2026-08-24: this first read "-11.1 at 4.1x" for the BEFORE. That number is not from the before-run at all -- it is candidates.current in the AFTER run, and that block was itself broken: scripts/rescore-quality-6b.mjs mapped DIM_TO_SCALE.matchupDepth -> "matchup" with no entry for finality, so after era 5 added Dim 11 the candidate reconstruction silently omitted 20 of 294 points and (dims[k] || 0) * (W[k] ?? 0) coerced the missing names to zero. So the published before/after compared two different instruments inside one run, one of them measuring a rubric that excluded the very dimension the era added. The figures above use gap_rescored on both runs, which agreed with the candidate block before era 5 (-14.0 vs -14.1) and diverged by 10.9 after it -- that divergence is how the defect was found. THE CONCLUSION IS UNCHANGED AND THE EFFECT IS LARGER than was published. Before era 5 the rubric paid briefs using in-progress language 14.1 points MORE than briefs reading as final, significantly; it now pays them the same. That is the correction era 4 set out to make and did not, because era 4 changed a table the scorer does not read for dims 6-10. Dim 11 charges 10-20 points on exactly the rows that were benefiting -- 28 of 128 briefs hedge about games that had already finished, against 1 that calls a live game final. SECONDARY, and largely definitional since Dim 11 defines the groups: agrees-vs-disagrees separation -4.0 (0.9x) -> +15.7 (3.6x). It is 15.7 rather than 20 because the arc 45->33 and ctx 25->17 refund costs 4.3 points back, which is the funding showing up rather than being asserted. Dim 11 scores non-zero on both sides of the fact (6.9 on finalized rows, 10.0 on live), the test Dim 10 failed silently for two months at zero on 190 of 190. CAVEAT ON THE FIRST ATTEMPT: run 20260824T062958Z showed no movement because the rescore script passed opts.game without finalizedAt, so the dimension abstained on all 128 rows; both paths now cross-check per row (path_disagreement, 0 in the run cited) and the workflow fails rather than publishing totals scored by an abstaining dimension.',
    recordedRetroactively: false,
  },
  {
    era: 6,
    from: '2026-08-24T13:10:00Z',
    deploy: 'CC-CMD-2026-08-23-matchup-note-starvation',
    change: 'Dim 10 re-pointed from matchupNote ECHO to margin agreement. Same 30 points, no scatter, total unchanged at 294. SCALE key renamed matchup -> margin, deliberately: a weight-preserving semantic change is invisible to the era fingerprint, and renaming is what makes this era detectable at all. Sport-free thresholds: tight = went to extra time or decided by <=1; lopsided = margin >=3 AND loser <=60% of winner; everything between abstains.',
    measuredEffect: 'BEFORE: Dim 10 scored zero on 128 of 128 re-scored rows, 30 of 294 points dark. Not for want of running -- regular_season_games.note is populated on 37 of 1322 finalized games, and 30 of those 37 are golf leaderboard strings ("Wyndham Clark -17") for a sport that has no matchup at all, so the headline 2.8% is 0.54% (7/1292) once the sport that cannot use the column is set aside. Of those 7, five are broadcast carriage ("Sunday Night Baseball on NBC/Peacock", "Local RSN blacked out") and two are real editorial hooks. POPULATING IT WOULD HAVE MADE THE DIMENSION WORSE: the note is injected into the prompt, so counting note words in the prose pays 30 points for parroting an input, which is the behaviour check-prompt-example-leak.mjs exists to catch one file over. Margin agreement reads a RELATION between two numbers that is present on ~100% of finalized rows and cannot be copied from the prompt. AFTER, and it took three runs to get an honest one. Run 16 met the stated done condition -- marginAgreement nonzero on 128 of 128 rows against the 0 of 190 matchupDepth managed -- and that number was worth almost nothing: 124 of the 128 were ABSTAINS at the midpoint, so the done condition I wrote was satisfiable by a dimension that separates nothing (Rule 89, against my own spec). Run 17 added the census that can tell those apart: 4 rows judged, 3.1%, 0 disagreements, separation UNDERPOWERED. Reachability 0% -> 100%, judgement 0% -> 3.1%. Run 18 carried the PROSE of six abstaining briefs rather than the count, because "no-clear-reading" has two causes with different fixes and the old Dim 10 spent two months fixed the wrong way. Five of six said it outright -- "break the deadlock", "scoreless stalemate", "scoreless draw", "dominated" -- in words the regex did not hold. Blind regex, not silent prose, and the misses had one shape: one-run, one-possession, walk-off, extra innings. The thresholds were made sport-free and the VOCABULARY was left American, on a corpus that is mostly European soccer. Run 19, after widening it: judged 4 -> 17 (3.1% -> 13.3%), no-clear-reading 47 -> 34, and the dimension caught its first real defect, one row calling a tight game a rout. Separation is still UNDERPOWERED at n=1 on the disagree side and is reported as such rather than claimed. GENUINE RESIDUAL, both measured: 34 rows whose prose still makes no closeness claim, and 56 with no result to judge -- 32 with no game row at all and 24 with a game row whose home_score is null, which is a data gap in regular_season_games, not the dimension declining. REPEATED: run 20 (outbox/rescore-quality-6b-20260824T151659Z.json) returned a byte-identical census on the same build -- 16 agrees, 34 no-clear-reading, 21 no-honest-verdict, 56 unknown-result, 1 calls-a-tight-game-a-rout -- so the 17 is the instrument, not a sampling accident. nonzero_rows_per_dim.marginAgreement reads 127 of 128 there rather than 128, and the missing row is the defect: a dimension that can only ever return nonzero cannot penalise anything. Manifests: before outbox/rescore-quality-6b-20260824T125155Z.json, after outbox/rescore-quality-6b-20260824T142137Z.json and outbox/rescore-quality-6b-20260824T151659Z.json (both: census_agrees true, totals_add_up true, path_disagreement 0).',
    recordedRetroactively: false,
  },
];

// Which scoring era a brief's stored score belongs to, from its `date`.
//
// Exists so `/quality/report` can calibrate WITHIN an era instead of across a
// mixture of them. Without it, a 30-day percentile window spanning a boundary
// is a percentile over two different instruments — the condition that made a
// pure formula change read as a 68-point collapse in prose quality.
//
// `ambiguous` is set when the brief's date IS the boundary date: era `from`
// timestamps carry a time of day but `briefs.date` does not, so same-day rows
// cannot be attributed. They are excluded from era-scoped calibration rather
// than guessed — a handful of rows is not worth a wrong bucket.
//
// This derives the era from a DATE, which is correct only while scores are
// written at generation time. A backfill that rescores old text under a new
// formula would break that assumption, which is why `briefs.scoring_version`
// exists as the authoritative record; this function is the fallback for rows
// written before that column did.
export function eraForDate(dateStr) {
  const d = String(dateStr || '').slice(0, 10);
  if (!d) return { era: null, ambiguous: false };
  let era = 1, ambiguous = false;
  for (const e of SCORING_ERAS) {
    const from = e.from.slice(0, 10);
    if (d > from) era = e.era;
    else if (d === from) { era = e.era; ambiguous = true; }
  }
  return { era, ambiguous };
}

export const CURRENT_SCORING_ERA = SCORING_ERAS[SCORING_ERAS.length - 1].era;

export const BANNED_PHRASES = [
  'punch their ticket','the stage is set','make a statement',
  'facing a must-win','looking to bounce back','all eyes on',
  'put the league on notice','a tale of two halves','rise to the occasion',
  'leave it all on the floor','leave it all on the field','leave it all on the court',
  'backs against the wall','do-or-die','prove the doubters wrong',
  'send a message','weather the storm','turn the page',
  'take care of business','control their own destiny','gut check',
  'step up when it matters','laying it on the line','battle-tested',
  'high-octane','red-hot','ice-cold','pulling away',
  "in the driver's seat",'with their season on the line',
  'cement their legacy','the chess match continues',
  'salvage pride','insurmountable deficit','clinical execution',
  'dictated the tempo','decisive series deficit','statement series clincher',
  'ruthless sweep','the team to beat','perimeter scoring',
  'offensive production required','exploit defensive lapses',
  'gritty performance','gritty win','fired on all cylinders',
  'on the brink','must-win situation','at this point in the season',
  'when it counts','dig deep','put this one away','get back on track',
  'on a mission','statement win','pivotal moment','defining moment',
  'all the marbles','one game at a time',
  // P0.2 additions (June 4 2026): clunky wire-copy patterns seen in Morning Report
  'secured a victory','secured a win','secured the win','secured the victory',
  'capitalized on scoring opportunities','capitalize on scoring',
  'finalize a','finalize the',
  'overcome the','to overcome','managed to overcome',
  'result moved','result moves',
  'continued their','extended their','maintained their momentum',
  // 2026-08-23. jubilant-bassoon's CLAUDE.md carries a section headed "Banned
  // Journalism Phrases": "Never generate content containing: stunned, shocked,
  // thriller, instant classic, for the ages, must-watch, can't-miss."
  //
  // Not one of the seven was in this list. A live brief through
  // /journalism/generate opened "Hull City stunned Manchester United 2-0", and
  // hasCliche() returned [] on it — the governing document banned the word and
  // the code had never been told.
  //
  // 'must-watch' was in SPARINGLY_PHRASES, which permits one use per brief. A
  // phrase cannot be both banned outright and allowed once; the document is
  // the authority on FIELD's voice, so it moves here and leaves there.
  'stunned','shocked','thriller','instant classic','for the ages',
  'must-watch',"can't-miss",
];

export const SPARINGLY_PHRASES = [
  'crucial','critical','pivotal','key',
  'dominant','dominance','impressive','outstanding',
  // 'must-watch' removed 2026-08-23 — CLAUDE.md bans it outright, so it cannot
  // also live here on a once-per-brief allowance. See BANNED_PHRASES above.
  'storyline','narrative',
  'momentum','statement game','statement',
  'big-time','clutch','electric','exciting',
  'under the radar','overlooked',
  'deep dive','breakdown',
  'defensive struggles','defensive issues','however',
];

// ── Layer 2: cliché detection ───────────────────────────────────────────────
export function hasCliche(text) {
  if (!text) return [];
  const lower = text.toLowerCase();
  return BANNED_PHRASES.filter(p => lower.includes(p));
}

export function countSparingly(text) {
  if (!text) return [];
  const lower = text.toLowerCase();
  return SPARINGLY_PHRASES
    .map(p => {
      let count = 0, idx = 0;
      while ((idx = lower.indexOf(p, idx)) !== -1) { count++; idx += p.length; }
      return { phrase: p, count };
    })
    .filter(r => r.count >= 2);
}

// ── Layer 2b: sport vocabulary contamination ────────────────────────────────
// Cross-sport vocabulary contamination = factual error, not style issue.
// Same retry architecture as cliché check.
export const SPORT_VOCAB_VIOLATIONS = {
  baseball: {
    forbidden: [
      'one-possession','possession game','one possession',
      'quarter','quarters','first quarter','fourth quarter','halftime','half time',
      'field goal','field goal percentage','field goals',
      'three-point','three-pointer','three pointer','free throw',
      'transition game','fast break','assist','assists','rebound','rebounds',
      'down the stretch','in the paint',
      'basket','baskets','touchdown','first down','red zone','turnover on downs',
      'offsides','penalty kick','extra time','nil',
      'ball movement','offensive rhythm','interior scoring'
    ],
    sport: 'baseball',
    units: 'runs (not points)',
    extra_period: 'extra innings (not overtime, not OT, not quarters)'
  },
  hockey: {
    forbidden: [
      'quarter','quarters','halftime','half time',
      'field goal','three-point','free throw','rebound','assist',
      'touchdown','first down','red zone',
      'inning','innings','at-bat','strikeout','strikeouts','home run','home runs',
      'offsides','penalty kick','extra time','nil',
      'in the paint','down the stretch'
    ],
    sport: 'hockey',
    units: 'goals (not points, runs, or scores)',
    extra_period: 'overtime (3rd OT, 4th OT, etc.) — never extra innings or quarters'
  },
  basketball: {
    forbidden: [
      'inning','innings','at-bat','strikeout','home run','home runs',
      'touchdown','first down','red zone','field goal percentage of a kicker',
      'offsides','penalty kick','nil','goal kick',
      'period','periods' // hockey term
    ],
    sport: 'basketball',
    units: 'points',
    extra_period: 'overtime (OT, 2OT, 3OT, etc.)'
  },
  football: { // NFL
    forbidden: [
      'inning','innings','at-bat','strikeout','home run',
      'three-pointer','free throw','rebound','assist',
      'offsides','penalty kick','nil','extra time',
      'period','periods'
    ],
    sport: 'football (American)',
    units: 'points',
    extra_period: 'overtime'
  },
  // TENNIS added 2026-08-24 alongside Exemplar K. The forbidden list is the
  // union of the other five sports' own units -- a tennis match has no innings,
  // quarters, periods or downs, and crucially NO CLOCK, so "with a minute left"
  // and "late in the fourth" are impossible rather than merely wrong. `overtime`
  // is the sharp one: a tied set goes to a TIEBREAK, and a deciding set may go
  // on indefinitely where no tiebreak is played.
  tennis: {
    forbidden: [
      'inning','innings','at-bat','strikeout','home run',
      'quarter','quarters','first quarter','fourth quarter',
      'three-pointer','free throw','rebound','in the paint',
      'touchdown','first down','red zone',
      'period','periods','overtime','stoppage time','extra innings',
      'halftime','power play','penalty kill','clean sheet',
    ],
    sport: 'tennis',
    units: 'games and sets (a point is not a unit of score you report on its own)',
    extra_period: 'a tiebreak (never overtime, extra time, extra innings or a fifth quarter). There is no clock: nothing happens "late in the fourth" or "with a minute left".',
  },
  soccer: {
    forbidden: [
      'inning','innings','at-bat','strikeout','home run',
      'quarter','quarters','halftime quarter','first quarter','fourth quarter',
      'three-pointer','free throw','rebound','assists per game',
      'touchdown','first down','red zone',
      'in the paint','one-possession','transition game','fast break',
      'period','periods'
    ],
    sport: 'soccer',
    units: 'goals (not points)',
    extra_period: 'extra time / stoppage time (not overtime, OT, or extra innings)'
  }
};

export function detectSportClass(sport) {
  const s = (sport||'').toLowerCase();
  if (s.includes('baseball') || s.includes('mlb')) return 'baseball';
  if (s.includes('hockey') || s.includes('nhl')) return 'hockey';
  if (s.includes('basketball') || s.includes('nba') || s.includes('wnba') || s.includes('ncaa-mb')) return 'basketball';
  if (s.includes('soccer') || s.includes('epl') || s.includes('premier') || s.includes('mls') || s.includes('uefa') || s.includes('ucl') || s.includes('serie') || s.includes('liga') || s.includes('bundesliga') || s.includes('ligue') || s.includes('wc26') || s.includes('wc') || /world.cup|fifa/i.test(s)) return 'soccer';
  // CFL added 2026-08-24 with Exemplar I. It was unclassified, so it took the
  // keep-everything fallback and received basketball and hockey exemplars in
  // every brief. Canadian football is not American football, but it is far
  // closer to it than to either of those -- the same call basketball already
  // makes for NBA and WNBA.
  if (s.includes('nfl') || s.includes('football') || s.includes('cfl')) return 'football';
  // Added 2026-08-24 so a golf rule can be scoped TO golf. Knock-ons checked:
  // checkSportVocab returns [] for a class with no SPORT_VOCAB_VIOLATIONS entry.
  // voiceRegisterFor is UNCHANGED by this: golf has no voice segment, so it took
  // the keep-everything fallback before this branch existed and still does. See
  // that function's own comment for why narrowing it is not the right fix.
  if (s.includes('golf') || s.includes('pga')) return 'golf';
  // Tennis. `atp` and `wta` are the relay's own keys (_SPORT_NORMALIZE maps
  // 'atp tour' and 'wta tour'), and assembleContext promotes atp -> wta when the
  // league signals women's tennis -- both reach here as separate labels, so both
  // are matched. Added WITH Exemplar K, not before it: a class with no exemplar
  // takes voiceRegisterFor's keep-everything fallback, which is how golf came to
  // receive basketball and hockey exemplars while looking classified.
  if (s.includes('tennis') || s.includes('atp') || s.includes('wta')) return 'tennis';
  return null;
}

export function checkSportVocab(text, sport) {
  if (!text || !sport) return [];
  const cls = detectSportClass(sport);
  if (!cls) return [];
  const vocab = SPORT_VOCAB_VIOLATIONS[cls];
  if (!vocab) return [];
  const lower = text.toLowerCase();
  return vocab.forbidden.filter(term => lower.includes(term));
}

// ── Layer 2c: generic lead sentence detection ───────────────────────────────
export const LEAD_SENTENCE_RE = /^The [A-Z][a-z]+ (are|have|will|look|need|must|face|enter|hope|want|seek|open|host|visit|travel|return|aim|play|sit|stand|hold|lead|trail|take|make|get)\b/;

export function hasGenericLead(text) {
  if (!text) return null;
  const firstSentence = text.trim().split(/[.!?]/)[0];
  return LEAD_SENTENCE_RE.test(firstSentence.trim()) ? firstSentence.trim() : null;
}

// ── Layer 2d: stat verification ─────────────────────────────────────────────
// Extracts stats from the prompt context block ("Leaders: Brunson 28pts ...")
// and verifies they appear in the generated text.
export function extractStatsFromContext(prompt) {
  if (!prompt) return [];
  // Match numeric+unit patterns: "29.0 PPG", "107.7 DRTG", "+17%", "3.7 BPG"
  const stats = new Set();
  const patterns = [
    /\b\d{1,3}(?:\.\d{1,2})?\s*(?:PPG|APG|RPG|BPG|SPG|MPG)\b/g,
    /\b\d{1,3}(?:\.\d{1,2})?\s*(?:ERA|WHIP|OPS|WAR)\b/gi,
    /\b\d{1,3}(?:\.\d{1,2})?\s*(?:DRTG|ORTG|PACE)\b/g,
    /\b\d{1,3}(?:\.\d{1,2})?%\b/g, // percentages
    /\b\d{1,3}-\d{1,3}\b/g, // series records like 3-2
    /\b\d{1,3}\s+(?:points|goals|runs|hits|shots)\b/gi,
  ];
  for (const p of patterns) {
    const matches = prompt.match(p) || [];
    matches.forEach(m => stats.add(m.trim()));
  }
  return [...stats];
}

export function missingStats(prompt, text) {
  if (!prompt || !text) return [];
  const required = extractStatsFromContext(prompt);
  if (!required.length) return [];
  const lower = text.toLowerCase();
  return required.filter(s => !lower.includes(s.toLowerCase()));
}

// ── Layer 2e: cross-sport hallucination (May 31 2026) ───────────────────────
// Trophy-first detection. See journalism-quality.js inline docs and
// index.html Layer 2e block for full architecture notes.
export const LEAGUE_TROPHIES = {
  nba:  ['nba finals','nba championship','wcf','ecf','western conference finals','eastern conference finals',"larry o'brien"],
  nhl:  ['stanley cup','stanley cup final','stanley cup finals'],
  mlb:  ['world series','alcs','nlcs','al championship series','nl championship series','american league championship','national league championship',"commissioner's trophy"],
  nfl:  ['super bowl','afc championship','nfc championship','afc title game','nfc title game','vince lombardi','lombardi trophy'],
  mls:  ['mls cup','mls cup final'],
  epl:  ['premier league title','premier league trophy','prem title'],
  ucl:  ['champions league final','ucl final','europa league final','conference league final'],
  wnba: ['wnba finals','wnba championship'],
  afl:  ['afl grand final','afl premiership'],
  wc:   ['world cup final','world cup title']
};
export const LEAGUE_TEAMS = {
  nba:  ['spurs','knicks','lakers','celtics','warriors','nuggets','heat','bucks','thunder','sixers','76ers','mavs','mavericks','nets','pacers','bulls','cavs','clippers','suns','grizzlies','rockets','jazz','timberwolves','trail blazers','magic','hawks','wizards','raptors','san antonio','oklahoma city','new york knicks','golden state'],
  nhl:  ['hurricanes','golden knights','penguins','oilers','panthers','bruins','flyers','lightning','capitals','islanders','devils','blackhawks','red wings','sabres','maple leafs','canadiens','senators','jets','blues','wild','avalanche','stars','predators','sharks','kraken','blue jackets'],
  mlb:  ['yankees','dodgers','red sox','astros','phillies','braves','mariners','blue jays','guardians','tigers','twins','royals','white sox','angels','athletics','padres','giants','rockies','diamondbacks','dbacks','cubs','cardinals','brewers','pirates','reds','marlins','mets','nationals'],
  nfl:  ['chiefs','patriots','cowboys','eagles','49ers','niners','ravens','bills','dolphins','jets','steelers','browns','bengals','colts','jaguars','texans','titans','broncos','raiders','chargers','vikings','packers','bears','lions','falcons','saints','buccaneers','bucs','commanders','seahawks'],
  mls:  ['inter miami','lafc','la galaxy','seattle sounders','portland timbers','atlanta united','nycfc'],
  wnba: ['liberty','aces','indiana fever','phoenix mercury','connecticut sun','seattle storm','lynx','dallas wings','washington mystics','atlanta dream','chicago sky'],
  afl:  ['collingwood','sydney swans','greater western sydney','geelong cats','melbourne demons','richmond tigers','hawthorn hawks','essendon bombers','carlton blues','western bulldogs','adelaide crows','port adelaide','brisbane lions','gold coast suns']
};
export const CROSS_LINK_VERBS = /\b(face|faces|facing|faced|advance(?:s|d)?\s+to(?:\s+face)?|play(?:s|ed|ing)?(?:\s+against)?|meet(?:s|ing)?|matchup\s+(?:with|against)|winner\s+of|opponent\s+(?:will\s+be|is)|takes?\s+on|squares?\s+off\s+(?:with|against))\b/i;

export function hasCrossSportHallucination(text) {
  if (!text) return [];
  const sentences = text.split(/(?<=[.!?])\s+/).filter(s => s.length > 10);
  const flagged = [];
  for (const sentence of sentences) {
    if (!CROSS_LINK_VERBS.test(sentence)) continue;
    const lower = sentence.toLowerCase();
    const trophyLeagues = new Set();
    const teamLeagues   = new Set();
    const signals = [];
    for (const [league, trophies] of Object.entries(LEAGUE_TROPHIES)) {
      for (const t of trophies) {
        if (lower.includes(t)) {
          trophyLeagues.add(league);
          signals.push(`${league}:trophy:${t}`);
          break;
        }
      }
    }
    if (trophyLeagues.size > 0) {
      for (const [league, teams] of Object.entries(LEAGUE_TEAMS)) {
        for (const t of teams) {
          const match = t.includes(' ')
            ? lower.includes(t)
            : new RegExp('\\b' + t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b').test(lower);
          if (match) {
            teamLeagues.add(league);
            signals.push(`${league}:team:${t}`);
            break;
          }
        }
      }
    }
    const distinctTrophyLeagues = [...trophyLeagues];
    const distinctTeamLeagues   = [...teamLeagues];
    let isCross = false;
    if (distinctTrophyLeagues.length >= 2) isCross = true;
    for (const tl of distinctTeamLeagues) {
      for (const trl of distinctTrophyLeagues) {
        if (tl !== trl) { isCross = true; break; }
      }
      if (isCross) break;
    }
    if (isCross) {
      const allLeagues = [...new Set([...distinctTrophyLeagues, ...distinctTeamLeagues])];
      flagged.push({ sentence: sentence.trim(), leagues: allLeagues, signals });
    }
  }
  return flagged;
}

// ── Layer 3: 10-dimension prose scoring (JQ v3 — Jun 8 2026, 0-300 scale) ───
// Mirrors browser scoreProse() — same 300-point ceiling, same 10 dimensions.
// Worker runtime: no localStorage, no DOM, game object not available (relay
// scores without game context — Dims 7/10 return N/A, ceiling reduces to 245).
//
// Ceiling breakdown: 150(base) + 45(arc) + 25(ctx=N/A→0) + 20(temporal) +
//                    30(voice) + 30(matchup=N/A→0) = 245 without game context
//
// ── The two scales, DERIVED (CC-CMD-2026-08-15-quality-bar-scale ask 3) ─────
// The breakdown above used to live only in that comment, so 245 was a number
// a reader had to trust and a maintainer had to remember to update. Summing the
// caps actually in play makes it move on its own when a dimension is added,
// disabled, or starts returning N/A.
//
// Why both numbers must be reported together (asks 1 and 2): 55 of the 300
// points are unreachable BY CONSTRUCTION in this runtime — Dim 7 (context) and
// Dim 10 (matchup) have no game object to score against and return N/A→0. So a
// flat 240 bar is 80% of the nominal rubric but 97.96% of what a brief here can
// actually earn, and "below_240_pct: 100" reads as an editorial catastrophe when
// it is an arithmetic certainty. Four-fifths of the REACHABLE scale is 196.
// REWEIGHTED 2026-08-23 (era 4, ask 6b of CC-CMD-2026-08-20-brief-data-quality).
// Previous: spec 30, statDepth 38, variety 30, density 16, fresh 36,
//           arc 45, ctx 25, temporal 20, voice 30, matchup 30.
//
// The ask: weight event grounding and finality above fluency, so that a recap
// of a game still in progress scores materially below a real one. Measured
// baseline, n=95 per class re-scored under one rubric
// (scripts/rescore-quality-6b.mjs): in-progress 175.2, reads-as-final 181.7 —
// a 6.5-point gap on a 300-point scale, at 2.8x the standard error.
//
// WHICH DIMENSIONS COULD DO THE WORK, measured rather than assumed. Separation
// between the two classes, normalised, final minus in-progress:
//
//   arcScore          +0.146    resolution language: a finished game resolves
//   contextAnchoring  +0.144    a recap names the final score
//   temporalScore     +0.111
//   voiceScore        -0.134    runs BACKWARDS
//   density           -0.120    runs BACKWARDS
//   variety, freshness, specificity, statDepth, matchupDepth   ~0
//
// So only three dimensions separate finished prose from in-progress prose, and
// two actively work against it — weight on voice and density was NARROWING the
// gap this ask exists to widen. Everything else is inert on this question, which
// is why the change is concentrated rather than spread across the table.
//
// The nominal total stays 300 on purpose. Every threshold in the codebase (240,
// 196, 110) reads against it, and a change that moved the total would shift all
// of them at once while wearing this change's name.
//
// Predicted effect, computed on the same rows before shipping: gap 6.4 -> 11.5,
// at 4.2x the standard error. Verified after deploy — see the era 4 entry.
//
// NOT the last word, and deliberately so. No dimension here reads game state;
// arc and ctx are proxies that correlate with finality. Putting the ENTIRE scale
// on the three forward dimensions was measured at gap 41.6, which is the ceiling
// of reweighting — and it destroys every other purpose the rubric serves. A
// dimension that reads finalized_at directly is not bounded that way, and is
// filed as CC-CMD-2026-08-23-finality-dimension rather than smuggled in here.
// TWO HALVES, AND ONLY ONE OF THEM IS AN INPUT. Corrected 2026-08-24.
//
// Dims 1-5 are multiplied by their weight in `base` (via the local W), so for
// those five the declared number IS the ceiling, by construction.
//
// Dims 6-10 are summed RAW. Their ceilings are literals inside their own
// computations, and `grep -n "SCALE\." src/journalism-quality.js` returns
// exactly one hit -- the W above. Nothing read arc, ctx, temporal, voice or
// matchup. They were documentation, and they had drifted from the code in both
// directions: arc 55 vs 45, ctx 32 vs 25, temporal 25 vs 20, voice 20 vs 30,
// matchup 24 vs 30.
//
// They are now the real ceilings. NOTHING ABOUT SCORING CHANGES -- these five
// were never consulted, so writing the true numbers here moves no score and no
// threshold. What changes is that the table stops lying, and
// scripts/check-scale-matches-implementation.mjs fails the deploy if it starts
// again: it reads each ceiling out of the expression that produces it and
// requires the declared weight to equal it.
//
// The declared total is therefore 294, not 300 -- and 294 is what every score
// ever computed was already on. `Math.min(300, ...)` in scoreProse has never
// bound and cannot: base <= 144 (specificity is a mean of per-sentence values
// each <= 1.0; statDepth, density are Math.min(1, ...); variety is
// uniqueW.size / words.length; freshness is 0-100 applied as /100 * 36) plus
// dims 6-10 <= 150. The 300 was a label, never the total.
export const SCALE = {
  // Dim 1-5, APPLIED in `base` (mirrors the local W in scoreProse)
  spec: 30, statDepth: 38, variety: 30, density: 10, fresh: 36,
  // Dim 6-10, RAW ceilings read out of the code that produces them
  arc: 33,        // era 5: was 45, funded Dim 11
  ctx: 17,        // era 5: was 25, funded Dim 11
  temporal: 20,   // Math.round((anchored / statSentences) * 20)
  voice: 30,      // Math.min(30, ...) in all four sport branches
  margin: 30,     // MARGIN_MAX — era 6: was `matchup`, an echo test with 0.54% data
  finality: 20,   // FINALITY_MAX — the 12 + 8 the two proxies released
};
// Dimensions with no input — and WHICH dimensions those are depends on the
// CALL SITE, not on the runtime. The original comment here, and the 2026-08-16
// session doc built on it, said Dims 7 and 10 "have no game object in the
// Worker runtime" and called 55 points unreachable BY CONSTRUCTION. Measured
// 2026-08-23 (scripts/rescore-quality-6b.mjs, n=190 real game_recap rows,
// outbox/rescore-quality-6b-2026-08-23T1447*.json), that is true for one brief
// shape and false for the other:
//
//   Dim 7 (ctx)     scored ABOVE ZERO on 181 of 190 game briefs. It is
//                   reachable. Eight of the ten runQualityChain call sites in
//                   src/index.js pass `game`, and scoreProse is called with it.
//   Dim 10 (matchup) scored zero on 190 of 190 — but NOT because it cannot run.
//                   Zero of those rows carried a matchupNote, because
//                   regular_season_games.note is populated on 36 of 1284
//                   finalized games (2.8%). Data starvation, not construction.
//                   The two have different fixes, which is why they are named
//                   differently here.
//
// So a slate brief, which covers many games and legitimately has no single
// `game` object, loses both. A game brief loses only Dim 10, and only until the
// note column is fed. Reporting one global 245 made a 97.96%-of-reachable
// argument about the 240 bar using the wrong denominator for the very rows the
// 0-of-523 finding was drawn from.
const _STOP_WORDS_RE = /^(their|about|would|could|which|should|after|before|against|during|while|other|first|since|still|being|where|these|those|there|every|until|under|again|from|with|this|that|have|will|they|been|were|what|when|into|than|then|also|each|over|more|most|such|both|some|only|very|just|like|well|even|back|game|team|play|year|time|week)$/i;

async function _datamuseFreshness(words) {
  const contentWords = words.filter(w => w.length > 4 && !_STOP_WORDS_RE.test(w) && /^[a-z]/i.test(w)).slice(0, 5);
  if (!contentWords.length) return 83;
  try {
    const freqs = await Promise.all(contentWords.map(async w => {
      try {
        const r = await fetch(`https://api.datamuse.com/words?sp=${encodeURIComponent(w.toLowerCase())}&md=f&max=1`, {
          signal: AbortSignal.timeout(2000),
        });
        if (!r.ok) return 50;
        const d = await r.json();
        const tag = d?.[0]?.tags?.find(t => typeof t === 'string' && t.startsWith('f:'));
        return tag ? parseFloat(tag.slice(2)) : 50;
      } catch { return 50; }
    }));
    const avgFreq = freqs.reduce((a,b) => a+b, 0) / freqs.length;
    return Math.max(0, Math.min(100, 100 - (avgFreq / 3)));
  } catch { return 83; }
}

// Dim 8: Temporal Precision (0-20) — port from browser computeTemporalPrecision
function _temporalPrecision(text) {
  const sentences = text.split(/[.!?]+/).map(s => s.trim()).filter(Boolean);
  const STAT_RE = /\d+\.?\d*\s*(ppg|apg|rpg|pts?|points?|rebounds?|assists?|goals?|saves?|era|ops|mph|yards?|rbi|%|\+\/\-)/i;
  const TEMPORAL_RE = /\b(this series|this season|this postseason|in game \d|game \d|in \d{4}|since \d{4}|last \d+ games?|per game|on the year|this year|career|tonight|in the playoffs?|in these playoffs?)\b/i;
  let statSentences = 0, anchored = 0;
  for (const s of sentences) {
    if (STAT_RE.test(s)) { statSentences++; if (TEMPORAL_RE.test(s)) anchored++; }
  }
  if (statSentences === 0) return 10; // neutral
  return Math.round((anchored / statSentences) * 20);
}

// Dim 9: Voice Consistency (0-30) — port from browser computeVoiceConsistency
function _voiceConsistency(text, sport) {
  const tl = text.toLowerCase();
  const s = (sport || '').toLowerCase();
  let score = 15;
  if (s.includes('nba') || s.includes('basketball')) {
    const pos = [/quarter/i,/\bq[1-4]\b/i,/half-court/i,/\bpace\b/i,/\bspacing\b/i,/pick.and.roll/i].filter(r=>r.test(tl)).length;
    const neg = [/inning/i,/\bperiod\b/i,/\bpower play/i].filter(r=>r.test(tl)).length;
    score = Math.min(30, Math.max(0, 15 + pos * 4 - neg * 8));
  } else if (s.includes('nhl') || s.includes('hockey')) {
    const pos = [/\bperiod\b/i,/power play/i,/\bpp\b/i,/\bpk\b/i,/\bsave/i,/\bgoalie/i].filter(r=>r.test(tl)).length;
    const neg = [/inning/i,/quarter/i,/\byards\b/i].filter(r=>r.test(tl)).length;
    score = Math.min(30, Math.max(0, 15 + pos * 3 - neg * 8));
  } else if (s.includes('mlb') || s.includes('baseball')) {
    const pos = [/inning/i,/\bera\b/i,/\bwhip\b/i,/bullpen/i,/rotation/i].filter(r=>r.test(tl)).length;
    const neg = [/quarter/i,/\bperiod\b/i,/power play/i].filter(r=>r.test(tl)).length;
    score = Math.min(30, Math.max(0, 15 + pos * 3 - neg * 8));
  } else if (s.includes('soccer') || s.includes('mls') || s.includes('wc26') || s.includes('fifa')) {
    const pos = [/\bmatch\b/i,/possession/i,/\bminute\b/i,/\bhalf\b/i,/\bpressing\b/i].filter(r=>r.test(tl)).length;
    const neg = [/quarter/i,/inning/i].filter(r=>r.test(tl)).length;
    score = Math.min(30, Math.max(0, 15 + pos * 4 - neg * 5));
  }
  return score;
}

export async function scoreProse(text, opts = {}) {
  // opts.sport — string for voice consistency scoring
  if (!text) return 0;
  const words = text.split(/\s+/).filter(Boolean);
  if (!words.length) return 0;
  const sentences = text.split(/[.!?]+/).map(s => s.trim()).filter(s => s.length > 3);
  const nSent = Math.max(1, sentences.length);
  const sentStarts = new Set(sentences.map(s => s.split(/\s+/)[0]));

  // Dim 1: Specificity (0→30) — CC-CMD-2026-07-16-journalism-quality-gate-redesign:
  // was a flat (nouns+numbers)/words ratio, which rewards telegraphic listing
  // (dropping connective/analytical prose) over specificity woven into real
  // sentences. Reproduced live: the file's own labeled ANTI-exemplar ("Stanley
  // Cup Final Game 1 begins tonight... 39-26-17 Golden Knights face the
  // (quoted as it read before 2026-08-23; the live anti-exemplar now carries ##
  // placeholders instead of these figures, which does not change the SHAPE this
  // rationale is about)
  // 53-22-7 Hurricanes...") scored 4x higher on this exact dimension (0.55 vs
  // 0.13) than FIELD_VOICE_REGISTER's own real Exemplar A, because listing
  // facts with minimal connective tissue maximizes a flat ratio. Redefined
  // per-sentence: a sentence carrying exactly 1 name-or-number is the ideal
  // (matches FIELD_PROSE_STYLE's own "ONE-NUMBER-PER-SENTENCE RATIO" rule —
  // "a brief with 4 numbers in 12 sentences breathes"), 2 is acceptable, 0 or
  // 3+ score lower — rewards prose rhythm, not raw density.
  // `properNouns` was declared here and used ONLY by Dim 4's ratio. That ratio
  // now uses numbers alone (see Dim 4 below, 2026-08-13), leaving this dead,
  // so it is removed rather than left to read as though something still
  // consumes it (Rule 63). Dim 1 is unaffected — its `factsPerSentence` counts
  // nouns per sentence with its own inline filter, not this array.
  const numbersAll  = words.filter(w => /\d/.test(w));
  const factsPerSentence = sentences.map(s => {
    const sw = s.split(/\s+/).filter(Boolean);
    const first = sw[0];
    const nouns = sw.filter(w => /^[A-Z]/.test(w) && w !== first && w.length > 1).length;
    const nums  = sw.filter(w => /\d/.test(w)).length;
    return nouns + nums;
  });
  const specificity = factsPerSentence.length
    ? factsPerSentence.reduce((sum, f) => {
        if (f === 1) return sum + 1.0;
        if (f === 2) return sum + 0.6;
        if (f === 0) return sum + 0.3;
        return sum + Math.max(0, 0.3 - (f - 3) * 0.1); // 3+ facts/sentence tapers toward 0 — "a box score with verbs"
      }, 0) / factsPerSentence.length
    : 0;

  // Dim 2: StatDepth (0→38) — was blind to FIELD's own preferred numbers-in-
  // prose grammar (FIELD_VOICE_REGISTER's appositive/prepositional/
  // parenthetical patterns: "Wembanyama at 23.2 and 9", "Brunson grinding out
  // 26 a night", "SAS -2.5" carry no unit suffix and matched zero stat
  // patterns — reproduced live, Exemplar A scored 0/1 statDepth despite being
  // full of real stats). Now counts any numeric token — already computed
  // above as numbersAll — scaled relative to sentence count (~1 stat per 2
  // sentences = full credit, matching the "breathes" ratio already stated in
  // FIELD_PROSE_STYLE) instead of a flat, length-blind ceiling of 4 raw
  // unit-suffixed matches.
  const statDepth = Math.min(1, numbersAll.length / Math.max(2, nSent * 0.5));

  // Dim 3: Variety (0→30)
  const uniqueW = new Set(words.map(w => w.toLowerCase().replace(/[^a-z]/g,'')).filter(w=>w.length>2));
  const variety = uniqueW.size / words.length;

  // Dim 4: Density (0→16) — CC-CMD-2026-07-16-journalism-quality-gate-redesign:
  // this was a raw, UNCLAMPED (properNouns+numbers)/nSent ratio multiplied
  // directly into `base` below — silently blowing through this dimension's
  // own documented 16-point ceiling (see file header comment) for any text
  // averaging more than 1 fact/sentence, with NO upper bound. Reproduced
  // live: the anti-exemplar (4.6 facts/sentence) contributed 74 raw points
  // here — nearly 5x its stated ceiling — while Exemplar A (1.9/sentence,
  // much closer to ideal) contributed only 30. The more wire-copy-stacked
  // the text, the more this dimension over-rewarded it, unbounded. Now peaks
  // at the ideal (~1 fact/sentence, per FIELD_PROSE_STYLE's own rule) and
  // tapers for both under- and over-stacked text, clamped to [0,1] before
  // its weight is applied.
  //
  // UNIT CORRECTED 2026-08-13 (CC-CMD-2026-08-13-jq-density-unit-fix). This
  // ratio was `(properNouns.length + numbersAll.length) / nSent`, but the rule
  // it cites — FIELD_PROSE_STYLE's ONE-NUMBER-PER-SENTENCE — governs NUMBERS:
  //   "Each sentence gets AT MOST ONE number. If a sentence has three, you
  //    have written a box score with verbs."
  // Sports prose is obligately proper-noun-dense. "Baltimore Orioles pitcher
  // Brandon Young faces a lineup" carries three proper nouns and ZERO numbers
  // — perfect compliance with the rule — and the old ratio scored it 3.0,
  // which this taper maps to 0.
  //
  // Measured over the real mlb_game corpus, n=592 pulled from D1
  // (scripts/jq-density-census.mjs, outbox/jq-density-census-2026-08-13*.json):
  //
  //   mean (PN+NUM)/sent   4.43   corpus MINIMUM 1.75 — no brief is near the
  //                               curve's peak of 1.0, and it hits 0 at 3.0
  //   mean numbers/sent    1.76   the quantity the rule actually governs
  //   Dim 4 as shipped     0.35 pts of 16, FLOORED for 91.2% of briefs
  //   Dim 4 numbers-only   9.89 pts of 16, floored for 7.9%
  //
  // So the dimension was not measuring the corpus: it returned the same value
  // for nine briefs in ten, because the quantity the rule governs is the
  // MINORITY term (numbers ≈ 40% of PN+NUM). The 7.9% that still floor under
  // the corrected unit are exactly the briefs at >=3 numbers/sentence — the
  // ones the rule names as "a box score with verbs".
  //
  // Taper shape deliberately unchanged this pass, per the CC-CMD. The known
  // internal contradiction — 6aed3bb's own comment calls Exemplar A "1.9/
  // sentence, much closer to ideal" while shipping a curve peaking at 1.0 that
  // docks it 45% — is real, independent of this unit bug, and left for its own
  // change so the two effects stay separable.
  //
  // Proper-noun crowding is deliberately NOT folded back in as a compensating
  // term. It is a real readability property but a DIFFERENT one, and a
  // combined metric is precisely what produced this bug.
  const rawDensity = numbersAll.length / nSent;
  const density = Math.max(0, Math.min(1, 1 - Math.abs(rawDensity - 1) * 0.5));

  // Dim 5: Freshness via Datamuse (0→36)
  const freshness = await _datamuseFreshness(words);

  // Derived from the single SCALE table above — same numbers, one source. Two
  // parallel copies would drift, which is the failure ask 3 of
  // CC-CMD-2026-08-15-quality-bar-scale exists to prevent: a ceiling that no
  // longer matches the weights actually in play.
  const W = { spec: SCALE.spec, statDepth: SCALE.statDepth, variety: SCALE.variety,
              density: SCALE.density, fresh: SCALE.fresh };
  const base = Math.round(
    specificity * W.spec +
    statDepth   * W.statDepth +
    variety     * W.variety +
    density     * W.density +
    freshness   * (W.fresh / 100)
  );

  // Dim 6: Narrative Arc (0-45) — Stakes(10)+Tension(10)+Resolution(10)+Bonus(15)
  const first = sentences[0] || '';
  const last  = sentences[sentences.length-1] || '';
  const stakes = /\b\d-\d\b/.test(first) ||
    /\b(finals|championship|eliminated|advance|clinch|series|title|cup|playoffs)\b/i.test(first) ||
    /\b(first since|since \d{4}|\d+ years?|hasn.t.*since)\b/i.test(first);
  const tension = sentences.some(s => {
    const sw = s.split(/\s+/);
    const hasPlayer = sw.some(w => /^[A-Z][a-z]{2,}/.test(w) && !sentStarts.has(w) && w.length > 3);
    const hasStat   = /\d/.test(s) && (/\d+\.\d/.test(s) || /\d+%/.test(s) ||
      /\b(pts?|points?|rebounds?|assists?|goals?|ppg|apg|rpg|saves?)\b/i.test(s));
    return hasPlayer && hasStat;
  });
  const resolution = /\b(watch|look for|decide|determine|force|need|must|whether|tonight|expect|key|swing)\b/i.test(last) ||
    /\bif\b/i.test(last) || /\?/.test(last) ||
    sentences.length >= 2 && /\b(will|could|may|might)\b/i.test(last);
  const bonus = stakes && tension && resolution;
  const arcScore = (stakes?8:0) + (tension?8:0) + (resolution?8:0) + (bonus?9:0);

  // Dim 7: Context Anchoring (0→25) — brief anchors to the actual matchup.
  // Awards points when team names and final score appear in prose.
  // Data source: opts.game = { home, away, homeScore, awayScore }
  let dim7 = 0;
  if (opts.game) {
    const { home, away, homeScore, awayScore } = opts.game;
    const tl = text.toLowerCase();
    const homeTerm = (home || '').toLowerCase().split(/\s+/).filter(Boolean).pop() || '';
    const awayTerm = (away || '').toLowerCase().split(/\s+/).filter(Boolean).pop() || '';
    if (homeTerm.length > 2 && tl.includes(homeTerm)) dim7 += 6;
    if (awayTerm.length > 2 && tl.includes(awayTerm)) dim7 += 6;
    const hs = homeScore != null ? String(homeScore) : '';
    const as_ = awayScore != null ? String(awayScore) : '';
    if ((hs && text.includes(hs)) || (as_ && text.includes(as_))) dim7 += 5;
  }

  // Dim 8: Temporal Precision (0-20)
  const temporalScore = _temporalPrecision(text);
  // Dim 9: Voice Consistency (0-30)
  const voiceScore = _voiceConsistency(text, opts.sport || '');

  // Dim 10: Margin Agreement (0→30) — era 6. Was matchupNote echo; see
  // marginAgreement's own header for why an echo test could not be fixed by
  // populating the column. Reads the RESULT, which is on every finalized row.
  const dim10r = marginAgreement(text, opts.game && Number.isFinite(opts.game.homeScore)
    ? { homeScore: opts.game.homeScore, awayScore: opts.game.awayScore,
        wentToOt: !!opts.game.wentToOt }
    : null);
  const dim10 = dim10r.score;

  // Dim 11: Finality Agreement (0→20) — does the prose agree with whether the
  // game was actually over? The ONLY dimension that reads game state; arc and
  // ctx are proxies for it, and reweighting proxies is bounded at 38.2 against
  // this scale while zeroing every other purpose the rubric serves.
  //
  // Funded from the two proxies it replaces, so the nominal total is unchanged
  // at 294: arc 45->33, ctx 25->17. That funding is the honest answer to "is
  // this just re-buying arc and ctx under a new name" — it is measurable, and
  // the answer is no: over 128 real rows the current rubric separated correct
  // from incorrect finality readings by -4.0 at 0.9x the standard error, which
  // is to say not at all.
  //
  // Data source: opts.game.finalizedAt. Absent -> the dimension abstains at the
  // midpoint and says so, rather than scoring zero. Dim 10 scored zero on 190 of
  // 190 rows for two months and passed every aggregate test while doing nothing.
  const dim11 = finalityAgreement(text,
    opts.game ? (opts.game.finalizedAt ? true : (opts.game.finalizedAt === null ? false : null)) : null);

  // Full 294-point ceiling — all 11 dimensions active.
  const total = Math.min(294, Math.max(0,
    base + arcScore + temporalScore + voiceScore + dim7 + dim10 + dim11.score
  ));
  if (opts.breakdown) {
    // Each dim normalized to its own ceiling as a 0-1 fraction, for
    // comparing otherwise-incomparable dimensions (e.g. density's raw
    // ratio vs arcScore's 0-45 points) to find the weakest ones. Clamped
    // defensively to [0,1] -- density and specificity have no inline cap
    // in their own computation above (unlike statDepth/dim7/dim10/
    // voiceScore/temporalScore, which are already hard-capped) and
    // freshness is a 0-100 scale, not 0-1 (see _datamuseFreshness) --
    // dividing by 100 here mirrors the same scaling already applied in
    // `base`'s freshness * (W.fresh/100) term. This block is purely
    // additive: does not change `total`'s computation above it.
    return {
      total,
      dims: {
        specificity:      Math.min(1, Math.max(0, specificity)),
        statDepth:        Math.min(1, Math.max(0, statDepth)),
        variety:          Math.min(1, Math.max(0, variety)),
        density:          Math.min(1, Math.max(0, density)),
        freshness:        Math.min(1, Math.max(0, freshness / 100)),
        arcScore:         Math.min(1, Math.max(0, arcScore / 33)),
        contextAnchoring: Math.min(1, Math.max(0, dim7 / 17)),
        temporalScore:    Math.min(1, Math.max(0, temporalScore / 20)),
        voiceScore:       Math.min(1, Math.max(0, voiceScore / 30)),
        marginAgreement:  Math.min(1, Math.max(0, dim10 / MARGIN_MAX)),
        finality:         Math.min(1, Math.max(0, dim11.score / FINALITY_MAX)),
      },
      // The verdict travels with the score. A 0.5 on this dimension is an
      // abstention, a 0 is a contradiction, and an aggregate that cannot tell
      // them apart is describing two different failures as one number.
      finality_verdict: dim11.verdict,
      margin_verdict: dim10r.verdict,
      margin_fact: dim10r.fact,
    };
  }
  return total;
}

// ── Dim 11 candidate: finality agreement ────────────────────────────────────
//
// STAGED — consumed by scripts/rescore-quality-6b.mjs, which projects its effect
// on real rows before it is wired into scoreProse. Not yet part of any score.
// CC-CMD-2026-08-23-finality-dimension.
//
// WHY IT EXISTS. Nothing in scoreProse reads game state. arc and ctx correlate
// with finality — a finished game produces resolution language, and a recap
// names the final score — but a well-written preview produces resolution
// language too, and an in-progress brief quoting a current score satisfies ctx's
// score test. Reweighting proxies has a bound, measured at 38.2 against the real
// scale, and reaching it zeroes every other dimension. Reading the fact does not
// have that bound.
//
// ONE IMPLEMENTATION, TWO CONSUMERS, ON PURPOSE. Era 4's recorded effect was a
// candidate simulation that scoreProse never applied, because the projection and
// the scorer each had their own copy of the weights. The projection imports THIS
// function; when it ships, scoreProse will call the same one. They cannot
// diverge because there is nothing to diverge from.
//
// IT SCORES AGREEMENT, NOT FINALITY. A brief reading as final on a game that is
// not final is the defect the parent ask named. A brief hedging — "at halftime",
// "through 40 minutes" — about a game that finished hours ago is the same defect
// mirrored, and is equally wrong. Both score zero. A correctly hedged brief on a
// live game scores full marks, which is the whole point and is also why the
// LIVE_LANG prose-only split cannot measure this dimension: under that split,
// rewarding correct hedging looks like a regression.
export const MARGIN_MAX = 30;

// Dim 10, re-pointed in era 6. It used to score how many words from
// `matchupNote` reappeared in the prose -- an ECHO test, not a depth test. The
// note is injected into the prompt, so the dimension paid 30 points for
// repeating an input back out, while `check-prompt-example-leak.mjs` two files
// over exists to catch prose reproducing injected strings. Dim 10 sat on the
// permitted side of that line by technicality rather than design.
//
// It also had no data: 7 of 1292 finalized non-golf games carry a note (0.54%),
// and the 30 golf rows that inflated the headline to 2.8% hold leaderboard
// positions like "Wyndham Clark -17" for a sport with no matchup at all.
// Populating the column would have made the dimension WORSE -- a fully covered
// echo test measures how obediently the generator parrots a hand-written hook.
//
// Margin agreement is the same 2x2 as Dim 11 against a fact that is on every
// finalized row and cannot be copied out of the prompt, because it is a
// RELATION between two numbers rather than a string.
//
// SPORT-FREE ON PURPOSE. A one-run MLB game and a one-point NBA game are not
// comparable in absolute margin, so nothing here is tuned per sport:
//   tight    - went to extra time, or decided by <= 1
//   lopsided - the loser finished at <= 60% of the winner's score, which is
//              one-sided in every sport this relay carries (8-3, 120-70, 35-10)
//   ordinary - everything between, where no honest verdict exists, so it abstains
// ── THE THRESHOLDS WERE MADE SPORT-FREE. THE VOCABULARY WAS NOT. ───────────
//
// Era 6 shipped with 4 of 128 rows judged and 47 `no-clear-reading` on rows
// where a real verdict existed. The manifest was made to carry the actual prose
// of six of them rather than leave the cause to inference
// (outbox/rescore-quality-6b-20260824T141752Z.json), because the two candidate
// causes have different fixes and the old Dim 10 spent two months fixed the
// wrong way. Five of the six say it outright, in words neither regex held:
//
//   "Neither side managed to break the deadlock"          0-0, fact tight
//   "a scoreless stalemate ... finished 0-0"              0-0, fact tight
//   "This scoreless draw leaves the aggregate tied at 0"  0-0, fact tight
//   "Brentford dominated ... shutting out Spurs 3-0"      3-0, fact lopsided
//   "the visitors dominate possession"                    3-0, fact lopsided
//
// So: blind regex, not silent prose. And the pattern in the misses is one thing
// -- one-run, one-possession, walk-off, extra innings. The list was written for
// American sports and the corpus is mostly European soccer, where a tight game
// is a deadlock, a stalemate or a goalless draw. Half of "sport-free" got done.
//
// TWO DELIBERATE EXCLUSIONS, both about not manufacturing a contradiction:
//
// `level`, `tied` and bare `draw` describe an IN-GAME state as often as a final
// margin ("level at halftime before Arsenal ran away with it"). Reading that as
// a closeness claim on a game that finished 4-1 makes it `mixed`, which scores
// zero -- so a correctly narrated blowout would be penalised for describing its
// own first half. Finality can treat mixed as a contradiction because "at
// halftime" and "held on to win" genuinely cannot both be true of one brief.
// A margin that changed during the game is not a contradiction, it is a game.
//
// `emphatic` was tried and dropped. It modifies the manner of a single goal as
// often as the size of a win, so "an emphatic late winner sealed it 1-0" read as
// BOTH close and lopsided and scored 0 as a self-contradiction -- accurate prose
// punished for being accurate. Same conservative call as soccer 2-0 counting as
// ordinary: when a word is ambiguous the dimension abstains rather than guesses.
//
// `dominated possession` is a possession claim, not a margin claim. A 1-0 win
// where one side dominated possession is a TIGHT game described accurately, and
// scoring it `calls-a-tight-game-a-rout` would punish the truth. Excluded by
// lookahead rather than by dropping `dominate`, which is the ordinary English
// word for winning big and appears in the sample above doing exactly that.
const _READS_CLOSE   = /\b(narrow(ly)?|nail-?biter|one-run|one-score|one-possession|one-goal|overtime|extra innings|extra time|walk-?off|penalty shoot-?out|edged|held on|held off|hung on|survived|late winner|down to the wire|clinched it late|deadlock|stalemate|scoreless draw|goalless|all square|shared the spoils|slender)\b/i;
const _READS_LOPSIDED = /\b(rout(ed)?|blowout|cruised|breezed|comfortabl[ey]|dominant(ly)?|ran away|ran riot|never in doubt|coasted|thrashed|hammered|romp(ed)?|one-sided|outclassed|brushed aside|swept aside|demolished|overwhelmed|whitewash(ed)?)\b|\bdominat(?:e|ed|es|ing|ion)\b(?!\s+(?:possession|the ball|territory|midfield|play))/i;

/**
 * @param {string} text
 * @param {{homeScore:number, awayScore:number, wentToOt:boolean}|null} result
 * @returns {{score:number, fact:string, reading:string, verdict:string}}
 */
export function marginAgreement(text, result) {
  const t = String(text || '');
  const close = _READS_CLOSE.test(t);
  const wide  = _READS_LOPSIDED.test(t);
  const reading = close && wide ? 'mixed' : close ? 'close' : wide ? 'lopsided' : 'neither';

  const hs = result?.homeScore, as = result?.awayScore;
  const known = Number.isFinite(hs) && Number.isFinite(as);
  if (!known) return { score: MARGIN_MAX / 2, fact: 'unknown', reading, verdict: 'unknown-result' };

  const hi = Math.max(hs, as), lo = Math.min(hs, as), diff = hi - lo;
  // BOTH signals, because neither works alone across these sports. Ratio alone
  // called 5-3 lopsided (3/5 = 0.6) when it is an ordinary baseball game; margin
  // alone would call NBA 120-110 a rout. Requiring diff >= 3 AND the loser at or
  // under 60% of the winner holds up on the real shapes: 8-3 (0.38, 5), 120-70
  // (0.58, 50), 35-10 (0.29, 25), 3-0 soccer (0.00, 3) are all lopsided; 5-3
  // (0.60, 2) and 2-0 soccer (0.00, 2) are not. Conservative on purpose -- an
  // ordinary game abstains, and abstaining is not a failure.
  const fact = (result.wentToOt || diff <= 1)          ? 'tight'
             : (diff >= 3 && hi > 0 && lo / hi <= 0.6) ? 'lopsided'
             : 'ordinary';

  // Same precedent as Dim 11: prose that says both cannot be corrected by
  // learning the fact, because the contradiction is already inside it.
  if (reading === 'mixed')
    return { score: 0, fact, reading, verdict: 'contradicts-itself' };
  if (fact === 'ordinary' || reading === 'neither')
    return { score: MARGIN_MAX / 2, fact, reading,
             verdict: fact === 'ordinary' ? 'no-honest-verdict' : 'no-clear-reading' };

  const agrees = (fact === 'tight' && reading === 'close')
              || (fact === 'lopsided' && reading === 'lopsided');
  return { score: agrees ? MARGIN_MAX : 0, fact, reading,
           verdict: agrees ? 'agrees'
                  : (fact === 'tight' ? 'calls-a-tight-game-a-rout' : 'calls-a-rout-close') };
}

export const FINALITY_MAX = 20;

// Observed in real briefs. The hedge list is the same vocabulary as
// rescore-quality-6b's LIVE_LANG predicate, which was derived from live rows
// rather than imagined, plus the innings/break forms that predicate misses.
const _READS_HEDGED = /\b(scoreless|at halftime|at the half|at the break|through \d+ (?:minutes|innings)|(?:first|second)-half action|minutes into|innings into|currently|so far this (?:half|game)|remains? (?:tied|scoreless))\b/i;
const _READS_FINAL  = /\b(final score|finished|held on|held off|closed out|survived|sealed|clinched|advanced|beat|defeated|edged|downed|swept|fell to|lost to|won \d+-\d+|wins? \d+-\d+)\b/i;

/**
 * @param {string} text
 * @param {true|false|null} isFinal  true = game finalized, false = not, null = unknown
 * @returns {{score:number, reading:string, verdict:string}}
 *
 * `null` scores the midpoint and says so. A slate brief covers many games and
 * has no single finality; scoring it zero would repeat Dim 10's failure, where a
 * dimension that was zero on 190 of 190 rows passed every aggregate test for two
 * months while doing nothing.
 */
export function finalityAgreement(text, isFinal) {
  const t = String(text || '');
  const hedged = _READS_HEDGED.test(t);
  const final_ = _READS_FINAL.test(t);
  const reading = hedged && final_ ? 'mixed' : hedged ? 'hedged' : final_ ? 'final' : 'neither';

  if (isFinal === null || isFinal === undefined)
    return { score: FINALITY_MAX / 2, reading, verdict: 'unknown-finality' };

  // `mixed` scores ZERO, not the midpoint. Changed 2026-08-24 after the live
  // corpus produced four of them: briefs carrying BOTH hedging and resolution
  // language -- "at halftime" and "held on to win" in the same prose.
  //
  // That is worse than committing to the wrong answer, not more ambiguous than
  // it. A brief that reads as final on a live game is corrected the moment you
  // know the fact; a brief that says both cannot be corrected by any fact,
  // because it already contains its own contradiction. Scoring it the same as
  // prose that simply says nothing about finality rewards self-contradiction for
  // hedging its bets.
  //
  // Its own verdict, not folded into no-clear-reading: the two have different
  // fixes. `neither` wants richer prose; `contradicts-itself` wants a rewrite.
  if (reading === 'mixed')
    return { score: 0, reading, verdict: 'contradicts-itself' };
  if (reading === 'neither')
    return { score: FINALITY_MAX / 2, reading, verdict: 'no-clear-reading' };

  const agrees = isFinal ? reading === 'final' : reading === 'hedged';
  return { score: agrees ? FINALITY_MAX : 0, reading,
           verdict: agrees ? 'agrees' : (isFinal ? 'hedges-a-finished-game' : 'calls-a-live-game-final') };
}

// ── Layer 1: style block (synced from FIELD_PROSE_STYLE) ────────────────────
export const PROSE_STYLE_RULES = [
  '- STYLE: specificity over metaphor. "48 minutes from their first Finals since 1999" not "looking to punch their ticket."',
  '- STYLE: numbers over adjectives. "Brunson\'s 29.0 PPG this series" not "Brunson has been dominant."',
  '- TIME-PERIOD ANCHORING (mandatory): every numeric statistic must be qualified with its time period in the SAME sentence. Required for points, PPG, ERA, batting avg, RBIs, goals, goals-against, FG%, saves, shots, etc. Acceptable qualifiers: "this postseason", "this series", "this season", "last 5 games", "career", "through 30 starts", "tonight", "in May". Bare numbers like "## points", "##.# PPG", "## goals", "#-for-# with # RBIs", "## points through the season" without a clear timeframe ARE FORBIDDEN. The reader must always know what window the number is measured over. Example: write "Wembanyama\'s 28.2 PPG this postseason" not "Wembanyama\'s ## points." Write "Jung Hoo Lee\'s 5-for-6 night" not "Jung Hoo Lee went #-for-#" — the noun "night" anchors the number to one game.',
  '- ONE WINDOW PER COMPARISON (mandatory): a comparison must measure both sides over the SAME time period. "the home side\'s ## shots this match trail the away side\'s ## goals this season" is not a comparison — it sets one match against one season, and the two numbers cannot be ranked against each other. If you compare two figures in one sentence, both must carry the same window ("## shots this match to the away side\'s ## this match"). If you only have figures from different windows, write them as separate sentences and do not rank them.',
  '- STYLE: active voice. "Wembanyama blocked 3 shots" not "## shots were blocked."',
  '- STYLE: concrete over abstract. "Game 4 starts at 8pm on ESPN" not "the stage is set for a pivotal matchup."',
  '- STYLE: one metaphor max per brief — if you use one, make it original.',
  '- STYLE: write like a well-prepared friend who watched every game, not like a press release.',
  '- STYLE: if a sentence would work in any game recap for any sport, it is too generic — rewrite with details specific to THIS game.',
  // SPLIT 2026-08-24. One rule named four sports' bracket tags, so a soccer
  // prompt was told to cite [PP/PK] and shown a hockey penalty-kill figure. The
  // comment below SPORT_SCOPED_RULES flagged this as needing a split before it
  // could be scoped; this is that split. Each half keeps its own tags and its
  // own example, and only reaches the sport it belongs to.
  '- CITE HOCKEY ANALYTICS: if [PP/PK] or [GOALIE] context appears in the game data, cite the specific figure verbatim — not a paraphrase. "93.5% penalty kill" not "elite penalty killing".',
  '- CITE BASEBALL ANALYTICS: if [PARK] or [UMPIRE] context appears in the game data, cite the specific figure verbatim rather than calling a park "hitter-friendly" or an umpire "tight".',
  '- CITE SOCCER ANALYTICS: if [POSSESSION] context appears in the game data, cite the specific figure verbatim — not a paraphrase such as "dominated the ball".',
  // AUTHORED 2026-08-24. Every figure named here is read from the block
  // buildGolfLeaderboardContext actually emits -- "[GOLF CONTEXT]", then
  // `pos. name toPar (thru N)` -- not from general golf knowledge. `E` is what
  // src/index.js renders when toPar is null (`p.toPar != null ? String(p.toPar)
  // : 'E'`), so a model treating it as missing drops a real score.
  //
  // The example uses ## rather than a real figure. Every positive exemplar in
  // this file that carries a real number is a literal the model has been
  // measured mining, and there is no reason to add a new one to a rule written
  // today.
  '- CITE GOLF ANALYTICS: if [GOLF CONTEXT] appears in the game data, cite the leaderboard verbatim — the position, the to-par score WITH its sign, and the holes completed. Write "leads at -## through ##" rather than "holds a commanding lead". "E" is even par, a real score and not a missing value. A player shown "thru" a number has NOT finished the round: never present that score as final.',
  '- CITE NBA ANALYTICS: if [SLOW GRIND], [FAST PACE], [ELITE D BOTH], [CHESS MATCH], [CLUTCH], or [GAME TYPE] appears, cite specific DRTG, pace, or clutch figures verbatim. "107.7 DRTG, best in the NBA" not "elite defense".',
  '- CITE CHAMPION: if [CHAMPION] appears in game context, reference the team as "defending champions" or "reigning NBA champions" in the first paragraph — never omit this when present.',
  '- FEATURED STAT: if a [FEATURED STAT] line appears for a game, that exact figure MUST appear in your brief for that game.',
  '- LEAD SENTENCE: never start a brief, paragraph, or sentence with "The [Team]..." — lead with the specific situation. "Wembanyama scored 34" not "The Spurs got a big performance." "Two years without a Finals appearance ends tonight" not "The Celtics are looking to make a statement."',
  '- LEAGUE BOUNDARIES (critical): each league is a self-contained competition. NBA winners advance to the NBA Finals to face another NBA team. NHL winners advance to the Stanley Cup Final to face another NHL team. MLB winners advance to the World Series to face another MLB team. NEVER describe a team in one league as advancing to face the winner of, or playing against, a team or champion in a different league. The Stanley Cup, NBA Finals, World Series, Super Bowl, MLS Cup, and Premier League title are separate trophies in separate competitions. If two playoff series in different leagues happen at the same time, write about them as parallel events — never as connected or sequential events.',
  '- BANNED PHRASES (never use): '+BANNED_PHRASES.join(', ')+'.',
  '- USE SPARINGLY (maximum once per brief): '+SPARINGLY_PHRASES.join(', ')+'. If you use any of these, use it once only — then choose a more specific word.',
  '- NEVER explain what data is missing or why you cannot write something. If context is limited, write a short factual brief from what is available. Do not produce meta-commentary about the data.',
];

// Rules that speak ONE sport's language, keyed by their leading tag. Everything
// not listed here is universal and goes to every brief.
//
// MEASURED 2026-08-22, live EPL desk: a soccer brief read "Everton maintains a
// 107.7 DRTG, best in the NBA, despite playing soccer tonight." "107.7 DRTG,
// best in the NBA" is the CITE NBA ANALYTICS example VERBATIM. The per-game
// prompts at src/index.js already carry a SPORT BOUNDARY line ("Write ONLY
// ${sportLabel} content"), and the style block sat directly beneath it citing a
// basketball rating metric by name. The instruction and the example contradicted
// each other in one prompt; the example won.
//
// CITE CHAMPION is scoped for the same reason -- its text instructs the model to
// write "reigning NBA champions".
//
// NOT scoped (deliberate, Rule 69): LEAGUE BOUNDARIES names every league, but it
// is the rule that FORBIDS mixing them -- removing it from a soccer prompt would
// delete the guardrail, not the contamination.
//
// CITE ANALYTICS was the carry-forward this comment used to name: four sports'
// bracket tags in one string. Split above 2026-08-24 into three rules, each
// scoped here.
const SPORT_SCOPED_RULES = {
  '- CITE NBA ANALYTICS:':      'basketball',
  '- CITE CHAMPION:':           'basketball',
  '- CITE HOCKEY ANALYTICS:':   'hockey',
  '- CITE BASEBALL ANALYTICS:': 'baseball',
  '- CITE SOCCER ANALYTICS:':   'soccer',
  '- CITE GOLF ANALYTICS:':     'golf',
};

// ── Scoping the EXAMPLE, not the rule ───────────────────────────────────────
//
// Three rules are universal in their LESSON and basketball or baseball in their
// EXAMPLE: "specificity over metaphor", "numbers over adjectives" and
// TIME-PERIOD ANCHORING. Scoping the whole rule would delete a lesson every
// sport needs in order to remove a figure only one sport should see -- the same
// mistake the comment above avoids for LEAGUE BOUNDARIES.
//
// So the example clause is scoped instead. A prompt for the matching sport gets
// the rule intact; every other sport gets the rule with the example clause
// removed. This is pure SUBTRACTION: no sport-specific exemplar is authored,
// which the parent CC-CMD rules out as content invention and a separate
// decision. A rule minus its example still teaches; a rule carrying another
// sport's figure is where "Everton maintains a 107.7 DRTG, best in the NBA"
// came from.
//
// Every `drop` string must appear verbatim in its rule. Asserted at import --
// a silent no-op here would leave the contamination in place while looking
// fixed, which is the defect class this whole session has been closing.
// EACH EXAMPLE CARRIES ITS OWN SPORT, not the rule. TIME-PERIOD ANCHORING holds
// two: Wembanyama (basketball) and Jung Hoo Lee (baseball). Scoping them together
// meant baseball lost its own correct example to remove basketball's — a rule is
// not the right unit here, and the first version of this table got that wrong.
const SPORT_SCOPED_EXAMPLES = [
  { prefix: '- STYLE: specificity over metaphor.',
    examples: [{ cls: 'basketball', text: ' "48 minutes from their first Finals since 1999" not "looking to punch their ticket."' }] },
  { prefix: '- STYLE: numbers over adjectives.',
    examples: [{ cls: 'basketball', text: ' "Brunson\'s 29.0 PPG this series" not "Brunson has been dominant."' }] },
  { prefix: '- TIME-PERIOD ANCHORING',
    examples: [
      { cls: 'basketball', text: ' Example: write "Wembanyama\'s 28.2 PPG this postseason" not "Wembanyama\'s ## points."' },
      { cls: 'baseball',   text: ' Write "Jung Hoo Lee\'s 5-for-6 night" not "Jung Hoo Lee went #-for-#" — the noun "night" anchors the number to one game.' },
    ] },
];
{
  // An example string that matches nothing removes nothing and reads as fixed.
  for (const e of SPORT_SCOPED_EXAMPLES) {
    const rule = PROSE_STYLE_RULES.find((r) => r.startsWith(e.prefix));
    if (!rule) throw new Error(`SPORT_SCOPED_EXAMPLES: no rule starts with ${e.prefix}`);
    for (const x of e.examples)
      if (!rule.includes(x.text)) throw new Error(
        `SPORT_SCOPED_EXAMPLES: ${e.prefix} does not contain its ${x.cls} example verbatim — the example moved`);
  }
}

/// Every string proseStyleFor can emit for a rule: the full text, and the text
/// with any combination of its scoped example clauses removed. Small by
/// construction -- no rule carries more than two scoped examples, so at most
/// four variants each -- and asserted against real proseStyleFor output by
/// scripts/prose-style-scope-check.mjs, because a variant list that drifts from
/// the emitter silently un-blinds layer 2f.
export function styleRuleVariants() {
  const out = [];
  for (const rule of PROSE_STYLE_RULES) {
    out.push(rule);
    const e = SPORT_SCOPED_EXAMPLES.find((x) => rule.startsWith(x.prefix));
    if (!e) continue;
    const n = e.examples.length;
    for (let mask = 1; mask < (1 << n); mask++) {
      let v = rule;
      for (let i = 0; i < n; i++) if (mask & (1 << i)) v = v.replace(e.examples[i].text, '');
      out.push(v);
    }
  }
  // Longest first: a shortened variant is a prefix of the full one, and
  // subtracting the short form first would leave the example clause orphaned.
  return out.sort((a, b) => b.length - a.length);
}

// The style block for one sport.
//
// ABSENT sport -> every rule. That is the mixed-sport slate brief, which covers
// many games at once and legitimately needs all of them.
//
// NAMED but UNRECOGNISED sport -> universal rules only. This used to fall into
// the same branch as the slate, so golf, CFL and tennis -- none of which
// detectSportClass has a branch for -- received EVERY sport-scoped rule and
// EVERY sport-scoped example. Measured 2026-08-24: a golf prompt carried all six
// tracked figures, including "107.7 DRTG, best in the NBA", while EPL carried
// none.
//
// The fix is the default rather than a branch per sport. Adding golf, CFL and
// tennis to detectSportClass would have closed those three and left the next
// unrecognised sport maximally contaminated -- the whack-a-mole this codebase
// has spent the day replacing with guards. A sport the classifier does not know
// is now SAFE by default: it gets the universal lesson and none of anyone else's
// figures.
export function proseStyleFor(sport) {
  const cls = detectSportClass(sport);
  // Genuinely absent: the slate brief.
  if (!sport) return PROSE_STYLE_RULES.join('\n');
  return PROSE_STYLE_RULES.filter(rule => {
    const tag = Object.keys(SPORT_SCOPED_RULES).find(t => rule.startsWith(t));
    return !tag || SPORT_SCOPED_RULES[tag] === cls;
  }).map(rule => {
    // Each example clause, dropped for every sport it does not belong to. A
    // basketball prompt keeps the Wembanyama example and loses the Jung Hoo Lee
    // one; a baseball prompt does the reverse; soccer keeps neither.
    const e = SPORT_SCOPED_EXAMPLES.find(x => rule.startsWith(x.prefix));
    if (!e) return rule;
    return e.examples.reduce((r, x) => x.cls === cls ? r : r.replace(x.text, ''), rule);
  }).join('\n');
}

// Ungated: every rule. Kept as the export the slate-brief call sites already use.
export const FIELD_PROSE_STYLE = PROSE_STYLE_RULES.join('\n');

// ── Layer 2f: prompt-example leakage ────────────────────────────────────────
// MEASURED 2026-08-22 on the live desk, two EPL briefs, both user-facing:
//
//   "Everton maintains a 107.7 DRTG, best in the NBA, despite playing soccer"
//   "Spurs' 3 shots this match trail Brentford's 37 goals this season"
//
// Neither number was measured. Both are VERBATIM strings from FIELD_PROSE_STYLE
// above: "107.7 DRTG, best in the NBA" is the CITE NBA ANALYTICS example, and
// "37 goals this season" is verbatim from the FIELD_VOICE_REGISTER exemplar
// below ("Pavel Dorofeyev enters with 37 goals this season") -- an NHL sentence
// reused as an EPL fact. (An earlier version of this note blamed the
// TIME-PERIOD ANCHORING rule's forbidden list, which also contains "37 goals";
// the voice exemplar is the actual source, confirmed by the detector failing to
// fire until the register was subtracted too.)
// The model mined its own instructions for numerals and presented them as fact —
// a Rule 1 (DO NOT INVENT) violation reaching the reader, and the anchoring rule
// supplied the very number it exists to forbid.
//
// Instructions alone demonstrably did not hold, so this is enforcement.
//
// THE DISCRIMINATOR MATTERS. "37 goals" is a perfectly real figure for a team
// that has scored 37 goals, and flagging it blindly would fire on legitimate
// prose. A literal is a leak only when it is (a) an example in the style block,
// (b) present in the brief, and (c) ABSENT from the game context the prompt
// carried. Condition (c) is what separates a fabricated number from a real one,
// so the style block is subtracted from the prompt before the context is
// searched.
// Entries are the NUMERIC CORE of each exemplar figure, not the full phrase it
// appears in. That is a correction, made 2026-08-22 on live evidence.
//
// The list originally held whole phrases like '37 goals this season'. A live EPL
// brief then read "contrasting their 37 goals last season" — the same fabricated
// figure, one word different, and completely invisible to an exact-string match.
// The model paraphrases the exemplar; it does not quote it. Matching the phrase
// only catches the one wording that happened to be observed first.
//
// The numeric core is safe to match this loosely ONLY because of
// promptExampleLeaks' second condition: the literal must also be ABSENT from the
// game context. A team that genuinely scored 37 goals has that figure in its
// context block, so the real case never fires. Remove the context check and this
// list becomes far too aggressive — the two are a pair, not independent.
export const PROMPT_EXAMPLE_LITERALS = [
    '107.7 DRTG',
    '29.0 PPG',
    '28.2 PPG',
    '26.0 PPG',
    '25.0 points',
    '32 points',
    '37 goals',
    '32 goals',
    '4.67 ERA',
    '5.81 ERA',
    '5.72 ERA',
    '3.28 ERA',
    '5-for-6',
    '93.5% penalty kill',
    '+17% runs at Camden Yards',
    '48 minutes',
    // The placeholder itself. Every exemplar figure in the voice register's
    // UNIVERSAL segments -- the anti-exemplar and the six numbers-in-prose
    // patterns -- is now written as ##, #.##, ##.# or ##-##-##, all of which
    // contain '##', so this single entry catches a copy of any of them.
    //
    // A placeholder is only safe if copying it is DETECTABLE, or the fix trades
    // a plausible fabrication for an invisible one. It lives in the instructions,
    // and instructions are subtracted before the context search, so 2f reports it
    // with no extra machinery. Not square brackets: [DRAMA TREND], [CHAMPION] and
    // [FEATURED STAT] are live tags the prompt tells the model to read, and a
    // placeholder shaped like one would collide with them.
    '##',
];

export function promptExampleLeaks(prompt, text) {
    if (!prompt || !text) return [];
    // Subtract EVERY block of instructions, not just the style one. This was
    // the gap that let the live defect through: FIELD_VOICE_REGISTER is a
    // separate export prepended to the same prompt, and its exemplar carries
    // "37 goals this season". Subtracting only the style block left that
    // exemplar sitting in what this function treated as game context, so the
    // leak looked like real data and 2f stayed silent. Anything that is
    // instruction rather than data must come out before the search.
    let context = String(prompt);
    // Subtract each style rule INDIVIDUALLY, not the joined block. As of
    // 2026-08-23 a per-game prompt carries proseStyleFor(sport) -- a SUBSET of
    // the rules -- so splitting on the joined FIELD_PROSE_STYLE string matches
    // nothing, leaves the instructions sitting in what this function treats as
    // game context, and every literal then looks like real data. 2f would have
    // gone silent in the same commit that reduced the leaks. Per-rule
    // subtraction is subset-proof: it holds for the full block and for any
    // gated variant of it.
    // EVERY VARIANT, not just the full text. Extended 2026-08-24: gating no
    // longer only DROPS whole rules, it also SHORTENS them -- a universal rule
    // reaches a soccer prompt with its basketball example clause removed. A
    // shortened rule is not a member of PROSE_STYLE_RULES, so subtracting the
    // full text alone missed it, the instruction stayed in what this function
    // treats as game context, and 2f went silent on '##' in the same commit that
    // extended the gating. Precisely the failure the paragraph above describes,
    // reproduced by the next change to the gating -- so the subtraction now
    // enumerates what proseStyleFor can actually emit rather than assuming a
    // gated rule is a substring of the ungated one.
    for (const rule of styleRuleVariants()) {
        if (rule) context = context.split(rule).join(' ');
    }
    // Same subset problem, same fix, for the voice register: a per-game prompt
    // now carries voiceRegisterFor(sport). Subtract segment by segment.
    for (const seg of VOICE_REGISTER_SEGMENTS) {
        const block = seg.lines.join('\n');
        if (block) context = context.split(block).join(' ');
    }
    if (FIELD_VOICE_REGISTER) context = context.split(FIELD_VOICE_REGISTER).join(' ');
    return PROMPT_EXAMPLE_LITERALS.filter(lit =>
        text.includes(lit) && !context.includes(lit));
}

// ── v4 voice register (synced from jubilant-bassoon FIELD_VOICE_EXEMPLARS) ──
// Prepended BEFORE FIELD_PROSE_STYLE in prose prompts so the LLM reads the
// framing (register, exemplars, anti-exemplar, numbers-in-prose grammar)
// before the rules block. Source: jubilant-bassoon index.html L23607-23704
// (copied verbatim; export name differs per relay-side convention).
export const VOICE_REGISTER_SEGMENTS = [
  { sport: null, lines: [
    '',
    '═══ FIELD VOICE FRAMING (READ FIRST — BEFORE THE DATA AND RULES BELOW) ═══',
    '',
    'FIELD\'s voice register:',
    '- WARM (genuine affection for the sport and respect for the reader)',
    '- WISE (knows the game beyond the box score)',
    '- UPLIFTING (the truth in sports is inherently fun — let that energy through)',
    '- CHEEKY (light irreverence, has fun with the material)',
    '- WRY (dry observational humor, notices what others miss)',
    '',
    'The institutional rigor — accuracy, independence, no fabrication — and the joy of telling the story are not in tension. They\'re intertwined. Trustworthy writing is MORE fun to read, not less. Sports are inherently interesting; a 13-inning walk-off doesn\'t need hype because the truth is already incredible. Your job isn\'t to add gravity. It\'s to let the real story through with genuine energy. A fiduciary who loves their work writes better than one who treats it as duty.',
    '',
    'CRITICAL: match this REGISTER (rhythm, posture, angle). Do NOT copy the exemplars\' phrasing, players, teams, or numbers — those are illustrative. Use the actual stats and game context provided in YOUR prompt below.',
  ] },
  { sport: 'basketball', lines: [
    '',
    '— Exemplar A (NBA Finals Game 1 setup, ~145 words):',
    'The Spurs and Knicks haven\'t met for a championship since Tim Duncan was the future. Wembanyama at 23.2 and 9 is the headline; Brunson grinding out 26 a night is the warning. New York\'s defense gives up nothing easy in the half-court, which is awkward — that\'s where San Antonio\'s offense lives. Castle off the bench at 19 is the kind of rookie postseason that gets remembered or forgotten depending on how this series ends. The line opened SAS -2.5 and drifted to -3, which tells you something about which way the early money has been moving. Expect long possessions, foul trouble that matters, and a fourth quarter where the ball ends up in two specific hands. Whether those hands are Wembanyama\'s or Brunson\'s is most of the bet.',
  ] },
  { sport: 'basketball', lines: [
    '',
    '— Exemplar B (WNBA Commissioner\'s Cup matchup, ~110 words):',
    'Commissioner\'s Cup money is real money, which makes rotation choices interesting in a way regular-season rotations usually aren\'t. Phoenix is healthier than they were two weeks ago, which matters more for a team built around continuity than one built around a single matchup advantage. Atlanta\'s bench has been outscoring opposing benches at a rate that\'s either a sustainable structural edge or a small-sample mirage; the next four games settle that question. The over has hit in seven of eight when these teams play in Phoenix. The under has hit in five of six the other direction. Make of that what you will.',
  ] },
  { sport: 'hockey', lines: [
    '',
    '— Exemplar C (NHL playoff matchup, ~100 words):',
    'Vegas at home in May is a different team than Vegas anywhere else. Carolina knows this and will spend the first period trying to slow the rink — dump-and-chase, kill the building. If it works, this is a 2-1 hockey game and the Hurricanes are inside Vegas\'s heads. If it doesn\'t, Vegas runs the next period at 5-on-5 and the building does the rest. Stone is questionable, which is the kind of update that lands either as "cleared, will play" an hour before puck drop or "precautionary, out" five minutes after warmups. The warmups are the tell.',
  ] },
  { sport: 'soccer', lines: [
    '',
    '— Exemplar D (Soccer / World Cup group-stage matchup, ~115 words):',
    'Mexico and the USA in group play is the kind of fixture that decides which side gets to write its own knockout-round story and which one starts doing math on goal differential. Mexico has been tactically tidy through the openers, but the USA\'s press in the middle third is the test — if Lozano can\'t get on the ball under pressure, the transitions break down before they start. A center back making decisions under pressure is a center back making the wrong one, and the wrong one is the goal. Group standings sit where one result reshapes everything: a Mexico draw and the USA is into a second-place bracket nobody wants. Expect the first half to feel deliberate, then the 60th-minute substitutions to be the actual game.',
  ] },
  { sport: 'soccer', lines: [
    '',
    '— INTERNATIONAL SOCCER CONVENTION (World Cup, Euros, Copa América, Nations League):',
    'Include club affiliation on first mention of each goalscorer or key player — the way a good broadcast does.',
    'RIGHT: "Kamada (Crystal Palace) opened from close range" / "the Bournemouth striker Ueda converted twice"',
    'WRONG: "Kamada scored" (no club context) / "Kamada of Crystal Palace scored" (too formal)',
    'One club reference per player, woven into the action — then use name only. This grounds the reader',
    'in the club form that earned each player their place in the squad, which is what a knowledgeable',
    'fan wants to know. Do not list clubs parenthetically at the end; embed them naturally in the prose.',
  ] },
  { sport: null, lines: [
    '',
    '— POST-MATCH EXEMPLARS (game already played — these show the output shape for completed-game briefs):',
  ] },
  { sport: 'soccer', lines: [
    '',
    '— Exemplar E (Soccer / World Cup group-stage result, ~115 words):',
    'France survive Morocco\'s equalizer and come out of Group C with three more points, but not the top spot — Mbappé (PSG) settled nerves inside 12 minutes only for Ziyech (Marseille) to punish a soft challenge at the half-hour and level it. Griezmann converted from a tight angle on 67 to make it 2-1, which is how it stayed. Qualifying second means a last-16 draw with the Group D runner-up, which France can handle, but the first half showed enough defensive structure from Morocco to suggest this isn\'t a team that just absorbs three goals and goes home quietly. They don\'t.',
  ] },
  { sport: 'basketball', lines: [
    '',
    '— Exemplar F (NBA playoff game result, ~115 words):',
    'Oklahoma City won Game 4 in the kind of fourth quarter that turns a series: 32-16 in the final 12 minutes, SGA (34 points, 8 assists) picking Murray\'s pocket on back-to-back possessions to end whatever fantasy Denver had of dragging this to Game 5. Jokić had 31 and the Nuggets led after three — this was a game that required losing; it wasn\'t handed to OKC. The Thunder\'s bench depth is the structural advantage that doesn\'t show up in the box score until it does, and Game 4 is when it did. The series is over. The bracket question is who gets to find out what OKC looks like when the ceiling matters.',
  ] },
  // ── AUTHORED 2026-08-24 ────────────────────────────────────────────────
  //
  // Exemplars A-G cover basketball, hockey and soccer. Every other sport took
  // voiceRegisterFor's "no segment for this class -> keep everything" fallback
  // and received all eight of theirs. Measured: MLB 830, NFL 32, golf 30,
  // CFL 13 -- 905 of 1322 finalized games, 68.5%, every brief.
  //
  // FIGURES ARE ## HERE, unlike A-G. Those carry real numbers (23.2, 26, 34,
  // -2.5) and those numbers are precisely the literals layer 2f was built to
  // catch the model mining. Adding three more exemplars in that style would add
  // roughly fifteen new mineable figures to fix a contamination problem. The
  // universal segments already use ## for this reason; these follow them.
  //
  // Each teaches its sport's own hazard, not just its vocabulary:
  //   baseball  a number the box score cannot explain
  //   football  the phase of the game no recap mentions
  //   golf      no matchup, and `thru` means the round is unfinished
  { sport: 'baseball', lines: ['',
    '— Exemplar H (MLB regular-season result, ~110 words):',
    "The Orioles won the kind of game that makes no highlight package and decides a division anyway. Baltimore's bullpen worked ## innings without a run, which says less about the bullpen than about a manager who trusted it in the sixth instead of waiting for the eighth. Rutschman's #-for-# night included two at-bats that ended in outs and still moved runners, and those are the ones a box score is worst at explaining. Cleveland's starter had good stuff and no command — a combination that survives four innings and rarely five. The standings move by a single game, which in August is worth more than it looks."] },
  { sport: 'football', lines: ['',
    '— Exemplar I (NFL regular-season result, ~110 words):',
    "The Bills are ##-# and the record is the least interesting thing about them. Buffalo ran ## times in the second half, which for a team built around Allen's arm is either an adjustment or an admission, and the tape says adjustment — Miami's safeties were sitting ## yards off and daring them to. The Dolphins' defense did not collapse; it got asked a question it had already answered wrong in September. Special teams decided the middle third of this game and will appear in no recap tomorrow. Buffalo travels to Kansas City next, which is where a season like this becomes something or does not."] },
  { sport: 'tennis', lines: ['',
    '— Exemplar K (ATP/WTA main-draw match result, ~110 words):',
    "Sabalenka came through in ## sets and the scoreline flatters her. She was broken twice in the opener and won it anyway, which is the sort of thing that happens when a returner reads a second serve early and keeps doing it. The second set turned on a tiebreak that lasted ## points, most of them ending at the net — neither player wanted a baseline rally by then, and neither was going to admit it. Rybakina served at ##% and lost; that number is the argument for watching a match rather than reading its stats. The draw opens up from here, which is a sentence that has ruined many players' fortnights."] },
  { sport: 'golf', lines: ['',
    '— Exemplar J (PGA Tour round in progress, ~115 words):',
    "Clark is -## through ## and the number that matters is the one he made on the ninth, where a drive into the trees turned into a par that played like a birdie. The leaderboard is bunched inside ## shots, which at this course means the wind decides it — Saturday afternoon at ## miles an hour rewrites every read on these greens. Two players sit at E, which here is not a poor round; it is a round that survived. Nobody has finished. A score with 'thru' beside it is a round still being played, not a result, and the afternoon wave has the harder half of the draw."] },
  { sport: 'hockey', lines: [
    '',
    '— Exemplar G (NHL playoff game result, ~110 words):',
    'Aho found the top corner 4:12 into overtime and Carolina came home from Sunrise with a 3-2 series lead that nobody in the building expected after the second intermission. Vegas had two separate third-period leads; Carolina answered both, which says something about a team that had been 0-2 in overtime this postseason. Svechnikov at plus-4 in five games is the quieter number in a series everyone is following for Aho. Game 6 is Saturday in Raleigh and the Hurricanes have been a different team at home in May — the PNC crowd is the variable Vegas can\'t account for in the analytics.',
  ] },
  { sport: null, lines: [
    '',
    '═══ ANTI-EXEMPLAR — WIRE COPY (NOT FIELD VOICE — AVOID THIS) ═══',
    '',
    'The following is the FAILURE mode — what FIELD writing must NOT be:',
    '',
    '"The championship series begins tonight at the home arena as the ##-##-## home side face the ##-##-## visitors. Their leading scorer enters with ## goals this season, while the visiting winger has ## goals this season. Elsewhere, a ##-## starter with a #.## ERA meets a ##-## starter with a #.## ERA. A ##-## veteran carries a #.## ERA against a ##-## rookie with a #.## ERA."',
    '',
    'Why this fails:',
    '- Records and stats stacked without angle',
    '- No observation, no perspective, no voice',
    '- "this season" repeated mechanically (the loosened TIME-PERIOD rule was not used)',
    '- "with X" + "has Y" + "carries X against Y" — pure parallel template',
    '- A press release could have written this. So could an automated wire feed.',
    '',
    'If the brief reads like a list of facts linked by "with" and "against," the voice has failed.',
    '',
    '═══ NUMBERS-IN-PROSE GRAMMAR (READ THIS — IT IS WHERE V1 AND V2 FAILED) ═══',
    '',
    'The anti-exemplar above is what happens when numbers get their own sentence. The fix is grammatical, not stylistic: numbers must be SUBORDINATED to a claim, never the predicate of a main clause.',
    '',
    'Six patterns that work. The wire-copy form on the left FAILS. The FIELD form on the right works because the number lives inside a noun-phrase, prepositional phrase, parenthetical, or appositive — NEVER as the predicate.',
    '',
    'PATTERN 1 — APPOSITIVE (number tucked into a description of who)',
    '  Wire copy: "Aho leads Carolina with ## points this season."',
    '  FIELD:     "Aho, an ##-point center, is the reason Carolina is here."',
    '',
    'PATTERN 2 — POSSESSIVE COMPOUND (number as adjective on a noun-phrase)',
    '  Wire copy: "Matz holds a #.## ERA this season."',
    '  FIELD:     "Matz\'s #.## ERA tells the story — bullpen night."',
    '',
    'PATTERN 3 — PREPOSITIONAL EMBED (number as object of a preposition)',
    '  Wire copy: "Eichel has ## points this season."',
    '  FIELD:     "Eichel at ## is the headline; whether Carolina can deny him space is the question."',
    '',
    'PATTERN 4 — PARENTHETICAL (number isolated as supporting evidence)',
    '  Wire copy: "Nola brings a #.## ERA to his start."',
    '  FIELD:     "Nola\'s been getting hit (#.##), but the underlying numbers say bad luck more than bad pitcher."',
    '',
    'PATTERN 5 — THRESHOLD / COLLECTIVE (multiple numbers compressed)',
    '  Wire copy: "Matz #.## vs Flaherty #.##. Nola #.## vs Vasquez #.##."',
    '  FIELD:     "Three of tonight\'s four starters are carrying ERAs north of #.## — bullpen leverage across the board."',
    '',
    'PATTERN 6 — PUNCTUATION (number as rhetorical beat)',
    '  Wire copy: "Wilson leads the Aces with ##.# PPG this season."',
    '  FIELD:     "Wilson does what Wilson does. ##.# a night. Pick your poison."',
    '',
    '═══ FORBIDDEN — THE WIRE-COPY SIGNATURE ═══',
    '',
    'The construction:',
    '  SUBJECT + [has / holds / carries / posts / leads with / brings / maintains / enters with / sits at / owns / averages] + NUMBER + [this season / in May / through May / this postseason]',
    '',
    'Whenever you find yourself reaching for that construction, STOP. The verb is the tell. "Holds a #.## ERA," "carries a #.## ERA," "enters with ## points," "averages ##.# PPG" — these are the verbs that automated wire feeds use. They make every player into a stat-holder. That is not what FIELD does.',
    '',
    'Restructure into one of the six patterns above. The number is evidence; the claim is the sentence.',
    '',
    '═══ ONE-NUMBER-PER-SENTENCE RATIO ═══',
    '',
    'Each sentence in the brief gets AT MOST ONE number. If a sentence has two, restructure or split. If a sentence has three, you have written a box score with verbs. A brief with 4 numbers in 12 sentences breathes. A brief with 15 numbers in 8 sentences is wire copy regardless of register.',
    '',
    'When you want to list multiple stats in one sentence, use Pattern 5 (Threshold / Collective): name a threshold the numbers share rather than listing them individually.',
    '',
    '═══ END NUMBERS-IN-PROSE GRAMMAR ═══',
    '',
    '═══ PRIORITY ═══',
    '',
    'Voice over completeness. Pick the 5 facts that matter most and write them with warmth and energy. The reader chose FIELD because they want someone who loves sports to tell them what actually happened — not a press release, not a data dump. The truth is the fun part. Let it be fun.',
    '',
    'When in doubt: fewer things, written with genuine affection for the sport, beats more things written like a compliance filing.',
    '',
    '═══ END FRAMING — DATA AND RULES BELOW ═══',
    '',
  ] },
];

// A brief is shown the exemplars for ITS OWN sport, not five from other ones.
//
// MEASURED 2026-08-22: five of the seven exemplars are basketball or hockey, and
// every soccer brief was handed all of them -- Wembanyama, Brunson, Aho, Vegas,
// SGA, Jokic -- immediately beneath a line reading "SPORT BOUNDARY: This is a
// EPL game. Write ONLY EPL content." The register's own preamble already says
// "Do NOT copy the exemplars' phrasing, players, teams, or numbers"; the live
// briefs show that instruction losing to the weight of the examples.
//
// Baseball and football have no exemplar of their own. Filtering strictly would
// hand them an empty register and delete the voice teaching outright, so when a
// sport matches no exemplar it keeps all of them -- the pre-2026-08-23 behavior.
// THE FALLBACK HERE IS NOT THE SAME SHAPE AS proseStyleFor's, AND THE
// DIFFERENCE IS LOAD-BEARING. Measured 2026-08-24, then reverted.
//
// A sport with no segment of its own receives ALL of them: MLB, NFL, golf and
// CFL each get the basketball, hockey and soccer exemplars. MLB is 830 of 1322
// finalized games in the archive, so the biggest sport in the system is the
// most contaminated, and that is real.
//
// The obvious fix -- "a named sport keeps the universal segments and nobody
// else's", which is exactly right for proseStyleFor -- was tried here and is
// WRONG. It left MLB and NFL with ZERO exemplars, caught by this file's own
// assertion. The two functions carry different kinds of content:
//
//   proseStyleFor    scoped items are RULES that apply to one sport only.
//                    CITE NBA ANALYTICS means nothing to MLB; dropping it costs
//                    nothing.
//   voiceRegisterFor scoped items are EXEMPLARS that teach a UNIVERSAL thing --
//                    what the FIELD voice sounds like -- through a
//                    sport-specific instance. Drop them all and the lesson goes
//                    with them; a brief with no exemplar has no model of the
//                    voice at all.
//
// So the contamination stands as a MEASURED, NAMED trade rather than being
// "fixed" into a worse state. Resolving it properly means an exemplar for each
// uncovered sport, which is content authoring and its own decision -- not a
// predicate change. Recorded in the outbox with the per-sport measurement.
export function voiceRegisterFor(sport) {
  const cls = detectSportClass(sport);
  const scoped = VOICE_REGISTER_SEGMENTS.filter(s => s.sport !== null);
  const keep = cls && scoped.some(s => s.sport === cls)
    ? seg => seg.sport === null || seg.sport === cls
    : () => true;
  return VOICE_REGISTER_SEGMENTS.filter(keep).flatMap(s => s.lines).join('\n');
}

// Ungated: every segment. Byte-identical to the pre-segmentation constant, and
// locked as such by scripts/voice-register-scope-check.mjs.
export const FIELD_VOICE_REGISTER = voiceRegisterFor(null);

// ── 3b voice judge prompt builder (CC-CMD-2026-07-16-journalism-quality-
// gate-redesign) ─────────────────────────────────────────────────────────
// Replaces the old dimension-targeted regex-correction helpers (removed:
// _arcSubComponents, _voiceViolationDetail, _dimensionCorrection,
// SPORT_TERMS_LABEL, _pickWeakestDims, _buildTargetedRetryPrompt), which
// existed solely to build a retry prompt around scoreProse's weakest
// dimensions -- the exact composite-score-chasing mechanism this redesign
// removes (see CONTEXT: scoreProse's Dim4 measurably rewarded the
// wire-copy pattern FIELD_VOICE_REGISTER's own anti-exemplar forbids).
// Reuses FIELD_VOICE_REGISTER verbatim (already a joined string with the
// real exemplars and the labeled anti-exemplar) -- not duplicated here.
export function _buildVoiceJudgePrompt(draftText) {
  return FIELD_VOICE_REGISTER +
    `\n\nJudge the following draft against the real exemplars and the anti-exemplar above.\n\n` +
    `DRAFT:\n"""${draftText}"""\n\n` +
    `Does this draft read like the real FIELD exemplars (connective prose, numbers subordinated ` +
    `into claims, genuine voice) or like the anti-exemplar (wire-copy fact-stacking)?\n\n` +
    `If it passes, respond with exactly: PASS\n\n` +
    `If it fails, respond with exactly this three-line format (no extra text):\n` +
    `FAIL\n` +
    `SENTENCE: <the exact failing sentence from the draft, quoted verbatim>\n` +
    `FIX: <one concrete instruction for how to rewrite it in FIELD voice>`;
}

// ── Layer 2g: cross-window comparison ───────────────────────────────────────
// MEASURED 2026-08-22, live EPL desk: "Spurs' 3 shots this match trail
// Brentford's 37 goals this season." Both figures may be real; the sentence is
// still false, because a per-match count and a per-season count cannot be
// ranked against each other. Dim 8 (TIME-PERIOD ANCHORING) forbids a BARE
// number and is satisfied here -- both numbers carry a window. Neither window
// is wrong on its own. The defect is only visible in the comparison.
//
// The discriminator is that BOTH sides carry a figure. A sentence naming two
// windows without two numbers is ordinary prose ("won three straight this
// season and lead the table tonight") and must not fire, so a window only
// counts when a number sits within 28 characters before it, and a comparison
// term must appear BETWEEN the two numbered windows.
const XW_WINDOWS = /\b(?:this (?:match|game|half|series|season|postseason|playoffs|week|month)|tonight|today|last night|career|(?:in|through) (?:the )?(?:first|second|third|fourth) (?:half|quarter|period)|last \d+ (?:games|matches|starts)|through \d+ (?:games|starts))\b/gi;
const XW_COMPARE = /\b(?:trails?|trailing|outpaces?|outscor\w*|outshoots?|eclipses?|doubles?|compared (?:to|with)|versus|vs\.?|against|more than|fewer than|less than|ahead of|behind|better than|worse than)\b/i;
const XW_NUM = /(?:\d+(?:\.\d+)?%?|\d+-(?:for|of)-\d+|\d+-\d+)/;

export function crossWindowComparisons(text) {
  if (!text) return [];
  const out = [];
  for (const raw of String(text).split(/(?<=[.!?])\s+/)) {
    const sentence = raw.trim();
    if (!sentence) continue;
    const wins = [...sentence.matchAll(XW_WINDOWS)];
    if (wins.length < 2) continue;
    const numbered = wins.filter(w =>
      XW_NUM.test(sentence.slice(Math.max(0, w.index - 28), w.index)));
    if (numbered.length < 2) continue;
    const labels = [...new Set(numbered.map(w => w[0].toLowerCase()))];
    if (labels.length < 2) continue;
    const first = numbered[0], last = numbered[numbered.length - 1];
    const between = sentence.slice(first.index + first[0].length, last.index);
    if (!XW_COMPARE.test(between)) continue;
    out.push({ sentence, windows: labels });
  }
  return out;
}

// ── Orchestrator: runs all 7 quality layers with up to 7 retry calls ────────
// Returns { text, score, retries, layers_fired, ms }
//
// callProxy is provided by the caller — must return a string (the generated
// prose) or null on failure. Signature: async (promptText) => string|null
//
// Each layer that detects a violation produces a retry prompt that explicitly
// states the violation. We never invent context — we tell the model exactly
// what was wrong and let it fix it. Max 1 retry per layer.
export async function runQualityChain(prompt, initialText, callProxy, opts = {}) {
  const t0 = Date.now();
  const layers_fired = [];
  let text = initialText;
  let retries = 0;
  const sport = opts.sport || null;
  const game        = opts.game        || null; // { home, away, homeScore, awayScore }
  const matchupNote = opts.matchupNote || null; // editorial context from game.note
  const maxRetries = opts.maxRetries || 7;

  // 2b: sport vocab
  if (sport) {
    const viol = checkSportVocab(text, sport);
    if (viol.length && retries < maxRetries) {
      const sportClass = detectSportClass(sport);
      const vocab = SPORT_VOCAB_VIOLATIONS[sportClass] || {};
      const retryPrompt = prompt + `\n\nCRITICAL CORRECTION — sport vocabulary errors detected:\n` +
        `Sport: ${vocab.sport || sport}. Score in ${vocab.units || 'correct units'}. ` +
        `Extra period = ${vocab.extra_period || 'correct term'}.\n` +
        `These terms from the wrong sport appeared in your draft and must be removed: ${viol.join(', ')}.\n` +
        `Rewrite using ONLY vocabulary appropriate for ${vocab.sport || sport}.`;
      const retried = await callProxy(retryPrompt);
      if (retried && retried.length > 30) { text = retried.trim(); retries++; layers_fired.push('2b'); }
    }
  }

  // 2c: generic lead
  const genericLead = hasGenericLead(text);
  if (genericLead && retries < maxRetries) {
    const retryPrompt = prompt + `\n\nLEAD SENTENCE CORRECTION: Your draft starts with "${genericLead.slice(0,80)}..." — this is the generic AI pattern. Rewrite the first sentence to lead with a specific fact, name, number, or situation. NOT "The [Team] ..." — instead something like "Wembanyama scored 34" or "Two years without a Finals appearance ends tonight."`;
    const retried = await callProxy(retryPrompt);
    if (retried && retried.length > 30) { text = retried.trim(); retries++; layers_fired.push('2c'); }
  }

  // 2h: banned phrases. MEASURED 2026-08-23 — a live brief through
  // /journalism/generate opened "Hull City stunned Manchester United 2-0".
  // "stunned" is the first entry in BANNED_PHRASES, the style block names every
  // banned phrase explicitly, and the brief shipped anyway.
  //
  // hasCliche() has existed here since JQ v3 and this chain never called it.
  // index.js imports it as jqHasCliche on line 70 and that import is its only
  // occurrence in the file — a detector wired to nothing, next to an
  // instruction that does not hold. That is the exact pair 2f was written for:
  // "Instructions alone demonstrably did not hold, so this is enforcement."
  //
  // Placed BEFORE the content layers on purpose. This retry rewrites prose, so
  // anything it introduces — a fabricated figure, a cross-window comparison, a
  // dropped stat — is still policed by 2f, 2g and 2d downstream. Running it
  // last would give voice the final word over accuracy.
  const cliches = hasCliche(text);
  if (cliches.length && retries < maxRetries) {
    const retryPrompt = prompt +
      `\n\nBANNED PHRASE — CRITICAL: your draft contains ${cliches.map(c => `"${c}"`).join(', ')}. ` +
      `These are banned outright in FIELD copy, not discouraged. Rewrite the sentence they appear in ` +
      `so it says what actually happened instead. Do not substitute a synonym for the same hype — ` +
      `the fix is a concrete fact, not a quieter adjective.`;
    const retried = await callProxy(retryPrompt);
    if (retried && retried.length > 30) { text = retried.trim(); retries++; layers_fired.push('2h'); }
  }

  // 2f: prompt-example leakage — a number lifted from the instructions rather
  // than from the data. Placed BEFORE stat verification: 2d pushes the model to
  // add figures, so a fabricated one must be removed first or 2d can entrench it.
  const leaked = promptExampleLeaks(prompt, text);
  if (leaked.length && retries < maxRetries) {
    const retryPrompt = prompt +
      `\n\nFABRICATED NUMBER — CRITICAL: your draft contains ${leaked.map(l => `"${l}"`).join(', ')}. ` +
      `That figure appears ONLY as an illustrative example in the style rules above; it is NOT in this game's data. ` +
      `The numbers in the style examples teach FORM, never content — never copy one into a brief. ` +
      `Rewrite using only figures present in the game context, or write the sentence without a number.`;
    const retried = await callProxy(retryPrompt);
    if (retried && retried.length > 30) { text = retried.trim(); retries++; layers_fired.push('2f'); }
  }

  // 2d: stat verification
  const missing = missingStats(prompt, text);
  if (missing.length && retries < maxRetries) {
    const retryPrompt = prompt +
      '\n\nSTAT VERIFICATION FAILURE: Your previous draft omitted these specific figures that were in the context data: ' +
      missing.join(', ') +
      '. These exact figures MUST appear verbatim in your rewrite. A brief without its own data is just filler.';
    const retried = await callProxy(retryPrompt);
    if (retried && retried.length > 30) { text = retried.trim(); retries++; layers_fired.push('2d'); }
  }

  // 2g: cross-window comparison. AFTER 2d deliberately -- 2d pushes the model
  // to ADD figures, so checking composition before it runs would let 2d
  // reintroduce the pairing. 2g's correction splits a sentence and keeps both
  // figures, so it does not undo 2d's requirement that they appear.
  const crossWindow = crossWindowComparisons(text);
  if (crossWindow.length && retries < maxRetries) {
    const first = crossWindow[0];
    const retryPrompt = prompt +
      `\n\nCROSS-WINDOW COMPARISON — CRITICAL: this sentence compares figures measured over ` +
      `different time periods: "${first.sentence}" (${first.windows.join(' vs ')}). ` +
      `Two numbers covering different spans cannot be ranked against each other, even when both ` +
      `figures are correct. Rewrite so either both figures carry the SAME window, or the two ` +
      `figures appear in separate sentences with no comparison between them.`;
    const retried = await callProxy(retryPrompt);
    if (retried && retried.length > 30) { text = retried.trim(); retries++; layers_fired.push('2g'); }
  }

  // 2d-score: score contradiction — verifies no score in the text contradicts
  // opts.game's known result. Distinct from 2d (which catches omissions):
  // 2d fires when a stat from the prompt is absent; 2d-score fires when a
  // DIFFERENT score appears in the text. Both orientations (home-away and
  // away-home) are valid. Requires opts.game with homeScore + awayScore.
  // Active for any relay-scored brief where the game object is known
  // (WC queue consumer, MLB brief, Night Owl, Stakes Brief, J2 Series).
  if (game?.homeScore !== undefined && game?.awayScore !== undefined
      && retries < maxRetries) {
    const hs = game.homeScore, as_ = game.awayScore;
    const valid = new Set([
      `${hs}-${as_}`, `${as_}-${hs}`,             // hyphen
      `${hs}–${as_}`, `${as_}–${hs}`,   // en-dash
    ]);
    const scoreMatches = [...text.matchAll(/\b(\d{1,2})[–-](\d{1,2})\b/g)];
    const contradictions = scoreMatches
      .map(m => `${m[1]}-${m[2]}`)
      // Exclude date-like patterns: real scores never have leading zeros (06-24
      // is a date; 1-0 is a score). Filter before checking valid set.
      .filter(s => !s.split('-')[0].startsWith('0') && !s.split('-')[1].startsWith('0'))
      .filter(s => !valid.has(s) && !valid.has(s.split('-').reverse().join('-')));
    if (contradictions.length) {
      const correct = `${hs}-${as_}`;
      const retryPrompt = prompt +
        `\n\nSCORE CONTRADICTION: Your draft contains "${contradictions[0]}" but ` +
        `the actual result is ${game.home ?? 'home team'} ${correct} ` +
        `${game.away ?? 'away team'}. Remove all incorrect scores. Use only ` +
        `the real result in your rewrite.`;
      const retried = await callProxy(retryPrompt);
      if (retried && retried.length > 30) {
        text = retried.trim(); retries++; layers_fired.push('2d-score');
      }
    }
  }
  // PROOF (Colombia 1-0 Congo DR brief, Jun 24 2026):
  // Text contained "2-3 result". valid = {"1-0","0-1","1–0","0–1"}.
  // "2-3" ∉ valid → contradiction fired → retry with SCORE CONTRADICTION.
  // Without this layer: 2d passed (text had "1-0" in opening line),
  // 258/300 score shipped with fabricated score mid-brief.

  // 2e: cross-sport hallucination
  const cross = hasCrossSportHallucination(text);
  if (cross.length && retries < maxRetries) {
    const errorLines = cross.map(v =>
      `- The sentence "${v.sentence.slice(0,140)}${v.sentence.length>140?'...':''}" combines ${v.leagues.map(l=>l.toUpperCase()).join(' and ')} in a way that suggests they meet, advance against each other, or share a championship. They do not.`
    ).join('\n');
    const retryPrompt = prompt +
      `\n\nCRITICAL FACTUAL CORRECTION — cross-league hallucination detected:\n` +
      errorLines + `\n\n` +
      `Each league is independent: NBA winners face other NBA teams in the NBA Finals; NHL winners face other NHL teams in the Stanley Cup Final; MLB winners face other MLB teams in the World Series; etc. They never advance to face winners from other leagues. ` +
      `Rewrite so every sentence treats each league as self-contained. If both leagues appear, describe as PARALLEL events. Do NOT use face/advance/play/meet/winner of when bridging leagues.`;
    const retried = await callProxy(retryPrompt);
    if (retried && retried.length > 30) { text = retried.trim(); retries++; layers_fired.push('2e'); }
  }

  // 3b: qualitative voice judge (CC-CMD-2026-07-16-journalism-quality-gate-
  // redesign). Replaces the old `score < 240` numeric trigger + `newScore
  // >= score` accept-gate -- both routed through scoreProse's composite,
  // which was shown to reward wire-copy fact-stacking over real FIELD
  // voice (pre-fix: the file's own labeled anti-exemplar scored 214/300,
  // its own real Exemplar A scored 136/300 -- see outbox for the
  // reproduced test). The judge asks the same question a human editor
  // would: does this read like the real exemplars or the anti-exemplar?
  // Gated behind retries < maxRetries up front (unlike the free regex
  // checks in layers 2/2b/2c/2d/2e above, the judge call itself costs a
  // proxy call, so it isn't worth spending when no retry slot remains).
  // Circuit breaker: skip the judge if any prior layer already fired a retry.
  // A piece that needed factual/vocab correction has already been reworked —
  // the judge adds a mandatory extra call with marginal quality return on
  // already-corrected text. Only clean first-pass generations are judged.
  // Reverdict removed: the SENTENCE/FIX retry prompt is concrete enough that
  // re-judging the output would cost a third call for minimal gain.
  if (layers_fired.length === 0 && retries < maxRetries) {
    const judgeVerdict = await callProxy(_buildVoiceJudgePrompt(text));
    const judgeFailed = judgeVerdict && /^\s*FAIL/i.test(judgeVerdict.trim());
    if (judgeFailed) {
      const failMatch = judgeVerdict.match(/^FAIL\s*\nSENTENCE:\s*(.+?)\s*\nFIX:\s*(.+)/s);
      let retryPrompt;
      if (failMatch) {
        const parsedSentence = failMatch[1].trim();
        const parsedFix = failMatch[2].trim();
        retryPrompt = [
          prompt,
          '',
          '── VOICE CORRECTION ──',
          'The following sentence in your draft violates FIELD voice register:',
          `"${parsedSentence}"`,
          '',
          `Fix: ${parsedFix}`,
          '',
          'Rewrite the full brief with this correction applied.',
          'All other sentences may remain unchanged.',
        ].join('\n');
      } else {
        // judge returned unstructured FAIL — fall back to generic voice note
        const reason = judgeVerdict.replace(/^\s*FAIL:?\s*/i, '').trim() ||
          'reads like wire copy, not FIELD voice.';
        retryPrompt = prompt +
          `\n\nVOICE JUDGE FAILED: ${reason} Rewrite in FIELD's real voice — connective prose, ` +
          `numbers subordinated into claims (not listed), at most one number per sentence.`;
      }
      const retried = await callProxy(retryPrompt);
      if (retried && retried.length > 30) {
        text = retried.trim(); retries++; layers_fired.push('3b');
      }
    }
  }

  // scoreProse's composite is still computed and returned below (finalScore)
  // for calibration/analytics (/quality/report reads quality_score as an
  // opaque percentile input, confirmed -- TASK 0.2) -- descriptive only.
  // Nothing above this comment uses it to decide retry or acceptance.

  const finalScore = await scoreProse(text, { sport, game, matchupNote });
  return {
    text,
    score: finalScore,
    retries,
    layers_fired,
    ms: Date.now() - t0,
  };
}

// ── ERA 6 REOPENED THIS, AND THE NAME-LIST SHAPE DID NOT SURVIVE IT. ───────
//
// Two separate defects, both introduced by renaming SCALE.matchup -> SCALE.margin:
//
// 1. `'matchup'` stopped naming anything. Both lists filtered a key that is no
//    longer in SCALE, so both filters matched NOTHING. REACHABLE_CEILING went
//    245 -> 277 and REACHABLE_CEILING_GAME went 270 -> 294, silently, and the
//    /quality endpoint published `unreachable_points: 0` for the game shape
//    while still listing "matchup" as unreachable. A list of names is only as
//    good as the guarantee that the names resolve, and there was none.
//
// 2. Even repaired, a BINARY list is the wrong shape now. Dim 10 used to score
//    a flat zero without a note and Dim 7 a flat zero without a game, so
//    "unreachable" was a fair description. Era 5 and era 6 replaced both of the
//    game-fact dimensions with ones that ABSTAIN AT THE MIDPOINT when the fact
//    is missing: marginAgreement(text, null) is 15 of 30, and
//    finalityAgreement(text, null) is 10 of 20. Neither is unreachable and
//    neither is fully reachable. Calling them either one is wrong by 15 and 10
//    points respectively.
//
// So the cap is per-dimension, and it is DERIVED by asking the functions rather
// than declared beside them. A second declaration is precisely how SCALE's
// weights drifted from their implementation ceilings for two months.
const _NO_TEXT = 'x';
export const SLATE_CAPS = {
  // Dim 7 needs home/away terms off opts.game; with no game it contributes 0.
  // Declared, because dim7 is inline in scoreProse and cannot be called alone --
  // and therefore guarded by check-slate-caps-are-derived.mjs against a real
  // no-game scoreProse call rather than trusted.
  ctx: 0,
  // Derived. These two ARE callable, so nothing here restates them.
  margin: marginAgreement(_NO_TEXT, null).score,
  finality: finalityAgreement(_NO_TEXT, null).score,
};
// Kept for the /quality response and for anything reading "which dims does a
// slate brief lose outright" -- now derived from the caps rather than hand-kept
// in parallel with them.
export const UNREACHABLE_DIMS = Object.keys(SLATE_CAPS).filter((k) => SLATE_CAPS[k] === 0);
// Dims a slate brief can only partly reach. This is the population the old
// binary list had nowhere to put, and reporting it as either extreme is what
// made the 245 wrong in the first place.
export const CAPPED_DIMS = Object.keys(SLATE_CAPS)
  .filter((k) => SLATE_CAPS[k] > 0 && SLATE_CAPS[k] < SCALE[k]);
// A brief WITH a game reaches every dimension: ctx has its terms, and both
// agreement dims have a fact to agree with. Era 6 emptied this list by making
// Dim 10 read the result instead of a note that 99.5% of non-golf rows lack.
export const UNREACHABLE_DIMS_GAME = [];
// 294 as of 2026-08-24, and it was always 294 -- see the SCALE block for why the
// 300 was a label rather than a total. Correcting it moved no score: every
// threshold (240, 196, 110) reads against prose scored on this same scale before
// and after.
export const NOMINAL_TOTAL = Object.values(SCALE).reduce((a, b) => a + b, 0);        // 294
export const REACHABLE_CEILING = Object.entries(SCALE)                                // 252
  .reduce((a, [k, v]) => a + (k in SLATE_CAPS ? SLATE_CAPS[k] : v), 0);
// Four-fifths OF THE REACHABLE SCALE — the bar stated on the scale it is applied
// to, rather than a constant carried over from a total this runtime cannot reach.
export const FOUR_FIFTHS_REACHABLE = Math.round(REACHABLE_CEILING * 0.8);             // 202

// The same two numbers for a brief that HAS a game object — the majority shape.
// Derived identically, from the same SCALE table, so they cannot drift apart
// from it (ask 3 of CC-CMD-2026-08-15-quality-bar-scale).
export const REACHABLE_CEILING_GAME = Object.entries(SCALE)                          // 294
  .filter(([k]) => !UNREACHABLE_DIMS_GAME.includes(k))
  .reduce((a, [, v]) => a + v, 0);
export const FOUR_FIFTHS_REACHABLE_GAME = Math.round(REACHABLE_CEILING_GAME * 0.8);  // 235
