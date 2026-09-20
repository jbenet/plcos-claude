# Report 6 — Engineering Productive Warm Introductions

**Graph traversal, connector selection, priming, and conversion — for LP raises and foundation program officers**

*Prepared 19 September 2026. Sourced inline; vendor-published and self-reported figures are flagged. Securities-law material is general information, not legal advice.*

---

## 0. The argument in one page

1. **Under 506(b), the warm introduction is not a nice-to-have — it is the only compliant path to a new prospect.** That reframes this from a networking topic into the core operating process of the raise. Everything in Report 4's scoring machine terminates here: a ranked list of names is worthless until it becomes a ranked list of *routes*.

2. **The academic evidence contradicts the obvious instinct.** The 2022 LinkedIn field experiment — ~20 million users, five years, roughly 600,000 attributable job moves — found an **inverted-U**: the greatest mobility came from *moderately weak* ties, not from the strongest ties and not from the very weakest. Your closest LP is often not the optimal connector to a new target. This is directly actionable and almost nobody does it deliberately.

3. **Connector goodwill is a depleting, slowly-replenishing resource, and in a small dense community it is visible to everyone.** Asking the same three super-connectors for five intros each in a month is legible to the whole LP community within weeks and reads as either desperation or poor targeting. The system must track per-connector spend centrally, across a growing team, or you will over-tap someone without knowing it.

4. **Double opt-in is the norm and it exists for a reason.** Ask both sides before connecting. Fred Wilson's 2009 framing is still the standard: without it, people take meetings they don't want, become resentful, and the connector's future availability degrades ([AVC](https://avc.com/2009/11/the-double-optin-introduction/)).

5. **Foundation program officers are not investors and the playbook does not transfer.** They face internal conflict-of-interest and fairness constraints that individual donors and LPs don't, making them more cautious about appearing to favour an applicant because of a personal connection. The intro to a program officer should be framed around *fit with their programme*, not around who you know.

6. **Priming works, and it is the cheapest lever available to you.** Send one short, specific asset before the intro lands. Never a deck. The mechanism — Cialdini's pre-suasion, plus ordinary familiarity — is well-established in theory; the specific claim that "prospects who read your thesis convert at X% higher" is **not backed by any controlled study we could find** and should not be asserted as fact.

---

## 1. The tooling landscape

Four categories, and it's worth being clear about which problem each solves.

### Relationship-intelligence CRMs

**Affinity** is the category leader for VC/PE. It ingests data exhaust from connected inboxes, calendars, and native integrations (Outlook, Chrome, LinkedIn), auto-logging who talked to whom without manual entry, and computes proprietary relationship-strength scores per contact pair with alerting when a key contact's score decays. It markets "the warmest path of introduction" as a core output and exposes an API ([Affinity](https://www.affinity.co/blog/relationship-intelligence); [product page](https://www.affinity.co/product/relationship-intelligence)). The formula is undisclosed.

