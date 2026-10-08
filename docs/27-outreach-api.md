# 27 — Outreach for juanmail: MCP tools, and a thin REST wrapper

**Status:** shipped. Built on `claude/outreach-api` (4 Oct 2026) and revised on `claude/comms-trace` for three decisions of
Juan's (§7a): no SEND or INTRO_ASK tickets for people, only for autonomous agents; "record the send" became "link the
message"; the outreach timeline is built from the comms trace. Both are on master since 4 Oct 2026 (merge `89a710f`), so
they ship with it: the MCP tools, the REST wrapper, the queue, the writes, the comms trace. juanmail's second round of
feedback — ids and addresses on route hops and REST for routes (§4a), `top_connectors` (§4b), passed LPs on request, the
queue's explicit limit and cursor paging and the close track's dates (§4), `_meta.status` on MCP errors and the fixed "not
the live server" sentence (§5) — merged on 5 Oct 2026 (`648e03b`) and is live on `deploy` at `0b3715e`. **Built on
`claude/outreach-desk-v3`, 5 Oct 2026, not merged yet:** its third round — `askFirst` on every route (§4a); first-hop and
deeper counts, `reachableDirectly`, `firstHopOnly` and ask history on `top_connectors` (§4b); one connector's targets
(§4c); one message linked to several LPs (§5); and the close track's `signedCount` (§4).

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
| `outreach_contacts` | `GET /api/outreach/contacts?vehicle=…[&updatedSince=…&ifChanged=…&includePassed=1]` (§4d) | outreach:read |
| `top_connectors` | `GET /api/outreach/connectors?vehicle=…&limit=…[&firstHopOnly=1]` (§4b) | outreach:read |
| `top_connectors` with `entityId` | `GET /api/outreach/connectors?vehicle=…&entityId=…[&limit=…&cursor=…]` (§4c) | outreach:read |
| `routes_to` | `GET /api/outreach/routes-to?entityId=…&vehicle=…` (§4a) | the tool's name in the token, as over MCP |
| `routes_through` | `GET /api/outreach/routes-through?entityId=…[&vehicle=…]` (§4a) | the tool's name in the token, as over MCP |
| `search` | `GET /api/outreach/search?query=…[&kind=person\|org&limit=…]` (§4a) | the tool's name in the token, as over MCP |
| `audit_recent` | `GET /api/outreach/audit` | (any token) |

Every REST answer is `{ about, op, tool, asOf, coverage, data }`, and `data` is exactly what the MCP tool answers in its
`data` (a property checks this for the routes and top_connectors). A REST query names the target `entityId`; the MCP tools
take it as `targetId` (routes_to) and `nodeId` (routes_through).

`outreach_vehicles` → the fund and SPV vehicles raising now that the token reads:

```json
{ "data": [{ "slug": "spv-cortex", "name": "SPV — Cortex", "kind": "spv", "exemption": "506(c)", "target": 8000000,
             "hard": 2500000, "soft": 0, "indicated": { "low": 3000000, "high": 3000000, "count": 1 },
             "windowEnds": "2026-11-30", "workingDaysLeft": 40,
             "seats": { "invited": 0, "ioi": 1, "allocated": 1, "wired": 1 }, "daysToWire": 30, "daysToWireN": 1 }],
  "coverage": { "note": "Hard, soft and indicated are separate figures and are never added together…" } }
```

`outreach_queue` takes `vehicle` (a slug, `all`, or `none`, which answers empty since every LP is on a vehicle),
`bucket`, `limit`, `cursor` (or the older `offset`, not both), `pursuitId`, `includePassed`, and **`updatedSince`**:

```json
{ "data": { "rows": [{
    "pursuitId": "…", "vehicle": "spv-cortex",
    "entity": { "id": "…", "name": "Invented Family Office", "kind": "org",
                "contacts": [{ "name": "Ana Invented", "email": "ana@invented.example", "source": "gmail", "confirmedAt": "2026-10-04", "confirmedBy": "Juan" }] },
    "owner": "Juan",
    "status": { "value": "discussing", "label": "Discussing", "setAt": "2026-10-01", "setBy": "Juan" },
    "passed": false,
    "nextStep": "Send the deck", "nextStepOn": "2026-10-08",
    "read": { "value": "interested", "label": "Interested", "on": "2026-10-01", "suggested": false },
    "strategy": { "headline": "They back neurotech founders. [health detail redacted]", "firstStep": "…", "confidence": "medium", "asOf": "2026-09-30" },
    "closeTrack": { "state": "signed", "label": "Signed", "amount": 1000000, "wired": 0, "signedOn": "2026-10-02", "signedCount": 2,
                    "closedOn": null, "outstanding": null, "called": null },
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
    "materials": [{ "assetId": "…", "title": "Cortex one-pager (LP memo)", "permittedUse": "accredited_only", "allowed": true, "link": "https://docsend.com/view/…" }],
    "bucket": "reply_owed", "updatedAt": "2026-10-04T18:02:11Z" }],
  "total": 12, "offset": 0, "limit": 25, "nextCursor": null,
  "counts": { "reply_owed": 2, "money": 3, "invite": 5, "follow_up": 1, "held": 1 },
  "cursor": "2026-10-04T18:05:00Z", "redacted": "1 sentence with a health detail redacted." } }
```

