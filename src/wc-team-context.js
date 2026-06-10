// ─────────────────────────────────────────────────────────────────────────────
// FIELD — WC2026 Team Narrative Context
//
// Pre-loaded verified narrative context for all 48 WC 2026 teams.
// Injected into journalism prompt for every WC game in the cron slate.
// Zero per-game AI cost. Pattern: same as src/finals-context.js (inline).
//
// Spec: Drive 1A4y6NVdHhRcMXJvWQ0k1Pa71AnDgZwYk
// Architecture: inline (not R2) — 48 teams × ~500 bytes = ~24KB; tournament-static.
// DO NOT ASSUME any match result, lineup, or injury not listed here.
//
// SOURCES (verified June 4 2026):
//   FIFA rankings: April 1 2026 (ESPN/Wikipedia — next update June 9 2026)
//   Managers: FIFPlay.com full list (May 2026, confirmed June 2 2026)
//   Historical records: Wikipedia national football team articles
//   Key players: confirmed squad sources, worldcupwiki.com (June 2026)
//   Debut flag: 4 first-ever WC participants — Curaçao, Uzbekistan, Jordan, Cape Verde
//
// SHIPPED: June 4 2026 (WC2026 build session)
// ─────────────────────────────────────────────────────────────────────────────

// ── Maps wc26Raw / game-line team names → FIFA 3-letter codes ─────────────────
export const WC_NAME_TO_CODE = {
  'United States':          'USA', 'Mexico':               'MEX',
  'Canada':                 'CAN', 'South Korea':          'KOR',
  'South Africa':           'RSA', 'Czechia':              'CZE',
  'Bosnia and Herzegovina': 'BIH', 'Qatar':                'QAT',
  'Switzerland':            'SUI', 'Brazil':               'BRA',
  'Morocco':                'MAR', 'Haiti':                'HAI',
  'Scotland':               'SCO', 'Paraguay':             'PAR',
  'Australia':              'AUS', 'Türkiye':              'TUR',
  'Germany':                'GER', 'Curaçao':              'CUW',
  'Ivory Coast':            'CIV', 'Ecuador':              'ECU',
  'Netherlands':            'NED', 'Japan':                'JPN',
  'Tunisia':                'TUN', 'Sweden':               'SWE',
  'Belgium':                'BEL', 'Egypt':                'EGY',
  'Iran':                   'IRN', 'New Zealand':          'NZL',
  'Spain':                  'ESP', 'Cape Verde':           'CPV',
  'Saudi Arabia':           'KSA', 'Uruguay':              'URU',
  'France':                 'FRA', 'Senegal':              'SEN',
  'Iraq':                   'IRQ', 'Norway':               'NOR',
  'Argentina':              'ARG', 'Algeria':              'ALG',
  'Austria':                'AUT', 'Jordan':               'JOR',
  'Colombia':               'COL', 'Congo DR':             'COD',
  'Portugal':               'POR', 'Uzbekistan':           'UZB',
  'Panama':                 'PAN', 'England':              'ENG',
  'Croatia':                'CRO', 'Ghana':                'GHA',
};

