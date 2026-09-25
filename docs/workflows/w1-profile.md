# W1 — Profile an LP: who they are, how they invest, what they care about, from public pages only
The rules in force, amendments 1.1–1.49 folded in; `docs/19-enrichment-workflows.md` keeps the design and the history.

## Inputs

- The batch, `data/real/enrich/batches/<batch>.jsonl`, cut by `scripts/enrich-batch.ts` with whole firms
  together, so colleagues share one reading of their firm. A line per LP: `key`, `name`, `type`, `org`,
  `role`, `location`, work `domains`, `enriched` (Affinity's own: title, location, links such as a
  LinkedIn handle). In the search pass, also the finding on file.
- Once per batch, matched locally: pl.xyz's sitemap; PL Neuro's allies page (plneuro.xyz); W2n's
  directory list (`us/pl-directory.jsonl`); our portfolio and PL's documented backers
  (`us/network.json`).
- `lib/enrich/schema.ts`; three finished findings in `raw/`, for shape and tone; AGENTS.md, "Real data".

## Output

`data/real/enrich/raw/<key>.json`, a `Finding` (`lib/enrich/schema.ts` lists its fact fields, investor
types, source kinds and capacity bands):

    key, name
    researched   { at, by: "claude (sub-agent)", workflow: "W1", version: "1.49",
                   method: "search" | "pages", corrected?: [{ at, by, what }] }
    identity     { match: confirmed | probable | ambiguous | not_found, basis,
                   canonical?: { name, role, org, location }, links?: [{ kind, url }] }
    facts        [{ field, value, detail?, source: { url, title?, published?, kind }, quote?,
                    confidence: high | medium | low, scope?: person | firm }]
    profile      { summary, investorType, howTheyInvest?, interests?, capacity?: { band, basis },
                   signals?: [{ what, on?, source? }], cautions? }
    connections  [{ to, kind, basis, source?, tier: B | C | D, scope? }]
    queries      [{ q, useful? }];  coverage { searched?, notFound?, note? }

`version` is the latest amendment, as a string. `detail` keys: `company`, `fund`, `legal_name`,
`former_name`, `acquirer`, `as_of`, and a year, round or amount as written.

## Firm rules

Verbatim, from AGENTS.md's "Real data" (CLAUDE.md imports it), amendment 1.48 and W1's protocol. They do
not bend.

- A search may carry an LP's name with their organization, title, location and topic words, to read
  public pages. It never carries a status, an amount, a note, a list name, or the fact that they are in
  this pipeline. From W1's sub-agent rules: a query carries only the name, organization, title, location
  and topic words.
- A request carries no identity of ours: no email, name or product name in any header — a User-Agent
  included (docs/19, W1 1.36). Where a service requires a contact address (SEC's fair-access policy asks
  for one in the User-Agent), use `blue.tunguska@agentmail.to` — Juan's privacy-preserving address, 24
  Sep 2026 — and nothing else; a service that wants more identity than that is asked about first. Juan's
  own address is never used in a request. From 1.48: Juan's address, name and domain never go into a
  request; the User-Agent is `research-reader blue.tunguska@agentmail.to`; a service that wants more
  identity than that (a name, an account, a phone) is asked about first, and not used until Juan says
  so.
- Government sites are read sparingly and by their own rules: SEC at most one request a second (its
  limit is ten), no bursts or loops over names, and a 403, 429 or 503 means stop and come back later (W1
  1.48). From 1.48: EDGAR full-text search only for a name the finding needs. FINRA, ProPublica and
  state registries the same: sparingly, stopping at the first 403, 429 or 503 and coming back later,
  never retrying in a burst. Parallel batches share one address, so a batch spreads its government reads
  through its run instead of starting with them.
- No sign-ins, no paid services, no contact-data brokers, nothing posted. From W1's sub-agent rules:
  read only; no sign-ins, paid services, forms or posts.
- Record **no health information** about them or their family; only a stated interest in an area, with
  its source. A death changes who decides, so it may be recorded — with two sources, the date only,
  never a cause. One source is a lead. Nothing else about anyone's health, ever.
- Everything real lives under `data/real/`, which git ignores. None of it goes into a commit, the
  changelog, a screenshot, the published build log, `issues/`, a web search or a sub-agent prompt. No
  names in the reply.

## The protocol

1. **Identity first.** Unresolved, it stops there: `ambiguous` or `not_found`, and no facts.
2. **How they invest,** one search: angel deals, funds they back as an LP, the fund they run, check
   sizes on record, co-investors; for a firm, its program for backing other funds.
