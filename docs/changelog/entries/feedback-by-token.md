# Project dev reads the app's feedback with an Admin token · 7 Oct 2026

Feedback filed in the app now reaches project dev the way JuanMail and MailGuard reach the server: a bearer token
from Preferences → MCP access, the broad "Admin" one. `GET /api/sync/feedback?view=open` lists the untouched issues
(ids and metadata, no text); `?ids=` returns their text and `?id=&file=` one of their screenshots; `POST { id,
status, note? }` moves an issue along and closes it with a "Done" note. Every call is one audit row with ids and
counts only. `scripts/cloud-feedback.sh` wraps it; design in `docs/deploy/07-feedback-signal.md` §6.
