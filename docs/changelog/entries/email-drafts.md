# Email drafts — written here, moved into your own Gmail · 2 Oct 2026

| | |
|---|---|
| ![An LP page's Email card: a first message with a file attached and the draft-time checks](docs/changelog/shots/email-drafts/01-lp-first-message.webp) | **A first message on the LP page.** It starts from the suggested strategy when there is one (this demo LP has none, and the note says so). To, Cc/Bcc, subject, a rich editor with plain text a click away, files, and the checks beside the Move button. |
| ![The draft after a move, with the message's MIME tree and raw headers](docs/changelog/shots/email-drafts/02-moved-and-the-message.webp) | **Moved, and the message itself.** The draft went into the demo's fake Gmail; "Preview the message" shows the part tree and the raw message as it goes to Gmail. |
| ![The intro ask email on a warm intro route](docs/changelog/shots/email-drafts/03-route-intro-ask.webp) | **An intro ask on a route.** Written to the first connector about the target; it says that no INTRO_ASK is approved yet. |

Juan asked on 2 Oct 2026 for email boxes where the tool suggests an email, WYSIWYG with a plain-text mode, files and
pictures, and a way to move a draft into his own Gmail to review and send there — "don't want a client that can send
email yet". This is phase 1 of `docs/25-email-drafts.md`, the third exception to "no connectors before L13" after
Affinity and Linear: **Gmail, drafts only, per user.** Merged nowhere yet; real Google stays off until the OAuth
client in docs/25 §4 exists.

**Draft-only, by construction.** No Gmail scope makes drafts without allowing sends, so `lib/connectors/gmail/`
holds a six-entry allowlist (profile; drafts create, update and get; thread and message headers) checked on method,
path and every query parameter, a guarded fetch that refuses everything else before the transport, and a client
with no send method. Only that folder names Google's hosts or the OAuth client's variables (`npm run boundaries`).

**Per-user OAuth.** PKCE, offline access, no merged grants; a grant wider than asked is revoked and refused. Each
person's refresh token is a Keychain item on the Mac; the OAuth client is two Keychain items handed to the live
server by `scripts/with-google-oauth.sh`. Preferences → Email connects and disconnects (which revokes at Google).

**The editor and the message.** TipTap cut to paragraphs, breaks, bold, italic, links, lists and the draft's own
pictures; the server normalises whatever arrives and writes the HTML itself, and the text/plain part comes from the
same document. A dependency-free MIME builder: alternative, related for pictures, mixed for files; RFC 2047 and
2231 headers, quoted-printable, CRLF, no header injection. Each draft has its own Message-ID; a follow-up threads
on the latest message's headers, read from Gmail.

**Where.** The LP page's Email card (first messages and follow-ups) and the selected route on Warm intro routes
(intro asks). Each person sees only their own drafts. Draft-time checks warn on restrictions (rule 8), the wrap
rule and other vehicles named (rule 11), the grants gate (rule 12) and an unapproved intro ask (rule 3); they
never block. Every move is audit-logged with counts and the warnings shown — never words or addresses.

**Storage.** `modules/email/migrations/001_drafts.sql` (new schema `email`: drafts, attachments, who connected
which address). Attachment bytes by hash under `data/<profile>/email/attachments`; S3 later.

**Checked** on the fake Google only: 19 properties (`scripts/properties/email.ts`) — sends refused by every route,
3,000 random requests, 200 generated messages well formed, threads and Message-IDs, the plain and HTML parts
matching over 300 random documents, the editor's schema and the server's normaliser, OAuth refusals, audit
entries, ownership — and an end-to-end check that connects, drafts with a file and moves it to the fake Gmail.
Not built: replies owed, Materials attachments, Gmail on Developer → Connectors (docs/25 §9).
