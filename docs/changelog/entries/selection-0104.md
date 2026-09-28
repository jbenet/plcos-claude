## Selection 0104 — Move to Selected, no note, and Undo

Issue 0104 (Selection, on an SPV): changing a status failed, it asked for a note, and the page had
no single obvious action.

| | |
|---|---|
| ![Selection's side panel, with the Move to Selected action](docs/changelog/shots/selection-0104/01-move-to-selected.webp) | The side panel's Move to Selected action, on the current Selection page (redesigned again in 0109, below). |

**The error.** Every status change from Selection, the pipeline table and the fit list made its
idempotency key with `crypto.randomUUID()`. Browsers only provide that in a secure context
(https or localhost). The live server is reached over plain http on the local network, so on the
iPad it was undefined and every save failed with "crypto.randomUUID is not a function" before
reaching the server. On localhost it worked, which is why it was never seen in development.
`lib/request-key.ts` now makes the key, with `crypto.getRandomValues` as the fallback (available
in every context) building the same kind of version-4 UUID. The four browser callers use it, and
`npm run boundaries` now refuses `crypto.randomUUID(` in any `'use client'` file.

**No note.** A status change from Selection, the pipeline table's tray or the fit list no longer
needs a note. The audit rows still record who changed it, when, and from and to. With no note they
also record the rule "set on Selection by <user>" (or "Funder–vehicle fit", "Pipeline"), which
also becomes the status reason. Passed still needs who ended it and why: the server now refuses
a Passed without a reason, and the forms no longer pick the first reason for you.

**Move to Selected.** The side panel opens with one large button. It moves the LP in focus, or
every ticked LP when some are ticked ("Move 3 to Selected"). The `s` key does the same. Moving the
LP in focus passes the focus to the next one, so `s`, `s`, `s` works down the list. It uses the
same audited path as Set status: one transaction, one key per request, and a refusal of the
whole batch if any status changed since the page loaded. A toast at the bottom says what moved
and offers **Undo** (or `u`). Undo puts each LP back to its previous status, with who ended it and
why when that was Passed, through the same path. Both changes stay in the log. A second tap does
nothing, and nothing is undone if any of those LPs has changed since. The tray's Set status gets
the same Undo. Everything else stays secondary: "Open strategy" is now an ordinary button, and
"Select for an action" is now "Tick for a batch", because it had nothing to do with the Selected
status.

A known consequence: once a person has set a status, Affinity's translation no longer changes it,
and that still holds after an Undo. The audit log is append-only, so the move stays on record.

**Checked** on the demo, with `randomUUID` removed as on plain http, at 1440×900 and at 1180×820
with touch, for PLC Neurotech I and an SPV: move one, move several, undo each, Passed with who and
why, and no console errors. Also at 390 px wide, where the button sits under the LP in focus.
Four new properties: keys without `randomUUID`, no note needed except for Passed, Undo restores the
previous status, and bulk moves are all-or-nothing with each row audited once.
