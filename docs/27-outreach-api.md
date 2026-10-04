# 27 — Outreach for juanmail: MCP tools, and a thin REST wrapper

**Status:** built on the branch `claude/outreach-api`, 4 Oct 2026; not merged or shipped.

**juanmail** is Juan's mail desk: an Outreach tab for the SPV war room now, a module of his mail client later. It runs
its own server, and all syncing between Capital OS and juanmail happens from there. It reads Capital OS and writes back
through Capital OS's own services, so every rule still applies. It asked for four things on 4 Oct 2026: the indicated
amount as a field, Capital OS's own words for its states, an API, and three rule changes Juan decided. Juan: "not
super hard requirements if there's something to adjust/push on, can adapt." What was adjusted is in §9.

**MCP is the interface** (Juan, 4 Oct: juanmail will use MCP). The outreach capabilities are tools on the existing
`/api/mcp` server (docs/26), behind the same token with an outreach scope. `/api/outreach/*` is a thin REST wrapper
over the same tools, for a client that would rather speak HTTP and JSON: each REST op runs one tool through the same
`runTool`, so the policy, scopes, budget and audit record are one.

## 1. IOI and the indicated amount

Juan: "wonder if IOI (indication of interest) and indicated amount (a single value or a range) could be fields we
associate with the LP in PLCOS".

- **Per LP per vehicle** (a pursuit), funds and SPVs alike: `low`, `high` (equal for one number), the date, and the
  source touchpoint — the email or call where they said it. `pipeline.indication` (migration
  `modules/pipeline/migrations/004_indication.sql`); the latest counts, earlier ones are kept as superseded.
- **Not soft money (rule 1).** Shown beside soft and hard on the LP page ("Indicated: $2.0M–$3.0M · …") and on the
  vehicle's status (its own figure), and never added to either: `vehicleTotals` does not read it, and
  `indicatedTotals` is its own object with no field for soft or hard. It becomes soft only when someone records a
  soft commitment on the close track.
- **The SPV seat's "IOI given" stays in step.** Recording an indication on an SPV moves an invited seat to IOI, with
  the date and the low end as the seat's amount (`close.syncIoi`); a seat at IOI with nothing recorded here reads as
  an indication, sourced "spv seat".
- **The LP page's update box records it.** The words are read (reader v2 reads "$3M", "$3M–4M", "3 to 5 million" as a
  range) and offered as an "Indicated" row with a checkbox, unticked: it is saved only when ticked. Ticked with a
  touchpoint, the indication is sourced to it. `outreach_update` does the same with `applied.indicated`.

## 2. Capital OS's own words

Every queue row returns three states apart, each with Capital OS's label, so juanmail invents none:

| Field | Values | Labels |
|---|---|---|
| `status` | `new` `sourcing` `selected` `connecting` `discussing` `committed` `passed` | New, Sourcing, Selected, Connecting, Discussing, Committed, Passed (docs/17) |
| `closeTrack.state` | `soft` `signed` `hard` `closed` (`withdrawn`) | Soft, Signed, Hard, Closed — with `amount` and `wired` beside it |
| `seat.stage` | `invited` `ioi` `allocated` `wired` `passed` | Invited, IOI given, Allocated, Wired, Passed |

## 3. Tokens, scopes, transport

- **The primary client is juanmail's server.** It holds one token with the outreach scope and calls Capital OS
  server to server, over https once Capital OS is on Railway. A device token (an iPad running the desk) is secondary
  and works the same way; so would any other server.
- **The token is an MCP token** (docs/26 §2): `plcos_mcp_…`, shown once, kept as a SHA-256. An Admin makes it in
  Preferences → MCP access with one of two presets — "Outreach desk: read the queue" (`outreach:read`) or "…read,
  record updates, ask for approvals, record sends" (`outreach:read` + `outreach:write`); read and write are separate
  grants. Name it for its client ("juanmail", "Juan's iPad mail desk"); each is revoked on its own; it expires in a
  week, a month, three months or a year. Preferences shows when each was last used and from what (its User-Agent).
