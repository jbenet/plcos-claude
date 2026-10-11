## The Astra app — a menu-bar app for the Astra runner, with feedback

Juan, 11 Oct 2026: "make a small native app with Tauri that has the workflow processing with Astra and connects to
the server", and "make sure this app has the feedback-dev-kit so i can give feedback through it too".

**`desktop/astra`** is a Tauri app for the Mac's menu bar (install: `cd desktop/astra && npm install && npm run
install-app`, then tick **Open at Login**). It runs the Astra runner (`npm run astra`, docs/30) and restarts it if it
stops; when the runner is installed as a launchd login item instead, the app leaves it alone. Its menu shows the
runner on this Mac and the server's view (runner up, runs running, queued and done), and can **Run 1 × W1+W5 Now**,
**Queue 4 × W1+W5 for Tonight**, open Developer → Astra in its own window or the browser, open the runner's logs, and
**Send Feedback…**.

**Feedback from the app.** Inside the window, Developer → Astra has the app's usual feedback box (Alt+F). The tray's
**Send Feedback…** opens a small native sheet, styled after the feedback kit: the text, kind and priority, **Pick a
part of the screen** for a screenshot, and optionally the runner's last 40 log lines. It files the issue on the
server as the Admin token's holder, so it works without a browser sign-in, and the issue lands on Developer → Issues
with `context.source: astra-app`.

**Server.** `POST /api/sync/feedback?op=file` files an issue by an Admin's token, journal first, as the feedback box
does. `POST /api/sync/astra` gains `op: "queue"` (what Queue runs does on the page) and `op: "status"` (the runner and
recent runs, counts only). Six new properties cover them.
