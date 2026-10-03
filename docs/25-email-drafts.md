# 25 — Email drafts, moved into each person's Gmail

**Status:** phase 1 built on a branch, 2 Oct 2026; not merged. Real Google is off
(`config.email.gmail.enabled = false`) until the OAuth client in §4 exists. The demo uses a fake Google.

Juan, 2 Oct 2026, in summary: email boxes where the tool suggests an email (to target LPs, to
introducers); WYSIWYG tuned for email with no weird formatting, plus plain text; images and files; move a
draft into the user's own Gmail to review and send from there; "do this safely (don't want a client that
can send email yet, just create drafts for people to review and send themselves)"; Google only for now;
drafts in different threads with different Message-IDs; a connector, but per user.

## Decision: an exception to "no connectors before L13"

AGENTS.md says *no connectors before L13*. Juan made Gmail drafts the third exception on 2 Oct 2026, after
Affinity (docs/15) and Linear (docs/24): **Gmail, drafts only, per user.** Sending from this tool stays
prohibited. AGENTS.md's exception line names it.

## 1. Scope and safety

No Gmail scope allows drafts without send. `gmail.compose` is the narrowest that can create a draft, and it
also allows `users.drafts.send` and `users.messages.send`. So "drafts only" is enforced in code, the way
read-only is for Affinity:

- **`lib/connectors/gmail/allowlist.ts`** lists the only requests that may leave: `users.getProfile`,
  `users.drafts.create`, `users.drafts.update`, `users.drafts.get` (format minimal or metadata), and, for
  threading, `users.threads.get` and `users.messages.get` with `format=metadata` and four named headers.
  Method, path and every query parameter must match; anything else is refused before the transport.
- **`fetch.ts`** is the only function that sends to Google. It also refuses method-override headers, a GET
  with a body, other hosts, redirects, and OAuth grants other than `authorization_code` and `refresh_token`.
- **The client has no send method.** There is nothing to call.
- **Properties** (`scripts/properties/email.ts`): every named send endpoint and nine smuggled variants are
  refused; 3,000 random requests are allowed exactly when they are one of the six shapes; the fake Google
  answers a send if one reaches it, and records none.
- `npm run boundaries`: only `lib/connectors/gmail/` names Google's API hosts or the OAuth client's variables.
- A grant wider than asked (for example one that also carries `gmail.send`) is revoked and refused.
  `include_granted_scopes=false` keeps older grants from merging in.

`gmail.metadata` (headers and labels, never bodies) is asked for too, so a follow-up lands in its thread;
`config.email.gmail.threads = false` drops it.

## 2. Per-user OAuth

- Authorization-code flow with PKCE, `access_type=offline`, `prompt=consent`. The state and the PKCE verifier
  ride in an httpOnly cookie for ten minutes; never a token.
- **Where tokens live.** Only the refresh token is kept. On the Mac: one login-Keychain item per person,
  service `plcos-gmail`, account = their handle, written through `security -i` on standard input so it never
  appears on a command line. Access tokens live in memory for their hour. The demo keeps invented tokens in a
  0600 file beside its database. The deployed service (docs/deploy) will keep them in its database, encrypted
  with a key from its secret store; not built.
- **Refresh** happens on demand and once more after a 401. **Disconnect** revokes the grant at Google (token in
  the form body, never the URL) and forgets it; drafts already in Gmail stay there.
- **Settings:** Preferences → Email shows the connected address and what it may do, with Connect and
  Disconnect. `email.gmail_account` records who connected which address; every connect and disconnect is
  audit-logged.
