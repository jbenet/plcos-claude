# The mail desk's third round: whom to ask first, a connector's targets, ask history, one message for several LPs · 5 Oct 2026

No screens changed: this is the API juanmail (Juan's mail desk) reads, over MCP and `/api/outreach/*`. Its builders sent a
second round of feedback on the routes and connectors; this answers it. Every authorization, scope, redaction, restriction
and audit rule holds; details and examples on invented data are in docs/27 §4–§5.

**Whom to ask first** (docs/27 §4a). Every route in `routes_to`, `lp_summary` and `routes_through` now carries `askFirst`: the
first hop past the team member, the person the desk emails, with its entityId, name, `doNotApproach` and, where readable,
address. The `introducer` is unchanged: the last person before the target, who eventually carries the ask. On a
three-hop route Juan → Ravi → Mei → the LP, the desk emails Ravi and Mei introduces. On a one-hop route `askFirst` is the
target, `direct: true`.

**First hop or deeper** (docs/27 §4b). Each connector in `top_connectors` counts its recommended routes as first hop
(`asFirstHop`) or deeper (`asDeeperHop`); someone the team reaches only through another person is still listed, flagged
`reachableDirectly: false`. `firstHopOnly=1` ranks only first-hop appearances.

**A connector's targets** (docs/27 §4c). `GET /api/outreach/connectors?vehicle=…&entityId=…`, or `top_connectors` with
`entityId` over MCP: every open LP on the vehicle that connector reaches, on a vehicle the caller reads, with the best route
score through them, best first, and whether they are the first hop on it. Paged as the queue is: `limit`, `cursor`,
`nextCursor`, `total`.

**Ask history** (docs/27 §4b). On each connector, `asksThisQuarter` and `lastAsk: { on, replied, basis }`, from the intro
asks recorded as made to them (`coordination.ask`, the record the ask cap counts) and, for a reply, the ask's outcome or the
mail trace. `replied` is null when neither says, never a guessed "no". An intro ask emailed without being recorded is not
counted, so the count is a floor (docs/27 §10, item 7).

**One message, several LPs** (docs/27 §5). `outreach_link_message` and `POST /api/outreach/link` take `pursuitIds` (1–10):
the message is linked to each LP, all or none, in one transaction, each LP authorized on its own. A person's call only: an
autonomous send about several LPs is refused (409), since an agent ticket approves one email about one LP and one Gmail
message uses one SEND ticket (email 004); the desk sends each LP's own email under its own ticket instead. A link is now
one row per message and LP (email 021).

**Re-signing** (docs/27 §4). The close track carries `signedCount`: how many times documents were signed for the
commitment, from the close module's signed and re-signed events; 0 when none is recorded.

**Docs.** docs/26 and docs/27 say the second round is live on `deploy` at `0b3715e`, and what this branch adds.

Properties (`scripts/properties/outreach-desk-v3.ts`): `askFirst` on 1-, 2- and 3-hop routes; first-hop counts and
`firstHopOnly`; a connector's targets complete, ordered, paged once and authorized; `asksThisQuarter` and `lastAsk` on
invented asks across a quarter boundary; a multi-LP link all or none, authorized per LP, and refused when autonomous;
`signedCount`.
