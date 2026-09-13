// Joining a vendor odds payload to archive rows.
//
// EXTRACTED SO IT CAN BE TESTED AGAINST ITSELF. The first version of
// scripts/check-ambiguous-team-identity.mjs re-implemented this logic inline to
// exercise it, and a mutation that broke the REAL function left that check
// green — it was asserting against a copy. Extracting the two functions is what
// makes the check able to import the thing it claims to verify.
import { resolveTeamKey, resolveTeamKeyIn } from './identity-resolver.js';

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
export function indexOddsByPair(games) {
  const byPair = new Map(), vendorKeys = new Set();
  for (const g of games || []) {
    // Centralised identity resolution: same canonical key from either side
    // (Odds-API name OR D1 name) — handles aliases (Brighton & Hove Albion,
    // Aces, Athletics, Türkiye, …).
    const hk = resolveTeamKey(g.home_team), ak = resolveTeamKey(g.away_team);
    vendorKeys.add(hk); vendorKeys.add(ak);
    byPair.set(`${hk}|${ak}`, g);
  }
  return { byPair, vendorKeys };
}

// Find a D1 row's game in an indexed payload, resolving each side against the
// payload's own keys so an ambiguous name resolves to the team this sport
// actually fielded — or to nothing, never to the other sport's team.
export function findOddsForRow(index, home, away) {
  const hk = resolveTeamKeyIn(home, index.vendorKeys);
  const ak = resolveTeamKeyIn(away, index.vendorKeys);
  return index.byPair.get(`${hk}|${ak}`);
}

