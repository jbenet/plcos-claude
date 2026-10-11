# Astra (macOS menu-bar app)

A small Tauri app for the Astra runner (docs/30-astra-runner.md). Juan, 11 Oct 2026: "make a small native app with
Tauri that has the workflow processing with Astra and connects to the server".

- **Menu bar:** a sparkles icon whose menu shows the runner's state and has Open Developer → Astra, Open in Browser,
  Start or Stop Runner, Open Runner Logs, Open at Login and Quit.
- **Window:** the server's Developer → Astra page (`<app-url>/dev/astra`). The URL is the Keychain item the runner
  uses (`plcos-railway` / `app-url`), else `~/.plcos-helpers/cloud-url`. Closing the window hides it.
- **Workflow processing:** the app runs `npm run astra` in the live checkout (`$PLCOS_LIVE`, default
  `~/git/plc-os/plcos-claude-live`). That runner polls `POST /api/sync/astra` on the server and runs the batches. The
  app restarts it 30 s after it exits, and stops it on quit. Its log is `plcos-data/real/workflows/astra/runner-app.log`.
  If the runner is already installed as a login item (`npm run astra:install`, launchd label
  `com.plcos.astra-runner`), the app leaves it alone and only shows it. Use one or the other: to let the app own the
  runner, run `npm run astra:uninstall` first.
- **No Claude in the loop.** The app runs as you; the page gets no Tauri commands.

## Build and install

```bash
cd desktop/astra && npm install && npm run install-app
```

This builds `Astra.app` and copies it to `~/Applications`. Then tick **Open at Login** in its menu. The app is
ad-hoc signed: on first launch, right-click it in `~/Applications` and choose Open. `npm run icon` regenerates the
icons from `icon-source.png`; `src-tauri/tray.png` is the menu-bar icon.

If Google sign-in refuses to run inside the app's window, use **Open in Browser**; the runner works either way.
