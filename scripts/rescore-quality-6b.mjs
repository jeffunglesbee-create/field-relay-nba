#!/usr/bin/env node
// Ask 6b of CC-CMD-2026-08-20-brief-data-quality — the BEFORE half.
//
// The ask says quality_score "under-penalises in-progress prose" and asks for a
// weighting change plus a before/after re-score to produce a real measuredEffect
// for the SCORING_ERAS entry. This script is the before. It changes nothing.
//
// WHY IT RE-SCORES RATHER THAN READING quality_score. The stored column spans
// three scoring eras (ver 1 = 716, ver 2 = 518, null = 241 as of 2026-08-21) and
// SCORING_ERAS exists precisely because scores on either side of a boundary are
// non-comparable — the 2026-07-16 case where a pure formula change read as a
// 68-point collapse in prose quality. Any statement about a 5.8-point gap that
// mixes eras is measuring the instrument, not the prose. Every row here is
// re-scored under HEAD's scoreProse, one rubric, and the stored value is carried
// alongside only so the era spread is visible.
//
// THE CLASSIFIER IS COPIED VERBATIM from scripts/probe-ask5-ask6-prereqs.mjs,
// which produced the 184.3 / 190.1 baseline the CC-CMD cites. A different
// definition of "in-progress" would make the before and after incomparable,
// which is the whole failure this script exists to avoid.
//
// TWO INHERITED CLAIMS ARE UNDER TEST HERE (Rule 72), not assumed:
//
//   1. "The gap is 5.8 points." Measured on the STORED column across eras.
//      Re-scored under one rubric it may be larger, smaller or absent.
//   2. "55 of the 300 points are unreachable BY CONSTRUCTION in the Worker
//      runtime" (outbox/cc-session-2026-08-16-quality-bar-scale.md, repeated in
//      SCALE's own comment and in the 240-bar analysis). Dim 7 reads opts.game
//      and Dim 10 reads opts.matchupNote, and eight of the ten runQualityChain
//      call sites in src/index.js DO pass game — six also pass matchupNote. So
//      the claim is at least too broad: it holds for the slate brief, which has
//      no single game, and this reports whether it holds for game briefs, which
//      are the rows the 0-of-523 finding was drawn from.
//
// Read-only apart from the artifact it writes.

import { writeFileSync } from 'node:fs';
import { scoreProse, SCALE, UNREACHABLE_DIMS, REACHABLE_CEILING } from '../src/journalism-quality.js';

const RELAY = 'https://field-relay-nba.jeffunglesbee.workers.dev';
const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const LIMIT = Number(process.env.RESCORE_LIMIT || 160);

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

// VERBATIM from probe-ask5-ask6-prereqs.mjs. Do not "improve" it here.
// Dim 11 candidate, imported rather than reimplemented. Era 4's recorded effect
// was a projection scoreProse never applied, because the projection and the
// scorer each carried their own weights. This file and scoreProse call the same
// function, so there is nothing left to diverge.
import { finalityAgreement, FINALITY_MAX } from '../src/journalism-quality.js';

const LIVE_LANG = `( b.brief_text LIKE '%scoreless%' OR b.brief_text LIKE '%at halftime%'
   OR b.brief_text LIKE '%second-half action%' OR b.brief_text LIKE '%first-half action%'
   OR b.brief_text LIKE '%through 4_ minutes%' OR b.brief_text LIKE '%minutes into%' )`;


// ── Candidate weightings, evaluated WITHOUT a second Datamuse pass ──────────
//
// scoreProse's total is linear in the per-dimension fractions the breakdown
// already returns: total = Σ (dim_k × SCALE_k), give or take the rounding inside
// `base`. So once a row is scored, every candidate weighting can be evaluated on
// the SAME row for free. That matters twice over: it is ~950 fewer Datamuse
// lookups per candidate, and it means every candidate is compared on identical
// prose rather than on a fresh sample that could differ for its own reasons.
//
// The candidates are not guesses. They follow the separation measured above:
// arc, ctx and temporal are the three dimensions where finished-game prose
// genuinely scores higher; voice and density run the OTHER way, so weight spent
// on them actively narrows the gap ask 6b exists to widen.
const DIM_TO_SCALE = {
    specificity: 'spec', statDepth: 'statDepth', variety: 'variety',
    density: 'density', freshness: 'fresh', arcScore: 'arc',
    contextAnchoring: 'ctx', temporalScore: 'temporal',
    voiceScore: 'voice', matchupDepth: 'matchup',
};
const scoreUnder = (dims, W) => Object.entries(DIM_TO_SCALE)
    .reduce((sum, [dimKey, wKey]) => sum + (dims[dimKey] || 0) * (W[wKey] ?? 0), 0);

