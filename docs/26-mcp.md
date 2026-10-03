# 26 — MCP access to Capital OS

**Status:** phase 1 built on the branch `claude/mcp`, 2 Oct 2026; not merged or shipped.

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

## 3. Tools

The registry is `lib/mcp/tools.ts`. A name absent there does not exist; a token calls only the names it lists.

| Tool | Kind | What it answers | Needs |
| --- | --- | --- | --- |
| `search` | read | People and organisations by name, the pursuits on your vehicles (status, owner), do-not-approach | any |
| `lp_summary` | read | One LP on one vehicle: status, evidence, contact dates, latest strategy, open amounts (hard and soft apart), restrictions, top routes | the vehicle |
| `routes_to` | read | Warm-intro routes to a target for a vehicle, by evidence tier, with coverage | the vehicle |
| `routes_through` | read | Whom X could introduce us to, our route to X, LPs reachable only through X | every vehicle |
| `pipeline` | read | A vehicle's LPs by status, counts, owner, next step, last touch | the vehicle |
| `target_lists` | read | Open LPs on a strategy list: this year's close, 2027, not now, none | words on the vehicle |
| `replies_owed` | read | LPs who spoke last with nothing from us since; LPs at Connecting waiting on a first reply | words on the vehicle |
| `feedback_issues` | read | Open issues, or one in full (a Viewer gets no body) | any |
| `changelog` | read | The latest entries, or one entry's text | any |
| `create_email_draft` | draft | A first message or an intro ask, saved in the app for its owner; not moved to Gmail, not sent | GP on the vehicle |
| `file_feedback` | draft | An issue, journaled like the feedback box; only the live app files | any GP |

A scoped GP's token reads only their vehicles. `search` leaves out LPs found only elsewhere and counts them; an LP
it does show names the other vehicles it is on, with owner and no status, as the pages do (rule 5). Every list
says what it covered and as of when (rule 7); an empty route list says it is not proof that no route exists.

**Phase 2 writes (planned, not built).** `update_email_draft` (one's own, with the revision check);
`propose_move` and `propose_task` — written as proposals, accepted by a person in the app with the existing
idempotency key, never by the tool; `add_note` (a context note, authored by the token's owner, on a vehicle).

**Excluded, and why.**

- **Any send** — email, intro ask, materials — and **moving a draft to Gmail**. Rule 3 (SEND, INTRO_ASK) and
  AGENTS.md: no tool sends anything. A move puts the words one click from sent; the person clicks Move in the app.
- **Approvals, ticket decisions, accepting a suggestion or a run.** No tool accepts its own proposed task; acceptance
  is a person's act with an idempotency key.
- **Status changes behind a ticket** (a ladder rung is a STAGE ticket, rule 3), and in phase 1 the pipeline status
  too: it is a person's plan (docs/17). An agent may propose one in phase 2.
- **Money and allocation** — recording a wire, hardening soft to hard, allocation exceptions: MONEY and
  ALLOCATION_EXCEPTION tickets, rule 10, Admin only.
- **Imports, connector runs, workflow runs, merges, roster and weights.** Admin operations on the live server,
  recorded in the run ledger, some holding keys (Affinity, Dakota, Linear) that must not be reachable from an
  agent's session; long-running, and not undone by a person reading a receipt.

A property enumerates the registry and fails if a tool of any other kind appears, if a name reads like one of these
acts, or if `lib/mcp/` mentions a service that performs one (`moveDraft`, `setPursuitStatus`, `recordWire`, …).

## 4. Safety

- **Work envelope** (AGENTS.md, Agent rules). The token row is the envelope: scope = the owner's vehicles narrowed by
  the token's; allowed commands = its tools; budget = calls a minute and a day; deadline = its expiry; escalation
  owner = its owner; no acceptance criteria, because nothing is accepted. Every call is checked before the tool runs
  (`lib/mcp/envelope.ts`) and refused with the reason when outside it.
- **Audit.** Every call writes `mcp.call` to `platform.audit_log`: the token, the owner, the tool, the outcome
  (ok, refused, rate_limited, invalid, error), time, bytes, and the arguments — ids and fixed choices kept, typed
  text only as its length, so no words reach the log. `mcp.token_created`, `mcp.token_revoked`, and `mcp.refused`
  for a revoked, expired or inactive token. A draft also writes its own `email.draft_created`, as the owner.
- **Rate.** 60 calls a minute (GUESS) and 2,000 a day (GUESS) per token, in memory; after a restart the day's count
  is read back from the audit log.
- **Data, not instructions.** Record text — a strategy, a note, an issue, a name — is written by people and outside
  sources and can carry an injected instruction. Every answer is JSON whose first field says so, and the server's
  instructions repeat it. Words filled into a draft from the records are not echoed back.
- **Size.** Requests up to 256 KB; answers up to 60 KB, with the longest lists halved until they fit and strings cut
  at 4,000 characters, marked as cut; at most 100 rows a call, paged with `offset`. All GUESSES, in `config.mcp`.
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
3. In Claude Code, `/mcp` lists `capital-os` with 9 tools (or 11). Ask, for example, "Which LPs on PLC Neurotech
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
