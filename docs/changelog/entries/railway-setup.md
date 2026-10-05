# Settings in the app, a guided /setup, and Google sign-in · 4 Oct 2026

| | |
|---|---|
| ![/setup, step 1: the setup code from the server log, with the six steps down the left](docs/changelog/shots/railway-setup/01-setup-code.webp) | **Step 1, the code.** A deployed server that is not set up prints one line at boot: “Not set up yet. Open …/setup and enter the code XXXX-XXXX-XXXX”. The code is the credential; ten wrong tries an hour from one address (an IPv6 /64 counts once), 10,000 in total. |
| ![/setup, step 2: the public address, filled in from the request, and the redirect URI it makes](docs/changelog/shots/railway-setup/02-setup-address.webp) | **Step 2, the address.** Filled in from Railway's domain (here, the address the page was opened at). The Google redirect URI under it changes as you type. |
| ![/setup, step 3: the Google Cloud console steps with links, the copyable redirect URI, and the client ID and secret](docs/changelog/shots/railway-setup/03-setup-google.webp) | **Step 3, Google.** Five steps in the Cloud console, each a link: a project, Branding, Audience → **Internal**, a Web client with the redirect URI to copy, then the ID and secret here. |
| ![/setup, step 4: the first admin's Workspace address](docs/changelog/shots/railway-setup/04-setup-admin.webp) | **Step 4, the first admin.** An existing person with that address becomes an admin; otherwise one is added. Nobody signs up. |
| ![/setup, step 5: Affinity, Linear and Anthropic, each skippable](docs/changelog/shots/railway-setup/05-setup-connectors.webp) | **Step 5, connectors.** Each can be skipped and added later. |
| ![/setup, step 6: a review of every value, secrets as their last four characters](docs/changelog/shots/railway-setup/06-setup-review.webp) | **Step 6, review.** Nothing is saved until here, and then all of it is checked first: one wrong value writes nothing and takes you back to it, with everything else still typed. |
| ![/setup on a phone: one column, the step named above the card](docs/changelog/shots/railway-setup/07-setup-mobile.webp) | **On a phone,** one column, the step named above the card. |
| ![/setup done: Continue with Google](docs/changelog/shots/railway-setup/08-setup-done.webp) | **Done.** The code is retired; /setup now only says the server is set up. |
| ![Settings → Connections: the address, Google sign-in, connectors, tokens, people and sessions, and what stays in the environment](docs/changelog/shots/railway-setup/09-settings-connections.webp) | **Settings → Connections** (Admins). Every setting, where its value comes from (the environment, the app, or nowhere), Replace, Remove, and Check for Anthropic and Affinity. Secrets show as •••• and their last four. People and sessions has Sign out everywhere. |

Juan, 4 Oct: "setup all secrets in the server to be configurable from settings inside the server; make a very
nice /setup that guides you through setting it all up from scratch … the only local secret is the key for the
db, everything else (oauth, tokens, connectors, etc) is set inside the app itself". MailGuard's design, on
Postgres ([docs/deploy/railway.md](docs/deploy/railway.md) §3).

**One key outside the app.** `PLCOS_SECRET` (32+ bytes, base64). Unset on a deployed server, one is made on the
volume (`data/secret`, 0600, never overwritten) and Settings says how to move it into the variable. On the Mac a
dev key sits under the profile's data folder, which git ignores. Each purpose has its own HKDF-SHA256 subkey;
secrets are AES-256-GCM, bound to their setting's key; sessions and the OAuth state are HMAC-SHA256, compared in
constant time.

**Settings in `platform.setting`** (migration `platform/018_settings_and_sessions.sql`, which also adds a
per-person `session_epoch`). Each connector declares its own setting in its own folder, so the boundaries hold;
`lib/settings/registry.ts` assembles them: the public address, the Google client, session length, Affinity,
Linear, Dakota's sign-in (Juan, 4 Oct: Dakota moves to the cloud), Anthropic, mailguard's address (it was
`MAILGUARD_URL` or config only; the variable still wins) and the feedback export token. An environment value always wins, and the
app refuses to change it, so the Mac's Keychain wrappers keep working. The key readers stay synchronous over a
cache loaded after migrations at boot (and in the import worker), refreshed after a write and every 30 s. A
preview copy still gets no keys. Every change is one audit row naming the key, never the value.

**Google sign-in** on a deployed server (`config/sign-in.ts`: the image sets `PLCOS_DEPLOYED=1`; Railway's own
variables count too). PKCE, a signed ten-minute state cookie, and the code exchanged in
`lib/connectors/google-signin` — the only code that names Google's OAuth hosts, asking for openid, email and
profile only. Admitted: a verified address from a Workspace account (`hd`) that is one active person on the
roster. Refused and logged with the reason: a bad state, an unverified email, a personal account, an unknown or
inactive address. The session is a signed `uid.epoch.expires.sig` cookie, 30 days (a GUESS, a setting). Every
page is behind it; /setup and /signin are not. The Mac's servers keep the switcher; a deployed one never falls
back to it. "Is this the live server" and the remote-database guard now key on a deployed sign-in being on, so
LabOS still works. MCP tokens are unchanged.

**Also:** feedback behind Google needs a signed session (no anonymous issues from the internet); the origin
check accepts the proxy's forwarded scheme, which Railway's TLS edge needs; a refused Admin action is logged.

**Templates.** `PLCOS_SECRET` is `[required]` in `service.env.example`; the keys that now live in the app are
`[optional]`, Dakota's included (no longer `[never]`); a `[platform]` tag covers Railway's own variables. railway.md §4's table is regenerated.

**Not done.** Each person's mailguard key is still kept in the Mac's Keychain, which a Railway server does not
have, so drafting to Gmail from Railway waits for a database-backed key store. A deployed server's roster comes
from the demo seed or `init.jsonc`; there is no page to add people yet.

Tests: 15 new properties (`scripts/properties/railway-setup.ts`), on PGlite and on Postgres, through the real
route handlers and a fake Google: encryption at rest, the environment winning, validation, the setup code and
its limits, a failed setup writing nothing, session tampering, expiry and epoch, the callback's five refusals and
one admission, a non-admin refused and logged on every Connections action, no decoy secret in audit rows, logs or
either page, the key readers, and cross-site POSTs. Invented data only; nothing contacted Google, Railway or any
other service.
