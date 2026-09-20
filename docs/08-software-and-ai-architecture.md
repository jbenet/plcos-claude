# Report 8 — Structuring, Software, and AI Augmentation

**What to build, what to buy, what not to automate, and in what order — against a 14-week close**

*Prepared 19 September 2026. Sourced inline; vendor claims are labelled as such. Securities-law and compliance material is general information, not legal advice.*

---

## 0. The argument in one page

1. **The evidence on AI in outbound fundraising is clear and mostly negative — and that's useful, because it tells you exactly where not to spend.** AI-generated cold outreach has worsening response economics, triggers platform and spam penalties that damage domain reputation for months, is recognizable to sophisticated recipients, and — decisively for you — **would be a Reg D general-solicitation problem under 506(b) regardless of whether it worked.** There is no credible evidence it works for family-office targeting. Do not build it.

2. **AI's real leverage in a relationship-driven raise is upstream and downstream of the human conversation, never inside it.** Research and dossier building, entity resolution, signal monitoring, meeting prep, note capture and CRM hygiene, DDQ and proposal answer reuse, document Q&A, objection clustering, forecasting. Every one of these is a case where a human reads the output before anything reaches a prospect.

3. **The dominant production pattern is boring and correct: simple composable workflows with human checkpoints, not autonomous agents.** Anthropic's own guidance is that the most successful implementations use simple, composable patterns rather than complex frameworks, escalating to agent loops only when simpler approaches demonstrably underperform ([Building Effective Agents](https://www.anthropic.com/research/building-effective-agents)). Every credible production account found includes an explicit human gate before anything reaches a prospect.

