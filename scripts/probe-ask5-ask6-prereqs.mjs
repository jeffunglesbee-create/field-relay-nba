#!/usr/bin/env node
// Unblocks the two remaining brief-data-quality asks. Read-only.
//
// ASK 6b needs a `measuredEffect` number. Every SCORING_ERAS entry records one
// computed from real data ("Dim 4 floored 91.2% -> 7.9%; mean contribution 0.35
// -> 9.89 of 16 pts, n=592"). Changing weights without it means inventing the
// number or filing an era entry that lies by omission. This produces the BEFORE
// half: the current score distribution, split by whether a brief actually
// describes a finished game. The AFTER half comes from re-running this once the
// weights change — that is what makes the delta real rather than asserted.
//
// ASK 5 needs a cost decision before a line is written. Generating from
// keyEvents means an ESPN summary fetch per game inside a */15 cron. Rule 78
// exists because a prior session added two uncached Odds API helpers and burned
// 19,999/20,000 credits in one sitting. This measures the real call volume and
// confirms the payload shape, so caching/TTL and finals-only scoping are decided
// on numbers.

import { writeFileSync } from 'node:fs';

const RELAY = 'https://field-relay-nba.jeffunglesbee.workers.dev';
const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
// site.api 403s CF-Worker egress (2026-08-08 Akamai block); site.web.api serves
// the identical payload. A runner could use either, but matching what the relay
// must use keeps the shape finding applicable.
const ESPN = 'https://site.web.api.espn.com/apis/site/v2/sports';

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

const m = {
    probed_at: new Date().toISOString(),
    query_ok: false,
    // ── ask 6b baseline ──────────────────────────────────────────────────────
    score_by_liveness: [],
    score_distribution: [],
    scoring_version_coverage: [],
    // ── ask 5 cost + shape ───────────────────────────────────────────────────
    espn_calls_per_cron_tick: null,
    espn_calls_per_day_estimate: null,
    keyevents_probe: null,
    keyevents_mlb: null,
    games_per_day_sample: [],
    espn_mb_per_day_estimate: null,
    // ── ask 5 rescope: where DOES baseball event data live? ───────────────────
    // The 2026-08-21 run falsified the ask's premise: MLB summary carries NO
    // keyEvents at all (has_keyEvents: false, 1082 KB payload). Rather than
    // conclude "baseball is impossible" (Rule 3 class E — verify before claiming
    // impossible), enumerate the payload's top-level keys and check the
    // candidates that would carry per-play prose.
    mlb_payload_shape: null,
    mlb_scoring_plays: null,
    keyevents_items: null,
    keyevents_field_union: null,
    keyevents_goal_items: null,
    keyevents_goal_attempts: null,
    assist_structure: null,
    commentary_probe: null,
    keyevents_commentary_setcmp: null,
    enrichment_availability: null,
    other_sports: null,
    error: null,
};

const LIVE_LANG = `( b.brief_text LIKE '%scoreless%' OR b.brief_text LIKE '%at halftime%'
   OR b.brief_text LIKE '%second-half action%' OR b.brief_text LIKE '%first-half action%'
   OR b.brief_text LIKE '%through 4_ minutes%' OR b.brief_text LIKE '%minutes into%' )`;

