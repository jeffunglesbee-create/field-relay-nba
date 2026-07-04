# SUPERSEDED — do not execute

This CC-CMD (circadian KV read endpoint) was written against a stale
understanding of the Circadian System architecture. It is NOT needed.

The authoritative spec ("FIELD — Circadian System Spec Revised," June 20-21
2026, Drive doc 1KkpQtzHIM-sKHsWTON-VohAbTkEsnNeCShXsfSPiQiA) explicitly
supersedes the clock-based model this CC-CMD assumed. The real design is
per-game, computed client-side from `game.state` (already available in
every /v2/games response) — it needs no relay endpoint and no KV read at
all. The orphaned `field:circadian:preview/late` KV keys this CC-CMD tried
to expose are vestigial from an earlier, already-superseded design
iteration and can be left alone (or cleaned up separately — not urgent,
zero functional impact either way).

Superseded by: docs/CC-CMD-2026-07-04-circadian-client-phase-v2.md
(jubilant-bassoon repo, client-only, no relay dependency).

Do not execute this file. Retained for history only.
