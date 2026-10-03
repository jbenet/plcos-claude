# Real data and external services

Rules moved from AGENTS.md. Read this file when its scope applies; all rules still hold.

## Real data — read before touching `data/real/`

Two data profiles since N38 (`docs/15-affinity-integration.md`). `npm run dev` serves
**demo**: fictional, safe to reset, screenshot and publish. `npm run dev:real` serves **real**: the
Affinity replica and everything written about it, reachable from the local network since 24 Sep 2026
(Juan: a small private network). There is no sign-in, so anyone on that network can read and change
it. `DATA_PROFILE` picks one, in `config/deployment.ts`. Each server's port comes from this folder's
row in `.ports.json` (docs/COLLAB.md). Only the live folder serves the real data; a dev worktree serves
a copy of it with `npm run preview`, and a sub-agent's worktree, which has no row, starts its demo with
`PORT` from 3110–3119 (Claude's) or 3210–3219 (ChatGPT's).

- Everything real lives under `data/real/`, which git ignores. None of it goes into a commit,
  the changelog, a screenshot, the published build log, `issues/`, a web search or a
  sub-agent prompt. Changelog entries about real-data work use counts and invented examples.
  Juan is fine with the agent doing the work — Claude, or ChatGPT (OpenAI's coding agent, also
  called Codex) — reading real records while working; that is the only exception.
