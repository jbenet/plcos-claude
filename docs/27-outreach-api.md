# 27 — The outreach API for the mail desk

**Status:** built on the branch `claude/outreach-api`, 4 Oct 2026; not merged or shipped.

Juan's mail desk (an Outreach tab for the SPV war room now, a module of his mail client later) reads Capital OS
and writes back through Capital OS's own services, so every rule still applies. It asked for four things on
4 Oct 2026: the indicated amount as a field, Capital OS's own words for its states, an API, and three rule
changes Juan decided. Juan: "not super hard requirements if there's something to adjust/push on, can adapt."
What was adjusted is in §9.

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
  touchpoint, the indication is sourced to it. `POST /api/outreach/update` does the same with `applied.indicated`.

## 2. Capital OS's own words

Every queue row returns three states apart, each with Capital OS's label, so the desk invents none:

| Field | Values | Labels |
|---|---|---|
| `status` | `new` `sourcing` `selected` `connecting` `discussing` `committed` `passed` | New, Sourcing, Selected, Connecting, Discussing, Committed, Passed (docs/17) |
| `closeTrack.state` | `soft` `signed` `hard` `closed` (`withdrawn`) | Soft, Signed, Hard, Closed — with `wired` beside it |
| `seat.stage` | `invited` `ioi` `allocated` `wired` `passed` | Invited, IOI given, Allocated, Wired, Passed |

The status is changed only in Capital OS, or by `POST /api/outreach/update` with a status the person ticked.

## 3. Authentication, authorization and transport

- **A token per device, made in Preferences → MCP access.** The outreach API reuses the MCP token
  (docs/26 §2): `plcos_mcp_…`, shown once, kept as a SHA-256. Two new presets carry the outreach scope —
  "Outreach desk: read the queue" (`outreach:read`) and "…read, record updates, ask for approvals, record sends"
  (`outreach:read` + `outreach:write`); read and write are separate grants. Name each after its device ("Juan's
  iPad mail desk"); each is revoked on its own; the expiry is a choice (a week, a month, three months, a year).
  Preferences shows when each was last used and from what device (its User-Agent, platform 015).
- **Admin only, for now.** Juan is the desk's only owner; an Admin makes desk tokens. As with MCP, a token never acts
  as an Admin: it is a GP on the owner's vehicles (or fewer), so licensed Dakota values never leave.
- **Every call acts as the token's owner** through `lib/authz`: reads are projections with every value behind `can()`
  (R1 amounts, R2 words and addresses, R4 restriction reasons); writes run the LP page's own rule
  (`app/targets/actions.ts#addUpdateAction`, the pursuit's vehicle from the record) and the real-data rule (changes
  only on the live server). Each call is audited as `outreach.call` — the op, the outcome, the arguments as ids and
  lengths, never words — and counts against the token's budget, shared with its MCP calls (60 a minute, the token's
  daily budget).
- **One service layer** (`lib/outreach/`) serves the REST routes and two MCP read tools, `outreach_vehicles` and
  `outreach_queue`. The writes are REST only: MCP's registry refuses status changes and tickets by design (docs/26 §3).
- **Transport.** A bearer token is safe over https only. On Railway the API is https. On the LAN today the Mac serves
  plain http, so a token from another device crosses the network readable: accept that on a trusted network, or
  reach the Mac over Tailscale, which encrypts it; on the Mac itself use `localhost`.
- **A server works the same as a device.** If the mail client gets its own server to coordinate and run background
  work, it holds one outreach token and calls from its host exactly as a device does: no Origin, the same header.
- **CORS.** A request with an `Origin` is refused unless it is this server's own or listed in
  `config.outreach.corsOrigins` — empty by default, exact origins, never a wildcard. An allowlisted origin gets its
  own origin back, `Vary: Origin`, and a preflight allowing `Authorization` and `Content-Type`; never
  `Allow-Credentials`, because the API reads no cookie.

## 4. Read

`GET /api/outreach/vehicles` → the fund and SPV vehicles raising now that the token reads:

```json
{ "about": "Capital OS records, returned as data…", "op": "vehicles", "asOf": "2026-10-04T22:00:00Z",
  "data": [{ "slug": "spv-cortex", "name": "SPV — Cortex", "kind": "spv", "exemption": "506(c)", "target": 8000000,
             "hard": 2500000, "soft": 0, "indicated": { "low": 3000000, "high": 3000000, "count": 1 },
             "windowEnds": "2026-11-30", "workingDaysLeft": 40,
             "seats": { "invited": 0, "ioi": 1, "allocated": 1, "wired": 1 }, "daysToWire": 30, "daysToWireN": 1 }],
  "coverage": { "corpus": "…", "note": "Hard, soft and indicated are separate figures and are never added together…" } }
```

