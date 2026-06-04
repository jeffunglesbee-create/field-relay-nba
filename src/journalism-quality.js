// ═══════════════════════════════════════════════════════════════════════════
// FIELD Journalism Quality Module — WOW 6 (May 31 2026)
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
];

export const SPARINGLY_PHRASES = [
  'crucial','critical','pivotal','key',
  'dominant','dominance','impressive','outstanding',
  'must-watch','storyline','narrative',
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
  if (s.includes('soccer') || s.includes('epl') || s.includes('premier') || s.includes('mls') || s.includes('uefa') || s.includes('ucl') || s.includes('serie') || s.includes('liga') || s.includes('bundesliga') || s.includes('ligue')) return 'soccer';
  if (s.includes('nfl') || s.includes('football')) return 'football';
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

// ── Layer 3: 5-dimension prose scoring (Datamuse freshness wired May 31 2026) ─
// Mirrors browser scoreProse() including the freshness dimension via Datamuse.
// Workers Plus enables outbound fetch with sufficient CPU budget. Freshness
// contribution capped at 20 pts so the ceiling (140 base + 40 arc = 180)
// remains stable for existing callers.
const _STOP_WORDS_RE = /^(their|about|would|could|which|should|after|before|against|during|while|other|first|since|still|being|where|these|those|there|every|until|under|again|from|with|this|that|have|will|they|been|were|what|when|into|than|then|also|each|over|more|most|such|both|some|only|very|just|like|well|even|back|game|team|play|year|time|week)$/i;
async function _datamuseFreshness(words) {
  const contentWords = words.filter(w => w.length > 4 && !_STOP_WORDS_RE.test(w) && /^[a-z]/i.test(w)).slice(0, 5);
  if (!contentWords.length) return 83; // fallback (matches JQ Spec default)
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
export async function scoreProse(text) {
  if (!text) return 0;
  const words = text.split(/\s+/).filter(Boolean);
  if (!words.length) return 0;
  const unique = new Set(words.map(w => w.toLowerCase()));
  // Dim 1: specificity — proper nouns + numbers
  const specifics = words.filter(w => /^[A-Z][a-z]/.test(w) || /\d/.test(w));
  const specificity = specifics.length / words.length;
  // Dim 2: variety — type-token ratio
  const variety = unique.size / words.length;
  // Dim 3: density — specifics per sentence
  const sentences = text.split(/[.!?]+/).filter(s => s.trim().length > 3);
  const nSent = Math.max(1, sentences.length);
  const density = specifics.length / nSent;
  // Dim 4: statistical depth — count distinct sport-stat patterns
  const statPatterns = [
    /\b\d{1,3}(?:\.\d{1,2})?\s*(?:PPG|APG|RPG|BPG|SPG|MPG|ERA|WHIP|OPS|WAR|DRTG|ORTG|PACE)\b/gi,
    /\b\d{1,3}(?:\.\d{1,2})?%/g,
    /\b\d{1,3}-\d{1,3}\b/g,
  ];
  const stats = new Set();
  for (const p of statPatterns) (text.match(p)||[]).forEach(m=>stats.add(m));
  const statDepth = Math.min(1, stats.size / 4); // 4+ stats = max
  // Dim 5: freshness via Datamuse (0-100, capped at 20-pt contribution below)
  const freshness = await _datamuseFreshness(words);
  // 5-dimension base scaled to 140 pts; freshness contributes up to 20 pts
  const base = Math.min(140,
    Math.round(specificity * 50 + variety * 38 + Math.min(density, 4) * 6 + statDepth * 28 + (freshness / 100) * 20)
  );
  // Narrative Arc (0-40)
  const first = sentences[0] || '';
  const last  = sentences[sentences.length-1] || '';
  const sentStarts = new Set(sentences.map(s => s.split(/\s+/)[0]));
  const stakes = /\b\d-\d\b/.test(first) ||
    /\b(finals|championship|eliminated|advance|clinch|series|title|cup|playoffs)\b/i.test(first) ||
    /\b(first since|since \d{4}|\d+ years?)\b/i.test(first);
  const tension = sentences.some(s => {
    const sw = s.split(/\s+/);
    const hasPlayer = sw.some(w => /^[A-Z][a-z]{2,}/.test(w) && !sentStarts.has(w) && w.length > 3);
    const hasStat   = /\d/.test(s) && (/\d+\.\d/.test(s) || /\d+%/.test(s) ||
      /\b(pts?|points?|rebounds?|assists?|goals?|ppg|apg|rpg|saves?)\b/i.test(s));
    return hasPlayer && hasStat;
  });
  const resolution = /\b(watch|look for|decide|force|need|must|whether|tonight|will|could)\b/i.test(last) ||
    /\bif\b/i.test(last) || /\?/.test(last);
  const arcScore = (stakes?10:0) + (tension?10:0) + (resolution?10:0) + (stakes&&tension&&resolution?10:0);
  // Total ceiling: 180 (140 base + 40 arc, no Datamuse freshness)
  return Math.min(180, base + arcScore);
}

// ── Layer 1: style block (synced from FIELD_PROSE_STYLE) ────────────────────
export const FIELD_PROSE_STYLE = [
  '- STYLE: specificity over metaphor. "48 minutes from their first Finals since 1999" not "looking to punch their ticket."',
  '- STYLE: numbers over adjectives. "Brunson\'s 29.0 PPG this series" not "Brunson has been dominant."',
  '- TIME-PERIOD ANCHORING (mandatory): every numeric statistic must be qualified with its time period in the SAME sentence. Required for points, PPG, ERA, batting avg, RBIs, goals, goals-against, FG%, saves, shots, etc. Acceptable qualifiers: "this postseason", "this series", "this season", "last 5 games", "career", "through 30 starts", "tonight", "in May". Bare numbers like "25.0 points", "26.0 PPG", "37 goals", "5-for-6 with 2 RBIs", "32 points through the season" without a clear timeframe ARE FORBIDDEN. The reader must always know what window the number is measured over. Example: write "Wembanyama\'s 28.2 PPG this postseason" not "Wembanyama\'s 25.0 points." Write "Jung Hoo Lee\'s 5-for-6 night" not "Jung Hoo Lee went 5-for-6" — the noun "night" anchors the number to one game.',
  '- STYLE: active voice. "Wembanyama blocked 3 shots" not "3 shots were blocked."',
  '- STYLE: concrete over abstract. "Game 4 starts at 8pm on ESPN" not "the stage is set for a pivotal matchup."',
  '- STYLE: one metaphor max per brief — if you use one, make it original.',
  '- STYLE: write like a well-prepared friend who watched every game, not like a press release.',
  '- STYLE: if a sentence would work in any game recap for any sport, it is too generic — rewrite with details specific to THIS game.',
  '- CITE ANALYTICS: if [PP/PK], [POSSESSION], [PARK], [UMPIRE], or [GOALIE] context appears in the game data, cite the specific figure verbatim — not a paraphrase. "93.5% penalty kill" not "elite penalty killing". "+17% runs at Camden Yards" not "a hitter-friendly park".',
  '- CITE NBA ANALYTICS: if [SLOW GRIND], [FAST PACE], [ELITE D BOTH], [CHESS MATCH], [CLUTCH], or [GAME TYPE] appears, cite specific DRTG, pace, or clutch figures verbatim. "107.7 DRTG, best in the NBA" not "elite defense".',
  '- CITE CHAMPION: if [CHAMPION] appears in game context, reference the team as "defending champions" or "reigning NBA champions" in the first paragraph — never omit this when present.',
  '- FEATURED STAT: if a [FEATURED STAT] line appears for a game, that exact figure MUST appear in your brief for that game.',
  '- LEAD SENTENCE: never start a brief, paragraph, or sentence with "The [Team]..." — lead with the specific situation. "Wembanyama scored 34" not "The Spurs got a big performance." "Two years without a Finals appearance ends tonight" not "The Celtics are looking to make a statement."',
  '- LEAGUE BOUNDARIES (critical): each league is a self-contained competition. NBA winners advance to the NBA Finals to face another NBA team. NHL winners advance to the Stanley Cup Final to face another NHL team. MLB winners advance to the World Series to face another MLB team. NEVER describe a team in one league as advancing to face the winner of, or playing against, a team or champion in a different league. The Stanley Cup, NBA Finals, World Series, Super Bowl, MLS Cup, and Premier League title are separate trophies in separate competitions. If two playoff series in different leagues happen at the same time, write about them as parallel events — never as connected or sequential events.',
  '- BANNED PHRASES (never use): '+BANNED_PHRASES.join(', ')+'.',
  '- USE SPARINGLY (maximum once per brief): '+SPARINGLY_PHRASES.join(', ')+'. If you use any of these, use it once only — then choose a more specific word.',
  '- NEVER explain what data is missing or why you cannot write something. If context is limited, write a short factual brief from what is available. Do not produce meta-commentary about the data.',
].join('\n');

// ── Orchestrator: runs all 6 quality layers with up to 6 retry calls ────────
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
  const maxRetries = opts.maxRetries || 6;

  // 2: cliché
  const cliches = hasCliche(text);
  const overused = countSparingly(text);
  if ((cliches.length || overused.length) && retries < maxRetries) {
    const banNote = cliches.length ? 'BANNED PHRASES to remove: '+cliches.join(', ')+'. ' : '';
    const sparNote = overused.length ? 'OVERUSED WORDS (used '+overused.map(r=>'"'+r.phrase+'" '+r.count+'x').join(', ')+' — use each at most once, replace extras): ' : '';
    const retryPrompt = prompt + '\n\nIMPORTANT REWRITE: '+banNote+sparNote+'Rewrite without them. Use a specific fact instead of each generic phrase.';
    const retried = await callProxy(retryPrompt);
    if (retried && retried.length > 30) { text = retried.trim(); retries++; layers_fired.push('2'); }
  }

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

  // 3b: score-triggered rewrite if total below threshold
  const score = await scoreProse(text);
  const THRESHOLD = opts.scoreThreshold || 130; // 180-scale (with Datamuse freshness baked in) — ~72%
  if (score < THRESHOLD && retries < maxRetries) {
    const retryPrompt = prompt +
      `\n\nQUALITY SCORE LOW (${score}/180): the previous draft scored below our quality threshold. Add more specific facts: proper names, exact numbers, stats with units, and concrete details. Every sentence should contain at least one specific fact (name, number, stat, or concrete detail). Remove vague adjectives and generic transitions.`;
    const retried = await callProxy(retryPrompt);
    if (retried && retried.length > 30) {
      const newScore = await scoreProse(retried);
      if (newScore >= score) { text = retried.trim(); retries++; layers_fired.push('3b'); }
      // If new score is worse, keep the original
    }
  }

  const finalScore = await scoreProse(text);
  return {
    text,
    score: finalScore,
    retries,
    layers_fired,
    ms: Date.now() - t0,
  };
}
