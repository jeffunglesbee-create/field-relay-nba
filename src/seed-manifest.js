// Every competition the relay is CONFIGURED to fetch is one of exactly three
// declared things. None of them is silence.
//
// WHY THIS EXISTS — CC-CMD-2026-08-21-archive-seed-coverage, asks 1 and 2.
//
// `V2_LEAGUES` says what the relay can FETCH. The journalism cron's `LEAGUES`
// table says what it ARCHIVE-WRITES, and `/context/date` reads ONLY the archive.
// A competition in the first and not the second is reachable on demand and never
// persisted — so it never appears on a date page, and nothing anywhere says that
// is deliberate.
//
// That gap has been found twice by a human pointing at ESPN. The six UEFA club
// competitions (CC-CMD-2026-08-20-uefa-club-competitions) were in V2_LEAGUES with
// slugs and BSD ids, so `/v2/games?sport=ucl` worked, while `/context/date/2026-08-19`
// listed 49 games with no Champions League among them. The config looked correct.
//
// A competition may be seeded. It may be excluded for a stated reason. It may be
// undecided, with the question written down. What it may not be is absent from
// all three — that silent fourth state is the bug, and `scripts/check-seed-coverage.mjs`
// fails on it by name.
//
// UNDECIDED IS A DECLARATION, NOT A FALLBACK. The ask says the bug is a
// competition "absent from both lists", not one whose owner has not chosen yet.
// Writing "we have not decided about the EFL Championship, and here is the
// question" is a different object from saying nothing about it: the first is
// visible in a check's output every run, the second is invisible forever. What
// is forbidden is adding a competition to V2_LEAGUES and mentioning it nowhere.

// Keys are V2_LEAGUES keys. Values carry the reason and, where one exists, the
// in-repo evidence for it — a reason with no evidence is an opinion.
export const EXCLUDED = {
    atp: {
        reason: 'individual sport — the archive walker cannot derive two sides from it',
        evidence:
            "Same device as the golf row's `individual: true` (relay 218ede4, " +
            'CC-CMD-2026-08-25-golf-sport-label). The team-sport walker derives sides with ' +
            "`teams.find(t => t.homeAway === 'home') || teams[0]`, a neutral-site fallback " +
            'that cannot tell a neutral site from a draw sheet. On an individual event it ' +
            'returns the first two COMPETITORS, whose `.team` is undefined because the ' +
            'competitor carries `.athlete` — which is how ESPN event 401811963 got a second ' +
            'archive row reading `sport=\'PGA Tour\'`, both names null, home_score = ' +
            'away_score = -6. That -6/-6 was never a tie.',
    },
    wta: {
        reason: 'individual sport — same as atp',
        evidence: 'See atp. Both are `sport: \'tennis\'` in V2_LEAGUES.',
    },
}

export const UNDECIDED = {
    afl: {
        question:
            'Australian rules is a team sport with two sides and a scoreboard, so the walker ' +
            'would handle it. Seed it, or exclude it for a stated coverage reason?',
        decidedBy: 'a human',
    },
    eflchamp: {
        question:
            'EFL Championship (eng.2). The EFL Cup and EFL Trophy are both seeded; the league ' +
            'tiers are not. Seed the tiers, or state why the cups are covered and the leagues ' +
            'are not?',
        decidedBy: 'a human',
    },
    eflone: { question: 'EFL League One (eng.3) — see eflchamp.', decidedBy: 'a human' },
    efltwo: { question: 'EFL League Two (eng.4) — see eflchamp.', decidedBy: 'a human' },
}

// The `individual: true` rows in the cron's own LEAGUES table are seeded AND
// individual — golf is archived through a golf-aware path, not the team walker.
// So the flag is not itself an exclusion, and this manifest does not treat it as
// one. It is named here only so the next reader does not conclude, from the atp
// entry above, that every individual sport is excluded.
export const SEEDED_BUT_INDIVIDUAL = ['pga']

/** Which of the three declared states a V2_LEAGUES key is in, given the set of
 *  ESPN league slugs the cron actually seeds. `undeclared` is the bug.
 *
 *  The two maps are PARAMETERS, defaulting to this module's. They were read
 *  from module scope until 2026-08-27, when seeding CFB moved `cfb` out of
 *  UNDECIDED and broke a self-test asserting
 *  `classify('cfb', …) === 'undecided'`. That test was reaching into live data
 *  for a fixture, so it was testing the manifest's contents rather than the
 *  classifier's logic -- and it failed for a change that was correct. A pure
 *  function can be exercised against a fixture that no coverage decision moves. */
export function classify (key, espnLeague, seededSlugs, excluded = EXCLUDED, undecided = UNDECIDED) {
    if (seededSlugs.has(espnLeague)) return 'seeded'
    if (excluded[key]) return 'excluded'
    if (undecided[key]) return 'undecided'
    return 'undeclared'
}
