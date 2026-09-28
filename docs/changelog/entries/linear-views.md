## Linear on the standup and each vehicle's Overview

Juan, 27 Sep 2026, late: "Think about what would be useful to show in Daily Standup and in Overviews
for each vehicle … I do think we should try to show Linear tasks as close as we can to the Linear UI,
so it's visually familiar to humans and they don't have to learn a new way of representing the same
stuff." This reverses the earlier "read-only, fewer pages" decision for two places, the standup and
a vehicle's Overview; the decision and the reasons are in [docs/24-linear.md](docs/24-linear.md).
Still read-only: nothing is written to Linear, and nothing is on LP pages or the Calendar.

**A Linear-shaped issue list** (`components/linear/`). Rows are laid out as Linear lays them out:
priority (three dashes for none, an exclamation box for urgent, one to three bars for low to high),
the identifier in muted mono, the status circle (dashed for backlog, open for to do, half-filled for
in progress, three quarters for review, a checked disc for done, a crossed one for canceled), the
title, then labels as small pills with their Linear colour, the project with its colour, the due
date (red with a warning mark when overdue, amber on the day), and the assignee's initials last.
Groups follow Linear's order: in progress, to do, backlog, done, canceled. Every row opens the issue
in Linear in a new tab. The icons are drawn here in our palette; no Linear asset is used. Labels,
project and identifier give way, in that order, as a list gets narrow; rows are 44 px on touch.

**My Linear, on the daily standup,** in place of the fixture pane: the signed-in person's issues, in
progress first, then due within a week or overdue, then to do, twelve at most with the rest counted
and linked to Linear; backlog is counted, not listed. A **Team** tab shows everyone's work in
progress, grouped by person. It is live, not pinned with the day, and says so on a pinned day. A
person is found by email, or by the new optional `linearEmail` on their row of the init file's team
(like `affinityEmail`); someone unmatched is told exactly that, and which field fixes it.

**Workstreams, on each vehicle's Overview:** the Linear projects linked to the vehicle, each with
its status, lead, done/total and target, on one shared start-to-target strip with a line for today;
beneath, the next six open issues by due date then priority, and the latest done. A card, not a
page; Linear's own timeline is a click away.

**Links, accepted once.** A new table, `linear.link`, holds vehicle ↔ project links with their
provenance (source, as of, confidence, who). Developer → Linear suggests a vehicle's projects by the
vehicle's names, and a person accepts each (or all of a vehicle's at once), turns one down so it is
not offered again, links another by hand, or removes a link. Stored once per pair, so a double click
changes nothing; every change is in the audit log. Nothing links by name alone.

**Also:** label and project colours are now read from Linear (a full resync on the live server
fetches them for records that have not changed since); the demo's invented workspace grew to 39
issues on a team keyed PLC, with an In Review state, key-result labels and nine projects.

Checked on the demo with the invented workspace at 1440×900, 1180×820 with touch and 390 px, on
PGlite and Postgres: five new properties (linearEmail matching, the My Linear grouping, Linear's
group order, links shown only once accepted and stored once, a turned-down suggestion not offered
again). No screenshots of real Linear.

| | |
|---|---|
| ![The daily standup with the My Linear section, before this demo server's own sync](docs/changelog/shots/linear-views/01-standup-my-linear.webp) | My Linear on the standup, with its Mine/Team tabs. This demo server has not run Sync Linear yet, so it reads "hasn't been read on this server yet" rather than showing issues — the section itself is what's new. |
| ![A vehicle's Overview with the Workstreams card, before this demo server's own sync](docs/changelog/shots/linear-views/02-overview-workstreams.webp) | Workstreams on the vehicle Overview, in the same not-yet-synced state; once linked projects exist it shows their start-to-target strip and next open issues. |