// ── Per-team context (48 entries) ─────────────────────────────────────────────
// Fields: fifaCode, displayName, group, fifaRank, wcAppearances, bestResult,
//         manager, keyPlayers, qualifyingNote, debutFlag, guardrail, narrativeNote
// Source tags: [FIFA] [Wiki] [Squad] — inline where needed.
export const WC_TEAM_CONTEXT = {

  // ── GROUP A ──────────────────────────────────────────────────────────────────
  MEX: {
    fifaCode: 'MEX', displayName: 'Mexico', group: 'A',
    fifaRank: 15,          // [FIFA] April 1 2026
    wcAppearances: 17,     // [Wiki] 17 appearances including 2026
    bestResult: 'Quarter-finals 1970, 1986 (host)',
    manager: 'Javier Aguirre',   // [FIFPlay] appointed 2024
    keyPlayers: 'Jiménez (FW, Fulham), Lozano (FW), Flores (CM)',
    qualifyingNote: 'Host nation — automatic qualification as co-host',
    debutFlag: false,
    guardrail: null,
    narrativeNote: 'Mexico opens the tournament at Estadio Azteca — the same venue that hosted WC 1970 and 1986 finals. Aguirre\'s third stint as Mexico manager.',
  },
  RSA: {
    fifaCode: 'RSA', displayName: 'South Africa', group: 'A',
    fifaRank: 60,          // [FIFA] April 2026
    wcAppearances: 4,      // [Wiki] 1998, 2002, 2010 (host), 2026
    bestResult: 'Group stage (host in 2010)',
    manager: 'Hugo Broos',       // [FIFPlay] appointed 2021
    keyPlayers: 'Zwane (FW), Dolly (FW), Williams (GK)',
    qualifyingNote: 'Qualified via CAF — Africa qualifying',
    debutFlag: false,
    guardrail: null,
    narrativeNote: 'Bafana Bafana open against Mexico in a rematch of the iconic 2010 WC opening match at Soccer City, when Lawrence Tshabalala scored one of the tournament\'s most celebrated goals.',
  },
  KOR: {
    fifaCode: 'KOR', displayName: 'South Korea', group: 'A',
    fifaRank: 25,          // [FIFA] April 2026
    wcAppearances: 11,     // [Wiki] 11 appearances including 2026
    bestResult: 'Semi-finals 2002 (co-host)',
    manager: 'Hong Myung-bo',    // [FIFPlay] appointed 2024
    keyPlayers: 'Son Heung-min (FW/CAP, Tottenham), Lee Jae-sung (CM), Hwang Hee-chan (FW)',
    qualifyingNote: 'Qualified automatically — AFC qualifying',
    debutFlag: false,
    guardrail: null,
    narrativeNote: 'Son Heung-min captains South Korea — one of Asia\'s all-time greatest players. South Korea\'s 2002 semi-final run (co-hosting with Japan) remains the best finish by an Asian team.',
  },
  CZE: {
    fifaCode: 'CZE', displayName: 'Czechia', group: 'A',
    fifaRank: 41,          // [FIFA] April 2026
    wcAppearances: 2,      // [Wiki] as Czech Republic: 2006; 2026 (Czechia era — Czechoslovakia had 11 WC appearances)
    bestResult: 'Group stage (2006 as Czech Republic)',
    manager: 'Miroslav Koubek',  // [FIFPlay] appointed 2024
    keyPlayers: 'Schick (FW, Bayer Leverkusen), Souček (CM, West Ham), Coufal (RB)',
    qualifyingNote: 'Qualified via UEFA — European playoff winner (beat Italy)',
    debutFlag: false,
    guardrail: 'Czechia as a nation includes the Czech Republic era WC records (2006). Czechoslovakia had a much longer WC history (11 appearances, runners-up 1934 and 1962) — use full Czechoslovakia/Czech Republic context if appropriate.',
    narrativeNote: 'Qualified via a dramatic penalty shootout win over Italy in the UEFA playoffs — Italy missing a second consecutive WC. Schick is their talismanic striker.',
  },

  // ── GROUP B ──────────────────────────────────────────────────────────────────
  CAN: {
    fifaCode: 'CAN', displayName: 'Canada', group: 'B',
    fifaRank: 30,          // [FIFA] April 2026
    wcAppearances: 3,      // [Wiki] 1986, 2022, 2026
    bestResult: 'Group stage (1986, 2022)',
    manager: 'Jesse Marsch',     // [FIFPlay] appointed 2024
    keyPlayers: 'Davies (LW/LB, Bayern Munich), Jonathan David (FW, Lille), Eustáquio (CM)',
    qualifyingNote: 'Host nation — automatic qualification as co-host',
    debutFlag: false,
    guardrail: null,
    narrativeNote: 'Second home World Cup after 1986. Davies and Jonathan David lead a golden generation that reached Qatar 2022 — the first WC for Canada in 36 years. All three group games played on home soil.',
  },
  BIH: {
    fifaCode: 'BIH', displayName: 'Bosnia and Herzegovina', group: 'B',
    fifaRank: 65,          // [FIFA] April 2026
    wcAppearances: 2,      // [Wiki] 2014, 2026
    bestResult: 'Group stage (2014)',
    manager: 'Sergej Barbarez',  // [FIFPlay] appointed 2024
    keyPlayers: 'Džeko (FW, Fenerbahçe — veteran), Ahmedhodzic (CB, Sheffield United), Pjanić (retired)',
    qualifyingNote: 'Qualified via UEFA — European playoff winner (beat Germany in extra time)',
    debutFlag: false,
    guardrail: null,
    narrativeNote: 'Qualified with a stunning 2-1 extra-time win over Germany in the UEFA European playoff — one of qualifying\'s biggest upsets. Dragons making only their second World Cup.',
  },
  QAT: {
    fifaCode: 'QAT', displayName: 'Qatar', group: 'B',
    fifaRank: 55,          // [FIFA] April 2026
    wcAppearances: 2,      // [Wiki] 2022 (host), 2026
    bestResult: 'Group stage (2022, 2026)',
    manager: 'Julen Lopetegui',  // [FIFPlay] appointed 2025
    keyPlayers: 'Afif (FW, Al Sadd), Al-Moez Ali (FW), Boudiaf (CM)',
    qualifyingNote: 'Qualified via AFC — Asian qualifying',
    debutFlag: false,
    guardrail: 'Qatar became the first host nation in WC history to be eliminated in the group stage in 2022 — scored only 1 goal in 3 games. Do NOT frame 2026 as a redemption story without noting the 2022 context.',
    narrativeNote: 'First WC as a non-host qualifier. Lopetegui (former Spain/Real Madrid manager) hired to rebuild after 2022 embarrassment. Akram Afif is their best player and a genuine creative threat.',
  },
  SUI: {
    fifaCode: 'SUI', displayName: 'Switzerland', group: 'B',
    fifaRank: 19,          // [FIFA] April 2026
    wcAppearances: 12,     // [Wiki] including 2026
    bestResult: 'Quarter-finals 1934, 1938, 1954 (host)',
    manager: 'Murat Yakin',      // [FIFPlay] appointed 2021
    keyPlayers: 'Xhaka (CM, Bayer Leverkusen), Akanji (CB, Man City), Embolo (FW)',
    qualifyingNote: 'Qualified automatically — UEFA qualifying',
    debutFlag: false,
    guardrail: null,
    narrativeNote: 'Consistent dark horses — reached the last 16 in 2022 (lost to Portugal). Xhaka is their captain and creative engine from deep.',
  },

  // ── GROUP C ──────────────────────────────────────────────────────────────────
  BRA: {
    fifaCode: 'BRA', displayName: 'Brazil', group: 'C',
    fifaRank: 6,           // [FIFA] April 2026
    wcAppearances: 22,     // [Wiki] 22 appearances including 2026 — every WC ever
    bestResult: 'Champions 1958, 1962, 1970, 1994, 2002 (5 titles — record)',
    manager: 'Carlo Ancelotti',  // [FIFPlay] appointed 2025 — from Real Madrid
    keyPlayers: 'Vinícius Jr (FW, Real Madrid), Rodrygo (FW, Real Madrid), Endrick (FW)',
    qualifyingNote: 'Qualified automatically — CONMEBOL qualifying',
    debutFlag: false,
    guardrail: 'Brazil are the only nation to have played in EVERY World Cup. Their 7-1 loss to Germany in the 2014 semi-final (as hosts) is directly relevant context. Last won in 2002. Do NOT say "seeking a record 6th title" — it would be their 6th, but the record is already theirs at 5.',
    narrativeNote: 'Ancelotti\'s first tournament as Brazil manager after joining from Real Madrid in 2025. Last won in 2002 — a 24-year title drought for the most decorated WC nation.',
  },
  MAR: {
    fifaCode: 'MAR', displayName: 'Morocco', group: 'C',
    fifaRank: 8,           // [FIFA] April 2026
    wcAppearances: 7,      // [Wiki] 1970, 1986, 1994, 1998, 2018, 2022, 2026
    bestResult: 'Semi-finals 2022 (first African team ever)',
    manager: 'Walid Regragui',   // [FIFPlay] appointed 2022
    keyPlayers: 'En-Nesyri (FW, Fenerbahçe), Ziyech (AM, Galatasaray), Amrabat (CM)',
    qualifyingNote: 'Qualified automatically — CAF qualifying',
    debutFlag: false,
    guardrail: null,
    narrativeNote: 'First African team in WC semi-finals history (2022). Regragui unchanged as manager. Now ranked 8th in the world — legitimate contenders, not underdogs.',
  },
  HAI: {
    fifaCode: 'HAI', displayName: 'Haiti', group: 'C',
    fifaRank: 83,          // [FIFA] April 2026
    wcAppearances: 2,      // [Wiki] 1974, 2026
    bestResult: 'Group stage (1974)',
    manager: 'Sébastien Migné',  // [FIFPlay] appointed 2024
    keyPlayers: 'Etienne Jr (FW, Toronto FC), Nesta Quintero (CM)',
    qualifyingNote: 'Qualified via CONCACAF — Nations League path',
    debutFlag: false,
    guardrail: null,
    narrativeNote: 'First World Cup appearance in 52 years (since 1974). Haiti face Brazil and Morocco — the two teams that met in the 2022 quarter-finals. Remarkable qualification story.',
  },
  SCO: {
    fifaCode: 'SCO', displayName: 'Scotland', group: 'C',
    fifaRank: 43,          // [FIFA] April 2026
    wcAppearances: 9,      // [Wiki] 9 appearances including 2026 (last was 1998 — 28-year gap)
    bestResult: 'Group stage (multiple appearances)',
    manager: 'Steve Clarke',     // [FIFPlay] appointed 2019
    keyPlayers: 'McTominay (CM, Napoli), Robertson (LB, Liverpool), Tierney (LB)',
    qualifyingNote: 'Qualified via UEFA — European qualifying',
    debutFlag: false,
    guardrail: null,
    narrativeNote: 'Scotland return to the World Cup after a 28-year absence (last appearance 1998). McTominay and Robertson lead the most talented Scottish generation in decades.',
  },

  // ── GROUP D ──────────────────────────────────────────────────────────────────
  USA: {
    fifaCode: 'USA', displayName: 'United States', group: 'D',
    fifaRank: 16,          // [FIFA] April 2026
    wcAppearances: 11,     // [Wiki] 11 appearances including 2026
    bestResult: 'Semi-finals 1930',
    manager: 'Mauricio Pochettino', // [FIFPlay] appointed 2024 — former Chelsea/PSG/Spurs
    keyPlayers: 'Pulisic (FW/CAP, AC Milan), Adams (CM, Bournemouth), McKennie (CM)',
    qualifyingNote: 'Host nation — automatic qualification as co-host',
    debutFlag: false,
    guardrail: null,
    narrativeNote: 'First home World Cup since co-hosting in 1994. Pochettino\'s golden generation must deliver on home soil. USA vs Paraguay on June 12 is free on Tubi — biggest US soccer moment in decades.',
  },
  PAR: {
    fifaCode: 'PAR', displayName: 'Paraguay', group: 'D',
    fifaRank: 40,          // [FIFA] April 2026
    wcAppearances: 9,      // [Wiki] 9 appearances including 2026
    bestResult: 'Quarter-finals 2010',
    manager: 'Gustavo Alfaro',   // [FIFPlay] appointed 2024
    keyPlayers: 'Sanabria (FW, Torino), Almirón (AM, Newcastle United), Gómez (GK)',
    qualifyingNote: 'Qualified via CONMEBOL — South American qualifying',
    debutFlag: false,
    guardrail: null,
    narrativeNote: 'Almirón (Newcastle) is their most recognizable player globally. Paraguay-USA on June 12 is free on Tubi — the highest-profile free WC broadcast in US history.',
  },
  AUS: {
    fifaCode: 'AUS', displayName: 'Australia', group: 'D',
    fifaRank: 27,          // [FIFA] April 2026
    wcAppearances: 6,      // [Wiki] 1974, 2006, 2010, 2014, 2022, 2026
    bestResult: 'Round of 16 2006, 2022',
    manager: 'Tony Popovic',     // [FIFPlay] appointed 2024
    keyPlayers: 'Leckie (FW/RW, Melbourne City), Irvine (CM, St. Pauli), Rowles (CB)',
    qualifyingNote: 'Qualified via AFC — Asian qualifying',
    debutFlag: false,
    guardrail: null,
    narrativeNote: 'Reached the Round of 16 in 2022 (lost to Argentina). Popovic replaced Socceroos legend Arnold. Leckie remains the key attacking outlet.',
  },
  TUR: {
    fifaCode: 'TUR', displayName: 'Türkiye', group: 'D',
    fifaRank: 22,          // [FIFA] April 2026
    wcAppearances: 3,      // [Wiki] 1954, 2002, 2026
    bestResult: 'Third place 2002',
    manager: 'Vincenzo Montella', // [FIFPlay] appointed 2023 — Italian manager
    keyPlayers: 'Çalhanoglu (CM, Inter Milan), Güler (AM, Real Madrid — young star), Yıldız (FW)',
    qualifyingNote: 'Qualified via UEFA — European playoff winner',
    debutFlag: false,
    guardrail: 'SPELLING: Türkiye with ü — not Turkey. As used in wc26Raw, by FIFA and the Turkish government officially since 2022.',
    narrativeNote: 'Arda Güler (Real Madrid) is one of the tournament\'s most exciting young talents at age 20. Turkish football at a generational pivot. Third place in 2002 remains their best WC finish.',
  },

  // ── GROUP E ──────────────────────────────────────────────────────────────────
  GER: {
    fifaCode: 'GER', displayName: 'Germany', group: 'E',
    fifaRank: 10,          // [FIFA] April 2026
    wcAppearances: 20,     // [Wiki] 20 appearances including 2026 (as Germany — W.Germany era included)
    bestResult: 'Champions 1954, 1974, 1990, 2014 (4 titles)',
    manager: 'Julian Nagelsmann', // [FIFPlay] appointed 2023
    keyPlayers: 'Havertz (FW/AM, Arsenal), Musiala (AM, Bayern Munich), Ter Stegen (GK)',
    qualifyingNote: 'Qualified via UEFA — European qualifying',
    debutFlag: false,
    guardrail: 'Germany were ELIMINATED IN THE GROUP STAGE in both 2018 and 2022 — consecutive group-stage exits as defending champion (2018) and then again in 2022. This redemption narrative is central to 2026. Do NOT frame them as dominant favorites without acknowledging the recent failures.',
    narrativeNote: 'Nagelsmann\'s young Germany desperate to end back-to-back group-stage exits. Musiala (21) and Havertz lead a squad with genuine talent and much to prove.',
  },
  CUW: {
    fifaCode: 'CUW', displayName: 'Curaçao', group: 'E',
    fifaRank: 82,          // [FIFA] April 2026
    wcAppearances: 1,      // 2026 is their FIRST appearance
    bestResult: 'First appearance 2026',
    manager: 'Dick Advocaat',    // [FIFPlay] appointed 2024 — veteran Dutch manager
    keyPlayers: 'Cordelia (FW), Koolwijk (CM), Cijntje (FW)',
    qualifyingNote: 'Qualified via CONCACAF — Nations League path',
    debutFlag: true,
    guardrail: null,
    narrativeNote: 'FIRST EVER World Cup appearance. Smallest nation in the 2026 tournament by population (~156,000). Dick Advocaat — who won trophies with PSV, Rangers, Zenit — managing one of football\'s ultimate underdog stories.',
  },
  CIV: {
    fifaCode: 'CIV', displayName: 'Ivory Coast', group: 'E',
    fifaRank: 34,          // [FIFA] April 2026
    wcAppearances: 4,      // [Wiki] 2006, 2010, 2014, 2026 (missed 2018, 2022)
    bestResult: 'Group stage (multiple times)',
    manager: 'Emerse Faé',       // [FIFPlay] appointed 2024
    keyPlayers: 'Haller (FW, Borussia Dortmund), Sangaré (CM, Nottm Forest), Fofana (CM)',
    qualifyingNote: 'Qualified via CAF — Africa qualifying',
    debutFlag: false,
    guardrail: null,
    narrativeNote: 'The golden generation of Drogba/Touré has passed, but Haller and Sangaré lead a competitive new wave. First WC since 2014 after missing two editions.',
  },
  ECU: {
    fifaCode: 'ECU', displayName: 'Ecuador', group: 'E',
    fifaRank: 23,          // [FIFA] April 2026
    wcAppearances: 4,      // [Wiki] 2002, 2006, 2014, 2026
    bestResult: 'Round of 16 2006',
    manager: 'Sebastián Beccacece', // [FIFPlay] appointed 2024 — Argentine tactician
    keyPlayers: 'Caicedo (CM, Chelsea), Plata (FW), Sarmiento (FW)',
    qualifyingNote: 'Qualified via CONMEBOL — South American qualifying',
    debutFlag: false,
    guardrail: null,
    narrativeNote: 'Moisés Caicedo (Chelsea) is one of the world\'s best defensive midfielders at 22 — Ecuador\'s most important player and a realistic Ballon d\'Or candidate if he performs here.',
  },

  // ── GROUP F ──────────────────────────────────────────────────────────────────
  NED: {
    fifaCode: 'NED', displayName: 'Netherlands', group: 'F',
    fifaRank: 7,           // [FIFA] April 2026
    wcAppearances: 11,     // [Wiki] 11 appearances including 2026
    bestResult: 'Runners-up 1974, 1978, 2010',
    manager: 'Ronald Koeman',    // [FIFPlay] appointed 2023 (second stint)
    keyPlayers: 'Van Dijk (CB/CAP, Liverpool), Gakpo (FW, Liverpool), De Jong (CM, Barcelona)',
    qualifyingNote: 'Qualified automatically — UEFA qualifying',
    debutFlag: false,
    guardrail: 'Netherlands have finished runners-up three times (1974, 1978, 2010) without winning the tournament — a defining narrative. Do NOT say they have won the World Cup.',
    narrativeNote: 'Three WC finals, zero titles — the "total football" nation\'s crowning achievement still eludes them. Van Dijk leads a squad with genuine world-class quality.',
  },
  JPN: {
    fifaCode: 'JPN', displayName: 'Japan', group: 'F',
    fifaRank: 18,          // [FIFA] April 2026
    wcAppearances: 8,      // [Wiki] 1998, 2002, 2006, 2010, 2014, 2018, 2022, 2026
    bestResult: 'Round of 16 (2002, 2010, 2018, 2022)',
    manager: 'Hajime Moriyasu',  // [FIFPlay] appointed 2018
    keyPlayers: 'Minamino (FW, Monaco), Doan (FW, Freiburg), Tanaka (CM, Dortmund)',
    qualifyingNote: 'Qualified automatically — AFC qualifying',
    debutFlag: false,
    guardrail: null,
    narrativeNote: 'Japan beat Germany AND Spain in the 2022 group stage — the biggest result in Japanese football history. Moriyasu has built the strongest squad Japan has ever fielded.',
  },
  TUN: {
    fifaCode: 'TUN', displayName: 'Tunisia', group: 'F',
    fifaRank: 44,          // [FIFA] April 2026
    wcAppearances: 6,      // [Wiki] 1978, 1998, 2002, 2006, 2018, 2022, 2026 — actually 7 including 2026? Let me check: 1978, 1998, 2002, 2006, 2018, 2022, 2026 = 7
    bestResult: 'Group stage (multiple times — never advanced)',
    manager: 'Sami Trabelsi',    // [FIFPlay] appointed 2025
    keyPlayers: 'Msakni (AM), Sliti (FW), Khazri (veteran)',
    qualifyingNote: 'Qualified via CAF — Africa qualifying',
    debutFlag: false,
    guardrail: null,
    narrativeNote: 'The Eagles of Carthage have appeared at 7 World Cups without ever advancing from the group stage. New manager Trabelsi looking to change history.',
  },
  SWE: {
    fifaCode: 'SWE', displayName: 'Sweden', group: 'F',
    fifaRank: 38,          // [FIFA] April 2026
    wcAppearances: 12,     // [Wiki] 12 appearances including 2026
    bestResult: 'Runners-up 1958 (home), Third place 1950, 1994',
    manager: 'Graham Potter',    // [FIFPlay] appointed 2025 — former Brighton/Chelsea
    keyPlayers: 'Isak (FW, Newcastle), Kulusevski (RW, Tottenham), Ekdal (CM — veteran)',
    qualifyingNote: 'Qualified via UEFA — European qualifying',
    debutFlag: false,
    guardrail: null,
    narrativeNote: 'Alexander Isak (Newcastle) is one of Europe\'s most dangerous forwards at 26. Potter hired as foreign coach — a significant hire given Sweden\'s tradition of home-grown managers.',
  },

  // ── GROUP G ──────────────────────────────────────────────────────────────────
  BEL: {
    fifaCode: 'BEL', displayName: 'Belgium', group: 'G',
    fifaRank: 9,           // [FIFA] April 2026
    wcAppearances: 14,     // [Wiki] 14 appearances including 2026
    bestResult: 'Third place 2018',
    manager: 'Rudi Garcia',      // [FIFPlay] appointed 2025 — former Napoli/Marseille
    keyPlayers: 'De Bruyne (CM/CAP, Man City), Lukaku (FW, Roma), Courtois (GK, Real Madrid)',
    qualifyingNote: 'Qualified automatically — UEFA qualifying',
    debutFlag: false,
    guardrail: 'The "golden generation" (De Bruyne, Hazard era) peaked at 2018 (third place). Eden Hazard is retired. This is the LAST WC for De Bruyne (33) and Lukaku (31). Do NOT conflate with the 2018 squad.',
    narrativeNote: 'Last chance for the golden generation\'s survivors. De Bruyne (33) almost certainly playing his final World Cup. Garcia must navigate an ageing but still talented squad.',
  },
  EGY: {
    fifaCode: 'EGY', displayName: 'Egypt', group: 'G',
    fifaRank: 29,          // [FIFA] April 2026
    wcAppearances: 4,      // [Wiki] 1934, 1990, 2018, 2026
    bestResult: 'Group stage (never advanced)',
    manager: 'Hossam Hassan',    // [FIFPlay] appointed 2024 — Egypt legend as player
    keyPlayers: 'Salah (FW/CAP, Liverpool), Elneny (CM, Arsenal), Trezeguet (FW)',
    qualifyingNote: 'Qualified via CAF — Africa qualifying',
    debutFlag: false,
    guardrail: null,
    narrativeNote: 'Mo Salah leads Egypt — potentially his only World Cup at 34. One of the greatest players in the world carrying Africa\'s expectations. Egypt haven\'t advanced from the group stage in 4 appearances.',
  },
  IRN: {
    fifaCode: 'IRN', displayName: 'Iran', group: 'G',
    fifaRank: 21,          // [FIFA] April 2026
    wcAppearances: 7,      // [Wiki] 1978, 1998, 2006, 2014, 2018, 2022, 2026
    bestResult: 'Group stage (never advanced)',
    manager: 'Amir Ghalenoei',   // [FIFPlay] appointed 2023
    keyPlayers: 'Azmoun (FW, Bayer Leverkusen), Taremi (FW, Inter Milan), Jahanbakhsh (FW)',
    qualifyingNote: 'Qualified automatically — AFC qualifying',
    debutFlag: false,
    guardrail: null,
    narrativeNote: 'Team Melli have appeared at 7 World Cups without advancing. Taremi (Inter Milan) and Azmoun are their strongest attacking pairing. Iran beat Wales and drew with USA in 2022.',
  },
  NZL: {
    fifaCode: 'NZL', displayName: 'New Zealand', group: 'G',
    fifaRank: 85,          // [FIFA] April 2026
    wcAppearances: 3,      // [Wiki] 1982, 2010, 2026
    bestResult: 'Group stage (1982, 2010)',
    manager: 'Darren Bazeley',   // [FIFPlay] appointed 2023
    keyPlayers: 'Wood (FW, Middlesbrough), McGlinchey (FW), Cacace (LB)',
    qualifyingNote: 'Qualified via OFC — Oceania qualifying',
    debutFlag: false,
    guardrail: null,
    narrativeNote: 'All Whites return after a 16-year absence. Only OFC representative. Chris Wood leads a squad with limited European depth — facing Belgium and Iran in the toughest group for points.',
  },

  // ── GROUP H ──────────────────────────────────────────────────────────────────
  ESP: {
    fifaCode: 'ESP', displayName: 'Spain', group: 'H',
    fifaRank: 2,           // [FIFA] April 2026 (FIFA #1 at draw — note Lamine Yamal injury concern)
    wcAppearances: 16,     // [Wiki] 16 appearances including 2026
    bestResult: 'Champions 2010 (South Africa)',
    manager: 'Luis de la Fuente', // [FIFPlay] appointed 2022 — won Euro 2024
    keyPlayers: 'Yamal (RW, Barcelona — age 18), Pedri (CM, Barcelona), Morata (FW, AC Milan)',
    qualifyingNote: 'Qualified automatically — UEFA qualifying',
    debutFlag: false,
    guardrail: 'Spain won EURO 2024 (beating England in the final) — the context for their arrival. Lamine Yamal suffered a hamstring injury before the tournament — fitness in question. Do NOT assume he plays without noting the injury concern.',
    narrativeNote: 'EURO 2024 champions. Luis de la Fuente\'s tiki-taka revival powered by 18-year-old Lamine Yamal — the most exciting young player in world football. One WC title (2010).',
  },
  CPV: {
    fifaCode: 'CPV', displayName: 'Cape Verde', group: 'H',
    fifaRank: 69,          // [FIFA] April 2026
    wcAppearances: 1,      // 2026 is their FIRST appearance
    bestResult: 'First appearance 2026',
    manager: 'Bubista',          // [FIFPlay] appointed 2020
    keyPlayers: 'Andrade (FW), Jamiro Monteiro (AM), Tavares (CB)',
    qualifyingNote: 'Qualified via CAF — Africa qualifying',
    debutFlag: true,
    guardrail: 'Cape Verde is officially "Cabo Verde" in FIFA registration. Either form acceptable in prose.',
    narrativeNote: 'FIRST EVER World Cup appearance. Cape Verde population: ~600,000. Known as the Blue Sharks — one of African football\'s most emotional qualification stories.',
  },
  KSA: {
    fifaCode: 'KSA', displayName: 'Saudi Arabia', group: 'H',
    fifaRank: 61,          // [FIFA] April 2026
    wcAppearances: 7,      // [Wiki] 1994, 1998, 2002, 2006, 2010, 2022, 2026
    bestResult: 'Round of 16 1994',
    manager: 'Giorgos Donis',    // [FIFPlay] appointed 2025 — Greek manager
    keyPlayers: 'Al-Dawsari (FW — scored vs Argentina 2022), Al-Buraikan (FW), Al-Malki (CM)',
    qualifyingNote: 'Qualified automatically — AFC qualifying',
    debutFlag: false,
    guardrail: null,
    narrativeNote: 'Salem Al-Dawsari\'s goal to beat Argentina 2-1 in 2022 is one of WC history\'s greatest upsets. The Green Falcons have invested heavily in domestic football with Ronaldo, Benzema and others in their Saudi Pro League.',
  },
  URU: {
    fifaCode: 'URU', displayName: 'Uruguay', group: 'H',
    fifaRank: 17,          // [FIFA] April 2026
    wcAppearances: 14,     // [Wiki] 14 appearances including 2026 — boycotted several
    bestResult: 'Champions 1930, 1950 (2 titles)',
    manager: 'Marcelo Bielsa',   // [FIFPlay] appointed 2023 — Argentine legend
    keyPlayers: 'Núñez (FW, Liverpool), Valverde (CM, Real Madrid), Bentancur (CM)',
    qualifyingNote: 'Qualified automatically — CONMEBOL qualifying',
    debutFlag: false,
    guardrail: 'Uruguay are TWO-TIME World Cup champions (1930, 1950) — the first and fourth editions. Despite their size (3.4m population) they remain giants of South American football.',
    narrativeNote: 'Bielsa\'s high-energy, pressing Uruguay with Valverde (Real Madrid) and Núñez (Liverpool) — their most impressive generation since Forlán and Cavani. Dark horse with genuine pedigree.',
  },

  // ── GROUP I ──────────────────────────────────────────────────────────────────
  FRA: {
    fifaCode: 'FRA', displayName: 'France', group: 'I',
    fifaRank: 1,           // [FIFA] April 2026 — top ranked team in the world
    wcAppearances: 16,     // [Wiki] 16 appearances including 2026
    bestResult: 'Champions 1998 (host), 2018. Runners-up 2022.',
    manager: 'Didier Deschamps', // [FIFPlay] appointed 2012 — final WC
    keyPlayers: 'Mbappé (FW/CAP, Real Madrid), Griezmann (AM, Atlético Madrid), Tchouaméni (CM)',
    qualifyingNote: 'Qualified automatically — UEFA qualifying',
    debutFlag: false,
    guardrail: 'France are RUNNERS-UP 2022 (lost final to Argentina on penalties) — NOT defending champions. If they win 2026 it is their THIRD title (1998, 2018), equalling record. Do NOT say "seeking their third title" — this would be their THIRD, not a record. Do NOT say they are "defending champions."',
    narrativeNote: 'FIFA #1. Deschamps\' final tournament before stepping down — he has won the WC as player (1998) and will try to match it as manager (again). Mbappé at 27: his defining tournament.',
  },
  SEN: {
    fifaCode: 'SEN', displayName: 'Senegal', group: 'I',
    fifaRank: 14,          // [FIFA] April 2026
    wcAppearances: 4,      // [Wiki] 2002, 2018, 2022, 2026
    bestResult: 'Quarter-finals 2002',
    manager: 'Pape Thiaw',       // [FIFPlay] appointed 2024
    keyPlayers: 'Mané (FW, Al Nassr — if fit), Gueye (CM, Everton — veteran), Sarr (FW, Palace)',
    qualifyingNote: 'Qualified via CAF — Africa qualifying',
    debutFlag: false,
    guardrail: null,
    narrativeNote: 'AFCON 2022 champions. Reached Round of 16 in 2022. With or without an aging Mané, Senegal have the depth and organization to threaten here.',
  },
  IRQ: {
    fifaCode: 'IRQ', displayName: 'Iraq', group: 'I',
    fifaRank: 57,          // [FIFA] April 2026
    wcAppearances: 2,      // [Wiki] 1986, 2026 — 40-year gap
    bestResult: 'Group stage (1986)',
    manager: 'Graham Arnold',    // [FIFPlay] appointed 2025 — former Australia manager
    keyPlayers: 'Mohanad Ali (FW), Amjed Attwan (CM), Basim Abbas (FW)',
    qualifyingNote: 'Qualified via AFC — intercontinental playoff (beat Bolivia)',
    debutFlag: false,
    guardrail: null,
    narrativeNote: 'Iraq return to the World Cup after 40 years — qualified through the intercontinental playoff with a dramatic 2-1 win over Bolivia. Arnold (former Australia manager) an unusual choice.',
  },
  NOR: {
    fifaCode: 'NOR', displayName: 'Norway', group: 'I',
    fifaRank: 31,          // [FIFA] April 2026
    wcAppearances: 4,      // [Wiki] 1938, 1994, 1998, 2026 — 28-year gap
    bestResult: 'Round of 16 1998',
    manager: 'Ståle Solbakken',  // [FIFPlay] appointed 2020
    keyPlayers: 'Haaland (FW/CAP, Man City), Sörloth (FW, Atlético), Ødegaard (AM, Arsenal)',
    qualifyingNote: 'Qualified via UEFA — European qualifying',
    debutFlag: false,
    guardrail: null,
    narrativeNote: 'Haaland — the most prolific striker in European football history at 25 — finally makes his World Cup debut after Norway missed out on qualifying in previous cycles. This is what the 2026 group draw was designed to show off.',
  },

  // ── GROUP J ──────────────────────────────────────────────────────────────────
  ARG: {
    fifaCode: 'ARG', displayName: 'Argentina', group: 'J',
    fifaRank: 3,           // [FIFA] April 2026
    wcAppearances: 18,     // [Wiki] 18 appearances including 2026
    bestResult: 'Champions 1978 (host), 1986, 2022 (3 titles)',
    manager: 'Lionel Scaloni',   // [FIFPlay] appointed 2018
    keyPlayers: 'Messi (FW/CAP, Inter Miami — age 38), De Paul (CM, Atlético Madrid), Romero (CB)',
    qualifyingNote: 'Qualified automatically — CONMEBOL qualifying',
    debutFlag: false,
    guardrail: 'DEFENDING CHAMPIONS — won 2022 final vs France on penalties. Messi\'s SIXTH World Cup at age 38 — almost certainly his last. A fourth title would be their record-equalling achievement (Germany and Italy also have 4). Do NOT say "seeking their third title" — this would be their FOURTH.',
    narrativeNote: 'Messi at 38 in his almost certain final World Cup. Defending champions. Scaloni unchanged since 2018. The most anticipated storyline of the entire tournament.',
  },
  ALG: {
    fifaCode: 'ALG', displayName: 'Algeria', group: 'J',
    fifaRank: 28,          // [FIFA] April 2026
    wcAppearances: 5,      // [Wiki] 1982, 1986, 2010, 2014, 2026
    bestResult: 'Round of 16 2014',
    manager: 'Vladimir Petković', // [FIFPlay] appointed 2024 — former Switzerland manager
    keyPlayers: 'Mahrez (FW/CAP, Al Ahli — veteran), Slimani (FW — veteran), Benrahma (AM, West Ham)',
    qualifyingNote: 'Qualified via CAF — Africa qualifying',
    debutFlag: false,
    guardrail: 'Algeria beat West Germany 2-1 in 1982 — the first African team to beat a European side at a WC. Despite this, they were eliminated via an infamous collusive game between Germany and Austria ("The Disgrace of Gijón"). This historical context is often relevant.',
    narrativeNote: 'Opening against defending champions Argentina in Kansas City. Mahrez (Al Ahli) captains what could be his final WC appearance. The Algeria-Argentina draw is one of the group stage\'s marquee matchups.',
  },
  AUT: {
    fifaCode: 'AUT', displayName: 'Austria', group: 'J',
    fifaRank: 24,          // [FIFA] April 2026
    wcAppearances: 8,      // [Wiki] including 2026 — last appearance was 1998
    bestResult: 'Third place 1954',
    manager: 'Ralf Rangnick',    // [FIFPlay] appointed 2022 — former Man United (interim)
    keyPlayers: 'Sabitzer (CM, Man United), Laimer (CM, Bayern Munich), Arnautović (FW — veteran)',
    qualifyingNote: 'Qualified via UEFA — European qualifying',
    debutFlag: false,
    guardrail: null,
    narrativeNote: 'Rangnick\'s pressing-intensive Austria have been consistently impressive in qualifying. Sabitzer and Laimer give them genuine midfield quality. First WC since 1998.',
  },
  JOR: {
    fifaCode: 'JOR', displayName: 'Jordan', group: 'J',
    fifaRank: 63,          // [FIFA] April 2026
    wcAppearances: 1,      // 2026 is their FIRST appearance
    bestResult: 'First appearance 2026',
    manager: 'Jamal Sellami',    // [FIFPlay] appointed 2024 — former Morocco U23 coach
    keyPlayers: 'Al-Tamari (FW, Montpellier), Baha\'aDudin Abu-Hashim (FW)',
    qualifyingNote: 'Qualified via AFC — intercontinental playoff path',
    debutFlag: true,
    guardrail: null,
    narrativeNote: 'FIRST EVER World Cup appearance for the Chivalrous Ones. Jordan reached the 2023 Asian Cup final (lost to Qatar). Opening against defending champions Argentina in what could be the WC debut of all WC debuts.',
  },

  // ── GROUP K ──────────────────────────────────────────────────────────────────
  COL: {
    fifaCode: 'COL', displayName: 'Colombia', group: 'K',
    fifaRank: 13,          // [FIFA] April 2026
    wcAppearances: 7,      // [Wiki] 1962, 1990, 1994, 1998, 2014, 2018, 2026
    bestResult: 'Quarter-finals 2014',
    manager: 'Néstor Lorenzo',   // [FIFPlay] appointed 2022 — Argentine
    keyPlayers: 'Díaz (FW, Liverpool), James Rodríguez (AM — veteran), Arias (RB)',
    qualifyingNote: 'Qualified automatically — CONMEBOL qualifying',
    debutFlag: false,
    guardrail: null,
    narrativeNote: 'Luis Díaz (Liverpool) leads Colombia\'s best squad since the James Rodríguez 2014 generation. Colombia won the 2024 Copa América — Lorenzo\'s side is in excellent form entering 2026.',
  },
  COD: {
    fifaCode: 'COD', displayName: 'Congo DR', group: 'K',
    fifaRank: 46,          // [FIFA] April 2026
    wcAppearances: 2,      // [Wiki] 1974 (as Zaire), 2026 — 52-year gap
    bestResult: 'Group stage (1974 as Zaire)',
    manager: 'Sébastien Desabre', // [FIFPlay] appointed 2022 — French manager
    keyPlayers: 'Bakambu (FW, China — veteran), Masuaku (LB, Beşiktaş), Chadrac Akolo (FW)',
    qualifyingNote: 'Qualified via CAF — FIFA playoff (beat Jamaica)',
    debutFlag: false,
    guardrail: 'DISTINGUISH from Republic of Congo — different nation. Congo DR (Democratic Republic of the Congo, capital Kinshasa) previously appeared as Zaire in 1974. Do NOT confuse with Republic of Congo (capital Brazzaville), which did not qualify.',
    narrativeNote: 'Return after 52 years, last appearing as Zaire in 1974 (famously lost 9-0 to Yugoslavia). Qualified via the FIFA playoff in dramatic fashion. Opening against Portugal.',
  },
  POR: {
    fifaCode: 'POR', displayName: 'Portugal', group: 'K',
    fifaRank: 5,           // [FIFA] April 2026
    wcAppearances: 9,      // [Wiki] 9 appearances including 2026
    bestResult: 'Third place 1966, Semi-finals 2006',
    manager: 'Roberto Martínez', // [FIFPlay] appointed 2023 — former Belgium manager
    keyPlayers: 'Ronaldo (FW/CAP, Al Nassr — age 41), Bernardo Silva (AM, Man City), Rúben Dias (CB)',
    qualifyingNote: 'Qualified automatically — UEFA qualifying',
    debutFlag: false,
    guardrail: 'Cristiano Ronaldo is 41 years old and playing in Saudi Arabia. Whether he starts or is a squad player/substitute, his presence dominates narrative. Portugal have NEVER won the World Cup — their 2016 Euro and 2019 Nations League are separate trophies. Do NOT conflate.',
    narrativeNote: 'Ronaldo\'s extraordinary final chapter continues at 41. Bernardo Silva and Rúben Dias are the actual quality that drives Portugal\'s 2026 hopes. A final without Ronaldo in the spotlight would be a genuine surprise.',
  },
  UZB: {
    fifaCode: 'UZB', displayName: 'Uzbekistan', group: 'K',
    fifaRank: 50,          // [FIFA] April 2026
    wcAppearances: 1,      // 2026 is their FIRST appearance
    bestResult: 'First appearance 2026',
    manager: 'Fabio Cannavaro',  // [FIFPlay] appointed 2025 — former Italy World Cup winner
    keyPlayers: 'Khusanov (CB, Manchester City), Shorakhmatov (FW), Nasimov (CM)',
    qualifyingNote: 'Qualified via AFC — Asian qualifying',
    debutFlag: true,
    guardrail: null,
    narrativeNote: 'FIRST EVER World Cup appearance. Cannavaro (Italy\'s 2006 WC-winning captain and Ballon d\'Or winner) as manager. Abdukodir Khusanov (Manchester City) is their only player at a European top club.',
  },

  // ── GROUP L ──────────────────────────────────────────────────────────────────
  PAN: {
    fifaCode: 'PAN', displayName: 'Panama', group: 'L',
    fifaRank: 33,          // [FIFA] April 2026
    wcAppearances: 2,      // [Wiki] 2018, 2026
    bestResult: 'Group stage (2018)',
    manager: 'Thomas Christiansen', // [FIFPlay] appointed 2020 — Spanish-Danish
    keyPlayers: 'Fajardo (FW), Cooper (CM — CONCACAF staple), Davis (GK)',
    qualifyingNote: 'Qualified via CONCACAF — qualifying',
    debutFlag: false,
    guardrail: null,
    narrativeNote: 'Los Canaleros\' second World Cup (after a magical debut in 2018). Opening against England in New York — one of CONCACAF\'s landmark moments.',
  },
  ENG: {
    fifaCode: 'ENG', displayName: 'England', group: 'L',
    fifaRank: 4,           // [FIFA] April 2026
    wcAppearances: 16,     // [Wiki] 16 appearances including 2026
    bestResult: 'Champions 1966 (home, Wembley)',
    manager: 'Thomas Tuchel',    // [FIFPlay] appointed 2025 — former Bayern/Chelsea
    keyPlayers: 'Kane (FW/CAP, Bayern Munich), Bellingham (AM, Real Madrid), Saka (RW, Arsenal)',
    qualifyingNote: 'Qualified automatically — UEFA qualifying',
    debutFlag: false,
    guardrail: 'England\'s only World Cup title was in 1966 on HOME SOIL — 60 years ago. They have lost two European Championship finals in a row (2020 to Italy, 2024 to Spain). Tuchel replaced Southgate. "It\'s coming home" narrative is 60 years old. Frame the drought specifically.',
    narrativeNote: 'Tuchel\'s first tournament after replacing Southgate. Kane (31, Bayern Munich) in his prime. Bellingham at 22 is the most complete English midfielder since Scholes. The 60-year wait.',
  },
  CRO: {
    fifaCode: 'CRO', displayName: 'Croatia', group: 'L',
    fifaRank: 11,          // [FIFA] April 2026
    wcAppearances: 8,      // [Wiki] 8 appearances including 2026 (as independent nation since 1994)
    bestResult: 'Third place 1998, 2022. Runners-up 2018.',
    manager: 'Zlatko Dalić',     // [FIFPlay] appointed 2017 — unchanged since 2018
    keyPlayers: 'Modrić (CM/CAP, Real Madrid — age 40), Gvardiol (CB/LB, Man City), Kovačić (CM, Man City)',
    qualifyingNote: 'Qualified automatically — UEFA qualifying',
    debutFlag: false,
    guardrail: 'Luka Modrić is 40 years old at the tournament — the oldest outfield player expected to play a major role. This is almost certainly his final WC. Croatia HAVE been to the final (2018, lost 4-2 to France).',
    narrativeNote: 'Dalić unchanged since their 2018 final run. Modrić at 40 — still playing at Real Madrid — defies age in what is certainly his last World Cup. Gvardiol (Man City) is the next Croatian great.',
  },
  GHA: {
    fifaCode: 'GHA', displayName: 'Ghana', group: 'L',
    fifaRank: 74,          // [FIFA] April 2026
    wcAppearances: 4,      // [Wiki] 2006, 2010, 2014, 2026 (missed 2018, 2022)
    bestResult: 'Quarter-finals 2010 (Suárez handball)',
    manager: 'Otto Addo',        // [FIFPlay] appointed 2024 (second stint)
    keyPlayers: 'Kudus (FW/AM, West Ham), Partey (CM, Arsenal), Jordan Ayew (FW — veteran)',
    qualifyingNote: 'Qualified via CAF — Africa qualifying',
    debutFlag: false,
    guardrail: 'The Luis Suárez handball in 2010 quarter-final (Uruguay vs Ghana) — denying Ghana a historic semi-final — is iconic context if writing about Ghana. Suárez saved the shot with his hand, was red-carded, Uruguay won the subsequent penalty shootout. Ghana\'s most painful football memory.',
    narrativeNote: 'Mohammed Kudus (West Ham) is Africa\'s most exciting attacking talent at 24. Otto Addo back for a second stint after qualifying success. First WC since 2014.',
  },
};

