# PLC OS as a Mac app, reading from a copy on the Mac · 14 Oct 2026

Juan, 14 Oct 2026: "Make a local app (similar to JuanMail, using Tauri), with a local db, etc. for PLCOS … server
should be the ground truth … any local writes need to land on the server … try to make it extremely fast and snappy
… ideally just loads the same frontend as the server app."

- **PLC OS.app** (`desktop/plcos`): the server's own pages in a native window, with a Mac menu (reload, back and
  forward, sync now, open the page in the browser, sign out).
- **Signed in as you.** The app opens your browser at the server; you press Allow on the new **/desktop/pair** page
  and the app receives a session of yours, signed like Google sign-in's. No token, no sign-in inside the app.
- **Reads from the Mac, writes to the server.** A small local core serves the window. Every change goes to the live
  server as you. Reads come from a copy on the Mac when it is current: the server's own build (downloaded from it, so
  its server actions match) on a local Postgres that syncs down every few seconds, reading only tables and rows that
  changed. After a change, reads go to the server until the copy has caught up, so your change never seems to vanish.
  Anything missing or behind on the Mac falls back to the server; with the network down, pages you can read still open.
- **For Admins** the copy holds the whole database, as a snapshot does; others use the app on the server alone.

Notes: `docs/31-desktop-app.md`. Server: `/api/desktop/pair`, `/api/desktop/info`, `/api/desktop/sync`,
`/api/desktop/build`, all read-only except the pairing.

**Hardening, same day** (a red-team pass): people's own secrets stay on the server (mailguard keys and calendar
addresses are not copied; secret settings and token hashes arrive as stand-ins), Settings and Preferences always load
from the server, sync and build downloads are refused where snapshots are and are audited, the build download is an
allowlist, and pairing caps unanswered requests per address.