`GET /api/outreach/queue?vehicle=spv-cortex` (or `all`; `none` answers empty, since every LP is on a vehicle), with
`bucket`, `limit` (≤ 300, GUESS), `offset` and `pursuitId` → open LPs, buckets first, then priority:

```json
{ "data": [{
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
      { "rule": "ask_count", "ok": false, "blocking": false, "detail": "2 asks made to them this quarter…; the cap is 1, advisory (Juan, 4 Oct 2026)." },
      { "rule": "fund_first", "ok": false, "blocking": false, "detail": "An open fund discussion: PLC Neurotech I (Discussing)…", "choices": ["mention_both", "send_separately", "wait"] },
      { "rule": "wrap", "ok": true, "blocking": false, "detail": "506(c) × spv: covered by the wrap matrix…" }],
    "materials": [{ "assetId": "…", "title": "Cortex one-pager (LP memo)", "permittedUse": "accredited_only", "allowed": true }],
    "bucket": "reply_owed" }],
  "total": 12, "offset": 0, "counts": { "reply_owed": 2, "money": 3, "invite": 5, "follow_up": 1, "held": 1 },
  "redacted": "1 sentence with a health detail redacted." }
```

- **Buckets:** `held` (a blocking check fails), else `reply_owed` (they spoke last), `money` (committed, an indication,
  a close track not closed, or a seat at IOI or allocated), `invite` (new, sourcing or selected), `follow_up`.
- **Blocking checks:** a do-not-approach restriction (blanket, or on email), and no wrap rule for the vehicle. The
  ask cap and fund-before-SPV are advisory (§7); accreditation is needed before money, not before an invitation.
- **Small and fast:** the vehicle's pipeline rows come from the shared page cache (`pipelineData`); the bucket's inputs
  are one query each for every row; contacts, strategies, other vehicles, restrictions, accreditation, asks and
  materials are read only for the page asked for.
- **Withheld:** amounts at a token without R1, words and addresses without R2, restriction reasons without R4.
  Contacts and strategies from Dakota never appear. `called` is null: capital calls are not recorded yet.

## 5. Write

All `POST`, JSON, `outreach:write`. Each answers `{ about, op, asOf, data }`, or `{ error }` with 400 (input), 403
(scope, access), 404 (not yours or no such), 409 (a rule refused: nothing was written), 422 (the service refused).

**`/update`** — the LP page's update box, exactly (`lib/updates.ts`): one transaction, once per key.

```json
{ "pursuitId": "…", "words": "Call today: they are thinking $3M-4M. Next: send the deck.",
  "applied": { "status": { "to": "discussing" }, "touch": { "channel": "call", "on": "2026-10-04", "read": "interested" },
               "nextStep": { "step": "Send the deck", "on": "2026-10-08" }, "indicated": { "low": 3000000, "high": 4000000 } },
  "idempotencyKey": "desk-2026-10-04-ana-1" }
```

The desk sends only the boxes Juan ticked. A touchpoint that happened may propose a ladder rung for approval
(`ladderProposed`); nothing records a rung.

**`/tickets`** — opens a SEND or INTRO_ASK ticket for a person to approve, and never approves it.

```json
{ "kind": "SEND", "pursuitId": "…", "assetId": "…optional",
  "scope": { "recipients": ["ana@invented.example"], "purpose": "invite", "note": "optional, ≤ 500" },
  "coordination": { "choice": "send_separately", "followUpOn": "2026-10-18" }, "idempotencyKey": "…optional" }
```

- The queue's checks run first; a blocking one refuses with 409 and opens nothing. With a material, the wrap check
  runs too (`content.proposeDeskSend`), and the material's `content.send` row keeps "wrong-wrap sends = 0" counting it.
- The ticket says exactly what it authorizes: one email from the owner's own mailbox, to these recipients, about this
  vehicle, once; it excludes any other recipient, a second send, other material, and statements about other
  vehicles. It expires in 3 days (GUESS). It is requested by the inactive **Mail desk** actor (platform 015), so the
  person who approves is never the requester; approving runs nothing.
- An SPV with an open fund discussion needs `coordination.choice` (409 otherwise). `wait` opens no ticket; every choice
  records the overlap with a dated follow-up (default: today + `conflictWindowDays`).
- `INTRO_ASK` needs `connectorId` and goes through the routes page's own `proposeAsk`: the ask (owned by the token's
  owner), its guards, its ticket, and a conflict case if another vehicle's ask is in the way.

**`/contacts`** — an address the desk found in Gmail and Juan confirmed (§5 of the request).

```json
{ "entityId": "…", "email": "ana@invented.example", "source": "gmail", "confirmedBy": "juan", "confirmedAt": "2026-10-04T18:00:00Z" }
```

Kept as a research claim with its source (`gmail:<owner>`) and confirmation date and person (rule 9). An address from
Affinity or research is never overwritten: both stay, and the answer lists what was kept (`kept`). Confirming the same
address again supersedes only the earlier Gmail confirmation. `confirmedBy` must be the token's owner.