- **Admin-made, Juan only, for now.** As with every MCP token, it never acts as an Admin: it is a GP on the owner's
  vehicles (or fewer), so licensed Dakota values never leave.
- **Every call acts as the token's owner** through `lib/authz`: reads are projections with every value behind `can()`
  (R1 amounts, R2 words and addresses, R4 restriction reasons); writes run the LP page's own rule
  (`app/targets/actions.ts#addUpdateAction`, the pursuit's vehicle from the record) and the real-data rule (changes
  only on the live server). Each call is one audit record (docs/26 §4) and counts against the token's budget.
- **Transport.** A bearer token is safe over https only. On Railway it is https. On the LAN today the Mac serves plain
  http, so a token from another device crosses the network readable: accept that on a trusted network, or reach the
  Mac over Tailscale, which encrypts it; on the Mac itself use `localhost`.
- **CORS** (the REST wrapper): a request with an `Origin` is refused unless it is this server's own or listed in
  `config.outreach.corsOrigins` — empty by default, exact origins, never a wildcard; never `Allow-Credentials`, since
  nothing reads a cookie. MCP refuses any cross-site Origin.

## 4. Read

| MCP tool | REST | Scope |
|---|---|---|
| `outreach_vehicles` | `GET /api/outreach/vehicles` | outreach:read |
| `outreach_queue` | `GET /api/outreach/queue?vehicle=…` | outreach:read |
| `audit_recent` | `GET /api/outreach/audit` | (any token) |

`outreach_vehicles` → the fund and SPV vehicles raising now that the token reads:

```json
{ "data": [{ "slug": "spv-cortex", "name": "SPV — Cortex", "kind": "spv", "exemption": "506(c)", "target": 8000000,
             "hard": 2500000, "soft": 0, "indicated": { "low": 3000000, "high": 3000000, "count": 1 },
             "windowEnds": "2026-11-30", "workingDaysLeft": 40,
             "seats": { "invited": 0, "ioi": 1, "allocated": 1, "wired": 1 }, "daysToWire": 30, "daysToWireN": 1 }],
  "coverage": { "note": "Hard, soft and indicated are separate figures and are never added together…" } }
```

`outreach_queue` takes `vehicle` (a slug, `all`, or `none`, which answers empty since every LP is on a vehicle),
`bucket`, `limit` (≤ 300, GUESS; 25 by default over MCP), `offset`, `pursuitId`, and **`updatedSince`**:

```json
{ "data": { "rows": [{
    "pursuitId": "…", "vehicle": "spv-cortex",
    "entity": { "id": "…", "name": "Invented Family Office", "kind": "org",
                "contacts": [{ "name": "Ana Invented", "email": "ana@invented.example", "source": "gmail", "confirmedAt": "2026-10-04", "confirmedBy": "Juan" }] },
    "owner": "Juan",
    "status": { "value": "discussing", "label": "Discussing", "setAt": "2026-10-01", "setBy": "Juan" },
    "nextStep": "Send the deck", "nextStepOn": "2026-10-08",
    "read": { "value": "interested", "label": "Interested", "on": "2026-10-01", "suggested": false },
    "strategy": { "headline": "They back neurotech founders. [health detail redacted]", "firstStep": "…", "confidence": "medium", "asOf": "2026-09-30" },
    "closeTrack": { "state": "soft", "label": "Soft", "amount": 1000000, "wired": 0, "called": null },
    "seat": { "stage": "ioi", "label": "IOI given", "amount": 3000000 },
    "indicated": { "low": 3000000, "high": 4000000, "at": "2026-10-03", "touchpointId": "…", "source": "us" },
    "otherVehicles": [{ "name": "PLC Neurotech I", "status": { "value": "discussing", "label": "Discussing" } }],
    "replyOwed": { "since": "2026-10-03" }, "lastTouch": { "kind": "email", "on": "2026-10-03", "direction": "theirs" },
    "checks": [
      { "rule": "restriction", "ok": true, "blocking": false, "detail": "No restriction on file." },
      { "rule": "accreditation", "ok": false, "blocking": false, "detail": "506(c): not verified yet… Needed before money moves, not before an invitation." },
      { "rule": "ask_count", "ok": false, "blocking": false, "detail": "2 asks made to them this quarter…; the cap is 1, advisory." },
      { "rule": "fund_first", "ok": false, "blocking": false, "detail": "An open fund discussion: PLC Neurotech I (Discussing)…", "choices": ["mention_both", "send_separately", "wait"] },
      { "rule": "wrap", "ok": true, "blocking": false, "detail": "506(c) × spv: covered by the wrap matrix…" }],
    "materials": [{ "assetId": "…", "title": "Cortex one-pager (LP memo)", "permittedUse": "accredited_only", "allowed": true }],
    "bucket": "reply_owed", "updatedAt": "2026-10-04T18:02:11Z" }],
  "total": 12, "offset": 0, "counts": { "reply_owed": 2, "money": 3, "invite": 5, "follow_up": 1, "held": 1 },
  "cursor": "2026-10-04T18:05:00Z", "redacted": "1 sentence with a health detail redacted." } }
```

