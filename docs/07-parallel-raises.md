# Report 7 — Running Parallel Raises

**Funds, SPVs, and philanthropy from one organization and one shared relationship base — tools, processes, and governance**

*Prepared 19 September 2026. Sourced inline; vendor-published and unverified figures are flagged. Securities-law, tax, and regulatory material is general information, not legal advice — confirm with fund counsel before acting.*

---

## 0. The argument in one page

Your actual situation: ~$60M committed to PLC Neurotech, ~$30M to PLC Crypto/Rails, SPV interest live, targeting ~$30M more for a Neurotech first close and 3+ SPVs closed by EOY — roughly 14 weeks. Plus PL's R&D programmes raising philanthropic capital on a separate, slower clock.

Five claims:

1. **The binding constraint is not capital availability — it is ask coordination against a shared relationship base.** Most of the people who could fund the Neurotech close could also fund an SPV, and some could fund a grant. If three different people at PL approach the same principal about three different things in one quarter, you don't get three commitments; you get one confused relationship and probably zero.

2. **The single highest-leverage governance decision is one owner per relationship, who controls the timing of every ask across every vehicle.** This is borrowed from enterprise sales named-account coverage and — worth flagging honestly — **is not a documented practice in fundraising literature.** It's an analogy you'd be applying deliberately. It is also, as far as we can tell, the only thing that actually solves the problem.

3. **SPVs are a fundraising instrument, not just a deal instrument — and the causal claim is weaker than the folklore.** GPs widely use SPVs to build relationships that convert to fund LPs later, and PitchBook confirms this is standard emerging-manager practice. But **no quantified conversion data exists.** Treat "SPVs build your LP pipeline" as a plausible heuristic, not a proven ratio, and watch for the specific risk that an SPV ask mid-fund-raise reads as cherry-picking.

4. **Sequencing rule that follows from the above: close the fund conversation with a given relationship before opening the SPV conversation, not the reverse.** An SPV offered during an active fund raise invites the question "why isn't your fund doing this deal?" — which is exactly the adverse-selection signal LPs are trained to look for.

5. **The regulatory picture shifted and most people haven't updated.** The SEC's 2023 Private Fund Adviser Rules — including the preferential-treatment disclosure requirements — were **vacated in full by the Fifth Circuit in June 2024.** There is currently no federal rule specifically mandating side-letter or preferential-treatment disclosure. General antifraud and fiduciary duty under Advisers Act §206 still apply, and institutional LPs still demand transparency contractually, so market behaviour is largely unchanged — but the compliance driver is now contractual, not regulatory.

---

## 1. SPV mechanics and economics, 2026

### 1.1 What you're actually buying

