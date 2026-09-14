#!/usr/bin/env node
// Rule 90 for src/collision-reach.js — the three predicates that decide the
// same-slate collision watch condition.
//
// THE REASON THIS FILE EXISTS is that both previous versions of these
// predicates shipped broken from inside the route body, where nothing could
// run them. Every assertion here has a mutation in
// scripts/mutate-collision-reach.mjs.
import { oddsDigest, twoRealGames, oddsDisagree, reachableCollisions }
  from '../src/collision-reach.js';

let checked = 0, failed = 0;
const eq = (name, got, want) => {
  checked++;
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failed++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok ? '' : `\n        got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`}`);
};

const g = (o = {}) => ({ opening_odds_digest: null, closing_odds_digest: null,
                         espn_event_id: null, ...o });
const c = (x, y) => ({ games: [x, y] });

// ── oddsDigest ─────────────────────────────────────────────────────────────
eq('a null column has no digest', oddsDigest(null), null);
eq('and undefined is the same', oddsDigest(undefined), null);
// THE ONE PROPERTY THE CONDITION RESTS ON. If different values could collide,
// two rows holding different lines would read as agreeing and the watch would
// call a live false fact inert.
eq('different values digest differently',
   oddsDigest('{"h":-110}') === oddsDigest('{"h":-115}'), false);
eq('identical values digest identically',
   oddsDigest('{"h":-110}') === oddsDigest('{"h":-110}'), true);
// An object and its serialisation must not be treated as different things —
// the D1 column may come back either way depending on the driver.
eq('an object digests as its JSON', oddsDigest({ h: -110 }), oddsDigest('{"h":-110}'));
// A digest is never the empty string, which would be falsy and collapse into
// null at any `|| null` site downstream.
eq('a digest is 8 hex characters', /^[0-9a-f]{8}$/.test(oddsDigest('x')), true);

// ── twoRealGames ───────────────────────────────────────────────────────────
eq('two different ESPN ids is a doubleheader',
   twoRealGames(c(g({ espn_event_id: '1' }), g({ espn_event_id: '2' }))), true);
// THE HALF-TRUTH PAIR, which is the population the whole cleanup is about. One
// row carries the anchor and the other does not; treating that as two real
// games would exclude all 32 from the condition and from every fix.
eq('one id and one absent is NOT a doubleheader',
   twoRealGames(c(g({ espn_event_id: '1' }), g())), false);
eq('the same id twice is NOT a doubleheader',
   twoRealGames(c(g({ espn_event_id: '1' }), g({ espn_event_id: '1' }))), false);
eq('neither carrying an id is NOT a doubleheader', twoRealGames(c(g(), g())), false);
eq('a malformed collision does not throw', twoRealGames({}), false);

// ── oddsDisagree ───────────────────────────────────────────────────────────
eq('neither row carrying odds is agreement', oddsDisagree(c(g(), g())), false);
eq('one line against none is disagreement',
   oddsDisagree(c(g({ opening_odds_digest: 'aa' }), g())), true);
eq('the same line on both rows is agreement',
   oddsDisagree(c(g({ opening_odds_digest: 'aa' }), g({ opening_odds_digest: 'aa' }))), false);
// THE CASE A BOOLEAN CANNOT SEE, and the reason the digest is in the response
// at all. Both rows would read has_opening_odds:true.
eq('two DIFFERENT lines is disagreement',
   oddsDisagree(c(g({ opening_odds_digest: 'aa' }), g({ opening_odds_digest: 'bb' }))), true);
// Both columns are read, not just the first.
eq('a closing-only disagreement still counts',
   oddsDisagree(c(g({ opening_odds_digest: 'aa', closing_odds_digest: 'cc' }),
                  g({ opening_odds_digest: 'aa' }))), true);
// undefined and null are the same absence — the detail projection sets one, a
// row missing from the detail map has the other.
eq('undefined and null are the same absence',
   oddsDisagree(c({ opening_odds_digest: undefined, closing_odds_digest: undefined },
                  g())), false);

// ── reachableCollisions ────────────────────────────────────────────────────
const DH = c(g({ espn_event_id: '1', opening_odds_digest: 'aa' }), g({ espn_event_id: '2' }));
const HALF = c(g({ opening_odds_digest: 'aa' }), g({ espn_event_id: '9' }));
const AGREE = c(g(), g());
eq('only the disagreeing pair is reachable',
   reachableCollisions([DH, HALF, AGREE], null).length, 1);
eq('and it is the half-truth pair, not the doubleheader',
   reachableCollisions([DH, HALF, AGREE], null)[0], HALF);
// RULE 99. Absence is not zero: with the detail read failed every digest is
// undefined, every pair looks like agreement, and the condition would close on
// data nobody read.
eq('a failed detail read makes EVERY collision reachable',
   reachableCollisions([DH, HALF, AGREE], 'D1_ERROR: no such column').length, 3);
eq('and it does not hand back the caller’s own array',
   reachableCollisions([DH], 'boom') === undefined, false);
const src = [DH, HALF, AGREE];
eq('the failed-read path copies rather than aliases',
   reachableCollisions(src, 'boom') === src, false);

console.log(`\n${failed ? 'FAILED' : 'PASS'}: ${checked - failed}/${checked} assertions`
          + ` — digest, doubleheader, disagreement, Rule 99 fallback`);
process.exit(failed ? 1 : 0);