- **Periodic sync.** Every answer has a `cursor` (the time it began reading). Pass it as the next call's
  `updatedSince`, and the queue answers only the LPs that changed since — status, next step, an update or an
  indication, a touchpoint, a strategy, the close track, the SPV seat, a restriction, a desk send, an address — each
  with `updatedAt`. Ids are stable (pursuit, entity, ticket, send); writes take idempotency keys. **Webhooks** are a
  later option, not built: polling the cursor is enough for one desk.
- **Buckets:** `held` (a blocking check fails), else `reply_owed` (they spoke last), `money` (committed, an indication,
  a close track not closed, or a seat at IOI or allocated), `invite` (new, sourcing or selected), `follow_up`.
- **Blocking checks:** a do-not-approach restriction (blanket, or on email), and no wrap rule for the vehicle. The ask
  cap and fund-before-SPV are advisory (§7); accreditation is needed before money, not before an invitation.
- **Small and fast:** the vehicle's pipeline rows come from the shared page cache (`pipelineData`); the bucket's inputs
  and the change poll are one query each for every row; the rest is read only for the page asked for.
- **Withheld:** amounts without R1, words and addresses without R2, restriction reasons without R4. Contacts and
  strategies from Dakota never appear. `called` is null: capital calls are not recorded yet.

## 5. Write

| MCP tool | REST | Risk (docs/26 §3) |
|---|---|---|
| `outreach_update` | `POST /api/outreach/update` | write-guarded |
| `outreach_request_ticket` | `POST /api/outreach/tickets` | propose, opens a ticket |
| `outreach_propose_contact` | `POST /api/outreach/contacts` | propose |
| `outreach_record_send` | `POST /api/outreach/sent` | send-adjacent, requires an approved ticket |

All need `outreach:write`. Over REST a refusal is `{ error }` with 400 (input), 403 (scope, access), 404 (not yours, or
no such), 409 (a rule refused: nothing was written) or 422 (the service refused); over MCP it is an error result with
the same message.

**`outreach_update`** — the LP page's update box, exactly (`lib/updates.ts`): one transaction, once per key. The
indicated amount is folded in here, not a tool of its own.

```json
{ "pursuitId": "…", "words": "Call today: they are thinking $3M-4M. Next: send the deck.",
  "applied": { "status": { "to": "discussing" }, "touch": { "channel": "call", "on": "2026-10-04", "read": "interested" },
               "nextStep": { "step": "Send the deck", "on": "2026-10-08" }, "indicated": { "low": 3000000, "high": 4000000 } },
  "idempotencyKey": "juanmail-2026-10-04-ana-1" }
```

juanmail sends only the boxes Juan ticked. **A status changes here only as a box Juan ticked**, through the same
service and guards as the LP page (Juan, 4 Oct 2026; docs/26 §3). A touchpoint that happened may propose a ladder rung
for approval (`ladderProposed`); nothing records a rung.