3. **What they care about,** one search: neuro, brain, biotech, health, longevity, AI, deep tech, a
   stated thesis — a public statement, with its source.
4. **Capacity and timing,** for a principal: exits, liquidity, a family office, a foundation's 990-PF,
   boards, a new fund or role.
5. **Near us:** a public tie to Protocol Labs, IPFS, Filecoin, the team or the ecosystem —
   co-investments, boards, talks, past employers.
6. **Write the finding:** every fact with a URL, a short quote, a date if the page has one, and a
   confidence; the summary rests on the facts.

Sources, free first: the firm's own pages; SEC EDGAR (full-text search, Form D, Form ADV, the adviser
database — absence from it suggests an exempt single-family office); ProPublica for 990-PFs; Wikipedia
and press; podcasts and essays. Aggregators are weak on LPs; LinkedIn is by hand only. A search pays off
most by leading to a filing.

## Identity

- Search the name with the organization (or the one the work domain points to) and the role; confirm on
  two of: name and organization, role, location, a domain match, a matching public profile.
- `confirmed` needs a page independent of our record. `probable` allows facts, each doubt under
  `cautions` (W3 then wants our own records before routing through them); inside one firm the firm's
  facts hold either way — say so in `basis`. A common name that nothing disambiguates is `ambiguous`.
  `ambiguous` and `not_found` carry no facts, the firm's included: its context goes in `coverage.note`
  as prose (firm-scope facts there: open, for Juan). A fact about the wrong person is worse than none; a
  confirmed identity with no personal facts is an honest result.
- **Our record is a claim.** Its organization can be stale, a membership, a handle or past employment:
  read a bio before calling it wrong, or current. The email domain is often the better clue, and decides
  who the team is talking to. Search each organization on our record the finding doesn't explain (it may
  be the unit that commits), and the public form of a name or title that differs from ours; a difference
  is a caution, a contact to fix — what blocks a `not_found` is often ours.
