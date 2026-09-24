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
| W9 | **Triage the cold** — who deserves research, who has a way in now, and the check before any note | the pipeline, W3 | `triage.jsonl` | every lane and first step carries its reasons |
| W1s | **Structure** — name each fact's company or fund, from the fact's own words | W1's findings | `raw/<key>.json`, `detail` only | no name that isn't in the words |
| W11 | **The connector plan** — who could introduce whom, within the guard's limit | W3, W9, W5 | `connectors.json` | restricted prospects left out; C and D ties marked to confirm |
| W5c | **The critic** — grade strategies against the litmus test and the rules, without rewriting them | W5, W1, W9, W3 | `strategy-review.jsonl` | grades by protocol version; the issues become the next amendment |
| W2n | **The Protocol Labs network** — who is in PL's own directory, and whose firm is a network team | the research set's names; the directory's public API | `us/pl-network.json`, `us/pl-directory.jsonl` | an entry matched to our record of them, or said to need confirming; nothing for contacting anyone kept |

Batches are cut by `scripts/enrich-batch.ts`, whole firms together, so colleagues share one
reading and one plan. The close gap — committed on the pipeline, and what the close track shows,
state by state — is a section of W8.

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
- **Re-read the paths just before writing each firm** — `connections.jsonl` is regenerated as
  findings land, and a pinned `bestPath` then marks the strategy stale.
- **An LP outside the US: counsel before any fund material.** What may be sent to, say, a UK
  recipient about a US 506(c) fund, and how a non-US investor is admitted, is a question for
  counsel. The first note carries no fund terms, and the gate is written into the strategy.
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
   Web searches only to verify a key fact, on the W1 query rules. Write only inside
   `data/real/enrich/strategy/`; no git.
4. Finish with the checker, fix what it reports, and reply with counts (written, skipped; by list; by
   ask; routes A/B vs C/D vs none), the checker's strategy line, and three to six learnings. No names.

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
- **The litmus test.** As outreach, most of the Connecting list is not ready to act on; as a list of
  internal checks, it is. What is ready now: the committed LPs' signatures, the warm lane once each
  has an owner, and the checks. What no workflow here can supply: who from our side was in each
  meeting, what the last message said, the first-close date, and a search pass for the pages-only
  findings.