- **A material's link (8 Oct 2026).** Each material carries `link`: the DocSend or file link a person pasted for it on
  the materials page, or `null`. Capital OS stores it as written (https only) and never opens it or calls DocSend; offer
  it in a draft when `allowed` is true.
- **How many rows (5 Oct 2026).** 25 by default (`config.outreach.defaultQueueRows`, GUESS), the same over REST and MCP,
  and every answer says which in `limit`. Ask for up to 500 (`maxQueueRows`, GUESS); more is refused (400). `total` counts
  every row the query matches, before paging (cheap: the rows are read for the buckets anyway).
- **Paging.** Pass the answer's `nextCursor` as the next call's `cursor`, with the same `vehicle`, `bucket`, `pursuitId`,
  `updatedSince` and `includePassed`; it is `null` on the last page. The cursor is opaque (it names the last row sent and
  the position after it; no names, so it is safe in a URL). A cursor from another query, or one this server did not give,
  is refused (400), as is `cursor` with `offset`. Rows are in a total order — bucket, priority, name, id — so a pass over a
  queue that does not change returns every row exactly once (a property, over REST and MCP). If the last row sent has
  left the queue meanwhile, the next page starts at its position; rows that changed are seen again with `updatedSince`.
- **Over MCP** an answer must fit the response limit (docs/26 §4). A page that would not fit is cut from its end and says
  so (`heldBack`); `nextCursor` continues from the last row sent, so nothing is skipped (before, the list was halved with
  no way to reach the rest). Over REST a page is never cut.
- **Two cursors, two jobs.** `nextCursor` pages; `cursor` is the polling time for the next `updatedSince`. When paging
  through a poll, keep the first page's `cursor`.
- **Passed LPs, on request.** By default the queue holds only open LPs. `includePassed=1` (REST) or `includePassed: true`
  (MCP) adds the LPs that passed, each with `passed: true`, `status.value: "passed"` and its own bucket, `passed`, after
  the open ones; `counts.passed` appears only then, and `bucket=passed` without it is refused. Every row has `passed`.
  Their checks still run: a restriction on a passed LP is still flagged.

```json
GET /api/outreach/queue?vehicle=spv-cortex&limit=2
{ "data": { "rows": [ { "pursuitId": "0b6e…", … }, { "pursuitId": "4c1d…", … } ], "total": 5, "offset": 0, "limit": 2,
            "nextCursor": "eyJ2IjoxLCJhIjoiNGMxZC4uLiIsInAiOjIs…", "cursor": "2026-10-05T09:00:00Z", … } }

GET /api/outreach/queue?vehicle=spv-cortex&limit=2&cursor=eyJ2IjoxLCJhIjoiNGMxZC4uLiIsInAiOjIs…
{ "data": { "rows": [ …two more… ], "total": 5, "offset": 2, "limit": 2, "nextCursor": "eyJ2IjoxLCJhIjoi…", … } }

GET /api/outreach/queue?vehicle=spv-cortex&includePassed=1&bucket=passed
{ "data": { "rows": [ { "pursuitId": "9a0f…", "passed": true, "bucket": "passed",
                        "status": { "value": "passed", "label": "Passed", "setAt": "2026-09-20", "setBy": "affinity" }, … } ],
            "counts": { "reply_owed": 2, "money": 1, "invite": 1, "follow_up": 0, "held": 1, "passed": 1 }, … } }
```

Over MCP the same: `{ "vehicle": "spv-cortex", "limit": 2, "cursor": "eyJ2Ijox…", "includePassed": true }`.

- **`status.setBy`** is the name of the person who set the status, when it was set here (`status_source` is "us"), and
  otherwise the source it was read from, as a word — `"affinity"` for a status read from Affinity — never a person then.
- **The close track's dates** (5 Oct 2026) come from the close module's own record (`pipeline.commitment_event`):
  `signedOn`, the latest signature's date (null if undated or unsigned); `closedOn`, the closing's; and `outstanding`, once
  the commitment is hard, what has not wired yet (an amount, so R1: null without it, and null before hard). `called` stays
  null: **capital calls are not recorded yet**, so no call has a date or an amount here.
