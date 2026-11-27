# AFLW live in-play score, period and clock: other sources (research, 2026-11-27)

**Status: RESEARCH. Nothing is wired, no key was used, nothing was signed up for.** The owner's request: "Find another afl/aflw source." Reason: aflapi v2 served a `LIVE` status but no live score, period or clock during the 2026 AFLW Grand Final (CC-CMD `docs/CC-CMD-2026-11-22-aflw-live-source.md` D3, not met).
Builds on, and does not repeat: `outbox/aflw-source-read-20261122.md` (ESPN none; Squiggle and Kali none; Champion Data licensed; the CFS endpoint reported by third parties), `outbox/precedents-source-clearance-2026-11-26.md`, `outbox/ADR-004-aflapi-afl-com-au-source-acceptance-2026-11-27.md`.
Rule 45: nothing here certifies or green-lights a source and nothing is a legal assessment. Terms are quoted for the owner to read (section 6). Every new source needs the owner's informed, explicit accept-the-risk decision (Rule 45.3(b)) before any build.

## 1. Answer

1. **No source read has been shown to serve an AFLW live in-play score with period and clock.** Every vendor statement below is documentation or a sales page. Nothing was observed in play, because the only AFLW match in play during this work was the Grand Final, and it was captured from aflapi only.
2. **Three candidates document AFLW live data**, all at the same evidence level (`claimed-only` on every live field): Champion Data's licensed API, Sportradar's Australian Rules API, and DataSportsAPI. The order between them below is judgement on the claim text, not a label difference.
3. **The AFL's own other surfaces** (the CFS website API, the match-centre page, the apps) are outside ADR-004's accepted scope ("The CFS endpoint (`api.afl.com.au/cfs`, token-gated) or any other AFL host"). The only AFLW in-play observation anywhere is ours, from aflapi, and it carries no score (section 2).
4. **Nothing to build now.** The lab card already says "live score unavailable" for a live AFLW game with no score, which is the true state of the feed.

## 2. The one first-party AFLW in-play observation (artifact)

Seven capture files `outbox/aflapi-aflw-gf-9081-20261127T*.json`, two reads each (the match record and the `status=L` list), 08:41Z to 11:31Z. Re-asserted today from the committed files:

```
node -e 'const fs=require("fs");const rows=[];for(const f of fs.readdirSync("outbox").filter(f=>/^aflapi-aflw-gf-9081-20261127T\d{4}Z\.json$/.test(f)).sort())for(const e of JSON.parse(fs.readFileSync("outbox/"+f,"utf8"))){const b=typeof e.body==="string"?JSON.parse(e.body):e.body;const m=b.matches?b.matches[0]:b;rows.push({status:m.status,hasScore:!!((m.home&&m.home.score)||(m.away&&m.away.score)),timeKeys:Object.keys(m).filter(k=>/period|quarter|clock|minute|second|live|time/i.test(k)).join(",")})}const live=rows.filter(r=>r.status==="LIVE");console.log("rows",rows.length,"LIVE rows",live.length,"LIVE with score",live.filter(r=>r.hasScore).length,"time-like keys",[...new Set(rows.map(r=>r.timeKeys))].join("|"));console.assert(live.length>0&&live.every(r=>!r.hasScore))'
```

Output (2026-11-27): `rows 14 LIVE rows 12 LIVE with score 0 time-like keys utcStartTime`. The 11:31Z match record is `CONCLUDED` with a score; the `status=L` list at 11:31Z still read `LIVE`. Coverage: this checks the seven files on disk (14 reads), not aflapi at large.

## 3. Ranked shortlist

Labels are as the researchers rated them and the skeptics left them; none was upgraded. "Documented" means the vendor's own page says so; no AFLW payload was read for any row.