// ── Detection ─────────────────────────────────────────────────────────────────
export function slateHasWorldCup(gameLines) {
  return gameLines.some(l => /FIFA World Cup|World Cup 2026/i.test(l));
}

// Extract WC games from journalism slate game lines
export function extractWCGames(gameLines) {
  return gameLines
    .filter(l => /FIFA World Cup|World Cup 2026/i.test(l))
    .map(l => {
      const isMD3  = /MD3\b/.test(l);
      const gMatch = l.match(/Group\s+([A-L])\b/i);
      const group  = gMatch ? gMatch[1].toUpperCase() : null;
      // Team name extraction — handles "vs", "@", ":" delimiters
      const teamMatch = l.match(/([\w\s\u00C0-\u024F]+?)\s+(?:vs\.?|@)\s+([\w\s\u00C0-\u024F]+?)(?:\s*[-·]|$)/);
      const home = teamMatch?.[1]?.trim().replace(/^.*:\s*/, '') || null;
      const away = teamMatch?.[2]?.trim() || null;
      return { home, away, group, isMD3 };
    })
    .filter(g => g.home && g.away);
}


// ── Advancement sentence generator ───────────────────────────────────────────
// Converts D1 standings rows into plain-English journalism sentences for the
// two teams in the current match. Injected as [WC ADVANCEMENT] in journalism
// prompts only — not surfaced in the standings UI.
//
// rows: sorted D1 result [{team, played, points, gd, gf, won, drawn, lost}]
// home/away: team display names matching rows[].team
// isMD3: boolean — final matchday (simultaneous kickoffs)
// Returns an array of 1-2 strings, one per team. Returns [] pre-tournament.
function _wcAdvancementSentences(rows, home, away, isMD3) {
  if (!rows || rows.length < 4) return [];
  const GAMES = 3, PTS_WIN = 3;
  const sentences = [];

  for (const teamName of [home, away]) {
    if (!teamName) continue;
    const idx = rows.findIndex(r => r.team === teamName);
    if (idx < 0) continue;
    const t = rows[idx];
    const remaining = GAMES - t.played;
    const maxPts = t.points + remaining * PTS_WIN;
    const secondPts = rows[1]?.points ?? 0;
    const thirdPts  = rows[2]?.points ?? 0;

    // Already guaranteed through
    if (t.points >= 6 && t.played <= 2) {
      sentences.push(`${teamName}: already through to the Round of 32 (${t.points} pts).`);
      continue;
    }
    // Mathematically eliminated
    if (idx === 3 && maxPts < secondPts) {
      sentences.push(`${teamName}: mathematically eliminated — ${t.points} pts, cannot reach ${secondPts} pts for 2nd.`);
      continue;
    }

    // Final matchday — explicit stakes
    if (isMD3) {
      if (idx <= 1) {
        const canBeOvertaken = thirdPts + PTS_WIN > t.points;
        if (canBeOvertaken) {
          sentences.push(`${teamName}: in the top 2 (${t.points} pts) but can be overtaken — cannot afford a heavy loss.`);
        } else {
          sentences.push(`${teamName}: secured top-2 going into final matchday (${t.points} pts).`);
        }
      } else if (idx === 2) {
        const gap = secondPts - t.points;
        if (gap === 0) {
          sentences.push(`${teamName}: level with 2nd place on ${t.points} pts — a win advances them; a draw depends on the parallel game.`);
        } else if (gap <= PTS_WIN) {
          sentences.push(`${teamName}: ${t.points} pts, ${gap} behind 2nd — must win; other group result also matters.`);
        } else {
          sentences.push(`${teamName}: ${t.points} pts — must win and needs help from the other Group game.`);
        }
      } else {
        sentences.push(`${teamName}: ${t.points} pts — must win and rely on results elsewhere; goal difference likely decisive.`);
      }
      continue;
    }

    // MD1 / MD2
    if (idx === 0 && t.points >= 4) {
      sentences.push(`${teamName}: top of Group with ${t.points} pts — a point from this match all but guarantees advancement.`);
    } else if (idx <= 1 && t.points >= 3) {
      sentences.push(`${teamName}: ${t.points} pts — in an advancing position but not yet secure.`);
    } else if (t.points >= 3) {
      sentences.push(`${teamName}: ${t.points} pts — a win puts them in firm control of advancement.`);
    } else if (t.points === 1) {
      sentences.push(`${teamName}: 1 pt — must win here; a draw leaves advancement dependent on final-game results.`);
    } else {
      sentences.push(`${teamName}: 0 pts — must win; a draw almost certainly ends their tournament.`);
    }
  }
  return sentences;
}