- **No training on this data, for anyone** (Juan, 25 Sep 2026: "training should be off on this
  data/project for everyone"). Every agent works under an account with model training turned off:
  Anthropic's for Claude, OpenAI's for ChatGPT. Never send this project's data to a service or account
  that trains on what it is given.
- **Enrichment research (N64, docs/19), decided 24 Sep 2026.** Juan: "Feel free to use the
  internet to find useful publicly available information… (dont sign up for paid services or
  write any info into the world, only read!)". So a search may carry an LP's name with their
  organization, title, location and topic words, to read public pages. It never carries a status,
  an amount from our records, a note, a list name, or the fact that they are in this pipeline. A
  public amount read on a public page (a published round size, a grant, a fund size) may be searched
  (Juan, 27 Sep 2026: "Yeah that's fine"). A local sub-agent may
  read a research batch under `data/real/enrich/` and write its findings back there; its prompt
  still carries no real data, and it never runs remotely. No sign-ins, no paid services, no
  contact-data brokers, nothing posted. Findings land in files first and are mapped in by an import.
  A request carries no identity of ours: no email, name or product name in any header — a
  User-Agent included (docs/19, W1 1.36). Where a service requires a contact address (SEC's
  fair-access policy asks for one in the User-Agent), use `blue.tunguska@agentmail.to` — Juan's
  privacy-preserving address, 24 Sep 2026 — and nothing else; a service that wants more identity
  than that is asked about first. Government sites are read sparingly and by their own rules: SEC
  at most one request a second (its limit is ten), no bursts or loops over names, and a 403, 429
  or 503 means stop and come back later (W1 1.48). Juan's own address is never used in a request.
- **Affinity is read-only.** The key can write and cannot be scoped, so read-only is
  enforced in the client: GET only, allowlisted paths, a property test that a write throws.
  Writing back is a later decision, and would go through approval tickets.
- **Dakota Marketplace is read-only, and its data never leaves our system (27 Sep 2026, docs/20-dakota.md).**
  Juan: "they are very touchy about their data, so make sure dakota data does not leave our system and
  get accidentally placed anywhere else. should just go into our db." So Dakota records live only in
  `plcos-data/real/dakota/` (the raw replica) and our database (the PL warehouse also holds some, read-only
  for us). Never in git, a changelog, an issue, a screenshot, an artifact, a published page, a web search,
  a prompt to any agent, or any file outside those two places; a report about Dakota work gives counts.
  Only `lib/connectors/dakota/` talks to Dakota (`npm run boundaries`), only a workflow runs it
  (`scripts/dakota-sync.ts`, recorded in the ledger), and only reads: sign-in, list and count, nothing
  else leaves the client. Read in bulk to keep the query count down, one request a second, within any
  limit Dakota documents, and stop on a 429. Ask only for the fields in `fields.json` "needed", and after
  the first pull only records changed since the last. Use it to enrich existing LPs and to source new
  candidate LPs. **Searching by name is fine (Juan, 27 Sep):** "Names, entities, etc are fine. a ton of
  this is public knowledge anyway — we can use all the info to search and think about things ourselves."
  So a web search may carry a Dakota-sourced person's or organisation's name with the usual public words
  (organisation, title, location, topic), under the enrichment rules below, and agents may read and reason
  over Dakota-derived records locally. What never goes out: the private or aggregated information only
  Dakota would hold (AUM and asset figures, ticket and check sizes, allocations, contact emails and phones,
  notes and commentary, consultant relationships, search activity) in any query, request or outside
  service, and never a batch or export of Dakota records to anyone. Code that maps it is built and tested
  on invented fixtures from the public schema, never
  by an agent reading the raw files; the mapping runs on the live server. The sign-in is two Keychain
  items (`npm run dakota:store`), read by `scripts/with-dakota-key.sh`.
  The feedback box stays open on the real server: an issue and its screenshots live in
  `plcos-data/real/issues`, inside our system, like every other real record (decided 27 Sep, when a
  branch tried to refuse all feedback once Dakota data was in the database).
- **Gmail is drafts only, per user (2 Oct 2026, docs/25-email-drafts.md).** No Gmail scope makes drafts
  without allowing sends, so the client in `lib/connectors/gmail/` enforces it: an allowlist of the draft and
  header-only endpoints, no send method, properties that prove both. Each person's refresh token is one
  Keychain item (`plcos-gmail` / their handle); the OAuth client is two (`npm run secret:store -- google-oauth-client-id`
  and `…-secret`), handed to the live server by `scripts/with-google-oauth.sh`. Real Google is off until
  `config.email.gmail.enabled`; the demo and the properties use the fake Google only. A move puts the draft's
  words in the mover's own mailbox; the audit entry keeps counts, never words or addresses.
- **Linear is read-only (27 Sep 2026, docs/24-linear.md).** Juan overrode "no connectors before L13"
  for it, as for Affinity. The personal key can write and cannot be scoped, so read-only is enforced in
  the client: only allowlisted GraphQL queries, each text checked for a mutation before sending, and
  properties that prove it. Only `lib/connectors/linear/` names its host or the key's variable
  (`npm run boundaries`). The key is one Keychain item (`plcos-linear` / `api-key`, `npm run
  linear:store`), handed to the live server by `scripts/with-linear-key.sh`; never printed, never in a
  file, never in a preview's or the demo's environment. The replica lives in `plcos-data/real/linear/`
  and the `linear` schema; only the live server syncs it, from Developer → Linear. Treat its content
  like Affinity's: counts in reports, nothing in git, screenshots, issues or prompts. Writes wait for
  Juan's approval of docs/24 §5 and go through approval tickets.
- **PL Polaris, the PL Data Warehouse, is read-only too (26 Sep 2026).** Juan gave Claude and ChatGPT
  access to BigQuery project `plrs-data-platform` through Google's MCP Toolbox, run locally and
  registered as `pl-polaris` by `npm run polaris:connect`. It signs in with Juan's gcloud
  application-default credentials; the Toolbox blocks writes and caps each query's bytes billed. Queries
  are `SELECT` only regardless: never DML, DDL, exports or scheduled queries. What comes back is real data
  under Affinity's rules: it stays in `plcos-data/real`, never in a commit, a doc, a prompt to a sub-agent
  or a search. BigQuery bills by bytes scanned, so read table schemas first, select only the columns
  needed, filter, and `LIMIT`; aggregate in SQL rather than pulling rows. A result holding exactly the
  row cap (10,000) may have been cut off: say so to Juan, and page with `ORDER BY` and `OFFSET` when
  every row is needed. Founders and PL team members registered there count as one hop from our
  team (Juan, 26 Sep).
- Affinity fields are claims, not evidence. A stage is not a ladder rung. An amount is soft
  unless a field has been designated as meaning signed. Relationship strength is a tier-C
  edge.
- Seeding, `db:reset`, `npm run demo` and `npm run shots` refuse the real profile. Keep it
  that way. Writes to the real database happen inside the real server's process.
- **Migrations are append-only from N38.** The real database cannot be reset, and the
  migration runner refuses a file whose checksum changed after it was applied. So an applied
  migration is never edited; a change is a new `NNN_…sql` file in the same module.
- Only `lib/connectors/affinity/` talks to Affinity (`npm run boundaries` enforces it). The
  key lives in one macOS Keychain item (`npm run key:store`), trusted to no app, so each read
  asks Juan; `scripts/with-affinity-key.sh` hands it to `dev:real`'s environment. Never
  printed, never in a file. Not 1Password: its CLI authorizes a whole account, not one item.
  Deployment will need its own secret store.

---
