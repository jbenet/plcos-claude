# Report 4 — Selecting and Sourcing Anchors and Family Offices

**How to build the universe, enrich it, and rank it — calibrated to PLC Neurotech's ~$30M-to-first-close and the SPV programme**

*Prepared 19 September 2026. Sourced inline; single-source, vendor-published, and unverified figures are flagged. The securities-law material is general information, not legal advice — confirm with fund counsel before building any outreach programme on it.*

---

## 0. The argument in one page

1. **Read the 506(b) constraint first, because it determines what this whole system is allowed to be.** If PLC Neurotech is raising under Rule 506(b) — the normal choice for emerging managers — you may not engage in general solicitation, and outreach must run through pre-existing substantive relationships or close referral networks. That does not stop you from building a 2,000-name universe with enrichment and scoring. It means **the system's output is a ranked list of people to get warmly introduced to, never a list to email.** Build the machine accordingly. (§6)

2. **Most of the highest-value data is free and structured.** SEC EDGAR full-text search, Form ADV/IAPD, Form D, Form 4 insider sales, and IRS Form 990-PF collectively tell you who exists, who controls what, who is legally obliged to deploy, and who just got liquid. The paid databases (Preqin, PitchBook, FINTRX, Dakota) are better at *coverage breadth* and worse at *timing signal*. Start with the free layer.

3. **The scoring model that works is borrowed from nonprofit prospect research, not from B2B sales: capacity × affinity × propensity.** Capacity and affinity are near-static; propensity decays fast and needs continuous re-scoring. Most fundraising CRMs conflate all three into one "priority" field, which is why they go stale.

4. **The single highest-probability new-LP category is a founder who just had a liquidity event.** Fresh liquid capital, empathy for venture risk, often no gatekeeper layer yet, and actively seeking allocation advice. The sourcing signal is free: lockup-expiry calendars, M&A closes, Form 4 insider sales. For a neurotech fund with a crypto-native network, this is an unusually rich and underexploited seam.

5. **For your EOY timeline, the constraint is not list size — it's decision speed.** With roughly 14 weeks to a $30M close, the only prospects that matter are ones whose decision architecture can complete in that window: principal-decided single-family offices, UHNW individuals, existing LPs re-upping or upsizing, and your Fund I investors in the Crypto/Rails vehicle. Institutional processes started now close in Q2 2027. Rank by *time-to-decision* as ruthlessly as by fit, and run the slow prospects as a separate, parallel, 2027-targeted pipeline.

---

## 1. Where the universe data actually lives

### 1.1 The free structured layer — start here

This tier is under-used by most managers and is the highest signal-to-cost ratio available.

