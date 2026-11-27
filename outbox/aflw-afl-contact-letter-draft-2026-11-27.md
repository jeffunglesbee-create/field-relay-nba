# Draft letter to the AFL's contact points about aflapi.afl.com.au (AFLW), 2026-11-27

**Status: DRAFT. Not sent.** Nothing in this repository or session can send mail; the owner sends it, from the owner's own address, if the owner chooses to.
CC-CMD `docs/CC-CMD-2026-11-22-aflw-live-source.md` Task 6a; `outbox/ADR-004-aflapi-afl-com-au-source-acceptance-2026-11-27.md`.

**Before sending, the owner decides three things** (each is in square brackets in the letter, and each is the owner's to state, not mine):
1. Who the letter is from and how the AFL may reply (the draft carries no name and no address).
2. Whether the sentence about what FIELD is today is true to say. The ADR records the project's commercial status as last written down (2026-05-29, 2026-06-22) as "one user, no commercial use"; nothing newer was found. This draft does not assert it.
3. Whether to send it at all. Sending starts a contact with the AFL, and **any reply, from the AFL, Telstra or Champion Data, is trigger 3 of ADR-004**: record it there before anything else is built on the feed.

This draft makes no statement about what the AFL's terms allow (Rule 45.1) and does not describe the use as permitted. It asks.

Where the facts come from, so the owner can check each one before signing (the 14 requests of the Grand Final day are the seven files `outbox/aflapi-aflw-gf-9081-*.json` dated 2026-11-27, two reads each; the other hand reads are not counted exactly, which is why the letter says "a few times"): the two request paths and cache times are `readAflapiBoard` and `aflapiGet` in the relay's `src/index.js`; the stored fields are what `seedAflwArchive` posts (ADR-004, "Stored"); the display line is `Desk.sourceLineFor` in field-laboratory; the User-Agent and the off switch are CC-CMD Task 6b and 6d.

---

**To:** digital.feedback@afl.com.au, licensingeoi@afl.com.au
**Subject:** A question about using aflapi.afl.com.au for AFLW match data

Hello,

I run a small sports-scores project called FIELD. [Owner: state here what FIELD is today, in your own words, for example whether it is a personal project and whether anyone pays for it. This draft does not say.]

FIELD reads AFLW fixtures and results from your public match API, and before going further I would like to ask which terms apply to that use, and whether it is acceptable to you.

**What is read.** Two requests, to the AFLW competition only (competition id 3), with no key, from a Cloudflare Worker:

- `GET https://aflapi.afl.com.au/afl/v2/competitions/3/compseasons?pageSize=100`
- `GET https://aflapi.afl.com.au/afl/v2/matches?competitionId=3&compSeasonId=<season id>&pageSize=200`

Both responses are cached, the season list for an hour and the matches for 30 seconds, so the number of requests to your API depends on that cache and not on how many people look at the page. Nothing is read for any other competition. While building and testing this I also read, by hand and a few times, the competitions list, single matches (`/afl/v2/matches/<match id>`) and the same matches list filtered by status; on the day of the 2026 AFLW Grand Final I made 14 such requests, seven each of two URLs (the Grand Final's own match record and the list filtered to live matches), spread from before the start to after the final siren. Requests identify themselves with the User-Agent `FIELD/1.0` [and, once the owner has set it, a contact address: delete this clause if it is not set].

**What is stored.** For each match: the competition label (AFLW), the date, the home and away club names, the venue, the start time, your match id, and the final score once the match is concluded. Responses for a few matches are also kept as test fixtures in the project's source repository.

**What is shown.** A score card on the FIELD page for each AFLW match, with a small line under it that reads "Data: AFL". Nothing on the page claims a licence, a partnership or your endorsement.

**What I would like to know.**

1. Which terms govern the use of aflapi.afl.com.au, and does this use fit them?
2. If it does not, or if a licence is needed, what would you like me to do? I can switch the AFLW feed off at any time, and will do so on request.
3. Whom should I write to in future about this?

Thank you for your time.

[Owner: name, and the address the AFL may reply to]
