# 26 — MCP access to Capital OS

**Status:** shipped. Phase 1 was built on `claude/mcp` (2 Oct 2026); the data-driven policy, the outreach tools and the
structured audit record on `claude/outreach-api` (4 Oct 2026, docs/27), and the comms-trace tools on `claude/comms-trace`.
All are on master since 4 Oct 2026 (merge `89a710f`) and ship with it. The desk's second round — ids, restriction flags
and readable addresses on route hops, `top_connectors`, the queue's cursor paging and `includePassed`, and `_meta.status` on
error results (docs/27 §4–§5) — merged on 5 Oct 2026 (`648e03b`) and is live on `deploy` at `0b3715e`. **Built on
`claude/outreach-desk-v3`, 5 Oct 2026, not merged yet:** `askFirst` on every route, first-hop counts, `firstHopOnly`, ask
history and one connector's targets on `top_connectors`, `pursuitIds` on `outreach_link_message`, and the close track's
`signedCount` (docs/27 §4–§5).

Juan, 2 Oct 2026: "we should add: MCP access to PLCOS to enable a wide range of actions. plan this out and
implement after email". So an agent — Claude Code, Claude Desktop, later others — can use the app as a person,
with that person's access or less. It reads, and it drafts. It does not send, approve, accept or move money.

## 1. Transport

- **Streamable HTTP at `/api/mcp`, inside the Next app** (`app/api/mcp/route.ts`, `lib/mcp/`). One process serves
  the app and MCP, on the Mac now and on the deployed service later (docs/deploy/rev3.md: one machine). No
  second server, no port of its own, the same database handle and the same authorization code.
- **Stateless, JSON answers, POST only.** Each POST is a whole exchange: authenticate, check, answer. No session
  store, nothing to expire, no stream to hold open; GET and DELETE answer 405, as the spec allows. The official
  TypeScript SDK (`@modelcontextprotocol/sdk` 1.32, protocol 2025-11-25) does the protocol: its low-level
  `Server` with the web-standard Streamable HTTP transport, built fresh for each request.
- **A stdio shim, yes, but only for Claude Desktop** (`scripts/mcp-stdio.ts`, `npm run mcp:stdio`). Desktop starts
  local MCP servers as commands; its remote connectors are reached from Anthropic's side and cannot see a
  localhost server. The shim holds no logic and no data: stdin to `/api/mcp` with the token, answers to stdout.
  Claude Code needs no shim; it speaks HTTP.

## 2. Authentication and authorization

- **A token per person, per device.** Preferences → MCP access makes one: a name ("Claude Code on the Mac"), what
  it may do (Read, or Read and draft), and optionally fewer vehicles than the person's own. The secret is
  `plcos_mcp_` + 32 random bytes, shown once; only its SHA-256 is stored (`platform.mcp_token`, migration
  `014_mcp_token.sql`), with a prefix to tell tokens apart. 90 days (GUESS), at most ten live per person (GUESS).
  The table shows when each was last used; Revoke takes effect on the next call. Making and revoking are server
  actions with their own rules in `lib/authz/rules.ts`, audit-logged, and refused on a preview copy.