**SEC EDGAR full-text search** ([efts.sec.gov](https://www.sec.gov/edgar/search/), with a documented API and an FAQ at [efts-faq](https://www.sec.gov/edgar/search/efts-faq.html)). Free-text search across all EDGAR filings for a family office's or principal's name surfaces ADV, Form D, 13D/G, and prospectus mentions in one pass. This is the highest-leverage free discovery tool in existence for this problem and should be a standing automated query against every name in your universe.

**Form ADV / IAPD** ([adviserinfo.sec.gov](https://adviserinfo.sec.gov/)). Registered investment advisers and exempt reporting advisers disclose regulatory AUM and client types. Many multi-family offices and some single-family offices that structure as an RIA appear here with a real, disclosed dollar figure. Critically, **absence from IAPD is itself diagnostic**: most true single-family offices rely on the Investment Advisers Act family-office exemption and do not file, so a name with strong wealth signals and no ADV is likely an exempt SFO — often the faster-moving, principal-controlled prospect you actually want.

**Form D.** Filed within 15 days of first sale in a Reg D offering. Its direct value for finding LPs is limited — it rarely names investors. Its indirect value is high: **a Form D filed by a family office's own SPV or co-investment vehicle is a live deployment signal.** Set alerts.

**Form 4 insider sales, S-1 lockup calendars, and M&A close announcements.** These are the liquidity-event detector described in §3. Free, structured, and time-stamped.

**IRS Form 990-PF.** The single best free disclosure for foundation-affiliated family wealth. It lists trustees and officers (your decision-makers), investment asset categories, grant recipients (a direct affinity signal), and the mandatory ~5% qualifying-distribution calculation under IRC §4942 ([NCFP explainer](https://www.ncfp.org/resources-tools/990-pf-nutshell-what-you-need-know); [Council on Foundations payout calculator](https://cof.org/content/calculating-five-percent-payout)). Indexed and searchable via ProPublica's Nonprofit Explorer, Candid, and GrantSmart.

**13F and Schedule 13D/G.** Public-equity holdings for family offices running a sizable public book — useful for AUM triangulation and for inferring investment philosophy, useless for private allocation directly.

**Form PF is not public.** Dead end.

**International equivalents.** UK Companies House (free API) and the Charity Commission register serve a similar dual function, though UK entities disclose far less individual-level financial detail than a US 990-PF.

### 1.2 The paid database layer

| Source | Strength | Weakness | Indicative price |
|---|---|---|---|
| **Preqin** (BlackRock-owned since 2025) | Deepest historical LP/fund-performance archive (~20 yrs), best benchmarking | Thin family-office coverage (~4,600–6,500 records), slow refresh (60–90+ days), no real API — CSV export | ~$25K–$51K/yr *(vendor-comparison sourced, unverified)* |
| **PitchBook** | Best company/deal/cap-table data | Family-office data shallow, similar refresh lag, no CRM/API workflow tooling | Quote-based |
| **FINTRX** | Purpose-built for RIA/family-office prospecting; ~4,800 global FOs, strong US depth down to ~$50M AUM; Chrome extension; **explicit API data feed** ([fintrx.com/api-feed](https://www.fintrx.com/api-feed)) | Weak/stale outside the US (Europe contacts reportedly 6–12 months stale) | ~$40K/yr for 5 seats *(unverified)* |
| **Dakota Marketplace** | Broader internationally (~7,200 FOs, better EU/APAC/Middle East), 45-day refresh, native CRM sync | "Reactive" mandate alerts, weaker non-US deliverability | ~$35K/yr *(unverified)* |
| **Altss** | Claims largest dataset (9,000+ FOs), sub-30-day refresh, predictive mandate alerts, event intelligence across 200+ conferences; published pricing | Newer entrant; superiority claims are the vendor's own | $12K–$35K/yr tiers *(vendor-published)* |
| **Highworth Research / The Family Office List** | Specializes narrowly in **single**-family offices with claimed full US coverage — valuable precisely because it filters out the MFOs and RIAs that dilute other databases | Narrow by design | Quote-based |
| **Campden Wealth** (North America Family Office Report) | Aggregate allocation-trend survey data | Market-level narrative only — does not name prospects | Report purchase |
| **Cerulli** | Research/benchmarking reports | Not a prospect database | Report purchase |
| **Crunchbase / Dealroom / Tracxn** | Finding which family offices and angels have **publicly** backed startups, especially deep-tech peers | Populated from press releases and self-reporting; weak on LP identity, AUM, or undisclosed capital | Cheap to moderate |
| **Harmonic.ai** | VC-purpose-built, fresher data, strong API | Company-signal focused rather than LP-focused; ~$25K/yr entry *(unverified)* | ~$25K/yr |

**A caution worth stating plainly:** all the comparison pricing above traces to third-party comparison sites, several of which are themselves LP-database vendors with an incentive to position competitors unfavourably. Treat every dollar figure as directional and get direct quotes.

**The practical recommendation given your timeline and budget:** one paid family-office database (FINTRX if US-weighted and you want the API; Dakota if you need EU/Middle East reach) plus the free regulatory layer plus an enrichment credit budget. Do not buy Preqin or PitchBook for LP targeting — you already have better deal data than they'll give you, and their FO coverage is the weakest part of their product.

### 1.3 The enrichment layer

This converts a name into a contactable, verified record.

- **Clay** — an orchestration layer that "waterfalls" across dozens of underlying providers (Apollo, Clearbit, Hunter, PDL) rather than owning primary data. Best value for combining sources on a per-credit basis rather than stacking subscriptions.
- **Apollo.io / ZoomInfo** — the two dominant B2B contact databases. Apollo is materially cheaper with a large self-serve dataset; ZoomInfo has better verified direct-dial accuracy for large reported companies. **Both are optimized for corporate org charts, not family offices**, which are frequently single-entity LLCs with no public employee directory. This is the real bottleneck.
- **People Data Labs** — raw identity-resolution dataset, API-first, good for bulk matching pipelines.
- **LinkedIn Sales Navigator** — still the best *manual* tool for identifying a family office's staff by title. Bulk automated extraction violates LinkedIn's User Agreement and risks account bans regardless of underlying data-protection law. Use it manually; do not scrape it.
- **Proxycurl and similar LinkedIn-derived APIs** — legally contested territory post-*hiQ*. Treat as live compliance risk, not settled tooling.
- **Hunter.io / Dropcontact** — cheap last-step email finding and verification, useful only once you have a name and domain. Family offices frequently lack a discoverable corporate domain at all, which is the actual problem these tools don't solve.

---

## 2. Identifying a real, deployable family office

### 2.1 The taxonomy that matters

- **Single-family office (SFO)** — serves one family. Usually exempt from ADV registration. Principal-controlled, fast, informal. **Your best prospect class for an EOY close.**
- **Multi-family office (MFO)** — serves multiple unrelated families, therefore usually SEC- or state-registered as an RIA (so it appears in IAPD), with investment committees and formal diligence. Slower; a Q1–Q2 2027 conversation.
- **RIA / private bank / wealth manager** — serves affluent clients across many households via model portfolios. **Generally a poor prospect for a concentrated deep-tech fund** because allocation decisions are diffused and gatekept by platform approval.

The screen: check IAPD first. Presence with disclosed AUM and a small number of high-net-worth clients in Item 5 → MFO or registered SFO. Absence, combined with a holding-company LLC name, a family-surname foundation, or 990-PF filings → exempt SFO ([Dakota explainer](https://www.dakota.com/resources/blog/single-family-office-vs.-multifamily-office-vs.-ria-whats-the-difference-and-why-it-matters)).

### 2.2 Estimating undisclosed AUM

Triangulate, and label the estimate as an estimate:
- 13F holdings, if they run a public book over $100M
- 990-PF total assets for an affiliated foundation (a foundation corpus is commonly some fraction of total family wealth, but the ratio is not standardized — directional only, **unverified**)
- Known liquidity-event size net of tax and dilution
- Forbes/Bloomberg net-worth estimates for named principals
- Staff headcount as a rough multiplier (industry rule of thumb is roughly 0.5–1.0% of AUM in SFO operating cost, implying a 15-person office sits well above $300M — **heuristic, unverified**)

### 2.3 Finding the actual decision-maker

In an SFO, authority sits with the founding principal or, once professionalized, a **CIO** who owns strategy and manager selection — distinct from a **CFO** who owns operations, accounting, and tax ([Cowen Partners](https://cowenpartners.com/cfo-vs-cio-in-a-family-office-understanding-their-distinct-roles-and-impact-on-wealth-management/)). Below the CIO, an **investment director or analyst** usually does the actual diligence and is both the correct first contact and a gatekeeper — necessary but not sufficient without principal or CIO sign-off ([Oplu](https://oplu.com/resources/investment-roles-family-offices)).

**The channels that actually work** — repeatedly cited by practitioners — are the family office's outside counsel, accountants, private bankers, wealth advisers, fund administrators, other GPs who already have the relationship, and existing LPs. Cold outreach converts poorly into family offices because these are closed, referral-gated networks ([BBN Times](https://www.bbntimes.com/financial/how-fund-managers-can-identify-the-right-family-offices-to-approach)). Which is also, conveniently, exactly what 506(b) requires of you.

**Encode role, not just name.** A prospect record with "CIO: [name]" and no note on whether the principal delegates or decides is not actionable. The field you need is *who signs*, and the second field is *who can kill it*.

---

## 3. Deployment and timing signals

Ranked by obtainability against cost — and this ordering should drive the build sequence.

### Free, high-signal

- **Job postings.** A family office hiring a CIO, a Director of Direct/Venture Investments, or a deep-tech analyst is a near-real-time indicator that it is building capacity to deploy into a new asset class. Free via LinkedIn Jobs. **This is the most underpriced signal in the entire landscape** and almost nobody systematically monitors it.
- **Liquidity events.** Form 4 insider sales, S-1 lockup-expiry calendars, M&A close announcements, de-SPAC completions. See §3.1.
- **990-PF payout data.** A payout ratio meaningfully above the ~5% floor, or a spike in program-related investments, signals active deployment. A *shortfall* against the 5% requirement — which triggers a 30% excise tax on the undistributed amount under IRC §4942 ([CPA KPA](https://www.cpakpa.com/news-articles/what-happens-if-a-private-foundation-misses-its-5-distribution-and-how-to-fix-it)) — is a forcing function that typically precedes accelerated activity the following year. **A foundation with an unmet payout obligation late in its fiscal year is a motivated buyer.**
- **Form D filings on their own vehicles.**
- **EDGAR full-text alerts on principal names.**
- **Conference speaker and attendee rosters** — Milken Global, iConnections Global Alts, Context Summits, Campden's Family Office & Investment Forum. Attendance implies active allocation intent.
- **Portfolio-company exit news** for an LP's existing venture holdings — distributions available for recycling.
- **Podcast guest appearances** by principals and CIOs. Cheap to monitor, and doubly useful because it tells you both that they are deploying and what they currently think.

### Paid, moderate cost
Deal-feed alerts tied to a named family office (Crunchbase/PitchBook/Harmonic); vendor "mandate change" alerts from Dakota/FINTRX/Altss (accuracy unverified independently); news-API monitoring.

### Effectively unobtainable
Actual recent commitment amounts to *other* GPs' funds — treated as confidential, surfacing only through voluntary GP disclosure or aggregated, unattributed database data. DAF contribution amounts at the individual account level are not disclosed by Fidelity Charitable, Schwab Charitable, or SVCF. Do not build a signal that depends on these.

### 3.1 The liquidity-event seam

This deserves emphasis because it is the highest-conversion prospect category available and your network is unusually well-positioned for it.

A founder or executive who has just had a meaningful cash-out event has: fresh, liquid, uncommitted capital; direct empathy for venture risk; frequently **no family-office infrastructure yet**, meaning no gatekeeper layer; and an active need for tax and allocation advice ([Elevate Ventures](https://elevateventures.com/resource/what-founders-need-to-know-you-were-funded-for-a-liquidity-event-start-looking/)). The window is short — within 6–18 months they will have an adviser, a policy, and a queue.

For PLC Neurotech specifically, three sub-seams:
- **Crypto liquidity.** The PL ecosystem's own graph is dense with people who have had token or equity liquidity and who have a technical disposition toward frontier science. This is a population that essentially no other neurotech fund can reach, and it is a genuine structural advantage rather than a hopeful one.
- **Health-tech and biotech exits.** People who understand clinical timelines and won't be surprised by them.
- **Mission-motivated principals.** People with a personal connection to a neurological condition. This is not a database query; it is a careful, respectful, slow research task, and it produces the highest-conviction checks in the sector. Note: this is the one category where your research notes must be handled with real care — record the *fact of stated interest in a disease area*, sourced to something they have said publicly, and nothing inferred about anyone's health.

**Build the liquidity-event monitor first.** It is free, it is fast, and it is the only signal on this list that could plausibly produce a new $2–5M check inside 14 weeks.

---

## 4. Scoring and ranking

### 4.1 Capacity × affinity × propensity

No peer-reviewed methodology exists for LP propensity scoring in venture. The best-developed transferable framework comes from nonprofit wealth screening, where the **capacity / affinity / propensity** triad is standard ([DonorSearch vs WealthEngine](https://www.donorsearch.net/donorsearch-vs-wealthengine/); [Kindsight](https://kindsight.io/resources/blog/prospect-research-tools/)):

| Dimension | Nonprofit meaning | LP translation | Volatility |
|---|---|---|---|
| **Capacity** | Financial ability to give | Estimated AUM/liquid net worth, check-size history, prior fund commitments, concentration limits | Near-static |
| **Affinity** | Connection to this cause | Thematic fit (prior deep-tech/neuro/health investments), technical background of principal, portfolio overlap, geography, stage fit, personal motivation | Slow-moving |
| **Propensity** | Behavioural likelihood to act at all | Currently deploying, recent commitments, new investment hires, conference attendance, recent liquidity event, responsiveness to prior contact | **Decays fast** |

The B2B analogue is the **fit vs intent** split used in predictive lead scoring: a static "does this look like our best LP" score, separate from a dynamic "are they showing signals right now" score ([ReachIQ](https://reachiq.ai/resources/blog/how-to-score-b2b-leads/)). The critical design point is that **these must be stored as separate fields with separate refresh cadences.** Capacity and affinity refresh annually or on event. Propensity should be recomputed at least monthly, and decay automatically if no signal refreshes it. Most CRMs collapse all three into one priority field, which is exactly why priority fields go stale and get ignored.

**MEDDIC** maps onto the qualification layer rather than the scoring layer: quantify the check and timeline (Metrics), identify whether you're talking to the actual Economic Buyer or a gatekeeper, understand the Decision Process (SFO informal vs MFO committee) and Decision Criteria, and find your internal Champion.

### 4.2 The model to actually build

**Hard gates (binary; fail any and the prospect is excluded, with the reason surfaced):**
- Check size fits between your minimum and your concentration cap
- Can take a 10+ year duration
- No disqualifying conflict
- Accredited/qualified-purchaser status plausible
- Not excluded by your Reg D posture (see §6)

**Weighted score:**

| Component | Weight | Notes |
|---|---|---|
| Capacity | 25% | Estimated deployable capital against your check band |
| Affinity | 30% | Thematic and personal fit; weight highest for neurotech because conviction dominates |
| Propensity | 25% | Time-decaying; recompute monthly |
| **Time-to-decision** | 20% | Explicitly separate — see below |

**Time-to-decision as a first-class variable** is the adaptation your situation demands. For a 14-week close, a perfect-fit institution with a 9-month process scores *lower* than a good-fit principal who can decide in three weeks. Encode decision architecture as an ordinal field — principal-decided (1–4 weeks) / CIO-decided (4–8 weeks) / small IC (8–16 weeks) / full IC with consultant (16–40 weeks) — and let the fundraise timeline parameterize the weight. When the EOY close is done, you re-weight and the slow institutions rise back up the list for the Fund II conversation.

**Two scored lists, not one.** Run "EOY close" and "2027 pipeline" as separate views over the same data with different time-weights. The same prospect appears in both with different ranks. This is the single most useful structural decision in the whole scoring design, and it prevents the common failure of a team spending September on a pension fund conversation that could never have closed in the window.

### 4.3 Explainability

Every score must decompose on hover. A ranked list nobody trusts is a ranked list nobody uses, and the fastest way to lose trust is an unexplained number. Store the component contributions, the evidence for each, and the date each was last refreshed.

---

## 5. Anchor selection specifically

### 5.1 What makes an anchor good rather than merely large

The most direct practitioner source defines three qualities: **size** (commonly 10–25% of fund target, or roughly 6–15x the average LP check), **timing** (willing to commit before social proof exists), and **signal value** (a name other LPs read as validation) ([VC Lab anchor guide](https://govclab.com/2026/08/17/anchor-lp)). For sub-$25M funds, family offices are cited as the fastest-deciding anchor category because they lack committee bureaucracy — a direct point in favour of your focus.

Beyond size, the qualities that matter:

- **Referral willingness.** Will they take reference calls and make introductions to other prospective LPs? This multiplies the raise and is worth more than an extra $2M from a silent LP.
- **Reputation among other GPs.** Does their name attract or repel co-investors? Some large family offices have a reputation for slow paperwork, aggressive terms, or difficult behaviour that other LPs know about and you may not.
- **J-curve realism.** Do they understand that funds show negative marks for 2–4 years? An anchor who panics at year-three marks is a governance problem, not a capital source.
- **Liquidity durability** across the full capital-call schedule. A family office whose wealth is concentrated in one illiquid position can default on calls.
- **Domain sympathy.** For neurotech specifically, an anchor who genuinely understands why this takes 12 years is worth a discount on check size.

### 5.2 Terms — what's reasonable and what isn't

Reasonable anchor asks: fee/carry breaks scaled to check size, an advisory-board seat, enhanced reporting, co-investment rights.

The red flags flagged by practitioners: **equity in the management company** (a permanent claim extending beyond the current fund) and **deal-veto rights** (which converts an LP into a de facto GP and creates governance and key-person entanglement) ([VC Lab](https://govclab.com/2026/08/17/anchor-lp)).

**The MFN cascade is the thing to model before you concede anything.** Side letters are the mechanism through which anchors negotiate most-favoured-nation clauses, co-invest rights, and reduced fees, and an MFN can cascade concessions to every subsequent LP ([Cooley](https://thefundlawyer.cooley.com/primer-side-letters-in-private-equity-and-venture-capital-funds/)). Before granting a term, compute its cost if every LP elects it. Given that you have already drafted a purpose-clause amendment for one LP on Fund I, you have direct experience of how a single accommodation becomes a structural feature — that instance should be in the system as a precedent record, visible to anyone negotiating the next one.

### 5.3 Concentration

An anchor above ~25% gives that LP outsized informal influence and creates re-up dependency for Fund II. But a well-chosen anchor is also the most likely lead for the next fund, making it a multi-fund bet rather than a transaction. The practical rule: know, before you sign, what happens to Fund II if this LP does not re-up — and if the answer is "nothing works," the position is too large.

### 5.4 Given where you are

You have ~$60M committed to Neurotech. That materially changes the anchor conversation: **you are no longer asking anyone to be the first check.** The remaining $30M is a momentum raise, not a cold-start raise, and the pitch changes accordingly — from "back an unproven thesis" to "join a fund that is 2/3 closed with a defined first-close date." That is a fundamentally easier ask and a much better fit for the fast-deciding family office segment.

It also means the *scarcity* framing is available and honest: a dated first close with defined remaining capacity is the only real deadline in LP fundraising, and it is the mechanism that converts soft circles. Use it, and make the date real.

---

## 6. The legal constraint that shapes the whole system

*General information, not legal advice. Confirm with fund counsel before designing any outreach programme.*

This is the most operationally consequential section in the report.

**Rule 506(b)** offerings may **not** engage in general solicitation or general advertising. No public marketing of the offering, no cold email blasts to unknown parties, no public posts pitching the fund, no handing fund decks to strangers at conferences. Outreach must occur through a **pre-existing, substantive relationship** (established before the offering began) or close referral networks. In exchange, investors may self-certify accredited status ([SEC](https://www.sec.gov/resources-small-businesses/exempt-offerings/private-placements-rule-506b); [Carta](https://carta.com/learn/private-funds/regulations/regulation-d/506b-vs-506c/)).

**Rule 506(c)** permits public solicitation and advertising, but requires **reasonable steps to verify** each investor's accredited status through documentary means — tax returns, brokerage statements, or written confirmation from a CPA, attorney, broker-dealer, or adviser. The SEC eased some verification friction in 2025 ([K&L Gates](https://www.klgates.com/Rule-506c-Unchained-The-SEC-Loosens-Requirements-for-Advertising-in-Private-Capital-Raises-3-27-2025)), but the burden remains materially heavier, and sophisticated family offices are frequently reluctant to hand financial documentation to an unfamiliar manager.

### 6.1 What this means for the tool

If PLC Neurotech is on 506(b) — which is the normal and probably correct choice — then:

- **Building a 2,000-name enriched, scored universe is fine.** Research is not solicitation.
- **Cold outreach from that list is not fine.** Every name must be converted into a warm path before contact. The system's primary output is therefore an *introduction routing problem* (Report 6), not a contact list.
- **The system must encode relationship provenance per prospect**: is there a pre-existing substantive relationship, and if so, what is the evidence and the date? This is a compliance field, not a nicety. It is the record you would need if anyone ever asked.
- **A hard gate on outreach**: no prospect can be moved to "contact" status without either a documented pre-existing relationship or a confirmed warm introduction. Make the system enforce it.
- **Content and fund marketing must be architecturally separated.** The standard practice is a two-tier approach: firm-level thesis, research, and brand content published openly, while anything identifying a specific fund, its terms, performance, or an active raise stays strictly relationship-gated behind a data room or direct email. Report 5 develops this.

A specific trap worth naming: **publishing "now raising" language or fund performance on a public site or unrestricted social post while relying on 506(b)** is a commonly cited compliance failure. Given that you are actively publishing a podcast and running public convenings, the line between thesis content and fund marketing needs to be drawn explicitly, written down, and enforced — ideally as a checklist in the publishing workflow rather than as a matter of individual judgment each time.

### 6.2 Data protection

Scraping and enriching data on identifiable individuals implicates GDPR when the person is in the EU/UK, and CCPA/CPRA for California residents. Neither bans B2B enrichment, but GDPR requires a documented lawful basis — typically legitimate interest, which requires a balancing test, a reachable privacy notice, and an easy opt-out ([Unify](https://www.unifygtm.com/explore/b2b-data-compliance-gdpr-ccpa)). Vendor claims of "GDPR-compliant data" are marketing, not a legal opinion; the burden sits with you.

One domain-specific caution: in a neurotech context, prospect research can drift toward inferring health information about individuals or their families. **Don't.** Record only what a person has publicly stated about their own interests, attribute it to the source, and never record inferred or third-party health detail. This is both a data-protection matter and simply the right way to treat people whose interest in your fund may come from the hardest thing in their life.

---

## 7. The build, sequenced against your timeline

### Weeks 1–2 — the fast layer
- **Existing-relationship census.** Before any new prospecting: every person the firm already has a substantive relationship with, across PL, Fund I Neurotech, Crypto/Rails, the podcast, and the gatherings. This list is both your highest-conversion pipeline and your 506(b) permission set. Most managers underestimate it by half.
- **Liquidity-event monitor.** Free, and the only new-prospect source that can plausibly close inside the window.
- **Re-up and upsize analysis** across existing LPs: who committed below their capacity, who has had a liquidity event since, who invested in Crypto/Rails but not Neurotech (and vice versa).

### Weeks 2–4 — the scored universe
- One paid FO database, loaded and deduplicated.
- Capacity/affinity/propensity/time-to-decision scoring implemented, with hard gates.
- Two views: EOY close, and 2027 pipeline.
- Warm-path computation against the census (Report 6).

### Weeks 4–8 — signal automation
- EDGAR full-text and Form D alerts on the universe.
- Job-posting monitor for FO investment hires.
- 990-PF payout analysis for the foundation subset.
- Conference roster ingestion.

### Ongoing
- Monthly propensity recomputation with automatic decay.
- Quarterly capacity/affinity refresh.
- Continuous relationship-provenance logging.

**What to explicitly not build before EOY:** predictive ML scoring, a custom graph database, multi-source entity resolution at scale, or anything requiring a data-engineering hire. A well-structured spreadsheet or Airtable with the right *fields* and disciplined refresh will outperform a half-built system, and the fields are the part that carries over when you build properly in 2027.

---

## 8. What this implies for the tool

**Data model additions beyond Report 3's base:**
- `relationship_provenance` — pre-existing substantive relationship: yes/no, evidence, date established. Compliance-critical.
- `decision_architecture` — ordinal, with estimated weeks to decision.
- Separate `capacity_score`, `affinity_score`, `propensity_score`, each with `last_refreshed` and `evidence[]`.
- `liquidity_event` — type, date, estimated magnitude, source.
- `payout_obligation` — for foundation entities: fiscal year end, required distribution, distributed to date, shortfall.
- `entity_type` — SFO / MFO / RIA / foundation / institution / individual, with the IAPD presence flag.
- `role` per person — signs / influences / gatekeeps / informs.

**Behaviours:**
- Hard gate blocking outreach without documented provenance or a confirmed intro.
- Automatic propensity decay with a configurable half-life.
- Dual-view ranking parameterized by the active raise's timeline.
- Explainable scores with component decomposition and evidence links.
- MFN precedent register, queryable before any term negotiation.

**Signal ingestion, in priority order:**
1. Form 4 / lockup / M&A liquidity events
2. Job postings for FO investment roles
3. EDGAR full-text on universe names
4. 990-PF payout analysis
5. Conference and podcast rosters
6. Paid deal-feed alerts

---

## Sources

- [SEC — EDGAR Full Text Search](https://www.sec.gov/edgar/search/) · [FTS FAQ](https://www.sec.gov/edgar/search/efts-faq.html)
- [SEC — IAPD Investment Adviser Public Disclosure](https://adviserinfo.sec.gov/)
- [SEC — Information About RIAs and Exempt Reporting Advisers](https://www.sec.gov/data-research/sec-markets-data/information-about-registered-investment-advisers-exempt-reporting-advisers)
- [SEC — Private Placements, Rule 506(b)](https://www.sec.gov/resources-small-businesses/exempt-offerings/private-placements-rule-506b)
- [SEC — General Solicitation, Rule 506(c)](https://www.sec.gov/resources-small-businesses/exempt-offerings/general-solicitation-rule-506c)
- [SEC — Assessing Accredited Investors under Regulation D](https://www.sec.gov/resources-small-businesses/capital-raising-building-blocks/assessing-accredited-investors-under-regulation-d)
- [Carta — Rule 506(b) vs 506(c)](https://carta.com/learn/private-funds/regulations/regulation-d/506b-vs-506c/)
- [K&L Gates — Rule 506(c) Unchained](https://www.klgates.com/Rule-506c-Unchained-The-SEC-Loosens-Requirements-for-Advertising-in-Private-Capital-Raises-3-27-2025)
- [Altum Legal — What is Form D](https://altumlegal.com/what-is-form-d-and-what-information-gets-publicly-disclosed-in-a-financing)
- [FormDs.com](https://www.formds.com/)
- [NCFP — 990-PF in a Nutshell](https://www.ncfp.org/resources-tools/990-pf-nutshell-what-you-need-know)
- [IRS — Form 990-PF Instructions](https://www.irs.gov/pub/irs-pdf/i990pf.pdf)
- [Council on Foundations — Calculating the Five Percent Payout](https://cof.org/content/calculating-five-percent-payout)
- [CPA KPA — Missing the 5% Distribution](https://www.cpakpa.com/news-articles/what-happens-if-a-private-foundation-misses-its-5-distribution-and-how-to-fix-it)
- [OpenGrants — Researching a Funder with Form 990](https://opengrants.io/encyclopedia/finding-funding/funder-research-990/)
- [FINTRX — API Data Feed](https://www.fintrx.com/api-feed) · [Family Office Data](https://www.fintrx.com/data/family-office-data)
- [Dakota — Family Office Database](https://www.dakota.com/family-office-database)
- [Dakota — SFO vs MFO vs RIA](https://www.dakota.com/resources/blog/single-family-office-vs.-multifamily-office-vs.-ria-whats-the-difference-and-why-it-matters)
- [PipelineRoad — LP Database Buyer's Guide](https://pipelineroad.com/compare/lp-database-buyers-guide)
- [Altss — Family Office Database Comparison 2026](https://altss.com/blog/best-global-family-office-databases-2025-fintrx-vs-dakota-vs-preqin-vs-pitchbook-vs-altss)
- [LPbacked — PitchBook Alternatives](https://lpbacked.com/alternatives/pitchbook-alternatives)
- [Campden Wealth — North America Family Office Report 2025](https://www.campdenwealth.com/report/north-america-family-office-report-2025)
- [WealthBriefing — Highworth SFO Database](https://www.wealthbriefing.com/html/article.php?id=194283)
- [Cerulli — US Wealth Management Research](https://www.cerulli.com/research-areas/us-wealth-management)
- [Harmonic.ai — Crunchbase Alternatives](https://harmonic.ai/blog/top-crunchbase-competitors-and-alternatives-in-2026)
- [Apollo vs ZoomInfo 2026](https://www.apollo.io/insights/apollo-vs-zoominfo) · [Cleanlist test](https://www.cleanlist.ai/blog/2026-03-07-apollo-vs-zoominfo)
- [devcommx — Waterfall Enrichment: Clay vs ZoomInfo vs Apollo](https://www.devcommx.com/blogs/waterfall-enrichment-clay-vs-zoominfo-vs-apollo)
- [BBN Times — Identifying the Right Family Offices to Approach](https://www.bbntimes.com/financial/how-fund-managers-can-identify-the-right-family-offices-to-approach)
- [Cowen Partners — CFO vs CIO in a Family Office](https://cowenpartners.com/cfo-vs-cio-in-a-family-office-understanding-their-distinct-roles-and-impact-on-wealth-management/)
- [Oplu — Investment Roles in Family Offices](https://oplu.com/resources/investment-roles-family-offices)
- [J.P. Morgan — SFO vs MFO](https://privatebank.jpmorgan.com/nam/en/who-we-serve/family-office/single-family-office-vs-multi-family-office)
- [Elevate Ventures — Founder Liquidity Events](https://elevateventures.com/resource/what-founders-need-to-know-you-were-funded-for-a-liquidity-event-start-looking/)
- [NY Venture Hub — Pre-Exit Founder Liquidity](https://www.nyventurehub.com/2026/04/06/off-the-table-pre-exit-founder-liquidity-in-venture-backed-startups/)
- [DonorSearch vs WealthEngine](https://www.donorsearch.net/donorsearch-vs-wealthengine/)
- [Kindsight — Prospect Research Tools](https://kindsight.io/resources/blog/prospect-research-tools/)
- [ReachIQ — How to Score B2B Leads](https://reachiq.ai/resources/blog/how-to-score-b2b-leads/)
- [Pedowitz Group — Lead Scoring Models](https://www.pedowitzgroup.com/what-are-the-different-types-of-lead-scoring-models)
- [Affinity — Deal Sourcing Guide](https://www.affinity.co/blog/deal-sourcing-meaning-process-strategies-tools)
- [VC Lab — Anchor LP Guide](https://govclab.com/2026/08/17/anchor-lp)
- [Cooley — Primer: Side Letters in PE and VC Funds](https://thefundlawyer.cooley.com/primer-side-letters-in-private-equity-and-venture-capital-funds/)
- [Sydecar — A Guide to Side Letters](https://sydecar.io/learn/side-letters)
- [Unify — B2B Data Compliance: GDPR, CCPA](https://www.unifygtm.com/explore/b2b-data-compliance-gdpr-ccpa)
- [BetterEnrich — GDPR and Data Enrichment](https://blog.betterenrich.com/gdpr-and-data-enrichment-what-is-legal)
