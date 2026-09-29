# Feedback: the annotation toolbar is one row of icons

| | |
|---|---|
| ![The screenshot annotation toolbar at 1280 px, before and after. Before: tool icons, colour swatches, then five word buttons, Undo, Redo, Clear, Cancel and Done. After: one slim row of icons in four groups split by thin lines, with a tooltip under the undo arrow reading "Undo ⌘Z"](docs/changelog/shots/shot-editor-icons/01-toolbar-desktop-before-after.webp) | Desktop, before and after. The tools, the colours, the edits and the way out are four groups with a thin line between them. Hovering a button shows its name and its shortcut. Demo data, 1280 × 820. |
| ![The same toolbar on a 390 px phone with touch, before and after. Before: three rows. After: one row of 44 px buttons; the colours start at the right edge of the part that scrolls, with Cancel and Done fixed at the end](docs/changelog/shots/shot-editor-icons/02-toolbar-390-touch-before-after.webp) | A 390 px phone with touch, before and after. Three rows became one. The tools, colours and edits scroll sideways, and Cancel and Done stay in view. Demo data, WebKit with touch. |

**What Juan asked (29 Sep 2026).** "Improve feedback to use icons with the buttons on the annotation
tool bar (so they're slimmer). Can have tooltip to say what they are."

**What changed.**
- Undo, Redo, Clear, Cancel and Done are icons now: a curved arrow each way, a bin, a cross and a
  tick. Done is filled, so it still reads as the button that finishes. The tools' icons are drawn
  in the app's own line style too (the pencil, arrow, line, box and T), where some were text
  characters before. The new drawings are in `components/ui/Glyph.tsx`, and no icon package was
  added.
- Every button has a name for a screen reader, and a tooltip with that name under the button on
  mouse hover or keyboard focus. The tooltip adds the shortcut where there is one: ⌘Z (Ctrl+Z off
  a Mac) for Undo, ⌘⇧Z for Redo and Esc for Cancel. It is one element placed under the button, not
  the browser's `title`, because a `title` never shows on keyboard focus. A disabled Undo still
  shows its tooltip. A finger gets no tooltip, since a tap presses the button.
- Every control in the bar is a 32 px target, or 44 px on a touch screen. The swatches look the
  same size as before inside that target. The tool in use and the colour in use keep their filled
  or ringed state.
- The bar is one row at any width. When the screen is too narrow, the tools, colours and edits
  scroll sideways and Cancel and Done stay fixed at the end. On a 390 px phone the tools and one
  swatch show, so reaching Undo takes a swipe. On an 820 px iPad in portrait everything fits.
- What each button does is unchanged, and so are the shortcuts.
- The label's own small bar (size, bold, colours, Done, ×) is unchanged.

**How it was checked.** With Playwright on the demo server:
- Chromium and WebKit at 1280 px with a mouse: the bar is one row of 32 × 32 buttons. Hovering
  Undo shows "Undo ⌘Z". Keyboard focus shows the tooltip too (Tab in Chromium, Option+Tab in
  WebKit, which is Safari's key for moving between buttons). Drawing, undo by click, redo by ⌘⇧Z
  and Done all behaved as before.
- Chromium and WebKit at 390 px with touch, and WebKit at 820 px with touch: one row of 44 × 44
  buttons. A tap on a tool selects it and shows no tooltip.
- The label bar's swatches keep their colours.

Real iPad Safari was not tested.