try {
    // 6b: the inversion, quantified. If briefs describing UNFINISHED games score
    // at or above real finals, the metric is pointed the wrong way — and this is
    // the number that says by how much.
    m.score_by_liveness = await d1(
        `SELECT CASE WHEN ${LIVE_LANG} THEN 'in-progress language' ELSE 'reads as final' END AS kind,
                COUNT(*) AS n,
                ROUND(AVG(b.quality_score),1) AS mean_score,
                MIN(b.quality_score) AS min_score,
                MAX(b.quality_score) AS max_score
         FROM briefs b
         WHERE b.brief_type = 'game_recap' AND b.quality_score IS NOT NULL
         GROUP BY kind`);

    m.score_distribution = await d1(
        `SELECT (b.quality_score / 25) * 25 AS bucket, COUNT(*) AS n
         FROM briefs b WHERE b.brief_type = 'game_recap' AND b.quality_score IS NOT NULL
         GROUP BY bucket ORDER BY bucket`);

    // Confirms ask 6a is taking effect on new rows, and sizes the untagged tail.
    m.scoring_version_coverage = await d1(
        `SELECT COALESCE(CAST(scoring_version AS TEXT),'(null)') AS ver,
                COUNT(*) AS n, MAX(created_at) AS last_written
         FROM briefs WHERE brief_type = 'game_recap'
         GROUP BY ver ORDER BY n DESC`);

    // ask 5: real call volume. One summary fetch per game per tick is the naive
    // implementation; this is what that actually costs.
    // CORRECTED: the first run measured date('now') at 05:15 UTC, before the day
    // was seeded, and read 0. That was the probe's fault, not a finding. Use a
    // 14-day mean of DAYS THAT HAVE GAMES -- a representative tick, not an empty
    // one.
    const vol = await d1(
        `SELECT date, COUNT(*) AS n FROM regular_season_games
         WHERE espn_event_id IS NOT NULL AND date >= date('now','-14 day') AND date < date('now')
         GROUP BY date ORDER BY date DESC`);
    m.games_per_day_sample = vol;
    const days = vol.filter(r => r.n > 0);
    const mean = days.length ? Math.round(days.reduce((a, r) => a + r.n, 0) / days.length) : 0;
    m.espn_calls_per_cron_tick = mean;
    m.espn_calls_per_day_estimate = mean * 96;   // */15 = 96 ticks/day
    m.espn_mb_per_day_estimate = Math.round(mean * 96 * 301 / 1024);  // 301 KB/payload measured
    m.query_ok = true;
} catch (e) {
    m.error = String(e.message || e);
}

// ask 5: does the payload actually carry what the ask assumes? Probed against a
// real finished fixture rather than trusting the CC-CMD's description.
const shape = (j) => {
    const ke = j?.keyEvents;
    return {
        has_keyEvents: Array.isArray(ke),
        count: Array.isArray(ke) ? ke.length : null,
        sample_fields: Array.isArray(ke) && ke.length ? Object.keys(ke[0]) : null,
        first_has_athletes: Array.isArray(ke) && ke.length ? !!ke[0].athletesInvolved : null,
        first_has_text: Array.isArray(ke) && ke.length ? !!(ke[0].text || ke[0].shortText) : null,
        first_clock: Array.isArray(ke) && ke.length ? (ke[0].clock?.displayValue ?? null) : null,
        any_with_athletes: Array.isArray(ke) ? ke.filter(e => e.athletesInvolved?.length).length : null,
        payload_kb: Math.round(JSON.stringify(j).length / 1024),
    };
};

