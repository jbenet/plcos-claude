# 27 — Outreach for juanmail: MCP tools, and a thin REST wrapper

**Status:** built on the branch `claude/outreach-api`, 4 Oct 2026. Revised on `claude/comms-trace`, 5 Oct 2026, for three
decisions of Juan's (§7a): no SEND or INTRO_ASK tickets for people, only for autonomous agents; "record the send" became
"link the message"; the outreach timeline is built from the comms trace. Not merged or shipped.

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
| `comms_trace` | `GET /api/outreach/trace?pursuitId=…` | outreach:read |
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
    "trace": {
      "last": [{ "on": "2026-10-03", "kind": "email", "direction": "theirs", "source": "gmail", "sourceLabel": "Gmail, via juanmail",
                 "subject": "Re: the deck", "team": ["Juan"], "sameAs": [] },
               { "on": "2026-10-01", "kind": "email", "direction": "ours", "source": "affinity", "sourceLabel": "Affinity",
                 "subject": "The deck", "team": ["Juan"], "sameAs": [{ "source": "gmail", "by": "date and participants", "confidence": "medium" }] }],
      "owes": { "by": "us", "since": "2026-10-03" },
      "thread": { "subject": "Re: the deck", "team": ["Juan", "Mara"], "holder": "Juan", "messages": 3, "last": "2026-10-03" },
      "mismatches": [{ "kind": "linked_not_in_trace", "at": "2026-09-30", "text": "Juan's mail desk linked a message sent 2026-09-30 that the mail trace has not shown yet." }] },
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
  indication, a touchpoint, a strategy, the close track, the SPV seat, a restriction, a desk send, an address, a
  message in the comms trace or a link — each with `updatedAt`.
- **The trace, not the log (5 Oct 2026).** `replyOwed`, `lastTouch` and `trace` come from the merged comms trace (§6a):
  Affinity's records and the Gmail messages juanmail reported, one row per message. `trace.owes` says who owes the
  next word; `trace.thread` who on the team is on the latest thread and who holds it (sent our latest message in it);
  `trace.mismatches` where the app's own log — a link the trace has not shown, an email logged by hand the mail
  doesn't show — disagrees with it. Subjects are R2 words, health-redacted. Ids are stable (pursuit, entity, ticket, send); writes take idempotency keys. **Webhooks** are a
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
| `outreach_request_ticket` | `POST /api/outreach/tickets` | propose, opens a ticket — for an autonomous call only |
| `outreach_propose_contact` | `POST /api/outreach/contacts` | propose |
| `outreach_link_message` | `POST /api/outreach/link` | send-adjacent; an autonomous send needs an approved ticket (`agent-only`) |
| `comms_ingest` | `POST /api/outreach/comms` | send-adjacent; metadata only, no ticket |
| `outreach_record_send` (deprecated) | `POST /api/outreach/sent` | the old arguments, run as `outreach_link_message`; removed next release |

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

**Autonomous or not (5 Oct 2026).** A call acts for the token's owner interactively — a person clicked — unless it says
otherwise: `_meta.autonomous: true` on an MCP call, `X-Autonomous: 1` on a REST one, or a token whose list carries
`mode:autonomous`. A call can add the flag, never remove it. Only an autonomous call needs a ticket; juanmail sets the
flag when it runs a batch with no human click, and never when Juan pressed send. Every audit record says which.

**`outreach_request_ticket`** — for an autonomous call: opens a SEND or INTRO_ASK ticket for a person to approve, and
never approves it. Called for a person, it opens nothing and answers `{ opened: false, needed: false, checks }` — the
queue's checks, a restriction among them — and records an SPV's coordination choice if one is given.

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

**`outreach_link_message`** — juanmail sent (or read) one message about one LP; link it. Was `outreach_record_send`.