- **Domains.** Fetch the bare work domain first and record where it points: a redirect is identity
  evidence (their own site; a renamed firm — search the old name first; a code repository whose README
  is an angel vehicle's only page). Check a redirect with `isBroker`, then follow it before matching.
  Try `www.` once, then `http://` once, before calling a domain dead (DNS shows whether `www.`
  resolves); for a dead domain an organization is named after, EDGAR on the full name first. A dead
  domain's organization may live under another: identity rests on that page naming the person with our
  title, `basis` naming the domain. A domain match counts only from a page read (a filing's or a local
  chamber of commerce listing's counts: record the match, never the address). A guessed domain, one that
  changed hands, a parked look-alike (its sitemap lists only `/lander`) or a placeholder site is no
  evidence and no source.
- **LinkedIn.** A handle on file matching a result's URL is evidence of the person without opening
  LinkedIn — never of the title or employer; alone it gives `probable`. Check it against the name
  (another first name can mean a merged record) and against the company's former names.
- **Namesakes.** Settle identity on the work domain first; a famous namesake's facts stay out, with a
  caution not to join them. Relatives share surnames and often first names: the SEC filer number (CIK)
  separates them, and board seats come only from the LP's own CIK (a footnote naming their fund entities
  ties it; the other is a caution for W3). Middle names make look-alikes: compare the full name in a
  filing's related-person field. A rare surname at one of our portfolio companies, with another first
  name: a caution and a question for a person, never a join. Near-duplicate names are checked locally
  before any search; near names at two firms are two people.
- **A merged record:** `probable`, listing the fields that don't fit; the name with the organization
  decides whose facts they are. When organization, title, city and handle fit one person, the email
  domain another, and the person at the handle has no tie to that domain: the handle is no evidence, and
  the record is `ambiguous` until someone fixes the contact from our own mail.
- **Limits.** A rare name-only record may reach `probable` when every result in its field is one person;
  a common name is never lifted by thematic fit (that goes in `coverage.note`, for a person); a very
  common name found on a roster rests on that independent roster page plus the handle on file. A
  generated directory lifts a `not_found` to `probable` at most (`confirmed` can come from an
  independent profile matching name, title, firm and city, with a domain match). A record that is only a
  firm's name: `probable` at most, firm facts only. A board designee is not an employee: record the
  designation (`probable` on name and organization alone). Titles seen only in search results can't lift
  past a bot shield. Outside the US, a regulator's directory or the company register comes before
  settling on `probable`.
- **Titles and moves.** The firm's announcement beats a title on file; their own dated words ("to
  January 2026", "Emeritus") beat an older filing's title, kept as a caution. A contradicted title, an
  absence from a team page or a Form D's managers, a summary's "previously" or "former", a registration
  just ended: a caution or a question, never a departure; a documented move (an employer's 8-K) is
  recorded. The name must be in the article body, not only a headline, before a fact changes someone's
  employer or role. A team page saying the LP "currently leads" a company whose own site names someone
  else: `low`, with a caution (its filings settle it; a script-drawn registry is for a person). A title
  on file that looks wrong gets one query, the name with that title — as does every `probable` identity,
  and a confirmed one whose newest source is over a year old; it yields a caution for the contact. A
  lagging roster: both employers, dated, which is current left to a person. "Welcome" is an event unless
  the text says "joins". A self-published dated claim one search can't corroborate, or a title on our
  record only a LinkedIn heading explains, stays a caution.
- **Summaries echo the query:** the name with the organization on file counts only when a page names
  both.
- **Staff** show on event and LP-council rosters, in signature blocks, the adviser database and
  BrokerCheck; one bio found gives the address pattern of the rest. For founders, an accelerator's
  company page is a cheap identity check; an organization on file that may be a handle is checked
  against it and their own site before `not_found`.

## Reading pages

- **The firm's own site first,** from the work domain: the homepage, then the team, people, about or
  leadership page it links to (guessed paths often 404). It settles identity and the current title, and
  gives thesis, portfolio, size and check. Free-mail domain or none: the filings, then Wikipedia. The
  LP's other organizations (a company they founded, a board's release, a policy institute's staff page)
  give the best dated bios when the firm's site and the filings don't.
- **The reader:** ask for the exact sentence, never a summary — its first answer overstates relations,
  amounts and acquirers; verbatim before an amount, an acquirer or an angle; raw field values from a
  filing; a paper's raw author block with its superscript markers. Tell it to leave out religion,
  health, politics, addresses, emails and phone numbers, and to give the city only.
- **A search summary is a lead, not a fact,** its negatives too. A stale result URL: try the firm's site
  or another result.
- **Script-drawn pages and logo walls:** the page's own HTML decides — static text, image file names,
  link targets — over the reader (a bio's text is there when the reader returns only the roster). Ask
  for page titles (one can settle identity) and the homepage's link list (the real portfolio pages; the
  check against our portfolio's names). Before calling a site script-drawn, check its sitemap and one
  feed: it may be a parked domain (mail may not reach the LP: a caution for the contact) or a bot shield
  — a site that answers every path with its name.
- **Ways in that read only what a site publishes** (reading the site, not searching the web):
  `robots.txt`, the sitemap index, the team sitemap — three reads to a staff bio (a press sitemap's
  "appoints-…" addresses date appointments); a WordPress content API (`/wp-json/wp/v2/pages?slug=…`, or
  `/wp-json/wp/v2/types` then the type's search — it has an entry's title when the page shows
  placeholder text); feeds (a Medium publication's serves posts its pages refuse); the host a site's
  certificate names; a German firm's Impressum (its managing directors); a homepage's schema.org founder
  entries and job titles; a company's own PDF of its press coverage; a wire copy or the firm's own post
  of a refused article; a foundation's code-hosting organization page. Read the pages you need before
  crawling a sitemap. Stop after two guessed subdomains on an institution's domain.
- **Lists:** a "not listed" covers only what the reader saw — ask for the last entries it saw, and put
  the range covered under `cautions`. "Load More" continues on a page the HTML links: follow it before
  calling a list complete. A logo wall is recorded as its links' domains, as written, never names
  guessed from logos.
- **Refusals:** a host that refuses the reader (Medium, Crunchbase, some foundation sites): another
  result. A `402`, or a pay-per-crawl redirect (TollBit), is a paywall: leave it. A script-drawn page
  that reads empty: one retry elsewhere. A browser checkpoint is never bypassed — unread, "for a
  person", never a negative, like a 429. A 403, 429 or 503 means stop and come back later; a read still
  refused is owed to a person, not forced. When a firm's site fails, stand-ins: a trade association's
  staff page, Form D filings, ProPublica. The web archive can't be read from here.
- **Files:** Form ADVs and an institution's own PDFs can be read — the fetch tool keeps a copy in the
  session's storage, never the repository; a PDF returned as binary is turned to text from that copy,
  locally; an oversized filing is saved to the scratchpad and read there, dropping rows that lost their
  alignment. A policy's asset table is read column by column, at `medium`.
- **False friends:** a blog's search box may list its newest posts whatever the query (a dated "what
  they say now", `low`). Wikipedia on an acquired startup often redirects to the acquirer and drops the
  founders (the accelerator page keeps them); its title lookup shows at once when there is no article.
  Directory and investor-profile sites are generated: `database`, `low`, a lead for a person; a quote
  there isn't the person's, and a round's lead named by a list site but not the company's release is no
  fact. A member page of an affinity group that turns up for a name is not opened.
- **The line on search:** a general search engine read as a page (Google, Bing, DuckDuckGo, Brave and
  the like) would get around the budget, so it is never read. A primary source's own lookup — EDGAR's,
  the adviser database's, ProPublica's, Wikipedia's, a firm's site's — is reading that source, on the
  same query rules.

## Filings and registers

They reach principals, GPs and people named in filings; staff poorly. Read SEC through the fetch tool
(data.sec.gov's JSON, EDGAR's pages); a script that must fetch sends a generic User-Agent, or the
contact one above where a service requires it.

- **EDGAR full-text search**, JSON: `https://efts.sec.gov/LATEST/search-index?q="<name>"&forms=D` (Form
  D: officers, directors, promoters, amount raised); `forms=DEF 14A` (proxy bios); `forms=SC 13G`
  (stakes). A filing: `https://www.sec.gov/Archives/edgar/data/<cik>/<adsh, no dashes>/` (its listing
  can load when the documents don't); a filer's list: `data.sec.gov/submissions/CIK##########.json`.
- **The adviser database:** `api.adviserinfo.sec.gov/search/firm?query=…` — an adviser's size, or its
  absence (likely an exempt single-family office); by CRD number, JSON (a registration date when an ADV
  copy is corrupt); the individual search — a person's branch city and start date, and "other names",
  tying a nickname to the legal name (record employer and city, never a former surname). A firm's former
  names explain a registration older than its brand. Empty can mean another regulator: a commodity pool
  operator is with the CFTC and NFA; an "802-" number is an exempt reporting adviser, size not given.
- **FINRA BrokerCheck's JSON:** a staff member's name, firm, city and dates; when it fails, for a
  person.
- **ProPublica:** `projects.propublica.org/nonprofits/api/v2/search.json?q=…`, then
  `organizations/<ein>.json` (assets, grants). Officers are on its organization pages, not in the API,
  which trails them by a year: cite the year read. A new nonprofit's IRS master-file figures are
  labelled master-file. Check total assets before hunting staff: a fundraising foundation is not the
  endowment.
- **A national company register:** officer search on the surname alone, then the appointments, leaving
  out building-management companies (they stand in for a home address). Script-drawn registers (NFA,
  SFC, MAS): for a person.

**Queries.** Full name first, in quotes; the surname alone only when that finds nothing and the surname
is rare (a common word or a street name brings in restaurants and property records). Then the firm's
name, for its fund series and filed names — a GP's exact legal name in quotes, never its acronym. A
nickname needs its formal name first (a foundation's care-of line in the nonprofit database can give
it). Split a one-word family-office domain into its filed name; try a firm's spellings from its deal
documents; name and firm as two phrases can settle a staff identity. OR queries and apostrophes cause
server errors: drop the quotes (surname plus firm) rather than retry; one phrase with a `ciks=` filter
works, and reaches a company's proxy fastest; names with "&" are missed: use company search. Limited to
two years, a full-name search finds other companies' proxies where the LP is a director — the freshest
dated bio. Filter a hit list of fund vote records to 6-K and 8-K first; read a vote record from the
smallest filer.

**Every hit is checked.** Full-text search matches words, not names: open the document before a hit
counts, trust its own fields over the index's, and take the company from the opened filing, never a
list. Check the first name (a legal name counts when the firm ties it to the person) and a tie to the
organization: without one, a same-name record is a lead under `cautions`; full name plus organization
returning nothing is a clean negative. A filing joins an LP only through a named officer; a name beside
a vehicle stays a lead until a footnote ties them; a Form D naming no sponsor stays a lead when it
matches an affiliate's fund of funds, however well the names fit. A role on a name match alone stays
`medium` unless the filing names the firm. A hit list dates a filing (`medium`); an amount needs the
filing opened.

**Which filing.** Short over long: the reader cuts an S-1, S-4 or 10-K before management, while an 8-K
press-release exhibit, a Form 425, a proxy or a blank-check company's final prospectus (424B4) gives
bio, figure and title in a page. A long filing cut off is named, with its section, "for a person". A
director: the appointment 8-K (Item 5.02) and their own latest Form 4 (a seat's end, the direct
holding); their own Forms 3 and 4 beat a garbled proxy line. When a site blocks the reader: a Form 3
dates a seat's start, the latest Form 4 gives a dated sale and the shares still held, and a Form 4
footnote ("X is the managing member of Y's general partner") ties a manager to the LP and opens the
firm's 13F.

**Fund managers: EDGAR first** — the order for one LP; across a batch, government reads are still spread
through the run. The firm's newest Form D gives the fund series and the raise (offering, amount sold,
investors, date of first sale), often before its site; compare its named managers with the LP (one
missing is a question). A portfolio company's Form D can show a board seat. A Form D gives every related
person the company's city: not where the person is. An adviser can file under its GP entity's name: when
the adviser search finds nothing, search the fund's or GP's legal name for the Form ADV. A brand's site
may name nobody while filings use the legal name ("X, Inc. (dba Brand)"; a co-officer on an accelerator
page ties them); a GP's new funds may carry a brand its site never uses — record the raise at `medium`
with the tie spelled out (full name, city, scale), and let the Form ADV's owners (Schedule A) settle it,
"for a person" only when the ADV can't be read. A coded syndicate series ("AB-1234 Fund I") is not a
sector, and a lead's role resting on its name alone stays `medium`. Two filings disagreeing on a board
seat: the issuer's CIK may show a later name (a SPAC after its merger) — record the seat as former, the
new name in `detail`. A manager-selection platform files one Form D per client feeder, which company
search maps: each fund it backs is a firm-level `fund_lp` fact with the feeder's amount and investor
count; a fund family read from initials stays `medium`.

**Staff in filings.** 13D, 13G and 13F signature blocks name staff firm sites leave out; they prove the
person still works there, not their title: record the signing role, dated, keep our title "per our
record", with the two-year caution. A 13G's reporting persons can name the principal (a founder's
trust). An "Attn:" line in a deal exhibit gives the employer and a date, never the address. A resale
prospectus's selling-stockholder footnote names who runs a small adviser: dated, `medium`, two-year
caution.

**Form ADV** (Item 5, Schedules A and D) answers the fund gate, sets a band and dates titles; a
registered family office's ADV is a standing read (regulatory assets, each private fund's type and gross
value, minimums, executive officers). Parse it locally by fund name; trust only written labels
(checkboxes don't survive extraction). No private funds reported for clients that are all pooled
vehicles: a question, not a fact.

**Other documents.** An institution's own financial statements answer the fund gate: an insurer's annual
report lists its LP interests by kind, with unfunded commitments. A foundation's 990-PF splits its
investment office: record who manages private investments. A foundation's 13D on a fund's share class is
a documented anchor commitment. A deal press release's "About" paragraph is a quiet family office's own
dated words on its mandate.

**Dated and numbered.** A role from a filing carries `detail.as_of`; an old proxy's board seat is
`medium`; a caution when the newest source is over two years old. The company's own name goes in
`detail.company`, the filed name in `detail.legal_name`. File, CRD and SEC numbers stay out of prose
(they read as phone numbers): in `detail`, or left out.

## Facts

- **One fact, one page — every part of it on that page, said of that subject there:** each list item,
  sector, role word, count, relation and `detail` field ("early-stage fintech" said of their fund is not
  their angel deals' focus). What a second page adds is its own fact with its own source, or left out.
  On a page about several people, quote only the section under the LP's own name.
- **The page's own words** for events, relations and descriptions: "offered", not "joined"; "joined
  forces", not "acquired"; a filing's relation in the filing's words; a company in its listing's or own
  site's words, or just "in the portfolio" — never a sector no page gives. A fund's name is not its
  mandate. A stronger word that is probably right goes under `cautions` as "likely", the fact keeping
  the page's. Every descriptive clause (a line of business, a city, a word implying an event) comes from
  a page read; a signal resting on anything else is marked "likely".
- **A fact cites a page that was read.** A claim seen only in a search summary, a sign-in page's snippet
  or a refused page goes under `cautions` or "for a person", never `facts`.
- **A key signal** — neuro or health affinity, LP or fund commitments, capacity, a timing signal — is
  read on its page and quoted before it is `medium` or `high`.
- **Quotes** are short verbatim fragments (25 words or fewer) of the exact sentence. Re-read them
  mechanically before finishing: a generic User-Agent, a normalised substring match against the page's
  own text, SEC filings skipped (a standing script for it is still to be written). **Dates** go in
  `source.published` or `detail`, not the fact's words; a page whose only date is an update stamp years
  after the event leaves the fact undated; a LinkedIn post ID or an X status ID dates a signal without
  opening the site (`low`).
- **Scope** every fact and connection: the person's, or the firm's. A firm's thesis or portfolio is what
  the firm does, not what the person cares about.
- **Name the entity.** On every `investment`, `board`, `role`, `prior_role`, `affiliation`, `exit`,
  `fund_lp` and `fund_gp` fact, `detail.company` or `detail.fund` holds a name the page states, in full
  as its own site writes it — never a short form or acronym (W3 drops names of three letters or fewer,
  and a short form gives one firm two keys) — the organization's own name, not a program or a cohort. A
  fund's filed name comes from its own filing, never by analogy with a sister fund's; with no unique
  name ("Venture Fund III"), record `investor_type` with no fund key. Former names in
  `detail.former_name`, acquirers in `detail.acquirer`; several names in one key joined with "; " (a
  comma or an "and" belongs to a name). W3 joins LPs on these, never on a one-word name in a sentence.
- **One relation per fact.** A firm's portfolio is `investment` facts, `scope: "firm"`; its backers a
  fact of their own; an adviser's employer is not the firm's. Each fund a firm backs is its own
  `fund_lp` fact, `scope: "firm"` (ask a portfolio page for PL's documented backers too); a fund of
  funds' backed managers come from their text, not logo labels.
- **A list's entries word for word** before a sector or a signal; what can't be quoted isn't recorded.
- **Exclusions and mandates.** Ask a firm's page what it excludes, not only its thesis. A quoted
  exclusion of funds or venture ("does not invest in venture capital funds") or a mandate the firm
  states itself ("we don't do venture"; an allocator's program page) is a firm-scope `statement`,
  `high`, plus a caution: W4 and W5 read it as the fund gate answered no, and triage stops spending
  research on a fund ask there. "Medical devices" among a firm's exclusions is a neurotech gate: the
  firm's statement, which W4 reads as its answer on fit. A stated scope ("invests in the Midwest") is
  recorded as said, never paraphrased into an exclusion. A claim only an LP database's summary makes is
  a question for a person, never a gate.
- **A competing position in our field** (an employer's stake in a brain-implant company) is an affinity
  signal and a conflict gate: flag both, for W3 and W4.
- **A small fund's "welcome our new LP" post** is evidence of a commitment; a misspelled name needs a
  second identifying detail, or it stays out.

## Capacity

`profile.capacity` is the likely commitment to one fund, as a band, labelled an estimate, with its
basis:

1. **Their own money** wins whenever there is some: a check they wrote or a commitment on file (a firm's
   own published average check; an institution's LP interests, with unfunded commitments, in its
   financial statements); a net worth with a source (a dated real-time net-worth page); their own
   holdings in a filing (Form 4 shares still held, times the price: labelled an estimate).
2. **By size,** when that is all there is: an office's size — a family office's assets (a Form ADV's
   regulatory assets, a case study's portfolio size, a 13F's holdings, which are a floor), a
   foundation's or endowment's (a 990), a wealth manager's or adviser's assets under management, a fund
   of funds' size — or a person's net worth sets the band read off `config.capacity.bySize`, never
   picked by feel. A sourced net worth is both — their own money, turned into a band by the table's
   individual row. The basis begins "By size:" and names the kind and the size with its source ("By size: a
   family office with $800M in assets, per its 2025 filing"). Every step of the table is a GUESS.
3. **A floor from angel checks:** five or more personal angel investments on record, sizes unknown, give
   `$100K+ (floor)` — at least that, the top not known — with a basis that begins "Floor:" and counts
   them ("Floor: 12 angel checks on record, sizes unknown"). Fewer than five, or a fund's deals, set
   nothing. Five is a GUESS at "many".

Otherwise `unknown`, with its reason. A title, a career or a self-description is not evidence; nor is
other people's money — a company's raise, round, valuation or sale price, a vehicle's raise, a fund's
size (a fund of funds' own size goes by the table), a project's value. For a fund partner only the
direct holding counts (a proxy's ownership table and a Form 4's "indirect, by [fund]" lines are mostly
the fund's). A check in another asset class is a fact, never a band (a private-equity check must not
become a venture ask; a 13D purchase cost, a credit fund's size, an old loan vehicle's check). A 13F
cover page's total is in thousands: divide one holding's value by its share count before a band rests on
it. Write the LP's own money and a company's in separate clauses.

## Timing signals

A liquidity event, an exit, a new fund, a family office hiring for venture, a podcast saying what they
think now. A timing signal needs dated words ("IPO 2026", "acquired", "joins", "new fund"), read on the
page — a summary goes wrong here most — and is dated. A dated source (the firm's post, a release, a
podcast page) settles what an undated bio can't. A GP raising a fund of their own is a timing signal and
a caution: record the offering, the amount sold and the amount still open, dated. "Raising" needs a
filing with money unsold and no later word that it closed: search for close news and read the filer's
submissions — a filer silent since its last amendment is a question, not a live raise.

## Near us

**Reads first, with no query sent.** Once per batch: pl.xyz's sitemap (addresses, not text) and PL
Neuro's allies page (logos search can't match), matched locally against every name and firm; W2n's list
of the PL directory (os.pl.xyz), matched by the public name form W1 found and by surname, then the entry
read by ID — never a name in a request to the directory. Per firm: its sitemap's addresses searched for
"filecoin", "ipfs", "protocol-labs" and our portfolio's names; its portfolio page asked for our
portfolio's names and PL's documented backers. Check the LP's own organization against our portfolio
list: a founder of one of our portfolio companies is a reference and a connector first. Colleagues share
their firm's check.

**Then search, only on what the reads leave open.** The near-us query is the exact name in quotes,
alone, one name per query, in its public spelling (the handle on file or the confirming page gives it),
on the allow-list alone — the tool refuses one with a block-list, which every other search carries:
protocol.ai and pl.xyz (where it now redirects), with their subdomains, filecoin.io, ipfs.tech,
plneuro.xyz, juanbenetpodcast.com. Never ipfs.io: its gateway serves a copy of Wikipedia that matches
any notable name. Our own names may be searched when we are what's being researched (Juan, 25 Sep:
"you can request my name and search for it. i meant dont use my name on other requests when you're not
explicitly searching for me"); they never ride along on a request about someone else. No ORed query — not a name with a firm, not a firm with our portfolio's names:
a firm with one or two names, or a topic word; one plain topic query on a firm with a known tie is worth
it. Search the firm's own blog for Protocol Labs or Filecoin: its post on an investment names who led
it. For staff with no investing footprint, funding news comes first.

**Funding news names backers** where name searches find nothing: "<company> raises", "<company>
investors"; our portfolio companies' rounds, for the firm (a release naming Protocol Labs beside the
LP's firm is a co-investment); the LP's firm with each of our portfolio companies that raised in the
last year, for neuro relevance. It is the near-us check and the fact check at once.

**Where ties are documented:** filecoin.io's blog and the Filecoin Foundation's newsletter more than
PL's own pages; PL's research subdomain for academic LPs (grants, workshop programmes); the PL network
site, research site and Filecoin blog, read when a tie appears. The Filecoin Foundation's pages count as
the ecosystem, tier C at most; its site rate-limits parallel readers (the text is often on filecoin.io
too), and a 429 there is retried late, never recorded as a negative.

**Every result is checked.** The allow-list is not strict, and a retry can drop it: check each result's
host, and its text (a result on the list matched another person's first name). A tie is read on its page
and checked to be about the named entity — not a similarly named firm, a portfolio company, a job board
beside it. A PL directory page matching on other members' bios, or turning up for an unrelated team, is
no tie; settle it by ID. Traps go under `cautions`, so W3 doesn't join them: a sector label spelled like
one of our companies, an unrelated company sharing a word with ours. A clean negative goes under
`notFound`.

**A lead placing an LP at one of our portfolio companies,** seen only where facts may not come from (a
LinkedIn heading; a company site naming no staff), is a check routed to that company — a person asks it
— not only a tier C clue.

**Tiers** (`connections`): B, a documented working relationship — employed, an investor of record, a
board seat. Speaking at a PL-run event is C; attending, D. A shared affiliation is C and a co-attendance
D: clues that need a person before they route. A firm's tie (its check in Protocol Labs) is C at most
for the person. A needs our own record of an interaction, which W1 never has.

## What never goes in

- **Brokers** — contact-data brokers, people-search sites, LP-contact databases whatever they call
  themselves, investor lists that sell contact details, property-records sites, D&B's directory — are
  never a source, anywhere in a finding: `BLOCKED_DOMAINS` in `lib/enrich/schema.ts`, matched whole by
  `isBroker`, hyphens ignored. Check any redirect with `isBroker` before following it. A fact that
  rested on one alone is removed, listed in `researched.corrected`, and the identity re-decided without
  it.
- **No email address, phone number or street address** anywhere in a finding. Ask the reader for the
  city only; describe a building known by its address as what it is; read a staff page showing contact
  details for the role only; take nothing from a filing's address block.
- **Nothing in a special category, ever** — no religious, political, ethnic or union affiliation, no
  sexual orientation, even when a bio lists it. A civic or political organization on file is described
  only as its own site does, and tied to the person only on a page naming them. A church foundation
  investing as an institution is read as the institution it is. Apply this while reading each bio: the
  checker sees only words that reach a file.
- **No health information** (the firm rules), and no LinkedIn fetches.

## Coverage, method and budget

- `researched.method`: `"search"` when the protocol ran as written; `"pages"` when no search ran, or too
  few to follow it. A pages-only `not_found` means "not named in what could be read", never "no public
  footprint": the LP stays owed a pass with search.
- `coverage.notFound` names each gap: "for a person: …" for what the tools can't reach (LinkedIn,
  paywalled press, a script-drawn register, a refused or checkpointed page, a long filing's section, a
  Form ADV that can't be read); "for the search pass: …" for what a pages-only run leaves (the near-us
  check on PL's sites, funding news naming backers, podcasts and press — "all of it" when pages reach
  nothing); and each clean negative.
- **Staff with no public footprint** stop after three searches (three reads, pages only): `not_found` or
  `probable`, and "for a person: LinkedIn".
- **Budget, with search:** about four searches and two reads that worked per LP, a few minutes, plus a
  read per key signal that needs its source. Count the queries the tool ran, not the calls: an empty
  result makes it run its own follow-ups, and a negative near-us check costs about 1.9. Stop early when
  the picture is clear; go one search further when a strong signal needs its source. **Pages only:**
  about six reads that worked. A failed read doesn't count: one or two retries on another result.

## Running W1 as a sub-agent

The `lp-researcher` agent. A local sub-agent may read a research batch under `data/real/enrich/` and
write its findings back there; its prompt still carries no real data, and it never runs remotely. The
launch names only the batch.

1. Read, in full: this file; `lib/enrich/schema.ts`; AGENTS.md's "Real data"; three finished findings in
   `data/real/enrich/raw/`, for shape and tone.
2. For each line of the batch, research with WebSearch and WebFetch and write `raw/<key>.json`, with
   `researched: { at: <now>, by: "claude (sub-agent)", workflow: "W1", version: "1.49", method }` and
   `scope: "firm"` on what is the firm's. Write only inside `data/real/enrich/raw/`; no git.
3. Run the check and fix what it reports in your files. Reply with counts (researched; identity
   outcomes; facts; neuro signals by scope; Protocol Labs and crypto ties), the checker's summary line,
   and three to six learnings about the protocol. No names in the reply.

**Pages only (W1d).** A launch that says "pages only": no WebSearch call at all, not one — the session's
budget is shared and spent — and `method: "pages"` on every finding. The rest of the rules stand.

**The search pass.** Every pages-only finding is owed one; the bands the checker lists without evidence
go into its batches, and the rest get a sweep of their own. This cuts the batches — whole firms,
Discussing and Selected first, then the research-first lane:

    DATA_PROFILE=real npx tsx scripts/enrich-batch.ts w1 <prefix> 15 --search

Start from the finding on file and its "for the search pass" items: the reads, then the near-us search
on what they leave open, then funding news naming backers, then, for a `not_found`, the name with the
organization. Re-read the main source of every fact kept and cut it to its page's words; apply every
rule while rewriting (a band without evidence goes to `unknown` with its reason; an unconfirmed
"raising" becomes a question); date what the pages pass couldn't see. Rewrite with `method: "search"`
and the current version. About four searches per LP: a session's 200 cover some fifty. Raising
`CLAUDE_CODE_MAX_WEB_SEARCHES_PER_SESSION` is the user's decision, never an agent's. Afterwards the
checker, W3, W9, W11 and the import run as always, and strategies older than their finding go back in
the W5 queue.

## The check

    DATA_PROFILE=real npx tsx scripts/enrich-check.ts

Fix what it reports in your files. Beyond the schema, it refuses facts on an unresolved identity; a fact
without a source URL or confidence, or from a broker; a quote over 40 words; an email, phone number or
street address in any text; a broker among the identity's links or signals; a connection at tier A, or a
firm's tie at B. It also lists: a religious or political term, for a person to review (1.16); a band
whose basis names no evidence of the LP's own money, read phrase by phrase with other people's money and
denials set aside, for the search pass or a sweep (1.18); a "By size" or "Floor" band that isn't what
its rule gives, to fix (1.49); names within two letters of another record's, a possible duplicate for a
person (1.43). It prints counts and short keys, never names.
