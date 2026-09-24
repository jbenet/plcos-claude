# 19 — Enrichment workflows: seeding the strategy from public sources

**Status:** started N64, 24 Sep 2026, from Juan's request that night. A living document: the
design, the protocol the research follows, and the log of what each iteration tried and learned.
The log here uses counts and invented examples; the specifics are in
`data/real/enrich/LOG.md`, which git ignores.

> Please design good workflows for seeding info for the strategy. this might include workflows
> for data enrichment on LPs (so we know them better, or know connectors, etc), workflows for
> processing data about LPs to come up with possible actions, workflows to eval our own public
> presence and materials (to have as context), workflows to grade our own materials and suggest
> improvements, etc. … Lets bound it to: LPs committed, discussing, connecting or selected for now
> … workflows should only read. And store the data you gather in some format before mapping it
> over to the system data.

## What a workflow is here

Each workflow is a bounded job with an envelope (CLAUDE.md, Agent rules): what it reads, what it
may do, what it writes, and how its output is judged. Until the agent runtime lands (L13), Claude
runs them in a working session, the way the note readings were made (N55): the research happens
outside the app, the findings land as files under `data/<profile>/enrich/`, and an import maps
them into the system. The app never reads the web. A mapping can change and be run again without
anything being searched twice.

Every workflow is **read-only toward the world**: public pages only, no sign-ins, no paid
services, no contact-data brokers, nothing posted. A search carries a name, an organization, a
title, a location and topic words — never a status, an amount, a note, a list name, or the fact
that someone is in the pipeline (CLAUDE.md, real data).

## The set

| # | Workflow | Reads | Writes | Judged by |
|---|---|---|---|---|
| W0 | **Research set** — who to read about | the pipeline | `research-set.jsonl` (identity only), `candidates.jsonl` (with where they stand), `team.json` | counts by status; no internal field in the identity file |
| W1 | **Profile an LP** — who they are, how they invest, what they care about | the identity file; public web | `raw/<key>.json` | identity resolved; facts with sources; signal per LP |
| W2 | **Profile us** — the team and the Protocol Labs network | `team.json`; public web | `us/<handle>.json`, `us/network.json` | affiliations that could connect |
| W3 | **Find connections** — who of us, or of our LPs, is near whom | W1, W2, the pipeline, Affinity's contact | `connections.jsonl` | candidate paths, each with a tier and its evidence |
| W4 | **Fit and angle** — how this LP fits each vehicle, and why they'd care | W1, the vehicles' theses | inside `strategy/<key>.json` | gates checked; capacity, affinity, propensity, time to decision, each with evidence |
| W5 | **Strategy and actions** — what to do next, through whom, with what | W3, W4, the pipeline, our notes' readings | `strategy/<key>.json` | the litmus test below |
| W6 | **Our public presence** — what an LP finds when they look us up | public web | `presence/*.json` | graded against docs/05 |
| W7 | **Grade our materials** — what we send, against what LPs need | what W6 finds; materials on file | `presence/materials.json` | graded against docs/01 §4 |
| W8 | **Step back** — the portfolio view: segments, fast deciders, connector leverage, themes, gaps | everything above | `synthesis.md` | "good enough to act on?" |

The import (`/dev/enrich`) maps W1 to research claims and source documents with their provenance
tuple (rule 9), W3 to candidate relationship edges that need a person before they route (rule 6),
and W5 to suggestions a person accepts or dismisses — never a status, a rung or a send.

### The litmus test

Juan: "step back and look at the info available + current proposed strategies: does this look good
enough to act on to translate into results? or can we find much better info out there to improve the
strategy? or can we think of more creative ideas to improve our strategy?" Every iteration ends
with that question, and what it turns up becomes the next iteration's change.

## What the earlier research says to look for

From docs/01, 03, 04, 05, 06 and 13, the fields that matter for an LP, and where to find them:

- **Gates, yes or no:** a check size against our minimum; a mandate that allows a first fund, a
  single sector, a ten-year duration; conflicts (a competing fund, a competing direct position);
  whether they are deploying now. (01 §2.1, 04 §4.2)
- **Capacity** (AUM or liquid net worth, check history, prior fund commitments), **affinity**
  (neuro, health or deep-tech deals, a technical background, a stated interest — never an inferred
  health reason), **propensity** (deploying now, recent commitments, hires, liquidity), and **time
  to decision** (a principal decides in weeks, a committee in months). Each with evidence and a
  date, never collapsed into one number. (04 §4)