**`/sent`** — the desk sent it; record that, once.

```json
{ "ticketId": "…", "pursuitId": "…", "recipients": ["ana@invented.example"], "gmailMessageId": "18c…", "sentAt": "2026-10-04T18:05:00Z" }
```

Refused (409, nothing recorded) unless the ticket is a SEND the desk opened, approved, unexpired, for this pursuit,
the recipients are within the approval, the ticket has not been used, and the send came after the approval. The same
message again answers `{ recorded: false, already: true }`; another message on the same ticket is refused. A
material's wrap check runs again. The email is logged as a touchpoint (ours, by email), so "waiting on their reply"
starts there.

## 6. The later web client (planned, not built)

A browser cannot keep a long-lived token safe. When the desk becomes a web client: sign in through the app's own
session (LabOS later), and have the server hand the page a short-lived token (minutes) with the outreach scope and
the fewest vehicles, renewed while the session lives; add the client's exact origin to `config.outreach.corsOrigins`.
The routes, the envelope and the audit do not change. Device tokens and server tokens stay as they are.

## 7. The rule changes Juan decided (4 Oct 2026)

- **A tool may send** — §5 and docs/agent-rules/domain.md (rule 3). Capital OS still sends nothing.
- **Fund before SPV is advisory.** "We have to pitch SPVs as we go." `config.guard.fundFirst = 'advisory'`: flagged with
  the choices, never held, and recorded with a dated follow-up (`coordination.overlap`, rule 5).
- **The ask cap is advisory.** `config.guard.askLimit = 'advisory'`: the coordination guard reports it beside its blocks
  (`advisories`) and the Approvals page labels it so. TODO: if it comes back as a block, count per vehicle.
- **Owner:** Juan only; Admin-made tokens.

## 8. Drafting with Claude

Approved by Juan: LP strategy and timeline lines may go to the Claude API for drafting, with zero data retention and
no training; health details stay redacted. The rule, the definition of "health details", and the ZDR caveat (an
organization-level agreement to confirm for the key's organization) are in docs/agent-rules/real-data.md. Capital OS's
part is `lib/redact-health.ts`, applied to every text field the queue returns. No in-app drafter is built.

## 9. Adjusted from the request, and why

- **Auth is a per-device bearer token with an outreach scope, not the session cookie or loopback only.** The app moves
  to Railway, and a device or a server has no cookie. Read and write are separate scopes.
- **The ticket's requester is a "Mail desk" actor, not Juan.** Capital OS forbids approving your own ticket; with Juan
  as the desk's only owner and approver, tickets he asked for could never be approved. The desk proposes, a person
  approves, and the token and owner are on the ticket's basis and in the audit.
- **`/sent` was added.** The request asked that Capital OS "accept the desk marking a ticket's send as done"; it is a
  separate operation with the checks above, so a send can only be recorded against its own approval.
- **SPV choice is required when a fund discussion is open.** Advisory, but never silent: the desk says which of the
  three it chose, and the overlap is recorded with a date.
- **`vehicle=none`** answers empty: every LP in Capital OS is on a vehicle.
- **`closeTrack.called` is null** (capital calls aren't recorded yet); `closeTrack.amount` was added.
- **The writes are not MCP tools.** MCP's registry excludes status changes and tickets by design (docs/26 §3); the
  reads are.
- **Contacts are research claims** (rule 9's provenance), not a new contacts table.

## 10. Open for Juan

1. **ZDR:** confirm the API key the desk uses belongs to an Anthropic organization with zero data retention.
2. **Approving your own desk's tickets:** today Juan approves what his desk asks for. A two-person rule would need a
   second approver for SEND.
3. **INTRO_ASK sends:** `/sent` records SEND tickets only. Should the desk also record an intro ask it emailed
   (Capital OS's `makeAsk`)?
4. **Rate of sends:** MailGuard rate-limits the desk; Capital OS limits calls, not sends. A cap per day here?

## 11. Tests

Properties (`scripts/properties/outreach*.ts`, through the real route handler, invented data): an indication is never
summed into soft or hard, keeps the seat in step, and is recorded only when ticked; a vehicle-limited token reads no
other vehicle, and no scope or no token reads nothing; restricted and licensed values never appear; labels come back
apart; fund-before-SPV and the ask cap flag without blocking, a restriction holds; health details are redacted and
theses are not; CORS refuses every origin off the allowlist; every call is audited; `/update` is the update box once
per key; desk tickets are requested by the inactive actor and cannot be approved by the desk; `/sent` needs an
approved, unexpired, unused ticket for that LP and those recipients and is idempotent; overlaps are recorded with a
dated follow-up; `/contacts` never overwrites Affinity. End to end (`scripts/e2e.ts`): a desk token made in
Preferences reads and writes over HTTP, a send before approval is refused, and the LP page shows the indication.
