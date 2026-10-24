// Joining a vendor odds payload to archive rows.
//
// EXTRACTED SO IT CAN BE TESTED AGAINST ITSELF. The first version of
// scripts/check-ambiguous-team-identity.mjs re-implemented this logic inline to
// exercise it, and a mutation that broke the REAL function left that check
// green — it was asserting against a copy. Extracting the two functions is what
// makes the check able to import the thing it claims to verify.
import { resolveTeamKey, resolveTeamKeyIn } from './identity-resolver.js';
import { nameMatches, kickoffGapMinutes, CONTESTED_KICKOFF_MINUTES } from './odds-name-match.js';

// Index a vendor odds payload for joining, and keep the set of team keys it
// contains.
//
// THE SET IS THE POINT. This pattern was written out three times — live cron,
// historical backfill, /archive/game — and all three resolved the D1 row's names
// with no idea what the payload held. That is what made `Tigers` unanswerable:
// the name means Detroit in a baseball payload and Hull City in a football one,
// and the join had the payload in hand the whole time without consulting it.
//
// The vendor sends unambiguous full names, one sport per response, and it is
// resolved FIRST. So by the time a D1 name needs a meaning, the answer is
// already sitting in `vendorKeys`. See resolveTeamKeyIn.
//
// THE EVENTS ARE KEPT WHOLE, NOT KEYED BY PAIR. A pair map kept the LAST event
// listed for a pairing, so a feed listing a series or a doubleheader priced a
// row from whichever game came last (docs/CC-CMD-2026-10-21-historical-closing-
// join-misses-four-sports.md).
export function indexOddsByPair(games) {
  const events = [], vendorKeys = new Set();
  for (const g of games || []) {
    // Centralised identity resolution: same canonical key from either side
    // (Odds-API name OR D1 name) — handles aliases (Brighton & Hove Albion,
    // Aces, Athletics, Türkiye, …).
    const hk = resolveTeamKey(g.home_team), ak = resolveTeamKey(g.away_team);
    vendorKeys.add(hk); vendorKeys.add(ak);
    events.push(g);
  }
  return { events, vendorKeys };
}

// Find a D1 row's game in an indexed payload, resolving each side against the
// payload's own keys so an ambiguous name resolves to the team this sport
// actually fielded — or to nothing, never to the other sport's team.
//
// PER TEAM, THE RULE AMBIENTDO'S CLOSING CAPTURE ALREADY RUNS, AS LISTED. Matching
// the whole pair on resolved keys found 0 of 112 NBA, NHL, CFB and NFL games:
// the archive stores 'Capitals', 'Knicks', 'Missouri St', the vendor
// 'Washington Capitals', and no alias joins them. So a side matches on its
// resolved key OR on its name tokens (nameMatches), the vendor event must start
// within CONTESTED_KICKOFF_MINUTES of the row's kickoff, and exactly one event
// may qualify: two is ambiguity and is refused, never guessed. Replayed on the
// 112 recorded pairs: 110 right, 0 wrong.
//
// ONLY AS LISTED, NOT REVERSED. Each row is decided alone, so a reversed match
// cannot see that another row owns the event as listed: a split-squad pair
// (the same two clubs, the same instant, one game in each city; three NHL
// preseason pairs in the archive) had one listing price both rows, one of them
// from the other city's game (adversarial review, 2026-10-24). Reversed
// listings gained 1 row in 768 recorded pairs; the CI backfill's matcher,
// which sees the whole slate, still fills it.
//
// A ROW WITH NO READABLE KICKOFF GETS HEAD'S RULE, NOT THIS ONE. Without an
// instant there is no window, so only the resolved key matches, only as listed,
// and still only once. Cup rows filed as MLS carry no start_time and their own
// games are never in the MLS feed; name tokens alone would price them from a
// league fixture of the same clubs weeks away.
export function findOddsForRow(index, home, away, startTime = null) {
  const keyed = (archiveName, vendorName) =>
    resolveTeamKeyIn(archiveName, index.vendorKeys) === resolveTeamKey(vendorName);
  const judged = Number.isFinite(Date.parse(startTime ?? ''));
  const same = judged ? (a, v) => keyed(a, v) || nameMatches(a, v) : keyed;
  const near = !judged ? index.events : index.events.filter(e => {
    const gap = kickoffGapMinutes({ start_time: startTime }, e);
    return gap !== null && Math.abs(gap) <= CONTESTED_KICKOFF_MINUTES;
  });
  const hits = near.filter(e => same(home, e.home_team) && same(away, e.away_team));
  return hits.length === 1 ? hits[0] : undefined;
}