- **`signedCount`** (5 Oct 2026): how many times documents were signed for that commitment — its `signed` and `resigned`
  events in `pipeline.commitment_event`, a source's claim among them, so 2 means signed once and re-signed once (the entity
  changed, the documents were amended). 0 when no signature is recorded; `signedOn` is the latest one's date. A
  subscription pack returned in the close room with no signature event is not counted, as `signedOn` does not read it
  either. A count, not an amount: shown wherever the close track is.
- **`lastTouch.kind` can be null.** It is the channel of the LP's last touch in the trace; when the trace has no dated
  touch of the LP's own, `lastTouch` falls back to the contact summary's date, whose channel and `direction` may be
  unknown, so both are null then. Read `lastTouch.on` either way.

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

## 4a. Routes, with ids and addresses (5 Oct 2026)

juanmail's builders: route hops lacked identifiers, so the desk could neither address an intro ask nor look through a hop.
Now every hop and introducer in `routes_to`, `routes_through` (and `lp_summary`'s routes) carries:

- **`entityId`** — on each hop, on the route's source (`fromEntityId`), and on its **`introducer`**: the last person before
  the target, who carries the ask (null when the source knows the target directly). `routes_through` adds `nodeId`.
- **`askFirst`** (5 Oct 2026) — **the person a desk emails**: the first hop past the team member, with `entityId`, `name`,
  `doNotApproach` and, where readable, `contact`, as the hops have. **The introducer is who eventually carries the ask to
  the target.** On a two-hop route they are the same person. On a three-hop route they differ: Juan → Ravi → Mei → the LP
  means Juan emails Ravi (`askFirst`), Ravi asks Mei, and Mei introduces the LP (`introducer`). On a one-hop route
  `askFirst` is the target itself, or the contact who speaks for an organisation, with `direct: true` and no introducer:
  that is a first message, not an intro ask. A route's source is always the last team member on it (a path through two
  team members starts at the second), or the PL node; from the PL node, `askFirst` is reached through the PL network
  (rule 6). `routes_through`'s `bestRouteToNode` carries one too. A restriction on `askFirst` is flagged, as on any hop.
- **`doNotApproach`** — true when a restriction of any scope is on file for that entity (rule 8). It flags; it never
  removes or clears. Whether a route may be used is still its `verdict` (`excluded` for a restriction on the target, or a
  connector the restriction names), and a path through a barred person is still left out by the planner, as before.
  Reasons stay R4 (`restrictionReasons`).
- **`contact`** — the best address on record (`email`; `source`: gmail, affinity or research; `confirmedAt`), or null when
  there is none — only where the token's owner reads addresses: words (R2) on the route's vehicle, or for
  `routes_through` without a vehicle, R2 on every vehicle. Otherwise there is no `contact` key at all, and `addresses`
  says they were withheld: a Viewer gets none, and a user outside the vehicle gets no route. Licensed (Dakota) addresses
  never appear. One reader serves the queue's `contacts` and these (`lib/outreach/addresses.ts`).

```json
GET /api/outreach/routes-to?entityId=7f3a…&vehicle=spv-cortex
{ "tool": "routes_to", "data": {
    "target": "Invented Family Office", "from": "Juan", "restrictionCount": 0, "restrictionReasons": [], "addresses": "shown",
    "routes": [{ "from": "Juan", "fromEntityId": "1c2d…", "verdict": "recommend",
                 "hops": [{ "entityId": "5e6f…", "name": "Ravi Invented", "tier": "B", "doNotApproach": false,
                            "contact": { "email": "ravi@invented.example", "source": "gmail", "confirmedAt": "2026-10-03" } },
                          { "entityId": "7f3a…", "name": "Invented Family Office", "tier": "B", "doNotApproach": false, "contact": null }],
                 "askFirst": { "entityId": "5e6f…", "name": "Ravi Invented", "direct": false, "doNotApproach": false,
                               "contact": { "email": "ravi@invented.example", "source": "gmail", "confirmedAt": "2026-10-03" } },
                 "introducer": { "entityId": "5e6f…", "name": "Ravi Invented", "doNotApproach": false,
                                 "contact": { "email": "ravi@invented.example", "source": "gmail", "confirmedAt": "2026-10-03" } } },
               { "from": "Juan", "fromEntityId": "1c2d…", "verdict": "recommend",
                 "hops": [{ "entityId": "5e6f…", "name": "Ravi Invented", "tier": "B", … },
                          { "entityId": "8a9b…", "name": "Mei Invented", "tier": "B", … },
                          { "entityId": "7f3a…", "name": "Invented Family Office", "tier": "C", … }],
                 "askFirst": { "entityId": "5e6f…", "name": "Ravi Invented", "direct": false, … },
                 "introducer": { "entityId": "8a9b…", "name": "Mei Invented", … } }],
    "routesFound": 2, "coverage": { "edges": 412, "maxHops": 3, "from": "2019-01-01T00:00:00.000Z", "to": "2026-10-04T00:00:00.000Z" } } }

GET /api/outreach/routes-through?entityId=5e6f…
{ "tool": "routes_through", "data": { "node": "Ravi Invented", "nodeId": "5e6f…", "doNotApproach": false,
    "nodeContact": { "email": "ravi@invented.example", "source": "gmail", "confirmedAt": "2026-10-03" }, "addresses": "shown",
    "bestRouteToNode": { "from": "Juan", "fromEntityId": "1c2d…",
                         "hops": [{ "entityId": "5e6f…", "name": "Ravi Invented", "tier": "B", "doNotApproach": false, "contact": { … } }],
                         "askFirst": { "entityId": "5e6f…", "name": "Ravi Invented", "direct": true, "doNotApproach": false, "contact": { … } } },
    "onward": [{ "entityId": "7f3a…", "name": "Invented Family Office", "tieTier": "B", "routeTier": "B", "lps": [ … ] }], … } }
```

