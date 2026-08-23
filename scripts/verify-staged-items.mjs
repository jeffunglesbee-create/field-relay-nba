#!/usr/bin/env node
// Combined verification for the repo's open STAGED items. Read-only. Dispatch
// this on any matchday; it answers all of them at once.
//
// RENAMED from verify-staged-2026-08-22.mjs on 2026-08-23, when a fourth item
// needed adding. A date in the filename guarantees one of two bad outcomes: a
// name that lies about what the file covers, or a new near-identical script per
// date. Staged items arrive continuously; the registry that verifies them is a
// standing thing, so it now has a standing name.
//
// WHY ONE PROBE: separate fixes ship with separate "verify on the next fixture"
// notes. Several ad-hoc queries later is how staged items rot into orphans
// (Rule 74). This makes verifying them a single run.
//
// OVERLAP WITH scripts/verify-epl-grounding.mjs IS DELIBERATE, AND THEY ARE NOT
// DUPLICATES. That file calls buildFPLMatchEventsContext directly on a live
// fixture and checks the club dictionary against bootstrap-static's current
// team list — neither is reachable from a D1 read, and both catch a class of
// break this file cannot see (a promoted club missing from a closed table). Its
// stage 3 does read the archive, which is the one place the two meet. Keep both;
// merging them would trade a cheap redundancy for the loss of the builder-level
// assertions.
//
// THE DESIGN RULE THAT MATTERS: every check reports PASS, FAIL or **PENDING**,
// and PENDING is never PASS. A check with no qualifying data yet has proved
// nothing. This session already caught one vacuous test — the gNN guard looked
// green only because no client writes had happened since the fix — and the fix
// was to demand a positive control. Same discipline here: each check states how
// many qualifying rows it found, and returns PENDING at zero.
//
// Baselines are the deploy commit times, so a row that predates the fix can
// never be counted as evidence for it.

import { writeFileSync } from 'node:fs';
import { PROMPT_EXAMPLE_LITERALS } from '../src/journalism-quality.js';
import { selectScoringPlays } from '../src/context-assembler.js';
// The four verdicts moved to their own module so they can be exercised against
// known-bad payloads without a network round trip. Imported rather than copied:
// two copies of a decision are free to disagree, and this file IS the decision
// field-laboratory registers its staged items against.
import { closingAfterOpening, soccerOpeningCoverage,
         eplBriefEventGrounded, recapNamesScoringPlay,
         threadNotesCleanup } from './staged-verdicts.mjs';

const RELAY = 'https://field-relay-nba.jeffunglesbee.workers.dev';
const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

// Deploy baselines (git commit times, UTC).
// BASELINE MOVED 2026-08-22 21:13, and the reason is the whole point of this
// check. 887c843's date gate fixed ONE of three closing_odds writers. The
// diagnostic then attributed the 41 failing rows to a third writer that logged
// nothing: /archive/game, whose `start_time` gate did not test finality, so it
// wrote closing_odds for games that had not kicked off -- and, worse, pre-filled
// the column so AmbientDO's `WHERE closing_odds IS NULL` guard could never match.
// a1937eb then found the second cause: captured_at was stamped `new Date()` even
// for noon-UTC historical snapshots, so this check was comparing cron execution
// order rather than market time.
//
// Both landed in deploy 834 (21:13:25Z). Rows written before it cannot testify
// about them -- including the 41 already in the table, which are dated
// 2026-08-22 and would otherwise keep this check red permanently. That is the
// same "judged by rows it never touched" error this check shipped with in its
// first version and check 3 shipped with in its second; the baseline has to
// move with the fix it measures.
const T_ODDS_BACKFILL_FIX = '2026-08-22 21:13:25';  // deploy 834: f6fa820 finality gate + a1937eb captured_at
const T_ALIASES_COMPLETE  = '2026-08-21 23:24:27';  // bb04fc8 last alias commit
const T_FPL_EVENTS        = '2026-08-22 00:20:10';  // eb02ac7 fpl_match_events corrected
// The two halves of check 3 test two different fixes and therefore need two
// different baselines. Event-grounding is eb02ac7; freedom from prompt-example
// literals is 5f2fabb, which landed eighteen hours later. Judging the leak
// assertion from the earlier baseline makes it FAIL forever on briefs written
// before the leak fix existed -- the identical error check 1 shipped with.
const T_2F_LEAK_FIX       = '2026-08-22 18:36:10';  // 5f2fabb promptExampleLeaks corrected
const T_MATCH_EVENTS      = '2026-08-23 06:12:03';  // 644d7f6 match_events context source

