// Rule 90 for the dead-pair ledger. It decides what NOT to buy, so the two
// ways of being wrong are both expensive: re-buying a pair that cannot pay
// (20 credits each time, forever) and permanently locking out a pair that a
// matcher fix would recover.
import { createRequire } from 'node:module';
const MOD = process.env.DEAD_PAIRS_MODULE || './lib/dead-pairs.cjs';
const { classifyPair, stillDead, excludeDead, pairKey, kindOf } = createRequire(import.meta.url)(MOD);

let bad = 0, n = 0;
const eq = (label, got, want) => { n++;
  if (JSON.stringify(got) === JSON.stringify(want)) console.log(`ok    ${label}`);
  else { bad++; console.log(`FAIL  ${label}\n        got  ${JSON.stringify(got)}\n        want ${JSON.stringify(want)}`); } };

// ── THE TEN REAL PAIRS, from outbox/targeted-odds-fill-20260919T032609Z.log ──
// Not invented fixtures. Every one of these lines was bought for 20 credits.
const LIVE = [
  ['2026-09-05 cfb',     { events: 158, inWindow: 71, priced: 67, wanted: 68 }, 'partial'],
  ['2026-08-08 efl cup', { events: 31,  inWindow: 30, priced: 29, wanted: 29 }, 'complete'],
  ['2026-08-25 efl cup', { events: 23,  inWindow: 21, priced: 17, wanted: 17 }, 'complete'],
  ['2026-09-12 cfb',     { events: 95,  inWindow: 80, priced: 0,  wanted: 13 }, 'priced-zero'],
  ['2026-09-13 nfl',     { events: 212, inWindow: 13, priced: 13, wanted: 13 }, 'complete'],
  ['2026-09-03 cfb',     { events: 156, inWindow: 14, priced: 8,  wanted: 11 }, 'partial'],
  ['2026-05-24 la liga', { events: 1,   inWindow: 1,  priced: 1,  wanted: 10 }, 'vendor-exhausted'],
  ['2026-08-22 nfl',     { events: 272, inWindow: 0,  priced: 0,  wanted: 10 }, 'none-in-window'],
  ['2026-08-28 nfl',     { events: 272, inWindow: 0,  priced: 0,  wanted: 10 }, 'none-in-window'],
  ['2026-08-29 cfb',     { events: 111, inWindow: 8,  priced: 8,  wanted: 8  }, 'complete'],
];
for (const [name, o, want] of LIVE) eq(`${name} -> ${want}`, classifyPair(o), want);

// THE DISTINCTION THE WHOLE FILE TURNS ON. 2026-09-12 cfb had 80 events in
// window and priced none: our reading failed, their data did not. Filing it
// with the two NFL pairs would lock out the one class a matcher fix recovers.
eq('priced-zero is NOT the same class as none-in-window',
  classifyPair({ events: 95, inWindow: 80, priced: 0, wanted: 13 }) !== classifyPair({ events: 272, inWindow: 0, priced: 0, wanted: 10 }), true);

// An unused in-window event is a game a better matcher could still reach, so
// the pool is only exhausted when none are left over.
eq('leftover in-window events mean the pool is NOT exhausted',
  classifyPair({ events: 50, inWindow: 9, priced: 5, wanted: 8 }), 'partial');
eq('...and no leftovers means it is',
  classifyPair({ events: 50, inWindow: 5, priced: 5, wanted: 8 }), 'pool-exhausted');

// A COUNTING FACT, NOT A MATCHING ONE. 2026-05-24 la liga returned ONE event
// against ten wanted games. No matcher reaches the other nine, because there is
// nothing to reach — so this is a VENDOR class and survives a matcher change,
// unlike pool-exhausted which is about which in-window events we used.
eq('the vendor returning fewer events than the remainder is vendor-exhausted',
  classifyPair({ events: 1, inWindow: 1, priced: 1, wanted: 10 }), 'vendor-exhausted');
eq('...and it is a VENDOR class, so a matcher fix does not revive it',
  kindOf('vendor-exhausted'), 'vendor');
eq('a vendor-exhausted exclusion survives a new matcher',
  stillDead({ klass: 'vendor-exhausted', params_fp: 'us|h2h,totals|12', matcher_fp: 'OLD' },
            { params_fp: 'us|h2h,totals|12', matcher_fp: 'NEW' }), true);
// The generous ceiling: `events` is the whole snapshot, wider than our date.
// 2026-08-22 nfl returned 272 events with none in window — plenty of events,
// so it is NOT vendor-exhausted and stays matcher-dependent.
eq('plenty of events but none in window is NOT vendor-exhausted',
  classifyPair({ events: 272, inWindow: 0, priced: 0, wanted: 10 }), 'none-in-window');
eq('exactly enough events is not exhaustion either',
  classifyPair({ events: 5, inWindow: 0, priced: 0, wanted: 5 }), 'none-in-window');
// THE CEILING IS AGAINST THE REMAINDER, NOT THE WHOLE ASK. Nine events, ten
// games wanted, eight already priced: only two are left to find and nine
// events remain available, so nothing is exhausted. Comparing events against
// `wanted` instead of `wanted - priced` calls this unfillable and retires a
// pair that still has reachable games — and no real pair in the fill log
// separates the two readings, so this fixture exists to.
eq('the ceiling is measured against what is LEFT, not against the whole ask',
  classifyPair({ events: 9, inWindow: 9, priced: 8, wanted: 10 }), 'partial');