An SPV here is a single-deal vehicle — usually a Delaware LLC or LP formed to make one investment. LPs subscribe knowing the exact asset, unlike a blind-pool fund commitment ([Carta](https://carta.com/learn/private-funds/structures/spv/); [Sydecar](https://sydecar.io/learn/what-is-an-spv)).

### 1.2 Provider comparison

| Provider | Setup cost | Ongoing | Platform carry | Notes |
|---|---|---|---|---|
| **Sydecar** | ~2% of capital raised; floors/ceilings cited inconsistently across its own pages ($4,500–$14,500 on one, $2,500–$12,500 + $2,000 regulatory fee on another) | None — one-time fee covers the full 3–7 year lifecycle including K-1s | 0% | Fastest/cheapest positioning ([pricing guide](https://sydecar.io/learn/what-spvs-cost)) |
| **AngelList** | ~$10,000 all-in ($8,000 setup + $2,000 blue-sky passthrough); follow-ons ~$5,000 + $2,000 | — | 0% on GP-sourced LPs; reportedly ~5% on LPs sourced via AngelList's own network | Recommended minimum ~$80,000. *Figures via a competitor's comparison page — verify directly.* |
| **Allocations** | ~$9,950 (Standard, incl. 35 LPs); ~$19,500 (Premium); +$100/LP beyond included | ~$19,500/yr for a rolling vehicle | 0% | [Comparison page](https://www.allocations.com/insights/best-spv-platform-2026) |
| **Carta** (acquired Vauban — [note](https://carta.com/blog/carta-acquires-vauban/)) | Quote-based | Quote-based | — | No published pricing |
| **Odin** (HackCapital) | Not independently verifiable for 2026 — **unverified** | — | — | European/international focus |

**Formation timeline:** best-in-class platforms claim entity, bank account, and subscription docs within ~48 hours, with capital in escrow until a minimum threshold is met ([SPV.co](https://spv.co/blog/how-spvs-work-from-formation-to-fund-distribution)). Realistically, allow 1–2 weeks from decision to first wire once KYC on international LPs and blue-sky filings are factored in.

### 1.3 Economics

SPV management fees commonly range 1–10% and carry 10–20% ([CB Insights](https://www.cbinsights.com/research/special-purpose-vehicles-in-venture-pros-and-cons/)). But the 2-and-20 default is eroding: Sydecar's analysis of ~1,800 SPVs formed on its platform between October 2024 and October 2025 found managers increasingly customizing fee and carry **by deal stage and complexity** rather than applying a flat formula, with many charging **no management fee** to stay LP-friendly ([Sydecar](https://sydecar.io/guides/spv-fees-2025)).

A widely cited rule of thumb: **keep all-in SPV costs under ~5% of capital raised** to preserve LP economics.

**Minimum viable size.** With flat-fee components of $8–15K+, an SPV under roughly $250–500K risks fees eating an uneconomical share. The screening variable is cost as a percentage of raise, not a fixed dollar floor.

### 1.4 The investor-count rules, and the trap

Under the Investment Company Act, a **§3(c)(1)** vehicle may have up to **100 beneficial owners**; a **§3(c)(7)** vehicle up to **2,000 qualified purchasers** ([Carta](https://carta.com/learn/private-funds/regulations/3c1-3c7/)). A **qualifying venture capital fund** carve-out raises the 3(c)(1) cap from 100 to **250**, subject to an inflation-adjusted aggregate capital-contribution cap (originally $10M, adjusted by the SEC in 2024 — [SEC release](https://www.sec.gov/newsroom/press-releases/2024-102)).

**Each SPV is generally its own issuer with its own cap**, so running several alongside two funds doesn't by itself blow any vehicle's count. Two traps apply:

- **Look-through counting.** If an entity investing in your SPV is itself a pooled vehicle, the SEC can look through it and count its underlying owners against your cap — depending on how that entity was formed and whether it was formed specifically to invest in this deal.
- **Integration risk.** Closely related vehicles offered to overlapping investors in a compressed period can, in principle, be treated as a single offering ([Sydecar](https://sydecar.io/learn/3c1-vs-3c7-spv-exemptions)).

**This second one is your exact fact pattern.** A fund close plus 3+ SPVs plus a sector fund, all marketed to an overlapping LP base inside one quarter, is precisely the scenario that raises integration questions. **Get counsel to confirm the vehicles aren't integrated and that Reg D general-solicitation posture is consistent across all of them — before you open the SPV conversations, not after.** This is a two-hour conversation now versus a serious problem later.

### 1.5 The Assure lesson

Assure, then a leading SPV administrator, shut down abruptly in November 2022, leaving GPs and thousands of underlying LPs without transition support right before tax season ([Axios](https://www.axios.com/2022/11/23/assure-shutdown-fintech-startup-investing); [TechCrunch](https://techcrunch.com/2022/12/14/frustration-and-anger-after-spv-platform-assure-dumps-users-at-the-curb-ahead-of-holidays/); [VC Lab migration notes](https://govclab.com/2022/11/29/assure-migration/)).

The lesson: **SPV administration carries real counterparty risk.** Your bank accounts, cap tables, K-1 pipeline, and compliance records sit with a vendor that is itself a venture-backed startup subject to failure ([Gridline](https://gridline.co/special-purpose-vehicles-are-even-riskier-in-a-downturn/)). Practical responses: vet administrators for balance-sheet stability; keep independent copies of cap tables and banking records; and make "what happens if this platform disappears" an explicit diligence question.

### 1.6 Documented failure modes

From practitioner sources ([SPV.co](https://spv.co/blog/how-spvs-work-from-formation-to-fund-distribution)):
- Underestimating ongoing costs — state fees, tax prep, registered agent rarely stay under ~$4,000/year
- Unclear pro-rata and follow-on rights
- **LP communication breakdown** — "radio silence erodes confidence"
- Messy capital-call and side-letter ledgers creating reconciliation problems at exit
- **Spreadsheet tracking breaks down past roughly 10 LPs**

Add, less formally sourced: blue-sky filing delays across states, KYC/AML bottlenecks on international LPs, and late wires against a hard deal deadline.

---

## 2. SPVs as a fundraising instrument

### 2.1 The strategic case

The clearest articulation is Caterina Fake's argument that emerging managers should launch SPVs *before* a fund, so that "some of the SPV investors will join your fund, now that they're familiar with your investing style, your deals and your hustle," with SPV investors serving as reference calls for prospective fund LPs ([TechCrunch](https://techcrunch.com/2022/04/07/stop-trying-to-raise-a-debut-venture-fund-go-for-the-spv-instead/)).

PitchBook confirms this is now standard practice: GPs use SPVs "for some relationship-building for the next time" they fundraise, and volume has surged — Sydecar recorded **769 venture SPV deals in 2024, more than double 2022 levels.** Per HighVista Strategies, **67% of SPVs over $10M charged fees by 2023, up from 41% in 2021** ([PitchBook](https://pitchbook.com/news/articles/emerging-managers-spvs-fundraising-tough-market)) — reflecting SPVs' emergence as a revenue lifeline for managers with thin fund fee income.

### 2.2 The honest caveat

**No quantified conversion data exists** — what share of SPV co-investors become fund LPs, or what share of a fund's raise traces to prior SPV relationships. This is industry lore, not measured fact. Which is itself an argument for instrumenting it: if you run 3+ SPVs this quarter and track conversion properly, you'll know something most managers only believe.

### 2.3 The risks, which are real

- **Adverse selection signal.** When a GP offers an LP an SPV opportunity the GP declined to fund from its own vehicle, LPs are "left to wonder why they are so lucky... and whether there is some negative signaling to be aware of" ([CB Insights](https://www.cbinsights.com/research/special-purpose-vehicles-in-venture-pros-and-cons/)). **This is the risk that bites hardest during an active fund raise**, because the LP is simultaneously being asked to trust your blind-pool selection.
- **Cherry-picking perception.** Selectively offering SPV pro-rata to favoured LPs disadvantages others unless mitigated by a written allocation policy and negotiated participation rights.
- **Cannibalization.** An LP who can get bespoke, fee-negotiable exposure to your best deals via SPV has less incentive to make a blind-pool commitment. *(Reasoned inference from the same dynamics, not a directly sourced finding.)*
- **Fee/carry misalignment.** LPs bear essentially all downside while GPs earn fees regardless.

### 2.4 The sequencing rule for your situation

Given an active $30M Neurotech close running alongside 3+ SPVs to an overlapping base, the discipline is:

**Per relationship, in order:**
1. Fund conversation first, to conclusion (yes, no, or explicit "not this vehicle")
2. Only then, SPV — and framed correctly
3. Grant conversation on its own clock, separately staffed

**Framing that defuses the adverse-selection question before it's asked:** be explicit and unprompted about *why* this deal is in an SPV rather than the fund. Legitimate reasons that read well: the check exceeds the fund's concentration limit; it's a follow-on beyond fund reserves; it's outside the fund's stated mandate; the fund is already at its position in this company and this is incremental. Illegitimate-sounding reason: silence. **If you cannot state the reason in one sentence, the LP will supply their own, and it will be uncharitable.**

**Two genuine upsides to name:** SPVs give you a legitimate on-ramp for people whose minimum check is below your fund minimum, and they let existing LPs deepen exposure to specific winners. Both expand rather than fragment the base — **if positioned that way from the start.**

---

## 3. Conflicts and allocation policy

### 3.1 The regulatory state of play

In 2023 the SEC adopted **Private Fund Adviser Rules**, including a **Preferential Treatment Rule** barring certain preferential redemption or information rights via side letters unless disclosed to all investors, plus broader fee, expense, and conflict disclosure mandates.

**On 5 June 2024, the Fifth Circuit vacated the entire rule package**, holding the SEC exceeded its statutory authority under Advisers Act §§206(4) and 211(h) because private fund investors are not the "retail" customers Congress intended to protect ([Morrison Foerster](https://www.mofo.com/resources/insights/240612-fifth-circuit-vacates-sec-private-fund-adviser-rules); [Sidley](https://www.sidley.com/en/insights/newsupdates/2024/06/us-fifth-circuit-court-of-appeals-vacates-private-funds-rules-whats-next); [Mayer Brown](https://www.mayerbrown.com/en/insights/publications/2024/06/fifth-circuit-vacates-private-fund-adviser-rules)).

**The practical standard as of September 2026:** no federal rule specifically mandates preferential-treatment or side-letter disclosure. **General antifraud provisions under Advisers Act §206 and existing fiduciary-duty case law still apply** — you cannot materially misrepresent or omit conflicts. The SEC retains authority to pursue enforcement under that broader framework or attempt narrower rulemaking, so treat the landscape as **unsettled rather than resolved in your favour.**

Critically: **institutional LPs continue to demand allocation-policy and side-letter transparency contractually, regardless of federal mandate.** ILPA's Principles 3.0 push for standardized side-letter and MFN disclosure, LPAC review of material conflicts, and documented allocation policies ([ILPA](https://ilpa.org/industry-guidance/principles-best-practices/ilpa-principles/)). So market-standard behaviour is unchanged; only the compliance driver moved from regulation to contract.

### 3.2 What you need written down

Running Neurotech, Crypto/Rails, multiple SPVs, and PL Neuro's research programme creates textbook conflicts. The documents that should exist before the SPV programme scales:

**An allocation policy** covering:
- How an opportunity is assigned between Neurotech, Crypto/Rails, and an SPV — with objective criteria (mandate fit, stage, check size vs concentration limit, reserve availability), not case-by-case judgment
- Who decides, and how disagreement resolves
- How SPV participation rights are offered — pro-rata to all LPs, by tier, first-come, or discretionary — and, if discretionary, on what stated basis
- Cross-vehicle investment restrictions: a later vehicle buying from or selling to an earlier one generally requires LPAC consent, because of pricing conflicts

**A conflicts register**, disclosed to the LPAC, covering the PL relationship, PL Neuro's research output flowing into fund deal flow, and any personal positions.

**The PL Neuro question specifically.** When a PL Neuro research programme produces a spinout, who invests, on what terms, and who decides? This will be asked in institutional diligence (Report 1, §6), and it is a live self-dealing and private-benefit question if philanthropic dollars funded work that a for-profit vehicle then captures value from (Report 3, §7). **Write the policy before the first spinout, not after** — it's a far easier conversation in the abstract.

---

## 4. Team and process design

### 4.1 The honest state of the evidence

**No sourced benchmarks exist for IR headcount per dollar of AUM.** What's observable: firms increasingly create a dedicated **Head of Capital Formation / Investor Relations** role once they run more than one active vehicle — evident in real job postings and named senior hires (e.g. QED Investors in 2022, [BusinessWire](https://www.businesswire.com/news/home/20220711005638/en/QED-Investors-Hires-Courtney-Christianson-as-Head-of-Investor-Relations)).

### 4.2 The trigger to hire

Synthesized rather than sourced: the trigger is usually the point at which **(a)** more than one vehicle is being marketed concurrently, or **(b)** LP-facing administrative load — data rooms, quarterly reporting, reference-call logistics — starts competing with partner investing time.

**You are past both.** Four concurrent raises (Neurotech close, Crypto/Rails, SPVs, philanthropy) with partner-led coverage is the configuration where things start dropping silently.

**But the honest counsel for a 14-week window: do not hire now.** A new IR person takes 6–10 weeks to become net-positive, which is most of your runway, and hiring is itself a senior-time cost. The right sequencing is: **run the EOY close with existing people plus tight process, and hire in Q1 2027** with the benefit of knowing exactly what the job is. The PL Neuro lead hire already in progress is a partial answer here, since that role was scoped to help with PLC Neurotech fundraising.

### 4.3 The named-account coverage model

This is the core operational recommendation, and it should be flagged clearly: **borrowing named-account coverage from enterprise sales is an analogy being applied deliberately, not an established fundraising practice.** We found no documented use of it in fundraising literature. It is nonetheless the only structure that cleanly solves the shared-base problem.

The model ([territory design background](https://www.gradient.works/blog/sales-territory-models-inside-sales-field-enterprise)):

- **One internal owner per relationship**, not per vehicle. That owner is responsible for sequencing *all* asks — fund, SPV, philanthropy — to that relationship.
- **Vehicle leads can request an ask; only the relationship owner schedules it.** This is the rule that prevents the three-emails-in-one-quarter failure.
- **A shared queue**, visible to everyone, showing pending and recent asks per relationship.
- **Explicit handoff protocol** when ownership changes, so context travels.

The alternative — each vehicle's champion pitching independently — is what produces the failure this whole report exists to prevent.

### 4.4 What the IR function actually does day to day

LP pipeline and CRM management; materials production and version control; data-room administration; scheduling and reference-call logistics; coordination with counsel and fund admin on subscription docs; quarterly reporting; and — critically in a multi-vehicle context — **single-point-of-contact coverage enforcement.**

---

## 5. The shared relationship base

### 5.1 The problem stated precisely

One principal can be: an LP in Neurotech, an LP in Crypto/Rails, an SPV participant, a donor to PL Neuro, an advisor, and a connector to other LPs. Six relationships, one person, potentially six different people at PL wanting something.

**No sourced case study of how best-in-class multi-product managers handle this internally was found** — a real evidence gap. a16z is the visible analog (flagship plus growth plus crypto funds) but public material covers fund sizes, not LP-coordination mechanics.

### 5.2 The operating rules

Reasoned from the conflicts and adverse-selection evidence above:

1. **One owner, all asks.** Per §4.3.
2. **Present the portfolio, not the pitch.** Where a relationship could fund several things, put them all on the table in one conversation and let them choose fit, rather than fielding uncoordinated approaches. "Here's what we're doing across the platform; here's where I think you'd be most interested; here's what's time-sensitive." This respects their intelligence and converts better than sequential asks.
3. **Sequence by vehicle logic, not internal convenience.** Fund before SPV (§2.4). Philanthropy on its own clock.
4. **A quarterly ask budget per relationship.** One substantive ask per quarter, with exceptions requiring explicit decision rather than drift.
5. **Log every ask centrally** — date, vehicle, asker, outcome — so the constraint is visible rather than remembered.

### 5.3 When multiple vehicles genuinely help

The reverse case is real and worth positioning explicitly:
- **Different check sizes.** SPV minimums are far below fund minimums, opening a segment that couldn't participate otherwise.
- **Different risk appetite.** Single-company concentration vs diversified blind pool suits different people.
- **Different mandates.** Crypto/Rails and Neurotech reach genuinely different LP populations, and some people will fund one and not the other — which is fine and should be stated as fine.
- **Different instruments for the same conviction.** A foundation that cannot make an LP commitment might make a PRI or a grant (Report 3).

**Positioned right, the platform is a feature: "there is a way for you to participate that fits your constraints."** Positioned wrong, it's confusing and looks opportunistic. The difference is entirely whether one person is orchestrating it.

---

## 6. Philanthropy alongside investment

### 6.1 The legal frame

A 501(c)(3) affiliated with a for-profit fund manager must observe **private-inurement and private-benefit rules**: charitable assets and investment vehicles must be governed and transacted at arm's length, with independent trustees or officers reviewing any transaction between them, and no donor or investor receiving improper benefit from the other relationship ([Dalton & Tomich](https://daltontomich.com/legal-considerations-for-nonprofits-with-for-profit-affiliations/)).

Separately, **charitable solicitation is regulated at the state level** — most states require registration to solicit donations. This is a compliance layer entirely independent of the Reg D constraints on the investment vehicles, and the two regimes are not interchangeable. Worth flagging to counsel explicitly, because it's commonly missed.

And a foundation can make **program-related investments** under different tax and disclosure rules than ordinary venture investment ([IRS](https://www.irs.gov/charities-non-profits/private-foundations/program-related-investments)) — the bridge instrument developed in Report 3.

### 6.2 The practical separation

**Communications.** Donor solicitation materials (tax-deductible gift, no expectation of financial return) should be produced, tracked, and delivered by different personnel and different systems than investment offering materials. Conflating them risks confusing the donor about what they're receiving and can implicate securities rules if a gift ask bleeds into investment marketing.

**Sequencing.** No fixed legal rule requires one before the other. The practice to avoid is **conflating the two asks in the same meeting or document.** Run the philanthropic relationship on a distinct cadence — an annual giving cycle, say — separate from fund and SPV closing timelines.

**Operations.** Separate CRM pipelines; separate approval chains (investment committee for fund and SPV allocations, board or grants committee for philanthropic disbursements); disclosure of the affiliation and any shared personnel to both the nonprofit board and the fund LPAC.

### 6.3 The tension worth naming

Report 3 argued that the overlap — funders who can write either kind of check — is strategically valuable and should be targeted coherently. This report says keep the asks separate. **Both are true, and the resolution is the distinction between the relationship and the ask.**

**One relationship owner, who knows the full picture and sequences deliberately. Two completely separate ask processes, materials, and approval chains.** The owner's job is to know that this principal could do either and to choose which, when, and how — not to pitch both at once. That is exactly the "one relationship, many instruments" model Prime Coalition operates, and it depends entirely on the orchestration being centralized while the execution stays separate.

---

## 7. Tooling

### 7.1 What breaks

Deal-flow CRMs (**Affinity**, **Attio**) are built around a company/contact + pipeline-stage model optimized for sourcing and diligence, **not for tracking a single relationship's simultaneous exposure across multiple vehicles.** Direct evidence of specific breakage at 5+ concurrent raises wasn't found in the research — treat as inferred — but the structural mismatch is clear.

Fund-ops and subscription platforms (**Passthrough**, **Anduin**) and back-office suites (**Juniper Square**, **Dynamo**, **Backstop**, **Altvia**) are generally licensed and configured **per fund or vehicle**, meaning multiple vehicles means either multiple instances or a workaround inside one.

**The structural problem, stated plainly:** when the fund CRM, the SPV admin platform, and the nonprofit donor database are three separate systems, **no single system shows a given relationship's total exposure and total ask history** across fund commitments, SPV participation, and charitable giving. Which is precisely the visibility needed to avoid the failure in §5.

Firms at this scale commonly compensate with a manually maintained master relationship tracker layered over the vendor tools, rather than finding one platform that spans all vehicle types. *(Reasoned inference from the vendor landscape, not a directly sourced finding.)*

### 7.2 What to do in the next 14 weeks

**Do not attempt a platform migration during an active close.** The pragmatic architecture:

- **One master relationship table** — Airtable, a database, or a well-disciplined Affinity instance — as the **system of record for relationships and asks.** Not for documents, not for subscriptions. Just: who, what vehicles are they exposed to, who owns them, what was the last ask, what's pending.
- **Vehicle-specific pipelines as views** over that table, not separate systems.
- **Keep SPV admin and subscription docs where they are.** Sydecar or AngelList handles mechanics; the relationship layer sits above and doesn't try to replicate it.
- **One ask queue**, visible to everyone who could initiate an ask.
- **Separate philanthropic pipeline** per §6.2, but with a link field to the master relationship record so the owner sees the full picture even though the processes are separate.

The whole thing is buildable in a week. The discipline of using it is the hard part.

---

## 8. The 14-week operating plan

### Weeks 1–2: governance and legal, before outreach scales

- **Counsel conversation** on integration risk across the concurrent vehicles and consistent Reg D posture. Non-negotiable, and it gates everything else.
- **Written allocation policy** covering fund vs SPV assignment, participation rights, and PL Neuro spinout flows.
- **Assign relationship owners** across the full existing base. Every relationship gets exactly one.
- **Master relationship table** stood up with the ask log.
- **Select and vet the SPV administrator**, including the "what if you disappear" question.

### Weeks 2–4: coordinated outreach begins

- Portfolio conversations with the top relationships — everything on the table, one conversation.
- Fund-first sequencing enforced.
- SPV framing scripted: the one-sentence reason each deal is in an SPV rather than the fund.

### Weeks 4–12: execution

- Weekly ask-queue review; no relationship gets two asks in a quarter without an explicit decision.
- SPV closes rolling as deals firm up.
- Coverage-ratio tracking against the $30M (Report 1, §5.2 — plan on 3–4x coverage in this market, meaning $90–120M of live conversation to net $30M).
- Fund first close dated and communicated, because a real deadline is the only thing that converts soft circles.

### Weeks 12–14: close

- First close executed at or above target.
- SPV closes completed.
- **Post-mortem instrumented**: which relationships funded which vehicles, via which connector, at what lag. This is the dataset that makes 2027 easier and that nobody in the industry has.

### Q1 2027

- IR hire, scoped from what the close actually revealed.
- Tooling properly built rather than assembled.
- Philanthropic track scaled with its own separate staffing.

---

## 9. What this implies for the tool

**Multi-vehicle data model**
- `Vehicle` as a first-class entity: fund, SPV, grant programme — with its own target, timeline, stage model, and regulatory posture (506(b) vs 506(c), 3(c)(1) vs 3(c)(7), charitable).
- `Relationship` as the durable object; `Exposure` as the join — this person's position in each vehicle.
- **`Ask` as a first-class event**: date, vehicle, asker, channel, outcome. This is the table that solves §5.
- `relationship_owner`, enforced as required, with handoff history.

**Coordination behaviours**
- **Ask-frequency guard**: soft block on a second ask to a relationship within a configurable window, requiring explicit override with a logged reason.
- Central pending-ask queue, visible across the team.
- Sequencing rules encoded — fund before SPV per relationship — surfaced as a warning, not a hard block.

**Cross-vehicle coverage view**
- Total pipeline and coverage ratio per vehicle *and* in aggregate, so you can see when two vehicles are competing for the same dollars.
- Conflict flag when the same relationship appears as active pipeline in two vehicles simultaneously.

**Compliance encoding**
- Reg D posture per vehicle, with the outreach gate from Report 4 applied per-vehicle.
- Beneficial-owner counts per vehicle against the 100/250/2,000 caps, with a warning threshold.
- Integration-risk flag when the same investor appears across multiple vehicles closing in the same window.
- Allocation-policy reference attached to every SPV participation decision.
- MFN and side-letter register, queryable before any term concession (Report 4, §5.2).

**Philanthropy separation with relationship linkage**
- Separate pipeline, separate materials, separate approval chain.
- Linked to the master relationship record so the owner has full visibility, with a hard separation in what gets *sent*.
- Instrument flag per opportunity: grant / PRI / MRI / LP commitment / SPV / direct.

**The metric that matters most here**
- **Asks per relationship per quarter**, tracked and capped. If the system does nothing else, doing this one thing well prevents the dominant failure mode of running four raises at once.

---

## Sources

- [Carta — What is an SPV?](https://carta.com/learn/private-funds/structures/spv/) · [3(c)(1) and 3(c)(7)](https://carta.com/learn/private-funds/regulations/3c1-3c7/) · [Qualifying Venture Capital Fund](https://carta.com/learn/private-funds/regulations/qualifying-fund/) · [Carta acquires Vauban](https://carta.com/blog/carta-acquires-vauban/)
- [Sydecar — SPV Pricing Guide 2026](https://sydecar.io/learn/what-spvs-cost) · [Pricing](https://sydecar.io/pricing) · [SPV Fees Are Shifting](https://sydecar.io/guides/spv-fees-2025) · [3(c)(1) vs 3(c)(7)](https://sydecar.io/learn/3c1-vs-3c7-spv-exemptions) · [What is an SPV](https://sydecar.io/learn/what-is-an-spv) · [Side Letters](https://sydecar.io/learn/side-letters)
- [Allocations — Best SPV Platform 2026](https://www.allocations.com/insights/best-spv-platform-2026)
- [SPV.co — How SPVs Work](https://spv.co/blog/how-spvs-work-from-formation-to-fund-distribution)
- [SEC — Qualifying VC fund threshold release](https://www.sec.gov/newsroom/press-releases/2024-102) · [Final rule](https://www.sec.gov/files/rules/final/2024/ic-35305.pdf)
- [Axios — Assure shutdown](https://www.axios.com/2022/11/23/assure-shutdown-fintech-startup-investing) · [TechCrunch on Assure](https://techcrunch.com/2022/12/14/frustration-and-anger-after-spv-platform-assure-dumps-users-at-the-curb-ahead-of-holidays/) · [VC Lab migration](https://govclab.com/2022/11/29/assure-migration/) · [Gridline](https://gridline.co/special-purpose-vehicles-are-even-riskier-in-a-downturn/)
- [TechCrunch — Go for the SPV instead](https://techcrunch.com/2022/04/07/stop-trying-to-raise-a-debut-venture-fund-go-for-the-spv-instead/)
- [PitchBook — How SPVs are helping emerging managers](https://pitchbook.com/news/articles/emerging-managers-spvs-fundraising-tough-market)
- [CB Insights — To SPV or Not to SPV](https://www.cbinsights.com/research/special-purpose-vehicles-in-venture-pros-and-cons/)
- [AngelList — Roll Up Vehicles](https://www.angellist.com/blog/introducing-rollups-built-for-founders)
- [ILPA — Principles](https://ilpa.org/industry-guidance/principles-best-practices/ilpa-principles/) · [Principles 3.0 PDF](https://ilpa.org/wp-content/uploads/2019/06/ILPA-Principles-3.0_2019.pdf)
- [Morrison Foerster — Fifth Circuit vacates Private Fund Adviser Rules](https://www.mofo.com/resources/insights/240612-fifth-circuit-vacates-sec-private-fund-adviser-rules)
- [Crowell & Moring — PFA Rule vacated](https://www.crowell.com/en/insights/client-alerts/secs-private-fund-advisers-rule-vacated-by-the-fifth-circuit)
- [Sidley — What's next after the vacatur](https://www.sidley.com/en/insights/newsupdates/2024/06/us-fifth-circuit-court-of-appeals-vacates-private-funds-rules-whats-next)
- [Mayer Brown — Fifth Circuit vacates PFA Rules](https://www.mayerbrown.com/en/insights/publications/2024/06/fifth-circuit-vacates-private-fund-adviser-rules)
- [Cooley — Primer: Side Letters in PE and VC Funds](https://thefundlawyer.cooley.com/primer-side-letters-in-private-equity-and-venture-capital-funds/)
- [QED Investors — Head of IR hire](https://www.businesswire.com/news/home/20220711005638/en/QED-Investors-Hires-Courtney-Christianson-as-Head-of-Investor-Relations)
- [Venture Unlocked — Fundraising best practices (Altimeter's Meghan Reynolds)](https://ventureunlocked.substack.com/p/fundraising-best-practices-for-managers)
- [Gradient Works — Sales territory models](https://www.gradient.works/blog/sales-territory-models-inside-sales-field-enterprise) · [Everstage — Territory types](https://www.everstage.com/sales-territory/types-of-sales-territory)
- [IRS — Program-Related Investments](https://www.irs.gov/charities-non-profits/private-foundations/program-related-investments) · [Nonprofit Law Blog](https://nonprofitlawblog.com/program-related-investments/)
- [Dalton & Tomich — Nonprofits with For-Profit Affiliations](https://daltontomich.com/legal-considerations-for-nonprofits-with-for-profit-affiliations/)
- [Affinity — PE CRM buyer's guide](https://www.affinity.co/guides/how-to-choose-the-best-private-equity-crm-software) · [Attio — Best CRMs for VCs 2026](https://attio.com/f/best-crm-for-venture-capital)
- [Passthrough](https://www.passthrough.com/)
- [a16z — Expanding the Growth Fund and Platform](https://a16z.com/expanding-the-a16z-growth-fund-and-platform/)