A Viewer's `routes_to` answer has the same routes with no `contact` keys, and
`"addresses": "Addresses are withheld at your access: they are words (R2) on this vehicle."`

**REST for routes.** `GET /api/outreach/routes-to?entityId=…&vehicle=…` and `GET /api/outreach/routes-through?entityId=…`
(optionally `&vehicle=`, `&limit=`) run the MCP tools `routes_to` and `routes_through` through the same `runTool`: the same
policy (a read; the token must list the tool, exactly as over MCP), envelope, budget and audit record, and the same
`data` (a property compares them). `routes_through` still needs access to every vehicle.

**Route quality (7 Oct 2026).** For juanmail's Intros page, `routes_to`'s routes (and `lp_summary`'s) also carry what the
routes page shows in its comparison rows. Each is optional to a client and never changes which routes come back:

- per route: **`score`**, the route score /100 (an integer), or null while the score is provisional (the page shows "—");
  **`weakestTier`**, the worst hop's tier (A–D); **`reasons`**, the verdict's first three reasons, health-redacted;
  **`askLoad`** `{ entityId, name, used, cap }`, the intro asks the introducer (who carries the ask on) has used this
  quarter, null on a direct route; **`foldedUnder`**, the index in this answer's routes of the route this alternative is
  folded beneath, or null when it is shown on its own.
- per hop: **`warmth`** (0 to 5, in halves, the routes page's reading of the tie on its date), the edge **`kind`** (colleague,
  coinvestor, family, …) and **`edgeYear`**, the year the tie is dated from.
- Reasons can quote a restriction's instruction, which is R4: a token without R4 on the vehicle gets `reasons` only on
  recommended routes, and null on the others. Score factors and edge evidence stay on the routes page.

**REST search (7 Oct 2026).** `GET /api/outreach/search?query=…` (with `kind` and `limit` as over MCP) runs the MCP
`search` tool through the same `runTool`: the token must list `search`, as over MCP, and `data` is the tool's answer.

## 4b. Top connectors (5 Oct 2026)

`top_connectors` (MCP) and `GET /api/outreach/connectors?vehicle=<slug>&limit=<n>` (outreach:read): the people who sit on
the most and best warm routes to a vehicle's open LPs.

- **Rows:** the vehicle's open pursuits (not passed), on a vehicle the token's owner reads — the queue's rule; another
  vehicle is "no vehicle among yours" (404).
- **No new scoring model.** For each LP it reads the routes `routes_to` reads (`planRoutes`, through the authorization
  facade) and counts: a connector is a person between the source and the LP (the route's `connectorIds` that are people;
  since 7 Oct 2026 an organisation on a route, such as a shared employer or the fund itself, is never listed, and the first
  person past it is the first hop); each LP counts
  once per connector; `bestScore` is the best route score through them (0–100: the route scorer's relative, uncalibrated
  estimate, never a probability) with its band. Only routes the planner recommends count; held and excluded ones — a
  restriction, a spent ask cap — never do (rule 8).
- **Each connector:** `entityId`, `name`, `lps` (open LPs reached), `bestScore`, `bestBand`, up to three
  `examplePursuitIds` (their best first), `doNotApproach`, and `contact` under §4a's rule. Ranked by `lps`, then `bestScore`.
- **Why a score is low** (7 Oct 2026). A route is never stronger than its weakest hop, so one hop that is affiliation only
  (a shared firm or board, a firm's investment: warmth 0 of 5) makes a recommended route score 0. `bestWeakestHop` names
  that hop on their best route: `{ warmth, kind, label, at }`, `at` being `from the team`, `between connectors`, `to the
  LP` or `direct`. A connector's targets carry `weakestHop` the same way.
- **First hop or deeper** (5 Oct 2026). `asFirstHop` counts the recommended routes on which they are the first hop past the
  team member — the person the team emails (§4a's `askFirst`) — and `asDeeperHop` the ones on which someone else must
  ask them first. `reachableDirectly` is `asFirstHop > 0`. Someone the team reaches only through another person is still
  listed by default, flagged `reachableDirectly: false`. **`firstHopOnly=1`** (REST) or `firstHopOnly: true` (MCP) counts
  only first-hop routes: `lps`, `bestScore` and the ranking are then over the LPs they reach as the first hop, and anyone
  never a first hop is left out. The answer says which in `firstHopOnly`.
- **Ask history** (5 Oct 2026). `asksThisQuarter`: the intro asks made to that person this calendar quarter (in UTC), across
  every vehicle. `lastAsk`: `{ on, replied, basis }` for the latest ask made to them, or `null` when none is recorded.
  Both read `coordination.ask` — the record the ask cap counts (`asksPerConnectorPerQuarter`): an ask recorded on the routes
  page, and an agent's INTRO_ASK once its email is linked (§5). A proposed ask never made does not count. `replied` is
  `true` when the ask's outcome says they answered (or `status` is answered), or the mail trace holds a message from their
  side after the ask; `false` when the outcome is "no reply", or the trace holds our message to them since the ask and
  nothing back; `null` when neither is on record — not known, never "no" (rule 7). `basis` says which. **What it cannot
  see:** an intro ask a person emails without recording it (juanmail linking it to the LP, with no INTRO_ASK ticket, records
  a message, not an ask), and a reply in a mailbox juanmail does not read. So `asksThisQuarter` is the recorded count — the
  same number the cap and the queue's `ask_count` check use — not a count of every email.
- **`intros` (7 Oct 2026):** what the asks through them came to, on the vehicles the token's owner reads, all time.
  `made`: the intro asks made through them (a `made_at`, the same record as above). `committed`: those LPs whose
  pursuit on that vehicle is now Committed, as `{ pursuitId, name, vehicle }` — a pipeline status, not hard money
  (rule 1). `last`: the latest ask, `{ pursuitId, entityId, name, vehicle, on, daysToMeeting }`, where `daysToMeeting` is
  the days from the ask to the first meeting or call held with that LP since, or null when none is on file. Only
  recorded asks count: an introduction Affinity notes in a list field ("Source of introduction") is not read yet.
- **Coverage (rule 7):** `lpsOpen`, `lpsInspected`, `lpsReached`, `complete`. An answer waits for planning up to
  `config.outreach.connectorsBudgetMs` (15 s, GUESS), highest-priority LPs first, and says how far it got; planning carries
  on after it, so asking again reaches further. `maxWaitMs` (0–15000, 7 Oct 2026) waits less: a foreground look answers
  in that time with what is planned so far (`complete: false`), and planning still carries on. `limit` defaults to 20,
  at most 100.
- **Kept, and `ifChanged` (7 Oct 2026):** a vehicle's plan is kept per principal until anything it read changes (a
  pursuit, route, ask, restriction, entity: `network.read_revision`, `network.route_revision`) or the day does, so a
  repeat call takes well under a second once planned. A complete answer carries `version`, a hash of what it says (null
  while planning is incomplete). Pass it back as `ifChanged=<version>` (§4c too) and an answer that would say the same is
  `{ "unchanged": true, "version": "…" }` instead. Ask history is read on every call, so a reply in the mail trace changes
  the version.

```json
GET /api/outreach/connectors?vehicle=spv-cortex&limit=2
{ "tool": "top_connectors", "data": { "vehicle": "spv-cortex", "firstHopOnly": false, "total": 14, "lpsOpen": 31, "lpsInspected": 31,
    "lpsReached": 22, "complete": true, "addresses": "shown",
    "connectors": [
      { "entityId": "5e6f…", "name": "Ravi Invented", "lps": 6, "bestScore": 71.5, "bestBand": "strong",
        "examplePursuitIds": ["0b6e…", "4c1d…", "9a0f…"], "asFirstHop": 7, "asDeeperHop": 1, "reachableDirectly": true,
        "doNotApproach": false, "contact": { "email": "ravi@invented.example", "source": "gmail", "confirmedAt": "2026-10-03" },
        "asksThisQuarter": 1, "lastAsk": { "on": "2026-10-02", "replied": true, "basis": "the mail trace: a message from them after the ask" },
        "intros": { "made": 3, "committed": [{ "pursuitId": "7d1e…", "name": "Invented Family Office", "vehicle": "PLC Neurotech I" }],
          "last": { "pursuitId": "0b6e…", "entityId": "a1b2…", "name": "Invented Endowment", "vehicle": "SPV Cortex", "on": "2026-10-02", "daysToMeeting": null } } },
      { "entityId": "8a9b…", "name": "Mei Invented", "lps": 4, "bestScore": 58, "bestBand": "warm",
        "examplePursuitIds": ["c3d4…", "e5f6…", "0718…"], "asFirstHop": 0, "asDeeperHop": 5, "reachableDirectly": false,
        "doNotApproach": false, "contact": null, "asksThisQuarter": 0, "lastAsk": null }] },
  "coverage": { "counted": "Only routes the planner recommends; 3 held or excluded routes were not counted (rule 8). …", … } }

GET /api/outreach/connectors?vehicle=spv-cortex&limit=2&firstHopOnly=1
{ "tool": "top_connectors", "data": { "vehicle": "spv-cortex", "firstHopOnly": true, "total": 9, …,
    "connectors": [
      { "entityId": "5e6f…", "name": "Ravi Invented", "lps": 6, "asFirstHop": 7, "asDeeperHop": 1, "reachableDirectly": true, … },
      { "entityId": "c0d1…", "name": "Invented Angel Group", "lps": 3, "asFirstHop": 3, "asDeeperHop": 0, "reachableDirectly": true, … }] } }
```

Over MCP: `{ "vehicle": "spv-cortex", "limit": 2, "firstHopOnly": true }`.

## 4c. One connector's targets (5 Oct 2026)

`GET /api/outreach/connectors?vehicle=<slug>&entityId=<connector>` — over MCP, `top_connectors` with `entityId` (one tool, so
the policy, scope and audit stay one; a separate tool name would read as a "connector run", which the registry forbids). It
lists every open LP on that vehicle the connector reaches by a recommended route, best route score first.

- **Who may read it:** the same rule as §4b — open LPs on a vehicle the token's owner reads; another vehicle is 404. The
  connector's name comes from the routes: an id on no route here comes back with `name: null` and no rows, so an id is
  never a way to look a person up.
- **Each row:** `pursuitId`, `entityId`, `name`, `status` (value and label), `score` and `band` (the best recommended route
  through them to that LP), `position` (`first`: they are `askFirst` on that route; `deeper`: someone asks them first),
  `hops`, the route's `introducer`, and `routes` (how many recommended routes through them reach it). With `firstHopOnly`,
  only first-hop routes count.
- **`connector`:** their `entityId`, `name`, `doNotApproach`, `contact` (§4a's rule), `asFirstHop`, `asDeeperHop`,
  `reachableDirectly`, `asksThisQuarter` and `lastAsk` (§4b).
- **Order and paging, as the queue's (§4):** score descending, then pursuit id, so the order is total. `limit` (25 by default,
  at most 500) and `cursor` (the answer's `nextCursor`, null at the end); the answer has `offset` and `total`. A cursor from another connector,
  vehicle or `firstHopOnly` is refused (400). Over MCP a page that would not fit is cut from its end (`heldBack`) and
  `nextCursor` continues from there.
- **Coverage:** `lpsOpen`, `lpsInspected`, `complete`, as §4b: rows come only from the LPs planned within the time budget.

```json
GET /api/outreach/connectors?vehicle=spv-cortex&entityId=5e6f…&limit=2
{ "tool": "top_connectors", "data": { "vehicle": "spv-cortex", "firstHopOnly": false,
    "connector": { "entityId": "5e6f…", "name": "Ravi Invented", "doNotApproach": false, "contact": { … },
                   "asFirstHop": 7, "asDeeperHop": 1, "reachableDirectly": true, "asksThisQuarter": 1, "lastAsk": { … } },
    "rows": [
      { "pursuitId": "0b6e…", "entityId": "7f3a…", "name": "Invented Family Office", "status": { "value": "selected", "label": "Selected" },
        "score": 71.5, "band": "strong", "position": "first", "hops": 2, "introducer": { "entityId": "5e6f…", "name": "Ravi Invented" }, "routes": 1 },
      { "pursuitId": "4c1d…", "entityId": "2b3c…", "name": "Invented Endowment", "status": { "value": "discussing", "label": "Discussing" },
        "score": 64, "band": "warm", "position": "first", "hops": 3, "introducer": { "entityId": "8a9b…", "name": "Mei Invented" }, "routes": 2 }],
    "total": 6, "offset": 0, "limit": 2, "nextCursor": "eyJ2IjoxLCJhIjoiNGMxZC4uLiIsInAiOjIs…",
    "lpsOpen": 31, "lpsInspected": 31, "complete": true, "addresses": "shown" } }
```

Over MCP: `{ "vehicle": "spv-cortex", "entityId": "5e6f…", "limit": 2, "cursor": "eyJ2Ijox…" }`.

## 4d. Every LP and its addresses, light (7 Oct 2026)

JuanMail matches its mail to LPs. The queue carries far more than that needs (checks, the trace, strategy, materials) and
pages 25 rows at a time, so it asked for a read with only what matching takes, for every LP at once.

`GET /api/outreach/contacts?vehicle=<slug or id, or all>` (MCP `outreach_contacts`) answers, for every open LP on the
vehicle (or on every vehicle the token reads), in one page:

```json
{ "data": {
    "rows": [
      { "pursuitId": "0b6e…", "vehicle": "spv-cortex", "entity": { "id": "7f3a…", "name": "Invented Family Office", "kind": "org" },
        "status": { "value": "selected", "label": "Selected" }, "passed": false,
        "contacts": [{ "name": "Ravi Invented", "email": "ravi@invented.example", "source": "gmail", "confirmedAt": "2026-10-05", "confirmedBy": "Juan Benet" }] }],
    "total": 1, "offset": 0, "nextOffset": null, "version": "Qk1x…", "cursor": "2026-10-07T08:10:00.000Z" } }
```

- `contacts` are the queue's, by the same reader (lib/outreach/addresses.ts): for a person, their own addresses; for an
  organisation, its contacts' (from the pursuit and affiliations, never licensed). At most three per person, best first.
  Addresses are R2: on a vehicle where the token does not read words, a row has `contacts: []` and `withheld`.
- `includePassed=1` adds the LPs that passed, each `passed: true`. Without it they are left out, as in the queue.
- `updatedSince=<the previous cursor>` keeps only the rows that changed since then, by the queue's own test (§4).
- `version` hashes the rows (not `cursor`). `ifChanged=<version>` answers `{ "unchanged": true, "version", "cursor" }`
  when no row would differ.
- Order: vehicle slug, then name, then pursuit id. Over REST every row comes back. Over MCP an answer larger than the
  response limit is cut from its end, and `offset=<nextOffset>` continues it; `version` is always the whole answer's.
- `POST /api/outreach/contacts` records an address confirmed in Gmail (`outreach_propose_contact`, §5): `{ entityId | pursuitId, email,
  source: "gmail", confirmedBy, confirmedAt?, idempotencyKey? }`. `pursuitId` (7 Oct 2026) names the LP by its pursuit;
  give one of the two.

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
no such), 409 (a rule refused: nothing was written), 422 (the service refused) or 429 (rate); over MCP it is an error
result with the same message and, since 5 Oct 2026, the same code in `_meta.status` (reads too).

**Rate (8 Oct 2026).** Calls are not limited: no per-minute or daily cap, and no rate headers (Juan: "remove token
limits for PLCOS -- re-implement them only after we find a need for them"). The 7 Oct daily budget and its
`X-RateLimit-*-Day` headers are gone. A token is still refused outside its tools or after it expires, and every call is
audited.

```json
{ "isError": true, "content": [{ "type": "text", "text": "No vehicle \"spv-other\" among yours." }], "_meta": { "status": 404 } }
```

**Not the live server.** A write on a server that is not the live one — a preview copy of live, or a checkout that is not
live — is refused with 403 and this fixed sentence, which the desk may show as it is (`NOT_LIVE_REFUSAL` in
`lib/mutation-policy.ts`; it changes only with this doc):

> Nothing was changed: this server is not the live one (it may be a preview copy), and real records change only on the live server.

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

- The queue's checks run first; a blocking one refuses and opens nothing, and so does one marked `agentOnly`. Today
  that is only `wrap` when the matrix has no rule for the vehicle: shown to a person, never a hold for them (Juan,
  7 Oct 2026: "Just remove these limitations, i did not ask for these limitations for human apps"). With a material, the wrap check runs too
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

One message about three LPs — an intro ask to Ravi naming them, sent by Juan (no `_meta.autonomous` / `X-Autonomous`):

```json
POST /api/outreach/link
{ "pursuitIds": ["0b6e…", "4c1d…", "9a0f…"], "gmailMessageId": "18d…", "messageId": "<CAG…@mail.gmail.com>",
  "date": "2026-10-05T16:20:00Z", "direction": "sent", "from": "juan@…", "to": ["ravi@invented.example"],
  "subject": "Three introductions for Cortex" }
→ { "data": { "linked": true, "messageId": "cag…@mail.gmail.com", "pursuitIds": ["0b6e…", "4c1d…", "9a0f…"],
              "links": [{ "pursuitId": "0b6e…", "linkId": "…", "ticketId": null, "ticketUsed": false }, …], "inTrace": false, "next": "…" } }
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
- **One message, several LPs** (5 Oct 2026). An intro ask to Ravi can name three of our LPs; send `pursuitIds` (1–10) in
  place of `pursuitId`, and the one message is linked to each, **all or none, in one transaction**: one link row per LP
  (email 021), one `outreach.message_linked` audit entry per LP. **Each LP is authorized on its own** — the LP page's rule
  for its vehicle — so one the caller may not change refuses the whole call (404) and nothing is linked. The same message
  with the same set (or a subset) again is `already`; with any other LP it is refused (409): a message is linked once,
  to one set of LPs. Naming one LP twice is 400; `pursuitId` with `pursuitIds` is 400.
- **Several LPs: a person's send only.** An autonomous call that links a *sent* message to several LPs is refused (409,
  "An autonomous send about several LPs is refused…") before anything is written, even when every LP has an approved
  ticket. Why: an agent ticket approves one email about one LP — a SEND names that pursuit and its recipients, and email
  004 keeps one ticket per Gmail message (`outreach_send_gmail_idx`); an INTRO_ASK names one LP on one vehicle — and rule 3
  approves a specific bounded action, never a bundle. One email spending three approvals is an action nobody approved as
  one, so "one approved ticket per send" would no longer hold. The desk can still send each LP's own email under its own
  ticket, autonomously, or have a person link the combined one. A person's multi-LP link needs no ticket and **uses
  none**: an agent ticket open for one of those LPs stays open for its own email (for a single LP, an approved ticket that
  covers the message is still used, as before). `ticketId` with `pursuitIds` is 400. A *received* message about several
  LPs uses no ticket, so an autonomous call may link it. Allowing autonomous multi-LP sends would take a ticket that
  approves one email about named LPs — a decision for Juan (§10).
- **No body** unless `body` is sent explicitly; it is never needed.
- **Send the Message-ID header** whenever the desk has it. Without it the key is the Gmail id, which belongs to one
  mailbox: the message is still linked once, but it can match Affinity's record of the same email only by day and
  participants (`medium`) or day alone (`low`), never `exact`; a copy reported from another mailbox is the same message
  only by minute, sender, recipients and subject; and the link matches the trace only if `comms_ingest` reported the same
  Gmail id.

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
7. **A person's intro asks are not counted as asks** (5 Oct 2026). `asksThisQuarter` and the ask cap read
   `coordination.ask`; an intro ask Juan sends from juanmail and links to the LP is a linked message, not a recorded ask,
   so it is not counted. Either juanmail records the ask too (the routes page's "record an ask" has no API yet), or a link
   says it was an intro ask to a named connector and that counts. Until then the count is a floor.
8. **Autonomous intro asks about several LPs** (5 Oct 2026). Refused today (§5): a ticket approves one email about one
   LP. If juanmail should send them alone, an INTRO_ASK ticket would name the connector and every LP the one email asks
   about, approved as one action.

## 11. Tests

Since 5 Oct 2026, the desk's third round (`scripts/properties/outreach-desk-v3.ts`, through the real REST and MCP handlers,
on two invented vehicles and the fund): `askFirst` is the first hop past the team member on 1-, 2- and 3-hop routes, with
the introducer unchanged; `top_connectors` counts first-hop and deeper routes, flags `reachableDirectly: false`, and
`firstHopOnly` ranks first hops only, the same over REST and MCP; a connector's targets list every open LP they reach and
no other, best score first, once through by cursor, and nothing on a vehicle the caller does not read; `asksThisQuarter`
counts only this calendar quarter's made asks, and `lastAsk` reads a reply from the trace; a message linked to several
LPs is one link per LP, all or none, each LP authorized, and an autonomous send about several is refused with no ticket
used; `signedCount` counts signed and re-signed events.

Since 5 Oct 2026, the desk's second round (`scripts/properties/outreach-desk.ts`, through the real REST and MCP handlers,
on two invented vehicles): every route hop and introducer carries its entityId; a hop's address shows only where
addresses are readable — never to a Viewer or a user outside the vehicle, and a licensed address to no one;
`top_connectors` counts only open LPs on a vehicle the caller reads, through recommended routes; REST and MCP route
answers are equal; passed LPs come back only with `includePassed`, marked passed; paging with `nextCursor` returns every
row exactly once, by REST and MCP, with the default limit explicit and a foreign cursor refused; over MCP a large page is
cut to fit and the cursor continues; an MCP error carries the REST status in `_meta.status`; the close track carries
`signedOn`, `closedOn` and `outstanding`.

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