// MLB, because the CC-CMD's own examples are baseball ("Rice's 447-ft homer").
// Soccer alone cannot settle whether the premise holds.
try {
    const mlbId = (await d1(
        `SELECT espn_event_id AS id FROM regular_season_games
         WHERE sport = 'MLB' AND espn_event_id IS NOT NULL AND finalized_at IS NOT NULL
         ORDER BY date DESC LIMIT 1`))[0]?.id;
    if (mlbId) {
        const rm = await fetch(`${ESPN}/baseball/mlb/summary?event=${mlbId}`, { headers: { 'User-Agent': UA } });
        const jm = await rm.json();
        m.keyevents_mlb = { event: String(mlbId), http: rm.status, ...shape(jm) };

        // Ask 5 rescope. keyEvents is absent for baseball; that is a finding
        // about ONE key, not about the feed. Enumerate every top-level
        // container with its size, then describe the fields of whichever
        // candidate actually holds per-play records. No key names are assumed
        // to exist — each is reported present-or-absent from the real payload.
        const topLevel = Object.entries(jm || {}).map(([k, v]) => ({
            key: k,
            type: Array.isArray(v) ? 'array' : typeof v,
            len: Array.isArray(v) ? v.length : (v && typeof v === 'object' ? Object.keys(v).length : null),
            kb: Math.round(JSON.stringify(v ?? null).length / 1024),
        })).sort((a, b) => b.kb - a.kb);

        // Describe any candidate that is a non-empty array of objects: that is
        // the shape a per-play generator would consume. Reporting the actual
        // field names is the point -- ask 5 promises named athletes and prose
        // ("Rice's 447-ft homer"), and only the real keys settle whether the
        // feed supports that for baseball.
        const describe = (arr) => ({
            count: arr.length,
            sample_fields: Object.keys(arr[0]),
            first_has_text: !!(arr[0].text || arr[0].shortText || arr[0].alternativeText),
            first_has_athletes: !!(arr[0].athletesInvolved || arr[0].participants),
            sample_text: String(arr[0].text || arr[0].shortText || '').slice(0, 160) || null,
        });
        const candidates = {};
        for (const { key } of topLevel) {
            const v = jm[key];
            if (Array.isArray(v) && v.length && typeof v[0] === 'object' && v[0]) {
                candidates[key] = describe(v);
            }
        }
        m.mlb_payload_shape = { event: String(mlbId), top_level: topLevel, array_candidates: candidates };

        // plays[0] is "Top of the 1st inning" -- a period marker, exactly the
        // trap that made the soccer read look empty. Judging the feed from
        // element [0] would repeat that mistake. Ask 5 promises named-athlete
        // prose, so sample the SCORING plays specifically and quote them
        // verbatim: that text either carries a player name and a detail or it
        // does not, and nothing short of reading it settles the question.
        const plays = Array.isArray(jm?.plays) ? jm.plays : [];
        const scoring = plays.filter(p => p?.scoringPlay);
        m.mlb_scoring_plays = {
            total_plays: plays.length,
            scoring_plays: scoring.length,
            with_text: scoring.filter(p => p.text).length,
            samples: scoring.slice(0, 5).map(p => ({
                text: p.text ?? null,
                period: p.period?.number ?? null,
                scoreValue: p.scoreValue ?? null,
                has_athletes_field: !!(p.participants || p.athletesInvolved),
            })),
            plays_kb: Math.round(JSON.stringify(plays).length / 1024),
        };
    } else {
        m.keyevents_mlb = { error: 'no finalized MLB row with an espn_event_id' };
    }
} catch (e) { m.keyevents_mlb = { error: String(e.message || e) }; }

