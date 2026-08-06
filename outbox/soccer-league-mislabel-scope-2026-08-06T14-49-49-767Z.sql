-- CC-CMD-2026-08-06-apply-soccer-league-label-fix
-- Regenerated fresh in field-relay-nba from a real measured run.
-- Generated: 2026-08-06T14:49:49.117Z
-- Corrects the `sport` column ONLY, scoped by espn_event_id, using each
-- row's own already-correct `league` value. `id` deliberately untouched
-- (analytics-engine.js JOINs briefs.game_id against g.id).

-- regular_season_games: 52 row(s)
UPDATE regular_season_games SET sport = league
  WHERE espn_event_id IN ('761708', '761709', '761707', '761705', '761706', '761703', '761704', '761698', '761696', '761702', '761701', '761700', '761699', '761697', '761695', '401864004', '761693', '761692', '761694', '761691', '761688', '761690', '761689', '761686', '761684', '761683', '761682', '761681', '761687', '761680', '761685', '761676', '761677', '761679', '761678', '761675', '761674', '761672', '761673', '761671', '761670', '761665', '761666', '761667', '761669', '761668', '761664', '761663', '761662', '761661', '761660', '761659')
    AND (LOWER(sport) = 'wc26' OR LOWER(sport) LIKE 'fifa world cup%') AND league IS NOT NULL AND league != '' AND LOWER(league) NOT LIKE 'fifa world cup%' AND LOWER(league) != 'wc26';

-- postseason_games: 0 rows, nothing to correct
