# No tickets for people, and the email trail is the record · 5 Oct 2026

| | |
|---|---|
| ![An LP's page: the "Before you send" card above the Email card — a red-bordered "Restriction on file" block, "Who owes a reply: We do — they wrote last", the last touches with their sources, the Gmail thread with who on the team is on it and who holds it, the other vehicles in play, and the material's wrap and 506(c) flags](docs/changelog/shots/comms-trace/01-lp-context-panel.webp) | **Before you send.** Where a person drafts — the LP page's Email card, the routes page's intro-ask box — the context, in place of an approval: the last touches with dates, direction and source; who owes a reply; the other vehicles in play and their status; who on the team is in the thread and who holds it; restrictions in red, always; and the material's compliance (the wrap rule, 506(c) accreditation, which materials may go). |
| ![The LP's timeline: three email rows labelled "Gmail, via juanmail", theirs, ours, theirs, and "We owe a reply — they wrote last" among the facts at the top](docs/changelog/shots/comms-trace/02-timeline-from-the-trace.webp) | **The timeline is the comms trace.** Affinity's emails and meetings, the Gmail messages juanmail reports, the team's notes here and in Affinity, and Linear issues linked to the pursuit, each labelled by source, one row per message. Last touch and who owes a reply are read from it. |
| ![Approvals → the agent's tickets: SEND and INTRO_ASK tickets asked for by the Mail desk, each with what it authorizes, checkboxes, and Approve the checked / Reject the checked](docs/changelog/shots/comms-trace/03-approvals-agent-batch.webp) | **An agent's tickets, as one batch.** Only an autonomous agent needs a SEND or INTRO_ASK ticket now; a person approves its run together, each still its own ticket and audit line. |

Three decisions of Juan's, 5 Oct 2026. "this seems like complexity overkill. i think we want to be super clear on what
outreach has happened and equip senders with clear visual info so they can make the best decision there, but not create
super complex approval flows that will just grind things to confusion or halts. if this was for automated agents only,
ok, but not for humans (we're slow)". And: "let email be the state ... let the actual comms trace reveal what happened".

**1. No SEND or INTRO_ASK tickets for people; for autonomous agents only** (AGENTS.md invariant 3, rule 3 in
docs/agent-rules/domain.md, `modules/governance/autonomy.ts`). A person — the app, or a token acting for its owner
interactively — never needs one: recording an ask on the routes page opens none ("Record the ask"); a material that passes
the wrap check is cleared, and the person marks it sent after sending it (the wrap is checked again then); an intro-ask
draft no longer says to wait for an approval. Autonomous is a flag, never a guess: `_meta.autonomous: true` on an MCP call,
`X-Autonomous: 1` over REST, or `mode:autonomous` on a token; a call can add it, never remove it, and every audit record
says which. An autonomous send or ask fails closed without an approved ticket, and a person approves an agent's tickets
one by one or as a batch. MONEY, STAGE and ALLOCATION_EXCEPTION are unchanged; none of them blocks a person's ordinary
outreach.

**2. "Record the send" became "link the message"** (`outreach_link_message`; `outreach_record_send` stays as an alias
for one release). juanmail passes the Gmail message and thread ids, the Message-ID, the date, from/to/cc, the subject and
the direction, no body unless it sends one. The link is an audit of the action, matched to the message in the trace by
Message-ID: it creates no touchpoint, status, rung or ticket. If an agent ticket covers it, it is linked and marked used.

**3. The outreach timeline is built from the comms trace** (docs/27 §6a, `lib/comms/`). `comms_ingest` takes the
metadata juanmail sees in Gmail, sent and received, idempotent by Message-ID, and writes nothing else. A Gmail message
Affinity also has is one row: matched by Message-ID when both carry it, else by date, participants and subject, labelled
with its confidence (Affinity keeps an email's day and who was on it, not its subject, so a match is "medium" at best).
The merge is stable. The queue's rows carry the trace's summary (`trace`: last touches with source, who owes, the thread
and its holder, mismatches), and `comms_trace` returns one LP's merged timeline. The app's logs stay an audit; where one
disagrees with the trace — a link the trace hasn't shown, an agent send with no ticket, an email logged here that the mail
doesn't show — the trace is shown and the disagreement flagged. Something that happened off email is a note.

**Also fixed on the way:** the wrap check inside a send's transaction read outside it, which waits forever on PGlite's
single connection (a person marking a material sent hit it first); and the queue's restriction check said "No
restriction on file" for a restriction on another channel — every restriction is surfaced now, and one that names no
channel bars email.

**Kept gated, and why:** the restriction (rule 8), the grants gate (rule 12) and the wrap check (rule 11) are not tickets
and hold for everyone; an agent is refused on a restriction. Marking a *token* autonomous has no checkbox in Preferences
yet — the settings pages belong to the deploy branch this week — so a client marks its calls (docs/27 §10).

Migration: `email/020_comms_trace.sql` (`email.comms_message`, `email.message_link`), numbered after the deploy branch's
platform 018/019. Tests: `scripts/properties/comms.ts` and the rewritten `outreach-writes.ts` (a person's path needs no
ticket; an autonomous call without one is refused; a link is idempotent and creates no state; ingest de-duplicates with
Affinity's record; restrictions are always surfaced, to a Viewer with the reason withheld; the merge is stable under
reordering and re-merging). End to end: juanmail ingests, links a person's send, is refused an autonomous one, has two
agent tickets approved in one batch on the Approvals page, links one; the LP page shows the restriction, who owes a
reply, the thread and the merged rows. Demo and invented data only.
