# ADR-004: aflapi.afl.com.au source acceptance (AFLW), 2026-11-27

**Status:** ACCEPTED by the owner's reply "Accept", 2026-11-27 (see "The decision and how it was reached"). **The written scope limits and triggers below were written after the reply and are awaiting the owner's confirmation**; until confirmed, the scope is exactly what was deployed on 2026-11-27 and nothing wider.
**Decision class:** Source-clearance gate per Rule 45.3 (`jubilant-bassoon/STANDARDS.md` Rule 45, LEGAL-GATE-A, 2026-05-29: "Not reversible without Jeff's approval (ADR-class)").
**Supersedes:** the G0 "RULED 2026-11-23" text of `docs/CC-CMD-2026-11-22-aflw-live-source.md`, which recorded the source choice on the delegation "Go with Claude's best recommendations" without the Rule 45.3(b) decision (see the CC-CMD's "Rule 45.3 status, 2026-11-26").
**Recorded by:** Claude (an AI assistant), on the owner's explicit reply, **after** the source was wired (see RISKS ACKNOWLEDGED, item 6). Not a legal opinion; Claude is not a lawyer and certifies nothing.
**Template:** ADR-003 (stats.nba.com, Drive id 1XUPoayJUTh2Ki_DYXgw8uOAYZoGtpDt2c7510vGq64w, 2026-06-01). Precedents read for this: `outbox/precedents-source-clearance-2026-11-26.md`.

## DECISION

`aflapi.afl.com.au` (the AFL's own API; no key; no contract) is accepted as a relay-side data source for FIELD for **AFLW competition id 3 only**, as built:

- **Reads** (relay `src/index.js`, `readAflapiBoard`, `aflapiGet`): `GET /afl/v2/competitions/3/compseasons?pageSize=100` (edge-cached 3600 s) and `GET /afl/v2/matches?competitionId=3&compSeasonId=<id>&pageSize=200` (edge-cached 30 s; `cacheEverything`, so upstream calls are bounded by the cache, not by client traffic). Request headers: `Accept: application/json`, `User-Agent: FIELD/1.0` (no contact address). An upstream non-2xx, a non-JSON body, a paginated answer or an unmapped status is a named 502; nothing is guessed.
- **Served:** `/v2/games?sport=aflw&date=D` (pull only, `Cache-Control` 15 s, or 300 s for the one empty-season answer), states `pre` (SCHEDULED) and `final` (CONCLUDED) only, until the live spelling is read.
- **Stored (this is DATABASE STORAGE, unlike ADR-003):** `seedAflwArchive` (called once per journalism-cycle tick, 10:00Z to 02:59Z, for today and the next three ET days) writes one row per match to `ARCHIVE_DB` `regular_season_games` through the relay's own `/archive/game`: the fields the code posts are `sport` and `league` (both `AFLW`), `date`, `home` and `away` (club names), `venue`, `start_time`, `source_id` `aflapi:<match id>` (stored as `espn_event_id`), `went_to_ot` null, and `home_score` and `away_score` only once the match is `final`; the route derives the row id `AFLW_<date>_<home>_<away>`. No other aflapi field is posted (read from `seedAflwArchive`, 2026-11-27). Raw aflapi bodies are also committed as evidence and test fixtures in this repository (`outbox/aflapi-aflw-gf-9081-baseline-20261122.json`, `outbox/aflapi-aflw-fixtures-20261123.json`) and, from 2026-11-27, the Grand Final captures (`outbox/aflapi-aflw-gf-9081-<timestamp>.json`, two GETs per slot, seven slots, through the `html_probe` tool from a Cloudflare Worker IP).
- **Displayed:** the laboratory page's AFLW card (field-laboratory `00200dc1`), which reads only the relay.
- **Built in:** relay `9ef280d` (feed), `d002716` (archive step); `CONTRACTS.md` AFLW section (both repos).

## THE DECISION AND HOW IT WAS REACHED

- **The question put to the owner (2026-11-26, the assistant's message):** "Decision, before the 08:40Z reads: accept, recorded in the ADR-003 format, or take the feed off (a code change plus deploy). The seven armed reads also touch aflapi, so they are part of the same decision." and, as its last line, "Next: reply "accept" and I write the ADR-003-format source doc for your sign-off, or "off" and I take the feed down."
- **The owner's reply (verbatim, the whole message; received after the question was put at about 23:52Z on 2026-11-26 and before this record was written at 01:54Z on 2026-11-27; the exact time is not recorded here):** "Accept"
- **What the owner had been shown before replying** (assistant messages of 2026-11-26, in the same conversation): the text of Rule 45.3, quoted; the finding that no page read names aflapi.afl.com.au; the Telstra-titled afl.com.au terms sentence, quoted with ellipses: "You must not otherwise reproduce, transmit … or otherwise use any of the material … except as permitted by statute or with our prior written consent."; that Champion Data's AFLW access needs a licence; the precedents (ADR-003 needed a separate explicit reply after the terms and three risks were put to the owner; no precedent counts a general delegation); that Rule 45.2(c) and (d) apply (monetising materially raises the risk; a qualified attorney before any commercial launch); and where the full quoted terms are (`outbox/aflw-source-read-20261122.md`).
- **What the owner had NOT been shown before replying:** the written text of this ADR (scope limits, triggers, the storage facts above stated as risks). That is why the status above says the written scope is awaiting confirmation.

## TERMS LANGUAGE (verbatim, accessed 2026-11-22; the access method and URL are in `outbox/aflw-source-read-20261122.md`, item 3)

**No document read names `aflapi.afl.com.au`.** From the evidence file: "No AFL-authored statement about aflapi.afl.com.au, an open API, or API access was found." and, under still unresolved: "Which document, if any, applies to calls to aflapi.afl.com.au itself (the Telstra-titled terms, an AFL document, a Champion Data document, or none)? ... No page read names aflapi.afl.com.au." The host's robots.txt: `Error fetching https://aflapi.afl.com.au/robots.txt: CRAWL_NOT_FOUND` (a second read from a Cloudflare Worker IP returned HTTP 404, "Whitelabel Error Page").

The nearest terms page, `https://www.afl.com.au/terms-of-use` (titled "Telstra - Terms of use"), read 2026-11-22:

1. Opening clause: "Your use of a website, including Telstra.com (each a Telstra website) owned by Telstra Corporation Limited (we our or us) is subject to: - these Terms of Use; - the Copyright and Trade Mark Notice; - our Privacy Statement; and - any other terms, conditions, notices or disclaimers displayed on the Telstra website (collectively " Website Terms")."
2. Browser-viewing authorisation and other uses: "You are authorised to view the Telstra websites and its contents using your web browser or, where expressly invited to do so, to share certain content on social media. You must not otherwise reproduce, transmit (including broadcast), communicate, adapt, distribute, sell, modify or publish or otherwise use any of the material on the Telstra websites, including audio and video excerpts, except as permitted by statute or with our prior written consent."
3. Third-party content, publishing and storing: "The text, photos, graphics, audio and video works are only for personal use anticipated by this service and the arrangements with the Copyright Owners (“ the Permitted Use”) and must not, directly, or indirectly, be published, rewritten for broadcast, communication or publication or redistributed in any medium. Such copyright materials and works must not be stored in any electronic or other system except for the Permitted Use."
4. The same notice on Associated Press material: "Associated Press (“ AP”) text, photos, graphics, audio and video material shall not be published, broadcast, rewritten for broadcast or publication or redistributed directly or indirectly in any medium. Neither AP materials nor any portion thereof may be stored in any electronic or other system except for personal, non-commercial use."
5. Which terms govern a page: "If there is an inconsistency between these terms of use and any other terms displayed on individual pages of the Telstra website (" other terms"), the other terms will govern to the extent of the inconsistency."
6. The AFL Privacy Policy (not a terms page) defines the AFL's online estate: "“AFL Online” refers to the AFL website with its top-level domain located at http://www.afl.com.au/, all related sub-domains and any other AFL website (including any AFL Club website) which provides an AFL and AFL Club product, AFL and AFL Club service or AFL-related product or service including related mobile applications."
7. The main headings of the terms section (no heading names automated access, scraping or data): "Changes to the Website Terms | Registration may be required to access | No unlawful, infringing or offensive activity | No viruses or other interference | We may suspend or terminate your access | Content that you submit to the Telstra website | No warranties or representations | Our liability to you | Australian Consumer Law | Your liability to us | Inconsistent terms | No waiver for breaches | Governing law"

Not terms, but read: a 2022 third-party blog, not an AFL statement, says of this host: "The data comes straight from afl.com.au via their afliapi.afl.com.au endpoint for listing matches. You can see this endpoint being called repeatedly from the official fixture page. ... In this case there's definitely some rate limiting or bot detection in place – I'm only calling this API once every 5 seconds, and only building the project a couple of times a day to avoid being blocked."

The licensed alternative (Champion Data), quoted for the alternatives below: "You must be licensed to access the AFLW league and its matches. If it isn't returned by the Leagues endpoint as described below, please contact Champion Data to check if you are correctly licensed."

Published AFL contact points, from the same evidence file (https://www.afl.com.au/contact-us): `digital.feedback@afl.com.au` and `licensingeoi@afl.com.au`. **No one has asked the AFL.**

Whether any of these clauses applies to calls to aflapi.afl.com.au, or to the storing and display described under DECISION, is **not established** and no assessment is made here.

## RISKS ACKNOWLEDGED

1. **No document names the host, and the nearest terms are restrictive in wording.** The posture is the project's own "YELLOW" vocabulary (official, own-site, no explicit grant, restrictive site terms), stated as a description, not a grade of the source.
2. **Storage.** Unlike ADR-003 (no database storage), match facts are written to D1 and raw bodies are committed to this repository. The quoted storing clauses concern third-party content in the Telstra-titled notice; whether they reach match fixtures and scores is not established.
3. **Commercial.** Rule 45.2(c): commercialising or monetising materially raises the risk; 45.2(d): a qualified attorney before any commercial launch. FIELD's commercial status as last recorded (assistant text, 2026-05-29 and 2026-06-22) is "one user, no commercial use" and "no distribution, no urgency"; nothing later was found. Counsel review before commercial launch is required, as for every accepted source.
4. **Unsupported, undocumented API.** No contract, SLA, schema or stability promise; fields, statuses and parameters can change; the in-play status spelling, period and clock have never been read (the Grand Final captures of 2026-11-27 are the first chance). A third party reports rate limiting or bot detection on this host (quoted above). Failure mode: the relay answers a named 502, AFLW cards show no reading, nothing else is affected.
5. **Identification.** The relay sends `User-Agent: FIELD/1.0` with no contact address; the AFL has no stated requirement, but Squiggle's does (2026-11-26), so this is a known soft spot.
6. **The sequence.** The feed was deployed on 2026-11-23 before this decision, against Rule 45.3 and its own wording "ambiguous sources stay OUT until that decision". This record is the correction, not a retroactive approval of the sequence.

## SCOPE LIMITS (explicit, as built on 2026-11-27)

This ADR applies ONLY to:
- aflapi.afl.com.au, AFLW competition id 3, the two read paths above
- Server-to-server reads through the Cloudflare Worker (field-relay-nba), edge-cached as above
- The D1 `regular_season_games` rows described above and nothing else in D1, R2 or KV
- The evidence and fixture files named above and the seven Grand Final capture slots of 2026-11-27 (two GETs each)
- The laboratory page's AFLW card, display only

This ADR does NOT cover:
- Any other competition on aflapi (AFL men's, AFLW preseason or exhibition ids 18 and 19, VFL, etc.): each needs its own Rule 45 review
- Any other aflapi field, endpoint or write of aflapi data beyond the rows above (player data, statistics, per-quarter scores, lineups)
- Redistribution of raw aflapi payloads to third parties, a licensed feed built on it, or any product use beyond display of the AFLW card and its journalism context
- The CFS endpoint (`api.afl.com.au/cfs`, token-gated) or any other AFL host
- Removal or absence of attribution being treated as accepted: no attribution is displayed today and none is required by the text read, which is the owner's call (not built)
- Commercial use

## WHEN THIS ADR TRIGGERS RE-EVALUATION

Mandatory re-evaluation events (this ADR is suspended pending the owner's decision, and the default response is the switch-off below):
1. First revenue event in the FIELD product (any direct sale, ad, sponsor, paid subscription)
2. Any public distribution of FIELD beyond its present use, or a pricing or business-model change
3. Any contact from the AFL, Telstra, or Champion Data about this use (a request to stop, a cease-and-desist or equivalent)
4. The host blocks the Worker, starts requiring a key, or answers with a bot challenge, and recovery would need a workaround
5. Publication of terms or an API programme that names aflapi.afl.com.au, or a material change to the terms quoted above (annual check minimum)
6. Any proposal to widen the scope above (another competition, another field, more storage, redistribution)

**Switch-off (not built as a flag):** remove the `aflw` key from `V2_LEAGUES` and the `seedAflwArchive` call from the journalism cycle, after a consumer diagnostic (Rule 39), and deploy. A fast-flip environment flag was not built; building one is a smaller, safer response and is recommended if the owner wants a one-step off.

## ALTERNATIVE PATHS NOT TAKEN (and why)

- **B, Champion Data's API:** licensed, has `periodDisplay`; needs a licence nothing here can buy before the 2026-11-27 Grand Final; queued as the licensed successor if a licence is ever obtained.
- **C, do not serve AFLW live (the "off" the owner was offered):** not chosen by the owner.
- **Ask the AFL first (the two contact points above):** not done; recommended, and it does not need to block the 2026 season.

## RELATED RULES AND DOCS

Rule 45 (LEGAL-GATE-A). This ADR records Rule 45.3(b), the owner's explicit accept-the-risk decision, pursuant to 45.3(a), the terms read and quoted with date, above. Rule 98 (discovery discipline), Rule 80 (no key is involved), Rule 78 (cached reads, bounded). `docs/CC-CMD-2026-11-22-aflw-live-source.md` (G0, "Rule 45.3 status"); `outbox/aflw-source-read-20261122.md`; `outbox/precedents-source-clearance-2026-11-26.md`. **Matrix and registry:** the Data-Sourcing Legitimacy Matrix (jubilant-bassoon `docs/data-sourcing-legitimacy-2026-05-29.md`) has no aflapi row and `docs/source-registry.json` has no aflapi entry; neither was edited (a grade is not Claude's to give). This ADR carries the posture note in their place.

## EXPLICIT ACCEPT-THE-RISK STATEMENT (Rule 45.3, as recorded)

On 2026-11-27 the owner, Jeff Unglesbee, replied "Accept" to the question of whether to accept the risk of using aflapi.afl.com.au as a data source for FIELD (the feed, the archive rows and the Grand Final captures) or to take the feed off. By that reply the owner accepted the risk of using aflapi.afl.com.au as documented in DECISION and SCOPE LIMITS above, understanding, as put to the owner before the reply, that this is not a legal opinion, that no document read names the host, that a qualified attorney review is required before any commercial launch, and that the accepted use is re-evaluated under the triggers above.

This is a record of the owner's reply. It does **not** attest that the owner has read the written text of this ADR; the owner is asked to confirm or correct the scope limits and triggers.

Recorded by Claude on the owner's explicit "Accept" reply, 2026-11-27, **after** the source was wired (deployed 2026-11-23).

## OPEN, THE OWNER'S

1. Confirm or correct the SCOPE LIMITS and TRIGGERS above (one word is enough; any narrower or wider scope is a new decision).
2. Optional, not built: write to the AFL's published contact points; add a contact address to the User-Agent; display an attribution line; build a one-step off flag.
