# Indicated amounts, and outreach tools for juanmail over MCP · 4 Oct 2026

| | |
|---|---|
| ![An LP's update box: the words "they are thinking $3M-4M" read as an Indicated row, ticked, with $3000000 to $4000000 filled in, and "Saving will … record $3M–$4M as indicated, beside soft and hard and in neither"](docs/changelog/shots/outreach/01-update-box-indicated.webp) | **The update box offers it.** An amount in the words — "$3M", "$3M–4M", "3 to 5 million" — becomes an Indicated row, unticked; it is saved only when ticked, sourced to the touchpoint the same update logs. |
| ![The LP page's status card: "Indicated: $3.0M–$4.0M · 04 Oct 2026 · recorded by Juan, from a touchpoint on the timeline — an indication, not a commitment: beside soft and hard, added to neither"](docs/changelog/shots/outreach/02-lp-page-indicated.webp) | **The LP page shows it** under the status, beside the close track, with its date and source. |
| ![The vehicle's status: Hard, Soft, Indicated, Cash received, Gap to target and Coverage, each its own figure](docs/changelog/shots/outreach/03-vehicle-status-indicated.webp) | **The vehicle's status** has Indicated as its own figure, next to Soft. No figure adds it in. |
| ![Preferences → MCP access with the outreach desk presets, an expiry choice, and a new token shown once](docs/changelog/shots/outreach/04-preferences-desk-token.webp) | **A token for juanmail, or a device.** An Admin makes it in Preferences: read the queue, or also write; it expires in a week, a month, three months or a year; the table shows the device or server it was last used from. |
| ![Developer → Agent activity: four calls by juanmail with correlation id wave-2026-10-04 — outreach_vehicles, outreach_queue and outreach_request_ticket ok, outreach_record_send refused with its reason](docs/changelog/shots/outreach/05-agent-activity.webp) | **Developer → Agent activity.** Every MCP and outreach call, one record each: client, tool, outcome and why, latency, the ids it touched, the chain's correlation id. Refusals too. |

Juan's mail desk, **juanmail**, sent four asks on 4 Oct 2026 (docs/27-outreach-api.md). All are built, on invented data:

**IOI and the indicated amount** (Juan: "wonder if IOI (indication of interest) and indicated amount (a single value or
a range) could be fields we associate with the LP in PLCOS"). Per LP per vehicle, funds and SPVs: low and high, the
date, the touchpoint where they said it (`pipeline.indication`). It is not soft money and no total adds it (rule 1).
On an SPV, an invited seat moves to "IOI given".

**Outreach tools on MCP**, juanmail's interface (its own server holds one token): `outreach_vehicles`,
`outreach_queue` (with `updatedSince` and a cursor, for polling), `outreach_update` (the LP page's update box, once per
key — a status only as a box Juan ticked), `outreach_request_ticket` (SEND or INTRO_ASK, for a person to approve),
`outreach_propose_contact` (a Gmail address Juan confirmed, kept beside Affinity's), `outreach_record_send` (juanmail
sent it: recorded once, against an approved, unexpired, unused ticket for that LP and those recipients). Status, close
track and SPV seat come back apart with Capital OS's own labels. `/api/outreach/*` is a thin REST wrapper over the same
tools. The token carries an outreach scope, read and write apart; every call runs as its owner through the pages' rules.

**The MCP policy is data.** Each tool declares its risk (read, propose, write-guarded, send-adjacent), the scopes it
needs, and whether it opens or requires a ticket and a person's approval. The hard rules stay properties: no tool sends
mail, decides a ticket or moves money. docs/26 §3 says how a new tool is added.

**Every call is one audit record**, MCP or REST: user, token and client, tool, risk, scopes, an input hash, outcome and
reason, latency, the ids touched, the idempotency key and a correlation id the client passes. Developer → Agent
activity reads them; `audit_recent` gives a client its own; feedback can name a call. Everything is kept, for now.

**Juan's rule changes.** A tool may send — juanmail, through MailGuard, one email per approved SEND ticket; Capital OS
still sends nothing (rule 3 unchanged). Fund before SPV is advisory: flagged, never held, and the overlap recorded with
the choice and a dated follow-up (rule 5). The ask cap is advisory. Drafting context may go to the Claude API with zero
data retention and no training; the queue's text has health details redacted before it leaves.

**Adjusted from the request:** desk tickets are requested by an inactive "Mail desk" actor, so Juan can approve what his
own desk asks for (no one approves their own ticket); a bearer token, not a cookie or loopback. Open for Juan: confirm
ZDR for the key's organization; a second approver for SEND; whether juanmail records intro asks it emails.

Tests: properties through the real handlers (indicated never summed; the tool policy; scopes; restricted and licensed
values; labels; advisory checks; redaction; CORS; one structured audit record per call; `audit_recent` only your own;
`updatedSince`; the update box once per key; tickets never approved by the tool; sends recorded only against their
approval, once; overlaps dated; contacts never overwrite Affinity). Two end-to-end checks: a desk token over REST, and
a juanmail token with the MCP SDK client, traced by correlation id. Demo and invented data only.
