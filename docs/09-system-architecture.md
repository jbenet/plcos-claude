# Capital OS — System Architecture

**A buildable design for the fundraising operating system: three candidate architectures, a synthesis, and a phased path to production.**

*Prepared 19 September 2026. Integration facts are sourced from vendor developer documentation and dated; several are load-bearing and are flagged as such. Nothing here is legal advice.*

---

## 0. The six facts that actually constrain this design

Most architecture documents open with goals. This one opens with constraints, because six findings from the integration research eliminate whole branches of the design space before any preference gets a vote.

**0.1 — Affinity has no interaction webhooks, and its webhooks are unsigned.**
There is no `email.*`, `meeting.*` or `call.*` event. The only interaction-adjacent signal is `smart_interaction_value.updated`, which fires when a derived smart field changes — a pointer that something happened, not the record. Worse, the webhook object schema carries no signing secret and the docs document no HMAC header ([Affinity webhooks](https://developer.affinity.co/api-reference/2026-07-15/webhooks/create-a-webhook.md)).
**Consequence:** Affinity webhooks are cache-invalidation hints, never a source of truth. Every payload triggers an authenticated read; no payload content is ever written to our store. The receiver needs an unguessable path segment and IP allowlisting because we cannot verify signatures.

**0.2 — Affinity's monthly API cap, not its per-minute limit, is the binding constraint.**
900 req/user/minute is generous. **100,000 requests/month** on Scale and Advanced is not — roughly 3,300 calls/day, shared across v1 and v2 ([rate limits](https://developer.affinity.co/pages/external-api-v2/rate-limits)).
**Consequence:** a naive polling sync burns the monthly budget on reconciliation alone.

**0.3 — Affinity Data Share is the escape hatch, and it reshapes the whole architecture.**
On **Advanced and Enterprise**, Affinity publishes Snowflake secure views and Databricks Delta Sharing, refreshed **every 2 hours by an incremental pipeline**, with tables including `emails`, `calls`, `meetings`, `chat_messages`, `notes`, `transcripts` and **`relationship_strengths`** — consuming **zero API quota** ([Data Share](https://developer.affinity.co/pages/data-share/overview)).
**Consequence:** if PL is on Advanced or above, the full interaction corpus arrives in the warehouse for free, and the warehouse becomes a first-class part of the ingestion path rather than a downstream analytics afterthought. **This is the single most important open question in the document — §10.1.**

**0.4 — DocSend has no public API.**
No developer portal, no reference, and DocSend appears nowhere on the [Dropbox developer platform](https://www.dropbox.com/developers). The only supported programmatic surface is **Zapier**, with forward-only triggers (new visit, new link, visitor engagement summary, new signed document, Space events) ([Dropbox help](https://help.dropbox.com/integrations/dropbox-docsend-zapier-integration)).
**Consequence:** DocSend engagement is a degraded-mode integration — Zapier posting to our webhook endpoint, no backfill, no delivery guarantees, no signature. Any module that treats DocSend data as complete is wrong. Historical data before the Zap exists can only arrive by manual CSV.

**0.5 — Google Drive push channels expire and never auto-renew.**
Max TTL is **1 day for `files` resources, 1 week for `changes`**; default 3,600 s. Verification is token-matching only, not a signature ([push notifications](https://developers.google.com/workspace/drive/api/guides/push)).
**Consequence:** a channel-renewal scheduler is mandatory infrastructure, not a nice-to-have. It is the first thing that will silently break, and it will break on a weekend.

**0.6 — Don't self-host Temporal, and don't do full event sourcing.**
Self-hosted Temporal means operating Frontend, History, Matching and Worker services plus a database and shards — not viable for 2–3 engineers. And the event-sourcing critiques come from the people who invented the patterns: Udi Dahan's "most people using CQRS (and Event Sourcing too) shouldn't have done so," with his recommended substitute being "simple logging: implement audit trails through basic interception" ([Dahan](https://udidahan.com/2011/04/22/when-to-avoid-cqrs/)); Fowler names the same middle path ([Fowler](https://martinfowler.com/eaaDev/EventSourcing.html)).
**Consequence:** mutable relational state **plus** a transactional append-only audit log, written in the same transaction. Replayability without the ceremony. And a managed workflow engine.

Two secondary constraints worth recording:

- **Sydecar and AngelList are gated unknowns.** Both have developer portals behind authentication (Sydecar returns 401; AngelList redirects to login and instructs you to email `portal@angellist.com`). **Do not design around SPV/subscription API sync.** Start those access conversations now; treat as CSV-mediated until docs are in hand.
- **Linear is the well-behaved one.** GraphQL, OAuth with `actor=app`, signed webhooks (`Linear-Signature`, HMAC-SHA256, with `webhookTimestamp` replay protection), 5,000 req/hr on OAuth ([Linear webhooks](https://linear.app/developers/webhooks), [rate limiting](https://linear.app/developers/rate-limiting)). One caveat flagged as unverified: **no user-defined custom-field mechanism** appears in Linear's API docs. If per-issue structured attributes are load-bearing, verify against the live schema before committing — Linear models extensibility through labels, projects and initiatives instead.

---

## 1. Three candidate architectures

### 1.1 Architecture A — Warehouse-Native

The PL warehouse is the spine. Affinity Data Share, external databases, filings and signals all land as raw tables. dbt models do entity resolution, scoring and derivation. The application is a thin read layer over warehouse views, with a small operational Postgres holding only mutable app state (asks, ownership, task status).

```
sources ──► warehouse (raw → staging → marts, dbt)
                 │
                 ├──► reverse-ETL ──► small operational Postgres ──► app
                 └──► BI / analysis
```

**Why it's attractive.** Data Share lands natively. Analysts work in SQL they already know. Entity resolution and scoring are batch problems that dbt models well, with lineage and tests for free. PL presumably already operates the warehouse, so there's no new infrastructure.

**Why it fails.** Warehouse latency is minutes-to-hours, and half the modules need sub-second interactive reads and transactional writes. The ask-frequency guard (Report 7) must be a *synchronous check inside the write path* — "can Maya send this ask right now?" — and cannot be a batch-computed attribute that is two hours stale, because the failure mode it prevents is two people asking the same relationship in the same afternoon. Reverse ETL adds an extra hop and another system to operate. And the warehouse is a shared PL resource: a schema change in someone else's model can break your app.

**Verdict:** right for the derivation plane, wrong as the system of record.

### 1.2 Architecture B — Operational Core

A modular monolith on its own Postgres is the system of record. Connectors ingest into landing tables; normalizers map to core entities; derivations run in-process or as scheduled jobs. The warehouse sits downstream for analytics and for heavy batch work, fed by logical replication or a scheduled extract.

```
sources ──► connectors ──► landing ──► core Postgres ──► app
                                           │
                                           ├──► agent runtime
                                           └──► warehouse (analytics, heavy batch)
```

**Why it's attractive.** Transactional integrity where it matters. Sub-second reads. Schema-per-module gives real boundaries at near-zero cost — Shopify's approach, where cross-module access fails rather than being frowned upon ([Shopify Engineering](https://shopify.engineering/deconstructing-monolith-designing-software-maximizes-developer-productivity)). Fowler's *MonolithFirst* argument applies directly: with 2–3 engineers there are no team boundaries for services to mirror ([Fowler](https://martinfowler.com/bliki/MonolithFirst.html)).

**Why it struggles.** Data Share arrives in the *warehouse*, not in Postgres, so the richest interaction data has to travel backwards. Entity resolution over a large corpus is awkward in-process. And "modular monolith" degrades into "monolith" without enforcement discipline.

**Verdict:** right for the operational plane, incomplete on ingestion.

### 1.3 Architecture C — Service Mesh + Event Bus

Each bounded context is a deployable service. A durable event bus (Kafka, Redpanda, or a managed equivalent) carries domain events. Services own their stores. Agents are services subscribing to topics.

**Why it's attractive.** Genuine compartmentalization. Independent scaling for the agent fleet. Clean replay semantics on the bus.

**Why it fails here.** It buys deploy-independence, and with 2–3 engineers there is nobody to be independent from. It multiplies operational surface at exactly the moment the team's scarce resource is attention. Fowler again: "even experienced architects working in familiar domains have great difficulty getting boundaries right at the beginning" — and we have never run this process, so our boundaries are guesses. Cross-service refactors during a 14-week close would be fatal.

**Verdict:** a destination some modules may reach, never a starting point.

### 1.4 What the comparison actually reveals

The three architectures disagree about *where the system of record lives*, and that turns out to be the wrong question. The right question is **which plane owns which class of data**:

| Data class | Latency need | Write pattern | Correct home |
|---|---|---|---|
| Asks, ownership, stage transitions, approvals | sub-second | transactional | Operational Postgres |
| Interaction corpus (emails, meetings, calls) | hours | append-only bulk | Warehouse (via Data Share) |
| Entity resolution clusters | hours, stable IDs | batch + human override | Warehouse compute → Postgres canon |
| Scores | minutes-to-hours | derived, recomputed | Warehouse compute → Postgres cache |
| Agent outputs (dossiers, briefs, drafts) | seconds | append-only | Operational Postgres |
| Content engagement, signals | minutes | append-only | Landing → Postgres |

Two planes, with a defined contract between them. That is the synthesis.

---

## 2. The recommended architecture

### 2.1 Name and shape

**Two planes, one canon, modular core.**

- The **operational plane** (Postgres + modular monolith) is the system of record for anything a human decides or an agent writes, and the only thing the app reads at request time.
- The **derivation plane** (PL warehouse) is where the interaction corpus lands, where entity resolution and scoring are computed, and where analysis happens.
- **Canon** is the contract between them: a small set of tables in Postgres that the derivation plane writes to and the operational plane treats as read-only inputs.

```
┌──────────────── SOURCES ────────────────────────────────────────┐
│ Affinity · Linear · Drive/Docs · DocSend(Zapier) · Fireflies     │
│ EDGAR · IRS 990-PF · job boards · FO databases · news · SPV admin│
└──────┬──────────────────────────────┬────────────────────────────┘
       │ API / webhook / poll          │ Data Share (2h, no quota)
       ▼                               ▼
┌─────────────────────┐        ┌──────────────────────────────────┐
│ CONNECTOR RUNTIME   │        │ DERIVATION PLANE — PL warehouse  │
│ backfill/poll/hook  │───────►│ raw → staging → marts (dbt)      │
│ → landing (raw JSON)│        │ entity resolution (Splink)       │
└──────────┬──────────┘        │ scoring · path index · analytics │
           │ normalize         └────────────┬─────────────────────┘
           ▼                                │ canon push (scheduled)
┌──────────────────────────────────────────▼─────────────────────┐
│ OPERATIONAL PLANE — Postgres, schema per module                 │
│  identity · intel · scoring · pipeline · coordination · network │
│  content · compliance · grants · workbench · platform           │
│  + audit log (append-only, transactional)                       │
└───┬───────────────────────┬──────────────────────┬──────────────┘
    │                       │                      │
    ▼                       ▼                      ▼
┌─────────┐       ┌──────────────────┐    ┌──────────────────┐
│  APP    │       │ WORKFLOW ENGINE  │    │  AGENT RUNTIME   │
│ (SSR)   │       │ durable, human-  │    │ research plane   │
│         │       │ in-the-loop      │    │ only · budgeted  │
└─────────┘       └──────────────────┘    └──────────────────┘
       │                   │                      │
       └───────────────────┴──────────────────────┘
                           │ writes to
                  Linear · Drive · Slack
```

### 2.2 The six architectural commitments

1. **Postgres is the operational system of record.** Mutable relational state, not event-sourced.
2. **An append-only audit log is written in the same transaction as every state change.** Transactional outbox pattern, used for auditability first and messaging second ([microservices.io](https://microservices.io/patterns/data/transactional-outbox.html)). This is what makes the learning loop (Module 19) possible without the cost of full ES.
3. **Schema per module, with a dedicated DB role per module granted only its own schema.** Cross-module table joins *fail* rather than being discouraged. This is the highest-value, lowest-effort boundary available, and it doubles as the seam along which a module could later be extracted.
4. **The warehouse computes; Postgres serves.** Anything expensive, batch-shaped, or requiring the full interaction corpus runs in the derivation plane and lands in canon.
5. **Two data planes for agents, separated by grants — not by row-level security policies.** See §5.4. RLS is a filter; grants and schema separation are a wall. Agents get the wall.
6. **Managed durable workflow engine for anything that waits on a human.** Not cron, not a queue with retries hand-rolled.

### 2.3 Technology choices, with reasoning

| Layer | Choice | Why | Alternative considered |
|---|---|---|---|
| Language | TypeScript | Linear, Attio, Trigger.dev, Inngest SDKs are TS-first; one language across app, connectors and agent tooling | Python (better for Splink/ER — resolved by running ER in the warehouse instead) |
| Operational DB | Postgres 16+ | RLS, JSONB, logical replication, schema isolation | — |
| App | Next.js (SSR) | Server-side reads keep the DB connection off the client; the UI is dense and read-heavy | — |
| Workflow engine | **Trigger.dev Cloud** or **Inngest Cloud** | TS-native, `wait.forToken()` / `waitForEvent` map directly onto human approval gates; waits >5s don't bill compute on Trigger.dev ([wait docs](https://trigger.dev/docs/wait)) | Temporal Cloud if polyglot workers are ever needed; **not** self-hosted Temporal |
| Derivation | PL warehouse + dbt | Data Share lands there; dbt gives lineage and tests | Standalone DuckDB if PL warehouse access is blocked |
| Entity resolution | **Splink** (Fellegi–Sunter) + deterministic pre-pass | Open source, well-documented theory, runs in the warehouse ([Splink](https://moj-analytical-services.github.io/splink/topic_guides/theory/fellegi_sunter.html)) | Commercial ER is unjustifiable at 7 users |
| Agent observability | **Langfuse** (self-hosted or cloud) | LLM-native tracing across nested observations, open source, OTel-compatible ([docs](https://langfuse.com/docs/observability/overview)) | LangSmith, Braintrust — both unverified in research |
| Secrets | PL's existing vault | — | — |
| Auth | PL Labos kit | Out of scope per instruction | — |

---

## 3. Core data model

### 3.1 Identity — the part that must be right first

Everything else references entities, so identity churn poisons the whole system. Three tables, and the discipline around them matters more than the schema.

```sql
-- identity.entity: the canonical, persistent node. ID never derived from cluster contents.
create table identity.entity (
  entity_id      uuid primary key default gen_random_uuid(),
  entity_type    text not null,        -- person | org | family | vehicle | foundation
  display_name   text not null,
  merged_into    uuid references identity.entity(entity_id),  -- redirect on merge
  created_at     timestamptz not null default now(),
  retired_at     timestamptz
);

-- identity.source_record: one row per record we saw in any source system.
create table identity.source_record (
  source         text not null,        -- affinity | edgar | clay | linear | ...
  source_id      text not null,
  entity_id      uuid not null references identity.entity(entity_id),
  confidence     numeric,              -- null for deterministic matches
  resolved_by    text not null,        -- rule:email | splink:v3 | human:juan
  resolved_at    timestamptz not null default now(),
  primary key (source, source_id)
);

-- identity.assertion: human adjudications as HARD constraints. Survives every re-run.
create table identity.assertion (
  assertion_id   bigserial primary key,
  kind           text not null,        -- same_as | not_same_as
  left_source    text not null, left_source_id text not null,
  right_source   text not null, right_source_id text not null,
  asserted_by    text not null,
  asserted_at    timestamptz not null default now(),
  note           text
);
```

**The rules that keep IDs stable** — this is the part teams get wrong:

- `entity_id` is a surrogate, minted once, **never** derived from cluster membership.
- On a **merge**, one ID survives; the other gets `merged_into` set and is never reused. All foreign keys keep working; reads follow the redirect.
- On a **split**, new IDs are minted and lineage is recorded. Retired IDs are never recycled.
- `identity.assertion` rows are applied **before and over** the probabilistic model. A re-run can never silently reverse a human decision.
- Threshold changes are treated as **migrations with a diff review**, not config tweaks, because cluster membership is threshold-sensitive.

The resolution job itself runs in the derivation plane: deterministic rules first (normalized email, domain, EDGAR CIK), then Splink over the residual, then anything between the auto-merge and auto-reject thresholds goes to a human review queue in the app.

### 3.2 The audit log

One table, written in the same transaction as every state change. This is the substrate for Module 19 (learning loop) and for the compliance record.

```sql
create table platform.audit_event (
  event_id       bigserial primary key,
  occurred_at    timestamptz not null default now(),
  actor_type     text not null,        -- user | agent | connector | system
  actor_id       text not null,
  action         text not null,        -- ask.made | score.rescored | intro.requested
  entity_type    text, entity_id uuid,
  vehicle_id     uuid,
  request_id     uuid,                 -- ties a causal chain together
  before         jsonb,
  after          jsonb,
  payload        jsonb
);
create index on platform.audit_event (entity_id, occurred_at desc);
create index on platform.audit_event (action, occurred_at desc);
```

Three disciplines make this useful rather than decorative:

- **Same transaction, always.** An audit row written after the fact is a lie waiting to happen.
- **`request_id` threads causality.** A signal detected → dossier built → path computed → intro requested → commitment closed is one chain, and Module 19 can only answer "what actually worked" if the chain is intact.
- **Consumers are idempotent**, because any relay may publish duplicates.

### 3.3 The multi-vehicle model

This is the schema that makes Report 7's coordination problem tractable.

```sql
create table pipeline.vehicle (
  vehicle_id     uuid primary key,
  kind           text not null,        -- fund | spv | grant_program
  name           text not null,
  reg_d          text,                 -- 506b | 506c | n/a
  ica_exemption  text,                 -- 3c1 | 3c7 | n/a
  target_amount  numeric,
  close_date     date,
  status         text not null
);

-- The durable object is the relationship; exposure is the join.
create table pipeline.exposure (
  exposure_id    uuid primary key,
  entity_id      uuid not null references identity.entity(entity_id),
  vehicle_id     uuid not null references pipeline.vehicle(vehicle_id),
  instrument     text not null,        -- lp_commitment | spv | grant | pri | mri | direct
  stage          text not null,
  amount         numeric,
  probability    numeric,
  owner_user_id  text not null,        -- ONE owner, enforced
  opened_at      timestamptz not null,
  closed_at      timestamptz,
  unique (entity_id, vehicle_id, instrument)
);

-- Ask as a first-class event. The table that prevents four raises colliding.
create table coordination.ask (
  ask_id         uuid primary key,
  entity_id      uuid not null references identity.entity(entity_id),
  vehicle_id     uuid not null references pipeline.vehicle(vehicle_id),
  asked_by       text not null,
  scheduled_for  date,
  made_at        timestamptz,
  channel        text,
  outcome        text,
  override_of    uuid references coordination.ask(ask_id),
  override_reason text
);
```

**The frequency guard is a database constraint plus a synchronous check, not a dashboard.** Before an ask can move to `made_at`, the coordination module runs:

```sql
select count(*) from coordination.ask
where entity_id = $1
  and made_at > now() - interval '1 quarter';
```

Above the cap, the write is refused and returns the conflicting ask. An override is permitted but must carry `override_reason` and writes an audit row — which is how §9's metric ("overrides logged this quarter") stays honest.

### 3.4 Time-bounded edges

Relationships sequence rather than simply exist (Report 3, §5.1). Every edge carries validity:

```sql
create table network.edge (
  edge_id        uuid primary key,
  from_entity    uuid not null references identity.entity(entity_id),
  to_entity      uuid not null references identity.entity(entity_id),
  kind           text not null,        -- connector | advisor | board | coinvestor
                                       -- | colleague | event_coattendee | podcast_guest
  strength       numeric,              -- from Affinity interactionScore, 0.0–1.0
  tie_band       text,                 -- weak | moderate | strong (the inverted-U band)
  evidence       jsonb,
  valid_from     date not null,
  valid_to       date
);
```

`tie_band` is computed, not raw strength, because Module 05's routing prefers the **moderate** band deliberately (Rajkumar et al., *Science* 377:6612). Affinity's own `interactionScore` guidance (≥0.7 regular, 0.4–0.7 occasional, <0.4 sporadic) gives a defensible starting cut, tuned against outcomes once the log has depth.

---

## 4. Module contract — how compartmentalization actually works

### 4.1 Twenty modules, eleven bounded contexts

Twenty UI modules do not mean twenty deployment units. They collapse into eleven contexts, each owning one Postgres schema:

| Schema | Modules it owns |
|---|---|
| `identity` | Graph & identity, entity resolution |
| `intel` | 01 research/enrichment, 11 signal desk |
| `scoring` | 03 selection, 02 segmentation |
| `pipeline` | 06 vehicle metrics, exposure, stages, coverage |
| `coordination` | 10 ask coordination, 04 conversion strategy |
| `network` | 05 route planner, connector goodwill |
| `content` | 14 materials, 15 answer library, 07 content performance |
| `compliance` | 16 vehicle & compliance registry, MFN register |
| `grants` | 17 grants & program officer desk |
| `workbench` | 12 meeting intelligence, 13 objection ontology, 09 LP-fit audit |
| `platform` | 08 agent workflows, 18 team & capacity, 19 learning loop, 20 close room, audit log, feedback loop |

### 4.2 The module manifest

Every module declares itself. This file is the enforcement surface — CI reads it.

```yaml
# modules/coordination/module.yaml
name: coordination
schema: coordination
db_role: app_coordination
owns:
  tables: [ask, ask_override, owner_assignment]
depends_on:
  - identity:  [entity.read]        # via published interface, not tables
  - pipeline:  [exposure.read, vehicle.read]
publishes:
  events:
    - ask.scheduled
    - ask.made
    - ask.blocked
    - owner.reassigned
consumes:
  events:
    - exposure.stage_changed
agent_access: none                  # agents cannot read this schema
canon_inputs: []
```

### 4.3 Four enforcement mechanisms, cheapest first

1. **Schema + role grants.** `app_coordination` has `USAGE`/`SELECT`/`INSERT` on `coordination` only. A cross-schema join fails with a permission error at runtime — not a code review comment.
2. **Import linting.** `dependency-cruiser` (or ESLint `no-restricted-imports`) forbids importing anything but a module's `index.ts`. Cross-module calls go through the published interface.
3. **Event contracts.** Modules communicate asynchronously by publishing to the audit log with a typed payload. Consumers subscribe. Adding a field is safe; removing one is a versioned change.
4. **A compliance score, not a hard gate.** Shopify's Wedge approach: track violations as a metric and drive it down. A gate everyone learns to bypass is worse than a number everyone can see.

### 4.4 Module lifecycle

New modules are added without touching existing ones: create the schema, the role, the manifest, the interface, the routes. Removing a module means dropping its schema and its routes; other modules break loudly at the interface, which is the correct behaviour.

**Extraction to a service is warranted only when:** a module has a genuinely divergent scaling profile (the agent runtime is the only plausible candidate), a hard compliance boundary demands separate infrastructure, or a third party needs to run it. "The codebase is getting big" is not on that list.

---

## 5. Integration layer

### 5.1 The connector contract

Every connector implements the same four-method interface, which is what makes adding the ninth external database cheap rather than bespoke.

```ts
interface Connector<TRaw> {
  readonly source: string;
  readonly capabilities: {
    backfill: boolean;
    poll: boolean;
    webhook: 'signed' | 'unsigned' | 'none';
    bulkShare: boolean;
  };
  backfill(cursor?: string): AsyncIterable<Batch<TRaw>>;
  poll(watermark: Watermark): AsyncIterable<Batch<TRaw>>;
  onWebhook(req: Request): Promise<Invalidation[]>;   // returns what to re-read
  normalize(raw: TRaw): CoreRecord[];
}
```

Three invariants:

- **Everything lands raw first.** `landing.<source>_record (source, source_id, payload jsonb, fetched_at, source_updated_at)`. Normalization is a separate, replayable step. When a mapping is wrong — and it will be — you re-normalize from landing rather than re-fetching from a rate-limited API.
- **Idempotency key is `(source, source_id, source_updated_at)`.** Re-delivery is free.
- **`onWebhook` returns invalidations, never data.** Even for signed sources. This keeps one code path and makes the Affinity case (§0.1) the default rather than the exception.

### 5.2 Per-integration design

| Source | Pattern | Watermark | Notes and traps |
|---|---|---|---|
| **Affinity** *(Advanced+)* | **Data Share → warehouse** as spine; REST only for writes and on-demand freshness | 2h refresh | Zero API quota. Full interaction corpus incl. `relationship_strengths`. **Verify plan tier first.** |
| **Affinity** *(Scale)* | Poll-first; webhooks as invalidation only | **`createdAt`/`updatedAt`, never `sentAt`** | Auto-captured mail is backfilled by connectors and can arrive with an old `sentAt` but recent `createdAt` — watermarking on `sentAt` silently loses records. Use `/v2/field-value-changes` for CRM deltas (only fields with change-tracking on). Monthly reconciliation sweep for deletes and `organization.merged`. |
| **Linear** | Signed webhooks + `updatedAt` sweep | `updatedAt` | Verify `Linear-Signature` (HMAC-SHA256) and `webhookTimestamp` within 60s. Use OAuth `actor=app` so agent changes are attributed to the app, not a person. Budget complexity points, not request count. |
| **Google Drive/Docs** | `changes.list` + push channels | `newStartPageToken` | **Channel renewal scheduler is mandatory** (1d files / 1w changes, no auto-renew). Token matching only — no signature. Docs API creates and edits; **Drive API does export/permissions**. Domain-wide delegation for a single-domain internal tool. |
| **DocSend** | Zapier → our webhook | none | Forward-only. No backfill, no guarantees, no signature. Mark all DocSend-derived metrics as partial in the UI. Manual CSV for history. |
| **Fireflies** | Signed webhook (`x-hub-signature`) | transcript id | The only transcription tool with documented signed webhooks. Fires **only for meeting owners** — so every person whose meetings matter must own their recordings. Rate limits are harsh below Business. |
| **Granola / Fathom** | Poll | cursor / updated | Granola is Business-plan-gated and returns 404 for notes without a generated summary — poll with retry, don't treat 404 as absent. |
| **EDGAR** (full-text, Form D, Form 4) | Poll, daily | filing date | Free, structured, no auth. The highest-value-per-cost source in the system. |
| **IRS 990-PF** | Poll via index | filing date | Payout-shortfall detection (Module 11) lives here. |
| **Job boards** | Poll / scrape | posting date | Underpriced signal per Report 4. Respect robots and ToS. |
| **FO databases** (FINTRX/Dakota) | Scheduled export or API | vendor-specific | FINTRX has a documented API feed; Dakota has CRM sync. Confirm contract terms before automating. |
| **Sydecar / AngelList** | **Manual CSV until proven otherwise** | — | Gated docs. Do not design around. |

### 5.3 Rate-limit and failure discipline

- **One service key per source**, never shared with interactive requests, so an agent's research burst cannot starve a user's page load.
- **A token bucket per source** in Redis, configured from published limits, with the *monthly* budget tracked separately for Affinity.
- **Every connector emits `connector.run` audit events** with records fetched, errors, and quota consumed. Module 08's run history reads this.
- **Circuit breaker per source.** Three consecutive failures → open, alert, degrade the dependent module visibly in the UI rather than showing stale data as fresh.
- **Reconciliation sweeps are scheduled, not optional** — monthly for Affinity, weekly for Drive.

### 5.4 The two data planes

The agent boundary is enforced by grants and schema separation, not by RLS policies. RLS is one `BYPASSRLS` grant, one forgotten `FORCE`, one owner-role connection or one leaky foreign-key constraint away from failure — and an LLM is an adversarially creative query generator.

```
research schema  ← agent_reader role: USAGE + SELECT on views only
  entity, source_record (public fields), edge, signal,
  public content, published filings, scores

confidential schema  ← NO GRANT to agent_reader at all
  LP financials, subscription docs, side letters, MFN register,
  meeting transcripts, ask outcomes, portfolio company MNPI
```

- `agent_reader` gets **no grant whatsoever** on `confidential`. A prompt-injected query fails with *relation does not exist* — a failure that reveals nothing and cannot be talked around.
- **Separate DSN and connection pool for agent traffic**, never shared with the app's pool, so an agent cannot inherit a session's transaction-local context.
- Grants are on **curated views**, not base tables, projecting only permitted columns.
- **Promotion from confidential to research is an explicit, audited action** — a reviewed operation with an audit row, never an ambient permission.
- RLS is used *within* the research plane for per-user scoping, as defence in depth. Always `SET LOCAL` inside an explicit transaction (plain `SET` leaks across requests under transaction-mode pooling), always `FORCE ROW LEVEL SECURITY`, always index leading with the scoping column.

This directly implements Skadden's cross-deal-contamination warning: a shared RAG index spanning multiple active matters lets a model infer confidential relationships even when nobody intended it ([Skadden](https://www.skadden.com/insights/publications/2026/07/when-ai-models-access-nonpublic-information)).

---

## 6. Agent runtime

### 6.1 Composition over autonomy

The design follows Anthropic's distinction directly: workflows orchestrate LLMs through predefined code paths; agents dynamically direct their own process. The guidance is to adopt the patterns in order of last resort, because "the autonomous nature of agents means higher costs, and the potential for compounding errors" ([Building Effective Agents](https://www.anthropic.com/research/building-effective-agents)).

The empirical case reinforces it. The MAST study hand-annotated 150 traces across seven multi-agent frameworks and derived 14 failure modes, concluding better orchestration alone doesn't fix them ([arXiv 2503.13657](https://arxiv.org/abs/2503.13657)). Cognition's field report is blunter: parallel subagents fail because they don't share context, producing incompatible outputs a coordinator can't reconcile ([Cognition](https://cognition.com/blog/dont-build-multi-agents)).

**So: five named workers, each a bounded workflow, none of them autonomous, none of them fanning out in parallel over shared state.**

| Worker | Pattern | Reads | Writes | Gate |
|---|---|---|---|---|
| **Researcher** | orchestrator–workers | research plane, web | `intel.dossier` | human claim before use |
| **Signal watcher** | routing | filings, job boards, warehouse | `intel.signal` | none — surfaces only |
| **Brief writer** | prompt chain | research plane + own meeting history | `workbench.brief` | human read before meeting |
| **Answer librarian** | RAG over approved corpus | `content.answer` (approved only) | draft response | human approve/edit |
| **Pipeline analyst** | evaluator–optimizer | `pipeline`, `coordination` | `platform.weekly_digest` | none — internal |

**No worker has send rights.** Every outbound step routes to a named person. This is a design invariant, not a configuration.

### 6.2 Tool design

Anthropic's guidance is that agent-computer interface design deserves as much effort as human interface design ([writing tools for agents](https://www.anthropic.com/engineering/writing-tools-for-agents)). Concretely here:

- **Consolidate.** One `get_entity_dossier(entity_id)` beats `get_person` + `get_org` + `get_edges` + `get_signals`.
- **Namespace.** `affinity_search`, `edgar_search`, `graph_path`.
- **Token-efficient returns with sensible defaults**, and when truncating, say what was omitted and suggest a narrower query.
- **Instructional errors.** `"entity_id must be a uuid; you passed 'Hartwell Holdings' — use graph_search(name) first"` — not a stack trace.
- **Iterate tools against evals**, analysing transcripts. This consistently outperforms manual tool design.

### 6.3 Context discipline

Context is a finite resource with diminishing returns, and context rot is measurable. The remedies applied here: **just-in-time retrieval** via IDs rather than pre-loading corpora; **compaction** between phases of a long research run; **structured note-taking** into `intel.dossier` as external memory rather than holding everything in the window; **sub-agents that explore widely but return condensed summaries** ([context engineering](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents)).

### 6.4 Budgets, evals, observability

- **Hard structural caps**, not advisory: max turns, max tokens, wall-clock timeout, per-worker daily credit budget. Module 08's fleet view reads these.
- **An offline eval set from day one.** The single most-cited production failure is having no way to tell whether a prompt change helped. Start with 30 hand-labelled dossier tasks and 20 brief tasks; grow from real transcripts.
- **Langfuse traces** every run: prompt, response, tokens, latency, tool calls, nested observations. Prefer OTel GenAI semantic conventions to avoid lock-in.
- **Every factual claim in a generated artifact carries a source link; unsourced claims render visually flagged** in the UI (Module 12 shows this). This is the mitigation for the highest-likelihood embarrassment: a fabricated detail in a meeting brief that you then repeat in the meeting.

### 6.5 Budget the supervision

The most credible field account — SaaStr running five specialized agents for six months — reported real volume gains but **15–20 hours per week of leadership oversight and prompt-tuning** to sustain them, concluding "AI SDRs scale what's already working — they can't fix what's broken" ([SaaStr](https://www.saastr.com/6-months-of-ai-sdrs-whats-worked)). Module 18 tracks agent-review time as a first-class number for exactly this reason. If it passes a third of senior time, the fleet is producing more than it saves.

---

## 7. The improvement loop

Two loops, different clocks.

### 7.1 Product loop — feedback to merged code

```
in-app feedback widget
      │  writes platform.feedback + audit row
      ▼
durable workflow: LLM triage → {bug|request|question|spam} + confidence
      │
      ├─ high confidence ──► create Linear issue (OAuth actor=app, labelled)
      └─ low confidence  ──► human triage queue
      ▼
human applies `agent-ready` label        ◄── THE HUMAN GATE
      ▼
coding agent opens PR on a branch
      ▼
branch protection: CI green + 1 human approving review
      ▼
merge
```

**The guardrails are not optional.** Microsoft's security analysis of exactly this integration found prompt-injection payloads hidden in **HTML comments** — "invisible when the issue is rendered in the browser but still visible to the AI model" — and a sandbox asymmetry allowing `/proc/self/environ` reads to exfiltrate API keys, with the model instructed to cut the first characters to defeat secret scanning ([Microsoft Security](https://www.microsoft.com/en-us/security/blog/2026/06/05/securing-ci-cd-in-agentic-world-claude-code-github-action-case/)).

The mitigations, adopted wholesale:

1. **Agents Rule of Two** — no workflow may simultaneously (a) process untrusted input, (b) hold secrets, and (c) have external communication. Triage reads untrusted feedback but holds no repo credentials; implementation holds credentials but reads only a human-labelled issue.
2. **Least privilege per workflow**, one key per workflow/environment.
3. **System prompts explicitly declare issue bodies and file contents as untrusted user input, not instructions.**
4. **The agent cannot approve its own PR.** Branch protection enforces it.

A known operational gotcha: GitHub does not trigger workflows on commits made with the default `GITHUB_TOKEN`, so CI silently won't run on the agent's pushes unless it authenticates as a GitHub App ([Claude Code GH Action](https://code.claude.com/docs/en/github-actions)).

**What this loop can and cannot do.** It works for narrow, well-specified, test-covered changes: adding a field end-to-end, fixing a failing test, a documented refactor, a connector for a new source that implements an existing interface. It does not work for anything touching architecture or ambiguous requirements. **The differentiator is CI and test coverage, not the model — invest there before investing in agent plumbing.**

### 7.2 Knowledge loop — autoresearch

Distinct from the product loop, and the thing that makes the system compound.

```
observation                        →  update
──────────────────────────────────────────────────────────────────
objection clustered 5× in a week   →  materials task + answer-library entry
connector produced 0 conversions   →  demote its weight in path scoring
score component drifts from
  realised outcomes                →  propose reweighting, human approves
dossier field repeatedly corrected →  fix the extraction prompt, add to eval set
ask blocked by guard N times       →  surface the coordination pattern to the team
a source's data goes stale         →  circuit-break and flag in UI
```

Each of these is a scheduled job reading the audit log and writing a **proposal**, never applying a change directly. Proposals land in a review queue. A human accepts, rejects, or edits. Acceptance writes an audit row, so the loop itself is measurable.

**Replay is a hypothesis generator, not proof.** Sample sizes at 34 commitments are small enough that one close moves every number. The UI says so (Module 19) and the proposals carry confidence intervals.

---

## 8. Deployment and environments

### 8.1 Runtime topology

```
┌─ PL cloud account ────────────────────────────────────────┐
│                                                            │
│  app (2 instances, autoscale)  ─┐                          │
│  connector workers (1–2)       ─┼─► Postgres (primary)     │
│  agent workers (1–2, isolated) ─┘     └─► read replica     │
│                                                            │
│  Redis (rate buckets, cache, session)                      │
│  object store (raw payload archive, generated artifacts)   │
│                                                            │
└──────────┬─────────────────────────────────────────────────┘
           │ logical replication / scheduled extract
           ▼
    PL data warehouse ──► dbt models ──► canon push back to Postgres
           │
           └──► Affinity Data Share lands here
```

**Agent workers run in their own process group with their own DSN, their own egress allowlist, and their own secret scope.** This is the Rule of Two applied at the infrastructure level: the process that reads untrusted web content is not the process that holds the Affinity key.

### 8.2 Environments

Three, and the middle one matters more than usual: **dev** (local Postgres, seeded synthetic data, connectors stubbed), **staging** (real schema, synthetic entities, live connectors pointed at sandbox or read-only keys), **production**.

**Never seed staging with real LP data.** Entity names and financials are exactly what should not leak into a lower-trust environment. A synthetic-entity generator that preserves shape without content is a day of work and prevents a category of incident.

### 8.3 Migrations and the canon contract

- Schema migrations are forward-only, reviewed, and run in CI against a production clone.
- **The canon contract is versioned.** The derivation plane writes `canon.entity_score`, `canon.path_index`, `canon.cluster_assignment` with a `schema_version` column. The operational plane reads a specific version. Changing the contract means writing both versions until the reader migrates — the same discipline as a public API.
- Canon tables carry `computed_at`. The UI shows staleness rather than pretending freshness (Module 03 shows "12mo old" against a capacity score for this reason).

---

## 9. Phased rollout

The sequencing constraint is that build velocity during a close is stolen from raise velocity. Each phase must ship something that changes what someone does that week.

### Phase 0 — Week 1: the four tables

No app, no connectors, no agents. Postgres with `identity.entity`, `coordination.ask`, `pipeline.exposure`, `platform.audit_event`, seeded from the existing-relationship census. A single internal page that reads and writes the ask log. Meeting capture configured with a proper DPA.

**Test:** can Maya see, before sending, that Juan has an unscheduled ask on the same relationship? If yes, Phase 0 has already paid for itself.

### Phase 1 — Weeks 2–4: signal + surface

- EDGAR (Form 4, Form D, full-text) and job-board connectors. Both free, both high-signal.
- The landing → normalize → entity pipeline, with deterministic resolution only.
- Module 11 (signal desk) and Module 03 (ranked selection) in the app.
- Module 20 (close room) — because signature-to-wire is the path to the December number.

**Test:** does a liquidity event reach a named owner within a day, with a dossier attached?

### Phase 2 — Weeks 5–8: the graph and the agents

- Affinity connector. **Data Share if the plan tier allows — otherwise the poll-first pattern.**
- Splink resolution in the derivation plane; canon contract v1.
- `network.edge` populated; Module 05 (route planner) live.
- Researcher and brief-writer workers, with Langfuse and the first eval set.
- Two data planes enforced from the first agent commit, not retrofitted.

**Test:** does the route planner recommend a connector a human agrees with, more often than not?

### Phase 3 — Weeks 9–14: coordination at full load

- Linear integration (issues, agent-ready loop).
- Drive/Docs for materials; Module 14 delivery ledger.
- Module 16 compliance registry — including the 506(b)/506(c) integration flag.
- Module 10 guard enforcing, with overrides logged.
- Workflow engine for multi-day human-in-the-loop sequences.

**Test:** does the close happen without an ask collision?

### Phase 4 — Q1 2027 and beyond

Grants desk, objection ontology, content performance, team capacity, learning loop. DocSend via Zapier, accepting its limits. The feedback→Linear→agent loop, once CI is good enough to trust it.

**Explicitly deferred past December:** predictive scoring, a play DSL, Kafka, service extraction, reverse-ETL tooling, Debezium.

---

## 10. Open questions, risks, and decisions needed

### 10.1 The one question that changes the architecture

**Which Affinity plan is PL on?** Advanced or Enterprise unlocks Data Share, which makes the warehouse a first-class ingestion path, removes the 100k/month ceiling as a design concern, and delivers the interaction corpus and relationship strengths for free. Scale means the poll-first pattern, a much tighter API budget, and materially more connector engineering. **Answer this before Phase 2 is designed in detail.**

### 10.2 Risks, ranked by expected damage

| Risk | Likelihood | Mitigation |
|---|---|---|
| **Entity resolution churn** breaks references and erodes trust | High | Persistent surrogate IDs, assertion table, reconciliation on every run, threshold changes as reviewed migrations (§3.1) |
| **Drive channel renewal fails silently** | High | Renewal scheduler with its own alert; weekly reconciliation sweep as backstop |
| **Agent reads confidential data** via a mis-scoped grant | Medium | Grants and schemas, not RLS; separate DSN; no grant at all on `confidential`; periodic permission audit in CI |
| **Affinity webhook spoofing** (no signatures) | Medium | Invalidation-only handling; unguessable path; IP allowlist; never persist payload content |
| **Build competes with the raise** | Medium–High | Phase gates tied to "changes what someone does this week"; explicit deferral list |
| **Warehouse coupling** — someone else's model change breaks canon | Medium | Versioned canon contract; own schema in the warehouse; contract tests in CI |
| **Prompt injection via issue bodies** in the dev loop | Medium | Rule of Two; human `agent-ready` gate; untrusted-input declarations; no self-approval |
| **Linear custom fields don't exist** as assumed | Medium | Verify against live GraphQL schema before Phase 3; fall back to labels + projects |
| **Sydecar/AngelList never open up** | Medium | Designed as manual CSV; no module depends on their API |

### 10.3 Decisions needed from you

1. **Affinity plan tier** (§10.1) — blocks Phase 2 design.
2. **Warehouse access** — can this system get its own schema in PL's warehouse, with write permission for canon, or does it need a standalone DuckDB/Postgres derivation plane?
3. **Workflow engine** — Trigger.dev Cloud vs Inngest Cloud vs Temporal Cloud. Recommendation is Trigger.dev Cloud if the team is TypeScript, for `wait.forToken()` and the billing shape on long human waits.
4. **Affinity vs Attio as the CRM of record.** Attio's API is materially better in every dimension measured — signed webhooks, 100 rps reads, genuinely extensible objects, OAuth. Affinity's advantage is Data Share and the relationship-intelligence capture. If the team is not already deep in Affinity, this is worth reconsidering *now* rather than in 2027.
5. **Who owns this build** — and whether it is internal infrastructure or a product. The research says the gap is real and nothing on the market fills it, which argues for the latter. But building a product during a fund raise is how both end up half-done. **Recommendation: internal infrastructure through 2027; let the product question answer itself once it demonstrably works on your own raise.**

### 10.4 What would make me change this design

- If PL's warehouse is genuinely low-latency and write-accessible, Architecture A becomes more attractive and the operational Postgres could shrink to almost nothing.
- If the team is five engineers rather than two, the agent runtime should be extracted as a service in Phase 2 rather than Phase 4.
- If Affinity is on Scale and the team is willing to migrate, moving to Attio removes three of the nine risks in §10.2 outright.

---

## Appendix A — Event taxonomy (initial)

```
identity.*    entity.created · entity.merged · entity.split · assertion.made
intel.*       signal.detected · signal.claimed · signal.expired · dossier.built
scoring.*     score.computed · score.decayed · weights.proposed · weights.accepted
pipeline.*    exposure.opened · exposure.stage_changed · exposure.closed
coordination.* ask.scheduled · ask.made · ask.blocked · ask.overridden · owner.assigned
network.*     edge.formed · path.computed · intro.requested · intro.delivered
              intro.converted · connector.goodwill_spent
content.*     asset.versioned · asset.delivered · asset.opened · answer.approved
compliance.*  vehicle.registered · posture.changed · flag.raised · mfn.elected
grants.*      opportunity.identified · officer.contacted · proposal.submitted
workbench.*   meeting.held · objection.raised · objection.clustered
platform.*    feedback.received · proposal.raised · proposal.accepted · connector.run
```

## Appendix B — Architecture decision records to write

1. Postgres as operational SoR; warehouse as derivation plane
2. Audit log over event sourcing
3. Schema-per-module over services
4. Grants-and-schemas over RLS for the agent boundary
5. Managed workflow engine; no self-hosted Temporal
6. Data Share as Affinity spine (conditional on §10.1)
7. Invalidation-only webhook handling, universally
8. Persistent surrogate entity IDs with an assertion table
9. Versioned canon contract between planes
10. Human gate before every outbound communication

## Sources

- [Affinity Developer Documentation](https://developer.affinity.co/) · [rate limits](https://developer.affinity.co/pages/external-api-v2/rate-limits) · [Data Share](https://developer.affinity.co/pages/data-share/overview) · [webhooks](https://developer.affinity.co/api-reference/2026-07-15/webhooks/create-a-webhook.md) · [emails](https://developer.affinity.co/api-reference/2026-07-15/emails/get-metadata-on-all-emails.md) · [person relationships](https://developer.affinity.co/api-reference/2026-07-15/persons/get-relationships-for-a-person.md)
- [Linear GraphQL API](https://linear.app/developers/graphql) · [webhooks](https://linear.app/developers/webhooks) · [rate limiting](https://linear.app/developers/rate-limiting)
- [Google Drive — manage changes](https://developers.google.com/workspace/drive/api/guides/manage-changes) · [push notifications](https://developers.google.com/workspace/drive/api/guides/push) · [limits](https://developers.google.com/workspace/drive/api/guides/limits) · [service accounts / DWD](https://developers.google.com/identity/protocols/oauth2/service-account)
- [Dropbox Developers](https://www.dropbox.com/developers) · [DocSend Zapier integration](https://help.dropbox.com/integrations/dropbox-docsend-zapier-integration)
- [Attio REST API](https://docs.attio.com/rest-api) · [webhooks](https://docs.attio.com/rest-api/guides/webhooks) · [rate limiting](https://docs.attio.com/rest-api/guides/rate-limiting)
- [Fireflies webhooks](https://docs.fireflies.ai/graphql-api/webhooks) · [Granola API](https://docs.granola.ai/introduction) · [Fathom quickstart](https://developers.fathom.ai/quickstart)
- [Martin Fowler — Event Sourcing](https://martinfowler.com/eaaDev/EventSourcing.html) · [MonolithFirst](https://martinfowler.com/bliki/MonolithFirst.html)
- [Udi Dahan — When to avoid CQRS](https://udidahan.com/2011/04/22/when-to-avoid-cqrs/)
- [Transactional outbox pattern](https://microservices.io/patterns/data/transactional-outbox.html)
- [Shopify — Deconstructing the Monolith](https://shopify.engineering/deconstructing-monolith-designing-software-maximizes-developer-productivity)
- [Anthropic — Building Effective Agents](https://www.anthropic.com/research/building-effective-agents) · [Writing tools for agents](https://www.anthropic.com/engineering/writing-tools-for-agents) · [Effective context engineering](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents)
- [MAST — Why Do Multi-Agent LLM Systems Fail?](https://arxiv.org/abs/2503.13657) · [Cognition — Don't Build Multi-Agents](https://cognition.com/blog/dont-build-multi-agents)
- [Langfuse observability](https://langfuse.com/docs/observability/overview)
- [Trigger.dev — wait](https://trigger.dev/docs/wait) · [Inngest — waitForEvent](https://www.inngest.com/docs/features/inngest-functions/steps-workflows/wait-for-event) · [Temporal — understanding](https://docs.temporal.io/evaluate/understanding-temporal)
- [Splink — Fellegi–Sunter](https://moj-analytical-services.github.io/splink/topic_guides/theory/fellegi_sunter.html) · [cluster graph metrics](https://moj-analytical-services.github.io/splink/topic_guides/evaluation/clusters/graph_metrics.html)
- [PostgreSQL — Row Security Policies](https://www.postgresql.org/docs/current/ddl-rowsecurity.html)
- [Debezium — PostgreSQL connector](https://debezium.io/documentation/reference/stable/connectors/postgresql.html)
- [Claude Code GitHub Action](https://code.claude.com/docs/en/github-actions) · [Microsoft — Securing CI/CD in an agentic world](https://www.microsoft.com/en-us/security/blog/2026/06/05/securing-ci-cd-in-agentic-world-claude-code-github-action-case/)
- [SaaStr — 6 months of AI SDRs](https://www.saastr.com/6-months-of-ai-sdrs-whats-worked)
- [Skadden — When AI Models Access Nonpublic Information](https://www.skadden.com/insights/publications/2026/07/when-ai-models-access-nonpublic-information)
