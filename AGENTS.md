# Capital OS

Fundraising strategy and operations for PLC Neurotech I, PLC Crypto/Rails, the SPVs, and
the grants rail. Built to be run locally first, by one person, before any service is
deployed and before any external system is connected.

**Read `docs/13-synthesis-r3.md` first.** It is the current plan and supersedes docs 10–12.
`docs/09-system-architecture.md` is the underlying design. Docs 01–08 are the research the
design rests on; consult them when a domain question comes up, don't read them all upfront.

The design boards in `design/` are the visual spec. `S1`, `S2` and `S3` are the current
direction; open `design/index.html` in a browser. Everything else there is earlier
exploration — do not treat it as a requirement.

---

## The situation this serves

~$60M committed to PLC Neurotech, ~$30M to PLC Crypto/Rails. Goal: ~$30M more before EOY
for the Neurotech first close, plus 3+ SPVs closed. All vehicles are 506(c). Four
concurrent raises chase an overlapping LP universe, which is where most of the hard design
problems come from.

Seven-plus people plus their agents will eventually use this. Right now, one person does.

---

## Read only what the task needs

These linked rules are mandatory when their scope applies. They preserve the detailed
rules and examples formerly in this file; moving them does not relax any rule.

| Before working on… | Read |
| --- | --- |
| Real records, previews, research, Affinity, Polaris, secrets or migrations | [Real data](docs/agent-rules/real-data.md) |
| Domain behavior, claims, routes, approvals, capital or workflow outputs | [Domain rules](docs/agent-rules/domain.md) |
| UI, copy, state handling, themes or screenshots | [Frontend contract](docs/agent-rules/frontend.md) |
| Dependencies, configuration, schema, build stages or an unresolved integration | [Development details](docs/agent-rules/development.md) |
| Issues, delegation, workflow runs, context budgets or changelog shots | [Working practices](docs/agent-rules/operations.md) |
| Worktrees, branches, servers or workflow launch/finish recording | [Collaboration](docs/COLLAB.md) |

For history, open the relevant version from [the changelog index](docs/changelog/index.md).
For enrichment, read only the assigned `docs/workflows/*.md` protocol and its named inputs;
[docs/19](docs/19-enrichment-workflows.md) is an index of design and history, not a run prerequisite.
Each agent definition names its own read set. Do not read every linked detail file upfront.

## Always-on data boundaries

- Real data stays under `data/real/` / shared `plcos-data/real`, never in git, published
  artifacts, screenshots, issues, searches or sub-agent prompts. The narrowly permitted
  public-name research exception is in [Real data](docs/agent-rules/real-data.md).
- No training on this project's data, for anyone.
- Affinity and Polaris are read-only. Only the live server writes the real database.
- Demo reset/seed/screenshot commands must refuse real data. Applied migrations are immutable.
- Never print or store the Affinity key; only `lib/connectors/affinity/` talks to Affinity.

## Stack — settled, do not relitigate

- **TypeScript**, **Next.js** with SSR. No separate API service.
- **Postgres**. **PGlite** for local dev — real Postgres semantics, zero services.
  Not SQLite: we need `jsonb`, `CREATE SCHEMA`, `gen_random_uuid()`, strict types,
  `ILIKE`, arrays and real upsert syntax.
- **Modular monolith**, schema-per-module.
- **Two data planes** — research and confidential — separated by **grants and schema
  separation, not RLS**.
- Durable workflow engine (Trigger.dev or Inngest Cloud) — deferred until D-series.
- Langfuse for agent observability, Splink for entity resolution — both deferred.
- Dev loop: GitHub Actions + Claude Code Action — deferred until D2.

## Domain invariants

The [full domain rules](docs/agent-rules/domain.md) define the evidence and exceptions.

1. Hard-only headline; soft stays separate. Never blend AUM across vehicles.
2. Six explicit, evidenced consent rungs; pipeline status is separate.
3. SEND, INTRO_ASK, MONEY, STAGE and ALLOCATION_EXCEPTION fail closed without a bounded, approved, unexpired ticket.
4. Agent success, task acceptance, investor approval, legal close and cash receipt are separate states.
5. Coordinate vehicle overlaps; record collisions and a dated follow-up for the loser.
6. Model A–D ties as uncertainty, never gate information on a person. PL affiliation is strong evidence.
7. Every search discloses corpus and dates; unsupported is not nonexistent.
8. Restrictions attach to the target; never circumvent them with another connector.
9. Every external claim has `source, as_of, confidence, last_verified_by`, or is refused.
10. Code conserves the capital pool; exclude unverified grant budgets.
11. Check Vehicle × Instrument material scope at send time; wrong-wrap sends = 0.
12. Grants outreach requires a funder invitation.

## Agent rules

- Every run gets a **work envelope**:
  `{task, scope, allowed_evidence, allowed_commands, budget, deadline, output_schema,
  acceptance_criteria, escalation_owner}`. A policy check validates each tool call against
  it. **Delegation cannot increase permission** — a child task gets the same or narrower
  scope.
- **No tool sends anything, and no tool accepts its own proposed task.** Drafts and
  proposals only; a human accepts. Acceptance uses a stable idempotency key so a double
  click cannot create duplicates.
- **Run records pin resolved config and input hashes.** Editing a prompt must not
  retroactively change what a completed run meant.
- Prompt changes run against a **protected set of example cases** before landing. The agent
  cannot modify its own pass criteria or runtime permissions to win. Add real failures to
  the set continuously — a fixed set overfits.
- **Circuit breaker:** if correction burden exceeds `config.agents.correctionBudgetHoursPerWeek`,
  freeze new agent autonomy.
- Putting a tool name in a prompt does not enable it. The server controls which tools exist.

---

## Do not build

Half of what went wrong in the alternate designs was building the wrong layer first.

- **No connectors before L13.** No Linear, no Drive, no DocSend. Everything else runs on
  seed data and fixtures until the product shape is proven. **Exception, decided
  22 Sep 2026:** Affinity, read-only, from N38 (`docs/15`). Writes to Affinity are still
  prohibited.
- **No auth integration.** Local user switcher only. LabOS comes later.
- **No graph database.** Recursive CTEs in Postgres handle two- and three-hop enumeration
  at this scale.
- **No vector database, no event broker, no service mesh, no microfrontends, no plugin
  framework, no warehouse pipeline.**
- **No module registry or event-subscription contract yet.** A module may begin as a
  playbook plus an output format; a dedicated screen is a later optimization, not a
  prerequisite. Modules 02, 06, 12, 13, 17 and 23 start without screens.
- **No full event sourcing.** Append-only audit log plus a transactional outbox, which is
  different and sufficient.
- **Do not claim durable orchestration that has not been built.**

## Promotion rule for schema

A `note` table holds anything not yet worth a migration. Promote a concept into real
columns when — and only when — users repeatedly need to filter it, a mistake recurs, a tool
needs a precise input, or performance becomes a demonstrated problem.

---

## Working discipline

Claude integrates; work on your assigned branch and leave other builders' files alone.
One session per workstream. Delegate screenshots, visual checks, trial-and-error and code
search to scoped agents as specified in [Working practices](docs/agent-rules/operations.md).
Keep workflow inputs and rules fixed during a pass. Never dump long output into context.
Use plain, specific prose, label guessed constants, and push back when the plan is wrong.
Changelog entries and screenshot links go in `docs/changelog/entries/<version>.md`; register
the entry in [the index](docs/changelog/index.md).
