# 19 — Enrichment workflows: seeding the strategy from public sources

**Status:** started N64, 24 Sep 2026, from Juan's request that night. A living document: the
design, the protocol the research follows, and the log of what each iteration tried and learned.
The log here uses counts and invented examples; the specifics are in
`data/real/enrich/LOG.md`, which git ignores.

**Where the rules live.** The rules in force for W1, W1c, W5 and W12, every amendment folded in, are in
`docs/workflows/`: `w1-profile.md`, `w1c-fact-check.md`, `w5-strategy.md` and `w12-events.md`, one short
file per workflow, so a sub-agent reads only its own. This document keeps the design and the history. A
new amendment is written into its workflow's file, and logged here in one line.

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
| W9 | **Triage the cold** — who deserves research, who has a way in now, and the check before any note | the pipeline, W3 | `triage.jsonl` | every lane and first step carries its reasons |
| W1s | **Structure** — name each fact's company or fund, from the fact's own words | W1's findings | `raw/<key>.json`, `detail` only | no name that isn't in the words |
| W11 | **The connector plan** — who could introduce whom, within the guard's limit | W3, W9, W5 | `connectors.json` | restricted prospects left out; C and D ties marked to confirm |
| W5c | **The critic** — grade strategies against the litmus test and the rules, without rewriting them | W5, W1, W9, W3 | `strategy-review.jsonl` | grades by protocol version; the issues become the next amendment |
| W1c | **The fact check** — re-read each fact's own source and say whether it says what the fact says | W1's findings; only the URLs they cite | `fact-review-*.jsonl` | facts supported, partly, not, about someone else, or unavailable; each identity holds, in doubt, or wrong |
| W2n | **The Protocol Labs network** — who is in PL's own directory, and whose firm is a network team | the research set's names; the directory's public API | `us/pl-network.json`, `us/pl-directory.jsonl` | an entry matched to our record of them, or said to need confirming; nothing for contacting anyone kept |
| W12 | **What each event is about** — which vehicle a meeting, an email or a note is about, if any (N81) | Affinity's records since the earliest raise window, from a copy of the database | `tags/out/tNN.json`, merged to `event-tags.jsonc` | every record tagged; each vehicle from the record's own words, a thread it continues, or an inference marked as one |

Batches are cut by `scripts/enrich-batch.ts`, whole firms together, so colleagues share one
reading and one plan. The close gap — committed on the pipeline, and what the close track shows,
state by state — is a section of W8.

The import (`/dev/enrich`) maps W1 to research claims and source documents with their provenance
tuple (rule 9), W3 to candidate relationship edges that need a person before they route (rule 6),
and W5 to suggestions a person accepts or dismisses — never a status, a rung or a send.

**The network, built (N82).** Juan, 24 Sep, on "Routes to —": "How do i fix this? you have our names,
can you set these connections yourself, or suggest some for me to verify?" No route could run on the
real account: nobody on the team had a person record in the graph, and no edge existed. After every
translation and every import, `buildNetwork` (modules/network/build.ts) links each active user to a
person record, makes a tier-A "met" tie for each one-to-one meeting or call held with someone on the
team (our own events are not meetings), a tier-B "corresponded" tie for a message from them to one of
us, and an edge for each W3 path to a person — A and B route; C and D are shown with "They know each
other" and "Not a real tie", and route only once a person confirms them. A tie to one of our
organizations is no hop: it stays a candidate on the LP's page. A rebuild replaces its own ties and
never a person's decision.

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

**Amendments, version 1.6 — without search (W1d)** (from the batch that ran after the session's
search budget was spent):

- **Say how the finding was made.** `researched.version` is the amendment as written, a string
  (`"1.6"`); `researched.method` is `"pages"` when no search ran, or too few to follow the protocol.
  A pages-only `not_found` means "not named in what could be read", never "no public footprint":
  the LP stays owed a pass with search, and triage keeps them in the queue.
- **The work domain leads.** Read the firm's site from the work domain on file: the homepage, then
  the team, people, about or leadership page it links to (guessed paths often 404). A firm's own page
  settles identity and the current title, and gives the firm's thesis, portfolio and size. It found
  the right bio for nine of ten LPs whose domain was a firm's site. With a free-mail domain or none,
  go to the filings, then Wikipedia.
- **Filings, free and structured,** read as pages:
  - SEC EDGAR full-text search, as JSON:
    `https://efts.sec.gov/LATEST/search-index?q="<name>"&forms=D` for Form D (officers, directors and
    promoters, the amount raised); `forms=DEF 14A` for proxy statements (director bios); `forms=SC 13G`
    for stakes. A filing lives at `https://www.sec.gov/Archives/edgar/data/<cik>/<adsh, no dashes>/`.
    A same-name person is not them without a tie to the organization.
  - The SEC adviser search (`api.adviserinfo.sec.gov/search/firm?query=…`): a registered adviser's
    size, or its absence (likely an exempt single-family office).
  - ProPublica's Nonprofit Explorer (`projects.propublica.org/nonprofits/api/v2/search.json?q=…`, then
    `organizations/<ein>.json`): a family foundation's assets and grants, as capacity evidence.
  - Wikipedia, for the notable.

  These cover principals well and staff poorly.
- **Where the line on search falls.** A general search engine read as a page (Google, Bing,
  DuckDuckGo, Brave and the like) would get around the budget, so it is never read. A primary
  source's own lookup — EDGAR's, the adviser database's, ProPublica's, Wikipedia's, a firm's site's —
  is reading that source, on the same query rules: a name, an organization, a title, a location,
  topic words.
- **What waits for the search pass:** the "near us" check on Protocol Labs' sites, funding news that
  names backers, podcasts and press. Say so under `coverage.notFound` ("for the search pass: …"), so
  the rerun knows what is left.
- **A `402 Payment Required` is a paywall:** leave it. Script-drawn sites read as empty; one retry on
  another page, then move on.
- **Budget:** about six reads that worked per LP; staff with no footprint stop at three.
- **Name the entity in `detail`** (from W3's third iteration): on every `investment`, `board`,
  `role`, `prior_role`, `affiliation`, `exit`, `fund_lp` and `fund_gp` fact, put the company's or
  fund's name as its own site writes it in `detail.company` (or `detail.fund`), one per fact. W3 joins
  LPs on these — two LPs in one company's record — and never on a one-word name found in a sentence,
  which is too easily a word ("Science") or another company.

**Amendments, version 1.7** (from the first pages-only batches):

- **For a fund manager, EDGAR first:** full-text search on the surname with `forms=D`, then the
  firm's name. Form D gives the fund series and the current raise (offering, amount sold, number of
  investors, date of first sale), often before the firm's site mentions it; a portfolio company's
  Form D can show a board seat. With no accession number in the results,
  `data.sec.gov/submissions/CIK##########.json` lists a filer's filings. A GP raising a fund of their
  own right now is a timing signal: record it, dated.
- **A fund's name as filed.** "Our master fund" or "Venture Fund III" would join unrelated firms in
  W3: put the name as it appears on the Form D in `detail.fund`, or, with no unique name, record the
  fact as `investor_type` with no fund key.
- **A famous namesake: settle identity on the work domain first.** The domain and title on file
  matching a staff page settles it; the namesake's facts are then kept out, with a caution not to
  join the two.
- **Pages reach principals and GPs, not staff.** The adviser database, FINRA BrokerCheck and EDGAR
  cover registered people and people named in filings. Staff at a firm whose site lists only its
  leaders stop at three reads. A same-name record with no tie to the organization is a lead under
  `cautions`, never a fact.
- **Stand-ins when a site fails:** a trade association's staff page, Form D filings, ProPublica (for a
  new nonprofit it shows IRS master-file figures before any return: label them master-file).

**Amendments, version 1.8** (from the second pages-only round):

- **Fetch the bare work domain first, and record where it points.** A redirect is identity
  evidence: to the person's own site, or to the firm's new name (how a rename shows up).
- **EDGAR with the full name first;** the surname alone only when that finds nothing (for a rare
  full name the surname search returned three times the hits, most of them other people); the
  firm's name for the fund series and the fund's filed name.
- **Signature blocks name the staff that firm sites leave out:** Schedule 13D, 13G and 13F filings
  carry a signer and a title, and a 13F's holdings total is a floor for the firm's capacity. Use them
  for family-office and holding-company staff.
- **For founders, an accelerator's company page** is a cheap identity check: founder titles, a
  quotable first-person account, profile links that match a handle on file. Wikipedia's title
  lookup shows at once when no article exists.
- **Old filing bios are dated.** A board seat from a 2017 proxy is recorded with `detail.as_of` and
  `medium` confidence, so W3 doesn't join two LPs on a seat that has since ended. The name the
  company's own site uses goes in `detail.company`, the filed name in `detail.legal_name`.
- **Some staff can't be reached on pages at all** (a domain that refuses every read, a group tax
  return with no officers): `not_found`, method `pages`, and "for the search pass: all of it".

**Amendments, version 1.9:**

- **A firm's newest Form D first, and compare its named managers with the LP.** A new fund's
  filing (offering made, first sale not yet) is the strongest dated signal a firm gives, often
  before its site. An LP missing from the named managers is a question to ask, never a departure to
  record.
- **Short filings over long ones.** The reader cuts an S-1, S-4 or 10-K before the management
  section; an 8-K press-release exhibit, a Form 425 or a proxy statement gives the bio, a figure and
  the current title in one page.
- **A guessed domain, or a work domain that has changed hands, is never identity evidence.** A
  guessed domain belonged to a same-name business with another founder; a former employer's domain
  on file now hosts an unrelated site.
- **Check a LinkedIn handle against the name, not only the URL.** A handle with a different first
  name can mean the record merges two people (a fund's Form D listed two officers with one surname):
  `probable`, to be checked against our own records.
- **An empty adviser search can mean another regulator.** A commodity pool operator registers with
  the CFTC and NFA, not the SEC; an "802-" number marks an exempt reporting adviser, whose size isn't
  given. Script-drawn registers (NFA, SFC, MAS) go under "for a person".

**Amendments, version 1.10:**

- **Every Form D hit is checked for the first name.** A surname search brought in a relative's
  funds under another first name, and a surname that is also a common word brought in a restaurant.
  The surname alone only when it is rare.
- **"Near us" without search: ask the firm's portfolio page for our portfolio's names.** It finds a
  co-investment, and two traps W3 must not join: a sector label spelled like one of our companies
  ("precision" as a theme), and an unrelated company sharing a word with one of ours. Record those
  under `cautions`.
- **A death changes who decides, so it may be recorded — with two sources, the date only, never a
  cause.** The reader can attach a block to the wrong card on a firm page; one source is a lead.
  Nothing else about anyone's health, ever.
- **A bio from a filing is dated:** `detail.as_of` on every role taken from one, and a caution when
  the newest source is more than two years old. A placeholder site on the work domain is no source.
- **An EDGAR hit list dates a filing (medium confidence); an amount needs the filing opened.**

**Amendments, version 1.11** (from W1s, the structure pass over 80 findings):

- **The full name in `detail`, on every fact** — never the short form or acronym a later fact uses
  once the first has spelled it out. W3 drops names of three letters or fewer, and a short form
  gives one firm two keys.
- **The organization's own name,** not a program title ("… Fellow") or a cohort; a former name goes
  in `detail.former_name`, an acquirer in `detail.acquirer`.
- **One relation per fact.** A firm's portfolio is `investment` facts with `scope: "firm"`; its
  backers are a fact of their own; an adviser's employer is not the firm's. A sentence that packs
  the firm, its portfolio and its backers into one `affiliation` leaves the next pass guessing.
- **Several names in one `detail` key are joined with "; ".** A comma or an "and" belongs to a name
  ("…, LLC", "Bill and Melinda …").

**Amendments, version 1.12:**

- **An organization on file can be a handle, not an employer** (an invented-looking word, a work
  domain on a forwarding host). For a founder, check it against accelerator pages and their own
  site before writing `not_found`: an accelerator page can carry the same handle or the LinkedIn
  handle on file.
- **Ask a portfolio page for Protocol Labs' documented backers too,** not only our portfolio: a firm
  that backs other funds may list them. Each backed fund is its own `fund_lp` fact, `scope: "firm"`,
  so W3 can join the firm to that fund's partners.
- **A probable identity inside one firm:** when both candidates work at the same firm, the firm's
  facts hold either way; only the person's facts carry the doubt. Say so in `basis`.
- **EDGAR as a tie test:** the full name plus the organization returning nothing is a clean negative
  for a same-name record. The full-text endpoint fails in bursts: move on, retry once; a filing's
  directory listing can load when its documents don't.
- **False friends:** a blog's own search box may ignore the query and list the newest posts (usable
  as a dated "what they say now", at `low`); Wikipedia's article on an acquired startup often
  redirects to the acquirer and drops the founders (the accelerator page keeps them).