// Measured pre-fix baselines, so "improved" is a comparison and not a vibe.
const BASELINE = { EPL: 23.1, 'La Liga': 11.8 };

// Plain relay GET. Check 4 needs ESPN's scoring plays for a specific game, and
// /espn-summary is the only path to them the relay allows -- espnSummaryAllowed()
// permits /sports/{a}/{b}/summary and nothing else, which is why event ids come
// from D1's game_id rather than an ESPN scoreboard.
async function get(path) {
    const r = await fetch(`${RELAY}${path}`, { headers: { 'User-Agent': UA } });
    if (!r.ok) throw new Error(`HTTP ${r.status} on ${path}`);
    return r.json();
}

async function d1(sql, params = []) {
    const r = await fetch(`${RELAY}/d1/execute`, {
        method: 'POST',
        headers: { 'X-FIELD-Relay': 'field-relay-cron-2026', 'Content-Type': 'application/json', 'User-Agent': UA },
        body: JSON.stringify({ sql, params }),
    });
    const t = await r.text();
    if (!r.ok) throw new Error(`HTTP ${r.status}: ${t.slice(0, 200)}`);
    const j = JSON.parse(t);
    if (j.ok === false) throw new Error(`relay error: ${j.error}`);
    return j.results || [];
}

const EXPECTED_CHECKS = 5;
const m = { probed_at: new Date().toISOString(), query_ok: false, checks: [], error: null };
const add = (c) => m.checks.push(c);

