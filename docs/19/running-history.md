# 19 — Historical launch instructions

Archive of the design and history through N85. Current rules are in
`docs/workflows/*.md` and AGENTS.md; read only the protocol assigned to the job.

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
