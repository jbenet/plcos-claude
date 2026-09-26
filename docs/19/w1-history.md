# 19 — W1 protocol history

Archive of the design and history through N85. Current rules are in
`docs/workflows/*.md` and AGENTS.md; read only the protocol assigned to the job.

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