// ── Main injection function ────────────────────────────────────────────────────
// Async because it queries D1 for live standings (MD2+ only)
export async function buildWCTeamContextBlock(gameLines, d1db) {
  if (!slateHasWorldCup(gameLines)) return '';
  const games = extractWCGames(gameLines);
  if (!games.length) return '';

  const lines = [
    '',
    'WORLD CUP 2026 TEAM CONTEXT (verified facts — journalism must stay within this):',
  ];

  for (const game of games) {
    const homeCode = game.home ? WC_NAME_TO_CODE[game.home] : null;
    const awayCode = game.away ? WC_NAME_TO_CODE[game.away] : null;
    const homeCtx  = homeCode ? WC_TEAM_CONTEXT[homeCode] : null;
    const awayCtx  = awayCode ? WC_TEAM_CONTEXT[awayCode] : null;

    for (const ctx of [homeCtx, awayCtx]) {
      if (!ctx) continue;
      // Debut teams get the first-ever appearance opener
      const historyLine = ctx.debutFlag
        ? `FIRST EVER World Cup appearance for ${ctx.displayName} (${ctx.qualifyingNote}).`
        : `${ctx.displayName}: ${ctx.wcAppearances} WC appearances. Best: ${ctx.bestResult}.`;
      lines.push(`${ctx.displayName} (Group ${ctx.group}, FIFA #${ctx.fifaRank}): ${historyLine}`);
      lines.push(`  Manager: ${ctx.manager}. Key players: ${ctx.keyPlayers}.`);
      if (ctx.narrativeNote) lines.push(`  ${ctx.narrativeNote}`);
      if (ctx.guardrail)     lines.push(`  [GUARDRAIL] ${ctx.guardrail}`);
    }

    // D1 live standings — only query if D1 available and group known
    if (d1db && game.group) {
      try {
        const { results: rows } = await d1db.prepare(
          `SELECT team, played, points, gd, gf, won, drawn, lost
           FROM wc_group WHERE group_id = ?
           ORDER BY points DESC, gd DESC, gf DESC`
        ).bind(game.group).all();
        if (rows && rows.length >= 2) {
          const tableStr = rows.map((r, i) =>
            `${i + 1}. ${r.team} ${r.points}pts (P${r.played} GD${r.gd >= 0 ? '+' : ''}${r.gd})`
          ).join(' | ');
          lines.push(`  Group ${game.group} current standings: ${tableStr}`);
          if (game.isMD3) {
            lines.push(`  [FINAL MATCHDAY] Both Group ${game.group} games kick off simultaneously (FIFA anti-collusion rule). Top 2 advance automatically. 3rd place may advance as one of the 8 best third-place teams.`);
          }

          // Advancement sentences — one per team in this match, for journalism
          // Only generated when games have been played (MD1+)
          const hasResults = rows.some(r => r.played > 0);
          if (hasResults) {
            const advLines = _wcAdvancementSentences(rows, game.home, game.away, game.isMD3);
            if (advLines.length) {
              lines.push(`  [WC ADVANCEMENT]`);
              for (const s of advLines) lines.push(`  ${s}`);
            }
          }
        }
      } catch (_) {
        // D1 unavailable — static context still injected, degrade gracefully
      }
    }

    lines.push('');
  }

  // Note on rankings currency
  lines.push('Note: FIFA rankings as of April 1 2026. Updated June 9 2026 (day before tournament).');
  return lines.join('\n');
}
