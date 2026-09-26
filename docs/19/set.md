# 19 — The workflow set

Archive of the design and history through N85. Current rules are in
`docs/workflows/*.md` and AGENTS.md; read only the protocol assigned to the job.

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
