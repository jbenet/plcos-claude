# The mail desk's second round: route ids and addresses, top connectors, paging · 5 Oct 2026

No screens changed: this is the API juanmail (Juan's mail desk) reads, over MCP and `/api/outreach/*`. Its builders sent
feedback after a day on the first round; this answers it. Every existing authorization, scope, redaction, restriction and
audit rule holds; details and examples on invented data are in docs/27 §4–§5.

**Routes the desk can act on** (docs/27 §4a). Each hop and introducer in `routes_to`, `routes_through` and `lp_summary`'s
routes carries its `entityId` (the source's as `fromEntityId`; the introducer is the last person before the target, who
carries the ask), and `doNotApproach` when a restriction is on file for it. Where the token's owner reads addresses on
the vehicle, it also carries the best address with its source and confirmation date — the same reader as the queue's
contacts, so a Viewer or a user outside the vehicle sees none, and a licensed address no one. A restriction is flagged,
never stripped to make a route usable. New REST: `GET /api/outreach/routes-to?entityId=…&vehicle=…` and
`/routes-through?entityId=…`, which run the MCP tools and answer the same `data`.

**Top connectors** (docs/27 §4b). `top_connectors`, and `GET /api/outreach/connectors?vehicle=…`: the people on the most and
best warm routes to a vehicle's open LPs — how many they reach, the best route score through them, a few example LPs.
Built from the routes `routes_to` returns, not a new score; only recommended routes count, and only LPs on vehicles the
caller reads. It says how many LPs it inspected before its time budget.

**The queue** (docs/27 §4). The default of 25 rows is explicit and in every answer (`limit`); ask for up to 500. Paging is by
an opaque `cursor` (the answer's `nextCursor`, null at the end), with `total`. Over MCP a page that would not fit the
response limit is now cut from its end with `nextCursor` continuing from there; before, the list was halved and the rest
was out of reach. Passed LPs come back only with `includePassed`, each marked `passed`. The close track carries
`signedOn`, `closedOn` and `outstanding` from the close module; `called` stays null, since capital calls are not recorded.

**Errors.** An MCP error result carries the REST status in `_meta.status` (400, 403, 404, 409, 422, 429). A write on a server
that is not the live one — a preview copy — is refused with one fixed sentence the desk can show as it is.

**Docs.** docs/26 and docs/27 now say what is on master and what this branch adds; docs/27 says what `status.setBy` holds
(a person's name only when set here, else the source, such as "affinity"), that `lastTouch.kind` can be null, and that a
message linked without its Message-ID matches Affinity's records with less confidence.

Properties (`scripts/properties/outreach-desk.ts`): hop entityIds; address redaction for a Viewer and an out-of-scope user;
top_connectors counts only readable LPs; REST and MCP route answers equal; `includePassed` opt-in; paging covers every
row exactly once, by REST and MCP, including a page cut to fit; `_meta.status`; the close track's dates.
