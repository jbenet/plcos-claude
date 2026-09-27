# 0090 — The shell on a phone and a narrow tablet

At 390 px wide the rail kept its full 244 px, and pages with a side pane kept that too, which left the
page about 146 px. On a tablet held upright (768 px) the rail and the pane together left a column
about 230 px wide, where the LP page's status ladder printed its labels on top of each other. The
shell now folds by the window's width, never by the browser's user agent, since an iPad in split
view can be as narrow as a phone and still reports itself as a Mac.

- **Phones, up to 760 px.** The rail becomes a top bar in the rail's colours, with a menu button and
  the brand. The menu opens the same rail as a sheet from the left, with the same sections in the
  same order, and larger rows for a finger. It closes when you follow a link (the page you are
  already on included), press Escape, use its close button or tap outside it. While it is open, Tab
  stays inside it and the page behind is inert; when it closes, focus goes back to the menu button.
  The page gets the whole width. Its breadcrumb bar wraps and scrolls away under the top bar, so the
  two bars do not stay stacked on screen. A queue column (Approvals, Decisions, warm intro routes)
  sits above the work in a box that scrolls on its own. A card holding a wide table scrolls that
  table sideways inside the card, and the page never scrolls sideways. The house row (kind · text ·
  state, as on Today) puts the kind and the state on the first line and the text on the whole
  second line, instead of a column a word wide. The feedback box takes the full width.
- **Side panes, up to 1023 px.** A **Details** button in the breadcrumb bar replaces the pane toggle.
  The pane opens over the page from the right on a tablet and from the bottom on a phone. It has a
  Close button, and it also closes on Escape, a tap outside or a link followed from inside it. Focus
  stays in the pane while it is open and goes back to Details when it closes. The pane always starts
  closed at these widths. The desktop's remembered open or closed choice is kept as it was.
- **Above 1023 px nothing changes.** The desktop and an iPad in landscape (1180 px) get the same
  layout as before, pixel for pixel apart from the sync time. The new styles live in
  `components/shell/Shell.module.css`, and `app/globals.css` is untouched.
- **Heights and edges.** Sheets use the measured window height from issue 0029 (`--app-h`), with
  `100dvh` as the fallback. The viewport is now `viewport-fit=cover`, and the top bar, sheets, pane
  and page are padded by the safe-area insets, which are zero except on devices with a notch or a
  home indicator.
- **Properties.** The stylesheet's breakpoints must match `lib/viewport.ts` (`PHONE_MAX`, `PANE_MAX`),
  and outside its media queries it must touch no shared class, so the desktop layout cannot change by
  accident. Tab and Shift+Tab must wrap inside an open sheet.

Checked on the demo at 390×844, 768×1024 and 1440×900 on Today, Pipeline, an LP page, Strategy and
warm intro routes, in Chromium. Safari on an iPad could not be tested here.
