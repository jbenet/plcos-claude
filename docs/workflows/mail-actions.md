# Mail actions: the playbook juanmail runs over PLC OS mail

Juan, 9 Oct 2026: "develop some workflows or actions to run on top all the mail my new mail client reads related to
PLCOS". This is the desk's side of it, step by step. The PLC OS side, and why each rule is what it is, is
[docs/29](../29-mail-actions.md). `outreach_playbook` returns this file, so the desk can read the current version.

All calls are on the outreach token (`outreach:read` + `outreach:write`), over MCP or the REST wrapper
(`/api/outreach/<op>`). Every call is audited; none sends, approves or moves money.

## When to run

Once per **new** message in a PLC OS thread: a message whose sender or recipients match an LP or connector from
`outreach_contacts` (refresh it with `ifChanged`), or a thread already linked to a pursuit. Never on a poll that
found nothing new, and never as a backfill of old mail until Juan asks for one (his Claude limit is spent until
Thu 15 Oct 2026; an API key bills separately, but keep it small).

## The steps, per new message

1. **Report the metadata** — `comms_ingest` (`POST /api/outreach/comms`), as today. Free. If the message is a reply
   from the LP, PLC OS records the conversation rungs it supports (LP opted in) on its own: Reconciliation, as for
   Affinity's replies, undoable on the LP's timeline. Nothing for the desk to do.

2. **Read the contact details — rules first, no model.** From the sender's signature block (the lines after the
   sign-off, or after `--`): phone, title, firm, postal address, LinkedIn URL. Only from a message the person sent,
   only about the sender. Then `outreach_propose_contact` (`POST /api/outreach/contacts`):

   ```json
   { "entityId": "…", "phone": "+1 415 555 0100", "title": "Partner", "organization": "Invented Capital",
     "postalAddress": "1 Invented St, San Francisco, CA 94105", "linkedin": "https://www.linkedin.com/in/invented",
     "source": "gmail-signature", "seenOn": "2026-10-09", "messageId": "<CAF…@mail.gmail.com>" }
   ```

   Send a field only when it changed from what `outreach_contacts?details=1` shows. A new email address the person
   uses goes in the same call (`email`). When Juan confirms an address in the client, send it with
   `"source": "gmail", "confirmedBy": "<Juan's address>"`: that is a confirmed one.

3. **Read the signals — one small model call, only for messages with words from them.** Skip our own sends unless they
   carry their words quoted back, auto-replies, calendar notices and bounces. Give the model the new text of the
   message (quoted history cut), the thread's subject, and who is who from `outreach_contacts` (LP or connector on
   which vehicle). Ask for JSON in exactly the `signals` shape below. A Haiku-class model is enough; the rules that
   matter are in the prompt, not in a bigger model.

   | kind | when | carries |
   |---|---|---|
   | `interest` | they want to hear more, are keen, ask to be kept posted | |
   | `soft_commit` | "we're in for", "count us for", "plan to commit" | `amount` if named |
   | `indication` | a number or range without a commitment ("thinking $2–3M") | `amount` |
   | `question` | a question about the fund, the SPV, terms, the science, the team | `topic` |
   | `objection` | a concern or a reason against ("fees too high", "too early", "conflict with X") | `topic` |
   | `decline` | they pass, not now, not a fit | |
   | `timing` | when to come back, a decision date, a committee date | `followUpOn` |
   | `materials_request` | deck, data room, memo, PPM, references | |
   | `meeting_request` | a call or a meeting | |
   | `referral` | they name someone else to talk to | |
   | `intro_offer` | they offer to introduce us (usually a connector) | the LP's `pursuitId` if named |
   | `other` | anything else worth keeping for strategy | |

   - **Role is per thread, not per person.** An LP who offers to introduce a friend is a `connector` in that signal;
     a connector who says they'd invest too gets an `lp` signal. One message can carry several signals.
   - **`topic`** is two or three words, lower case, reused across threads ("fees", "minimum check", "timeline",
     "bci competition", "spv terms", "team"): `outreach_insights` groups by it, so the same thing must have the same
     label. Read `outreach_insights` once a day and reuse its topics.
   - **`summary`** is your reading in a sentence or two, **not the body**; `quote` at most one short line.
   - **Amounts** in USD: one number in `low`, a range in `low`/`high`. An amount is an indication, never soft money.
   - Health details stay out (docs/agent-rules/real-data.md).

   Then `outreach_record_signals` (`POST /api/outreach/signals`):

   ```json
   { "message": { "messageId": "<CAF…@mail.gmail.com>", "gmailMessageId": "18c…", "threadId": "18b…",
                  "date": "2026-10-09T15:02:00Z", "direction": "received" },
     "readBy": "claude-haiku-5-5",
     "signals": [
       { "pursuitId": "…", "role": "lp", "kind": "indication", "amount": { "low": 2000000, "high": 3000000 },
         "summary": "Thinking $2–3M, subject to their IC on the 20th.", "confidence": "high" },
       { "pursuitId": "…", "role": "lp", "kind": "timing", "followUpOn": "2026-10-21",
         "summary": "IC meets on the 20th; come back the day after.", "confidence": "high" },
       { "pursuitId": "…", "role": "lp", "kind": "question", "topic": "fees",
         "summary": "Asked whether the 2% steps down after year five.", "confidence": "medium" } ] }
   ```

   Name who with `pursuitId` (from the queue or contacts read) when it is an LP; `entityId` or `email` for anyone
   else. Recording the same message again replaces its readings; `dismiss` takes `signalId`s Juan marks wrong.

4. **Offer the suggestions — Juan clicks.** The answer's `suggestions` are ready `outreach_update` payloads: a status
   forward (to Discussing on their engaging, to Passed on their decline; never backward, never to Committed), an
   indicated amount when it differs from the one on file, a next step (answer the question, send the materials,
   follow up on the date). Show each with its `why`. When Juan accepts one, send its `update` to `outreach_update`
   unchanged: its `idempotencyKey` makes a double click harmless. Juan may edit the words or the date first.

## What strategy gets

- Per LP: `outreach_signals?pursuitId=…` in the client's LP view. PLC OS's strategy pass (W5) reads the same
  readings for every LP it writes (`mail` in its inputs).
- Per vehicle: `outreach_insights?vehicle=…` — what LPs keep asking and objecting to, by topic and month, with the
  latest examples, and the amounts named in mail. Use it to adjust the pitch, the FAQ and the materials; when a
  topic keeps coming up, tell Juan in the client.

## What it never does

Sends mail, approves or decides anything, records money or a soft commitment on the close track, sets a status
without Juan's click, or sends a message body to PLC OS.