try {
    const r = await fetch(`${ESPN}/soccer/uefa.europa.conf_qual/summary?event=401909622`, {
        headers: { 'User-Agent': UA },
    });
    const j = await r.json();
    const ke = j?.keyEvents;

    // The soccer read has now been judged from element [0] twice, and both times
    // it looked emptier than it was -- element [0] turned out to be a period
    // marker on the baseball side. Summary fields cannot settle this. Dump EVERY
    // keyEvent item in full: its type, its prose, its clock, and the athlete
    // names actually attached. Whatever ask 5 can or cannot say about soccer is
    // decided by reading these, not by another boolean.
    if (Array.isArray(ke)) {
        m.keyevents_items = ke.map((e, i) => ({
            i,
            type: e.type?.text ?? e.type?.id ?? null,
            text: e.text ?? null,
            shortText: e.shortText ?? null,
            clock: e.clock?.displayValue ?? null,
            period: e.period?.number ?? null,
            scoringPlay: e.scoringPlay ?? null,
            scoreValue: e.scoreValue ?? null,
            team: e.team?.id ?? null,
            // Both spellings, because which one soccer uses is the open question.
            athletes: (e.athletesInvolved || e.participants || [])
                .map(a => a.displayName || a.athlete?.displayName || a.fullName || null),
            all_fields: Object.keys(e),
        }));
        m.keyevents_field_union = [...new Set(ke.flatMap(e => Object.keys(e)))].sort();
    }

    // The fixture above finished 0-0: all 12 items are kickoff/halftime/subs,
    // and scoringPlay is false on every one. It therefore says NOTHING about
    // what a GOAL event carries -- which is the only item type ask 5 actually
    // needs. Concluding "soccer keyEvents lack scoring detail" from a goalless
    // match would be the element-[0] error at fixture scale. Find a finalized
    // soccer game that actually had goals and dump its scoring items.
    const scored = (await d1(
        `SELECT espn_event_id AS id, sport, home_score, away_score FROM regular_season_games
         WHERE espn_event_id IS NOT NULL AND finalized_at IS NOT NULL
           AND sport LIKE '%League%' AND (home_score + away_score) >= 2
         ORDER BY date DESC LIMIT 1`))[0];
    if (scored?.id) {
        // The league slug is not in the games table, so try the paths this relay
        // already serves. First 200 with a keyEvents array wins; each attempt is
        // recorded so a miss is visible as a miss rather than as "no goals".
        const SLUGS = ['uefa.europa.conf_qual', 'uefa.champions_qual', 'uefa.europa_qual',
                       'usa.1', 'eng.1', 'esp.1', 'ita.1', 'ger.1'];
        const attempts = [];
        for (const slug of SLUGS) {
            const rs = await fetch(`${ESPN}/soccer/${slug}/summary?event=${scored.id}`,
                { headers: { 'User-Agent': UA } });
            const ok = rs.status === 200;
            let items = null;
            if (ok) {
                const js = await rs.json();
                if (Array.isArray(js?.keyEvents)) {
                    items = js.keyEvents
                        .filter(e => e.scoringPlay || /goal/i.test(e.type?.text || ''))
                        .map(e => ({
                            type: e.type?.text ?? null,
                            text: e.text ?? null,
                            shortText: e.shortText ?? null,
                            clock: e.clock?.displayValue ?? null,
                            scoringPlay: e.scoringPlay ?? null,
                            participants: (e.participants || []).map(p => ({
                                name: p.athlete?.displayName ?? p.displayName ?? null,
                                role: p.type?.text ?? p.type ?? null,
                            })),
                        }));
                }
            }
            attempts.push({ slug, http: rs.status, scoring_items: items ? items.length : null });
            if (items && items.length) {
                m.keyevents_goal_items = { event: String(scored.id), slug,
                    final: `${scored.home_score}-${scored.away_score}`, items };
                break;
            }
        }
        m.keyevents_goal_attempts = attempts;

        // ── scorer-vs-assist structure ───────────────────────────────────────
        // Open question from Addendum 3: participants[] listed only the scorer,
        // and role read null off `p.type`. Null on ONE path is not evidence that
        // no role marker exists -- that is exactly the class of inference this
        // session has had to correct twice already. So: dump the participant
        // objects RAW, with no field selection at all, and separately enumerate
        // the soccer payload's top-level containers. If assist data is
        // structured anywhere, it is either a field I did not read on the
        // participant or a container other than keyEvents. Both are covered here
        // without guessing which.
        //
        // One fixture cannot settle it either: Fixture B's assisted goal had a
        // single participant, but a match may attach the assister only on some
        // goals. Sample several fixtures and report each goal's participant
        // count against whether its text says "Assisted by".
        const scoredMany = await d1(
            `SELECT espn_event_id AS id, home_score, away_score FROM regular_season_games
             WHERE espn_event_id IS NOT NULL AND finalized_at IS NOT NULL
               AND sport LIKE '%League%' AND (home_score + away_score) >= 2
             ORDER BY date DESC LIMIT 6`);
        const raw = [];
        let topLevelSoccer = null;
        for (const g of scoredMany) {
            const rs = await fetch(`${ESPN}/soccer/${m.keyevents_goal_items?.slug || 'uefa.europa.conf_qual'}/summary?event=${g.id}`,
                { headers: { 'User-Agent': UA } });
            if (rs.status !== 200) { raw.push({ event: String(g.id), http: rs.status }); continue; }
            const js = await rs.json();

            // Does soccer have a richer per-event container than keyEvents, the
            // way baseball's data turned out to live in `plays`? Enumerated once.
            if (!topLevelSoccer) {
                topLevelSoccer = Object.entries(js || {}).map(([k, v]) => ({
                    key: k,
                    type: Array.isArray(v) ? 'array' : typeof v,
                    len: Array.isArray(v) ? v.length : (v && typeof v === 'object' ? Object.keys(v).length : null),
                })).sort((a, b) => (b.len ?? 0) - (a.len ?? 0));
            }

            const goals = (js?.keyEvents || []).filter(e => e.scoringPlay || /goal/i.test(e.type?.text || ''));
            for (const e of goals) {
                raw.push({
                    event: String(g.id),
                    final: `${g.home_score}-${g.away_score}`,
                    clock: e.clock?.displayValue ?? null,
                    text: e.text ?? null,
                    text_says_assisted: /assisted by/i.test(e.text || ''),
                    participant_count: Array.isArray(e.participants) ? e.participants.length : null,
                    // RAW -- every key, every nested value, no selection.
                    participants_raw: e.participants ?? null,
                });
            }
        }
        m.assist_structure = {
            soccer_top_level: topLevelSoccer,
            goals_sampled: raw.length,
            goals: raw,
        };

        // ── commentary ───────────────────────────────────────────────────────
        // Flagged in Addendum 4: soccer carries `commentary` (20 entries) beside
        // keyEvents (12). Larger container, unverified shape -- and "keyEvents is
        // the soccer container" is the same shape of claim that already proved
        // wrong for baseball, where the data was in `plays`.
        //
        // 20 entries is also suspiciously small for a full match: real
        // minute-by-minute commentary runs to hundreds. So this reports the
        // COUNT per fixture alongside keyEvents' count -- if commentary is a
        // highlights subset rather than full coverage, that is the thing that
        // decides whether it can replace keyEvents, and it is invisible from one
        // fixture. Every item of one fixture is dumped raw; the field union is
        // taken across all fixtures so a key present on only some items shows up.
        const comm = { per_fixture: [], field_union: [], sample_items: null, sample_event: null };
        for (const g of scoredMany) {
            const rc = await fetch(`${ESPN}/soccer/${m.keyevents_goal_items?.slug || 'uefa.europa.conf_qual'}/summary?event=${g.id}`,
                { headers: { 'User-Agent': UA } });
            if (rc.status !== 200) { comm.per_fixture.push({ event: String(g.id), http: rc.status }); continue; }
            const jc = await rc.json();
            const c = Array.isArray(jc?.commentary) ? jc.commentary : null;
            const ke2 = Array.isArray(jc?.keyEvents) ? jc.keyEvents : [];
            comm.per_fixture.push({
                event: String(g.id),
                commentary_count: c ? c.length : null,
                keyEvents_count: ke2.length,
                // Does commentary carry the scoring moments at all, and does it
                // carry ones keyEvents lacks?
                commentary_scoring: c ? c.filter(x => x.play?.scoringPlay || /^goal!/i.test(x.text || '')).length : null,
                kb: c ? Math.round(JSON.stringify(c).length / 1024) : null,
            });
            if (c) {
                for (const k of new Set(c.flatMap(x => Object.keys(x)))) {
                    if (!comm.field_union.includes(k)) comm.field_union.push(k);
                }
                if (!comm.sample_items) { comm.sample_items = c; comm.sample_event = String(g.id); }
            }
        }
        comm.field_union.sort();
        m.commentary_probe = comm;

        // ── per-item set comparison ──────────────────────────────────────────
        // Addendum 5 left "commentary is a superset of keyEvents" explicitly
        // UNVERIFIED: the goal items matched verbatim, but matching on the items
        // you went looking for is not a set comparison. This does the real one.
        //
        // Join key is the event id -- keyEvents[].id against commentary[].play.id
        // -- not the text, because text equality would beg the question and would
        // also silently pair two distinct substitutions with identical wording.
        // Both directions are reported: keyEvents items absent from commentary
        // (which would falsify superset) and commentary play items absent from
        // keyEvents (which would make the containers merely overlapping). Any
        // item that fails to match is quoted, so a miss is inspectable rather
        // than just a count.
        const setcmp = [];
        for (const g of scoredMany) {
            const rr = await fetch(`${ESPN}/soccer/${m.keyevents_goal_items?.slug || 'uefa.europa.conf_qual'}/summary?event=${g.id}`,
                { headers: { 'User-Agent': UA } });
            if (rr.status !== 200) { setcmp.push({ event: String(g.id), http: rr.status }); continue; }
            const jj = await rr.json();
            const ke3 = Array.isArray(jj?.keyEvents) ? jj.keyEvents : [];
            const cm3 = Array.isArray(jj?.commentary) ? jj.commentary : [];

            const keIds = ke3.map(e => String(e.id ?? ''));
            const cmPlay = cm3.filter(x => x.play).map(x => String(x.play.id ?? ''));
            const keSet = new Set(keIds), cmSet = new Set(cmPlay);

            const missingFromCommentary = ke3
                .filter(e => !cmSet.has(String(e.id ?? '')))
                .map(e => ({ id: String(e.id ?? ''), type: e.type?.text ?? null, text: e.text ?? null }));
            const extraInCommentary = cm3
                .filter(x => x.play && !keSet.has(String(x.play.id ?? '')))
                .map(x => ({ id: String(x.play.id ?? ''), type: x.play.type?.text ?? null, text: x.text ?? null }));

            setcmp.push({
                event: String(g.id),
                keyEvents: ke3.length,
                commentary_total: cm3.length,
                commentary_with_play: cmPlay.length,
                // Ids can repeat; report both raw and distinct so a duplicate id
                // cannot masquerade as coverage.
                keyEvents_distinct_ids: keSet.size,
                commentary_distinct_play_ids: cmSet.size,
                missing_from_commentary: missingFromCommentary,
                extra_in_commentary: extraInCommentary,
                is_superset: missingFromCommentary.length === 0,
            });
        }
        m.keyevents_commentary_setcmp = setcmp;

        // ── (B) is near-miss enrichment reliably available? ───────────────────
        // Addendum 6 found Shot Off Target / Shot Hit Woodwork / Foul events in
        // commentary that keyEvents does not carry at all, and flagged them as an
        // enrichment option. Before that option is worth a prompt, it needs the
        // number the 6-fixture sample cannot give: what SHARE of fixtures are
        // rich-tier. If most soccer games come back sparse, an enrichment that
        // only ever fires on a minority is not worth the code.
        //
        // Widened to 20 fixtures. Reports the tier split and the near-miss counts
        // per fixture, so the decision rests on a distribution rather than on the
        // six fixtures that happened to be probed first.
        const wide = await d1(
            `SELECT espn_event_id AS id FROM regular_season_games
             WHERE espn_event_id IS NOT NULL AND finalized_at IS NOT NULL
               AND sport LIKE '%League%'
             ORDER BY date DESC LIMIT 20`);
        const NEAR = /^(shot off target|shot hit woodwork|foul|shot saved|penalty missed)$/i;
        const tiers = [];
        for (const g of wide) {
            const rw = await fetch(`${ESPN}/soccer/${m.keyevents_goal_items?.slug || 'uefa.europa.conf_qual'}/summary?event=${g.id}`,
                { headers: { 'User-Agent': UA } });
            if (rw.status !== 200) { tiers.push({ event: String(g.id), http: rw.status }); continue; }
            const jw = await rw.json();
            const cw = Array.isArray(jw?.commentary) ? jw.commentary : [];
            const near = cw.filter(x => NEAR.test(x.play?.type?.text || ''));
            tiers.push({
                event: String(g.id),
                commentary_count: cw.length,
                near_miss_items: near.length,
                // Which near-miss types actually occur, so the regex above is not
                // silently the thing defining the answer.
                near_types: [...new Set(cw.map(x => x.play?.type?.text).filter(Boolean))],
            });
        }
        m.enrichment_availability = {
            fixtures: tiers,
            // Threshold read off Addendum 5's observed split (20-29 vs 109-112),
            // not invented: nothing sampled has landed between 29 and 109.
            rich_tier: tiers.filter(t => (t.commentary_count ?? 0) >= 60).length,
            sparse_tier: tiers.filter(t => t.commentary_count !== undefined && t.commentary_count !== null && t.commentary_count < 60).length,
            http_failures: tiers.filter(t => t.http).length,
        };
    } else {
        m.keyevents_goal_items = { error: 'no finalized soccer row with 2+ goals and an espn_event_id' };
    }
    m.keyevents_probe = {
        http: r.status,
        has_keyEvents: Array.isArray(ke),
        count: Array.isArray(ke) ? ke.length : null,
        // Shape matters: ask 5 promises "Rice's 447-ft homer", i.e. named
        // athletes and clock. Report whether those fields are actually present.
        sample_fields: Array.isArray(ke) && ke.length
            ? Object.keys(ke[0]) : null,
        first_has_athletes: Array.isArray(ke) && ke.length ? !!ke[0].athletesInvolved : null,
        first_clock: Array.isArray(ke) && ke.length ? (ke[0].clock?.displayValue ?? null) : null,
        payload_kb: Math.round(JSON.stringify(j).length / 1024),
    };
} catch (e) {
    m.keyevents_probe = { error: String(e.message || e) };
}

