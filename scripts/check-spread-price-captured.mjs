#!/usr/bin/env node
// The spread must carry the price that gives its point a meaning.
//
// CC-CMD-2026-08-25-spread-price-capture, step 4. extractOddsForGame stored
// `{home: h.point, away: h.point}` and threw `o.price` away, and the point on
// its own does NOT say who is favoured. Measured 2026-08-26 through the relay's
// own /odds proxy (scripts/odds-spread-shape-probe.mjs):
//
//   Red Sox @ Marlins   home +1.5 at -371   home is the FAVOURITE
//   Brewers @ Mets      home +1.5 at  +101  home is the UNDERDOG
//
// Both fixtures below are those two markets, verbatim from
// outbox/odds-spread-shape-20260826T002201Z.json — not invented, because an
// invented fixture tests the shape I imagined rather than the one served.
//
// This exercises the REAL spreadFrom out of src/odds-shape.js. A second copy
// here would be a check that agrees with itself.

import { spreadFrom } from '../src/odds-shape.js';

const SELF_TEST = process.argv.includes('--self-test');
let failed = 0;
const check = (label, ok, detail = '') => {
  if (ok) console.log(`PASS  ${label}`);
  else { console.log(`FAIL  ${label}${detail ? `\n      → ${detail}` : ''}`); failed++; }
};

// Verbatim from the probe artifact.
const MARLINS_HOME = { name: 'Miami Marlins', price: -371, point: 1.5 };
const REDSOX_AWAY  = { name: 'Boston Red Sox', price: 262, point: -1.5 };
const METS_HOME    = { name: 'New York Mets', price: 101, point: 1.5 };
const BREWERS_AWAY = { name: 'Milwaukee Brewers', price: -132, point: -1.5 };

// ── THE CONTRACT ────────────────────────────────────────────────────────────
const favouriteHome = spreadFrom(MARLINS_HOME, REDSOX_AWAY);
const underdogHome  = spreadFrom(METS_HOME, BREWERS_AWAY);

check('a matched spread carries a finite price on BOTH sides',
  Number.isFinite(favouriteHome?.homePrice) && Number.isFinite(favouriteHome?.awayPrice),
  JSON.stringify(favouriteHome));

check('point and away point survive unchanged — the capture is additive',
  favouriteHome.home === 1.5 && favouriteHome.away === -1.5,
  JSON.stringify(favouriteHome));

// The reason the whole ask exists. If these two ever compare equal, the price
// is not being read and the point is back to being the only signal.
check('the same +1.5 is distinguishable as favourite vs underdog',
  favouriteHome.home === underdogHome.home && favouriteHome.homePrice !== underdogHome.homePrice,
  `${JSON.stringify(favouriteHome)} vs ${JSON.stringify(underdogHome)}`);

check('and the sign of the price says which: -371 favourite, +101 underdog',
  favouriteHome.homePrice < 0 && underdogHome.homePrice > 0);

// ── A MARKET WITH NO SPREADS MUST GAIN NEITHER (the CC-CMD's own words) ─────
check('no home outcome yields no spread at all',
  spreadFrom(null, REDSOX_AWAY) === null);
check('no away outcome yields no spread at all',
  spreadFrom(MARLINS_HOME, undefined) === null);
check('neither outcome yields no spread at all',
  spreadFrom(null, null) === null);

// ── A PRICE IS OMITTED, NOT NULLED, WHEN THE BOOK DOES NOT SERVE ONE ───────
// An absent key and a captured one must stay distinguishable in the archive.
// null would read as "no price served" and as "we did not look" at once.
const noPrice = spreadFrom({ point: 1.5 }, { point: -1.5 });
check('a missing price is omitted, not written as null',
  noPrice !== null && !('homePrice' in noPrice) && !('awayPrice' in noPrice),
  JSON.stringify(noPrice));
check('...and the point still survives when the price does not',
  noPrice.home === 1.5 && noPrice.away === -1.5);

const onePrice = spreadFrom(MARLINS_HOME, { point: -1.5 });
check('one side priced captures that side only',
  onePrice.homePrice === -371 && !('awayPrice' in onePrice),
  JSON.stringify(onePrice));

// A string price is not a price. The Odds API serves numbers; anything else is
// a shape change and must not be stored as though it were adjudicable.
check('a non-numeric price is not captured',
  !('homePrice' in spreadFrom({ point: 1.5, price: '-371' }, { point: -1.5 })));

// ── THE DETECTOR CATCHES THE ORIGINAL MISTAKE ──────────────────────────────
// Without this, a guard that passed on a reverted spreadFrom would be worthless.
const theOldWay = (h, a) => (h && a ? { home: h.point, away: a.point } : null);
const old = theOldWay(MARLINS_HOME, REDSOX_AWAY);
check('the check would fail on the pre-fix implementation',
  !Number.isFinite(old.homePrice),
  'the old shape passed the price assertion — this guard proves nothing');

// ── AND THE CALL SITE ACTUALLY USES IT ─────────────────────────────────────
// spreadFrom being correct is worth nothing if extractOddsForGame still builds
// the object inline. Rule 63: every function must have a caller.
const { readFileSync } = await import('node:fs');
const idx = readFileSync(new URL('../src/index.js', import.meta.url), 'utf8');
check('src/index.js imports spreadFrom',
  /import \{[^}]*\bspreadFrom\b[^}]*\} from '\.\/odds-shape\.js'/.test(idx));
check('...and applies it to the spreads outcomes inside extractOddsForGame',
  /const sp = spreadFrom\(h, a\);\s*\n\s*if \(sp\) out\.spread = sp;/.test(idx));
check('...and no longer builds the spread inline',
  !/out\.spread = \{ home: h\.point, away: a\.point \}/.test(idx),
  'the inline construction is still there — the import may be dead');

console.log(`\n${failed === 0 ? 'PASS' : 'FAIL'}  spread price capture: ${failed} failing check(s)`);
process.exit(failed === 0 ? 0 : 1);
