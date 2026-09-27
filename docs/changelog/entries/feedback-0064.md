## 0064 — Feedback shortcut and retained pictures

Alt/Option+F opens feedback throughout the shell, with the shortcut shown beside Feedback and in keyboard help. Closed native dialogs no longer block it; typing, composition and open dialogs keep their keys. Screenshot controls now share the embedded image's top-right Annotate/× toolbar.

Paste and drop intercept files before the rich editor handles accompanying HTML. Image batches are read in order, adding beside a selected image instead of replacing it. A multiple-file picker is available. Filing waits for image reads, saves draft pictures before requesting a receipt, and keeps the draft if the request fails or times out. Restoring a draft resolves pictures loaded after its text. Unconfirmed filing no longer claims that nothing was written.

The existing file-first service already writes every attachment before the issue and before database work. Regressions verify exact attachment bytes and body links when metadata fails or stalls. Type checking, boundaries and all 387 properties pass. Five demo pages on port 3211 pass the page budgets: first measured requests below 0.60 seconds, repeats below 0.22 seconds.

All 13 DOM regressions pass. They exercise actual React/Tiptap paste, drop and file-picker events with two and three images, selected-image insertion, overlapping reads, source round trips and delayed picture restoration. Every packed image is verified in a filed scratch issue. Browser launch was unavailable in the managed environment. HTML checks pass; the browser regression script is included for a later run. No screenshots or real records are included.
