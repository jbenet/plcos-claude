# Settings in sections, a rail that keeps its place, and a capture that works on Preferences · 7 Oct 2026

- **Preferences in sections** (issue 0130): a sidebar of Appearance, Email and drafts, Agent access and Account,
  one section at a time (`/settings?section=…`); Admins also see Connections, People and Vehicles there, which
  carry the same sidebar.
- **Making a token** (0126, 0129) shows the token and one "Copy the token" button, nothing to paste in a terminal.
  The MCP access card says what a token can do in two short lines, and the "May" choices sit one per line.
- **The rail keeps its place** (0133): its sections were rebuilt on every navigation, which closed an open WIP
  group and moved the rail. They no longer are, and the rail's scroll is kept for the tab. The WIP rows are spaced
  like the rows above them (0125); the 44px touch height stays on touch screens.
- **The automatic screenshot on Preferences** (0127, 0128): the voice form's field named `style` shadowed the
  form's own `.style`, and the capture threw on it. The field is `voiceStyle` now, and the capture skips any
  element whose style it cannot read.