- Google allows plain `http` only for `localhost`, so on the Mac the consent finishes at
  `http://localhost:3000/api/email/google/callback`. From another device (Juan's iPad) that last page fails to
  load; pasting its address into Preferences finishes the connect with the same checks.
- The OAuth client's id and secret are two Keychain items read by `scripts/with-google-oauth.sh` into the live
  server only. Previews and the demo never see them.

## 3. Threading

- A new email gets its own Message-ID, `<uuid@sender's domain>`, made when the draft is created, and no
  thread id. Two drafts are two threads.
- Moving again replaces the same Gmail draft (same Message-ID). If that Gmail draft is gone — sent or deleted
  there — the next move is a new email with a new Message-ID, so no two emails share one.
- A **follow-up** answers a draft that went to Gmail. With `gmail.metadata` it reads the thread's headers at
  move time and answers the latest message: thread id, In-Reply-To that message's Message-ID, References its
  chain plus it (first kept, cut at 20), and one "Re:". Gmail may give a sent message a Message-ID of its own,
  which is why the headers are read rather than remembered. Without the scope it threads by our records.
- Gmail threads a draft only when the thread id, the reply headers and the subject agree; changing a
  follow-up's subject can start a new thread.

## 4. Setup for a real Google account (Juan or PL IT)

1. In <https://console.cloud.google.com>, in PL's Google Workspace organization, create a project, for
   example "PLC Raise Tools".
2. APIs & Services → Library → **Gmail API** → Enable.
3. Google Auth Platform (the OAuth consent screen) → Get started. App name "PLC Raise Tools", a support
   email, **Audience: Internal**. Internal means only accounts in PL's Workspace can connect, Google does not
   review the app, and refresh tokens do not lapse after seven days. (External + Testing would work for named
   test users, but their tokens expire weekly, and publishing an External app with `gmail.compose`, a
   restricted scope, needs Google's verification and a security assessment.)
4. Data access → Add or remove scopes → add `https://www.googleapis.com/auth/gmail.compose` and
   `https://www.googleapis.com/auth/gmail.metadata` → Save.
5. Clients → Create client → Application type **Web application**, name "PLC Raise Tools (Mac)", Authorized
   redirect URI `http://localhost:3000/api/email/google/callback` → Create.
6. On the Mac, store the two values it shows: `npm run secret:store -- google-oauth-client-id`, then
   `npm run secret:store -- google-oauth-client-secret` (each asks for the value, hidden).
7. Set `config.email.gmail.enabled` to `true` in `config/deployment.ts` (a reviewed change) and restart
   `npm run dev:real`; the Keychain asks for both items.
8. Each person: Preferences → Email → Connect Gmail, on the Mac at `localhost:3000` (or paste the address
   back from another device).
9. PL IT, only if Workspace blocks unconfigured apps: Admin console → Security → Access and data control →
   API controls → Manage third-party app access → add the client id as **Trusted**.

## 5. Editor

- TipTap with paragraphs, line breaks, bold, italic, links (http, https, mailto), bullet and numbered lists,
  and pictures that are the draft's own attachments. Headings, quotes, code, rules, strike, underline,
  colours, fonts and outside pictures have no place in the schema, so a paste loses them
  (`components/email/extensions.ts`; a property builds that schema and checks it).
- The browser sends the editor's JSON, never HTML. The server normalises it to the same schema
  (`lib/email/doc.ts`) and writes the HTML itself: no styles, no classes, `<div dir="ltr">` like Gmail.
- The text/plain part is rendered from the same document, so both say the same words (a property checks
  300 random documents); links are written `words (address)`, lists keep their bullets and numbers.
- **Plain text** mode sends a text/plain message with no HTML part; pictures then travel as files.
- **MIME** (`lib/email/mime.ts`, no dependencies): text/plain or multipart/alternative, inside
  multipart/related for pictures (each with a Content-ID), inside multipart/mixed for files. RFC 2047
  encoded-words of at most 75 characters for headers, RFC 2231 file names, quoted-printable text, base64
  files, CRLF. CR and LF are stripped from every header value, so nothing typed can add a header.
- **Preview the message** shows the part tree and the raw message, long file bodies cut short.
- **Limits** (GUESSES, in `config.email`): 10 MB a file, 10 files, 18 MB in all, because Gmail's limit is
  25 MB a message and base64 adds a third.

## 6. Attachment storage

Bytes are stored by SHA-256 under `config.email.attachmentsDir` (`data/<profile>/email/attachments`), outside
git and the database; the table `email.attachment` holds the name, type, size, hash and Content-ID. Only the
draft's owner can read one back (`/api/email/attachment`), and anything but a picture downloads rather than
displays. **Later:** S3, with the same hash as the key, when the service is deployed.

## 7. Where the boxes are

- **LP page** (`/<vehicle>/pipeline/<id>`): "Email", under the suggested strategy. A first message starts from
  the strategy's angle (W5) with a note that it was written about them and must be rewritten to them; amounts
  are never filled in. The research's email claim, if any, fills To.
- **Warm intro routes**, on the selected route: "Intro ask email" to the first connector, about the target,
  for the vehicle in the switcher.
- **Follow-up in this thread**, on any draft that went to Gmail.
- **Not yet: replies owed.** Affinity's email records carry no Message-ID or Gmail id, so a reply written
  here could not thread. Phase 2.

Each person sees only their own drafts. Viewers see no box.

## 8. Domain rules

- **A draft is not a SEND (rule 3).** Nothing here sends; the person does, from Gmail. A move needs no ticket.
- **Restrictions (rule 8)** on the LP — blanket, "not by email", or "not through this connector" for an intro
  ask through that connector — show as **Stop** beside the Move button; the connector's own restrictions too.
- **Wrap (rule 11):** the vehicle's exemption × instrument must have a wrap rule, or the draft says it was not
  checked; another vehicle named in the draft is flagged; attached files are noted as not checked against the
  materials matrix; a 506(b) vehicle warns against general solicitation.
- **Grants (rule 12):** a grants-rail draft without a funder invitation shows **Stop**.
- **Intro asks (rule 3):** without an approved INTRO_ASK for that connector, the draft says to propose it and
  wait for approval before sending.
- Warnings never block a move. Each move is audit-logged (`email.draft_moved`) with ids, counts, size, how it
  threaded and the warnings shown — never the subject, the words or an address.

## 9. Phases

1. **Built (this branch):** the editor, drafts table (`modules/email/migrations/001_drafts.sql`), MIME,
   the draft-only client, OAuth behind `config.email.gmail.enabled`, Move, follow-ups, the LP and route boxes,
   the fake Google, 19 properties and an end-to-end check.
2. **Next:** replies owed (needs the original's Gmail id); attaching approved material from Materials with
   the per-asset wrap check; Gmail on Developer → Connectors (request counts); a route policy that lets
   vehicle-limited GPs connect (today the connect routes need all-vehicle access); Gmail's upload endpoint for
   messages near the size limit.
3. **Deployed service:** an https redirect URI, tokens in the database under the secret store's key, S3 for
   attachments.

Sending from this tool is not on the list.

## 10. What ~/git/eventmax taught (read, not run)

Worth keeping, and kept: one scope plus an allowlist that refuses send, logged without bodies or tokens; a
queue-then-call move with an audit row; a small hand-rolled MIME builder; TipTap cut down with a plain-text
escape hatch; state in a short httpOnly cookie, offline access, revoke on disconnect. Not copied: the refresh
token in a plaintext file; the client's HTML trusted unsanitised (and a fallback that put raw text in HTML); no
address checks and an unfolded RFC 2047 subject; no threading, no attachments, no access-token reuse.

## 11. Risks

- **The scope can send.** The guarantee is this code. A change to the allowlist shows in a diff and fails the
  properties unless they change too.
- **Training:** a draft goes to the person's own Google Workspace mailbox, under PL's Workspace terms; check
  they keep mail out of model training (AGENTS.md); not verified here.
- **LP names and words leave our system** when a draft is moved — into the mover's own mailbox, which is
  where the email was going anyway.
- **Keychain access:** the server reads a person's refresh token without asking each time; anyone who can run
  commands as Juan on the Mac could too, as with the database beside it.
