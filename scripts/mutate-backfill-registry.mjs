#!/usr/bin/env node
// Rule 90 for the registry-unification guard. Each mutation is a way the fourth
// registry could come back, or the lookup could lose a sport, and each must be
// rejected by a NAMED failure — not merely by a non-zero exit.
//
// The structural half runs offline. The reachability half needs D1, so this
// harness asserts only on the parts that do not, and says so (Rule 91).
//
// Anchor discipline as in mutate-slate-settle.mjs: exactly-one-match asserted,
// the replacement confirmed on disk, `git checkout --` to restore. A NOT CAUGHT
// with nothing mutated is worse than no test.

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';

const BACKFILL = '.github/scripts/odds-backfill.js';
const KEYS     = 'src/odds-sport-keys.js';
const sh = (c, a) => execFileSync(c, a, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

for (const f of [BACKFILL, KEYS]) {
  const dirty = sh('git', ['status', '--porcelain', '--', f]).trim();
  if (dirty) { console.error(`FAIL — ${f} is dirty; refusing to mutate.\n${dirty}`); process.exit(1); }
}

// The structural assertions, lifted by running the real check's own function
// against a mutated tree. Importing the check runs its D1 half, so the
// structural predicate is exercised through a tiny inline re-read instead —
// and that re-read is itself asserted to agree with the check's source below.
const PREDICATES = [
  [/const\s+SPORT_TO_ODDS_KEY\s*=\s*\{/,          'private SPORT_TO_ODDS_KEY literal is back'],
  [/const\s+\w*EXTRA_SPORT_KEYS\s*=\s*\{/,        'local EXTRA_SPORT_KEYS literal is back'],
];
const IMPORT_RE = /import\s*\{[^}]*backfillSportToOddsKey[^}]*\}\s*from\s*'\.\.\/\.\.\/src\/odds-sport-keys\.js'/;

// Guard against this harness drifting from the check it stands in for.
const checkSrc = fs.readFileSync('scripts/check-backfill-registry-coverage.mjs', 'utf8');
for (const [re] of PREDICATES) {
  if (!checkSrc.includes(re.source.replace(/\\\\/g, '\\'))) {
    console.error(`FAIL — harness predicate /${re.source}/ is not in the check. They have drifted.`);
    process.exit(1);
  }
}
if (!checkSrc.includes(IMPORT_RE.source.replace(/\\\\/g, '\\'))) {
  console.error('FAIL — harness import predicate is not in the check. They have drifted.');
  process.exit(1);
}

function structuralProblems() {
  const src = fs.readFileSync(BACKFILL, 'utf8');
  const out = [];
  for (const [re, label] of PREDICATES) if (re.test(src)) out.push(label);
  if (!IMPORT_RE.test(src)) out.push('canonical import missing');
  return out;
}

async function reaches(sport) {
  const url = `../${KEYS}?bust=${Date.now()}${Math.random()}`;
  const m = await import(url);
  return !!m.backfillSportToOddsKey(sport);
}

const MUTATIONS = [
  { file: BACKFILL, name: 'B1  the private registry is pasted back in',
    anchor: "const NON_GAME_BRIEF_TYPES = new Set(['narrative_context', 'standings_snapshot']);",
    replace: "const SPORT_TO_ODDS_KEY = {\n  'MLB': 'baseball_mlb',\n};\nconst NON_GAME_BRIEF_TYPES = new Set(['narrative_context', 'standings_snapshot']);",
    expect: 'private SPORT_TO_ODDS_KEY literal is back', kind: 'structural' },

  { file: BACKFILL, name: 'B2  the canonical import is dropped',
    anchor: "import { backfillSportToOddsKey } from '../../src/odds-sport-keys.js';",
    replace: "// import removed",
    expect: 'canonical import missing', kind: 'structural' },

  { file: BACKFILL, name: 'B3  a local EXTRA_SPORT_KEYS copy reappears',
    anchor: "const NON_GAME_BRIEF_TYPES = new Set(['narrative_context', 'standings_snapshot']);",
    replace: "const EXTRA_SPORT_KEYS = { 'x': 'y' };\nconst NON_GAME_BRIEF_TYPES = new Set(['narrative_context', 'standings_snapshot']);",
    expect: 'local EXTRA_SPORT_KEYS literal is back', kind: 'structural' },

  { file: KEYS, name: 'B4  cfb is removed from ARCHIVE — the original defect',
    anchor: "  cfb:        'americanfootball_ncaaf',\n",
    replace: '',
    expect: 'CFB no longer reachable', kind: 'reach', sport: 'CFB' },

  { file: KEYS, name: 'B5  the World Cup aliases are lost in the swap',
    anchor: "  'fifa world cup':      'soccer_fifa_world_cup',\n  'fifa world cup 2026': 'soccer_fifa_world_cup',",
    replace: '',
    expect: 'FIFA World Cup no longer reachable', kind: 'reach', sport: 'FIFA World Cup' },

  { file: KEYS, name: 'B7  UCL is dropped from the backfill extras',
    anchor: "  'uefa champions league': 'soccer_uefa_champs_league',\n",
    replace: '',
    expect: 'UEFA Champions League no longer reachable', kind: 'reach', sport: 'UEFA Champions League' },

  { file: KEYS, name: 'B6  the lookup stops being case-insensitive',
    anchor: "  return ARCHIVE_SPORT_TO_ODDS_KEY[String(sport).toLowerCase()] || null;",
    replace: "  return ARCHIVE_SPORT_TO_ODDS_KEY[sport] || null;",
    expect: 'uppercase CFB from the sport column no longer resolves', kind: 'reach', sport: 'CFB' },
];

let caught = 0;
for (const mut of MUTATIONS) {
  const original = fs.readFileSync(mut.file, 'utf8');
  const hits = original.split(mut.anchor).length - 1;
  if (hits !== 1) {
    console.log(`FAIL  ${mut.name}\n        anchor matched ${hits} times, expected 1 — nothing mutated.`);
    continue;
  }
  fs.writeFileSync(mut.file, original.replace(mut.anchor, mut.replace));
  if (fs.readFileSync(mut.file, 'utf8') === original) {
    console.log(`FAIL  ${mut.name}\n        file unchanged after write — nothing mutated.`);
    sh('git', ['checkout', '--', mut.file]);
    continue;
  }

  let red = false;
  if (mut.kind === 'structural') red = structuralProblems().includes(mut.expect);
  else red = !(await reaches(mut.sport));

  sh('git', ['checkout', '--', mut.file]);
  console.log(`${red ? 'CAUGHT     ' : 'NOT CAUGHT '} ${mut.name}\n            (${mut.expect})`);
  if (red) caught++;
}

console.log(`\n${caught} of ${MUTATIONS.length} mutations caught.`);
console.log(`COVERAGE: exercises the structural guard and the reachability lookup.`);
console.log(`The D1 cost-projection half of the check is NOT mutated here — it needs`);
console.log(`the live archive, and runs in backfill-registry-coverage.yml.`);
process.exit(caught === MUTATIONS.length ? 0 : 1);
