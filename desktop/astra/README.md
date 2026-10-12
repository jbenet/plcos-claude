# Astra (macOS menu-bar app)

A small Tauri app for the Astra runner (docs/30-astra-runner.md). Juan, 11 Oct 2026: "make a small native app with
Tauri that has the workflow processing with Astra and connects to the server".

- **Menu bar:** a sparkles icon whose menu shows the runner's state and the server's, and has Run Now, Queue for
  Tonight, Open Developer → Astra, Open in Browser, Send Feedback…, Start or Stop Runner, Open Runner Logs, Open at
  Login, Restart Astra (stops the runner, relaunches the app, which starts it again) and Quit.
- **Window:** the server's Developer → Astra page (`<app-url>/dev/astra`). The URL is the Keychain item the runner
  uses (`plcos-railway` / `app-url`), else `~/.plcos-helpers/cloud-url`. Closing the window hides it.
- **Workflow processing:** the app runs `npm run astra` in the live checkout (`$PLCOS_LIVE`, default
  `~/git/plc-os/plcos-claude-live`). That runner polls `POST /api/sync/astra` on the server and runs the batches. The
  app restarts it 30 s after it exits, and stops it on quit. Its log is `plcos-data/real/workflows/astra/runner-app.log`.
  If the runner is already installed as a login item (`npm run astra:install`, launchd label
  `com.plcos.astra-runner`), the app leaves it alone and only shows it. Use one or the other: to let the app own the
  runner, run `npm run astra:uninstall` first.
- **Server status and queueing:** the menu shows the server's view (`op: "status"` on `/api/sync/astra`) and can
  run one W1+W5 batch now or queue four for tonight (`op: "queue"`), with the same Admin token.
- **Feedback:** **Send Feedback…** opens a small sheet (text, kind, priority, a screenshot of part of the screen, and
  optionally the runner's last 40 log lines) that files an issue with `POST /api/sync/feedback?op=file`. Inside the
  window, the page's own feedback box (Alt+F) works too once signed in.
- **No Claude in the loop.** The app runs as you; the page gets no Tauri commands.

## Build and install

```bash
cd desktop/astra && npm install && npm run install-app
```

This builds `Astra.app` and copies it to `~/Applications`. Then tick **Open at Login** in its menu. The app is
ad-hoc signed: on first launch, right-click it in `~/Applications` and choose Open. `npm run icon` regenerates the
icons from `icon-source.png`; `src-tauri/tray.png` is the menu-bar icon. The app lives in the menu bar and shows in
the Dock and Cmd-Tab only while one of its windows is open.

If Google sign-in refuses to run inside the app's window, use **Open in Browser**; the runner works either way.
