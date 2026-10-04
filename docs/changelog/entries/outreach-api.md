# Indicated amounts, and an outreach API for the mail desk · 4 Oct 2026

| | |
|---|---|
| ![An LP's update box: the words "they are thinking $3M-4M" read as an Indicated row, ticked, with $3000000 to $4000000 filled in, and "Saving will … record $3M–$4M as indicated, beside soft and hard and in neither"](docs/changelog/shots/outreach/01-update-box-indicated.webp) | **The update box offers it.** An amount in the words — "$3M", "$3M–4M", "3 to 5 million" — becomes an Indicated row, unticked; it is saved only when ticked, sourced to the touchpoint the same update logs. |
| ![The LP page's status card: "Indicated: $3.0M–$4.0M · 4 Oct · recorded by Juan, from a touchpoint on the timeline — an indication, not a commitment: beside soft and hard, added to neither"](docs/changelog/shots/outreach/02-lp-page-indicated.webp) | **The LP page shows it** under the status, beside the close track, with its date and source. |
| ![The vehicle's status: Hard, Soft, Indicated, Cash received, Gap to target and Coverage, each its own figure](docs/changelog/shots/outreach/03-vehicle-status-indicated.webp) | **The vehicle's status** has Indicated as its own figure, next to Soft. No figure adds it in. |
| ![Preferences → MCP access with the outreach desk presets, an expiry choice, and a new desk token shown once](docs/changelog/shots/outreach/04-preferences-desk-token.webp) | **A desk token, per device.** An Admin makes it in Preferences: read the queue, or also write; it expires in a week, a month, three months or a year; the table shows the device it was last used from. |

Juan's mail desk sent four asks on 4 Oct 2026 (docs/27-outreach-api.md). All are built, on invented data:

**IOI and the indicated amount** (Juan: "wonder if IOI (indication of interest) and indicated amount (a single value or
a range) could be fields we associate with the LP in PLCOS"). Per LP per vehicle, funds and SPVs: low and high, the
date, the touchpoint where they said it (`pipeline.indication`). It is not soft money and no total adds it (rule 1).
On an SPV, an invited seat moves to "IOI given".

**An outreach API.** `GET /api/outreach/vehicles` and `/queue`; `POST /update` (the update box's own service),
`/tickets` (SEND or INTRO_ASK, for a person to approve), `/contacts` (a Gmail address Juan confirmed, kept beside
Affinity's), `/sent` (the desk sent it: recorded once, against an approved, unexpired, unused ticket for that LP and
those recipients). Status, close track and SPV seat come back apart with Capital OS's own labels. A bearer token per
device with an outreach scope, read and write apart; every call as the token's owner, through the same rules as the
pages, audited. CORS is closed unless an origin is listed. `outreach_vehicles` and `outreach_queue` are MCP tools too.

**Juan's rule changes.** A tool may send — the desk, through MailGuard, one email per approved SEND ticket; Capital OS
still sends nothing (rule 3 unchanged). Fund before SPV is advisory: flagged, never held, and the overlap recorded with
the desk's choice and a dated follow-up (rule 5). The ask cap is advisory. Drafting context may go to the Claude API
with zero data retention and no training; the queue's text has health details redacted before it leaves.

**Adjusted from the request:** desk tickets are requested by an inactive "Mail desk" actor, so Juan can approve what his
own desk asks for (no one approves their own ticket); a bearer token, not a cookie or loopback, since the app moves to
Railway; the writes are not MCP tools. Open for Juan: confirm ZDR for the key's organization; a second approver for
SEND; whether the desk records intro asks it emails.

Tests: nineteen properties through the real route handler (indicated never summed; scope; restricted and licensed
values; labels; advisory checks; redaction; CORS; audit; the update box once per key; tickets never approved by the
desk; sends recorded only against their approval, once; overlaps dated; contacts never overwrite Affinity). One end to
end check makes a desk token in Preferences, reads and writes over HTTP, is refused a send before approval, and sees
the indication on the LP page. Demo and invented data only.
