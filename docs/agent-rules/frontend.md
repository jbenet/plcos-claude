# Frontend contract

Rules moved from AGENTS.md. Read this file when its scope applies; all rules still hold.

## Frontend contract

- **Persistent left rail, four umbrella sections**, not 24 flat nav items. Sections:
  *Discover & qualify* (01–06), *Convert & coordinate* (07–12), *Create & substantiate*
  (13–17), *Execute & govern* (18–24). Plus Today and Approvals above them.
- Breadcrumb bar with a **visible last-sync time**. Staleness is never silently rendered as
  freshness.
- Right-hand inspector opens on selection.
- **Palette** (validated, colour is never the only signal):
  ground `#F5F3EE`, surface `#FFFFFF`, ink `#1A1917`, muted `#5E5A52`, line `#E4E0D6`,
  clay `#BF4A16`, green `#0E7F55`, purple `#5F4B9E`, amber `#8A6410`.
  Rail: `#1A1917` with `#EFEBE2` text. That is the clay theme. **The default theme is green**
  since 24 Sep 2026 (issue 0010): the same meaning colours, with a green accent, ground and rail
  (`lib/theme.ts`, `app/globals.css`); clay stays one click away in Settings.
- **Type:** Fraunces (display), IBM Plex Sans (body), IBM Plex Mono (labels, data).
- **Status vocabulary is plain language**, never a numeric confidence rendered as fact:
  "Agent working", "Ready for review", "Waiting on counterpart", "Needs evidence",
  "Verified by administrator", "Source unavailable".
- **Optimistic updates only for reversible presentation choices.** Consequential commands
  wait for a server receipt.
- **Every canvas needs a list equivalent.** The route graph must have a keyboard-navigable
  path list carrying the same information — an equal presentation, not a degraded fallback.
- **States to design and test, all of them:** empty, loading, failed sync, expired
  permission, stale evidence, conflicting edits, unavailable owner, paused, exhausted
  budget, rejected claim, revoked authorization, ambiguous external execution. Each must
  say what is known, who can act, and the safe next step.
- Two components carry a discipline and should exist by name: `EvidenceRef` (inline source
  pointer, used everywhere a claim is made) and `AudienceVariants` (variant switcher for
  one canonical asset).

---