**Amendments, version 1.13:**

- **A company homepage's structured data can name co-founders** the visible page leaves out: with no
  team page, ask the reader for its schema.org founder entries and job titles.
- **A LinkedIn handle can match a company's former name,** not the person's; the 1.9 check compares
  handles with former company names too.
- **A nickname needs its formal name before EDGAR finds anything** (a foundation's care-of line in
  the nonprofit database can give it). A role found by name match alone stays `medium` unless the
  filing names the firm.
- **Two filings disagreeing on a board seat:** check the issuer's CIK for a later name (a SPAC after
  its merger); record the seat as former, the new name in `detail`.
- **The reader's first summary can overstate a relation** ("anchored by" became "largest
  investor"): ask for the exact sentences before an angle rests on it. An "Attn:" line in a deal
  exhibit names staff with a date: record the employer and the date, never the address.
- **EDGAR mechanics:** OR queries and names with an apostrophe return server errors; one phrase with
  the company's `ciks=` filter works, and reaches a named company's proxy fastest.

**Amendments, version 1.14:**

- **Other companies' proxies carry the freshest dated bio.** A full-name EDGAR search limited to
  the last two years finds a proxy from a company where the LP is a director: current title,
  committees, advisory posts — even when their own domain doesn't resolve.
- **A 13G's reporting persons name the principal,** not only its signature block: a family office
  that never says whose money it manages may list a founder's trust among them.
- **A board designee is not an employee.** "One individual designated by X" ties a name to X with no
  title there: record the designation; the identity is `probable` when only name and organization
  are on file.
- **Verbatim before an amount or an acquirer.** The reader's summary turned a round's total into
  one investor's check, and may attach one acquirer to two companies.
- **A team page that says the LP "currently leads" a company whose own site names someone else:**
  `low`, with a caution; the company's filings settle it, and a script-drawn registry goes to a
  person.
- **A long filing the reader cuts off:** name the filing and section under "for a person" — two
  names together in a prospectus is a precise lead. The web archive can't be read from here, so a
  domain that refuses connections has no fallback.

**Amendments, version 1.15** — look-alikes, the main trap without search:

- **Search a general partner's exact legal name in quotes, never its acronym,** and join a filing to
  an LP only through a named officer. An acronym's hits were almost all another company's; a
  "<Firm> Ventures 23, LLC" was a real-estate issuer; advisers and a hedge fund had the firm's name
  inside theirs; an AI company was called "Brain…".
- **Take the company from the opened filing, never from a list summary,** and ask for raw field
  values before recording an amount: the reader put a filing under the company that later took the
  same ticker, and read whole dollars as thousands.
- **Namesakes who share a first name are often relatives; the SEC filer number (CIK) separates
  them.** Board seats come only from the LP's own CIK (a footnote naming their fund entities ties
  it); the other is a caution for W3.
- **Family-office staff show up in signature blocks,** which prove they still work there but not
  their title: record the signing role with its date, keep our title "per our record", and the
  two-year caution when the newest source is older.
- **A GP's new funds can carry a brand their own site never uses.** Record the raise at `medium`
  with the tie spelled out (full name, city, scale); the Form ADV owner check is the first "for a
  person" item.
- **Script-drawn sites and dead paths:** ask the reader for the page titles and the homepage's full
  link list — a title ("Name - Founder of X") can settle identity, and the link list gives the real
  portfolio pages and doubles as the check against our portfolio's names.

**Amendments, version 1.16:**

- **Nothing in a special category, ever — not only health.** No religious, political, ethnic or
  union affiliation, no sexual orientation, even when a bio lists it. When the organization on file
  is a civic or political group, describe it only as its own site does, and tie it to the person
  only on a page that names them.
- **A "not listed" from a long page covers only what the reader saw.** A thousand-company portfolio
  page came through to the names starting with A, and the reader still answered "no" for every
  name. Ask for the last entries it saw, and write the range covered under `cautions`.
- **Describe a company only in the page's own words** — its listing's or its own site's — or just
  "is in the portfolio". Neither the reader's summary nor a first draft may give it a sector no
  page supports.
- **A GP's own open fund is a timing signal and a caution:** record the offering, the amount sold
  and the amount still open. W5 reads it as lower propensity for an LP commitment (they are raising
  too): the ask becomes introductions or co-investing.
- The checker now looks for an email address or a phone number in every text a finding carries —
  the profile, cautions, signals, coverage and the identity's basis — not only in facts.

**Amendments, version 1.17:**

- **Ask a firm's page what it excludes, not only its thesis.** "Does not invest in venture capital
  funds" is a firm-level `statement`, quoted — and W4 reads it as a gate answered no, not unknown.
- **A list page's entries word for word** before a sector or a signal: on a page of logos the reader
  first called two companies medical, then said there was no text. What can't be quoted isn't
  recorded.
- **EDGAR's full-text search matches words, not names** ("Clear Path Family Office" hit a press
  release using the phrase): open the document before a hit counts, and trust the filing's own
  fields over the index's.
- **Insider filings, when a firm's site blocks the reader:** the filer's submissions lead to a Form 3
  (when a board seat began) and the latest Form 4 (a dated sale, and the shares still held — times
  the price, a floor for capacity, labelled an estimate). Never the address on it.
- **A brand's site may name nobody; filings use the legal name.** A Form D under an unfamiliar
  company can be the brand — an acquirer's "X, Inc. (dba Brand)" or a co-officer on an accelerator
  page ties them.
- **A coded syndicate series ("AB-1234 Fund I") is not a sector,** and a lead's role resting on the
  name alone stays `medium`.

**Amendments, version 1.18:**

- **A dead work domain, with an organization named after it:** EDGAR on the full name first. A
  filing that lists a contact at the same domain as our record counts as a domain match — record
  the match, never the address.
- **A nickname on file, a legal name in filings** ("Jamie" filed as "Jameson J.", signing "James"):
  the 1.10 first-name check accepts a legal name when the firm ties it to the person. On an EDGAR
  server error, drop the quotes (surname plus firm) rather than retry.
- **A blank-check company's final prospectus (424B4) reaches the management bios,** unlike the long
  S-1s and 10-Ks: worth one read for its officers.
- **ProPublica's organization page lists officers from e-filed returns; its API doesn't.** Check a
  nonprofit's total assets before hunting its staff — a fundraising foundation is not where the
  endowment's CIO sits.
- **Stop after two guessed subdomains on an institution's domain:** a "governors" subdomain was a
  research centre, not the board.
- **Every descriptive clause comes from a page read** — a company's line of business, a city, a
  word implying an event. What wasn't read stays unstated, and a signal resting on it is marked
  "likely".
- **A capacity band needs evidence** — assets or net worth, a check or commitment on record, a
  filing (a 13F total, Form 4 holdings). A title or how someone describes themselves is not
  evidence: the band is `unknown` (the W5 1.5 gate, applied where the band is first written).

**Amendments, version 1.19:**

- **An unreadable site may still serve its own feeds.** Before writing a site off, try its
  `/sitemap.xml` for the real paths, and a WordPress site's own content API
  (`/wp-json/wp/v2/pages?slug=…`) for the team, committee and portfolio pages. That is reading the
  site, not searching the web.
- **EDGAR's company search maps a manager-selection platform:** a wealth manager with no public list
  of its managers files one Form D per client feeder ("<Firm> Investors <year> - <fund>"). Each
  fund it backs is a firm-level `fund_lp` fact with the feeder's amount and investor count; reading a
  fund family from its initials stays `medium`.
- **A mandate the firm states itself is a gate, with its quote:** "we don't do venture" is a `high`
  fact plus a caution, and triage stops spending research on a fund ask there.
- **Trust a person's own insider filings (Forms 3 and 4) over a garbled proxy line** — the Form 4 is
  small, and settles whether they are a director now.
- **A surname that is also a street name brings in property records** — the same false match as a
  surname that is a common word (1.10).
- **Every prompt to the reader about a filing asks it to leave out addresses, emails and phone
  numbers:** "copy the entry exactly" returned street addresses. None may be recorded.

**Amendments, version 1.20:**

- **Back doors on a script-drawn or overlong site:** `robots.txt` leads to the sitemap index, which
  lists the people and portfolio pages by exact address; the site's own content API returns what
  the reader truncated; a German firm's legal imprint (Impressum) names its managing directors.
- **Name plus firm, as two phrases, can settle a staff identity** in EDGAR when the filings that
  name them are too long to read — and try the firm's spellings from its deal documents ("S-Cubed"
  found none, "SCubed" all ten).
- **Their own dated words beat an older filing's title.** "To January 2026" on their own site, or
  "Emeritus" on the firm's, is a dated prior role; the older title stays as a caution. (1.9 still
  holds for a bare absence from a team page.)
- **A Form D gives every related person the company's city** — not evidence of where the person is.
- **An allocator's program page states its mandate** ("long-only public equities and hedge funds
  from proven managers"): a firm-scope fact plus a caution, read by W5 as a gate.
- **A fund of funds' backed managers:** record them (1.12), from their text, not logo labels — and
  W3 now joins one to a pipeline LP who runs or works at a manager it backs.

**Amendments, version 1.21:**

- **Middle names make look-alikes:** a full-name phrase finds another person whose first and middle
  names equal our LP's name ("Ann Lee" finds "Ann Lee Morgan"). Compare the full name in the
  filing's related-person field before joining a hit.
- **Staff at wealth managers are in the SEC adviser database:** its individual search gives the
  registered person's branch city and start date, and the firm's former names explain a
  registration older than the brand.
- **Dead work domains are common** (six of thirteen in one batch). The organization's own site may
  live under another domain; identity then rests on that page naming the person with our title,
  and the domain used goes in the basis.
- **Check the LP's own organization against our portfolio list** as well as the firm's portfolio
  page: a founder of one of our portfolio companies is a reference and a connector first.
- **A deal press release's "About" paragraph** is a quiet family office's own dated words on its
  mandate; a foundation's 13D on a fund's share class is a documented anchor commitment.
- **Sector labels from general knowledge** (a portfolio page that lists only names) sit in `detail`,
  marked as general knowledge, so no signal count rests on them.

**Amendments, version 1.22:**

- **The SEC adviser database resolves nicknames:** its "other names" field ties a nickname to the
  legal name at the firm on file. Record the employer and city — never a former surname.
- **Filing footnotes stand in for a refused site:** a Form 4's "X is the managing member of Y's
  general partner" ties a manager to the LP, and opens the firm's 13F.
- **A national company register's officer search: the surname alone,** then the appointments —
  leaving out building-management companies, which stand in for a home address.
- **Follow a work domain's redirect before matching,** and a foundation's code-hosting organization
  page can give its real site and list the LP as a member.
- **A title the sources contradict is a caution, never a departure** — a nonprofit's 990s naming
  someone else as CIO, "Venture Partner" on the firm's page against "General Partner" on file.
- **"Medical devices" among a firm's exclusions is a neurotech gate:** the firm's statement, so W4
  reads it as the firm's answer on fit.

**Amendments, version 1.23** (from the last pages-only batches, for the search pass):

- **The sitemap is the fastest route to a staff bio:** `robots.txt`, the sitemap index, then the
  team sitemap — three reads. A press sitemap's "appoints-…" addresses give a dated appointment.
- **Form ADVs and an institution's own PDFs can be read:** the fetch tool keeps a copy in the
  session's own storage (like the transcript, never in the repository), and their text gives
  assets under management, client types and each officer's title with a start date. A policy's
  asset table is read column by column, at `medium`.
