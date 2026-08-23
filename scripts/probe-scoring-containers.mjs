#!/usr/bin/env node
// PRE-BUILD probe for ask 5 of CC-CMD-2026-08-20-brief-data-quality (Rule 68).
//
// The ask scopes event grounding on ESPN `keyEvents`. A 2026-08-21 measurement
// already found that wrong for four of five sports — MLB/NBA/NHL use `plays`,
// NFL uses `scoringPlays` — and recorded the correction in CONTRACTS.md. This
// probe does not re-litigate that. It answers what the build actually needs and
// no document states:
//
//   1. Does the container hold what the table says, on a REAL finalized game?
//   2. What fields does one scoring item carry? The build needs `text`, and
//      NBA needs something to SELECT on — 119 items per game is a wall, so a
//      lead-change or late-game filter needs a field that actually exists.
//   3. NFL is absent from _ESPN_SPORT_SLUG entirely. Does the football slug
//      work through /espn-summary at all?
//   4. Soccer's slug is hard-coded to fifa.world, which is wrong for EPL. Is a
//      league-specific slug reachable through the same proxy?
//
// Emits shapes and counts, never whole payloads.

import { writeFileSync } from 'node:fs';

const RELAY = 'https://field-relay-nba.jeffunglesbee.workers.dev';
const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

const getJson = async (path) => {
  const r = await fetch(`${RELAY}${path}`, { headers: { 'User-Agent': UA } });
  const t = await r.text();
  if (!r.ok) return { __error: `HTTP ${r.status}`, __body: t.slice(0, 120) };
  try { return JSON.parse(t); } catch { return { __error: 'not JSON', __body: t.slice(0, 120) }; }
};

// slug -> the scoreboard that yields a finalized event id to probe with
const TARGETS = [
  { sport: 'mlb',  archiveSport: 'MLB',  slug: 'sports/baseball/mlb',    container: 'plays',        filter: 'scoringPlay' },
  { sport: 'nba',  archiveSport: 'NBA',  slug: 'sports/basketball/nba',  container: 'plays',        filter: 'scoringPlay' },
  { sport: 'wnba', archiveSport: 'WNBA', slug: 'sports/basketball/wnba', container: 'plays',        filter: 'scoringPlay' },
  { sport: 'nhl',  archiveSport: 'NHL',  slug: 'sports/hockey/nhl',      container: 'plays',        filter: 'scoringPlay' },
  // NOT in _ESPN_SPORT_SLUG. Whether the proxy accepts it is the question.
  { sport: 'nfl',  archiveSport: 'NFL',  slug: 'sports/football/nfl',    container: 'scoringPlays', filter: null },
  // Slug is hard-coded to fifa.world in _ESPN_SPORT_SLUG; eng.1 is the EPL one.
  { sport: 'epl',  archiveSport: 'EPL',  slug: 'sports/soccer/eng.1',    container: 'keyEvents',    filter: 'scoringPlay' },
];

const out = { probed_at: new Date().toISOString(), sports: {}, notes: [] };

for (const t of TARGETS) {
  const rec = { slug: t.slug, expected_container: t.container, event_id: null,
                summary_ok: null, containers_present: null, scoring_items: null,
                item_keys: null, sample_text: null, selection_fields: null, error: null };
  try {
    // Event ids come from the relay's OWN archive, not from ESPN's scoreboard.
    // Run 1 asked /espn-summary/.../scoreboard and got 403 on all six sports:
    // espnSummaryAllowed() permits /sports/{a}/{b}/summary and nothing else, so
    // the scoreboard path was never going to work. The archive already stores
    // the ESPN event id as game_id on game_recap rows — game_recap_epl_401879301
    // — so it is both allowed and authoritative for "a game FIELD actually
    // briefed".
    const q = await getJson(`/archive/query?sport=${encodeURIComponent(t.archiveSport)}&brief_type=game_recap&limit=6`);
    if (q.__error) { rec.error = `archive: ${q.__error}`; out.sports[t.sport] = rec; continue; }
    const ids = (q.results || []).map(r => String(r.game_id || '')).filter(id => /^\d{6,}$/.test(id));
    rec.archive_rows = (q.results || []).length;
    const eventId = ids[0] || null;
    rec.event_id = eventId;
    if (!eventId) {
      // Out of season is not a failure. In August, NBA and NHL have no games,
      // so their containers cannot be measured now and must not be guessed.
      rec.error = rec.archive_rows
        ? 'archive rows carry no numeric ESPN event id'
        : 'PENDING — no game_recap in the archive for this sport (out of season?)';
      out.sports[t.sport] = rec; continue;
    }

    const s = await getJson(`/espn-summary/${t.slug}/summary?event=${eventId}`);
    if (s.__error) { rec.error = `summary: ${s.__error} ${s.__body || ''}`; out.sports[t.sport] = rec; continue; }
    rec.summary_ok = true;
    rec.containers_present = ['plays', 'scoringPlays', 'keyEvents', 'commentary']
      .filter(k => Array.isArray(s[k]) && s[k].length)
      .map(k => `${k}:${s[k].length}`);

    const raw = Array.isArray(s[t.container]) ? s[t.container] : [];
    const items = t.filter ? raw.filter(x => x[t.filter] === true) : raw;
    rec.scoring_items = items.length;
    if (items.length) {
      rec.item_keys = Object.keys(items[0]);
      rec.sample_text = typeof items[0].text === 'string' ? items[0].text.slice(0, 140) : null;
      // What could a selection rule key on? NBA needs one of these to exist.
      const probe = items[0];
      rec.selection_fields = {
        has_text: typeof probe.text === 'string',
        has_period: probe.period != null,
        has_clock: probe.clock != null,
        has_scoreValue: probe.scoreValue != null,
        has_homeScore: probe.homeScore != null,
        has_awayScore: probe.awayScore != null,
        // A lead change is derivable only if both running scores are present
        // on every item, not just the first.
        running_score_on_all: items.every(x => x.homeScore != null && x.awayScore != null),
      };
    }
  } catch (e) { rec.error = e.message; }
  out.sports[t.sport] = rec;
}

// The volume claim the build has to design around, restated from live counts.
const counts = Object.entries(out.sports)
  .filter(([, r]) => r.scoring_items != null)
  .map(([k, r]) => `${k}:${r.scoring_items}`);
out.notes.push(`scoring items per finalized game — ${counts.join(' ')}`);

writeFileSync(`outbox/scoring-containers-${out.probed_at.replace(/[:.]/g, '-')}.json`,
  JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 2).slice(0, 4000));
