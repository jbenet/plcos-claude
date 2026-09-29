## Feedback sheet — ported from the feedback-dev-kit's 0.1.1/0.1.2 round

Juan asked (29 Sep 2026) for the sheet improvements from his separate feedback kit
(`feedback-dev-kit`, commits aecface, b8c13a6 and 6830ba8) to come back into Capital OS's
own feedback box, which predates the kit and had drifted from it.

| | |
|---|---|
| ![The sheet's own heading, and a focus ring in the theme's accent while typing](docs/changelog/shots/feedback-sheet-kit-port/01-heading-focus-ring.webp) | **A bigger "Feedback" heading**, not a small-caps label — the "What went wrong?" heading, its intro paragraph, the destination line and the priority note are gone; the fields speak for themselves. The field's label is now **"Enter any feedback:"**, its placeholder is tighter (no blank line before "Markdown works…"), and its accessible name defaults to "Enter any feedback". The text area gets a **visible focus ring** in the theme's own accent colour — `--accent` mixed at 22% for the ring, `--ink` at 8% for the shadow — the instant the cursor is inside it. |
| ![The screenshot help in a (?) tooltip, and the automatic-capture wording](docs/changelog/shots/feedback-sheet-kit-port/02-screenshot-tooltip.webp) | **The screenshot explanation moved into a `(?)` badge** beside Whole page / Pick a part, shown on hover or keyboard focus; its text ends with where the report is filed (the old separate line). Tooltips throughout the sheet (Drafts, Wider, Annotate, Delete, the misaligned toggle, the `(?)` badge) now show **at once**, with the kit's CSS `data-tip` pattern, instead of the browser's slow `title` tooltip. The automatic capture's flag now reads "Automatic capture may not be exact.", and pressing **Misaligned? Tell us** now actually toggles a flag (`context.capture.misaligned`), recorded with the report — Capital OS had only a static tooltip here, not the kit's toggle, so this round also closes that gap. Once flagged, the hint reads "Click the **Whole Page** or **Pick a Part** to take a screenshot in your browser." |

**Line breaks are plain newlines again.** `tiptap-markdown`'s default hard-break serializer
writes a backslash plus a newline, which showed up as a stray `\` at the end of every
Shift+Enter line, in the Markdown tab and in a reopened draft. `MarkdownField` now turns
StarterKit's `hardBreak` off and registers its own `HardBreak.extend(...)` whose markdown
serializer writes a plain `\n`, matching the field's existing `breaks: true`. Added
`@tiptap/extension-hard-break` at `3.31.3`, pinned to the `@tiptap/*` packages already in
the lockfile.

**Adapted, not copied verbatim:** Capital OS keeps its own accent tokens and green-by-default
theme (`lib/theme.ts`, `app/globals.css`) rather than the kit's `--fbk-*` palette — the task
was to bring the *improvements* over, not the kit's skin. The tooltip CSS is scoped to
`.drawer [data-tip]` (Capital OS has no single `.fbk` wrapper class); the external "Give
feedback" launcher button, outside the sheet itself, keeps its native `title` tooltip. The
misaligned-flag toggle is new *behaviour* here, not just new copy — Capital OS's version of
that control was decorative only — added because the requested hint text only makes sense
once a capture can actually be flagged.

**Verification:** `npx tsc --noEmit -p .`, `npm run boundaries` and `npm run props` (700 of
700) all pass. On this branch's own demo server, a Playwright check (against a temporary,
unshipped `/dev/...` fixture that renders `<FeedbackButton />` directly — a dev worktree's
normal launcher renders "filed from the live app" instead, since only the live folder's row
files locally) confirmed: the heading, the removed paragraphs, the `(?)` tooltip text ending
in the destination note, the focus ring's `box-shadow` appearing on focus, a Shift+Enter
line break round-tripping through the Markdown tab and a reloaded draft with no backslash,
the "Automatic capture may not be exact." label, and the misaligned toggle's text and hint.
**Not run:** `E2E=1 bash scripts/gate.sh` — this worktree's branch was 182 commits behind
`master` when the task started (no unique commits of its own) and predates `scripts/gate.sh`
and `scripts/e2e.ts`; merging `master` into the branch was refused by the sandbox as a
shared-resource change, so it is left for the integrator, who should rerun the gate on the
merged result. `scripts/feedback-regression.ts` and `scripts/feedback-dom-regression.mjs`
(both already on this branch) were left un-run rather than started on port 3211, outside
this worktree's assigned 3110–3119 range.