- **Who decides**: signs, influences, gatekeeps, informs. In a family office the analyst is the
  first contact and a gatekeeper. (04 §2.3)
- **Timing signals**: a liquidity event, an exit, a new fund, a family office hiring for venture,
  a podcast that says what they think now. (04 §3)
- **Sources, free first**: the firm's own pages, SEC EDGAR full-text search and Form D/ADV/IAPD
  (absence from IAPD suggests an exempt single-family office), 990-PF filings for foundations
  (ProPublica), Wikipedia and press, podcasts and essays. LinkedIn by hand only, never scraped;
  the data aggregators are weak on LPs. (04 §1)
- **Connections**: tie strength is an inverted U, and moderate ties convert best. Existing LPs are
  the most under-asked connectors ("who are the two or three people you think should see this?").
  Podcast guests and service providers make good pools. PL and crypto credibility does not carry to
  traditional family offices. A shared affiliation is tier C and a co-attendance tier D, and both
  need a person before they route. (06 §2–3, rule 6)

## Protocol — W1, profile an LP (version 1)

For one LP from the identity file (`key, name, org, role, location, domains, enriched`):

1. **Identity first.** Search the name with the organization (or the organization a work domain
   points to) and the role. Confirm on at least two of: name and organization, role, location, a
   domain match, and a matching public profile. Affinity's organization can be stale or a
   membership rather than an employer, and the email domain is often the better clue. If the name is
   common and nothing disambiguates, write `ambiguous` and record no facts: a fact about the
   wrong person is worse than none.
2. **How they invest.** One search on their investing: angel deals, funds they back as an LP, the
   fund they run, the check sizes on record, co-investors. For a firm, its program for backing
   other funds, if it has one.
3. **What they care about.** One search on neuro, brain, biotech, health, longevity, AI and deep
   tech, and any stated thesis. Record a public statement with its source. Record **no health
   information** about them or their family; only a stated interest in an area, with its source.
4. **Capacity and timing,** when they are a principal: exits, liquidity, a family office, a
   foundation (990-PF), boards, a new fund or role.
5. **Near us:** any public tie to Protocol Labs, IPFS, Filecoin, the team, or the ecosystem —
   co-investments, boards, talks, past employers.
6. At most one or two page reads, for the firm's own bio or a primary source. No LinkedIn fetches
   (use the snippet), and **nothing from contact-data brokers** (ZoomInfo, RocketReach, ContactOut,
   SignalHire, Apollo, Lusha and the like). No emails, phone numbers or addresses are stored.
7. Write `raw/<key>.json` (schema: `lib/enrich/schema.ts`). Every fact has a URL, a short quote,
   a date if the page has one, and a confidence. The profile's summary rests on the facts.

Budget: four searches and two page reads per LP, a few minutes. Stop early when the picture is
clear; go one search further when a strong signal needs its source.

**Amendments, version 1.1** (from iteration 1):

- **A search summary is a lead, not a fact.** The search tool's summary sometimes states things no
  page it lists supports. A fact taken only from a summary is `low` confidence, citing the result it
  most plausibly came from. Before a *key* signal is recorded as `medium` or `high` — neuro or
  health affinity, LP or fund commitments, capacity — read the page and quote it.
- **Directory profiles are generated**, often summarizing social posts with no citation (VC
  directories, "profile" aggregators). They are `database` sources and `low` confidence: a lead for
  a person to check.
- **A result's URL can be stale** (a firm page that 404s). Try the firm's own site or another
  result before recording its facts elsewhere.