// Every candidate keeps the 300-point nominal total, so a score stays readable
// against every threshold already in the codebase (240, 196, 110). A candidate
// that changed the total would move every bar at once and make the before/after
// unreadable -- a different change wearing this one's clothes.
const CANDIDATES = {
    current: { ...SCALE },
    // Shift weight off the two dimensions that discriminate backwards and onto
    // the three that discriminate correctly. Conservative: voice and density
    // keep enough weight to still do their own jobs.
    shift_moderate: { spec: 30, statDepth: 38, variety: 30, density: 10, fresh: 36,
                      arc: 55, ctx: 32, temporal: 25, voice: 20, matchup: 24 },
    // The same move, harder.
    shift_aggressive: { spec: 28, statDepth: 34, variety: 26, density: 8, fresh: 30,
                        arc: 68, ctx: 40, temporal: 30, voice: 16, matchup: 20 },
    // The ceiling of this approach: everything on the three forward dimensions.
    // Not a proposal -- it is here to show how much reweighting alone can EVER
    // buy, so the decision to add a real finality dimension is made against a
    // number rather than a feeling.
    forward_only_bound: { spec: 0, statDepth: 0, variety: 0, density: 0, fresh: 0,
                          arc: 150, ctx: 90, temporal: 60, voice: 0, matchup: 0 },
};

const mean = (xs) => xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
// Reported beside every mean. Run 1 produced a 5.4-point difference on n=16 and
// stated it as a gap; without a spread that number cannot be told apart from
// noise, which is the same error this repo made with an n=2 "CONFIRMED" five
// days ago.
const sd = (xs) => {
    if (xs.length < 2) return null;
    const mu = mean(xs);
    return Math.sqrt(xs.reduce((a, x) => a + (x - mu) ** 2, 0) / (xs.length - 1));
};
/// Standard error of the difference of two means. Not a p-value and not
/// presented as one -- it answers "is this difference larger than the noise in
/// the samples that produced it", which is the only question being asked.
const seDiff = (a, b) => {
    const sa = sd(a), sb = sd(b);
    if (sa == null || sb == null) return null;
    return Math.sqrt((sa * sa) / a.length + (sb * sb) / b.length);
};
const r1 = (x) => x == null ? null : Math.round(x * 10) / 10;
const r3 = (x) => x == null ? null : Math.round(x * 1000) / 1000;

const m = {
    probed_at: new Date().toISOString(),
    rubric: { scale: SCALE, declared_unreachable: UNREACHABLE_DIMS, declared_reachable_ceiling: REACHABLE_CEILING },
    limit: LIMIT,
    stored_baseline: null,
    matchup_note_coverage: null,
    rescored: null,
    finality_2x2: null,
    dim_reachability: null,
    error: null,
};