Honest assessment from practitioner review: relationship-strength scoring is useful for surfacing warm paths but **is a heuristic on communication frequency, not a measure of trust or fit** ([ValueAddVC review](https://valueaddvc.com/blog/affinity-crm-for-venture-capital-a-founder-and-vcs-honest-review)). Treat the score as a candidate generator, not an answer.

**Attio** is a flexible, API-first, object-model CRM — strong for building custom automation on top, thinner on relationship-strength specifically. **Clay.earth** (personal relationship CRM) and **Folk** emphasize enrichment and integrations rather than algorithmic tie-strength scoring.

### Graph infrastructure

**The Swarm** ([theswarm.com](https://www.theswarm.com/data/relationships)) is infrastructure rather than a CRM: it builds a graph from web-crawled company/people data, a proprietary connections dataset, and integrations (HubSpot, Clay, Airtable), surfacing intro paths via **shared work history, education overlap, and common investors** — structural signals that proxy for latent tie strength even absent recent contact. It offers a Network Mapper API with documentation and engineering support post-onboarding ([funding note](https://www.theswarm.com/insights/the-swarm-raises-8m-in-total-funding); [Clay integration](https://www.theswarm.com/insights/unlocking-warm-intros-the-swarm-clay-integration)).

**This structural-signal approach is the more useful complement to Affinity for your situation**, because your graph's value is largely latent — people you overlapped with years ago at PL, in crypto, or at gatherings, with whom you have no recent email traffic and therefore a low Affinity score, but a real tie.

### Legacy institutional databases

**BoardEx and RelSci** (both under Altrata) map board memberships, philanthropic affiliations, education, and professional history to find indirect paths to executives and philanthropists — sold as enterprise data subscriptions ([BoardEx](https://altrata.com/products/boardex); [RelSci](https://altrata.com/products/relsci)). BoardEx publishes explicit guidance for nonprofits on finding actionable connections among board members' networks ([BoardEx nonprofit guide](https://boardex.com/articles/the-art-of-the-warm-introduction-for-nonprofits)).

**Note carefully:** that guidance is built for individual major-donor prospecting and is **silent on foundation program officers.** Do not assume donor-intro playbooks transfer to institutional grantmakers (§4.3).

### LinkedIn and point tools

**Sales Navigator TeamLink** shows which colleagues are 1st-degree connections of a target, surfacing the warmest internal path — using only LinkedIn's connection graph, not email or calendar ([TeamLink overview](https://www.linkedin.com/help/sales-navigator/answer/a101027/teamlink-overview)). Works best with team seats provisioned.

Smaller tools exist — Connect The Dots, Vieu, Bridge (single-connector double-opt-in "IntroLinks"), Introhive (automatic contact capture, known for accuracy), Draftboard, Centralize — summarized in a vendor buyer's guide that should be read as self-interested ([Boomerang](https://www.getboomerang.ai/post/best-warm-introduction-software-2026)).

**Two negative findings worth recording so you don't chase them:** "Nova/Nomos" as a relationship-graph product **could not be verified** and appears not to exist as described. No credible warm-intro *marketplace* was verified either; the handful that exist (WarmIntro, IntroHub) are thin directories with no public methodology.

### The privacy problem

Mining a team's email and calendar captures **third-party personal data** — the counterparties in every message — without their consent, and creates a durable behavioural record of internal team activity that functions as employee monitoring. In GDPR jurisdictions this requires a lawful basis, data minimization, and notice ([CRM data ethics](https://papers.ssrn.com/sol3/papers.cfm?abstract_id=5005001); [monitoring ethics](https://www.teramind.co/blog/employee-monitoring-ethics/)).

Practical policy before you turn any of this on:
- **Explicit team opt-in with written notice**, not a quiet admin toggle
- **Metadata only** where feasible — sender, recipient, timestamp, thread depth — not content
- **Retention limits**
- **Excluded domains** for personal, HR, legal, and medical correspondence
- **A stated purpose** limited to introduction routing, not performance evaluation

Doing this properly is not just compliance hygiene; it's the difference between a team that connects their inboxes and one that quietly doesn't, which determines whether the graph is any good.

---

## 2. Tie strength — what the evidence actually says

### 2.1 How the tools score it

Affinity, Swarm, and Introhive are opaque about formulas but converge on: **recency** of last contact, **frequency** over a trailing window, **reciprocity** (two-way vs one-way traffic), **meeting occurrence** (a calendar meeting typically outweighs an email thread), **thread depth and response speed**, and **initiator direction**. Swarm adds structural signals — shared employer, shared education, shared investor or board overlap — as proxies for latent tie strength absent recent contact.

### 2.2 The academic grounding, and the finding that should change your behaviour

**Granovetter (1973), "The Strength of Weak Ties"** argued that weak ties are more valuable than strong ties for accessing novel information, because strong-tie networks are densely overlapping — everyone already knows what everyone else knows — while weak ties bridge disconnected clusters and carry non-redundant information ([original](https://www.cs.cmu.edu/~jure/pub/papers/granovetter73ties.pdf)). This rested largely on observational data for five decades.

**Rajkumar, Saint-Jacques, Bojinov, Brynjolfsson & Aral, "A causal test of the strength of weak ties," *Science* 377(6612), 2022** is the decisive test: a five-year, ~20-million-user field experiment inside LinkedIn's "People You May Know" algorithm, randomly varying the mix of weak and strong tie recommendations and tracking downstream job mobility — roughly 600,000 new jobs attributable to the experiment ([Science](https://www.science.org/doi/10.1126/science.abl4476); [MIT Sloan summary](https://mitsloan.mit.edu/press/a-team-mit-harvard-and-stanford-scientists-finds-weaker-ties-are-more-beneficial-job-seekers-linkedin); [Stanford Report](https://news.stanford.edu/stories/2022/09/real-strength-weak-ties)).

**The critical finding is not "weaker is better." It is an inverted U.** The very weakest ties (near-strangers) *and* strong ties both produced less mobility than **moderately weak ties**. Co-author Iavor Bojinov: "the greatest job mobility comes from moderately weak ties — social connections between the very weakest ties and ties of average relationship strength." The effect was strongest in digital, high-tech, IT-intensive, and remote-friendly sectors, where novel information and low redundancy matter most.

### 2.3 What this means operationally

The instinct — always ask your closest LP for the intro — is **not empirically optimal**. The ideal connector to a genuinely new target is often someone with a *moderate* tie to both you and the target: close enough to have credibility and be willing, distant enough from your existing circle to reach non-redundant contacts.

Three concrete consequences:

1. **Your strongest ties are all connected to each other.** Their networks overlap heavily with yours and with each other's. Routing everything through them reaches a smaller, more redundant set of targets than the raw connection count suggests.
2. **Moderate ties are where the new capital is.** For PLC Neurotech specifically: people you know from PL's broader orbit, past conference co-panelists, podcast guests, people met at gatherings — these are exactly the moderate band, and they reach family-office and science-philanthropy clusters your inner circle does not.
3. **Reserve strong ties for the highest-stakes single introductions**, where the connector's personal credibility is doing heavy lifting — an anchor LP, a foundation president, a difficult reference.

**This should be encoded, not remembered.** Compute tie strength, bucket it, and have the routing engine prefer the moderate band for volume asks while flagging strong-tie routes as high-cost, high-value options to spend deliberately.

---

## 3. Connector selection

### 3.1 The dimensions that matter

No canonical academic framework exists here; this synthesizes practitioner writing and the tie-strength evidence.

| Dimension | What it means | Why it matters |
|---|---|---|
| **Credibility with this specific target** | Does the target respect this person's judgment *on this topic*? | General seniority is worthless if the target doesn't rate them on venture or science. This is target-specific, not a global connector attribute. |
| **Tie strength to the target** | Moderate often beats maximal (§2) | Determines reach and non-redundancy |
| **Willingness / generosity** | Freely given vs socially obligated | A reluctant yes reads instantly to the recipient |
| **Prior intro track record** | Have their past intros been good? | A connector with a record of good calls has standing capital; one who forwards everything has none |
| **Thesis fluency** | Can they represent your ask in one accurate paragraph without you? | Determines whether the intro survives the target's first question |
| **Reputational stake** | Do they have skin in the game — co-investor, board seat, existing LP? | A self-interested intro is *more* credible, not less |
| **Remaining goodwill** | How much have you already spent with them? | The variable nobody tracks, and the one that fails silently |

### 3.2 The failure modes

- **The super-connector discount.** Someone who introduces everyone to everyone has their endorsements devalued, because recipients learn they apply no filter ([Affinity on super-connectors](https://www.affinity.co/guides/five-ways-to-become-a-super-connector-and-drive-growth)). Counterintuitively, the person with the most connections is often the *worst* connector for a high-stakes intro.
- **The reluctant connector.** Says yes from obligation, writes a lukewarm note, drags their feet. The recipient reads it immediately. Better to take the no.
- **The capital-spent connector.** Has already used their standing with this target on other asks. This is the one that fails invisibly, because they won't tell you — they'll just make the intro badly.
- **The mismatched-domain connector.** Highly credible in crypto, introducing you to a neuroscience-focused foundation. The credibility doesn't transfer, and the target may read the mismatch as evidence you don't understand their world.

*Note: "intro currency" as a named framework is informal — we found no established published usage. The underlying idea (introductions consume a finite, replenishable reputational asset) is consistent with general social-capital literature but should not be cited as a term of art.*

### 3.3 Your specific graph

Worth naming explicitly, because the routing strategy differs by cluster:

- **PL ecosystem and crypto.** Deep, strong ties. High willingness. **But**: credibility with a traditional family office or a neuroscience foundation does not automatically transfer. Use these connectors for crypto-adjacent LPs and for reaching *other* technologists, not for the Kavli-adjacent world.
- **Podcast guests.** Moderate ties by construction, high mutual respect, and — importantly — a non-transactional relationship history. **This is your best-constructed connector pool and the one most likely to be under-used.** Adam Marblestone, Allison Duettmann, Doris Tsao and others in that orbit sit exactly at the intersection of neuroscience credibility and funder proximity.
- **Gathering attendees.** Moderate ties, self-selected for intellectual alignment. The largest pool and the least mapped.
- **Fund I LPs (both vehicles).** Strong ties with reputational stake — the highest-credibility connectors available for *other LPs*, and the classic highest-conversion referral channel. **Under-asking here is the most common mistake managers make.** An LP who has committed wants the fund to succeed and is usually willing to help; most GPs never ask directly.
- **Service providers.** Counsel, auditors, fund admins, bankers. Low volume, high trust, slow. Frequently cited as an underused channel into family offices specifically, because these people see the family office's actual behaviour.
- **Zama board and other board relationships.** Adjacent institutional credibility.

---

## 4. The mechanics of a good intro

### 4.1 Double opt-in

The dominant norm, articulated by Fred Wilson in 2009 and still standard: before connecting two people who don't know each other, **ask each individually for permission, and only send the joining email once both have said yes** ([AVC](https://avc.com/2009/11/the-double-optin-introduction/)). Wilson's rationale: without it, people take meetings they don't want, become resentful, and it degrades the connector's availability for introductions they *do* want to make.

The surrounding etiquette:
- Give the requested party a genuine, easy out
- Remove the connector from the thread once the two parties connect
- Give the connector a prompt yes/no, never a vague maybe
- **Close the loop back to the connector with the outcome, regardless of result** — this is the step people skip and the one that most determines whether they help again

### 4.2 The forwardable email

You write it *for* the connector, so their job is "forward this" rather than "compose something." Structure, per practitioner guidance ([Introhive templates](https://www.introhive.com/blog-posts/the-art-and-science-of-warm-introductions/)):

- Short enough to skim on a phone
- One line on who you are and what the firm does
- **The specific ask** — "15–20 minutes" — not an open-ended "connect"
- One sentence on **why this specific target**, showing you did the work
- An explicit easy-out
- Contact details or a link, so the target can act without more back-and-forth

Two additions specific to your situation:

**Under 506(b), the forwardable must not read as an offer.** "I'd value 20 minutes to share how we're thinking about the neurotech stack" is thesis conversation. "We have $30M of remaining allocation closing in December" is solicitation of someone with whom you have no pre-existing relationship. Keep the forwardable on the thesis side; the fund conversation happens after the relationship exists. **Have counsel review your standard forwardable template once, then reuse it.**

**Include the priming asset as a link, not an attachment.** One short piece (§5). Attachments feel transactional and get stripped by filters.

### 4.3 Program officers are different

Grantmaking literature frames the funder relationship as slower, more mission-alignment-driven, and less transactional than an investment pitch. Program officers explicitly want early soft conversations before a formal proposal, value being asked good questions about fit rather than being pitched, and prefer to be approached with a clear sense of how a request maps to a specific programme they run ([Nonprofit Quarterly](https://nonprofitquarterly.org/six-easy-questions-to-ask-your-program-officer/); [Fluxx](https://www.fluxx.io/blog/program-officers-four-ways-to-create-stronger-grantee-relationships-for-greater-impact/); [Funding for Good](https://fundingforgood.org/foundations-how-to-start-conversation-with-program-officers/)).

The critical structural difference: **program officers face internal conflict-of-interest and fairness constraints that individual donors and LPs don't.** An intro that foregrounds the personal connection can make them *more* cautious, not less, because it puts them in the position of appearing to favour an applicant for non-merit reasons.

So the program-officer intro inverts the emphasis:
- Lead with **programme fit**, not relationship
- The connector's role is to vouch for *seriousness and credibility*, not to ask for a favour
- The ask is for **a conversation about fit**, explicitly not for funding
- A grantee of that officer is a far better connector than a socially prominent person, because a grantee's endorsement is evidence about work quality
- Never imply the connection should affect the decision

This is a genuinely different template and should be stored as one.

---

## 5. Priming with materials

### 5.1 The mechanism

Cialdini's *Pre-Suasion* (2016) holds that what a persuader gets a target to focus on **immediately before** a request shapes receptivity — framing happens before the ask, not during it ([Forbes review](https://www.forbes.com/sites/rogerdooley/2016/09/01/pre-suasion-robert-cialdinis-sequel-to-influence/)). Applied here: a target who has read your thesis before the intro lands receives the ask into a familiar, primed context rather than cold.

**A necessary honesty caveat:** we found **no controlled study** establishing that prospects who read a firm's thesis convert at a measurably higher rate. The mechanism is well-grounded in pre-suasion and familiarity theory; the specific quantitative claim is not evidenced. Don't put a number on it in an LP deck.

### 5.2 What to send, and what never to send

**Send:** one short, specific asset. A relevant essay, a thesis excerpt, a recent piece on the exact topic the target cares about. One. A link, not an attachment.

**Never send before or with an intro:** the LP deck, a financial model, anything requiring data-room login, or anything with fund terms. Three reasons: it raises friction at the exact moment you want none; it signals a transactional approach when you want a relationship-first one; and under 506(b) it risks being an offer to someone with whom you have no pre-existing substantive relationship.

### 5.3 Published thesis as a dual-purpose device

Top firms use a published, narrow thesis as both a **screening device** (it pre-selects for people who resonate, reducing low-fit inbound) and a **priming device** (anyone who has read it arrives speaking your language). USV is the canonical case (Report 5, §2).

The practical version for you: **when the primer exists (Report 5, §4), it becomes the default priming asset for every intro** — and that is a large part of its value. A target who has read "The Neurotech Stack" before meeting you is having a fundamentally different first conversation than one who hasn't.

### 5.4 Sequencing priming with the intro

The pattern that works:
1. **Passive priming** — the target encounters your work independently (podcast, essay, conference). Best case, uncontrollable.
2. **Connector-mediated priming** — the connector mentions your work in the opt-in ask. "Juan writes the thing on neurotech financing you sent me."
3. **The forwardable** — carries one link.
4. **The meeting** — you can now start from shared context rather than from "so what do you do."

**Track which stage each prospect is at.** A target who has read three pieces is at a different readiness than one who hasn't heard of you, and the intro should be requested differently. This is a real field in the system, not a soft notion.

---

## 6. Measuring intro quality

### 6.1 The funnel

Track per connector and in aggregate:

| Metric | What it diagnoses |
|---|---|
| Intro requests made | Volume of asks, per connector |
| **Intros delivered / requests made** | Connector willingness — the first and most informative filter |
| Time from request to delivery | Willingness decay; a lengthening lag is the early warning |
| Intro → first meeting rate | Target receptivity and message fit |
| Meeting → next step rate | Quality of the underlying fit, not the intro |
| Commitments attributed to originating connector | The actual return, tracked over years |
| **Connector goodwill spend** | Cumulative asks, outcomes returned, reciprocity given |

Referral-metrics literature built for B2B programmes recommends exactly this chain plus a connector-level conversion rate as the key diagnostic ([Otrenix](https://otrenix.com/referral-conversion-rate/); [Prefinery](https://www.prefinery.com/blog/referral-metrics-track-roi/)).

**Connector NPS / willingness decay** — tracking whether a connector's response time and delivery rate degrade over repeated asks — is a practice to build in-house; **no published benchmark exists.**

### 6.2 On benchmark numbers

Multiple sources agree warm intros substantially outperform cold outreach, but **the specific figures circulating are vendor-published and self-reported, not peer-reviewed.** One vendor analysis drawing on "over 1,000 startup founders" cites warm outreach response rates of roughly 10–34% versus cold email reply rates of roughly 2–10%, warm intros as "5–10x more effective," and warm-sourced deals closing in ~3 months versus ~6 for cold ([Growleads](https://growleads.io/blog/warm-outreach-vs-cold-email/)).

**Use these as order-of-magnitude intuition only. Do not cite them as fact in an LP deck.** The directional claim is solid; the numbers are not.

### 6.3 Attribution over years

The hard part: a commitment in 2027 may trace to a podcast guest in 2025 who introduced you to someone in 2026. **Record the full chain, not the last link.** An intro-origination field that survives across years is the only way the graph ever learns which connectors actually produce capital — and that knowledge is one of the most valuable things the system can accumulate.

---

## 7. Scaling without burning the graph

The core constraint: in a small, dense LP community, **connectors talk to each other.** Five intro asks to the same three well-connected LPs in one month is legible to the whole community within weeks, and reads as desperation or poor targeting.

The disciplines:

**Batch and sequence.** Ask a given connector once per meaningful cycle — once per fund close, not weekly. A steady drip reads as extraction.

**Make each ask maximally specific.** Name the exact target and the exact reason. Never "anyone who might be a good LP," which offloads the targeting work onto the connector and produces either nothing or a low-quality scattershot.

**Give back, before and after.** Deal flow, information, intros the connector would value, an invitation to something good. Reciprocity is what makes the resource replenish.

**Spread across the moderate band.** Per §2, this is both better for reach *and* better for goodwill management, because it distributes the asks rather than concentrating them.

**Track centrally across the team.** As the team grows — an IR hire, a PL Neuro lead — the failure mode is two people asking the same connector in the same month without knowing. This is a systems problem with a systems fix.

**The structural alternative worth knowing about:** prime brokers run **capital introduction** desks that formalize exactly this function — a neutral third party vets and curates fund-to-LP matches so no single relationship is overused and the fund isn't perceived as spraying asks ([overview](https://en.wikipedia.org/wiki/Capital_introduction); [BNY Pershing](https://www.bny.com/pershing/us/en/solutions/prime-brokerage/capital-introductions.html)). Mostly relevant at larger scale, but the concept — **routing asks through a neutral intermediary to protect the personal graph** — is one you could partially replicate with the right convening structure.

---

## 8. The operating process, against your timeline

### 8.1 The 14-week version

**Weeks 1–2: map before asking.**
- Load the existing-relationship census (Report 4, §7) into a graph.
- Compute paths from the census to every Tier 1 and Tier 2 prospect.
- Bucket connectors by tie strength; flag the moderate band.
- **Score remaining goodwill per connector from memory** — who have you asked recently, for what, with what result. Do this before the first new ask, not after.

**Weeks 2–3: the highest-yield asks first.**
- **Existing LPs.** Ask each Fund I LP directly, once, specifically: "who are the two or three people you think should see this?" This is the single highest-conversion channel and the most commonly under-asked. Frame it as a request for their judgment, not their Rolodex.
- **Podcast guests.** Moderate ties, high mutual respect, non-transactional history. Approach individually and specifically.
- **Service providers.** Counsel, auditor, fund admin — each sees family offices you don't.

**Weeks 3–12: run the routing engine.**
- Batched, specific asks across the moderate band.
- Double opt-in on everything.
- Priming asset with each forwardable.
- Loop closed with every connector, every time.
- Weekly review of goodwill spend per connector.

**Throughout: instrument.** Every request, delivery, meeting, and outcome logged with the originating connector, so the 2027 version of this is data-driven rather than memory-driven.

### 8.2 The parallel program-officer track

Different template, different cadence, different connectors (grantees over socialites), and no urgency — a program-officer relationship started now produces funding in late 2027. Run it separately so its slower clock doesn't distort the fund pipeline's metrics.

---

## 9. What this implies for the tool

**Graph layer**
- Ingest: email/calendar metadata (with the consent policy of §1), LinkedIn connections, CRM, plus **structural signals** — shared employer, shared education, shared investor, co-attendance at events, podcast appearances. The structural layer matters disproportionately for you because much of your graph is latent.
- Compute tie strength with an explicit **moderate-band flag**, not just a raw score.
- Path computation with **path quality scoring**, which is a function of connector credibility *with that target*, tie strength at both ends, and remaining goodwill — not just hop count.

**Connector objects as first-class**
- `credibility_domains[]` — where this person's word carries weight, so a crypto connector isn't routed to a neuro foundation
- `goodwill_balance` — cumulative asks, outcomes, reciprocity given, with a replenishment model over time
- `intro_track_record` — requests, deliveries, delivery lag trend, resulting meetings and commitments
- `thesis_fluency` — can they represent the ask unaided
- `last_asked` with a configurable minimum interval, enforced as a soft block

**Intro workflow**
- Request → opt-in A → opt-in B → forwardable sent → delivered → meeting → outcome → **loop closed**, with the last step enforced rather than optional
- Templates by target type: LP, program officer, co-investor, service provider
- Forwardable generator pre-filled with target context and the selected priming asset
- **506(b) gate**: no prospect can reach "contacted" without either documented pre-existing relationship or a confirmed delivered intro

**Priming layer**
- Per-prospect record of which content they have received and engaged with
- Readiness stage — cold / passively primed / connector-primed / engaged
- Asset recommendation matched to the target's stated interests

**Team coordination**
- Single connector owner, so two people never ask the same person in the same cycle
- Team-wide visibility on pending asks
- Central goodwill ledger

**Learning loop**
- Multi-year intro-origination chains preserved
- Which connector types, tie-strength bands, and priming sequences actually converted
- Feed back into path quality scoring, so the routing improves rather than staying static

---

## Sources

- [Rajkumar et al. (2022) — A causal test of the strength of weak ties, *Science*](https://www.science.org/doi/10.1126/science.abl4476)
- [MIT Sloan — summary of the weak-ties LinkedIn experiment](https://mitsloan.mit.edu/press/a-team-mit-harvard-and-stanford-scientists-finds-weaker-ties-are-more-beneficial-job-seekers-linkedin)
- [Stanford Report — The real strength of weak ties](https://news.stanford.edu/stories/2022/09/real-strength-weak-ties)
- [Granovetter (1973) — The Strength of Weak Ties](https://www.cs.cmu.edu/~jure/pub/papers/granovetter73ties.pdf)
- [Wikipedia — Interpersonal ties](https://en.wikipedia.org/wiki/Interpersonal_ties)
- [Social Capital Research — Introduction to Social Capital Theory](https://www.socialcapitalresearch.com/wp-content/uploads/edd/2018/08/Introduction-to-Social-Capital-Theory.pdf)
- [AVC (Fred Wilson) — The Double Opt-In Introduction](https://avc.com/2009/11/the-double-optin-introduction/)
- [Medium — The Double Opt-In Introduction (Shawn Price)](https://medium.com/@sprice/the-double-opt-in-introduction-911a569485bd)
- [Medium — More on the Double Opt-In Intro (Richard Titus)](https://richardtitus.medium.com/more-on-the-continuing-art-of-the-double-opt-in-intro-1609d5e7cb88)
- [Introhive — The Art and Science of Warm Introductions](https://www.introhive.com/blog-posts/the-art-and-science-of-warm-introductions/)
- [Affinity — Relationship Intelligence deep dive](https://www.affinity.co/blog/relationship-intelligence) · [Product page](https://www.affinity.co/product/relationship-intelligence) · [Super-connector guide](https://www.affinity.co/guides/five-ways-to-become-a-super-connector-and-drive-growth)
- [ValueAddVC — Affinity CRM honest review](https://valueaddvc.com/blog/affinity-crm-for-venture-capital-a-founder-and-vcs-honest-review)
- [The Swarm — Relationship Data](https://www.theswarm.com/data/relationships) · [Funding announcement](https://www.theswarm.com/insights/the-swarm-raises-8m-in-total-funding) · [Clay integration](https://www.theswarm.com/insights/unlocking-warm-intros-the-swarm-clay-integration)
- [LinkedIn — TeamLink overview](https://www.linkedin.com/help/sales-navigator/answer/a101027/teamlink-overview) · [TeamLink for referrals](https://www.linkedin.com/business/sales/blog/prospecting/teamlink-in-sales-navigator-helps-you-get-referrals)
- [Altrata — BoardEx](https://altrata.com/products/boardex) · [RelSci](https://altrata.com/products/relsci)
- [BoardEx — The Art of the Warm Introduction for Nonprofits](https://boardex.com/articles/the-art-of-the-warm-introduction-for-nonprofits)
- [Boomerang — Warm introduction software comparison 2026](https://www.getboomerang.ai/post/best-warm-introduction-software-2026) · [Super-connector glossary](https://www.getboomerang.ai/glossaries/super-connector)
- [Common Room — Signals](https://www.commonroom.io/docs/signals/)
- [SSRN — Data Ethics in CRM](https://papers.ssrn.com/sol3/papers.cfm?abstract_id=5005001)
- [Teramind — The Ethics of Employee Monitoring](https://www.teramind.co/blog/employee-monitoring-ethics/)
- [Nonprofit Quarterly — Six Easy Questions to Ask Your Program Officer](https://nonprofitquarterly.org/six-easy-questions-to-ask-your-program-officer/)
- [Fluxx — Program Officers and Grantee Relationships](https://www.fluxx.io/blog/program-officers-four-ways-to-create-stronger-grantee-relationships-for-greater-impact/)
- [Funding for Good — Starting the Conversation with Program Officers](https://fundingforgood.org/foundations-how-to-start-conversation-with-program-officers/)
- [Forbes — Cialdini's *Pre-Suasion*](https://www.forbes.com/sites/rogerdooley/2016/09/01/pre-suasion-robert-cialdinis-sequel-to-influence/)
- [30 Principles from Pre-Suasion](https://samueljwoods.com/30-principles-pre-suasion-robert-cialdini-conversions/)
- [Growleads — Warm outreach vs cold email (vendor-reported)](https://growleads.io/blog/warm-outreach-vs-cold-email/)
- [Otrenix — Referral conversion rate](https://otrenix.com/referral-conversion-rate/) · [Prefinery — Referral metrics](https://www.prefinery.com/blog/referral-metrics-track-roi/)
- [Wikipedia — Capital introduction](https://en.wikipedia.org/wiki/Capital_introduction) · [BNY Pershing — Capital Introductions](https://www.bny.com/pershing/us/en/solutions/prime-brokerage/capital-introductions.html)
- [SEC — Private Placements, Rule 506(b)](https://www.sec.gov/resources-small-businesses/exempt-offerings/private-placements-rule-506b)
