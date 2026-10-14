# 31 — The PLC OS desktop app

Juan, 14 Oct 2026: "Make a local app (similar to JuanMail, using Tauri), with a local db, etc. for PLCOS. Leverage
all the local data we have, but figure out how to interface with the server. Server should be the ground truth.
Should sync down updates over time. Any local writes need to land on the server. Try to make it extremely fast and
snappy. Ideally just loads the same frontend as the server app, just is able to access some local data. Fine to use
the server for all its actions (instead of duplicating in local client)."

This file records the shape chosen and why. Decisions were made overnight without Juan; each says what it rests on.

## 1. Shape

```
 PLC OS.app (Tauri, desktop/plcos)            Mac                               Railway
 ┌─────────────────────────────┐   ┌──────────────────────────────┐      ┌────────────────────┐
 │ window: http://127.0.0.1:47100 ─▶ core (Node, one file)          │      │ the live server     │
 │ menu: reload, back, sync,   │   │  • cookie jar (your session)  │─────▶│ (ground truth)      │
 │ open in browser, sign out   │   │  • writes → server, always    │ https│                     │
 └─────────────────────────────┘   │  • reads  → local copy when   │      │ /api/desktop/*      │
                                   │    it is current, else server │      └────────────────────┘
                                   │  • local copy: the server's   │
                                   │    own build + a Postgres      │
                                   │    replica, synced down        │
                                   └──────────────────────────────┘
```

- **The same frontend.** The window shows the server's own pages. There is no second UI to keep in step.
- **The core** (`desktop/plcos/core/core.mjs`) is a small Node program with no dependencies of its own, started by
  the app. It serves the window on loopback only and decides, per request, where it goes.
- **Writes always go to the server**, as you. A server action or an API call is forwarded with your session; nothing
  is written locally first. So attribution, approvals, audit and every rule stay exactly where they are.
- **Reads go to the local copy when it can answer**: the local copy runs the *same build* as the server, on a
  replica of the server's database. After a write, reads go to the server until the replica has caught up past it,
  so you never see your own change disappear.
- **If anything local is missing or behind** (no replica yet, the server deployed a newer build, the local server
  errors), the core sends the request to the server instead. The app always works; the local copy only makes it
  faster.

### Why not JuanMail's exact shape

JuanMail bundles its own UI and talks to a REST API, so its writes are plain HTTP calls. PLC OS's pages are
server-rendered and most writes are Next.js server actions (about 110 of them). A server action can only be
forwarded to a server that runs the identical build (action ids are salted per build), so the local copy runs the
server's own build, downloaded from it, instead of a build made on the Mac. What we took from JuanMail: the device
pairing for sign-in, polling a change feed rather than re-pulling everything, giving up after a few retries, and
asking the login shell for PATH once (a Finder-launched app has almost none).

## 2. Sign-in: pairing, as you

Token sign-in is not acceptable for people (Juan, 12 Oct 2026). The app holds a real session of yours:

1. The core asks the server to start a pairing (`POST /api/desktop/pair`, `op: start`). It gets a secret device
   code and a short code to show.
2. It opens `<server>/desktop/pair?code=<short code>` in your normal browser, where you are already signed in with
   Google. The page shows the same short code and the device's name; **Allow** approves it.
3. The core polls (`op: poll`) with the device code and receives a session cookie for you, signed exactly as the
   Google sign-in signs one (`lib/auth/session.ts`), for the same number of days. It is kept in the macOS Keychain.

So every action from the app is yours in the audit log. "Sign out everywhere" (raising your session epoch) signs the
app out too. Google's sign-in never runs inside the app's window (Google refuses embedded web views). A pairing is
held in the server's memory for ten minutes; a deploy in that window just means pairing again.

## 3. The local copy

Increment 2. The core downloads the server's build (`GET /api/desktop/build`, Admins only: it carries the build's
action encryption key), installs its runtime dependencies once per lockfile, and starts it on loopback with
`DATA_PROFILE=real`, the preview rules on (`PREVIEW_COPY_AT`: no connectors, no jobs, every write refused) and the
local user set to you. The database is a Postgres on the Mac (Homebrew `postgresql@17`), schema made by the build's
own migrations, rows synced down from the server:

- `GET /api/desktop/sync/state` lists every table with its primary key and Postgres's own change counters
  (`pg_stat_user_tables`). Only tables whose counters moved are read.
- `GET /api/desktop/sync/rows?table=…&since=…` returns the rows changed since a transaction horizon (`xmin`), as
  NDJSON, and the new horizon. Deletions are found by comparing row counts, then primary keys.
- Nothing is added to the server's write path: no triggers, no change table. The cost is a filtered scan of the
  tables that changed, only while the app is open.

## 4. What stays on the server

Everything that acts: server actions, imports, Astra runs, connectors, mail, approvals. The local copy never runs
a job or a connector (the preview rules), and never holds a key.