try {
    // ── 1. Does closing now come AFTER opening? ─────────────────────────────
    // The defect was one snapshot written to both columns, so closing's
    // captured_at landed at or BEFORE opening's. Only games whose odds were
    // written after the date gate shipped can testify.
    // CORRECTED after the first run. The filter was `date >= date(fix)`, which
    // is the GAME's date, not when its odds were written. Games dated
    // 2026-08-21 were priced at 10:00 that morning -- twelve hours BEFORE the
    // 22:40 deploy -- so eighteen pre-fix rows qualified and the check reported
    // FAIL for a defect that had already been fixed. The fix cannot be judged by
    // rows it never touched.
    //
    // Two gates now: the game is dated strictly after the fix date, AND its
    // opening capture timestamp is genuinely after the deploy. The second is
    // the real test; the first just keeps the scan small.
    //
    // SPORT FILTER REMOVED 2026-08-22, and this was a real gap. The first
    // version restricted to ('MLB','WNBA','NBA','NHL') because those were the
    // sports I expected the fix to unblock. The live desk then showed today's
    // EPL fixtures rendering "open/close NOT SEQUENCED" -- the exact defect --
    // while this check reported PENDING, because soccer was excluded from the
    // query. A check that cannot see the failing case is worse than no check:
    // it reports calm. The fix applies to every sport, so the query now does
    // too.
    const seq = await d1(
        `SELECT id, sport, date, opening_odds, closing_odds
         FROM regular_season_games
         WHERE opening_odds IS NOT NULL AND closing_odds IS NOT NULL
           AND date > date(?)
         ORDER BY date DESC LIMIT 40`, [T_ODDS_BACKFILL_FIX.slice(0, 10)]);

    const seqRows = [];
    for (const g of seq) {
        let o, c;
        try { o = JSON.parse(g.opening_odds); c = JSON.parse(g.closing_odds); } catch { continue; }
        if (!o?.captured_at || !c?.captured_at) continue;
        // The decisive gate: odds written before the deploy cannot testify
        // about it, whatever the game's date says.
        if (new Date(o.captured_at) <= new Date(T_ODDS_BACKFILL_FIX + 'Z')) continue;
        const sequenced = new Date(c.captured_at) > new Date(o.captured_at);
        seqRows.push({
            id: g.id, sport: g.sport,
            open: o.captured_at, close: c.captured_at,
            sequenced,
            // Identical values are the other half of the old defect: one
            // snapshot in two columns. A real pair may legitimately be equal if
            // the market never moved, so this is reported, not failed on.
            identical_moneyline: JSON.stringify(o.moneyline) === JSON.stringify(c.moneyline),
        });
    }
    const sequencedCount = seqRows.filter(r => r.sequenced).length;
    add({
        id: 'closing_after_opening',
        what: 'closing_odds.captured_at > opening_odds.captured_at on games priced after the date gate',
        qualifying_rows: seqRows.length,
        status: closingAfterOpening({ rows: seqRows.length, sequenced: sequencedCount }),
        sequenced: sequencedCount,
        sample: seqRows.slice(0, 6),
    });

    // ── 2. Has soccer opening-odds coverage risen? ──────────────────────────
    // Compared against the measured pre-fix rate, and only over games dated
    // after the aliases landed. A rate computed over all history would be
    // dominated by the months the aliases were missing.
    // CORRECTED after the first run, and this is the SECOND time today the same
    // mistake has been made: the denominator included FUTURE fixtures. MLS is
    // pre-seeded months ahead, so 326 unplayed rows with legitimately no
    // opening line reported as 0% coverage. Only games that have actually been
    // played can carry an opening line, so only those count.
    //
    // Also `date >` rather than `>=`, for the same reason as check 1: a fixture
    // dated the day the aliases landed was priced that morning, before them.
    //
    // CORRECTED AGAIN 2026-08-22: `date < date('now')` excluded TODAY's games,
    // and today is the only day with fixtures since the aliases landed -- so the
    // check reported PENDING while a full EPL matchday sat in the table. Played
    // is a property of the game, not of the calendar: gate on finalized_at.
    const cov = await d1(
        `SELECT sport, COUNT(*) AS games,
                SUM(CASE WHEN opening_odds IS NOT NULL THEN 1 ELSE 0 END) AS with_open
         FROM regular_season_games
         WHERE sport IN ('EPL','La Liga','Ligue 1','MLS')
           AND date > date(?) AND finalized_at IS NOT NULL
         GROUP BY sport`, [T_ALIASES_COMPLETE.slice(0, 10)]);
    const covRows = cov.map(r => ({
        sport: r.sport, games: r.games, with_open: r.with_open,
        pct: r.games ? Math.round(1000 * r.with_open / r.games) / 10 : null,
        baseline_pct: BASELINE[r.sport] ?? null,
    }));
    // SAMPLE-SIZE FLOOR, added 2026-08-22 on evidence.
    //
    // This check FAILed with "coverage fell for La Liga" off a single fixture:
    // 0 of 1, read as 0% against an 11.8% baseline. One row cannot carry a
    // percentage — the only two values it can produce are 0% and 100%, and
    // both will differ from any baseline, so at n=1 this check was guaranteed
    // to report either a regression or an improvement no matter what the
    // aliases did.
    //
    // The diagnostic (scripts/diagnose-staged-fails-2026-08-22.mjs) measured
    // the same two leagues over a 30-day window of played games: EPL 4/6 =
    // 66.7% against a 23.1% baseline, La Liga 2/9 = 22.2% against 11.8%. Both
    // ROSE. The reported La Liga regression was an artifact of the denominator,
    // not a real fall in coverage.
    //
    // Below the floor a sport reports PENDING, which is the honest state: not
    // enough fixtures yet to say. Four is the smallest n where a rate can
    // straddle a baseline rather than only hit 0 or 100.
    const MIN_GAMES_FOR_RATE = 4;
    const measurable = covRows.filter(r => r.games >= MIN_GAMES_FOR_RATE);
    const tooFew = covRows.filter(r => r.games > 0 && r.games < MIN_GAMES_FOR_RATE);
    const improved = measurable.filter(r => r.baseline_pct != null && r.pct > r.baseline_pct);
    const regressed = measurable.filter(r => r.baseline_pct != null && r.pct < r.baseline_pct);
    add({
        id: 'soccer_opening_coverage',
        what: 'EPL / La Liga opening-odds coverage above the pre-fix baseline (23.1% / 11.8%)',
        qualifying_rows: measurable.reduce((s, r) => s + r.games, 0),
        min_games_for_rate: MIN_GAMES_FOR_RATE,
        below_floor: tooFew.map(r => `${r.sport} (${r.with_open}/${r.games})`),
        status: soccerOpeningCoverage({ measurable, tooFew, improved, regressed, minGames: MIN_GAMES_FOR_RATE }),
        per_sport: covRows,
    });

    // ── 3. Does an EPL brief actually name a player? ────────────────────────
    // The ask's own artifact. Weakened deliberately from "a player who appears
    // in that fixture's stats" to a two-stage report: first, do EPL briefs
    // exist since the deploy at all; second, do they contain the block's
    // fingerprint. A join against FPL stats needs the fixture payload, which
    // this D1-only probe cannot reach — so what cannot be proved here is
    // reported as UNPROVEN rather than quietly claimed.
    //
    // STRENGTHENED 2026-08-22, because the weak version PASSED on a defective
    // brief. `game_recap_epl_401879321` was not the season template — so the
    // old assertion went green — while carrying "37 goals this season", a
    // literal lifted verbatim out of FIELD_VOICE_REGISTER's exemplar. The check
    // asserted the absence of one known failure and read as an all-clear for a
    // brief that was still fabricating a figure. That is the same shape as the
    // sport-filter and the `date <` gaps earlier today: a check built from a
    // partial model of its input can only see the failures that model admits.
    //
    // Second assertion added: no brief may contain any PROMPT_EXAMPLE_LITERALS
    // entry. The literals are imported from journalism-quality.js rather than
    // copied, so the check cannot drift from what Layer 2f actually polices.
    //
    // This is DELIBERATELY stricter than 2f itself. 2f's discriminator is
    // "present in the brief AND absent from the game context", which needs the
    // prompt — and D1 stores briefs, not prompts. So this probe drops condition
    // (c) and flags on presence alone. A brief that legitimately earns one of
    // these strings would be a false positive; that is the correct trade here,
    // because every literal is a specific figure attached to a specific named
    // player or venue in an exemplar, and the manifest names the row so a human
    // reads it rather than trusting the verdict blindly.
    const briefs = await d1(
        // COALESCE(updated_at, created_at) is the whole point of this query.
        //
        // Three brief writers use ON CONFLICT(id) DO UPDATE, so a brief can be
        // rewritten in place while created_at keeps its original value forever.
        // game_recap_epl_401879321 carried a fabricated "37 goals this season"
        // at 19:09 and was clean at 21:14 with a different length — regenerated
        // after the 2f fix, and invisible to a created_at filter, which still
        // read 18:30:53. This check therefore reported UNPROVEN while sitting on
        // the exact rewrite that proved the fix.
        //
        // updated_at is populated by the briefs_set_updated_at trigger. COALESCE
        // covers rows written before the migration ran.
        `SELECT id, brief_type, created_at, COALESCE(updated_at, created_at) AS written_at,
                LENGTH(brief_text) AS len,
                CASE WHEN brief_text LIKE '%through 0 matches%'
                       OR brief_text LIKE '%0 points through%' THEN 1 ELSE 0 END AS season_template,
                brief_text
         FROM briefs
         WHERE sport = 'EPL' AND COALESCE(updated_at, created_at) > ?
         ORDER BY COALESCE(updated_at, created_at) DESC LIMIT 10`, [T_FPL_EVENTS]);

    const briefRows = briefs.map(b => {
        const text = String(b.brief_text || '');
        return {
            id: b.id, created_at: b.created_at, written_at: b.written_at, len: b.len,
            brief_type: b.brief_type,
            season_template: !!b.season_template,
            leaked_literals: PROMPT_EXAMPLE_LITERALS.filter(lit => text.includes(lit)),
            excerpt: text.slice(0, 220),
        };
    });

    // ── The live/recap split, added 2026-08-22 on measured evidence ─────────
    //
    // A game_live brief is REWRITTEN every cycle while the match is on. One
    // Everton brief was observed in three different states in nine hours:
    //   14:22  "maintains a 107.7 DRTG, best in the NBA, despite playing soccer"
    //   19:17  "contrasting their 37 goals last season"
    //   23:31  clean — neither figure present any more
    // Two different fabricated exemplar figures, then neither.
    //
    // That makes a point-in-time snapshot UNABLE to prove leak-freedom for live
    // briefs. Reading clean proves only that the current text is clean; the leak
    // this query would have caught may already have been overwritten, which is
    // exactly what happened to Everton twice. Asserting PASS off that would be
    // the vacuous-test trap this file was built to avoid.
    //
    // game_recap is different: written once when the match finalises and left
    // alone, so a snapshot of it is a real measurement.
    //
    // So the assertion runs on recaps, and live briefs are reported as sampled
    // rather than proven. The desk and D1 agree on the Brentford text, so this
    // is churn in the row, not the desk reading some other source — worth
    // stating, because "the check disagrees with the screenshot" has a much
    // more alarming explanation that was ruled out rather than assumed.
    const isLive  = (b) => String(b.brief_type || b.id).includes('live');
    const recaps  = briefRows.filter(b => !isLive(b));
    const liveOnes = briefRows.filter(isLive);
    const grounded = briefRows.filter(b => !b.season_template);
    // Only briefs written after the LEAK fix can testify about the leak fix.
    // The first run of this assertion failed on two briefs from 10:02 and
    // 18:30, both before 5f2fabb deployed at 18:36 -- rows the fix never
    // touched. Older leaking briefs stay in the manifest as history, since
    // they are the evidence the leak was real, but they cannot fail the run.
    const written = (b) => b.written_at || b.created_at;
    const postLeakFix = recaps.filter(b => written(b) > T_2F_LEAK_FIX);
    const leaking = postLeakFix.filter(b => b.leaked_literals.length);
    const historicalLeaks = recaps.filter(b =>
        b.leaked_literals.length && written(b) <= T_2F_LEAK_FIX);
    // Reported, never asserted on. See the split rationale above.
    const liveLeaking = liveOnes.filter(b => b.leaked_literals.length);

    // Order matters: a leak is reported even when a brief also clears the
    // template test, because that is exactly the case the old check missed.
    const liveNote = liveOnes.length
        ? ` | live: ${liveLeaking.length}/${liveOnes.length} leaking right now (sampled, not asserted — live briefs are rewritten every cycle)`
        : '';

    const briefStatus = eplBriefEventGrounded({
        briefRows: briefRows.length, leaking, postLeakFix: postLeakFix.length,
        grounded: grounded.length, historicalLeaks: historicalLeaks.length, liveNote,
    });

    add({
        id: 'epl_brief_event_grounded',
        what: 'EPL briefs since fpl_match_events deployed: not a season-stat template (all types) AND free of prompt-example literals (game_recap only — see asserted_on)',
        qualifying_rows: briefRows.length,
        status: briefStatus,
        literals_checked: PROMPT_EXAMPLE_LITERALS.length,
        recaps_since_leak_fix: postLeakFix.length,
        live_briefs_sampled: liveOnes.length,
        live_briefs_leaking_now: liveLeaking.map(b => ({ id: b.id, literals: b.leaked_literals })),
        asserted_on: 'game_recap only — live briefs are rewritten every cycle, so a snapshot cannot prove leak-freedom for them',
        historical_leaks_before_fix: historicalLeaks.map(b => ({ id: b.id, created_at: b.created_at, literals: b.leaked_literals })),
        note: 'Player-name-against-fixture-stats is NOT asserted here: that join needs the FPL payload, which this D1-only probe does not fetch. Read the excerpts. The literal check drops Layer 2f\'s "absent from context" condition because D1 stores briefs, not prompts — so it is stricter than 2f, not equivalent to it.',
        sample: briefRows,
    });


    // ── 4. Do recaps name what happened in the game? ────────────────────────
    //
    // Ask 5 of CC-CMD-2026-08-20-brief-data-quality, deployed 644d7f6. The
    // context source match_events feeds ESPN's own scoring-play prose into the
    // prompt. STAGED because it needs a slate to run after the deploy.
    //
    // THIS IS A JOIN, NOT A VIBE CHECK. The tempting version greps the brief
    // for scoring verbs ("scored", "homered", "makes") and calls a match a
    // pass. That proves nothing: a season-stat template says "scored 4.7 runs
    // per game" and would sail through. So this pulls the ACTUAL scoring plays
    // for that exact game from ESPN, extracts the names in them, and asks
    // whether the brief names any of those people. A brief can only pass by
    // naming someone who really did score in the game it is about.
    //
    // Team names are excluded from the candidate set. "Arsenal" appears in
    // every Arsenal play text and in every Arsenal brief, grounded or not, so
    // counting it would make the check pass on a template.
    // Columns are the briefs table's ACTUAL ones. The first version of this
    // query selected home_team/away_team, which do not exist on briefs -- run 13
    // died on `no such column: home_team`. Team names come from the ESPN summary
    // this check already fetches, via the header.competitions[0].competitors
    // shape src/index.js reads in two places.
    const recapRows = await d1(
        `SELECT id, sport, game_id, COALESCE(updated_at, created_at) AS written_at,
                brief_text
         FROM briefs
         WHERE brief_type = 'game_recap'
           AND sport IN ('MLB','WNBA','NBA','NHL','NFL','EPL')
           AND COALESCE(updated_at, created_at) > ?
         ORDER BY COALESCE(updated_at, created_at) DESC LIMIT 12`, [T_MATCH_EVENTS]);

    const SLUG = { MLB: 'sports/baseball/mlb', NBA: 'sports/basketball/nba',
                   WNBA: 'sports/basketball/wnba', NHL: 'sports/hockey/nhl',
                   NFL: 'sports/football/nfl', EPL: 'sports/soccer/eng.1' };
    const CONTAINER = { MLB: 'plays', NBA: 'plays', WNBA: 'plays', NHL: 'plays',
                        NFL: 'scoringPlays', EPL: 'keyEvents' };
    // Words that are capitalised in ESPN prose but are not people.
    const NOT_A_NAME = new Set(['Goal', 'Kick', 'Yd', 'Run', 'Pass', 'Wrist', 'Shot',
        'Quarter', 'Period', 'Half', 'Inning', 'Penalty', 'Assist', 'Assists',
        'Field', 'Left', 'Right', 'Center', 'Centre', 'Own', 'Extra', 'Point']);

    const evidence = [];
    for (const r of recapRows) {
        const sport = String(r.sport);
        const gid = String(r.game_id || '');
        // testable is its own flag, not derived from espn_ok. A successful fetch
        // that yields no team-word exclusion set is a row that must ABSTAIN, and
        // conflating that with "the fetch failed" hides why.
        const row = { id: r.id, sport, game_id: gid, written_at: r.written_at,
                      espn_ok: false, testable: false, scoring_items: 0,
                      names_in_plays: [], team_words: [],
                      names_in_brief: [], grounded: false, why: null };
        if (!/^\d{6,}$/.test(gid) || !SLUG[sport]) { row.why = 'no usable ESPN event id'; evidence.push(row); continue; }
        try {
            const d = await get(`/espn-summary/${SLUG[sport]}/summary?event=${gid}`);
            const raw = Array.isArray(d[CONTAINER[sport]]) ? d[CONTAINER[sport]] : [];
            const items = CONTAINER[sport] === 'scoringPlays' ? raw : raw.filter(x => x.scoringPlay === true);
            row.espn_ok = true;
            row.scoring_items = items.length;
            if (!items.length) { row.why = 'ESPN lists no scoring plays for this event'; evidence.push(row); continue; }

            // Team names from the summary's own header, the shape src/index.js
            // reads in two places. Without them "Arsenal" -- which appears in
            // every Arsenal play text AND in every Arsenal brief, grounded or
            // not -- would count as a scorer and pass a season template.
            const competitors = d?.header?.competitions?.[0]?.competitors || [];
            const teamWords = new Set(competitors
                .flatMap(c => [c.team?.displayName, c.team?.shortDisplayName, c.team?.name])
                .filter(Boolean).flatMap(t => String(t).split(/\s+/)));
            row.team_words = [...teamWords];
            if (!teamWords.size) {
                // No exclusion set means a team-name match would read as a
                // scorer. That is worse than no answer, so this row does not
                // testify. Not a fallback to a weaker test -- an abstention.
                row.why = 'no competitors in the ESPN header; team-word exclusion unavailable';
                evidence.push(row); continue;   // testable stays false
            }
            const names = new Set();
            for (const it of selectScoringPlays(items)) {
                for (const tok of String(it.text || '').match(/\b[A-Z][a-z'\u00C0-\u024F]{3,}\b/g) || []) {
                    if (!NOT_A_NAME.has(tok) && !teamWords.has(tok)) names.add(tok);
                }
            }
            row.names_in_plays = [...names].slice(0, 25);
            const text = String(r.brief_text || '');
            row.names_in_brief = [...names].filter(n => text.includes(n));
            row.grounded = row.names_in_brief.length > 0;
            // Only now: ESPN answered, it listed scoring plays, and the team-word
            // exclusion existed. Anything short of all three abstains.
            row.testable = row.names_in_plays.length > 0;
            if (!row.testable) row.why = 'no candidate names left after excluding team words';
            if (!row.grounded) row.why = 'brief names nobody who scored in this game';
        } catch (e) { row.why = `ESPN fetch failed: ${String(e.message || e)}`; }
        evidence.push(row);
    }

    // Only rows where ESPN actually had scoring plays can testify. A 0-0 draw
    // and a fetch failure are both "no evidence", not "the fix is broken" —
    // the same PENDING-is-not-PASS discipline the other three checks use, and
    // for the same reason: a check that fails on absent data gets ignored.
    const testable = evidence.filter(e => e.testable);
    const named = testable.filter(e => e.grounded);
    const meStatus = recapNamesScoringPlay({
        recapRows: recapRows.length, testable: testable.length, named: named.length,
    });

    add({
        id: 'recap_names_a_scoring_play',
        what: 'game_recap briefs written since match_events deployed name a player who appears in that game\'s ESPN scoring plays',
        qualifying_rows: recapRows.length,
        testable_rows: testable.length,
        status: meStatus,
        method: 'per-row join: ESPN scoring plays for the brief\'s own game_id -> capitalised name tokens minus team words -> substring test against brief_text. A brief passes only by naming a real scorer in the game it is about; scoring VERBS are deliberately not accepted, since a season-stat template contains them too.',
        note: 'PARTIAL is expected on some slates and is not a regression by itself: a recap can legitimately lead on something other than a scorer. Read the evidence rows — 0/N is the signal that the block is not reaching the prompt, and the assembler budget skip is the first thing to check, not ESPN.',
        evidence,
    });

    // ── 5. Does the hourly cleanup cron actually sweep? ────────────────────
    // cc-session-2026-07-20-game-thread-relay.md has read "**STAGED** — fires at
    // next :30 mark post-deploy" for 34 days. The cron has run ~816 times since.
    // Found by staged-verifier-check.mjs on its first run; this is the executor
    // it was missing.
    //
    // A grace window of one hour, because the sweep fires at :30: a row that
    // expired four minutes ago is not evidence of anything. Only rows expired
    // longer than the cron's own interval can testify against it.
    const GRACE_MS = 60 * 60 * 1000;
    const notes = await d1(
        `SELECT COUNT(*) AS total,
                SUM(CASE WHEN expires_at < ? THEN 1 ELSE 0 END) AS expired_beyond_grace
         FROM game_thread_notes`, [Date.now() - GRACE_MS]);
    const total = notes.rows?.[0]?.total ?? notes[0]?.total ?? 0;
    const beyond = notes.rows?.[0]?.expired_beyond_grace ?? notes[0]?.expired_beyond_grace ?? 0;
    add({
        id: 'thread_notes_cleanup',
        what: 'the 30 * * * * cron deletes game_thread_notes rows past expires_at',
        qualifying_rows: total,
        status: threadNotesCleanup({ total, expiredBeyondGrace: beyond }),
        grace_window: '1 hour — the sweep fires at :30, so a just-expired row proves nothing',
        expired_beyond_grace: beyond,
        note: 'STAGED in cc-session-2026-07-20-game-thread-relay.md since 2026-07-20 with no executor. The cron has fired ~816 times since; this is the first thing that asks whether any of them worked.',
    });

    m.query_ok = true;
} catch (e) { m.error = String(e.message || e); }

m.summary = m.checks.map(c => `${c.id}: ${c.status}`);
// Named, not a literal. This was `=== 3` and would have silently reported
// all_passed:false forever the moment a fourth check was added — a probe that
// can never say PASS is a probe everyone stops reading.
m.all_passed = m.query_ok && m.checks.length === EXPECTED_CHECKS
    && m.checks.every(c => String(c.status).startsWith('PASS'));
m.any_failed = m.checks.some(c => String(c.status).startsWith('FAIL'));

const stamp = m.probed_at.replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
const out = `outbox/staged-verification-${stamp}.json`;
writeFileSync(out, JSON.stringify(m, null, 2) + '\n');
console.log(JSON.stringify(m, null, 2));
console.log(`\nwrote ${out}`);
console.log('\n── SUMMARY ──');
for (const line of m.summary) console.log('  ' + line);

if (!m.query_ok) { console.error(`\nD1 QUERIES FAILED — this says nothing about any of the ${EXPECTED_CHECKS} items.`); process.exit(1); }
// A real regression fails the run. PENDING does not: nothing has been proved
// wrong, only not yet proved right, and failing on that would train the habit
// of ignoring this probe's exit code.
if (m.any_failed) { console.error('\nA staged item REGRESSED — see the FAIL above.'); process.exit(1); }
process.exit(0);