4. **AI relocates labour; it does not remove it.** The most credible field account — SaaStr running five specialized agents for six months — reported 19,847 outbound messages versus ~300 by comparable humans, but **15–20 hours per week of leadership oversight, prompt-tuning, and monitoring** to sustain it, with the explicit conclusion that "AI SDRs scale what's already working — they can't fix what's broken" ([SaaStr](https://www.saastr.com/6-months-of-ai-sdrs-whats-worked)). Budget the supervision.

5. **For the next 14 weeks: build almost nothing.** Four things — the master relationship table, the ask log, meeting capture, and a warm-path map — get you most of the operational benefit at a fraction of the cost. The real system is a Q1–Q2 2027 build, informed by what this close actually teaches you.

---

## 1. The honest state of AI outbound

This section exists to close off a direction, so it's worth being specific.

### 1.1 The cautionary cases

**11x.ai.** TechCrunch reported that the a16z- and Benchmark-backed company displayed customer logos without valid authorization; ZoomInfo's own one-month trial "performed significantly worse than our SDR employees," and ZoomInfo's legal team threatened action for deceptive trade practices. Former employees alleged the company reported ~$14M ARR to investors when actual retained contracts totalled roughly $3M, and reported **70–80% customer churn** during a period the company itself called its highest-churn phase ([TechCrunch](https://techcrunch.com/2025/03/24/a16z-and-benchmark-backed-11x-has-been-claiming-customers-it-doesnt-have)).

**Artisan.** Ran a "stop hiring humans" billboard campaign, walked back the messaging, hired humans itself, and reportedly faced LinkedIn account bans tied to automated outreach ([Wikipedia](https://en.wikipedia.org/wiki/Artisan_AI)). The generalizable lesson: **platforms actively detect and penalize automated-outreach patterns independent of message quality.**

### 1.2 The declining economics

One practitioner analysis reports cold-email reply rates falling from 6.8% (2023) to 3.43% (2026), alongside 50–70% churn of AI SDR tools within three months ([ORRJO](https://orrjo.com/ai-sdrs-not-working-what-to-do-instead)). A deliverability-focused source cites **Google's spam-complaint threshold at 0.1%** (down from 0.3%), with typical cold-email inbox placement around 50–65% and open rates falling from 30%+ in 2022 to 15–23% in 2026 ([Fuzzy AI](https://getfuzzy.ai/blog/cold-email-deliverability-ai-volume)).

**These are aggregator and marketing-blog figures, not peer-reviewed — treat the precise numbers as unverified.** But the directional consensus across independent sources is consistent enough to be a real trend: declining reply rates, tightening spam thresholds, and domain-reputation damage from volume.

### 1.3 The conclusion for you

Four independent reasons not to go here:

1. **It doesn't work for this audience.** No evidence exists for AI outbound converting family offices or foundation program officers, both of which are referral-gated by construction (Report 4, §2.3).
2. **It damages the asset you actually need.** Sender domain reputation takes months to repair, and your domain is the one your warm intros arrive on.
3. **It is recognizable**, and to a sophisticated allocator it signals exactly the opposite of what you want to signal.
4. **It is a compliance problem.** Scaled automated outreach without a pre-existing substantive relationship is precisely the fact pattern the SEC treats as general solicitation, which can void a 506(b) exemption, trigger rescission rights under Securities Act §12(a)(1), and lead to enforcement and future disqualification ([TheCorporateCounsel.net](https://www.thecorporatecounsel.net/blog/2024/10/a-perennial-concern-for-vc-fundraising-avoiding-general-solicitation-problems.html)).

**The one legitimate reading of the SaaStr result:** AI is a volume multiplier on an *already-proven, already-warm* channel. It does not create a channel. Apply it to sequencing follow-ups with people you already know, not to reaching people you don't.

---

## 2. Where AI genuinely helps

The pattern across all credible sources: **AI is trustworthy for retrieval, structuring, and first-draft generation under human review; it is untrustworthy for anything that ships to a prospect unreviewed or that requires judgment about relationships.**

### 2.1 High value, low risk — build these

**Prospect research and dossier building.** Claygent-style waterfall enrichment and cited deep research (Perplexity, Claude/OpenAI research modes) both work well when the output is a structured brief a human reads before a meeting. **The citation trail is the critical property** — it lets a human catch hallucinations before they reach a prospect ([Perplexity due-diligence use case](https://sidsaladi.substack.com/p/ai-powered-investor-research-101)). Independent reviews of Claygent find it genuinely useful for structured, repeatable enrichment but credit-expensive, requiring real prompt engineering to avoid hallucinated fields, and unreliable on judgment-heavy questions ([Claygent review](https://coldreach.ai/blog/claygent-review)).

**Meeting prep briefs.** Assemble everything known about a prospect — enrichment, prior interactions, content they've engaged with, their public statements, the warm path — into a one-page brief before every meeting. Cheap, high value, zero risk, and immediately useful in the next 14 weeks.

**Note capture and CRM hygiene.** The most mature and least controversial category. Granola, Fathom, Fireflies, Otter, Read.ai all transcribe and summarize adequately; the trade-offs are whether the tool joins as a visible bot (Fireflies/Otter) or works locally without one (Granola/Fathom), CRM-sync depth, and privacy handling ([comparison](https://www.itsconvo.com/blog/granola-vs-otter-vs-fathom)). For an LP-facing team this materially reduces the "who said what to which LP six months ago" failure mode.

**A caution specific to your context:** LP conversations contain confidential financial information about the counterparty. Choose a tool with a clear DPA, no training on your data, and the ability to exclude specific meetings. **Local-first tools (Granola, Fathom) that don't join as a visible bot are preferable for sensitive LP calls** — both for privacy and because a recording bot changes how candidly people speak.

**Signal monitoring.** Job postings, Form D and EDGAR filings, liquidity events, funding announcements, 990-PF filings, conference rosters. The Common Room pattern — **signal aggregation feeding human timing decisions, not generating outbound** ([Common Room](https://www.commonroom.io/product/signals/)) — is a defensible, low-risk, high-value use. This is the single best automation target given Report 4's finding that job postings and liquidity events are the most underpriced signals available.

**DDQ and proposal answer libraries.** A strong emerging category (Responsive, Ontra, Tribble, AutoRFP.ai) built on retrieval-augmented generation over a firm's own **approved-answer corpus** — much safer than open-ended generation because the model is constrained to previously-approved language ([Tribble](https://tribble.ai/blog/how-to-build-one-knowledge-base-for-rfps-ddqs-and-security-questionnaires/)). Directly applicable to both ILPA DDQ responses and grant proposals (Reports 1 and 2), and probably the largest single source of senior-hour savings available.

**Document Q&A over the data room.** Retrieval-augmented Q&A over a bounded, permissioned corpus — well-understood and low-risk because answers are grounded in retrievable, citable passages.

**Objection clustering.** Gong-style aggregation of call transcripts into recurring-objection taxonomies. Gong's own study of "over 1 million sales opportunities across 1,418 organizations" reports meaningful win-rate lifts from AI deal insights ([Gong Labs](https://www.gong.io/blog/we-measured-the-roi-of-ai-in-sales-heres-how-it-really-impacts-your-deals)) — **this is Gong studying its own customers, so directionally credible rather than causally proven.** The underlying value is real regardless: surfacing patterns across hundreds of conversations that no human would catch. Report 1's objection-ontology recommendation is exactly this.

**First-pass drafting for human editing.** Grant narratives, IC memo sections, personalized follow-ups — *provided a human fact-checks every claim before it leaves the building.* This caveat recurs verbatim across every credible source. Instrumentl's own vendor assessment is unusually candid: AI is good at drafting from an RFP and restructuring dense text, but "every sentence still needs thoughtful review by a human," AI cannot verify factual program details or understand funder relationships, and there is real risk of bias in AI-drafted narratives ([Instrumentl](https://www.instrumentl.com/blog/best-ai-for-grant-writing)).

### 2.2 Where it reliably fails

- Generating outbound sent without review
- Making relationship-quality judgments — frequency-of-contact metrics are a poor proxy for trust or fit (Report 6, §1)
- Any factual claim about a specific person or firm without a citation trail
- Full automation of grant narratives without domain-expert review

---

## 3. The tooling landscape, assessed

| Tool | What it does well | What it's bad at | Verdict for you |
|---|---|---|---|
| **Affinity** | Auto-capture of email/calendar into a relationship graph; warm-path surfacing; VC-native | Relationship-strength is a **frequency heuristic, not a trust measure** ([honest review](https://valueaddvc.com/blog/affinity-crm-for-venture-capital-a-founder-and-vcs-honest-review)); AI features additive not transformative; no multi-vehicle model | Strong candidate for the relationship layer if you want to buy rather than build |
| **Attio** | API-first, flexible object model, strong workflow engine; "Ask Attio" conversational querying | AI features thinner than Salesforce/HubSpot ([review](https://www.dench.com/blog/attio-ai-features)) | **Best fit if you intend to build custom logic on top** — which, given your architecture instincts, you probably do |
| **Clay** | Waterfall enrichment across dozens of providers; Claygent web research at scale | Credit-expensive; needs prompt engineering; unreliable on judgment questions | Buy for enrichment specifically; don't make it the system of record |
| **Harmonic** | Company/startup signal detection, strong API | Company-focused not LP-focused; ~$25K/yr entry *(unverified)* | Useful for deal sourcing, not for this problem |
| **Common Room** | Signal aggregation across community, product, and intent sources | Not an LP tool | The *pattern* is right; the product isn't aimed here |
| **The Swarm** | Structural graph signals — shared employer, education, investors — surfacing latent ties; Network Mapper API | Newer, smaller | **Complements Affinity well for your latent graph** (Report 6, §1) |
| **Gong / Chorus** | Conversation intelligence, objection patterns | Enterprise pricing; built for high-volume sales motions | Overkill at your volume; the pattern is replicable with transcripts + clustering |
| **Instrumentl / Grantable** | Grant discovery, deadline tracking, first-draft generation | Weak on funder relationships; Grantable weak on research and program management | Instrumentl worth it for the grant track's RFA monitoring |
| **Salesforce Agentforce** | Deep agentic automation | Only relevant if already deep in Salesforce | Not applicable |
| **Passthrough / Anduin / Sydecar / Carta** | Subscription docs, KYC, closings | Per-vehicle licensing; no relationship layer | Keep for mechanics; don't try to make them the relationship system |

**The build-vs-buy answer:** the hard problem — ingesting and normalizing email and calendar metadata across a whole firm — is already solved, legally sensitive, and requires broad mailbox access. **Build on an existing relationship CRM's API rather than rebuilding it.** Attio is positioned as API-first and explicitly invites custom automation layered on top. The custom part should be the *scoring, routing, coordination, and multi-vehicle logic* — the parts no vendor does — not the ingestion.

---

## 4. Architecture

### 4.1 Agent patterns that actually work

Anthropic's guidance distinguishes **workflows** (fixed, code-defined paths — prompt chaining, routing, parallelization, orchestrator-workers, evaluator-optimizer) from **agents** (LLM-directed loops with open-ended step counts), and recommends starting with the simplest workflow pattern, escalating only when simpler approaches demonstrably underperform, because agent loops trade cost, latency, and reliability for flexibility ([Anthropic](https://www.anthropic.com/research/building-effective-agents)).

Mapping to your use cases:

| Pattern | Use case here |
|---|---|
| **Prompt chaining with a human checkpoint** | Anything prospect-facing: draft → validate against source data → **human review** → send. The dominant safe pattern across every credible source. |
| **Routing** | Triaging inbound signals — a job posting vs a liquidity event vs a direct inquiry — to different downstream handlers |
| **Orchestrator-workers** | Research tasks with unpredictable decomposition: "build me a dossier on this family office" |
| **Evaluator-optimizer** | Iteratively refining a drafted brief against a rubric before a human sees it, reducing review burden without removing it |
| **Event-driven triggers** | Signal detected → enrich → score → surface to the owner. No generation, no sending. |

**The recurring production lesson across every source** — SaaStr's 15–20 weekly tuning hours, Skadden's audit-trail guidance, Anthropic's emphasis on tool-documentation quality — is that **agent systems fail from insufficient guardrails and insufficient ongoing supervision, not from model capability limits.** No credible account describes a successful fully-autonomous system in this domain.

### 4.2 Data architecture

**No detailed public engineering retrospective of a VC firm building custom fundraising infrastructure was found** — a genuine gap in the literature. What's available:

**Entity resolution is the unglamorous but decisive layer.** Without deduplicating people and organizations across sources — a principal appearing under a personal name and a family-office entity, a fund LP appearing three ways — enrichment and relationship scoring degrade badly. The consensus technical approach is **probabilistic and graph-based matching, not LLM generation**, with LLMs used only for fuzzy edge cases ([Neo4j](https://neo4j.com/blog/graph-database/what-is-entity-resolution/); [Senzing](https://senzing.com/what-is-entity-resolution/)).

**Graph vs relational.** Multi-hop relationship queries — "who at the firm knows someone at this family office" — are natural in a graph model and awkward in pure relational schemas. This is why relationship CRMs increasingly expose graph-like traversal even over relational stores.

**Event sourcing.** Your existing instinct — an append-only event log with people as primary entities and backtest replay — is the right substrate, and it is the property that makes the learning loop in §6 possible. Nothing in the vendor landscape gives you this.

**Vector search over documents and notes** for data-room Q&A and DDQ libraries, constrained to a permissioned, versioned corpus.

### 4.3 The recommended architecture

```
┌─────────────────────────────────────────────────┐
│  INTERFACE — dashboards, briefs, queues         │
│  Coverage · Ask queue · Next actions · Briefs   │
└─────────────────────────────────────────────────┘
                      ▲
┌─────────────────────────────────────────────────┐
│  LOGIC (custom — this is what you build)        │
│  Scoring · Routing · Coordination · Compliance  │
│  gates · Forecasting · Learning loop            │
└─────────────────────────────────────────────────┘
                      ▲
┌─────────────────────────────────────────────────┐
│  CORE DATA (custom)                             │
│  Append-only event log · Entity resolution ·    │
│  Relationship graph · Vehicle/Exposure/Ask      │
└─────────────────────────────────────────────────┘
                      ▲
┌─────────────────────────────────────────────────┐
│  INGESTION (mostly bought)                      │
│  CRM API (Attio/Affinity) · Enrichment (Clay) · │
│  Filings (EDGAR/990) · Signals · Transcripts ·  │
│  Content engagement · SPV admin                 │
└─────────────────────────────────────────────────┘
```

**Build the middle two layers. Buy the bottom. Keep the top minimal** — most of what you need is three views, not a product.

### 4.4 The agents worth having

Five, each with a human gate:

1. **Research agent.** Given a name, produce a cited dossier: entity structure, decision-makers, capacity estimate, affinity evidence, recent signals, warm paths. Human reads before any meeting.
2. **Signal monitor.** Watches filings, job postings, liquidity events, 990-PF payouts, conference rosters against the universe. Surfaces to the relationship owner. Never sends anything.
3. **Brief generator.** Pre-meeting one-pager assembling everything known plus suggested topics and the specific ask.
4. **Answer librarian.** RAG over the approved-answer corpus for DDQs, grant proposals, and LP questions. Returns candidate text with provenance; human edits.
5. **Pipeline analyst.** Weekly: coverage ratio per vehicle, stage conversion, aging, ask-frequency violations, objection clusters, forecast vs target.

**Nothing in that list sends anything to anyone.** That is the design principle.

---

## 5. Metrics and velocity

### 5.1 The formula

The RevOps pipeline-velocity formula transfers directly, substituting opportunities for active LP conversations:

**Pipeline Velocity = (Qualified Opportunities × Average Commitment Size × Win Rate) ÷ Cycle Length** ([Outreach](https://www.outreach.ai/resources/blog/pipeline-velocity))

The value of writing it out is that it tells you which lever to pull. If you're behind on the $30M with 10 weeks left, the formula says your options are: more qualified conversations, larger average check, better conversion, or shorter cycle — and it makes obvious that **shortening cycle length is the only one you control directly in-quarter**, which is what a dated first close does.

### 5.2 What to instrument

| Metric | Why |
|---|---|
| **Coverage ratio per vehicle** | Leading indicator. Plan 3–4x in this market (Report 1, §5.2). RevOps guidance warns coverage ratios "lie" when padded with unqualified prospects ([VEN Studio](https://ven.studio/blog/pipeline-coverage-ratio-guide)) — so gate on qualification |
| **Stage conversion rates** | Where the funnel actually leaks |
| **Time-in-stage** | The most common hidden driver of missed targets even when volume and win rate look fine |
| **Touch-cadence adherence** | Whether the team is executing planned follow-up. Auditable automatically from calendar and email |
| **Connector performance** | Which intro paths convert (Report 6, §6) |
| **Asks per relationship per quarter** | The coordination constraint (Report 7, §5) |
| **Forecast accuracy** | Variance between forecast and actual |
| **Senior hours per dollar raised** | Your actual binding constraint, and almost nobody measures it |

That last one deserves emphasis. Report 2 established that senior FTE-hours are the scarce resource on the R&D side; the same is true of partner hours on the fund side. **If the system computes expected dollars per senior hour per opportunity and ranks by it, that single number changes prioritization more than any other feature.**

### 5.3 The weekly review

One page, six numbers, fifteen minutes:
1. Committed / soft-circled / weighted pipeline vs target, per vehicle
2. Coverage ratio and trend
3. Movements this week — stage advances and regressions
4. Aging items past threshold
5. Ask-frequency violations or pending conflicts
6. Top three objections this week

Anything more is reporting theatre. Anything less and you're running blind.

---

## 6. The learning loop

This is the part that justifies building rather than buying, and it depends entirely on the append-only event log.

With a complete event history across both domains you can eventually answer:
- Which **connector types and tie-strength bands** actually produced commitments (Report 6, §2)
- Which **sequencing** worked — fund-then-SPV vs the reverse
- Which **objections predicted a pass** versus which were noise
- What the real **lag from first touch to commitment** is, by channel and segment
- Whether **SPV participants actually convert to fund LPs** — a question the entire industry believes it knows and nobody has measured (Report 7, §2.2)
- Which **content pieces** appeared in the history of relationships that closed (Report 5, §5)

**None of this is answerable in year one.** All of it requires that you record faithfully starting now. That asymmetry — cheap to record, impossible to reconstruct — is the strongest argument for instrumenting during the EOY close even though the payoff is 2027 and beyond.

---

## 7. Privacy, compliance, failure modes

### 7.1 MNPI and cross-deal contamination

Skadden's 2026 alert is directly relevant: firms risk insider-trading exposure and enforcement not from an AI's intent but from **inadequate controls over what data a model can access**, and specifically flags **cross-deal contamination** — a shared knowledge base or RAG index ingesting multiple active matters can let a model infer confidential relationships across walled-off teams even when nobody intended it ([Skadden](https://www.skadden.com/insights/publications/2026/07/when-ai-models-access-nonpublic-information)). Recommended safeguards: data segregation, permission controls on model access, audit trails, and mandatory human review before any output influences a decision.

**This generalizes directly to LP data.** A shared enrichment and RAG layer touching both public prospect research and confidential LP financials is a genuine architectural hazard.

**The design response:** hard segregation between the **public research plane** (enrichment, filings, news, signals — models may touch freely) and the **confidential plane** (LP financials, subscription documents, side letters, portfolio company MNPI — permission-scoped, no general-purpose model access, audit-logged). Do not let the research agent query the confidential plane. Do not let the answer librarian index side letters alongside public thesis material.

### 7.2 Hallucination reaching a sent communication

No single authoritative incident report exists, but every credible source converges on the same mitigation: **never let generated content reach an external recipient without human review**, and **prefer retrieval-grounded, cited generation over open generation**, specifically because it gives the reviewer something verifiable to check rather than an unfalsifiable claim.

The concrete failure to avoid: a meeting-prep brief containing a fabricated detail about a prospect's background, which you then repeat in the meeting. This is not hypothetical — it is the most likely way AI embarrasses you in this workflow. **Mitigation: every factual claim in a generated brief carries a source link, and unsourced claims are visually flagged.**

### 7.3 General solicitation, again

Per §1.3 and Reports 4 and 5: scaled automated outreach without a pre-existing substantive relationship is the general-solicitation fact pattern. **Encode this as a hard gate in the system**, not as a policy people remember: no prospect reaches "contacted" status without documented pre-existing relationship or a confirmed delivered introduction.

### 7.4 Vendor and data residency

Standard SaaS vendor diligence — where data is processed and stored, whether it's used for model training, SOC 2 status. Verify against each vendor's DPA directly. Particularly relevant for meeting-transcription tools, which will hold recordings of confidential LP conversations.

---

## 8. The build plan

### 8.1 Next 14 weeks — four things, one week of work

Everything here is chosen for immediate operational value at minimal build cost.

1. **Master relationship table** (Report 7, §7.2). One record per relationship: owner, vehicles exposed, capacity/affinity/propensity, decision architecture, warm paths, relationship provenance for 506(b).
2. **Ask log.** Every ask: date, vehicle, asker, outcome. The single highest-value table you will build, because it solves the dominant multi-raise failure mode.
3. **Meeting capture.** A transcription tool with a proper DPA, notes flowing into the relationship record. Immediately reduces context loss across a team running four raises.
4. **Warm-path map.** The existing-relationship census with paths to every Tier 1 and Tier 2 prospect, connector goodwill scored from memory (Report 6, §8.1).

**Plus one thing that costs almost nothing and pays for years: start recording first-touch and source on every relationship, from today.**

**Explicitly do not build now:** custom scoring engines, agent frameworks, graph databases, enrichment pipelines, or anything requiring an engineering hire. During a 14-week close, build velocity is stolen from raise velocity.

### 8.2 Q1 2027 — the real build

- Event-sourced core with entity resolution
- Relationship graph with structural signals, ingesting from Attio or Affinity's API
- Scoring engine — capacity/affinity/propensity/time-to-decision, explainable, with decay
- Multi-vehicle model: Vehicle, Exposure, Ask, with the coordination gates
- Signal monitors: EDGAR, Form D, job postings, 990-PF, liquidity events
- Research and brief agents with human gates
- Answer librarian over the approved-answer corpus
- Compliance gates encoded

### 8.3 Q2–Q3 2027 — the differentiating layer

- The learning loop: backtest replay over the accumulated event log
- Objection ontology with clustering
- Grant pipeline integrated at the relationship layer while staying separate at the ask layer
- Connector performance modelling feeding path-quality scoring
- Content engagement joined to relationship history

### 8.4 The honest constraint

Everything in §8.2 and §8.3 is a real engineering project — call it two to three engineer-quarters for a credible v1, more if the entity resolution is done properly. The question worth answering before starting is whether this is **infrastructure for PL** or **a product**. The research in these reports says the gap is real and nothing on the market fills it, which is an argument for the latter. But building a product during a fund raise is how both things end up half-done. **Build it as internal infrastructure through 2027, and let the product question answer itself once it demonstrably works on your own raise.**

---

## 9. Consolidated system specification

Pulling together all eight reports.

**Core entities**
`FunderFamily` → `LegalEntity` → `Person` · `Vehicle` · `Exposure` · `Ask` · `Interaction` · `Connector` · `IntroRequest` · `ContentArtifact` · `Signal` · `Objection` · `Commitment`

**Core properties**
- Append-only, replayable event log
- Time-bounded edges (relationships sequence, they don't just exist)
- People primary, not institutions
- Entity resolution across all sources
- Explainable scores with evidence links and refresh timestamps

**Gates (enforced, not advisory)**
- 506(b) outreach gate — provenance or confirmed intro required
- Ask-frequency guard per relationship per quarter
- Beneficial-owner count warnings per vehicle
- Confidential/public data-plane segregation
- Human review before any external send
- Content tier check before publication

**The seven metrics**
1. Coverage ratio per vehicle and aggregate
2. Pipeline velocity
3. Asks per relationship per quarter
4. Connector conversion and goodwill balance
5. Senior hours per dollar raised
6. Median lag, first touch to commitment
7. Forecast accuracy

**The five agents, none of which send anything**
Research · Signal monitor · Brief generator · Answer librarian · Pipeline analyst

**The learning loop**
Backtest replay over the event log, answering which sequencing, connectors, content, and framings actually produced capital — the question no vendor tool can answer because none of them hold the whole graph.

---

## Sources

- [Anthropic — Building Effective Agents](https://www.anthropic.com/research/building-effective-agents)
- [TechCrunch — 11x has been claiming customers it doesn't have](https://techcrunch.com/2025/03/24/a16z-and-benchmark-backed-11x-has-been-claiming-customers-it-doesnt-have)
- [SaaStr — 6 Months of AI SDRs: What's Worked](https://www.saastr.com/6-months-of-ai-sdrs-whats-worked)
- [Wikipedia — Artisan AI](https://en.wikipedia.org/wiki/Artisan_AI) · [Complete AI Training — Artisan backlash](https://completeaitraining.com/news/from-stop-hiring-humans-to-linkedin-bans-artisan-ais-viral/)
- [ORRJO — AI SDRs Aren't Working](https://orrjo.com/ai-sdrs-not-working-what-to-do-instead)
- [Fuzzy AI — Cold Email Deliverability and AI Volume](https://getfuzzy.ai/blog/cold-email-deliverability-ai-volume)
- [Skadden — When AI Models Access Nonpublic Information](https://www.skadden.com/insights/publications/2026/07/when-ai-models-access-nonpublic-information)
- [TheCorporateCounsel.net — Avoiding General Solicitation Problems](https://www.thecorporatecounsel.net/blog/2024/10/a-perennial-concern-for-vc-fundraising-avoiding-general-solicitation-problems.html)
- [SEC — Private Placements, Rule 506(b)](https://www.sec.gov/resources-small-businesses/exempt-offerings/private-placements-rule-506b)
- [Gong Labs — We Measured the ROI of AI in Sales](https://www.gong.io/blog/we-measured-the-roi-of-ai-in-sales-heres-how-it-really-impacts-your-deals)
- [Instrumentl — Best AI for Grant Writing](https://www.instrumentl.com/blog/best-ai-for-grant-writing)
- [Coldreach — Claygent Review](https://coldreach.ai/blog/claygent-review) · [Miniloop — Clay Enrichment Review](https://www.miniloop.ai/blog/evaluate-the-data-enrichment-company-clay-on-ai-gtm)
- [Affinity — New CRM Features: AI, API, Introductions Reporting](https://www.affinity.co/blog/new-affinity-crm-features-ai-an-enhanced-api-and-introductions-reporting) · [Affinity PE adoption release (vendor)](https://www.globenewswire.com/news-release/2026/06/23/3316054/0/en/affinity-sees-surge-in-private-equity-adoption-as-firms-embrace-ai-powered-relationship-intelligence.html)
- [ValueAddVC — Affinity CRM Honest Review](https://valueaddvc.com/blog/affinity-crm-for-venture-capital-a-founder-and-vcs-honest-review)
- [Dench — Attio AI Features](https://www.dench.com/blog/attio-ai-features) · [Attio Changelog 2026](https://attio.com/changelog/2026)
- [PipelineRoad — Harmonic.ai Pricing](https://pipelineroad.com/compare/pipelineroad-vs-harmonic)
- [Common Room — Signals](https://www.commonroom.io/product/signals/)
- [Sid Saladi — AI-Powered Investor Research with Perplexity](https://sidsaladi.substack.com/p/ai-powered-investor-research-101)
- [itsconvo — Granola vs Otter vs Fathom](https://www.itsconvo.com/blog/granola-vs-otter-vs-fathom)
- [Tribble — One Knowledge Base for RFPs, DDQs, Security Questionnaires](https://tribble.ai/blog/how-to-build-one-knowledge-base-for-rfps-ddqs-and-security-questionnaires/)
- [Neo4j — What is Entity Resolution](https://neo4j.com/blog/graph-database/what-is-entity-resolution/) · [Senzing](https://senzing.com/what-is-entity-resolution/) · [PuppyGraph](https://www.puppygraph.com/blog/entity-resolution)
- [4Degrees — Venture Capital CRM: The Complete Guide](https://www.4degrees.ai/blog/venture-capital-crm-the-complete-guide)
- [Outreach — Pipeline Velocity](https://www.outreach.ai/resources/blog/pipeline-velocity) · [VEN Studio — Pipeline Coverage Ratio](https://ven.studio/blog/pipeline-coverage-ratio-guide)
- [Futurum — Salesforce Q4 FY2026, Agentforce scaling](https://futurumgroup.com/insights/salesforce-q4-fy-2026-earnings-show-agentic-ai-scaling-guidance-steadies/)
