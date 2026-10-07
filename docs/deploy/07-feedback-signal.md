# 07 — The feedback signal: new feedback wakes project dev

Built 7 Oct 2026. Juan: "create a thread to work on feedback given to the app periodically … should check
both server and local app for feedback … can poll feedback, or can setup a callback in the app to tell you.
idk what's better. (dont mean to waste tons of tokens checking URLs periodically, ideally want an efficient
way of signaling project dev to pick up tasks)".

## 1. The choice: the app tells, nobody polls

A scheduled check costs a Claude session every time it runs, mostly to find nothing, and the cloud sessions
cannot reach the Railway host anyway (the session proxy answers 403). So the app pushes instead:

1. The feedback box journals and files an issue exactly as before (`lib/feedback-ingest.ts`).
2. Each ingest pass hands the ids it filed to `lib/feedback-signal`. They wait in
   `<issues>/inbox/signal.json`, which survives a restart.
3. Once the box has been quiet for 90 s, and at most once every 10 minutes (both GUESSes), the server fires
   one Claude Code routine over its API trigger (`POST https://api.anthropic.com/v1/claude_code/routines/<id>/fire`).
   A refused or failed fire keeps the ids and retries after 1, 5, 15, then every 60 minutes.
4. The routine, **PLC OS feedback signal** (`trig_01VVyeQNzS4hwLTn62mzsvSH`), wakes the project thread
   "feedback pickup", which reads the issues, fixes what is clear, and reports there.

An idle day costs nothing. A burst of ten reports is one wake.

The Mac app runs the same code: give it the same two settings and it signals too. Its signal says it came
from the Mac and names the folder instead of a link, since nothing in the cloud can reach the Mac's
localhost; the thread reads those files through the Mac folder Juan approved for this project.

## 2. What the signal carries

Only ids, where to read them, and a signed read link:

```
PLC OS feedback signal
new issues: 0201, 0202
server: https://<public address>
read: https://<public address>/api/feedback/signal?ids=0201,0202&exp=<unix>&sig=<hex>
link expires: <ISO time>
```

No title, body, reporter or screenshot leaves in the signal: issue text is real data
(`docs/agent-rules/real-data.md`), and the agent reads it from our server while working, which is the
approved exception.

## 3. The read link

`GET /api/feedback/signal` (`app/api/feedback/signal/route.ts`) returns `{ items, missing }`: each named issue
as the issues list has it, plus its `markdown`. `&file=<path>` returns one of those issues' own attachments
(screenshots), and nothing else in the folder. The signature is an HMAC over the ids and the expiry, with a
key derived from the routine token, so:

- it reads only the ids it names, for three days (GUESS: a thread can wake late);
- no stored credential is needed on the reading side;
- removing or replacing the token turns the signal off and kills every link already sent.

Signal off (no token) or a preview copy: 404. Bad signature or expired: 401.

## 4. What the woken thread does

1. Read the issues through the link (or, for the Mac, the files in its live folder).
2. Triage: what is clear and small gets fixed now; what needs Juan's call gets one question in the thread.
3. Fix on a `claude/<topic>` branch off `claude/main`, gate it, merge and ship per project memory.
4. Close each issue on the server it came from, with a "Done" note and `closed_at`, through the app or the
   sync token, never by hand-editing the volume.
5. Reply in the thread: what changed, what waits on Juan. Issue text never goes into git, a PR, a commit
   message or a sub-agent prompt; PRs describe the change, with invented examples.

## 5. Turning it on (once)

1. At claude.ai/code/routines, open **PLC OS feedback signal** → Edit → Add another trigger → API →
   Generate token. Copy the URL and the token (it is shown once).
2. In the app on Railway, Settings → Connections → Tokens: paste them into **Feedback signal URL** and
   **Feedback signal token** (or set `FEEDBACK_SIGNAL_URL` / `FEEDBACK_SIGNAL_TOKEN`).
3. For the Mac app, the same two values in its own Settings → Connections.

Limits from the routine API (research preview): 100 fires an hour per account; the beta header is
`experimental-cc-routine-2026-04-01` and may change. The 10-minute gap keeps us far under it.