**`outreach_request_ticket`** — opens a SEND or INTRO_ASK ticket for a person to approve, and never approves it.

```json
{ "kind": "SEND", "pursuitId": "…", "assetId": "…optional",
  "scope": { "recipients": ["ana@invented.example"], "purpose": "invite", "note": "optional, ≤ 500" },
  "coordination": { "choice": "send_separately", "followUpOn": "2026-10-18" }, "idempotencyKey": "…optional" }
```

- The queue's checks run first; a blocking one refuses and opens nothing. With a material, the wrap check runs too
  (`content.proposeDeskSend`), and its `content.send` row keeps "wrong-wrap sends = 0" counting it.
- The ticket says exactly what it authorizes: one email from the owner's own mailbox, to these recipients, about this
  vehicle, once; it excludes any other recipient, a second send, other material, and statements about other
  vehicles. It expires in 3 days (GUESS). It is requested by the inactive **Mail desk** actor (platform 015), so the
  person who approves is never the requester; approving runs nothing.
- An SPV with an open fund discussion needs `coordination.choice`. `wait` opens no ticket; every choice records the
  overlap with a dated follow-up (default: today + `conflictWindowDays`).
- `INTRO_ASK` needs `connectorId` and goes through the routes page's own `proposeAsk`: the ask (owned by the token's
  owner), its guards, its ticket, and a conflict case if another vehicle's ask is in the way.

**`outreach_propose_contact`** — an address juanmail found in Gmail and Juan confirmed.

```json
{ "entityId": "…", "email": "ana@invented.example", "source": "gmail", "confirmedBy": "juan", "confirmedAt": "2026-10-04T18:00:00Z" }
```

Kept as a research claim with its source (`gmail:<owner>`) and confirmation date and person (rule 9). An address from
Affinity or research is never overwritten: both stay, and the answer lists what was kept (`kept`). Confirming the same
address again supersedes only the earlier Gmail confirmation. `confirmedBy` must be the token's owner.

**`outreach_record_send`** — juanmail sent it; record that, once.

```json
{ "ticketId": "…", "pursuitId": "…", "recipients": ["ana@invented.example"], "gmailMessageId": "18c…", "sentAt": "2026-10-04T18:05:00Z" }
```

Refused, nothing recorded, unless the ticket is a SEND juanmail opened, approved, unexpired, for this pursuit, the
recipients are within the approval, the ticket has not been used, and the send came after the approval. The same
message again answers `{ recorded: false, already: true }`; another message on the same ticket is refused. A
material's wrap check runs again. The email is logged as a touchpoint (ours, by email), so "waiting on their reply"
starts there.

## 6. Audit, and the later web client

Every call — MCP or REST — is one `mcp.call` record (docs/26 §4): the user, the token and its name (client
"juanmail"), the tool, its risk and scopes, a hash of the input and its ids, the outcome and reason, the latency, the
ids it touched, the idempotency key, and a **correlation id** juanmail passes (`_meta.correlationId`, or an
`X-Correlation-Id` header) so one workflow's chain of calls can be traced. Refusals are records too. Developer → Agent
activity filters them by client, tool and outcome; `audit_recent` returns juanmail's own; feedback about a call goes
through the feedback box on its page, or `file_feedback` with its `callId`. Everything is kept, for now.

**A web client** (planned, not built). A browser cannot keep a long-lived token safe. When juanmail has a web face, it
signs in through Capital OS's own session (LabOS later) and gets a short-lived token (minutes) with the outreach scope
and the fewest vehicles, renewed while the session lives — or it talks only to juanmail's server, which holds the
token. A browser origin calling Capital OS directly goes on `config.outreach.corsOrigins`.

## 7. The rule changes Juan decided (4 Oct 2026)

- **A tool may send** — juanmail, through MailGuard, one email per approved SEND ticket; Capital OS still sends
  nothing (docs/agent-rules/domain.md, rule 3 unchanged).
