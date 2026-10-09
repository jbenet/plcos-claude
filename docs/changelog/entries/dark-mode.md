# Dark mode: light, dark or follow the system · 9 Oct 2026

Issue 0142. Preferences → Appearance has a new choice above the theme: **Light**, **Dark** or **System**.
System is the default and follows the device's setting, including when it changes while a page is open
(a laptop that turns dark in the evening takes the open tab with it). Light and Dark stay put. The choice
is kept in this browser, like the theme, and is listed under Layout with the other stored preferences.

- **A mode, not a third theme.** Clay and green each come in light and dark. The mode is applied before
  first paint by the same inline script as the theme (`data-mode="dark"` on the page), so there is no
  flash of light on a dark load. Dark also sets `color-scheme: dark`, so form controls and scrollbars follow.
- **The meanings keep their meanings.** Clay still means refused, green passed, amber needs a look and
  purple inferred; in dark each is a lighter, brighter step of the same colour, chosen so text reads at
  WCAG AA on the dark ground, the dark surface and its own tint (the lowest is clay on its tint, 6.4:1).
- **Hard-coded colours moved to tokens.** Flags, chips, washes, bar tracks, shadows, the calendar's lane
  colours and the activity charts' source colours were written as light-only hex values across the
  stylesheets; they are now named tokens in `app/globals.css` with a dark value each. Deliberately dark
  surfaces (the floor visualizations, the screenshot editor, the image viewer) are unchanged.