try {
    // The stored-column figure the CC-CMD cites, reproduced exactly, so the
    // re-scored number below can be compared to a number and not to a memory.
    m.stored_baseline = await d1(
        `SELECT CASE WHEN ${LIVE_LANG} THEN 'in-progress language' ELSE 'reads as final' END AS kind,
                COUNT(*) AS n, ROUND(AVG(b.quality_score),1) AS mean_stored
         FROM briefs b
         WHERE b.brief_type = 'game_recap' AND b.quality_score IS NOT NULL
         GROUP BY kind`);

    // Rows joined to their game, because Dim 7 and Dim 10 have no input without
    // one and would report a false zero. LEFT JOIN, not INNER: a brief with no
    // matching game row is a real population member and its missing dims are a
    // finding, not a row to hide.
    // STRATIFIED, and run 1 is why. Taking the most recent 160 rows gave 144
    // finals to 16 in-progress -- the natural 9:1 ratio of the table -- and a
    // 5.4-point difference on n=16 is not a finding, it is a hint. Half the
    // sample now comes from each class, which puts the whole in-progress
    // population (95 rows table-wide) in scope instead of a tail of it.
    //
    // STRATIFIED ON THE FACT TOO, added 2026-08-24, and the run before it is why.
    // Stratifying on LIVE_LANG alone balances the PROSE and lets the FACT follow
    // whatever the date ordering hands over: every one of 150 scoreable rows came
    // back finalized, `mean_finality_when_live` was null, and half the 2x2 had no
    // rows to be measured on. Widening brief_type changed nothing because the
    // newest 160 rows per prose-class are still all recaps -- the ordering
    // dominated the filter.
    //
    // That is the same defect this script already carries a comment about one
    // paragraph up: a sample drawn on a dimension unrelated to what is being
    // measured. It was fixed for the prose axis in run 1 and left unfixed for the
    // fact axis, because nothing was reading the fact until Dim 11.
    //
    // Five strata, not four: rows with no joined game are `unknown-finality`, a
    // real population member whose missing dims are a finding. Folding them into
    // the not-final bucket would let "we have no game row" masquerade as "the
    // game is still being played" in the sample, even though `is_final` keeps
    // them apart afterwards.
    const JOINED = 'g.espn_event_id IS NOT NULL';
    const STRATA = [
        { label: 'live-lang, not final',  where: `${LIVE_LANG} AND ${JOINED} AND g.finalized_at IS NULL` },
        { label: 'live-lang, final',      where: `${LIVE_LANG} AND ${JOINED} AND g.finalized_at IS NOT NULL` },
        { label: 'final-lang, not final', where: `NOT ${LIVE_LANG} AND ${JOINED} AND g.finalized_at IS NULL` },
        { label: 'final-lang, final',     where: `NOT ${LIVE_LANG} AND ${JOINED} AND g.finalized_at IS NOT NULL` },
        { label: 'no joined game',        where: `${JOINED.replace('IS NOT NULL', 'IS NULL')}` },
    ];
    const perCell = Math.max(1, Math.floor(LIMIT / STRATA.length));
    const pick = (where) => d1(
        `SELECT b.id, b.sport, b.game_id, b.brief_type, b.date,
                b.quality_score AS stored, b.scoring_version,
                CASE WHEN ${LIVE_LANG} THEN 1 ELSE 0 END AS live_lang,
                b.brief_text,
                g.home, g.away, g.home_score, g.away_score, g.note, g.finalized_at
         FROM briefs b
         LEFT JOIN regular_season_games g ON g.espn_event_id = b.game_id
         WHERE b.brief_type IN ('game_recap','game_brief') AND b.quality_score IS NOT NULL
           AND ${where}
         ORDER BY b.date DESC, b.id DESC
         LIMIT ?`, [perCell]);

    // Per-stratum counts are reported. A cell that comes back empty is a finding
    // about the corpus -- it says the corner cannot be measured from D1 as it
    // stands -- and it must not look the same as a cell nobody asked for.
    const strataCounts = {};
    const rows = [];
    for (const st of STRATA) {
        const got = await pick(st.where);
        strataCounts[st.label] = got.length;
        rows.push(...got);
    }

    // Dim 10 read zero on 160/160 rows in run 1, and the reason was NOT that the
    // dimension cannot run: 0 of those rows carried a matchupNote, because
    // regular_season_games.note was empty on every joined game. That is a data
    // gap, not a runtime limitation, and the two have different fixes -- so
    // measure how empty the column actually is rather than inferring it.
    //
    // PER SPORT, not just the total. CC-CMD-2026-08-23-matchup-note-starvation
    // says to read the split FIRST, and it is right: a gap concentrated in one
    // sport is a broken adapter, a gap spread evenly is a missing producer, and
    // those are different builds. The aggregate cannot tell them apart.
    //
    // The aggregate does say one thing on its own. It read 36/1284 on 2026-08-23
    // and 36/1321 on 2026-08-24 -- 37 more finalized games, zero more notes. A
    // producer that runs rarely still moves; one that never runs does not.
    const coverageTotal = await d1(
        `SELECT COUNT(*) AS total,
                SUM(CASE WHEN note IS NOT NULL AND LENGTH(TRIM(note)) > 10 THEN 1 ELSE 0 END) AS with_note
         FROM regular_season_games WHERE finalized_at IS NOT NULL`);
    const coverageBySport = await d1(
        `SELECT sport, COUNT(*) AS total,
                SUM(CASE WHEN note IS NOT NULL AND LENGTH(TRIM(note)) > 10 THEN 1 ELSE 0 END) AS with_note
         FROM regular_season_games WHERE finalized_at IS NOT NULL
         GROUP BY sport ORDER BY total DESC`);
    // A sample of what a populated note actually CONTAINS. "The column is
    // populated" is explicitly not a done condition for that CC-CMD: the column
    // can hold strings no brief would ever echo, and Dim 10 would still score
    // zero. Reading five real values costs nothing and answers whether the 36
    // are usable editorial context or leftovers.
    //
    // GOLF EXCLUDED, and that exclusion is the finding rather than a filter.
    // The 2026-08-24 split came back golf 30/30, MLB 5/830, WNBA 2/177, and
    // every other sport 0. The samples were "Wyndham Clark -17" and "Gary
    // Woodland -6" -- leaderboard positions written by the golf adapter for its
    // own purposes, not editorial matchup context.
    //
    // Golf has no matchup. This relay packs a tournament and a round into
    // home/away, which is why field-laboratory's Sport registry declares golf an
    // Omission rather than modelling a contest between two sides. So the one
    // sport with full coverage is the one where Dim 10 could never score, and it
    // inflated the headline coverage 5x: 37/1322 overall, but 7/1292 (0.54%)
    // once the sport that cannot use the column is set aside.
    const notesSample = await d1(
        `SELECT sport, id, SUBSTR(note, 1, 160) AS note_head
         FROM regular_season_games
         WHERE finalized_at IS NOT NULL AND note IS NOT NULL AND LENGTH(TRIM(note)) > 10
           AND sport NOT IN ('golf', 'PGA Tour')
         ORDER BY finalized_at DESC LIMIT 10`);
    const notesGolf = await d1(
        `SELECT sport, COUNT(*) AS n FROM regular_season_games
         WHERE finalized_at IS NOT NULL AND note IS NOT NULL AND LENGTH(TRIM(note)) > 10
           AND sport IN ('golf', 'PGA Tour')`);
    m.matchup_note_coverage = {
        total: coverageTotal, by_sport: coverageBySport,
        sample_matchup_sports: notesSample, golf_rows_excluded_from_sample: notesGolf,
        reading: 'concentrated in one or two sports -> a broken adapter for those. Spread evenly at near-zero -> no producer writes this column at all.',
    };

    const scored = [];
    for (const r of rows) {
        // finalizedAt is NOT optional. Without it scoreProse's Dim 11 reads
        // `undefined`, calls the fact unknown, and abstains at the midpoint on
        // every row -- which is exactly what happened on the first era-5 run:
        // blindness moved 0.9 -> 1.0 instead of clearing 2, because the
        // dimension contributed the same 10 points to every brief.
        //
        // The function was shared; the ARGUMENT was not. "One implementation,
        // two consumers" does not prevent divergence if each consumer feeds it a
        // different input. Cross-checked per row below.
        const game = (r.home && r.away)
            ? { home: r.home, away: r.away, homeScore: r.home_score,
                awayScore: r.away_score, finalizedAt: r.finalized_at ?? null }
            : null;
        // Sequential, one brief at a time. scoreProse fires up to 5 Datamuse
        // lookups per call for Dim 5; a parallel map over 160 briefs is an 800-
        // request burst at a free API (Rule 78).
        const b = await scoreProse(r.brief_text, {
            sport: r.sport || '', game, matchupNote: r.note || null, breakdown: true,
        });
        // The FACT, three-valued. A joined game row with no finalized_at is
        // KNOWN unfinished; no joined row at all is unknown, and a boolean would
        // merge two different things.
        const isFinal = game ? !!r.finalized_at : null;
        const fin11 = finalityAgreement(r.brief_text, isFinal);
        // THE CROSS-CHECK. b.dims.finality is what scoreProse computed from
        // opts.game; fin11.score is what this script computed from the same row.
        // They read the same function and must therefore agree -- and when the
        // game object was missing finalizedAt they did not, silently, for 128
        // rows. Counted and surfaced rather than thrown: one disagreement is a
        // finding to read, not a reason to lose the whole run.
        const dim11InScore = Math.round((b.dims?.finality ?? 0) * FINALITY_MAX);
        scored.push({
            id: r.id, sport: r.sport, live_lang: !!r.live_lang,
            stored: r.stored, scoring_version: r.scoring_version,
            joined_game: !!game, has_note: !!r.note,
            is_final: isFinal, finality: fin11.score,
            finality_in_score: dim11InScore,
            paths_agree: dim11InScore === fin11.score,
            finality_reading: fin11.reading, finality_verdict: fin11.verdict,
            total: b.total, dims: b.dims,
        });
    }

    // ── The 2x2: fact x reading. THIS is the split that measures Dim 11.
    //
    // The live/fin split below classifies by PROSE ALONE (LIVE_LANG), so it
    // cannot measure a dimension that rewards a correctly hedged brief on a live
    // game -- under that split, getting that corner RIGHT looks like a
    // regression. Reported alongside rather than instead, so the old number
    // stays comparable to every prior run.
    const scoreable = scored.filter(s => s.is_final !== null);
    const agrees    = scoreable.filter(s => s.finality === FINALITY_MAX);
    const disagrees = scoreable.filter(s => s.finality === 0);
    const abstains  = scored.filter(s => s.finality === FINALITY_MAX / 2);

    // Projected total under the funded weighting: arc 45->33, ctx 25->17, and
    // the 20 those release becomes Dim 11. Nominal total unchanged at 294.
    // dims.arcScore and dims.contextAnchoring are fractions of 45 and 25, so
    // each loses its fraction times the points taken back.
    const projected = (x) => x.total - x.dims.arcScore * 12 - x.dims.contextAnchoring * 8 + x.finality;
    const meanFinality = (set) => set.length ? r1(mean(set.map(x => x.finality))) : null;

    m.finality_2x2 = {
        note: 'READ `blindness` FIRST — it is the only figure here computed without new weights. `gap_projected_definitional` restates FINALITY_MAX and is not evidence. Corpus widened 2026-08-24 to game_recap + game_brief: game_recap is finality-gated by ask 2, so on recaps alone `is_final` is true for every row and half the 2x2 cannot have rows at all. 2x2 of fact x reading, under the funded weighting (arc 45->33, ctx 25->17, finality 20, total held at 294). The LIVE_LANG figures in `rescored` are prose-only and are kept for comparability with earlier runs, not as this dimension\'s metric.',
        strata: strataCounts,
        n_scoreable: scoreable.length, n_agrees: agrees.length,
        n_disagrees: disagrees.length, n_abstained: abstains.length,
        by_verdict: Object.fromEntries([...new Set(scored.map(x => x.finality_verdict))]
            .map(v => [v, scored.filter(x => x.finality_verdict === v).length])),
        // Non-zero on BOTH sides is the done condition Dim 10 would have failed:
        // it scored zero on 190 of 190 rows and passed every aggregate test.
        mean_finality_when_final: meanFinality(scoreable.filter(x => x.is_final)),
        mean_finality_when_live:  meanFinality(scoreable.filter(x => !x.is_final)),
        // THE FINDING, and it needs no new weights: does the CURRENT rubric already
        // separate these rows? If it does, a finality dimension is redundant. If
        // it does not, the rubric is blind to a distinction that matters, and
        // that is measured rather than projected.
        //
        // Carries its error bar. A difference without one is how era 4's 11.5
        // survived for a day.
        blindness: (() => {
            if (agrees.length < 2 || disagrees.length < 2) return null;
            const a = agrees.map(x => x.total), b = disagrees.map(x => x.total);
            const se = Math.sqrt(sd(a) ** 2 / a.length + sd(b) ** 2 / b.length);
            const gap = mean(a) - mean(b);
            return {
                gap_current: r1(gap), se: r1(se),
                ratio_to_noise: se > 0 ? r1(Math.abs(gap) / se) : null,
                verdict: se > 0 && Math.abs(gap) / se >= 2
                    ? 'the current rubric DOES separate these rows — a finality dimension may be redundant'
                    : 'the current rubric CANNOT separate these rows — it scores a correct recap and a hedging one the same',
                n_agrees: a.length, n_disagrees: b.length,
            };
        })(),
        // DEFINITIONAL, not evidence. agrees score FINALITY_MAX and disagrees
        // score 0 by construction, so this gap is ~FINALITY_MAX minus the arc/ctx
        // funding difference. It states the size of the lever, not that the lever
        // is pulling on anything real. The `blindness` figure above is the one
        // that answers whether the lever is needed.
        // ── The manifest checks its own arithmetic. ─────────────────────────
        //
        // mean_finality_when_live read exactly 10.0 on 2026-08-24 while the
        // census said 31 rows at 10 and one at 0, which is 9.7. Reconciling it
        // by hand found a real defect: LIVE_LANG is a SQL predicate and
        // _READS_HEDGED is a JS regex, the regex is WIDER (at the break, through
        // N innings, innings into, currently, remains tied), and a brief the
        // regex calls hedged can sit in the `final-lang` stratum. One did. It
        // scored 20 as a correct hedge on a live game, and 20+0+30*10 over 32
        // rows is exactly 10.
        //
        // TWO DEFINITIONS OF "READS AS IN-PROGRESS", NOTHING FORCING THEM TO
        // AGREE -- the same shape as SCALE's declared weights versus its
        // implementation ceilings, one layer up. SQL cannot run the regex, so
        // they cannot be collapsed into one definition; what they can do is
        // report their disagreement instead of hiding it, and refuse to publish
        // aggregates that do not reconcile with the row census.
        //
        // This runs every time. Nobody has to notice a 10 that should be a 9.7.
        reconciliation: (() => {
            const cell = (rows) => rows.length
                ? { n: rows.length, mean: r1(mean(rows.map(x => x.finality))),
                    from_census: r1(rows.reduce((a, x) => a + x.finality, 0) / rows.length) }
                : { n: 0, mean: null, from_census: null };
            const liveRows = scoreable.filter(x => !x.is_final);
            const finalRows = scoreable.filter(x => x.is_final);
            const live = cell(liveRows), fin = cell(finalRows);
            // SQL says in-progress language; the regex disagrees, or the reverse.
            const disagree = scored.filter(x =>
                !!x.live_lang !== (x.finality_reading === 'hedged'));
            return {
                live, final: fin,
                census_agrees: live.mean === live.from_census && fin.mean === fin.from_census,
                // Every reported aggregate must be derivable from the rows. If
                // this is false the numbers above are describing a different
                // population than the evidence rows, and none of them can be
                // cited.
                totals_add_up: scored.length ===
                    Object.values(strataCounts).reduce((a, b) => a + b, 0),
                // Non-zero here means scoreProse and this script disagree about
                // the SAME row's finality, which can only happen if they were
                // handed different inputs. That is the era-5 first-run defect,
                // and it is now a number rather than a silent flat gap.
                path_disagreement: {
                    n: scored.filter(x => !x.paths_agree).length,
                    note: 'rows where scoreProse Dim 11 and this script disagree. Both call finalityAgreement, so a non-zero count means the ARGUMENT differs -- opts.game missing finalizedAt is the known cause.',
                    sample: scored.filter(x => !x.paths_agree).slice(0, 5)
                        .map(x => ({ id: x.id, in_score: x.finality_in_score, standalone: x.finality })),
                },
                lang_disagreement: {
                    n: disagree.length,
                    note: 'rows where the SQL LIVE_LANG predicate and the JS _READS_HEDGED regex disagree about whether the prose reads as in-progress. Non-zero is expected -- the regex is wider on purpose -- but it must be REPORTED, because it is why a stratum labelled `final-lang` can contain a row scored as a correct hedge.',
                    ids: disagree.slice(0, 10).map(x => ({ id: x.id, sql_live: !!x.live_lang,
                                                           regex_reading: x.finality_reading })),
                },
            };
        })(),
        gap_projected_definitional: (agrees.length && disagrees.length)
            ? r1(mean(agrees.map(projected)) - mean(disagrees.map(projected))) : null,
    };

    const live = scored.filter(s => s.live_lang);
    const fin  = scored.filter(s => !s.live_lang);
    const dimKeys = Object.keys(scored[0]?.dims || {});
    const byDim = (set) => Object.fromEntries(dimKeys.map(k => [k, r3(mean(set.map(s => s.dims[k])))]));

    const liveMean = mean(live.map(s => s.total));
    const finMean  = mean(fin.map(s => s.total));

    m.rescored = {
        n_total: scored.length,
        in_progress: { n: live.length, mean_rescored: r1(liveMean), sd_rescored: r1(sd(live.map(s => s.total))),
                       mean_stored: r1(mean(live.map(s => s.stored))), dims: byDim(live) },
        reads_as_final: { n: fin.length, mean_rescored: r1(finMean), sd_rescored: r1(sd(fin.map(s => s.total))),
                          mean_stored: r1(mean(fin.map(s => s.stored))), dims: byDim(fin) },
        // The number ask 6b has to move. Positive = finals score higher.
        gap_rescored: (liveMean != null && finMean != null) ? r1(finMean - liveMean) : null,
        gap_stored_for_this_sample: r1(mean(fin.map(s => s.stored)) - mean(live.map(s => s.stored))),
        // Which dimension separates the two classes at all. A dimension with a
        // gap of ~0 cannot be reweighted into a penalty -- multiplying zero by
        // anything is still zero, and that is the whole question ask 6b turns on.
        dim_separation: Object.fromEntries(dimKeys.map(k =>
            [k, r3((mean(fin.map(s => s.dims[k])) ?? 0) - (mean(live.map(s => s.dims[k])) ?? 0))])),
        era_spread: [...new Set(scored.map(s => String(s.scoring_version)))].sort(),
    };

    // The honest reading of gap_rescored, stated in the manifest so nobody has
    // to compute it from the numbers beside it.
    const se = seDiff(fin.map(s => s.total), live.map(s => s.total));
    const gap = m.rescored.gap_rescored;
    m.rescored.gap_se = r1(se);
    m.rescored.gap_ratio_to_noise = (se && se > 0) ? r1(Math.abs(gap) / se) : null;
    m.rescored.gap_verdict =
        (live.length < 8 || fin.length < 8) ? 'UNDERPOWERED — fewer than 8 rows in a class, no claim'
        : (m.rescored.gap_ratio_to_noise == null) ? 'no spread computable'
        : m.rescored.gap_ratio_to_noise >= 2
            ? `difference is ${m.rescored.gap_ratio_to_noise}x the standard error of the difference — larger than sample noise`
            : `difference is only ${m.rescored.gap_ratio_to_noise}x the standard error — INDISTINGUISHABLE from noise at this n`;

    // The AFTER half, on the same rows. This is what produces the numbers a
    // SCORING_ERAS `measuredEffect` needs.
    m.candidates = Object.fromEntries(Object.entries(CANDIDATES).map(([name, W]) => {
        const l = live.map(s => scoreUnder(s.dims, W));
        const f = fin.map(s => scoreUnder(s.dims, W));
        const se = seDiff(f, l);
        const gap = mean(f) - mean(l);
        return [name, {
            nominal_total: Object.values(W).reduce((a, b) => a + b, 0),
            in_progress_mean: r1(mean(l)),
            final_mean: r1(mean(f)),
            gap: r1(gap),
            gap_se: r1(se),
            gap_ratio_to_noise: (se && se > 0) ? r1(Math.abs(gap) / se) : null,
            // How much of the scale a finished brief can actually earn under
            // this weighting, given which dims are live on game briefs.
            mean_total_final: r1(mean(f)),
        }];
    }));
    const cur = m.candidates.current?.gap;
    m.candidate_summary = Object.entries(m.candidates)
        .map(([k, v]) => `${k}: gap ${v.gap} (${v.gap_ratio_to_noise}x noise)`
            + (cur ? `, ${r1(v.gap / cur)}x the current gap` : ''));

    // Claim 2 under test. A dim is "live" here if it scored above zero on at
    // least one real row -- the falsifiable form of "unreachable".
    m.dim_reachability = {
        rows_with_joined_game: scored.filter(s => s.joined_game).length,
        rows_with_matchup_note: scored.filter(s => s.has_note).length,
        nonzero_rows_per_dim: Object.fromEntries(dimKeys.map(k =>
            [k, scored.filter(s => (s.dims[k] || 0) > 0).length])),
        verdict_ctx: scored.some(s => (s.dims.contextAnchoring || 0) > 0)
            ? 'REACHABLE — scored above zero on real rows'
            : 'zero on every row in this sample',
        verdict_matchup: scored.some(s => (s.dims.matchupDepth || 0) > 0)
            ? 'REACHABLE — scored above zero on real rows'
            : 'zero on every row in this sample',
    };
} catch (e) { m.error = String(e.message || e); }

const stamp = m.probed_at.replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
writeFileSync(`outbox/rescore-quality-6b-${stamp}.json`, JSON.stringify(m, null, 2) + '\n');
console.log(JSON.stringify(m, null, 2));
if (m.error) { console.error('\nRE-SCORE FAILED — says nothing about the rubric.'); process.exit(1); }
process.exit(0);