- **Fund before SPV is advisory.** "We have to pitch SPVs as we go." `config.guard.fundFirst = 'advisory'`: flagged with
  the choices, never held, and recorded with a dated follow-up (`coordination.overlap`, rule 5).
- **The ask cap is advisory.** `config.guard.askLimit = 'advisory'`: the coordination guard reports it beside its blocks
  and the Approvals page labels it so. TODO: if it comes back as a block, count per vehicle.
- **Status through MCP**, only as boxes Juan ticked (§5).
- **Owner:** Juan only; Admin-made tokens.

## 8. Drafting with Claude

Approved by Juan: LP strategy and timeline lines may go to the Claude API for drafting, with zero data retention and
no training; health details stay redacted. The rule, the definition of "health details", and the ZDR caveat (an
organization-level agreement to confirm for the key's organization) are in docs/agent-rules/real-data.md. Capital OS's
part is `lib/redact-health.ts`, applied to every text field the queue returns. No in-app drafter is built.

## 9. Adjusted from the request, and why

- **MCP tools first, REST as a wrapper; a bearer token, not the session cookie or loopback only.** juanmail uses MCP and
  runs on its own server; the app moves to Railway, and a server or a device has no cookie. Read and write are
  separate scopes.
- **The ticket's requester is a "Mail desk" actor, not Juan.** Capital OS forbids approving your own ticket; with Juan
  as juanmail's only owner and approver, tickets he asked for could never be approved. The tool proposes, a person
  approves, and the token, client and owner are in the ticket's basis and the audit.
- **`outreach_record_send` was added.** The request asked that Capital OS "accept the desk marking a ticket's send as
  done"; it is its own tool with the checks above, so a send is recorded only against its own approval.
- **An SPV choice is required when a fund discussion is open.** Advisory, but never silent.
- **The indicated amount is part of `outreach_update`**, not a separate tool: it is a box in the same update.
- **The queue's shape:** `data.rows` with `total`, `counts` and a `cursor`, so polling and paging share one answer.
- **`vehicle=none`** answers empty; **`closeTrack.called`** is null (capital calls aren't recorded); `amount` was added.
- **Contacts are research claims** (rule 9's provenance), not a new contacts table.

## 10. Open for Juan

1. **ZDR:** confirm the API key juanmail uses belongs to an Anthropic organization with zero data retention.
2. **Approving your own desk's tickets:** today Juan approves what juanmail asks for. A two-person rule would need a
   second approver for SEND.
3. **INTRO_ASK sends:** `outreach_record_send` records SEND tickets only. Should juanmail also record an intro ask it
   emailed (Capital OS's `makeAsk`)?
4. **Rate of sends:** MailGuard rate-limits juanmail; Capital OS limits calls, not sends. A cap per day here?
5. **Webhooks**, if polling the cursor turns out too slow or too costly.

## 11. Tests

Properties (`scripts/properties/outreach*.ts`, `mcp.ts`; invented data, through the real handlers): an indication is
never summed into soft or hard, keeps the seat in step, and is recorded only when ticked; the registry's policy holds
(nothing sends, decides a ticket or moves money; send- and ticket-named tools need approval); outreach tools exist for
a token only with the scope, writes only with outreach:write; a vehicle-limited token reads no other vehicle;
restricted and licensed values never appear; labels come back apart; fund-before-SPV and the ask cap flag without
blocking, a restriction holds; health details are redacted and theses are not; CORS refuses every origin off the
allowlist; every call — MCP or REST, refusals too — writes one structured record; `audit_recent` answers only your own
calls, by correlation id; `updatedSince` answers only what changed; `outreach_update` is the update box once per key;
desk tickets are requested by the inactive actor and never approved by the tool; a send is recorded only against an
approved, unexpired, unused ticket for that LP and those recipients, once; overlaps are dated; contacts never overwrite
Affinity. End to end (`scripts/e2e.ts`): a desk token over REST, and a juanmail token with the MCP SDK client, each
reading and writing on the demo, refused a send before approval, and traced by correlation id.
