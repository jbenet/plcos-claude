# Feedback: Pick a part works with a finger · issue 0117

| | |
|---|---|
| ![Pick a part on an iPad-sized screen after a finger drag: the chosen rectangle with four round corner handles, and a bar reading "Drag a corner to adjust, or draw again" with Use this part and Cancel](docs/changelog/shots/feedback-touch-0117/01-pick-a-part-touch.webp) | After a finger drag the rectangle stays up with four corner handles. Drag a corner or the middle to correct it, draw again outside it, then press Use this part. Demo data, 1366 × 892 with touch. |

**What was wrong.** On the iPad, dragging to pick a part of the page did not work: the rectangle
stopped after the first few pixels and nothing was captured. The picker's surface let the browser
keep its touch gestures. A finger drag was read as a pan, so the browser cancelled the pointer after
the first move (`pointercancel`). The picker never handled that cancel, so it sat there with a tiny
rectangle and no way out without a keyboard. Its only exit was Esc.

**What changed.**
- The surface claims every touch. It sets `touch-action: none` and cancels touchmove and Safari's
  pinch gesture events, so a drag no longer scrolls, zooms, selects text or opens the long-press
  callout. The pointer is captured on the surface itself, one finger at a time. If the system still
  takes the pointer back, the picker keeps the selection it had before that drag.
- With a finger or a pen, letting go no longer captures at once. The rectangle stays up with four
  corner handles, each a 44 px target around a small dot. A finger that hid the corner it was
  dragging can correct it: drag a corner to resize, drag inside to move, draw again outside to start
  over. **Use this part** takes the picture; Enter does too.
- A **Cancel** button replaces "Esc to cancel", so there is a way out on a screen with no
  keyboard. Esc still works. On a touch screen the buttons are 44 px tall. When the selection reaches
  the bottom of the screen, the bar moves to the top.
- With a mouse nothing changed: letting go captures, as before.

**How it was checked.** Chromium with real touch input (the DevTools protocol at the issue's
1366 × 892 viewport) showed the fault before the fix: `touch-action: auto`, a `pointercancel` after
the first move, and a 20 × 15 rectangle that never finished. After the fix, a finger drag, a handle
drag, moving the rectangle, Use this part and Cancel all worked, and the picture landed in the box.
In WebKit with touch emulation, the picker had `touch-action: none` and 44 px handles and buttons,
and it drew, adjusted, recovered from a cancelled pointer and captured. Synthetic pointer events
drove that run, because Playwright's WebKit cannot drag with a finger. Mouse drag and Esc were
re-checked on the desktop. The iPad itself was not tested here. Safari on a real touch screen is the
remaining check.