```json
{ "pursuitId": "…", "gmailMessageId": "18c…", "threadId": "18b…", "messageId": "<CAF…@mail.gmail.com>", "date": "2026-10-04T18:05:00Z",
  "direction": "sent", "from": "juan@…", "to": ["ana@invented.example"], "cc": [], "subject": "The SPV", "ticketId": "…optional" }
```

- **It creates no outreach state.** No touchpoint, status, rung or ticket: the email trail is the record (§6a). The link
  is an audit of what the desk did — its `outreach.message_linked` entry carries the ids, the date, the direction and
  counts, never the words — matched to the message in the trace by Message-ID. Until the trace shows the message
  (`comms_ingest`, or Affinity's next read), the LP page and the queue flag the link.
- **Once, by Message-ID** (else the Gmail id): the same message again answers `{ linked: false, already: true }`; a
  message already linked to another LP is refused.
- **A ticket only for an agent.** A sent message from an autonomous call needs an approved, unexpired, unused SEND (or
  INTRO_ASK) ticket for this LP whose recipients cover the to and cc, dated after the approval — named, or found among
  the LP's approved agent tickets — or it is refused and nothing is linked. A person's link needs none; if an approved
  agent ticket covers it, it is linked and marked used all the same. A used SEND ticket records its Gmail id on
  `email.outreach_send`; an INTRO_ASK's ask is recorded as made, by email, through the ask's own service and guards.
  A material's wrap check runs again.
- **No body** unless `body` is sent explicitly; it is never needed.

**`outreach_record_send`** (deprecated, one release): the 4 Oct arguments — `ticketId`, `pursuitId`, `recipients`,
`gmailMessageId`, `sentAt` — run as `outreach_link_message` (from the owner's address, direction sent). It no longer
logs a touchpoint.

**`comms_ingest`** — the messages juanmail sees in Gmail, sent and received, up to 100 a call.

```json
{ "messages": [{ "messageId": "<CAF…@mail.gmail.com>", "gmailMessageId": "18c…", "threadId": "18b…", "date": "2026-10-04T18:05:00Z",
                 "direction": "received", "from": "ana@invented.example", "to": ["juan@…"], "cc": [], "subject": "Re: The SPV", "pursuitId": "…optional" }] }
```

Metadata only, never a body. Each message is matched to the people (and their current firms) its outside addresses
belong to — email claims on record, never licensed ones — and to the LP juanmail names, if it names one; a message
with nobody on record is not kept (`unmatched`). What it is about is read from its subject and addresses by the
Affinity rule (N59); named with a pursuit, it counts for that vehicle. **Idempotent by Message-ID** (case and brackets
aside), so two mailboxes reporting one message make one row. **Writes nothing else**: no touchpoint, status, rung,
update or ticket. Answers `{ new, already, unmatched, messages }`.

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

## 6a. The comms trace (5 Oct 2026)

Juan: "as much as possible we should record all this stuff from events directly in email and let email be the state.
we may need to record info happened outside of email but that should be a note ... let the actual comms trace reveal
what happened ... im not against logging this stuff, but you'll have to reconcile with actual comms anyway".

- **One merged timeline per LP** (`lib/comms/trace.ts`, pure; `lib/comms/read.ts`): Affinity's emails, meetings and
  calls (`meetings.meeting`), the Gmail messages juanmail reported (`email.comms_message`, email 020), and the notes —
  PLC OS updates and context notes, Affinity's notes, Linear issues linked to the pursuit — each labelled by source.
  The LP page's timeline shows it; `comms_trace` returns it; the queue returns each row's summary (§4).
- **De-duplicated.** A Gmail message and a record with the same Message-ID are one (`exact`). Affinity keeps neither a
  Message-ID nor a subject for an email, only its day, direction and who on the team was on it, so a Gmail message
  matches an Affinity email of the same day and direction with a teammate in common (`medium`, "date and
  participants"), or with none known (`low`, "date"); a logged-here email of the day before or after, the same way; two
  mailboxes' copies of a message without a Message-ID, by minute, sender, recipients and subject (`high`). Each
  record matches at most one message, the surest and nearest first, ties by id, so **the merge is stable**: the same
  records in any order give the same trace, and merging again changes nothing (a property). The row shown is the
  other source's, with "also in Gmail (by …, medium)".
- **Last touch, who owes a reply, who holds the thread** are read from the merged trace, not from the app's logs.
- **The app's logs stay an audit.** Where one disagrees with the trace — a link the trace has not shown; an agent's send
  with no ticket; an email logged here that the mail does not show (judged only once Gmail covers the LP) — the trace
  is shown and the disagreement flagged ("Log and trace" on the timeline, the context panel, `trace.mismatches`).
- **Off-email events are notes**, through the update box as before; the trace shows them labelled PLC OS.
- **Coverage.** A mailbox juanmail does not read, and Affinity has not synced, is not in it: every answer says what it
  covered, and absence there is not absence in the world (rule 7).

## 7a. The rule changes Juan decided (5 Oct 2026)

- **No SEND or INTRO_ASK tickets for people; for autonomous agents only** (rule 3, docs/agent-rules/domain.md;
  AGENTS.md invariant 3). A person sees the context instead: the LP page's "Before you send" panel above the Email card,
  the routes page's intro-ask box, and the queue rows' `trace` and `checks` — last touches dated with direction and
  source, who owes a reply, the other vehicles and their status, who on the team is in the thread, restrictions in red,
  and the material's wrap and 506(c) flags. An agent's tickets are approved singly or as a batch (Approvals → "Approve
  the agent's sends together", `decideAgentBatch`). MONEY, STAGE and ALLOCATION_EXCEPTION are unchanged; none blocks a
  person's ordinary outreach.
- **"Record the send" became "link the message"** (`outreach_link_message`, §5); the old name is an alias for one release.
- **The outreach timeline is built from the comms trace** (§6a), with `comms_ingest` and `comms_trace`.

## 7. The rule changes Juan decided (4 Oct 2026)

- **A tool may send** — juanmail, through MailGuard; Capital OS still sends nothing. (On 4 Oct: one email per approved
  SEND ticket. Since 5 Oct, only when juanmail acts autonomously, §7a.)
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
2. **Approving your own desk's tickets:** today Juan approves what juanmail asks for when it acts on its own. A
   two-person rule would need a second approver for an autonomous SEND.
3. ~~INTRO_ASK sends~~ — answered 5 Oct: `outreach_link_message` with an INTRO_ASK ticket records the ask made, by email.
4. **Rate of sends:** MailGuard rate-limits juanmail; Capital OS limits calls, not sends. A cap per day here?
5. **Webhooks**, if polling the cursor turns out too slow or too costly.
6. **Marking a token autonomous in Preferences.** The flag works on a call today; a token is marked by `mode:autonomous`
   in its list, which Preferences cannot set yet (the settings pages are the deploy branch's this week). Add the
   checkbox there when that branch lands.

## 11. Tests

Since 5 Oct 2026 (`scripts/properties/comms.ts`, `outreach-writes.ts`): a person's ask, material send and link need no
ticket, and an autonomous one is refused without an approved one (asks, materials, MCP and REST links); a link is
idempotent and creates no touchpoint, status, update or ticket; `comms_ingest` is idempotent by Message-ID, keeps no
message with nobody on record, writes nothing else, and is merged with Affinity's record of the same email; the merge
is stable under reordering and re-merging; who owes a reply and who holds the thread come from the trace; mismatches
are flagged; a restriction is always surfaced, to a Viewer as a flag with its reason withheld. End to end: the LP page's
context panel (restriction, who owes, the Gmail thread), and juanmail's MCP chain — ingest, the trace, a person's link,
an autonomous link refused, the ticket asked for autonomously and approved in a batch, then linked.

As built on 4 Oct:

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
