# PLC OS (macOS app)

PLC OS as a Mac app (docs/31-desktop-app.md). Juan, 14 Oct 2026: "Make a local app (similar to JuanMail, using
Tauri), with a local db … server should be the ground truth … any local writes need to land on the server … try to
make it extremely fast and snappy … ideally just loads the same frontend as the server app."

- **The same pages** as the live server, in a native window. Links off the server open in your browser.
- **Signed in as you**: the first launch opens your browser at the server, where you press **Allow**; the app then
  holds a session of yours in the Keychain. Everything it does is yours in the audit log.
- **Fast**: reads come from a copy on this Mac (the server's own build on a local Postgres, synced down every few
  seconds) whenever it is current; every change goes straight to the server. Static files are kept on disk.
- **Menu**: View → Reload (⌘R), Back (⌘[), Forward (⌘]), Today (⇧⌘H), Sync Now (⇧⌘S), Sync Status, Open This
  Page in Browser (⇧⌘O). PLC OS → Sign Out of This Mac, Open Logs.

## Needs

- Node 20 or later on your login shell's PATH (`brew install node`).
- For the local copy: Homebrew Postgres (`brew install postgresql@17`) and an Admin account. Without either, the app
  still works, reading from the server.

## Build and install

```bash
cd desktop/plcos && npm install && npm run install-app
```

This builds `PLC OS.app` and copies it to `~/Applications`. It is ad-hoc signed: on first launch, right-click it and
choose Open. `npm run icon` regenerates the icons from `icon-source.png`.

## Where things are

- `core/core.mjs`: the local core (pairing, cookie jar, routing, static cache). `core/local.mjs`: the local copy.
  Both plain Node, no dependencies; `npm run core` runs the core alone for testing (open
  `http://127.0.0.1:47100/__desktop/enter?k=$PLCOS_DESKTOP_KEY`).
- `~/Library/Application Support/PLC OS/`: `core.log`, `local-server.log`, the downloaded builds, their dependencies
  (`deps/`), the Postgres cluster (`pg/`, port 57435), the static cache and `settings.json` (`{"server": "https://…"}`
  to point at another server).
- The session is the Keychain item "PLC OS desktop" for the server's host.