// ── (A) the remaining three sports ───────────────────────────────────────────
// Soccer and baseball are settled and they landed on DIFFERENT keys -- keyEvents
// vs plays. That is the whole reason these three cannot be assumed: two data
// points that disagree do not extrapolate to a third. Same method as the MLB
// probe: enumerate top-level containers, then describe whichever one actually
// holds scoring records, quoting the prose verbatim.
const OTHER_SPORTS = [
    { sport: 'NFL', path: 'football/nfl' },
    { sport: 'NBA', path: 'basketball/nba' },
    { sport: 'NHL', path: 'hockey/nhl' },
];
m.other_sports = [];
for (const s of OTHER_SPORTS) {
    try {
        const row = (await d1(
            `SELECT espn_event_id AS id, date FROM regular_season_games
             WHERE sport = ? AND espn_event_id IS NOT NULL AND finalized_at IS NOT NULL
             ORDER BY date DESC LIMIT 1`, [s.sport]))[0];
        if (!row?.id) { m.other_sports.push({ sport: s.sport, error: 'no finalized row with an espn_event_id' }); continue; }

        const ro = await fetch(`${ESPN}/${s.path}/summary?event=${row.id}`, { headers: { 'User-Agent': UA } });
        if (ro.status !== 200) { m.other_sports.push({ sport: s.sport, event: String(row.id), http: ro.status }); continue; }
        const jo = await ro.json();

        const top = Object.entries(jo || {}).map(([k, v]) => ({
            key: k,
            type: Array.isArray(v) ? 'array' : typeof v,
            len: Array.isArray(v) ? v.length : (v && typeof v === 'object' ? Object.keys(v).length : null),
            kb: Math.round(JSON.stringify(v ?? null).length / 1024),
        })).sort((a, b) => b.kb - a.kb);

        // Check every plausible container rather than picking one: baseball's
        // data was in `plays`, soccer's in `keyEvents`, and NFL is known to
        // publish `scoringPlays` as well. Report what each one actually holds.
        const containers = {};
        for (const key of ['plays', 'keyEvents', 'scoringPlays', 'commentary']) {
            const v = jo[key];
            if (!Array.isArray(v)) { containers[key] = { present: false }; continue; }
            const scoring = v.filter(e => e?.scoringPlay || /goal|touchdown|score/i.test(e?.type?.text || ''));
            containers[key] = {
                present: true,
                count: v.length,
                fields: v.length ? Object.keys(v[0]) : null,
                scoring_count: scoring.length,
                scoring_samples: scoring.slice(0, 3).map(e => ({
                    text: e.text ?? e.description ?? null,
                    clock: e.clock?.displayValue ?? null,
                    period: e.period?.number ?? null,
                })),
            };
        }
        m.other_sports.push({ sport: s.sport, event: String(row.id), date: row.date, http: 200, top_level: top.slice(0, 12), containers });
    } catch (e) {
        m.other_sports.push({ sport: s.sport, error: String(e.message || e) });
    }
}

const stamp = m.probed_at.replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
const out = `outbox/ask5-ask6-prereq-manifest-${stamp}.json`;
writeFileSync(out, JSON.stringify(m, null, 2) + '\n');
console.log(JSON.stringify(m, null, 2));
console.log(`\nwrote ${out}`);
if (!m.query_ok) { console.error('D1 QUERIES FAILED — says nothing about the data.'); process.exit(1); }
console.log(`\nask 5 naive cost: ${m.espn_calls_per_cron_tick} games/tick -> ~${m.espn_calls_per_day_estimate} ESPN calls/day`);
process.exit(0);