- **Follow a work domain's redirect, and read logo walls through their links:** a redirect can land
  on a code repository whose README is an angel vehicle's only page; a logo wall is recorded as the
  domains it links to, as written.
- **A one-word family-office domain, split into the name its filings use** ("Xyhall" → "Xy Hall
  LLC"), finds the whole fund series the one-word form misses.
- **Filter a hit list of fund vote records to 6-K and 8-K first** — a foreign buyer's 6-K can carry a
  quiet family holding's exit; a vote record ("Elect X as Director") dates a nomination, read from
  the smallest filer.
- **A check size for another asset class is a fact, never a capacity band** — a private-equity
  check must not become a venture ask.
- **A competing position in our own field** (an employer's majority stake in a brain-implant
  company) is both an affinity signal and a conflict gate: flag both, for W3 and W4.

**Amendments, version 1.24:**

- **No street address, ever — and the checker now catches them** (a number and a street word, a
  suite or floor, a post-office box), in every text a finding carries. The reader hands addresses
  back from filings even when asked not to: ask it for "the city only". A building known by its
  street address is described as what it is ("an office building"), never by the address.
- **A resale prospectus names who runs a small adviser:** a selling-stockholder footnote ("the
  managing members of X LLC are A and B") — dated, `medium`, with the two-year caution.
- **For a fund partner, only the direct holding counts toward capacity;** a proxy's ownership table
  and a Form 4's "indirect, by [fund]" lines are mostly the fund's.
- **A record can merge two people:** `probable`, listing the fields that don't fit, and the name with
  the organization decides whose facts they are.
- **A rare surname at one of our own portfolio companies** (a different first name) is a caution and
  a question for a person — a family tie is possible — never a join.
- **Try `www.` once before calling a domain dead:** the bare domain may not resolve while the www
  address redirects to the company's current site.

**Amendments, version 1.25** (the last pages-only batches):

- **The sitemap doubles as a "near us" check:** search a firm's sitemap addresses for "filecoin",
  "ipfs", "protocol-labs" and our portfolio's names — a post address found a firm's FIL position and
  its lead of a Filecoin round that its script-drawn portfolio page hid.
- **A parked look-alike domain is no source:** a firm's real site on a new-TLD domain, the `.com` of
  the same name a domain-for-sale page; a sitemap listing only `/lander` marks one.
- **For a director, the appointment 8-K (Item 5.02) and their own latest Form 4** — not a proxy the
  reader cuts off: the 8-K gives the dated bio, the Form 4 the end of a seat and the direct holding.
- **A foundation's 990-PF splits its investment office:** record who manages private investments,
  so an introduction reaches the right person.
- **A record that is only a firm's name, filed as a person:** `probable` at most, firm facts only.
- **EDGAR's full-text search misses names with "&":** company search is the next step.
- **A company's own copy of press coverage** (a PDF on its domain) gets around a paywall.
- **A stated scope is not an exclusion:** "invests in the Midwest" is recorded as said, with its
  sentence — never paraphrased into "does not invest elsewhere".
- **Filing numbers:** shares still held on a Form 4 are assets and can set a band; a 13D purchase
  cost, a credit fund's size or an old loan vehicle's check are another asset class. File, CRD and
  SEC numbers stay out of prose (they read as phone numbers) — in `detail`, or left out.

**Amendments, version 1.26** (from W1c, the first fact check: 171 facts in 20 findings, half behind
a "this year" strategy, each re-read at the page it cites. Of the 153 whose page loaded, 133 were
supported, 19 partly, 1 not; none was about someone else. Of 20 identities, 18 held, 2 were in
doubt, none was wrong. Every partial had one of three causes, and they become the rules):

- **One fact, one page — every part of it on that page, said of that subject there.** Each list
  item, sector, role word, count, relation and `detail` field is on the page in `source.url`, and
  said there of what the fact says it of: "early-stage fintech" written of a person's fund is not
  their angel deals' focus, and half of a two-part heading is not a company's sector. When a second page contributes (a
  founding year from the person's own site, a signature from a filing), it is its own fact with its
  own source, or it is left out.
- **The page's own words for events, relations and descriptions.** "Offered", not "joined"; "joined
  forces", not "acquired"; a company described in the page's words or not at all; a relation copied
  from a filing in the filing's words ("trustee of the trust and sole director of the firm"). A fund's
  name is not its mandate. When the stronger word is probably right, it goes under `cautions` as
  "likely" (1.18), and the fact keeps the page's wording.
- **A name in `detail` is one the page states.** A fund's filed name comes from its own filing, never
  by analogy with a sister fund's — W3 joins LPs on these names.
- **A fact cites a page that was read.** A claim seen only in a search summary, a sign-in page's
  snippet, or a page that refused the reader goes under `cautions` or "for a person", not `facts`.
- **LP-contact databases are brokers,** whatever they call themselves; the checker's list gained one.
- **On a page about several people, a quote comes from the section under the LP's own name** (the
  fact check's second round): a colleague's answer on a panel page, quoted as the LP's, is on the
  cited page and still not theirs.

**Amendments, version 1.27** (from the search pass's first batch, 15 LPs: 3 not-founds resolved, 38
facts added net, the checker clean):

- **An allow-list and a block-list don't go in one search:** the search tool refuses the two
  together. The "near us" check runs on its allow-list alone — it can't return a broker — and every
  other search carries the block-list.
- **The "near us" sites** are Protocol Labs' own: protocol.ai and its subdomains, filecoin.io,
  ipfs.tech, and plneuro.xyz, PL's neuro site, whose ecosystem allies page lists firms (the batch's one
  new neuro tie was there, found only by a topic search). Never ipfs.io: its gateway serves a copy of
  Wikipedia that matches any notable name.
- **A search that finds nothing is retried by the tool,** so a negative costs more than one; plan on
  1.1–1.3 searches a call. Negatives are the norm for the near-us check (13 of 15).
- **The pass re-reads the main source of the facts it keeps** and cuts each to its page's words
  (1.26); it is a check on the pages pass as well as an addition to it.
- **The later gates apply while rewriting:** a capacity band written before 1.18 with no evidence
  behind it goes to "unknown", with its reason; a fund "raising" whose filer has filed nothing since
  its last amendment is a question, not a live raise (one read of the filer's submissions settles it).
- **Two more brokers** (`data-lead.com`, `visualvisitor.com`) are on the checker's list; a staff page
  that shows contact details is read for the role only.

**Amendments, version 1.28** (from the search pass's second batch, run in parallel at 1.26: 15 LPs,
49 facts added net, 8 with a Protocol Labs tie):

- **Count queries, not calls:** on an empty result the tool may run its own follow-up queries (one
  call spent four). The near-us query is the exact name in quotes; colleagues at one firm share one.
- **Near-us finds lie outside PL's domains too:** Juan's podcast (`juanbenetpodcast.com`) joins the
  allow-list; the Filecoin Foundation's pages and newsletter count as the ecosystem (tier C at
  most); and a portfolio company's funding release that names Protocol Labs beside the LP's firm is a
  co-investment — search our portfolio companies' rounds for the firm.
- **A title on file that looks wrong gets one query** — the name with that title. Search catches a
  merged record or a contact who has moved, which page reads can't; it is recorded as a caution for
  the contact to be fixed, never as a departure.
- **Generated investor lists are wrong again:** a firm named as a round's lead by a list site, and
  not by the company's own release, is not a fact. Funding news that names backers is the near-us
  check and the fact check at once.
- **More brokers** on the checker's list: lead411, me.sh, clay.earth and clay.com (profile
  aggregators). A publisher that redirects to a pay-per-crawl gateway (TollBit) is a paywall, as a
  402 is — not a source.

**Amendments, version 1.29** (from three more batches run at 1.26: 44 LPs; not-found 15 → 1;
facts 292 → 447):

- **The allow-list is not strict:** check each result's host before calling it a Protocol Labs
  page. A PL directory page matches on other members' bio text, and it, like ipfs.io's Wikipedia
  mirror, is no tie.
- **Ties show on the Filecoin sites more than on PL's own:** filecoin.io's blog and the Filecoin
  Foundation's newsletter carried all but one of a batch's new ties. The Foundation's site
  rate-limits parallel readers; the same text is often on filecoin.io, and a 429 is retried late,
  never recorded as a negative.
- **Search the firm's own blog for Protocol Labs or Filecoin:** its post on the investment names who
  led it, where a name search finds nothing. The PL directory (W2n) is drawn by script, so search
  never sees it: look people up there by the public name form W1 found (a nickname, a formal first
  name) and by surname.
- **A LinkedIn result at the handle on file confirms the person, never the title or the employer:**
  our record's fields may come from that same profile, so a LinkedIn match alone is `probable`, and
  `confirmed` needs an independent page. The snippet is never a fact (1.26), so a confirmed identity
  may carry no personal facts at all — that is the honest result, not a gap to fill.
- **One bio found, read its address:** a firm's person pages share a pattern, so a colleague's page
  is one read away. A Medium publication's feed serves posts its pages refuse.
- **"Welcome" is an event unless the text says "joins"** (a panel invitation read as a job change).
- **Brokers are matched on whole domains, hyphens ignored** (`isBroker`, `BLOCKED_DOMAINS` in
  `lib/enrich/schema.ts`): the old pattern flagged every "…science.com" and missed alpha-maven.com.
  The list gained muraena.ai, premieralts.com (an LP-team database) and the common people-search
  sites, and the checker now tests every URL a finding cites — identity links and signals too.

**Amendments, version 1.30** (from the sixth batch at 1.26: 15 LPs, 51 facts added net, one
ambiguous name resolved):

- **Ask the reader for the exact sentence, never a summary:** search summaries, and the reader's own
  first answer, overreach — two names on one speaker list became a conversation, a chief executive
  was credited with leading a round the article doesn't attribute, a fund went to the wrong founder,
  "partnerships" became "anchored by". The sentence itself caught every one.
- **A search pays off most by leading to a filing:** a Form ADV, a new Form D (an SPV, a small fund
  series, a fund with nothing sold), a Form 4 read against a later proxy (which settled a board seat
  as former). A PDF the reader returns as binary can be turned to text from the fetch tool's saved
  copy, locally.
- **Rare and common names behave differently:** a rare name-only record may reach `probable` when
  every result in its field is one person; a common name is never lifted by a good thematic fit —
  the fit goes in `coverage.note`, for a person to check against our own records.
- **An LP-contact database is a broker** (1.26), whatever its pages look like: one whose firm pages
  served as a source sells partner email addresses for export. It is on the list; what rested on it
  was removed and the identity re-decided without it.
- **Count what the tool ran,** not the calls made: one call can run several searches.

**Amendments, version 1.31** (from the seventh batch, the first at 1.27: 15 LPs, facts 151 → 250,
both not-founds settled or made honest):

- **An adviser may file under a legal name its site never uses:** the GP entity's. When the adviser
  search on the firm's names finds nothing, a search for the fund's or GP's legal name finds the Form
  ADV, whose Item 5 and Schedules A and D answer the fund gate (a fund of funds says so), set a band
  and date a title. It is parsed locally by fund name; addresses and phone numbers stay out.
- **"Raising now" needs a search for close news, not only the filer's submissions** (1.27): a new
  fund's Form D was followed the next day by press saying it had closed.
- **FINRA BrokerCheck's JSON reads cleanly** and settles a staff member's identity at a large GP whose
  site refuses the reader — name, firm, city, dates. A registration that ended days ago is a question
  for a person, never a departure (1.9, 1.22).
- **A negative near-us check costs about 1.9 searches,** not 1.3 (1.28): plan on it. A retry can drop
  the allow-list and return pages off it, which is why each result's host is checked (1.29).
- **Read PL Neuro's ecosystem allies page once per batch** and match the batch's firms against it
  locally: one read covers every LP.
- **A small fund's "welcome our new LP" post is evidence of a commitment;** when it misspells the
  name, a second identifying detail settles whose it is, or it stays out.
- **dnb.com's contact directory is a broker,** now on the list.

**Amendments, version 1.32** (from the eighth batch, at 1.28: 15 LPs, 61 facts added net and 33
corrected — among them a board seat on file as current that an 8-K shows ended in 2022):

- **Run the title-on-file query (1.28) for every `probable` identity:** twice it showed our record
  joining two sources that don't belong together — a principal's name and domain with a colleague's
  title and profile; an organization that is a different company sharing the surname.
- **The namesake trap runs in families:** a search summary gave an LP his son's venture firm and its
  portfolio. A relative with the same surname is read on the page, like any namesake.
- **A claim only an LP database's summary makes** ("does not back first-time funds") is a question
  for a person, never a gate.
- **The special-category review reads more words** (`scripts/enrich-check.ts`): bible, seminary,
  ministry, theology and the like — a religious-education gift went past the old list. A church
  foundation investing as an institution is still flagged, and read as the institution it is.
- **Four more sites are on the broker list:** three contact-data sites, and a mirror of attorney
  registrations that prints home addresses.

**Amendments, version 1.33** (from the ninth batch, at 1.29: 15 LPs, not-found 4 → 0, facts 108 →
200):

- **The near-us query is the exact name alone:** a name joined to a firm with OR drew the tool's
  follow-up queries on 5 of 13 checks, a name alone on none. The firms are checked once per batch
  (1.31).
- **The pass is also a freshness pass:** four of fifteen had something newer than the pages pass
  could see — an acquisition nine days old, a new family-office chief executive, a board chair taken
  in February, a new title. Each is dated.
- **A registered family office's Form ADV is a standing read:** regulatory assets, each private fund's
  type and gross value, minimums and executive officers, in one read — the evidence 1.18 asks of a
  band. Only written labels are trusted: checkboxes don't survive the text extraction.
- **Ten more people-data and investor-list sites are on the broker list,** among them an investor
  directory that hands out investors' email addresses; two earlier findings cited it, and the facts
  that rested on it alone were removed (listed in their `researched.corrected`). D&B stays on the
  list: its directory pages are a contact product, and its company figures are estimates.

**Amendments, version 1.34** (from the tenth batch, at 1.29: 15 LPs, all fifteen now confirmed,
facts 173 → 232):

- **protocol.ai now redirects to pl.xyz,** which joins the near-us allow-list. Once per batch, read
  pl.xyz's sitemap and PL Neuro's allies list and match every name locally — no query sent, though it
  covers page addresses, not their text. A page of the PL directory (os.pl.xyz) that a query turns up
  for an unrelated team is no tie (1.29).
- **The near-us query uses the public spelling:** a surname misspelled on our record matched our own
  founder's. The LinkedIn handle on file, or the page that confirmed the identity, gives the spelling.
- **Don't OR our portfolio's names with a firm's:** the results are about our portfolio. Query the
  firm with one or two names, or with a topic word.
- **The LP's own other organizations give the best dated bios** — a company they founded, a board's
  release, a policy institute's staff page — where the firm's site and the filings don't.
- **A name beside a vehicle in EDGAR stays a lead until a footnote ties them:** a database profile gave
  one person's career to a same-name manager of a venture vehicle.
- **Two more LP-contact databases are on the broker list.**

**Amendments, version 1.35** (from the eleventh batch, at 1.30: 15 LPs, all confirmed, facts 210 →
290, 25 corrected):

- **A summary's negative needs the page too:** a search summary said an LP was not a trustee of a
  neuroscience funder; the funder's own leadership page lists him — the batch's one neuro signal.
- **Staff show on event and LP-council rosters,** not on their firm's site: both of a batch's
  not-founds resolved there. For a very common name, identity rests on an independent roster page
  plus the handle on file. A member page of an affinity group that turns up for a name is not opened
  (1.16).
- **Two public ways into a refused site:** a site whose certificate names its host can be read at the
  host's own address; a WordPress site that refuses the reader answers its public content API
  (`/wp-json/wp/v2/types`, then the type's search). Both read only what the site publishes.
- **Six more investor-contact databases and email-list sellers are on the broker list,** among them
  sites that sell LP lists "with verified contact information".

**Amendments, version 1.36** (from the twelfth batch, at 1.29: 15 LPs, all confirmed, facts 183 →
255 — and a slip that three agents made):

- **A request carries no identity of ours.** Three agents fetched from SEC with curl and a
  User-Agent of our tool's name and Juan's email, some of them full-text searches with an LP's name in
  the query: a third party's logs then hold who is researching whom. Never an email address, a
  person's name or our tool's name in any header. SEC is read through the fetch tool (data.sec.gov's
  JSON, EDGAR's pages); a script that must fetch sends a generic User-Agent; a read that is refused is
  owed to a person, not forced.
- **The near-us search is half the budget and found one tie in fifteen;** the one came from a firm's
  own sitemap. PL Neuro's allies page (a wall of logos search can't match) and the firm's sitemap run
  first; the search runs after, and only on what they leave open.
- **On a logo wall or a page drawn by script, the page's own HTML decides** — its static text, image
  file names and link targets — over the reader's answer, which said four companies were absent that
  the HTML shows.
- **An oversized filing is read locally:** a 17 MB Form ADV over the fetch limit was saved to the
  scratchpad and decompressed; its totals were clear, and rows that lost their alignment with their
  funds' names were left out.
- **Four more contact-data sites are on the broker list.**

**Amendments, version 1.37** (from the thirteenth batch, at 1.31: 15 LPs, all confirmed already,
facts 163 → 246):

- **The pass mostly corrects dates:** "raising" needs close news or a newer filing (three open raises
  became questions); two titles the pages pass had called wrong were right as of an older date. A
  dated source — the firm's own post, a release, a podcast page — settles what an undated bio can't.
- **The adviser database answers in JSON** (`api.adviserinfo.sec.gov`, by CRD number): a registration
  date when a Form ADV's copy is corrupt. An ADV reporting no private funds for clients that are all
  pooled vehicles is a question, not a fact.
- **A refused page usually has a copy:** a syndicated wire copy or the firm's own post carries the same
  words; a status ID on X dates a snippet without opening the site.
- **Eight more LP-list and people-data sites are on the broker list;** the bio details they carried went
  to cautions, never facts.

**Amendments, version 1.38** (from the fourteenth batch, at 1.32: 15 LPs, not-found 4 → 0, facts
105 → 170):

- **One name per near-us query:** a query joining eight names cost five searches and settled none.
- **For a paper, ask for the raw author block with its superscript markers** (1.30): the reader's
  first answer put two co-authors at a university who work at the LP's firm.
- **Run the title-on-file query (1.28) on a confirmed identity whose newest source is over a year
  old:** it found an employer's 8-K recording a departure — a documented move, which can be recorded,
  unlike an absence from a team page.
- **Search each organization on our record that the finding doesn't explain:** twice it was the unit
  that commits — an LP in a deeptech fund; a family office with a venture mandate — which changes who
  an ask goes to.

**Amendments, version 1.39** (from the fifteenth batch, at 1.35: 15 LPs, not-found 3 → 0, facts 66 →
112):

- **No ORed firm check:** two such calls became 13 queries, a quarter of a batch, and found nothing the
  reads (pl.xyz's sitemap, PL Neuro's allies page, the PL directory) hadn't. One plain topic query on a
  firm with a known tie found the batch's only new evidence.
- **Our own portfolio's funding releases show a fund or family office's neuro relevance:** search the
  LP's firm with each portfolio company that raised in the last year.
- **A roster's bio can lag:** when a conference page and the profile at the handle on file name two
  employers, record both, dated, and leave which is current to a person.
- **Check a redirect with `isBroker` before following it:** a podcast host's interview pages now
  redirect to a broker.
- **A 13F cover page's total has no unit:** it is in thousands. Divide one holding's value by its share
  count before a band rests on a 13F total — the difference is a thousandfold.
- **The checker reviews bands with no evidence named** (1.18): a band whose basis names no money,
  holding or filing is listed for review. The search pass takes those in its batches; the rest get a
  sweep of their own.
- **BrokerCheck's route (1.31) can fail** — the API empty, the PDF refused: owed to a person.
- **One more contact-data site is on the broker list.**

**Amendments, version 1.40** (from the sixteenth batch, at 1.34: 14 LPs, not-found 6 → 1, facts 78 →
161):

- **A summary repeats the query's organization back:** asked for a name with the organization on our
  record, the tool twice said she held a role there, which neither that organization's page nor hers
  supports. A hit on the name with the organization on file counts only when a page names both.
- **Logo walls are recorded as their links' domains** (1.23), never as names guessed from a logo, so
  W3 loses its fund-name joins for them: W3 should also join on fund domains (open).
- **What blocks a not-found is often ours:** a misspelled first name, a firm name missing from our
  record. The search pass fixed both; the records want fixing too.

**Amendments, version 1.41** (from the seventeenth batch, at 1.33: 15 LPs, all seven not-founds
resolved, facts 128 → 187, 39 corrected):

- **"Drawn by script" can hide a parked domain or a bot shield:** check the sitemap and one feed
  before using the label. A work domain whose sitemap lists only `/lander` is parked — mail there may
  not reach the LP, a caution for the contact; a site that answers every path with its name is a bot
  shield, and titles seen only in search results can't lift an identity past it.
- **Outside the US, a regulator's directory or the company register comes before settling on
  `probable`:** a national regulator named a chief executive by legal name; a register's stated
  purpose named the family behind an office.
- **An institution's own financial statements answer the fund gate:** an insurer's annual report lists
  its limited-partner interests by kind, with unfunded commitments — evidence for a band under 1.18,
  like the Form ADV read.
- **The near-us check needs a text check as well as a host check:** an on-list result matched another
  person's first name.
- **Nine more people-search and contact-database sites are on the broker list.**

**Amendments, version 1.42** (from the eighteenth batch, at 1.36: 15 LPs, not-found 3 → 0, facts 139 →
217):

- **Try `http://` once before calling a domain dead** (after `www.`, 1.24): a work domain that refused
  every read over https served its whole site over plain http.
- **A browser checkpoint is never bypassed:** a page behind bot verification is unread and "for a
  person", never a negative — like a 429.
- **A list behind "Load More" continues on a page the HTML links:** follow it before recording a list
  as complete (1.16). Re-reads also find drift between passes — a firm's self-description changed, a
  portfolio grew by eight.
- **Evidence for a band came from three more kinds of page:** a dated real-time net-worth page; a
  firm's own published average cheque; a case study stating a family office's portfolio size. Fund
  sizes, valuations and project values set none (1.18, 1.24).
- **A page whose only date is an update stamp years after the event** leaves the fact undated, rather
  than dated wrong.
- **Six more contact-data and profile sites are on the broker list.**

**Amendments, version 1.43** (from the nineteenth batch, at 1.38: 15 LPs, not-found 2 → 0, facts 122 →
179, 49 corrected):

- **The checker's band review sets other people's money aside,** phrase by phrase: a company's raise,
  round, valuation or sale price, and a vehicle's raise, are no evidence of the LP's own capacity
  (1.18, 1.24). The first review accepted any dollar figure and let such bands through; a phrase-level
  test keeps "a foundation with $85M of assets" beside "he co-led a $24M round".
- **A lead that places an LP at one of our own portfolio companies,** seen only where facts may not
  come from (a LinkedIn heading; the company's site names no staff), is a check routed to that
  company — a person asks it — not only a tier C clue.
- **Near-duplicate names are checked locally before any search:** the checker lists a record with only
  a name that is within two letters of another record's (a misspelled duplicate of a former PL
  engineer's record surfaced this way). Two people at two firms with near names are two people.
- **A PL directory false positive settles by ID** — the public API by ID, or W2n's saved team list —
  with no name in the request.
- **Read the pages you need before crawling sitemaps:** a firm's CDN blocked the script after a sitemap
  crawl; the fetch tool still worked.

**Amendments, version 1.44** (from the twentieth batch, at 1.37: 15 LPs, all six not-founds settled,
facts 76 → 132):

- **Firm sitemaps beat name searches:** every near-us name search came back empty, while a firm's
  sitemap gave an IPFS tie, a team page that settled a not-found, a dated merger that explained a move,
  and the right bio paths. A DNS lookup shows whether `www.` resolves (1.24) without a page read.
- **A domain match counts only from a page that was read:** two search summaries offered an address
  and an email at the work domain on file — which would have confirmed an identity — that the cited
  article's HTML doesn't carry.
- **Special-category material sits on ordinary bios** (a congregation's committee, a religious-studies
  board, a political view recorded by the pages pass): the checker only sees words that reach a file,
  so 1.16 is applied while re-reading each bio.
- **The band review reads phrase by phrase and drops denials:** "his stake and proceeds are not public"
  no longer counts on the word "stake", and "a sale to X for $Y" is the company's money. Writing the
  LP's own money and a company's money in separate clauses keeps the test honest.
- **Five more sites are on the broker list,** among them an investor-contact database and a property-
  records site that prints addresses.

**Amendments, version 1.45** (from the last small batch, at 1.40: 6 LPs, not-found 3 → 1, facts 28 →
74):

- **A work domain that redirects to an unfamiliar name may be a rename:** search the old name first
  (1.8). A family office had been renamed, our record's name for it was wrong, and its own contact
  page still used the domain on file — a domain match.
- **A script-drawn bio keeps its text in the page's HTML** (1.36): the reader returned only the roster.
- **A generated directory lifts a not-found to `probable` at most,** even when its structured data
  carries a full bio; `confirmed` came from an unrelated platform's profile matching name, title, firm
  and city, with the domain match.
- **Tell the reader to leave out religion, health, politics and addresses:** a key article's summary
  carried a special-category detail, and the explicit instruction kept it out of every file.
- **SEC refuses in bursts:** full-text and company search both failed mid-batch and worked twenty
  minutes later. SEC reads go last, not retried at once.
- **Two more contact-data sites are on the broker list.**

**Amendments, version 1.46** (from the twenty-second batch, at 1.40: 15 LPs, not-found 2 → 0, facts
147 → 205, one tier B tie):

- **The email domain decides who the team is talking to:** a record whose organization, title, city
  and LinkedIn handle all fit one person, and whose email domain fits another, is a merged record. When
  the person at the handle has no tie to the email domain's organization, the handle is no evidence of
  identity (1.29) — the record is `ambiguous` until someone fixes the contact from our own mail.
- **Sitemap, then the content API:** once a sitemap finds `/team/<name>` and the page shows placeholder
  text, the site's content API carries the entry's title (1.35).
- **Academic LPs' ties live on PL's research subdomain** (funded grants, workshop programmes); a firm
  listed only in the PL directory's API is found by matching W2n's saved list, then reading that one
  entry by ID (1.43).
- **Re-read quotes mechanically:** a batch checked all 138 quotes on 59 pages against the pages' own
  text (a generic User-Agent, a normalised substring match, SEC filings skipped) and caught two
  paraphrases, stitched quotes and a label the reader had invented. A standing script for the pass is
  open.
- **A self-published bio's dated claim that one search can't corroborate stays a caution,** and so does
  a title on our record that only a LinkedIn heading explains — flagged as a contact to fix.

**Amendments, version 1.47** (from the last batch, at 1.39: 15 LPs, not-found 4 → 0, three new
tier C ties):

- **For staff with no investing footprint, funding news comes before the near-us search:** eighteen
  near-us queries, a third of a batch, found no tie, while the once-per-batch reads found an ally, a
  directory team and a co-investment.
- **A summary's "previously" or "former" is a question,** like an absence from a team page (1.9): the
  firm's own site still named the LP as chief executive, and the summary's page returned 404.
- **A local chamber of commerce's listing is a cheap domain match:** it gave our record's dead domain as
  the firm's website, settling a common name with a short firm handle.
- **A Form D that names no sponsor stays a lead** when it matches an affiliate's fund of funds (1.34),
  however well the names fit.
- **ProPublica's API trails its organization pages by a year:** cite the year actually read. A shared
  local tool for binary PDFs (ADV Part 2 brochures included) would save each agent writing one — open.
- **One more people-records site is on the broker list.**

**Amendments, version 1.48** (Juan, 24 Sep, after the header slip of 1.36: "please dont spam gov
websites… request from them carefully and according to their restrictions on use", and "never use any
identifying information for us"):

- **No identity of ours in any request; one address where a service insists.** Juan's address, name
  and domain never go into a request. Where a service requires a contact — SEC's fair-access policy asks
  for one in the User-Agent — the User-Agent is `research-reader blue.tunguska@agentmail.to`, a
  privacy-preserving address Juan gave for this, and nothing else. A service that wants more identity
  than that (a name, an account, a phone) is asked about first, and not used until Juan says so.
- **Government sites by their own rules.** SEC allows ten requests a second; we keep to one, with no
  loops over names and EDGAR full-text search only for a name the finding needs. FINRA, ProPublica and
  state registries the same: sparingly, stopping at the first 403, 429 or 503 and coming back later,
  never retrying in a burst. Parallel batches share one address, so a batch spreads its government reads
  through its run instead of starting with them.

**Amendments, version 1.49** (Juan, 24 Sep, answering the two capacity questions the search pass left
open):

- **An office's size may set a band, by the table.** "It likely can set an informed capacity limit for
  us to make an educated guess. I would guess based on what similar entities with similar sizes tend to
  do in terms of check sizes." So a family office's assets, a foundation's or endowment's, a wealth
  manager's or adviser's assets under management, a fund of funds' size, or a person's net worth may set
  the band — read off `config.capacity.bySize`, never picked by feel. The basis begins "By size:" and
  names the kind and the size with its source ("By size: a family office with $800M in assets, per its
  2025 filing"). The checker parses the kind and the size, looks up the table, and flags a band that
  isn't the one it gives. Every step of the table is a GUESS from general practice, to be replaced by
  what our own closes show.
- **Many angel checks set a floor.** "Many angel checks probably means at least capacity in the
  100K-250K range? maybe more? unsure." Five or more personal angel investments on record, sizes
  unknown, give `$100K+ (floor)` — at least that, the top not known — with a basis that begins "Floor:"
  and counts them ("Floor: 12 angel checks on record, sizes unknown"). Fewer than five, or a fund's
  deals rather than their own, set nothing. Five is a GUESS at "many".
- **A band from their own money still wins.** A check they wrote, a commitment on file, a net worth
  with a source: those set the band as before (1.18). The table and the floor are for when that is all
  there is.

**Open, for Juan:** an unresolved person at a firm our own records confirm (their work domain is the
firm's site) can't carry the firm's facts — its mandate, its typical check — because a finding with
an unresolved identity carries none. They go into `coverage.note` as prose. Allowing firm-scope
facts there (never the person's) would keep that context for a firm-level ask; it changes the
checker and the import, so it waits for a yes.

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

**Amendments, W5 version 1.1** (from its first two batches):

- **One LP's decision is never disclosed to another** — not a commitment, not a pass, not an amount —
  even to the connector who introduced them.
- **"Committed" without evidence is a check, not a win.** A commitment with no signature recorded
  here, an amount that differs between records, or a note that contradicts the status: the next
  step is to verify it (ask shape `verify first`), not to write to the LP.
- **Read the whole firm.** Colleagues at one firm (W3 links them by name and by work domain) get one
  owner and one ask between them; the ask carried on one strategy is marked `firm-level ask` on the
  others, so it isn't counted twice.
- **An owner before an action.** Most pursuits have no owner on the team, and the meeting records
  don't say who from our side was there. The strategy proposes one and says why; the team's rule
  for who takes which kind of LP is a decision for the team, and the synthesis proposes one.
- **What the export now carries** (W0, from these learnings): the close track's amount and state
  (soft until signed; a source's "signed" is a claim), and meetings on dates four or more LPs share —
  an event, most likely, not a one-to-one.
- **Still missing, for a person:** who from our side was in each meeting; what the last message from
  them said; the first-close date (LPs have asked); the SPV's terms; which LPs are already in the
  Rails conversation (there is no Rails list).

**Amendments, W5 version 1.2** (from its third batch, iteration 3):

- **A shared outreach date is a mailing.** Dozens of LPs share each of the three most common "we
  wrote last" dates. When `contact.outreachShared` is ten or more, the next step is a first personal
  note, not a follow-up — they have never had one.
- **The close-contact mark is tier C, always.** It is relationship strength (CLAUDE.md: a tier-C
  edge) and never says whose contact the LP is. With no owner on the team, the first step is to
  name who holds the relationship and give them the pursuit — before any outreach.
- **A stage that claims contact the log doesn't show is a check.** "Contacted", "Lost – No Response"
  or "First Meeting Held" with no touch on record: the next step starts with checking sent mail or
  confirming the meeting, so we never cross a note we can't see.
- **Run W5 by firm, lead conversation first.** Where a colleague is already talking with us, the
  plan is usually "no separate note; ask inside that thread", taken from the lead's strategy — which
  also carries the firm's mandate. Batches are grouped by firm, and the colleague with the most
  contact is written first, so owners don't clash.
- **Pin the inputs.** `made.inputs.finding` is the finding's `researched.at` (or null when there was
  none). A strategy whose LP has since gained a finding is stale; the checker counts them, and
  they are written again.

**Amendments, W5 version 1.3** (from its fourth and fifth batches):

- **`verify first` is for any records that disagree,** not only commitments: a reply on file and a
  stage that says "Lost – No Response"; a ladder rung the stage contradicts.
- **Fix the contact before any note.** When the organization, title or profile on file is wrong —
  one contact looked like a different person, so an "unanswered" note may never have reached them —
  the first step is to correct it.
- **Our notes can settle an identity, and can mislabel one:** a meeting note naming the exact role
  confirms a probable identity; a note calling a charitable trust a family office moves it to the
  committee lane, and the 2027 list.
- **`co-invest`** is the ask for a specialist fund in our field that already backs our portfolio
  companies: a co-investor relationship, not an LP commitment.
- **Keep the next step short.** The import keeps what, who and when together in 400 characters and
  cuts the rest; the checker counts the ones it would cut. The why belongs in `angle` and `risks`.
- **Read the LP's triage line** (`triage.jsonl`): its first step and reasons come before any plan.

**Amendments, W5 version 1.4** (from its sixth batch):

- **`verify first` when a claim runs ahead of the evidence, or records point opposite ways** — not
  when a stage is merely out of date. A stage that lags the records ("To Research" with a meeting on
  file) is corrected as part of the next step, trusting the records.
- **A record far from investing is a question of identity.** A work address and title belonging to
  someone with no investing at all, with a famous investor of the same name, means the team may have
  meant the other person: fix the contact first.
- **"Last from them" can be a meeting, not a reply.** A meeting counts as from them; the export now
  says how the last touch happened (`contact.lastTouchChannel`).
- **One firm, one money ask.** The checker counts firms whose money is asked for twice (colleagues
  by work domain); the lead conversation's strategy carries it, the others say `firm-level ask`.
- **Someone who has met us needs no introduction:** W11 no longer proposes one.

**Amendments, W5 version 1.5** (from W5c, the critic's first sample: 25 strategies, 10 A, 12 B,
3 C — quality rising with each version; its five recurring problems, and three rule slips):

- **Say only what the record says.** Owning a pursuit is not having been in the meeting. Before
  calling something a reply or a one-to-one, read `contact.lastTouchChannel` and
  `contact.groupMeetings`. A stage is a claim.
- **Evidence gates.** Capacity is a band only with assets or net worth, a check or commitment on
  record, or a filing — otherwise `unknown`. "This year" needs a dated word from them in the last 90
  days, a commitment on the close track, or a meeting that wasn't a group date; otherwise the 2027
  list, until the check in the next step comes back. The checker counts both.
- **Money on file comes first.** When the close track has an amount, the ask starts from it, soft
  and labelled; a strategy never reads "no amount visible" beside one. A historical vehicle, or an
  SPV that never went through, is never a fit.
- **Read every finding at the firm before setting the lead's ask:** a firm's live raise can sit in a
  colleague's finding, not the lead's. A colleague the research found has left is no longer at
  the firm (W3 now groups them with their new one).
- **The lead strategy carries the firm.** Colleagues by work domain and by W3's same-firm links; the
  lead lists every colleague with their owner and status, names the one owner and the one money ask,
  and the others say `firm-level ask`. A partner's personal check at a large firm is marked
  personal, so it isn't a second ask of the firm.
- **A founder of one of our portfolio companies is a reference and a connector first:** the first
  ask is their view and their introductions, and money, if ever, comes after. The same holds for a
  founder of a company Protocol Labs backed (PL's directory marks it "Venture Investment"; Affinity's
  portfolio-founder lists; a protocol.ai logo among their investors).
- **"Raising now," one definition for every strategy and the synthesis:** a Form D, or an amendment,
  with money unsold and dated in the last twelve months, and no later word that it closed. Older
  with nothing newer is a question to ask, never a raise.
- **`ask.unit` names who would commit** — the unit at a firm, or "personal" for a partner's own
  check — so "one firm, one ask, made to the unit that commits" stays machine-readable.
- **An ask carries no range while capacity is unknown** (the critic's round two): a range with no
  evidence of the LP's own money behind it gets round the capacity gate. The checker counts them;
  thirty were unsized by rule, each noting the rule in `made.revised`, with sizing an open question.
- **A firm-level strategy pins its lead:** `made.inputs.lead` is `{ key, at }` — the lead strategy's
  key and its `made.at` — and the checker counts those whose lead has been rewritten since.
- **Re-read the paths just before writing each firm** — `connections.jsonl` is regenerated as
  findings land, and a pinned `bestPath` then marks the strategy stale.
- **An LP outside the US: counsel before any fund material.** What may be sent to, say, a UK
  recipient about a US 506(c) fund, and how a non-US investor is admitted, is a question for
  counsel. The first note carries no fund terms, and the gate is written into the strategy. It
  covers where the investing entity is registered as well as where the person lives (an insurer
  based in the US and registered in Bermuda).
- **A firm's stated scope is not an exclusion, in the next step too:** "focused on direct deals"
  never becomes "…, not funds" in a one-line step.
- **A date an LP was added to our list is not an event:** the list was loaded in bulk on a few days;
  "why are they on the list" is a question for the team, not a date to chase.
- **A work domain that now redirects** (a renamed firm, a move) may mean our emails never reached
  them: the next step is a first personal note to a current address, not a follow-up.
- **A firm that says it doesn't invest in funds** (a quoted exclusion in its finding): the fund
  gate is no. The ask is a co-investment or an SPV at most — or none.
- **A GP raising a fund of their own right now** (a recent Form D with money unsold): lower
  propensity for an LP commitment — an ask of their partners reads as a trade. The ask becomes
  introductions or co-investing. This covers a fund that invests in companies; **a fund of funds
  raising its next vintage is raising money for managers like us** — a timing signal in our favour.
- **"Raising now" needs a date:** a fund announced long ago with no Form D read is neither known to
  be raising nor known to be closed — hold the money ask, and leave the Form D as a question.
- **One firm, one ask — made to the unit that commits:** at a firm with a wealth unit and a fund-of-
  funds unit, the money ask names the unit that would commit, wherever the lead conversation sits.
- **Every Discussing or Committed LP gets a strategy,** from our records when the research found
  nothing: a firm's lead can be one of them.
- **The next step:** one person, one action, a date — under 300 characters with who and when.
  Whatever its own risks say must come first, comes first. **A note to several people never carries
  one person's amount or words.** A connector path keeps the tier the connection file gives it: a D
  is never called C, and never the way in.
- **Pin every input:** `made.inputs` carries the finding's `researched.at`, the close track's
  amount and state, and the best tier among the LP's paths on file (`bestPath`); a change in any of
  them makes the strategy stale.
- **An old address at our own domain joins nobody.** Two LPs who once had protocol.ai addresses
  don't share a firm now; each keeps their own money, and a partner's check at a large firm is
  marked personal.

**Amendments, W5 version 1.6** (from W5c's third round, which graded every "this year" strategy and
every one for an LP who wrote to us last — the ones a person acts on first — against the six
criteria and a seventh, the last word):

- **When the last word is theirs, the next step answers it.** Triage's "reply we owe" means they
  wrote last and nothing from us is on record since. The next step reads what they wrote and answers
  it — the question they asked, the dates they offered — or says plainly why not (a reply may have
  gone from an inbox Affinity doesn't see: check sent mail first; counsel first). A new question of
  ours before theirs is answered is not a reply, and "silence since" is ours, not theirs.
- **One meeting, one date.** Two people at one firm with a meeting on the same day were most likely
  in one meeting: neither is a one-to-one on that record alone. A meeting a note only scheduled is
  not held until a record says so.
- **Owning a pursuit is not a channel.** Who owns an LP's pursuit says who acts, not that they know
  the LP; the way in needs its own record.
- **Cite W3 as it stands.** A path, a W3 row or a connector-plan pairing named in a strategy is one
  the current files carry, at the tier they give it; a tie W3 has since dropped is gone, or at most
  a clue the files don't carry. The checker counts the citations that no longer match.
- **The lead re-reads its colleagues** — their findings and their strategies' `made.revised` notes.
  A firm-level lead is stale when a colleague's finding is newer than it: a filing on one colleague's
  record can change the firm's ask; and a colleague revised first can be ahead of its lead (one call
  read as one, a reply answered first), which a re-pin alone would leave contradicting it.
- **The team's context comes first** (issue 0016): `candidates.jsonl` carries `context`, what the team
  wrote on an LP's page to add to or correct what we know, newest first. It outranks the research
  and the notes' readings; where it contradicts a finding, the strategy follows the team and says so.
  A strategy written before the newest context is stale (`isStale`), so the next revision batch
  re-thinks it.
- **A park carries a date to look again** (the critic's fourth round, on the bulk): "park him until
  the search pass" is a park for good if the pass never runs. `next.lookAgain` holds the date; a gate
  counts a park without one, and `scripts/enrich-look-again.ts` sets it by rule where missing (the
  2027 list on 4 Jan 2027, "not now" on 5 Apr 2027 — guesses for a person to change), recorded in
  `made.revised` without moving `made.at`, so a colleague's pin stays valid.

**Amendments, W5 version 1.7** (from the rewrite after W1's search pass: 20 batches, 299 LPs — some 248
strategies revised or re-pinned, 51 written for identities the pass had just resolved):

- **A re-pin still reads every claim:** the search pass cut facts to their pages' words (W1 1.26), so an
  old strategy can repeat a claim no current fact supports. "No change after the search pass" means no
  change a person acts on, after that read — never a bare update of `made.inputs`.
- **A park "until the search pass" is now due:** each gets a plain dated look-again, or the step the
  pass made possible. The park gate reads parks worded without the word ("waits for", "hold until"), and
  only a date the park itself introduces ("to", "until", "look again") counts.
- **The ask names the unit that commits** (`ask.unit`): a family office's fund-seeding arm, a foundation's
  investment office — and our contact is who routes us there.
- **Affinity, written down** (it drifted between parallel batches): *high* — a personal interest in our
  field in the LP's own words (their writing, a scientific advisory seat); *medium* — their own deals in
  health or neuro, through a firm; *low* — a firm's holdings or an institution's field.
- **A band sizes the unit that commits, with that unit's own money:** the gate refuses a firm's clients'
  money, a fund's target, a company's valuation or sale, and evidence more than six years old. Where a
  finding carries such a band, the strategy stays at unknown and says why — the W1 band and the W5
  reading disagree on purpose until Juan settles which an office's totals may set (open).
- **The records come first:** in several batches half the next steps begin by fixing our own record — a
  merged record, a misspelled name, a dead domain, a renamed firm, a title the pages contradict.
  `scripts/enrich-fixes.ts` lists them for one sitting in Affinity (shown on the enrichment page).
- **Batches carry whole firms, and expire:** a lead rewritten outside its colleagues' batch unpins them;
  the cutter now lets a batch hold its keys for three hours only (a re-pin kept `made.at`, and 28 stale
  strategies went unbatched), and a firm's out-of-batch leads and colleagues get a revision of their own,
  not only a re-pin.
- **Gates fixed on the way:** "(May 2026)" read as the hedge "may"; a Form D's "date of first sale" read as
  a sale; "a parked page" and "Parker" read as parks; triage's "rule out our field" fired on the research's
  own sentences, not the firm's quoted words.

**Amendments, W5 version 1.8** (N81, after Juan found Rails meetings and catch-ups counted for Neurotech):

- **Every meeting date and every note says what it is about** (`about` in `candidates.jsonl`), and
  so do their last eight touches (`contact.recent`, added after the first re-read: an email-only LP's
  emails carried no tag), each with who from our side was on it: a vehicle's name, "vehicle unclear",
  or "general". A vehicle's own rows are evidence of where that
  pursuit stands; general rows are who they are, true for every vehicle; a row tagged with another
  vehicle is context — worth a line when the two asks need coordinating (rule 5), never progress on
  this one. A "vehicle unclear" row is evidence for none: if it decides the next step, the step is to
  ask its owner which vehicle it was.
- **Two contact blocks:** `contact` is the relationship since their raises opened, about anything —
  a reply owed is owed whatever it was about — with what came before summed in `contact.earlier`;
  each pursuit's `contact` is what counts for its vehicle alone. "Met us" for a pursuit means a
  meeting tagged with its vehicle.
- **A strategy written on the old reading is re-read**, not only re-pinned, where its pursuit's
  counted contact changed: the meetings it cited may now be another vehicle's, or a catch-up.

**Amendments, W5 version 1.9** (Juan's capacity answers of 24 Sep; W1 1.49 has the rules):

- **A band by size or a floor counts as evidence, held to its rule.** A strategy may carry the band the
  size table gives — basis "By size: …" — or the angel floor — basis "Floor: …". The gate accepts
  either and flags one that isn't what its rule gives ("capacity off the size table", "a floor without
  the angel checks behind it"). This settles the open question of 1.7: a wealth manager's clients'
  money still isn't the LP's own, but its size now sets an estimate for what such a firm places.
- **The ask follows the band, and says it is an estimate:** "an estimate from their size" beside a
  range, never a range as if they had named it.

**Amendments, W5 version 1.10** (from the re-read of 126 strategies on the tagged records, nine readers):

- **"This year" rests on the pursuit's own contact.** The evidence gate reads each pursuit's counted
  contact — a word from them in 90 days, or a one-to-one meeting, tagged with its vehicle — not the
  relationship's: a catch-up keeps the relationship warm, it doesn't move the raise. Seven strategies
  failed the stricter gate and were read again.
- **A size that is only a lower bound is read at its floor.** A 13F's listed holdings, a "billionaire"
  with no figure, a vehicle's running total: the table's band for that figure, and the basis says it is
  a floor. A figure for a parent, a former employer or a fund's target is no size of the unit that
  commits. The kind is the one named first in the basis ("a multi-family office" is a wealth manager).
- **What the export now carries:** each LP's last eight touches with their tags and who from our side
  was on them (`contact.recent`), so an email's vehicle is read from the file, not guessed. And an
  event is four or more *parties* on one calendar entry — a firm or a person with none — so four people
  from one family office are a meeting.
- **Rungs on records now tagged General are for a person.** 103 rungs on 37 LPs were approved on
  records the re-map reads as not about their vehicle. A strategy says so where it matters and never
  proposes a stage from them; the list is on Approvals, and withdrawing one is Juan's decision.
- **The version is a string from "1.10" on.** JSON reads the number 1.10 as 1.1, and the batch cutter
  took every such strategy for one older than 1.3 (a reader caught it); `versionBefore` compares
  major and minor, and a strategy writes `"version": "1.10"`.
- **The table has no row for** a GP's own funds, an insurer, a pension, a health system's investment
  office, or a corporate venture arm: those stay unknown and say why. Whether to add rows, and whether
  a self-described size counts, are Juan's.

## Protocol — W12, what each event is about (version 1)

Juan, 24 Sep: "some meetings or notes from affinity are getting attributed to PLC Neurotech when they
may be for PLC Rails, or they may just be general catchups. Hmm maybe tag each event with which
vehicles (if any) it involves … Important that the info feeding strategy is appropriately tagged for
the vehicle. some of the info will apply regardless of vehicle, but some will be specific."

The rules (N59, N81; `lib/connectors/affinity/about.ts`) read words. They cannot tell neurotech the
field from PLC Neurotech I, a portfolio company from its SPV, or which fund "the fund" means, and until
N81 they read every meeting with a colleague on the invite as about the raise. W12 reads each record
whole, as a person would, and writes one tag per record. Translation lays the tags over the rules; a
person's tag on the LP's page stands over any of them. Only a record tagged with a vehicle, inside its
raise window, counts for that vehicle's pipeline and ladder; the rest are shown, labelled, and count
for none.

**Input.** `data/real/tags/batches/tNN.json`, cut by `scripts/event-tag-batch.ts` from a copy of the
database: `vehicles` (slug, name, kind, aliases, raise window) and `records`, each LP's together,
oldest first. A record: `ref`; `kind` (email, meeting, call, message, note); `on`; `dir`; `words` (an
email's subject or a meeting's title); `note` (the words of the note on it, or of the note itself);
`noteBy`; `team` (who from our side); `lps` (the LPs on it, each with the vehicles they are on and the
status there); `rule` (what the rules read, and why).

**Output.** `data/real/tags/out/tNN.json`:
`{ "batch": "tNN", "by": "claude (sub-agent)", "at": <now>, "tags": { "<ref>": { "about": "raise" | "other", "vehicles": [<slug>, …], "basis": "<why>" } } }`,
one line for every record in the batch and none for anything else.

**About a raise** means about raising money for one of *our* vehicles — the batch's `vehicles`: an
intro to invest, a pitch or a first meeting about investing with us, the deck, the data room, the
terms, a question about the fund, an indication, a commitment, subscription documents, a side letter,
a capital call, a close, or a follow-up on any of these. Everything else is **other**, which the page
shows as *General*: a catch-up, research or science, a portfolio company's business or its own raise,
someone else's fund (theirs, or one we are an LP in), an event and its logistics, recruiting, an
investor update a company sends us, an automatic reply. General is not noise: it applies to every
vehicle, and the strategy step reads it as who they are.

**Which vehicle**, only when the record's own words, or a record it plainly continues, point to it:

1. **It names the vehicle** as our fund or SPV: the name, or an alias used that way. A word that is
   also a field or a company is not enough — "neurotech" the field, a portfolio company by name
   ("their board meeting") is not its SPV — unless the talk is about investing in it through us, near
   the SPV's window.
2. **It speaks of what only one vehicle is**, when the talk is about investing with us:
   brain–computer interfaces, neuroscience, neurotech → PLC Neurotech I; crypto, stablecoins,
   payment rails, blockchain infrastructure → PLC Crypto/Rails.
3. **It continues a record that points to one**: the same thread ("Re:", the same subject), the note
   on the same meeting, the follow-up an earlier record asked for. The basis begins "Continues:".
4. **Inferred.** About raising with us, no word that picks a vehicle, and every LP on it is on the
   list of exactly one vehicle — the same one — whose raise window covers the date: that vehicle, with
   a basis that begins "Inferred:" and says why ("Inferred: 'the fund', and they are on PLC Neurotech
   I's list only"). Juan asked to have bulk decisions made for him, traceable by rule; this is that
   rule, and a search for the word finds every one of them.
5. **Otherwise unclear:** about a raise, `vehicles: []`. Say in the basis what it most likely is, if
   anything ("'the fund'; they are on both lists").

A record about two vehicles gets both. A list is never a reason on its own: a catch-up with someone on
Neurotech's list is other. The date alone is never a reason. The rules' reading is a hint: often right
about a named vehicle, often wrong about the rest; confirm or overturn it on the words.

**A record with nothing to read** — no words, no note — is other, "Nothing on record says what it
was", unless it plainly continues a neighbour (3).

**The basis** is 25 words or fewer and quotes at most 10 of the record's: no health detail (write
"[health detail]" if it matters), no amount, nothing personal, no name of anyone outside the team.

**The check.** `DATA_PROFILE=real npx tsx scripts/event-tag-merge.ts --check tNN` reads the output
against the batch — a line for every record, "raise" or "other", only the batch's vehicles, none with
"other", a basis within bounds and free of health words — the same check translation makes when it
loads the merged file. Fix what it reports.

**Amendments, W12 version 1.1** (after the first pass: the readers split on our own events):

- **Our own events are about the fund they court.** An investor event we host — a dinner, a breakfast,
  a salon, a roundtable, a speaker invitation — whose name or theme is one vehicle's (neurotech,
  brain–computer interfaces → PLC Neurotech I; crypto, stablecoins, payment rails → PLC Crypto/Rails)
  is about that vehicle's raise: it is how we raise. The basis begins "Our event:". One about the firm
  as a whole gets both funds only if its words take in both; otherwise the vehicle is unclear. A
  Protocol Labs or portfolio demo day, a conference, someone else's event and general networking stay
  General. Three readers had filed our events as General and one as the fund's; Claude decided this on
  Juan's standing instruction to decide in bulk (24 Sep), for him to overturn — a search for "Our
  event:" finds every one.
- **A second copy of a meeting takes the first's tag.** The calendar and a list entry can each hold the
  same meeting; the readers found the copies read differently. Tag them alike, and say "Continues:".

## Running W12 as a sub-agent

1. Read this protocol and your batch files. Nothing else of the real data is needed.
2. No web search, no fetch: everything the tag rests on is in the batch. Write only
   `data/real/tags/out/<batch>.json`; no git.
3. Run the check on each batch and fix what it reports.
4. Reply with counts only — records; about a raise with a vehicle (named, continues, inferred); about a
   raise, vehicle unclear; general — and three learnings about where the rules read wrong. No names, no
   quotes from the records.

## Running W1 as a sub-agent

The instructions a research agent follows, so a launch names only its batch. Its prompt carries no
real data; it reads its batch file.

1. Read, in full: this document's W1 protocol and every amendment; `lib/enrich/schema.ts`; the
   "Real data" section of `CLAUDE.md`, with the enrichment exception; three finished findings in
   `data/real/enrich/raw/` for shape and tone.
2. For each line of `data/real/enrich/batches/<batch>.jsonl` (key, name, org, role, location, work
   domains, identity fields), research with WebSearch and WebFetch and write
   `data/real/enrich/raw/<key>.json` in the `Finding` shape, with `researched` set to
   `{ at: <now>, by: "claude (sub-agent)", workflow: "W1", version: "<the latest amendment, as written>", method: "search" | "pages" }`
   and `scope: "firm"` on what is the firm's. Consecutive lines at one firm share its reading.
3. Rules: read only; no sign-ins, paid services, forms or posts; a query carries only the name,
   organization, title, location and topic words; contact-data brokers and people-search sites are
   passed as `blocked_domains` on every search, and no email, phone number or address is recorded;
   a request carries no identity of ours — no email, name or tool name in any header (1.36);
   no LinkedIn fetches; no health information about anyone; a fact about the wrong person is worse
   than none; a key signal is read on its page and quoted before it is `medium` or `high`; about four
   searches and two good reads per LP, plus one per key signal; staff with no footprint stop at three
   searches. Write only inside `data/real/enrich/raw/`; no git.
4. Finish with `DATA_PROFILE=real npx tsx scripts/enrich-check.ts`, fix what it reports in your
   files, and reply with counts (researched; identity outcomes; facts; neuro signals by scope;
   Protocol Labs and crypto ties), the checker's summary line, and three to six learnings about the
   protocol. No names in the reply.

**Pages only.** A launch that says "pages only" follows amendment 1.6: no WebSearch call at all,
not one — the session's budget is shared and spent — and `method: "pages"` on every finding. The
rest of the rules stand.

## The search pass, when the budget allows

Every finding made from pages alone (`method: "pages"`) is owed one. It is cheap to start:

1. `DATA_PROFILE=real npx tsx scripts/enrich-batch.ts w1 r 15 --search` cuts the batches — the
   pages-only findings, whole firms together, discussing and selected first.
2. Each agent runs W1 as written (amendments through 1.5 for the searches; 1.6–1.12 still apply to
   the reads), starting from the finding already on file rather than from nothing: its
   `coverage.notFound` lists what "for the search pass" should look for. The first search is the
   "near us" check (the name with Protocol Labs, IPFS or Filecoin, limited to those sites); then
   funding news that names backers; then, for a `not_found`, the name with the organization.
3. The finding is rewritten with `method: "search"` and the new version; the checker, W3, W9, W11
   and the import run as always, and strategies older than their finding go back in the W5 queue.

Budget: about four searches per LP, so a session's 200 covers some fifty LPs — the Discussing and
Selected first, then the research-first lane. Raising `CLAUDE_CODE_MAX_WEB_SEARCHES_PER_SESSION`
is the user's decision, never an agent's.

## Running W5 as a sub-agent

1. Read, in full: this document (the W5 protocol and what the earlier research says);
   `lib/enrich/strategy.ts`; the "Real data" and "Domain rules" sections of `CLAUDE.md`; the finished
   strategies in `data/real/enrich/strategy/`.
2. For each key in `data/real/enrich/batches/<batch>.txt`, read its finding, its line in
   `candidates.jsonl`, its paths in `connections.jsonl`, and our side (`us/team.json`, `us/network.json`,
   `presence/site.json`); write `data/real/enrich/strategy/<key>.json`, `made` set to
   `{ at: <now>, by: "claude (sub-agent)", workflow: "W5", version: 1.5, inputs: { finding: <its researched.at, or null>, money: <"<track> <state> <amount>" from candidates.jsonl, or null>, bestPath: <the best tier among its paths in connections.jsonl, or null> } }`. Skip an unresolved identity unless
   our own records alone support a strategy. An LP with no finding yet (W9's "warm now" lane) gets a
   strategy from our records alone — its line in `triage.jsonl` says why it is warm — at `low`
   confidence, with "research them" among the open questions.
3. Rules: a proposal for a person, never a decision; one concrete, bounded next step by a named
   person, with when and which material; never a deck with a first intro, never anything sent
   without a person, no pressure; soft is soft until signed (rule 1); a C or D path is a clue, not a
   route; no health inference; capacity is a band and an estimate; two lists, this year and 2027.
   Web searches only to verify a key fact, on the W1 query rules, with no identity of ours in any
   request (1.36). Write only inside
   `data/real/enrich/strategy/`; no git.
4. Finish with the checker, fix what it reports, and reply with counts (written, skipped; by list; by
   ask; routes A/B vs C/D vs none), the checker's strategy line, and three to six learnings. No names.
5. **Parallel batches keep a firm together** (iteration 4). Rewriting a lead unpins every
   firm-level colleague in another batch, so batches are cut by firm (the lead, its colleagues by
   work domain and organization), a lead is written before its colleagues, and one re-pin step runs
   after all batches finish (`enrich-check --lead-moved`, `--unpinned`). The checker's other lists
   feed the next batch the same way: `--gated`, `--stale-ties`.

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

### Iteration 2 — four agents in parallel, 40 LPs (24 Sep, 03:55–04:11 UTC)

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

### The search budget (24 Sep, 04:20 UTC)

The session's web-search budget — 200 searches, shared with its sub-agents — ran out after about 50
LPs. Page reads still work. A search engine read as a page would get around the budget rather than
respect it, so the rest of this session works without search:

- **W1d, the domain-first read**, reads an LP's firm from their work domain: the homepage, then a
  team or about page. Tried on a few Connecting LPs: firm sites are often script-drawn or
  minimal, and without search the right page is a guess. Its yield is too low to run at scale; it
  is kept for firms whose site is known to carry bios.
- **W9, triage the cold**, is new: the Connecting LPs ranked from what we already have — a
  colleague at their firm who has met us, a Protocol Labs domain, a backer firm, the title's
  seniority, how long we've waited — into who deserves research first when the budget returns,
  who has a warm way in now, and who is cold.
- Raising `CLAUDE_CODE_MAX_WEB_SEARCHES_PER_SESSION` resumes W1 as it was.

### W7 — our materials, graded (24 Sep, 04:25 UTC)

The public site as an LP reads it, against docs/01 §4 and docs/05. Thesis **B** (a clear line, no dated
memo); evidence of edge **C** (strong portfolio names, nothing that shows how they were won); team
**B**; **a path for an LP: F** — every contact is for founders, nothing says the fund is raising, and
there is no route to the deck or to accreditation; how the vehicles relate **C**; reach and primer **C**
(the February webinar exists but isn't on the site). Six suggestions, led by an LP page for the fund —
506(c) allows saying it is raising, with counsel on the wording. The deck and the webinar sit on
DocSend and were not read: a person grades those.


### Iteration 3 — without search, and what our own records say (24 Sep, 04:45 UTC →)

The search budget was spent, so the research went on from page reads alone (W1d, amendments
1.6–1.8), four agents at a time, while the strategies and the workflows that need no web ran
beside it.

- **Page reads work better than the first try suggested.** The work domain on file led to the
  right bio for nine of ten LPs whose domain was a firm's site; EDGAR's full-text search, Form D,
  the proxy statements and 13D/13G signature blocks filled in principals, fund series and current
  raises. Across the first three pages-only batches (41 LPs), 25 resolved and 16 were not found — all
  of those staff at firms whose sites list only their leaders. A pages-only finding is marked
  `method: "pages"` and stays owed a pass with search; "not found" there means "not named in what
  could be read".
- **The strategies (W5, 47 more, 93 in all) kept finding the same thing: our records claim more
  than they show.** Across the Connecting and Selected LPs, 80 carry a stage that claims contact
  ("Contacted", "Lost – No Response", "First Meeting Held") with no touch on record; the last word
  from us to 154 LPs was one of three mass mailings; 11 of the 17 with a way in have nobody on the
  team owning the pursuit; in one batch, five of fifteen had the wrong organization or title on
  file. So triage now gives a **first step** before any outreach — name an owner, check sent mail,
  or write a first personal note — and W5 (version 1.2) starts there.
- **The close gap.** The fastest money toward the first close is signatures from people who have
  already said yes. The synthesis now lists the committed LPs by what the close track shows — soft
  and unsigned, signed per a source and unverified, countersigned, wired — state by state, never
  summed across states (rule 1).
- **Connections from shared records (W3).** Two LPs in one company's record — both invested, both
  on its board — are a C clue; two who only worked at one company, at times nobody compared, are D.
  Matching names in sentences invented ties ("Science" in "computer science", a sentence denying a
  Protocol Labs tie read as one), so a one-word name counts only in a fact's structured parts and
  a denial never counts; W1s, a no-web pass, puts each fact's company in `detail` from its own
  words.
- **The connector plan (W11).** Seven connectors next to seven prospects, most of them committed
  LPs next to colleagues at their own firm; a connector is asked once their own commitment is
  signed. Committed LPs' networks are mostly not in our records, and no amount of public reading
  will put them there: asking is the workflow (docs/06 §3.3).
- **The Protocol Labs network (W2n).** PL's directory (os.pl.xyz) has a public API: 1,733 teams, 667
  of them funds, 36 in neurotech. One lookup per LP by name — the "near us" check the pages-only
  research couldn't run — found 18 with an entry under their own name, 15 of them matching our
  record (their firm, their work domain): PL's own record that they're in the network, tier B. 57
  work at a firm that is a network team: the firm's tie, C. Contact fields are never kept.
- **The synthesis reads top-down now.** Five lines to start (signatures, the five most ready, the
  checks, introductions, research), then the close gap, the first notes worth writing (a signal of
  their own in our field), founders as references (LPs who backed our portfolio companies), what
  changed for them in the last year (dated signals), and our own network — before the long lists.
- **The critic (W5c).** A no-web pass graded 25 strategies across the protocol's versions: 10 A,
  12 B, 3 C, none D — and the grades rose with each version (version 1: 2 of 13 A; 1.3 and later: 4
  of 5). The recurring faults were reading our records for more than they say, stale inputs, firms
  not coordinated, next steps too long to survive the import, and estimates ahead of the evidence;
  the three Cs were rule slips (one LP's amount in a note to a colleague, a soft commit nobody gave,
  a D tie used as C). They became W5 1.5, and the checker's gates now count what a strategy claims
  beyond the files. Every strategy written before 1.3, or flagged, is being rewritten at 1.5 — firm
  by firm, the committed LPs first.
- **The critic, round two.** The same six criteria on 25 strategies written at 1.5: 22 A, 3 B, no C or
  D (round one: 10 A, 12 B, 3 C). Every strategy in both samples held or rose — the C and four Bs
  became A. What remains: an ask carrying a range while capacity says unknown (now a gate), a firm's
  or a founder's rule half applied, a record read for a little more than it says. The critic's
  verdict: a GP can work the set on Monday, and it is mostly internal checks with notes behind them —
  and one owner carries most of it.
- **The litmus test.** As outreach, most of the Connecting list is not ready to act on; as a list of
  internal checks, it is. What is ready now: the committed LPs' signatures, the warm lane once each
  has an owner, and the checks. What no workflow here can supply: who from our side was in each
  meeting, what the last message said, the first-close date, and a search pass for the pages-only
  findings.

### Where the loop stood (24 Sep, 08:43 UTC)

- **Research: every LP in the set is read** — 388 of 388: 54 with web search as the protocol asks,
  319 from page reads alone and 15 with a few searches, too few to follow it (334 owed the search
  pass; the 15 are no longer said to have had "no web search"); 304 resolved, 78 not found
  (mostly staff at firms whose sites name only their leaders), 6 ambiguous. The protocol went from
  amendment 1.5 to 1.25, each batch's learnings becoming the next.
- **Strategies: one for every resolved LP and every Discussing or Committed one** — 330, all at W5
  1.5, with no checker problems, no firm asked for money twice, and every input pinned. The critic's
  two rounds measured the loop: 10 A, 12 B, 3 C before; 22 A, 3 B after.
- **What the records need before any outreach** (W9's first steps): replies we owe, sent-mail and
  bounce checks, owners to name, first personal notes instead of follow-ups. The committed LPs'
  first step is nearly always an internal check: where the signed documents are.
- **What only a person can do next:** run the search pass when the budget allows (one command); ask
  counsel the one question that covers every LP placed outside the US; decide what Committed means
  (a countersignature, or a yes with an amount); settle the owner rule; and say where the Rails
  conversation lives, since crypto-native LPs keep landing on the Neurotech list.

### Iteration 4 — the list we act on first (24 Sep, 08:50 UTC →)

- **Two first steps, measured.** Triage's check and the strategy's next step agree on 174 of the
  224 LPs that have both. Of the 50 that differ, most are the strategy being more specific or
  departing on purpose, with its reason given ("fix the contact first", "counsel first"). Not a gate.
- **Coverage says what ran.** 15 findings ran one to five web searches before the budget ran out;
  their LP pages said "with no web search". They now say "a few web searches, too few to follow the
  protocol" (`partialSearch`). The split: 54 search, 319 pages alone, 15 pages with too few searches.
- **The critic, round three (W5c),** on the 47 a person acts on first — all 33 "this year"
  strategies and 14 more that owe a reply — by the six criteria and a seventh, the last word: 27 A,
  16 B, 4 C. "This year" held (21 A, 11 B, 1 C); 15 of the 25 that owe a reply didn't answer what
  the LP wrote. Of 17 graded before, 13 held, 2 rose, 2 fell on the new checks. Two slips became
  gates (the counsel gate for an LP placed outside the US, 18 strategies; a tighter capacity check);
  the rest became W5 1.6. Revisions: four batches rewrote 52 at 1.6 (every
  reply we owe now answers first; no list changed); a pass pinned all 37 firm-level asks to their
  leads; every lead reached 1.6 with its colleagues re-pinned after it.
- **The critic, round four,** on a fresh random 25 from the bulk (20 on 2027, 5 not now): 25 A — an
  easy sample. 12 parked "until the search pass" with no date to look again (54 of 57 parks in the
  set): `next.lookAgain`, a gate, and a rule to set it (guessed dates, recorded on each).
- **The checker ends the round** at 388 findings and 330 strategies with no problems, none stale, no
  gate, no lead moved or unpinned, no stale W3 citation. 94 strategies at 1.6, 235 at 1.5.
- **The fact check (W1c), new:** 171 facts in 20 findings re-read at their cited pages. Of the 153
  that loaded, 133 supported, 19 partly, 1 not; no one else's facts; 18 of 20 identities hold, 2 in
  doubt. The partials' three causes became W1 1.26; the 20 findings were corrected to their pages,
  each correction listed in `researched.corrected` without moving the date it was read. Of the 20: 16 changed, 4 untouched; 19 facts cut to
  their pages' words, 2 split, 1 removed, 13 moved to cautions as unconfirmed, 8 `detail` fields
  removed; no identity changed.
- **The checker says what it counts.** "Naming an LP outside their paths" (34) left out colleagues,
  paths in the other direction and privacy guards: 22 remain, 11 citing a W3 tie the files no longer
  carry (revised). The special-category review no longer counts a surname or a first name. The
  synthesis counts people, not a firm's name, as owners: one person holds 190 of 330 next steps.

### Where the night ended (24 Sep, 11:30 UTC)

- **Research:** 388 of 388 LPs read; 304 identified (278 confirmed, 26 probable), 78 not found, 6
  ambiguous. 54 with web search as the protocol asks; 334 owed the search pass (319 from pages alone,
  15 with too few searches). The facts behind every "this year" strategy were re-read at their
  sources and corrected to them: two rounds, 299 facts in 39 findings; of the 269 read, 223
  supported as written (83%), 43 partly, 3 not, none about someone else; no identity wrong. 18
  identity fields in the corrected findings still rest on a page that wasn't read (places, roles,
  organizations that W3 and the counsel gate read): a decision for a person, not a rule's.
- **Strategies:** 330 — 33 this year, 249 for 2027, 48 not now — with no checker problems, none
  stale, no gate, every firm-level ask pinned to its lead, every park dated. The critic's rounds,
  as the loop's measure of itself: 10 A of 25, then 22 of 25, then 27 of 47 on the list we act on
  first under a stricter seventh criterion (revised since), then 25 of 25 on a fresh sample of the
  bulk.
- **What only a person can do next:** decide what Committed means (a countersignature, or a yes with
  an amount); raise the search budget for the pass 334 findings are owed; settle the owner rule (one
  person holds 190 of the 330 next steps); ask counsel the one question that covers the 40 LPs placed
  outside the US; say where the Rails conversation lives; and answer the replies we owe, which our
  export dates but can't quote.

### The search pass (24 Sep, 16:10–19:10 UTC)

Juan raised the session's search cap, and the 334 findings made from pages alone got their pass with
web search: 23 batches of whole firms, six agents at a time, the protocol amended after every batch
(1.27 to 1.47).

- **Identity:** of the 334, not-found went from 74 to 4 — staff resolved on rosters, filings and
  their own firms' pages. Across all 388: 325 confirmed, 47 probable, 8 ambiguous, 8 not found (the
  night ended at 304 identified and 78 not found).
- **Facts:** 2,669 → about 4,120 on the 334, 4,423 in all; every fact kept was cut to its page's
  words, and several hundred were corrected along the way — the pass is a fact check as much as an
  addition.
- **Dated news the pages couldn't see:** new roles, board seats, a departure recorded in an 8-K, funds
  raising or closed, renamed firms. "Raising" now needs a filing or close news, never a summary.
- **Capacity:** dozens of bands resting on titles, exits or fund sizes went to "unknown" (1.18), and
  some were set on filings for the first time (13F, Form ADV, 990, annual reports). A sweep of the 20
  the checker's new review listed kept one and withdrew nineteen.
- **Near us:** the name search found little; firm sitemaps, PL Neuro's allies page and the PL
  directory, read once per batch, found most of the new ties. W3 now holds 815 paths for 244 LPs (85
  with a B path; the rest C or D, for a person).
- **Brokers:** the list became whole-domain matching (`isBroker`, `BLOCKED_DOMAINS`), 112 domains long,
  after agents met contact-data sites the old pattern missed — and flagged a legitimate news site it
  shouldn't have.
- **A slip:** three agents sent SEC requests whose User-Agent carried our tool's name and Juan's email,
  some with an LP's name in the query. Stopped mid-pass; 1.36 and CLAUDE.md forbid identity in any
  header.
- **Owed to a person:** a handful of Filecoin Foundation pages that rate-limited or put up a browser
  check; merged or misspelled records to fix in Affinity (the checker lists one likely duplicate);
  whether evidence of an LP's own money with no amount on it may carry a band (seven withdrawn for
  want of one).