- **`Authorization: Bearer <token>`.** No cookie is read. A request with an `Origin` from another site is refused
  (a web page cannot drive the endpoint through someone's browser). `withRoute` has an `mcp` policy that checks
  the token before the handler runs.
- **Each call acts as the token's owner, through the same layer as the UI.** The owner's roster row is read on every
  call, so a changed grant or a deactivation applies at once. Then:
  - every value in an answer passes `can()` for its vehicle and field class (R1 amounts, R2 words, R4 restriction
    reasons), and answers are explicit allowlisted projections, as in `lib/authz/read/projection.ts`;
  - the page facades in `lib/authz/read/` run inside `actAs(owner)` (`lib/auth/acting.ts`), so `currentUser()` is
    the owner. Without it, a request with no cookie gets the local provider's fallback — the roster's first user;
  - a write runs the UI action's own rule (`app/email/actions.ts#createDraftAction` for a draft), with the vehicle
    taken from the stored record, then the real-data rule (changes only on the live server), then the service.
- **A token narrows, never widens.** Its vehicles intersect the owner's; it approves nothing. **An Admin's token is a
  GP**: licensed Dakota values (R3) are Admin-only, and Dakota data never goes into a prompt to any agent
  (docs/agent-rules/real-data.md), which is where every MCP answer goes. That also keeps an Admin token limited to
  vehicles limited, since the policy lets an Admin through before it looks at vehicles.
- **Viewers make no tokens in phase 1.** The read tools already redact for a Viewer (a token whose owner becomes a
  Viewer gets Viewer answers); letting Viewers make read tokens is phase 2.
- **Not OAuth.** The MCP spec's authorization is OAuth 2.1; a static bearer token is what Claude Code's `--header`
  and the shim send, and all that one machine needs. **LabOS later:** `platform.app_user.labos_uid` already ties a
  person to LabOS; when the service signs people in with LabOS, Preferences makes tokens for the signed-in person,
  and LabOS can become the OAuth authorization server the spec describes. The envelope and the tools do not change.
- **Two caveats.** A preview's database is a copy of live, tokens included, so a live token reads the copy on a
  preview server (writes are refused there). And the Mac serves plain `http` on the local network: from another
  device a token crosses the network unencrypted. Use `localhost` on the Mac; TLS comes with the deployed service.

## 3. Tools, and the policy each one carries

The registry is `lib/mcp/tools.ts`. A name absent there does not exist. Since 4 Oct 2026 the policy is data, one entry
per tool (Juan: "we can evolve the MCP rules, i think we'll end up with more tools wanting to do stuff"):

- **risk** — `read` (reads through `lib/authz`, writes nothing); `propose` (writes something a person reviews or approves:
  a draft, a feedback report, a ticket opened for approval, an address to confirm — and decides nothing);
  `write-guarded` (changes a record through the app's own service and guards, as boxes a person ticked);
  `send-adjacent` (records what already moved through mail — a message sent or received, its metadata; sends nothing);
- **scopes** — what the token must carry beyond the tool's name (`[]`: the name in the token's list is enough);
- **ticket** — `none`, `opens` (for a person to approve), `requires-approved` (fails closed without one), or
  `agent-only` (fails closed without one for an autonomous call; a person needs none — Juan, 5 Oct 2026, docs/27 §7a).
  A call is autonomous when it says so (`_meta.autonomous: true`, or `X-Autonomous: 1` over REST) or its token carries
  `mode:autonomous`; every audit record says which;
- **approval** — whether a person approves or accepts it before it counts.

A token may call a tool when its list names the tool, or, for a scoped tool, when it carries every scope the tool
needs. `tools/list` returns each tool's policy in `_meta`. An error result carries, in `_meta.status`, the HTTP-style code
the REST wrapper answers for the same refusal: 400 (arguments), 403 (scope, access), 404 (not yours, or no such), 409,
422, 429 (rate) or 500 (5 Oct 2026, docs/27 §5).

Two more scopes open no tool: `sync:snapshot` (Admin only) and `sync:push` (GP or Admin) open the cloud pull and
push endpoints, `GET /api/sync/snapshot` and `POST /api/sync/push` (docs/deploy/railway.md §7a). Each endpoint
declares a policy the same way (`lib/sync/scopes.ts`, risk `read` and `write-guarded`) and is checked by the same
`allowed`; who may hold each scope is checked when the token is made and on every use. Preferences makes them as
two more choices under "May"; a sync token holds its scope alone. Their uses are `mcp.call` rows with `via: sync`.
Since 5 Oct 2026 `sync:push` also takes a prospects file and opens `GET /api/sync/push?job=<id>`, the counts of the
import a push queued, to the person who pushed. No new scope: it is the same kind of guarded write.

| Tool | Risk | Scopes | Ticket | What it does |
| --- | --- | --- | --- | --- |
| `search` | read | — | — | People and organisations by name, the pursuits on your vehicles (status, owner), do-not-approach |
| `lp_summary` | read | — | — | One LP on one vehicle: status, evidence, contact dates, latest strategy, hard and soft apart, restrictions, top routes |
| `routes_to` | read | — | — | Warm-intro routes to a target for a vehicle, by evidence tier, with coverage; each hop, `askFirst` (the first hop past the team: whom the desk emails) and the introducer (who carries the ask to the target) with its entityId, `doNotApproach`, and its best address where R2 is readable (docs/27 §4a) |
| `routes_through` | read | — | — | Whom X could introduce us to, our route to X (hops as routes_to's), LPs reachable only through X (every vehicle) |
| `pipeline` | read | — | — | A vehicle's LPs by status, counts, owner, next step, last touch |
| `target_lists` | read | — | — | Open LPs on a strategy list: this year's close, 2027, not now, none |
| `replies_owed` | read | — | — | LPs who spoke last with nothing from us since; LPs at Connecting waiting on a first reply |
| `feedback_issues` | read | — | — | Open issues, or one in full (a Viewer gets no body) |
| `changelog` | read | — | — | The latest entries, or one entry's text |
| `audit_recent` | read | — | — | Your own recent calls: tool, outcome, reason, ids affected, idempotency and correlation ids (§4) |
| `outreach_vehicles` | read | outreach:read | — | The desk's vehicles: hard, soft and indicated apart, raise window, SPV seats (docs/27) |
| `outreach_queue` | read | outreach:read | — | The desk's queue: status, close track (with its dates and `signedCount`) and seat apart, checks, materials, bucket, and the comms trace's summary (last touches, who owes, the thread, mismatches); `updatedSince` for polling; 25 rows by default, up to 500, paged by `cursor`/`nextCursor`; passed LPs only with `includePassed`; health-redacted |
| `top_connectors` | read | outreach:read | — | The people on the most and best warm routes to a vehicle's open LPs, from routes_to's routes: LPs reached, best score, example pursuitIds, routes as first hop or deeper, `reachableDirectly`, asks this quarter and the last ask; `firstHopOnly` ranks first hops only; with `entityId`, that connector's targets, paged (docs/27 §4b–§4c) |
| `comms_trace` | read | outreach:read | — | One LP's merged timeline from the comms trace: Affinity, Gmail via juanmail, PLC OS and Affinity notes, linked Linear issues, each with its source, one row per event (docs/27 §6a) |
| `create_email_draft` | propose | — | — | A first message or an intro ask, saved in the app for its owner; not moved to Gmail, not sent |
| `file_feedback` | propose | — | — | An issue, journaled like the feedback box, optionally about a logged call (`callId`); only the live app files |
| `outreach_request_ticket` | propose | outreach:write | opens | For an autonomous call only: a SEND (one email, named recipients) or INTRO_ASK ticket for a person to approve; never approves it. A person's call opens nothing and gets the checks |
| `outreach_propose_contact` | propose | outreach:write | — | An address the person confirmed from Gmail, kept beside Affinity's, never over it |
| `outreach_update` | write-guarded | outreach:write | — | The LP page's update box: words and the boxes the person ticked — status, touchpoint, next step, indicated amount |
| `outreach_link_message` | send-adjacent | outreach:write | agent-only | A message the desk sent or read, linked to one LP (or to several with `pursuitIds`, all or none, each authorized) by its ids and metadata, once; creates no outreach state; an autonomous send needs an approved ticket, which it marks used, and names one LP only |
| `outreach_record_send` | send-adjacent | outreach:write | agent-only | Deprecated (5 Oct 2026): the old arguments, run as `outreach_link_message`; removed next release |
| `comms_ingest` | send-adjacent | outreach:write | — | Message metadata the desk sees in Gmail, sent and received: idempotent by Message-ID, writes nothing else |

A scoped GP's token reads only their vehicles. `search` leaves out LPs found only elsewhere and counts them; an LP
it does show names the other vehicles it is on, with owner and no status, as the pages do (rule 5). Every list
says what it covered and as of when (rule 7); an empty route list says it is not proof that no route exists.

**Status changes through `outreach_update` (Juan, 4 Oct 2026).** juanmail uses MCP, so the outreach writes are MCP
tools. A status may change through `outreach_update` only as a box Juan ticked, through the same service and guards as
the LP page's update box (`lib/updates.ts`): the LP page's own authorization rule, once per idempotency key, audited.
It never records a ladder rung (rule 2; a logged meeting may propose one, for a person to approve), never money, and
never decides a ticket.

**Still excluded, and why.**

- **Sending** email, intro asks or materials, and **moving a draft to Gmail**. Capital OS sends nothing; the mail desk
  sends through MailGuard — with an approved SEND ticket only when it acts autonomously (5 Oct 2026) — and
  `outreach_link_message` only links the message (rule 3, docs/agent-rules/domain.md).
- **Approvals, ticket decisions, accepting a suggestion or a run.** No tool decides a ticket, its own or any; a desk
  ticket is requested by the inactive Mail desk actor and decided by a person in Approvals.
- **Ladder rungs** (STAGE tickets, rule 2–3).
- **Money and allocation** — a wire, hardening soft to hard, allocation exceptions: MONEY and ALLOCATION_EXCEPTION
  tickets, rule 10, Admin only. An indicated amount is not money (docs/27 §1).
- **Imports, connector runs, workflow runs, merges, roster and weights.** Admin operations on the live server,
  recorded in the run ledger, some holding keys (Affinity, Dakota, Linear) that must not be reachable from an
  agent's session.

**The hard rules are properties** (`scripts/properties/mcp.ts`), over the registry: every tool has a policy in the
closed set; no tool is named for an approval, a decision, money, a status, a rung, an import or a connector run (a connector run is
named by its system, Affinity, Linear, Dakota, Polaris, Gmail, mailguard or DocSend, or by running, syncing or importing;
"connector" alone is a person on a warm route, so `top_connectors` and any read of them may say so); a tool named for a send
or a ticket must have a ticket in its policy and a person approving; a send-adjacent tool opens no ticket, and one
that links a send fails closed for an agent (`requires-approved` or `agent-only`); a write needs a scope; and neither `lib/mcp/` nor `lib/outreach/` mentions a service that sends, decides or
moves money (`moveDraft`, `decideTicket`, `recordWire`, `harden(`, `mailguardClient`, `makeAsk`, …).

**Adding a tool.** (1) A policy entry in `lib/mcp/tools.ts`: risk, scopes, ticket, approval, and an input schema.
(2) A property for what it must never do, beside the registry's (`scripts/properties/`), and an end-to-end check if a
person's flow depends on it. (3) A row in the table above, with why it is safe, and a changelog entry. A tool that
needs a new risk class, or that would send, decide or move money, is a decision for Juan first, recorded in
docs/agent-rules/domain.md.

## 4. Safety

- **Work envelope** (AGENTS.md, Agent rules). The token row is the envelope: scope = the owner's vehicles narrowed by
  the token's; allowed commands = its tools and scopes; budget = calls a minute and a day; deadline = its expiry;
  escalation owner = its owner. Every call is checked before the tool runs (`lib/mcp/envelope.ts`, `allowed()` in
  `lib/mcp/tools.ts`) and refused with the reason when outside it.
- **One audit record per call** (Juan, 4 Oct 2026: "we will need to make sure all the actions are logged for audits,
  feedback, improvement, etc."). Every MCP call, and every outreach REST call (the same `runTool`), writes one
  `mcp.call` row to `platform.audit_log`: the owner (actor), the token (subject); `via` (mcp or rest), `client` (the
  token's name: "juanmail", "Juan's iPad mail desk"), `tool`, `risk`, `scopes`; `inputHash` (SHA-256 of the
  arguments as sent) and `args` (ids and fixed choices as given, any typed text only as its length, so no words reach
  the log); `outcome` (ok, refused, rate_limited, invalid, error), `reason`, `ms`, `bytes`; `affected` (the pursuit,
  ticket, draft, send, update… ids in the arguments or the answer); `idempotencyKey`; and `correlationId` — a client's
  id for a chain of calls, sent as `_meta.correlationId` on the call or an `X-Correlation-Id` header. Refusals are
  records too. `mcp.token_created`, `mcp.token_revoked`, and `mcp.refused` for a revoked, expired or inactive token.
  A draft also writes its own `email.draft_created`, as the owner.
- **Reading it.** Developer → Agent activity lists the calls, newest first, filtered by client, tool and outcome (an
  Admin sees everyone's, anyone else their own); one call opens with its detail. `audit_recent` gives a client its
  own history. **Feedback on a call:** the feedback box on that call's page records the call's id in the issue;
  an agent passes `callId` to `file_feedback`. Indexes in platform 016.
- **Retention:** everything is kept, for now. Nothing in the audit log is deleted; revisit when it is large.
- **Rate.** 60 calls a minute (GUESS) and 2,000 a day (GUESS) per token, in memory; after a restart the day's count
  is read back from the audit log.
- **Data, not instructions.** Record text — a strategy, a note, an issue, a name — is written by people and outside
  sources and can carry an injected instruction. Every answer is JSON whose first field says so, and the server's
  instructions repeat it. Words filled into a draft from the records are not echoed back.
- **Size.** Requests up to 256 KB; answers up to 60 KB, with the longest lists halved until they fit and strings cut
  at 4,000 characters, marked as cut; at most 100 rows a call, paged with `offset`. All GUESSES, in `config.mcp`. The
  outreach queue is the exception (5 Oct 2026): up to 500 rows a call, and a page that would not fit is cut from its end
  with `heldBack`, so its `nextCursor` still reaches every row (docs/27 §4).
- **Circuit breaker.** While correction burden is over budget, the draft tools refuse.
- **Training.** Answers go into the client's model context. Claude runs under Juan's Anthropic account with training
  off (AGENTS.md). A token belongs in a client that meets the same rule, and nowhere else.

Tests: ten properties in `scripts/properties/mcp.ts`, through the real route handler and the SDK client (scope,
restricted values, the registry, revocation, audit, budgets, size, the acting user), and one end-to-end check in
`scripts/e2e.ts` that makes a token in Preferences, calls the tools over HTTP, revokes it and sees the next call fail.

## 5. Phases

1. **Built (this branch):** the endpoint, tokens in Preferences, nine read tools, two draft tools, the envelope,
   audit and rate limits, the stdio shim, the properties and the e2e check.
2. **Next:** `update_email_draft`, `propose_move`, `propose_task`, `add_note`; read tokens for Viewers; per-tool
   choices beyond two presets; Developer → MCP listing recent calls by token.
3. **Deployed service:** https; LabOS sign-in; LabOS as the OAuth authorization server, if clients need it.

## 6. Connecting a Claude client

**Claude Code**, on the Mac where the live server runs:

1. Open `http://localhost:3000/settings` → MCP access. Name the token ("Claude Code on the Mac"), choose Read or
   Read and draft, and press Make token. Copy what it shows; it is not shown again.
2. In a terminal: `claude mcp add --transport http --scope user capital-os http://localhost:3000/api/mcp --header "Authorization: Bearer plcos_mcp_…"`
   (Preferences shows this line with the token filled in). `--scope user` makes it available in every folder.
3. In Claude Code, `/mcp` lists `capital-os` with 10 tools (or 12 with drafts, more with the outreach scope). Ask, for example, "Which LPs on PLC Neurotech
   owe a reply?"

That command stores the token in `~/.claude.json`. To keep it out of the file, put the server in a project's
`.mcp.json` with `"headers": { "Authorization": "Bearer ${PLCOS_MCP_TOKEN}" }` and export `PLCOS_MCP_TOKEN` in
the shell that starts Claude Code.

**Claude Desktop:** make a token as above, then add to
`~/Library/Application Support/Claude/claude_desktop_config.json` and restart Desktop:

```json
{ "mcpServers": { "capital-os": {
  "command": "/Users/jbenet/git/plc-os/plcos-claude-live/node_modules/.bin/tsx",
  "args": ["/Users/jbenet/git/plc-os/plcos-claude-live/scripts/mcp-stdio.ts"],
  "env": { "PATH": "/opt/homebrew/bin:/usr/bin:/bin",
           "PLCOS_MCP_URL": "http://localhost:3000/api/mcp", "PLCOS_MCP_TOKEN": "plcos_mcp_…" } } } }
```

The demo server takes the same steps on its own port (`:3001` on live), with a token made there.