eq('a vendor with nothing at all is no-events, not none-in-window',
  classifyPair({ events: 0, inWindow: 0, priced: 0, wanted: 4 }), 'no-events');
eq('a pair that got everything is complete even if it overshoots',
  classifyPair({ events: 9, inWindow: 9, priced: 9, wanted: 8 }), 'complete');

// Refusals. An unreadable attempt must not become a dead pair (Rule 99):
// excluding on garbage would spend nothing and buy nothing, silently.
for (const [label, o] of [
  ['a missing field', { events: 1, inWindow: 1, priced: 1 }],
  ['a negative count', { events: -1, inWindow: 0, priced: 0, wanted: 3 }],
  ['a non-numeric count', { events: '272', inWindow: 0, priced: 0, wanted: 10 }],
  ['nothing at all', null],
  ['a pair wanting no games', { events: 5, inWindow: 5, priced: 0, wanted: 0 }],
]) eq(`${label} is unknown, never a dead class`, classifyPair(o), 'unknown');

// ── stillDead: the expiry that makes this safe to build ────────────────────
const NOW = { params_fp: 'us|h2h,totals|12', matcher_fp: 'aaa111' };
const row = (klass, p = NOW.params_fp, m = NOW.matcher_fp) => ({ klass, params_fp: p, matcher_fp: m });

eq('a vendor-empty pair stays dead', stillDead(row('no-events'), NOW), true);
eq('...and stays dead even when the matcher changes — their data is not our code',
  stillDead(row('no-events', NOW.params_fp, 'DIFFERENT'), NOW), true);
eq('...but not when the REQUEST changes: different markets is a different question',
  stillDead(row('no-events', 'us|h2h|12'), NOW), false);

eq('A MATCHER-DEPENDENT EXCLUSION EXPIRES WHEN THE MATCHER CHANGES',
  stillDead(row('priced-zero', NOW.params_fp, 'DIFFERENT'), NOW), false);
eq('...and so does none-in-window, because the window rule lives in matchSlate',
  stillDead(row('none-in-window', NOW.params_fp, 'DIFFERENT'), NOW), false);
eq('...and pool-exhausted', stillDead(row('pool-exhausted', NOW.params_fp, 'DIFFERENT'), NOW), false);
eq('an unchanged matcher keeps them dead', stillDead(row('priced-zero'), NOW), true);

eq('a partial pair is never excluded — it still has games to buy',
  stillDead(row('partial'), NOW), false);
eq('nor is a complete one', stillDead(row('complete'), NOW), false);
eq('nor an unknown one', stillDead(row('unknown'), NOW), false);
eq('a missing row excludes nothing', stillDead(null, NOW), false);
eq('a missing fingerprint excludes nothing', stillDead(row('no-events'), null), false);

// ── excludeDead ────────────────────────────────────────────────────────────
const PLAN = [
  { sport: 'nfl', date: '2026-08-22', games: [1,2,3,4,5,6,7,8,9,10] },
  { sport: 'cfb', date: '2026-09-12', games: [1,2,3,4,5,6,7,8,9,10,11,12,13] },
  { sport: 'cfb', date: '2026-09-05', games: [1] },
];
const LEDGER = [
  { sport: 'nfl', date: '2026-08-22', klass: 'none-in-window', ...NOW },
  { sport: 'cfb', date: '2026-09-12', klass: 'priced-zero',    ...NOW },
  { sport: 'cfb', date: '2026-09-05', klass: 'partial',        ...NOW },
];
eq('both dead pairs are dropped and the live one kept',
  excludeDead(PLAN, LEDGER, NOW, 20).kept.map(p => `${p.date} ${p.sport}`), ['2026-09-05 cfb']);
eq('the saving is reported in credits, not in pairs',
  excludeDead(PLAN, LEDGER, NOW, 20).creditsSaved, 40);
eq('each skip names its class, so a reader can tell a vendor gap from our bug',
  excludeDead(PLAN, LEDGER, NOW, 20).skipped.map(s => s.klass), ['none-in-window', 'priced-zero']);
eq('A NEW MATCHER RESTORES THE MATCHER-DEPENDENT PAIRS',
  excludeDead(PLAN, LEDGER, { ...NOW, matcher_fp: 'bbb222' }, 20).kept.length, 3);
eq('an empty ledger excludes nothing', excludeDead(PLAN, [], NOW, 20).kept.length, 3);
eq('a missing ledger excludes nothing', excludeDead(PLAN, null, NOW, 20).kept.length, 3);
eq('sport matching ignores case, since the plan lowercases and the log does not',
  excludeDead([{ sport: 'NFL', date: '2026-08-22', games: [1] }], LEDGER, NOW, 20).kept.length, 0);
eq('the key pairs date and sport, not one of them',
  pairKey('nfl', '2026-08-22') === pairKey('nfl', '2026-08-28'), false);

console.log(`\n${n - bad} of ${n} passed.`);
console.log('COVERAGE: classifyPair, stillDead and excludeDead — 1 file. It does NOT');
console.log('check that the fill script records or reads the ledger, and it cannot');
console.log('know whether a pair the vendor once had nothing for will stay that way.');
process.exit(bad ? 1 : 0);
