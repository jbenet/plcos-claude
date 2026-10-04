# Email drafts go through mailguard, and only a drafts-only token is accepted · 3 Oct 2026

| | |
|---|---|
| ![Preferences → Email refusing a pasted token: "This token can send email. Make a drafts-only token in mailguard."](docs/changelog/shots/mailguard/01-refused-can-send.webp) | **A token that can send is refused.** Pasted in Preferences → Email, it is checked with mailguard's own `GET /api/v1/me` before anything else; it can send, so it is refused in those words and not kept. The token is one the demo's fake mailguard invented. |
| ![Preferences → Email connected: the mailbox, the mailguard tool, what it may do, when it was checked, and Test the connection](docs/changelog/shots/mailguard/02-connected-drafts-only.webp) | **Connected, drafts-only.** The mailbox the token acts on, the tool's name, what it may do in words, when it was last checked, and **Test the connection** — one harmless read, no draft. |

Juan, 3 Oct 2026: "instead of direct gmail auth, we built a new tool to use that scopes permissions for security.
Please integrate it instead" — [mailguard](https://github.com/jbenet/mailguard) — and later the same evening: "Make
sure the mailguard token only lets you draft, and error when connecting it if it lets you send (for security)."
The plan, and how mailguard works, are in `docs/25-email-drafts.md` §12.

**Mailguard.** A person connects Gmail once, at mailguard; each tool they make there gets its own key (`mg_…`) and
policy, and mailguard checks and logs every request. A key is per person and reaches only that person's mailbox. It
takes drafts as fields (to, subject, text, HTML, files, `replyTo` for a thread) and writes the MIME itself.

**Drafts-only, checked, never tried.** A key is accepted only when mailguard's `GET /api/v1/me` says it can draft and
cannot send, and its own policy grants neither `send` nor `*`; an unknown permission, a malformed answer, no draft or
an expired policy fail closed. The check runs when a key is pasted (a refused key is not stored), at server start for
the Keychain key (the log says which, never the key), before every move, and daily. A key widened at mailguard after
it was connected is caught before the next move, and drafting stops for that person until a good one is connected.

**A second wall.** `lib/connectors/mailguard/` holds a four-entry allowlist (whoami, create and update a draft,
thread headers) checked on origin, method, path and every query parameter, a guarded transport that refuses
everything else before it leaves, and a client with no send method. Only that folder names the variables that hold
the key and address (`npm run boundaries`).

**Direct Gmail OAuth is removed** — `lib/connectors/gmail/`, the `/api/email/google/*` routes, the paste-back connect,
`scripts/with-google-oauth.sh` and `config.email.gmail`. It was never enabled on live, and it kept a Gmail grant that
can send one flag away. Nothing now names Google's mail or OAuth hosts.

**Kept:** the editor, the drafts and files, the draft-time checks, move locking and ownership, the audit entries.
**Changed:** follow-ups thread through mailguard's `replyTo` on the thread's latest sent or received message;
pictures in the text travel as attached files (mailguard has no inline pictures), and the preview shows them so;
display names outside ASCII are left off, since mailguard would mangle them. New: `email.mailguard_account`
(migration 003), the config `config.email.provider = 'mailguard'`, `scripts/with-mailguard-token.sh`.

**Checked** on the fake mailguard only — 22 email properties (allowlist and 3,000 random requests; 16 named and 1,000
random whoami answers; refused-and-not-stored at connect; widened-later, Keychain-key and revoked-key moves; threads;
audit with no key in it) and the end-to-end check, which pastes a send-capable token, sees it refused, connects the
demo's drafts-only one, tests it, and moves a draft with a file. **To turn it on:** `npm run secret:store --
mailguard-url`, then restart `npm run dev:real` (docs/25 §12.5).
