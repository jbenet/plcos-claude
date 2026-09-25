# W1c — The fact check: re-read each fact's own source, and say whether it says what the fact says
The rules in force; `docs/19-enrichment-workflows.md` keeps the design and the history (its W1c row, W1 1.26 and 1.46, and the log).

## Inputs

- The findings the launch names, `data/real/enrich/raw/<key>.json` (the shape: `lib/enrich/schema.ts`).
- Only the URLs they cite: no search, no other page, no sign-in.
- The standard each fact is held to: W1's rules for a fact, in `w1-profile.md`, "Facts".

## Output

The review file the launch names, `data/real/enrich/fact-review-<NN><part>.jsonl`: `NN` is the round, in
two digits, and each agent's part takes a letter (`01a` and `01b` are two halves of round one). One JSON
line per finding:

    { "key": "<key>", "identity": "holds" | "doubt" | "wrong", "identityNote": "<why>",
      "facts": [{ "i": <index in facts>, "grade": "supported" | "partly" | "not supported" |
                  "someone else" | "unavailable", "note": "<what differs, or why it wasn't read>" }],
      "counts": { "supported": n, "partly": n, "notSupported": n, "someoneElse": n, "unavailable": n } }

Every fact gets a grade, spelled as above: the enrichment page counts them by round. A grade is an
agent's reading against the written rules, a measure of the loop — never the team's verification of a
fact, and never a verdict on an LP.

## Firm rules

Verbatim, from AGENTS.md's "Real data" (CLAUDE.md imports it) and W1's rules:

- A search may carry an LP's name with their organization, title, location and topic words, to read
  public pages. It never carries a status, an amount, a note, a list name, or the fact that they are in
  this pipeline. (The check sends no search; a cited URL that carries a query is fetched as cited, and
  only if it keeps to this.)
- A request carries no identity of ours: no email, name or product name in any header — a User-Agent
  included (docs/19, W1 1.36). Where a service requires a contact address (SEC's fair-access policy asks
  for one in the User-Agent), use `blue.tunguska@agentmail.to` — Juan's privacy-preserving address, 24
  Sep 2026 — and nothing else; a service that wants more identity than that is asked about first. Juan's
  own address is never used in a request.
- Government sites are read sparingly and by their own rules: SEC at most one request a second (its
  limit is ten), no bursts or loops over names, and a 403, 429 or 503 means stop and come back later (W1
  1.48).
- No sign-ins, no paid services, no contact-data brokers, nothing posted.
- Record **no health information** about them or their family. A note in the review carries no health
  detail (write "[health detail]" if it matters).
- Everything real lives under `data/real/`, which git ignores. None of it goes into a commit, the
  changelog, a screenshot, the published build log, `issues/`, a web search or a sub-agent prompt. The
  reply carries counts only.

## Reading the cited page

- Fetch the URL the fact cites and nothing else. A page that won't load is `unavailable`; the check
  never finds the fact on another page.
- Ask the reader for the exact sentence, never a summary: its first answer overstates relations, amounts
  and acquirers. Tell it to leave out religion, health, politics and addresses.
- On a page drawn by script or a logo wall, the page's own HTML decides — its static text, image file
  names and link targets — over the reader's answer.
- A paywall (a `402`, a redirect to a pay-per-crawl gateway), a sign-in wall or a browser checkpoint:
  `unavailable`, never bypassed. A 403, 429 or 503 stops that site: come back to it late in the run, and
  if it still refuses, `unavailable` — never `not supported`.
- Quotes can be checked mechanically: fetch each page once with a generic User-Agent and test each quote
  as a normalised substring of the page's own text, skipping SEC filings (read those through the fetch
  tool, at one request a second). It catches paraphrases, stitched quotes and invented labels. A
  standing script for it is still to be written.

## Grading

A fact, against W1's standard — one fact, one page, every part of it on that page and said there of that
subject, in the page's own words:

- **supported** — every part is there: each list item, sector, role word, count, relation, date and
  `detail` name; the quote word for word, and on a page about several people from the section under the
  LP's own name.
- **partly** — some of it is; `note` says what isn't. The usual causes: a detail brought in from a
  second page; a description, sector or `detail` name the page doesn't give (a fund name made by analogy
  with a sister fund's); a stronger word than the page's ("joined" for "offered", "acquired" for "joined
  forces"); words that are on the page but said there of something else, or of a colleague.
- **not supported** — the page doesn't say it.
- **someone else** — the page is about another person or entity than the finding's.
- **unavailable** — the page couldn't be read; `note` says why.

The identity, on the pages the finding cites: **holds**, **doubt** (they leave it open: `identityNote`
says why), or **wrong** (they show the finding is about someone else).

## Correcting the findings

The second step, from the grades, by rule — and only from the pages the finding already cites:

- cut a fact to its page's words, or rewrite it to what the page says; split a fact into facts of their
  own, each on a page the finding already cites; remove a `detail` field the page doesn't state; move a
  claim that rested on a search summary, a snippet or a page never read to `cautions`, as unconfirmed;
  remove a fact that rested on a broker alone, and anything W1 forbids (health, a special category, an
  address, an email, a phone number);
- then align the rest of the finding to its facts, so no cut claim survives in the summary, the
  identity's basis, the interests, how they invest, the signals, capacity's basis or a connection's
  basis.

Each correction is listed in `researched.corrected` as `{ at, by: "claude (sub-agent), W1c", what }`,
and `researched.at` does not move: what was read when stays true, and a strategy written before the
correction is stale. A correction changes no identity; one in doubt says why under `cautions`. Left for
a person, unchanged: an identity field — a place, a role, an organization — that rests on a page that
wasn't read (W3 and the counsel gate read them), and a capacity band whose basis lost its only figure.

## Running W1c as a sub-agent

The `fact-checker` agent, on a small model: the check is mechanical. A local sub-agent may read a
research batch under `data/real/enrich/` and write its findings back there; its prompt still carries no
real data, and it never runs remotely.

1. Read this file, `lib/enrich/schema.ts`, and "Facts" in `w1-profile.md`.
2. For each finding named, fetch only its cited URLs, grade every fact and the identity, and write one
   line to the review file named. Correct the findings only when the launch asks for that step.
3. Write only the review file (and, when asked, those findings); no git.
4. Reply with counts only: findings; facts by grade; identities by verdict; partial grades by cause.

## The check

No script checks the review file yet; the enrichment page reads it and skips a line it can't parse.
Before replying: each line parses; each finding has one line and each of its facts one grade, spelled as
above; `counts` match the grades. After corrections, `DATA_PROFILE=real npx tsx scripts/enrich-check.ts`
reports no problem in the corrected findings.

**No retry loops, and no sub-agents** (round 03): a refusal (403, 429, 503) is retried at most once,
later, never in a loop; and the fact check runs in one agent per batch — nested agents stalled on the
concurrency cap and one of them silently lost its fetches.
