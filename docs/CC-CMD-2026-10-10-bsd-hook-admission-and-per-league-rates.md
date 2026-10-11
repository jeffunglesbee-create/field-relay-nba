# Claude Code Command — pooled rates hide per-league holes, and absence is sometimes the better hook

**Date:** 2026-10-10
**Repo:** field-relay-nba
**Branch:** main — commit directly, do not create a feature branch or PR
**Type:** B (gap) — the census measures the right thing at the wrong grain
**Status:** FILED, not started.

**Second CC-CMD per Rule 87.4**, opened rather than editing
`docs/CC-CMD-2026-10-10-bsd-fields-already-arriving.md`, which closed DONE
today. Its four tasks were executed and its done conditions met; reopening a
closed document to add work would make its closure unreadable. Everything here
builds on its artifact, `outbox/bsd-field-census-latest.json`.

## What its census already proved, and what it cannot yet see

The census is the reason three recommended fields were killed in one run. It
splits `absent / null / empty / present` per field with a `weather` control at
193/193, and the result:

| field | rate | state |
|---|---|---|
| `has_xg`, `is_local_derby`, `is_neutral_ground`, `round_label`, `stage`, `stage_name` | 100% | usable |
| `home_coach_id`, `away_coach_id` | 97.9% | usable |
| `round_number` | 94.3% | usable |
| `head_to_head` | 81.3% | usable, and complete where present |
| `pitch_condition`, `travel_distance_km` | 79.8% | usable |
| `referee_id` | 70.5% | usable |
| `highlights` | 31.6% (132 empty) | thin |
| **`attendance`** | **0% — null 193/193** | dead |
| **`round_name`** | **0% — empty 193/193** | dead |
| **`previous_leg_event_id`** | **0% — null 193/193** | dead |

Three of the eleven fields the parent document set out to forward carry nothing.
Forwarding them anyway is correct and honest — a consumer learns the vendor
states nothing — but **no journalism dimension may be built on them**, and the
chat recommendation that led to the parent document named `attendance` and
`previous_leg_event_id` as editorial hooks. They are not.

`round_name` costs nothing: `stage`, `stage_name` and `round_label` all read
100% and `round_number` 94.3%. Four encodings of one fact, one of them empty.

## Task 1 — rates PER LEAGUE, because the pooled number can be a lie

`pitch_condition` and `travel_distance_km` are **both** exactly 154 of 193, both
missing exactly **39**. An identical denominator on two unrelated fields is
unlikely to be random absence; the probable cause is a league or a provider
tier that serves neither.

If that is the shape, 79.8% pooled is consistent with **100% in the Bundesliga
and 0% in the National League** — and then every National League brief is
systematically missing the hook while the headline rate looks healthy. A
dimension scored against a pooled rate would read as 80% covered and be
structurally blind to a whole competition.

**Group the census by `league_id` and report per-league presence with a
denominator per league.** Then answer the specific question: are the 39 rows
missing `pitch_condition` the SAME 39 missing `travel_distance_km`? Print the
overlap. Same-rows means one cause; different rows means two, and two causes
need two answers.

Rule 91 as this repo applies it: print the coverage where the result is read.
A per-league table with one league at 0% is actionable; "79.8%" is not.

## Task 2 — where absence has a meaning, make the absence readable

`head_to_head` is missing on 36 rows. `referee_id` on 57. Different counts, so
different causes — and the likeliest reason two clubs have no head-to-head
record is **that they have never met**, which is a stronger line than any win
rate: *"first meeting between these two."*

That only works if the pipeline can tell **"never met"** from **"we could not
read it."** It currently cannot — both are a null `head_to_head`. Rule 99 says
absence must be a sibling of the value; the product consequence is that one kind
of absence is a hook and the other is a gap, and collapsing them loses a story
and hides a defect at the same time.

Discriminate what is discriminable, and say what is not:

- `head_to_head` null **and** the fixture is a first competitive meeting → a
  stated fact. The test available without new calls: `total_matches` is absent
  entirely, versus present-and-zero. If the vendor never serves the zero case,
  say so — then "never met" is **not** distinguishable from unreadable from this
  endpoint alone, and that is the finding rather than a feature.
- `is_neutral_ground` is 100% present, so a neutral venue is already a stated
  fact and needs nothing.
- `referee_id` null on 57 of 193 — do NOT guess at a meaning. Report the rate
  per league from Task 1 and stop there.

**Do not invent a reason for an absence.** Three fields were killed today
because schema presence was read as data presence; inferring intent from a null
would be the same error one level deeper.

## Task 3 — write the admission criterion down, beside the dimension that learned it

The reason three dead fields were recommended is that a census of field *names*
(`outbox/bsd-newsletter-claims-latest.json`, 60+ names) was read as a census of
field *data*. The fix that generalises is a stated bar for admitting any field
as a journalism input.

`src/journalism-quality.js:105` already contains the reasoning, about why
populating `regular_season_games.note` would have made Dim 10 **worse**:

> the note is injected into the prompt, so counting note words in the prose pays
> 30 points for parroting an input … Margin agreement reads a RELATION between
> two numbers that is present on ~100% of finalized rows and cannot be copied
> from the prompt.

Record the bar as three properties, beside that comment, in the file that owns
the rubric:

1. **Measured presence**, with a denominator, from a census and not a schema.
2. **A relation**, not a value — something the model must compute from two or
   more facts rather than copy from its prompt.
3. **Checkable after the fact** against the row, so a scorer can disagree.

`attendance` fails (2) even when populated: it is a number to parrot. That is
the durable reason to drop it, independent of it being null — and it is why
"find a replacement field" is the wrong question. `head_to_head` versus the
final score passes all three and is the same shape as `marginAgreement`, one
dimension over.

## Task 4 — the census records presence, not values

No sample value appears anywhere in the artifact — confirmed by search. So
`round_label` is known to be present on every row and **its content is
unverified**: whether it reads `"Matchweek 8"` or `"8"` decides whether it can
appear in prose at all, and the same question applies to `stage`, `stage_name`
and `pitch_condition`.

Add one sampled value per named field to the census — a single example, not a
distribution. A field that is 100% present and holds an opaque integer is not
the hook its rate suggests.

## Stop conditions

- No new upstream call for Tasks 1, 2 and 4 beyond what the census already
  fetches. This is a regrouping of rows already read, plus one sampled value per
  field from the same rows.
- Do not drop the three dead fields from the forward. A vendor stating nothing
  is a fact a consumer should be able to see.
- If `total_matches` never appears as zero, STOP on that half of Task 2 and
  report that "never met" is unreachable from this endpoint. Do not synthesise
  it from an empty `recent_matches[]`.

## Done conditions

1. The census reports presence per `league_id` with a per-league denominator.
2. The overlap between the 39 rows missing `pitch_condition` and the 39 missing
   `travel_distance_km` is printed — same rows or not.
3. "Never met" is either distinguishable from unreadable, with a check, or
   recorded as not distinguishable from this endpoint.
4. The three-property admission bar is written beside `journalism-quality.js`'s
   margin-agreement comment.
5. Each named field carries one sampled value, so a 100% rate can be read as
   usable or opaque.