**Amendments, version 1.2** (from iteration 2's first batch):

- **Read the firm's own homepage first**, before any aggregator: for a GP it often gives the thesis,
  the portfolio, assets under management and check size in one page.
- **Ties to us show up in funding news, not name searches.** Search "<their company> raises" or
  "<company> investors": a round names its backers, and a name search seldom finds Protocol Labs
  or Filecoin beside a person.
- **Our records can be wrong or spelled differently.** A title, a role or the form of a name may
  differ from the person's own site; search the public form too, and record the correction under
  `cautions`.
- **The name must be in the article body** before a fact that changes someone's employer or role.
  A headline can be about someone else from the same firm.
- **The budget counts reads that worked.** Pages fail (403, 404, rendered in the browser, paywalled);
  allow one or two retries on another result.
- **Two free methods:** the SEC adviser search returns JSON
  (`api.adviserinfo.sec.gov/search/firm?query=…`) for the IAPD absence check; a LinkedIn post ID or
  an X status ID encodes its timestamp, which can date a signal without opening the site (low
  confidence).
- **Pass the broker domains as blocked** with every search, including people-search sites.
- **Batch by firm.** People at the same firm are researched together, so the firm is read once and
  the overlap is flagged early.

**Amendments, version 1.3** (from iteration 2's second batch):

- **Scope every fact and connection: the person's, or the firm's.** A firm's thesis or portfolio
  says what the firm does, not what the person cares about; a firm's seed check in Protocol Labs is
  the firm's tie, tier C at most for the person (`scope` in the schema; the checker enforces it).
- **Capacity is the likely commitment to one fund**, as a band, labelled an estimate.
- **Search "<name> Protocol Labs" and "<firm> Protocol Labs" as standard**, and read Protocol Labs'
  own blogs (the PL network site, the research site, the Filecoin blog) when a tie appears: they
  documented most of the ties found.
- **Some hosts refuse the page reader** (Medium, Crunchbase, some foundation sites): go to another
  result. The reader paraphrases, so a short verbatim fragment is enough for a quote.
- **Two reads, plus one per key signal** that needs its source.
- **"Probable"** means facts are allowed, each identity doubt stated under `cautions`; W3 then
  prefers our own records to confirm the person before any path through them is trusted.

**Amendments, version 1.4** (from iteration 2's third batch):

- **Affinity's organizations are career history**, not all current: read a bio before calling one
  a mistake, and before calling one current.
- **The "near us" search is cheap and settles it either way:** name plus Protocol Labs, IPFS or
  Filecoin, limited to those sites (`allowed_domains`). A tie that exists is usually on PL's own
  pages; a clean negative is worth recording under `notFound`.
- **Timing signals need dated words** ("IPO 2026", "acquired", "joins", "new fund"). They are also
  where a search summary goes wrong most: read the page before recording one.
- **A quote on a generated investor-profile site is not a statement by that person.**
- **What only a person can check** — the SEC adviser pages and Form ADV (the reader can't open
  them), LinkedIn, paywalled press — goes under `coverage.notFound` as "for a person: …", so the
  gap is visible and someone can close it.
- **Tiers for events:** speaking at a PL-run event is tier C (PL knew of them); attending one is D.
  Tier B is for a documented working relationship — employed, an investor of record, a board.

**Amendments, version 1.5** (from iteration 2's last batch):

- **A Protocol Labs tie is read on its page, and checked to be about the named entity** — not a
  similarly named firm, a portfolio company, or a job board beside it. A search summary confused two
  such firms.
- **A LinkedIn handle on file that matches a search result's URL** is identity evidence without
  opening LinkedIn. A title on file can be out of date; the firm's announcement wins.
- **Staff with no public footprint:** stop after three searches, write `not_found` or `probable`, and
  leave "for a person: LinkedIn" under `notFound`.
- **Dates go in `published` or `detail`,** not in a fact's words (the checker now tolerates them,
  but the field is where they are read from).

## Protocol — W5, strategy for an LP (version 1)

For one researched LP, read: its finding (`raw/<key>.json`), its line in `candidates.jsonl` (where it
stands with us: status, meetings, the last word from them, our notes' summaries), its paths in
`connections.jsonl`, and our side (`us/team.json`, `us/network.json`, with the Neurotech
portfolio). Write `strategy/<key>.json` (schema: `lib/enrich/strategy.ts`):

- **Fit, per vehicle that could apply.** PLC Neurotech I first; PLC Rails for crypto-native LPs;
  a single-company SPV (the one opening now) for a check below a fund's minimum. A verdict and
  why, and the gates: can their mandate take a specialist or emerging fund, a ten-year duration;
  a conflict (a competing fund, a competing direct position). A gate nobody can answer is `unknown`,
  and asking it becomes an open question.
- **The four scores, each with its basis** (docs/04 §4): capacity, as a band that is labelled an
  estimate; affinity, from their record (neuro, health or deep-tech deals, a stated interest, a
  technical background); propensity (deploying now, recent activity, their engagement with us);
  time to decision (a principal in weeks, a committee in a quarter or more).
- **The angle**: why they would care, in their own record's terms — a company they backed, a
  thing they said. Not a generic pitch.
- **The route**: the best path from W3, with its tier. An existing LP who shares a firm or a
  record with them is the first connector to consider (docs/06 §3.3); a C or D path is named as
  a clue to check, not a route to use.
- **The next action**: one concrete, bounded step, by a named person on our side (the pursuit's
  owner when there is one; the team's neuroscientist for a scientist or a neuro specialist; the
  angel-network lead for an angel; Juan for the largest). When, and with which material. Never a deck with a first intro (docs/06
  §5.2), and never anything that would be sent without a person.
- **The ask**: a fund commitment with a range drawn from capacity; an SPV; a re-up; an intro to
  others, for a connector; advice. **The list**: this year's close (fast deciders, warm, already
  engaged) or the 2027 pipeline (committees, cold) — two lists, never one (docs/04 §4.1).
- **Open questions and risks**: what to find out before the ask; what could go wrong (a stale
  status, a conflict, an identity only probable, silence since the last touch).

Never an inferred health reason, never pressure, never a claim the record doesn't carry.

## Log

### Iteration 1 — by hand, six LPs (24 Sep, 03:50 UTC)

Two committed, two discussing and two connecting, picked at random from those with an organization
on file. Seven searches in all.

- **Identity resolved for six of six on the first search** from name, organization and role.
  Affinity's organization was wrong or unhelpful for two. For one it was a membership organization,
  not an employer. For the other it was a company the search could not confirm. For the first of
  those, the **email domain** named the real firm. Learned: search the domain's organization when
  the listed one doesn't confirm.
- **One search gets most of it.** The search tool's summary gives role, background and
  headline investments. The firm's own page is the best source; the aggregators (Crunchbase,
  PitchBook, Signal, The Org) confirm identity but carry little.
- **The signals that matter came from the second search.** Two of six had something only
  targeted words found: a stated interest in neurotech, and a past role at a large biomedical
  funder behind a single-family office's LP program.
- **Contact-data brokers crowd the results** for less public people. They are ignored, and
  nothing they carry is stored.
- **A committed LP runs a program backing emerging managers.** That makes them a connector to other
  fund investors, the pool docs/06 says is most under-asked.
- **Some ties to us exist only in our own data**, such as an email address at a Protocol Labs
  domain. The public web won't show those. W3 has to read the pipeline and Affinity, not just the
  research.

### Iteration 2 — four agents in parallel, 40 LPs (24 Sep, 04:15–05:50 UTC)

Every committed LP and the discussing LPs who have met us, ten per agent, each agent on the
protocol as it stood, each reporting counts and learnings (never names). Each batch's learnings
became the next amendment, 1.2 through 1.5, so the later batches ran on a better protocol than
the first.

- **Identity: 38 of 40 resolved** (33 confirmed, 5 probable); one left ambiguous and one not
  found — both with no facts recorded, as the protocol requires.
- **Signals: 15 of 40 had a neuro, health or biotech signal,** some of them the firm's thesis rather
  than the person's — which is why facts now carry a scope. **14 had a Protocol Labs tie** of some
  tier, most documented on Protocol Labs' own pages; **26 had a crypto tie.**
- **The failures were instructive.** A search summary pinned a Filecoin tie on the wrong,
  similarly named firm; a headline was about a different person from the same employer;
  generated profile sites put words in people's mouths. Each became a rule: read the page, check
  the entity, never quote a generated profile as the person.
- **What the tools can't reach is named, not skipped.** The SEC adviser pages, Form ADV, LinkedIn
  and paywalled press go under "for a person" in the finding, so the gap is visible.
- **Throughput:** about fifteen minutes and roughly 200 thousand tokens per ten LPs per agent.
  Batching by firm, from iteration 3, reads each firm once.

### W2, W3, W6 — our side, the paths, our presence

- **Our side:** the team's public affiliations (past employers, boards, schools) and Protocol Labs'
  documented backers — seven firms and two angels, each with its source. Several LPs in the set
  work at those firms.
- **The paths (W3)** start from our own records: meetings on file and who owns the pursuit (tier
  B — the owner is who the team assigned, not proof of who was in the room), people at the same
  firm (one of whom may have met us), an address at one of our domains. The research adds the
  firm-level ties (C), our portfolio (C), and the team's schools (D). A C or D path is shown as a
  clue for a person to check.
- **Our presence (W6):** the site speaks to founders, not LPs. The fund page carries the thesis,
  the team and the portfolio, but no LP path, fund size or check size, and it disclaims any offer
  even though a 506(c) fund may say it is raising — a decision for counsel and the team, noted
  here, not taken.