| rank | source | names AFLW | live score | period | clock | access | published price |
|---|---|---|---|---|---|---|---|
| 1 | Champion Data AFL Sports Data API | documented (league id 3; "formally supported ... live") | documented (goals, behinds, points; per-period scores) | documented (`status.period`, `periodDisplay`) | documented, poll only (`remainingSecs`; the vendor says it is not a countdown clock) | licence and signed order form; "restricted to AFL accredited organisations" | none found; 50,000 requests/day and 20/s per account |
| 2 | Sportradar Australian Rules Football API | documented ("We cover both Men's and Women's AFL"; competition name `AFL, Women`); the per-competition coverage level is unread | documented (Live Summaries, 1 s cache) | documented (`1st_quarter` ... , `period_scores`, timeline `period_name`) | documented on timeline events "when available" (`match_clock` as mm:ss) | self-serve 30-day trial (1,000 requests per rolling 30 days, 1 QPS); production only by Order Form | none found |
| 3 | DataSportsAPI (and its sibling sportsapi.app) | documented (`aussie-rules`, "AFL and AFL Women", added 2026-11-20) | documented (every quarter's score in points) | documented, partly vendor-filled (`period2` for a break the source sends without a period) | unestablished (null when the source keeps none; AFL not named as a running clock) | self-serve key (Google or GitHub sign-in), Free plan | Free 100 requests/day; Starter $29, Pro $99, Business $499, Enterprise $1,199 per month on datasportsapi.com; sportsapi.app lists different prices (unresolved) |
| 4 | AFL's own: CFS website API, match-centre page, apps | CFS: AFLW ids exist in third-party source (`CD_...264...`) and a completed 2020 payload structure | CFS: men's only, reported by third parties; AFLW not shown | CFS: reported `matchClock.periods` (men's) | CFS: reported `periodSeconds` (men's) | no key, token from a POST; no docs or terms for the API; outside ADR-004 | none |

Lower on the evidence, listed so nobody re-searches them (BUILD-ON-A):

- **The Odds API** (the relay already holds a key): `aussierules_aflw` is listed for odds (historical odds from 2026-08-07). Its Scores & Results cell for AFL Women's is blank while AFL men's has a tick (re-read first-hand 2026-11-27 via `html_probe`: row `Aussie Rules AFL Women's aussierules_aflw` with no tick). That shows non-listing, not tested absence; no call was made (Rule 78). Its documented scores schema (`schema.yml`, header `# 2025-11-05`, per the D skeptic) has no period or clock field for any sport. `grep -rn aussierules_aflw src scripts .github` returns nothing; the relay maps `afl` to `aussierules_afl` only (`src/odds-sport-keys.js:56`).
- **TheSportsDB**: AFLW league page exists (id 5311, 2026 results with scores); livescores are a premium feature per its docs; no AFLW live field read.
- **Sportbex**: its page lists AFL Women's and "quarter-by-quarter scores"; no clock, field names, price or terms; access by contact form. Not trialled.
- **API-Sports AFL, Goalserve**: AFL men's only on the evidence read (Goalserve's coverage list names AFL, AFL Preseason and AFL Postseason; API-Sports' AFL competition list shows one league). The relay's API-Sports subscription lapsed and its integration was removed 2026-06-30 (`src/index.js:915`; no `APISPORTS` string in `deploy.yml`).
- **Squiggle (REST and Event API), Kali, ESPN, BSD, BallDontLie**: no AFLW. Squiggle's Event API stream types are games, events and test, with no competition selector described.
- **FanFooty**: men's clubs and rounds only; no AFLW link found.
- **Flashscore, Sofascore, ABC, Fox Sports, Seven, Wikipedia, Google**: AFLW score pages exist; no official API found for any (Sofascore's FAQ: "we are unable to share the data sources in the form of API endpoints"). Not scraped. Terms quoted in section 6.
- **OpticOdds, Data Sports Group, Genius Sports/BetGenius, Stats Perform**: odds, self-contradicting coverage text (Data Sports Group), not read (Genius), or no Australian rules on the page read (Stats Perform, highlights only, absence not proven). No AFLW live evidence.

## 4. What each candidate would need from the owner (no verdicts)

- **Champion Data**: a licence that covers AFLW (league 3), by order form. The vendor's access sentence is "The AFL API is not publicly available. Access is restricted to AFL accredited organisations." Whether this owner can be licensed at all is unread and is a question for Champion Data. Any contact with Champion Data is ADR-004 trigger 3.
- **Sportradar**: a developer account (a trial is documented as self-serve), then a signed Order Form for production. The trial terms quoted in section 6 bar "publication or display of the Data", so a trial key can check capability only. FIELD's existing `SPORTRADAR_UFL_KEY` is a UFL trial key whose code comment says it expired about 2026-06-26; whether that account holds an Aussie Rules product is unchecked (`deploy.yml:1312`, `src/index.js:1084`).
- **DataSportsAPI**: a sign-in and a key, kept server-side. Its operator and the upstream source of the Aussie rules data are not named on any page read (the terms say "Sports data comes from third-party sources"). That is a Rule 45 matter for the owner. The aussie-rules sport is 7 days old.
- **AFL's own surfaces**: a new Rule 45 decision (CFS and any other AFL host are outside ADR-004), or a written answer to the pending AFL letter (`outbox/aflw-afl-contact-letter-draft-2026-11-27.md`, not sent).

## 5. Recommendation (the owner decides)

1. **Leave AFLW as pre and final, and keep "live score unavailable" for a live game.** It is the true state and costs nothing.
2. **Settle the leading candidate in writing, not by building.** The cheapest settling step for Champion Data is one service-desk question: whether the match endpoint fills `status.period`, `periodSecs`, `periodDisplay`, `remainingSecs` and the score during live AFLW (league 3) matches, whether a sandbox AFLW replay still exists, and whether this owner can be licensed. The researchers report a service-desk ticket needs a name and an email; that was not tested.
3. **One time-limited free check:** DataSportsAPI's Free plan reads back 7 days, so the Grand Final fixture (2026-11-27) leaves the window about 2026-12-04. A key and one `GET /v2/fixtures/{id}` for the Grand Final would show whether AFLW is carried and whether quarter scores and `clock` are populated after play. It cannot show live behaviour. It needs the owner's sign-in (an outward-facing act) and a Rule 45.3 look at the quoted terms first. If not done by 2026-12-04, the cheapest AFLW-specific read is gone until the next AFLW match.
4. **Do not chain fallbacks.** If a second source is ever added, it replaces aflapi for live only; two sources for one field is the Rule 76 pattern.

## 6. Terms and access statements, quoted (Rule 45: read them, no assessment)

Each is verbatim at the URL on the read date, with the skeptic's verdict. Exa returns cached copies; page dates are as printed.

**Champion Data AFL Sports Data API**

- `cd-api-1` (aflw-coverage, documented-by-vendor, skeptic: confirmed; read 2026-11-27): "AFLW matches are supported by all the match endpoints, including the transactions endpoint if you are licensed to access it." https://docs.api.afl.championdata.com/blog/how-to-aflw/
- `cd-api-6` (access, documented-by-vendor, skeptic: confirmed; read 2026-11-27): "PLEASE NOTE: The AFL API is not publicly available. Access is restricted to AFL accredited organisations." https://championdata.atlassian.net/servicedesk/customer/portal/8/group/31
- `cd-api-7` (access, documented-by-vendor, skeptic: confirmed; read 2026-11-27): "Starting this year, the AFL API provides access to Trial Matches to clubs via the Talent Standard/Standard Plus packages. ... Access to either league requires the completed Talent order form for that gender." https://docs.api.afl.championdata.com/blog/2026-trial-matches/
- `cd-api-8` (other, documented-by-vendor, skeptic: confirmed; read 2026-11-27): "The standard limit is as follows. This applies individually to each user or M2M account: - Quota: 50,000 Requests per day - Rate: 20 Requests per second" https://docs.api.afl.championdata.com/support/usage-limits/
- `cd-api-10` (terms): no Champion Data terms, licence, caching or redistribution text for the AFL API was found. `https://www.championdata.com/terms/` returned HTTP 404 from a Worker IP (probe record: `"httpStatus":404,"bytes":147543`); the docs pages read name no terms page. The terms are therefore not read, and a human would ask Champion Data for them.

**Sportradar (trial and production terms; Master Terms cached copy dated 2026-11-13)**

- `SR8` (access, verified-read, skeptic: confirmed; read 2026-11-27): "Sportradar API trials are defaulted at: ... 30-day trial period ... 1,000 requests (quota) per rolling 30 days ... 1 QPS (queries per second)" https://developer.sportradar.com/getting-started/docs/your-account
- `SR9` (terms, verified-read, skeptic: confirmed; read 2026-11-27): "Customer is not authorized, and agrees not to, use the Products in connection with any commercial use or any use involving publication or display of the Data or Content in any form or media." https://developer.sportradar.com/sportradar-updates/page/terms-and-conditions
- `SR10` (terms, verified-read, skeptic: confirmed; read 2026-11-27): "Customer may access and use the Service, solely through the Products designated in the Order Form during the applicable Subscription Periods and in accordance with all Documentation and applicable Rate Limits, for the sole purposes of displaying Data and Content provided through each such Product on the Properties specified for such Product on the Order Form." https://developer.sportradar.com/sportradar-updates/page/terms-and-conditions

**DataSportsAPI and sportsapi.app**

- `DS7` (other, verified-read, skeptic: confirmed; read 2026-11-27): "Sports data comes from third-party sources and is processed by us." https://datasportsapi.com/terms/
- `DS10` (terms, verified-read, skeptic: confirmed; read 2026-11-27): "You may use the data in your own apps, websites, products and analysis, including commercial ones. You may not: … resell, sublicense or redistribute the raw data as a data feed or API of your own, or use it to build a competing data service;" https://datasportsapi.com/terms/
- `sa-8` (terms, verified-read, skeptic: confirmed; read 2026-11-27): "Sports data comes from third-party sources. Live data can be late, incomplete or wrong, and it can be corrected afterwards. Do not rely on it alone for decisions where an error could cause loss (for example betting, trading or settling contracts)." https://sportsapi.app/terms
- `sa-9` (terms, verified-read, skeptic: confirmed; read 2026-11-27): "You may not redistribute, resell, sublicense or give access to the data as data: for example as your own data feed, API, download, dataset or bulk export, or by passing your key or our responses on to others. Showing the data to the users of your own product is allowed." https://sportsapi.app/terms

**The AFL (afl.com.au; the page is titled Telstra - Terms of use)**

- `c2-t-browser` (terms, verified-read, skeptic: confirmed; read 2026-11-27): "You are authorised to view the Telstra websites and its contents using your web browser or, where expressly invited to do so, to share certain content on social media. You must not otherwise reproduce, transmit (including broadcast), communicate, adapt, distribute, sell, modify or publish or otherwise use any of the material on the Telstra websites, including audio and video excerpts, except as permitted by statute or with our prior written consent." https://www.afl.com.au/terms-of-use
- `c2-t-storing` (terms, verified-read, skeptic: confirmed; read 2026-11-27): "The text, photos, graphics, audio and video works are only for personal use anticipated by this service and the arrangements with the Copyright Owners (“ the Permitted Use”) and must not, directly, or indirectly, be published, rewritten for broadcast, communication or publication or redistributed in any medium. Such copyright materials and works must not be stored in any electronic or other system except for the Permitted Use." https://www.afl.com.au/terms-of-use
- `c2-t-inconsistent` (terms, verified-read, skeptic: confirmed; read 2026-11-27): "If there is an inconsistency between these terms of use and any other terms displayed on individual pages of the Telstra website (" other terms"), the other terms will govern to the extent of the inconsistency." https://www.afl.com.au/terms-of-use
- `c2-robots` (terms, verified-read, skeptic: confirmed; read 2026-11-27): "User-agent: * Disallow: Sitemap: https://afl.com.au/sitemap" https://www.afl.com.au/robots.txt
- `c5-contact` (access, verified-read, skeptic: confirmed; read 2026-11-27): "AFL Partnership Sales Email: PartnershipSales@afl.com.au ... General Enquiries Phone: (03) 9643 1999 Fax: (03) 9643 1875 Email: general@afl.com.au Licensing Enquiries Email: licensingeoi@afl.com.au Help & Support Email: watchafl@foxsports.com.au Email: digital.feedback@afl.com.au" https://www.afl.com.au/contact-us

**The Odds API**

- `od-9` (terms, verified-read, skeptic: confirmed; read 2026-11-27): "Do not resell, repackage, or redistribute our data as a standalone data product. This includes, but is not limited to, offering our data through your own API, data feed, downloadable files, or any other format intended to serve as a source of raw data for others." https://the-odds-api.com/terms-and-conditions.html
- `od-10` (terms, verified-read, skeptic: confirmed; read 2026-11-27): "All market data provided via the Service is aggregated from publicly accessible sources available to the general public on the public internet, as well as from third-party interfaces or data feeds where access has been granted via express permission." https://the-odds-api.com/terms-and-conditions.html

**TheSportsDB**

- `tsdb-6` (terms, verified-read, skeptic: confirmed; read 2026-11-27): "You can scrape, copy and modify content returned from the API using the official end points, subject to the image licensing and third-party rights requirements below. Please do not scrape our website." https://www.thesportsdb.com/docs_terms_of_use.php
- `tsdb-7` (terms, verified-read, skeptic: confirmed; read 2026-11-27): "Free API Usage You may use our API to lookup data and artwork for your development projects. You cannot publish apps to an appstore unless you are a paid subscriber. Paid API Usage You may use our API to develop apps and services as long as you stay within the rate limit." https://www.thesportsdb.com/docs_terms_of_use.php
- `tsdb-8` (terms, verified-read, skeptic: confirmed; read 2026-11-27): "Third-party content You cannot use third-party content in the API unless you have the owner's permission or are legally permitted to do so. Reselling You cannot resell our API in any way without specific permission." https://www.thesportsdb.com/docs_terms_of_use.php

**Flashscore (Livesport) and Sofascore**

- `fs-2` (terms, verified-read, skeptic: confirmed; read 2026-11-27): "You may not burden our server on which the Application is run with automated requests, nor may you assist a third party in such activity. You may not modify, disassemble, decompile, or reverse engineer the Application in any way. Furthermore, you may not use the content of the Application by embedding, aggregating, scraping, or re-creating it without our express consent, unless otherwise provided by generally binding legal regulations." https://www.livesport.eu/terms-of-use/en
- `fs-3` (terms, verified-read, skeptic: confirmed; read 2026-11-27): "The contents of the database contained in Application (" Database Content") are protected by a special right of the database provider. Unless otherwise agreed in writing with us, Database Content may only be lawfully used to the extent and in the manner provided by the applicable law." https://www.livesport.eu/terms-of-use/en
- `sf-1` (access, verified-read, skeptic: confirmed; read 2026-11-27): "We regret to inform you that, due to agreements with our data providers, we are unable to share the data sources in the form of API endpoints." https://sofascore.helpscoutdocs.com/article/129-sports-data-api-availability
- `sf-3` (terms, verified-read, skeptic: confirmed; read 2026-11-27): "You must not use data mining, robots or similar gathering or extraction methods in respect of any content on our Platform." https://torneo.com/terms-of-service

Not quoted here, in the evidence file: ABC, Fox Sports, Seven, Wikimedia and Google terms (class E, `bc-2` to `bc-7`), Squiggle (`sq-7` to `sq-9`), the 2012 AFL media-accreditation clauses (class A, `c5-accred-b`, `c5-accred-c`), and the API-Sports and Goalserve statements.

## 7. Corrections to earlier statements, and contradictions the skeptics found

- The earlier CC-CMD line that the CFS API "reportedly carries `score.status` and `score.matchClock.periods`" stands as a third-party report, but the men's example in fitzRoy-ts issue 145 was downgraded by the skeptic (`overreach`): the score shown was a quarter-time snapshot with status `LIVE`, five minutes past the siren, not an in-play running score. No AFLW payload with live fields exists in anything read.
- "No live AFLW match until August 2027": the August figure was never sourced (D skeptic). The CC-CMD already says "the 2027 season date is not read"; this is the same fact.
- The Odds API's AFLW rating split three ways across classes (`evidenced`, `claimed-only`, `none` for live score). The substance is one table row with no tick. This document says "not listed".
- Champion Data: the skeptic downgraded three sandbox labels from `verified-read` to `documented-by-vendor`, and the SNS (push) rating from a score source to a refresh trigger (the Match Score message carries no score value). The sandbox AFLW replay is contested (a 2026 page copy lists three AFL replays and no AFLW; a 2024-07-30 post says an AFLW replay exists).
- Sportradar: the Marketplace page for `AFL, Women` showing only "Odds Comparison Regular API" is non-discriminating (the men's page renders the same text). The Coverage Matrix that would show the AFLW level is JavaScript-rendered and unread.
- DataSportsAPI and sportsapi.app: price and free-tier figures differ between the two domains; the 2026-11-24 "lower prices" changelog entry may explain it. They were not merged.
- aflapi ids carry Champion Data prefixes (`CD_C264`, `CD_M20262641601`, read in our own captures); the CFS ids in the third-party source use the same scheme. That is an observation about identifiers only; it says nothing about licensing.

## 7a. Found but not assessed, for a human (Rule 45)

- The AFL Live Official App needs a free AFL iD to see live scores from 2026-11-16 (afl.com.au news 1636595, a search highlight). A change to the app's access, not a data route.
- The AFL's "Non-Broadcast Rights Holders" page and the AFL Regulations clauses 29.3 ("Media Rights for AFL Spectacles Vest in AFL") and 29.4 ("Rights Exclusive to AFL") were not read; only the table of contents surfaced. They are the documents most likely to speak to third-party live updates.
- A 2012 AFL media-accreditation annexure (alrc.gov.au submission 232) has clauses on match-statistics services and update frequency; its context is accredited media applicants in 2012. Quoted in the evidence file only, no inference drawn.

## 8. Coverage, method, and what was not read (Rule 91)

- Workflow `wf_f694b795-879`: 11 agents (five researchers by class: AFL-own, Champion Data, commercial, in-house, aggregators; five skeptics, one per class, instructed to refute by re-reading primary sources; one completeness critic). 491 tool uses. All 5 classes completed.
- Skeptic verdicts: **282, of which 260 confirmed and 22 not** (11 `overreach`, 8 `unconfirmed`, 3 `quote-not-verbatim`; none `refuted`). Per class confirmed/total: AFL-own 41/42, Champion Data 42/46, commercial 43/47, in-house 45/51, aggregators 89/96. The full per-claim data (quote, URL, label, read date, verdict) is `outbox/aflw-live-score-sources-evidence-2026-11-27.json`.
- My own first-hand checks today: the Odds API sports table row (`html_probe`), the DataSportsAPI aussie-rules page (`html_probe`: "Aussie Rules API for the AFL and AFL Women, finals series included ... live scores while play is on", Free plan 100 requests a day and 7 days of history), `grep` of the relay for `aussierules_aflw`, `APISPORTS`, `SPORTRADAR_UFL_KEY`, the capture assertion in section 2, and a `llms-full.txt` read of DataSportsAPI (first 60,000 characters: no Aussie rules status list reached).
- **Not reproduced by me:** the Champion Data docs pages. A Worker-IP GET of `docs.api.afl.championdata.com/blog/how-to-aflw/` returned HTTP 400 (an Auth0 error page), so every Champion Data quote is from an Exa cached copy, confirmed by the skeptic through the same route.
- Not called: `aflapi.afl.com.au` (beyond the earlier captures), `api.afl.com.au`, any POST, any token or key, any sign-up. No repository file was edited by the researchers.
- Unread: the Sportradar Coverage Matrix; the `aussie-rules` schema in DataSportsAPI's `openapi.json`; the Champion Data `/v1/metadata/matchstatus` list (auth-gated); the Goalserve terms body; sofascore.com's own terms (HTTP 403); API-Sports' primary AFL docs page; Genius Sports; the AFL Non-Broadcast and Regulations text. Absence of a vendor from this list is not proof it does not carry AFLW.
- No live behaviour of any candidate was observed.
