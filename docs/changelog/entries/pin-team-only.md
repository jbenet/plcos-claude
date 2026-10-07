# The our-side tier counts only the team and our organizations; "Personal …" is a placeholder; overdue steps are counted · 7 Oct 2026

Two more findings from Neurotech sourcing. W3 types any person a finding names who resolves to nobody of ours as
"backer", so `bestTiers` (PR #32) counted an uncontacted prospect as our side and set a C pin with no route behind it.
The our-side tier now counts only paths from the team and our organizations; a pin that matches the tier over every
path still holds, so nothing written earlier goes stale on this.

"Personal investing" and "Personal Capital / …" still made colleague ties, since PR #30 matched "Personal" exactly.
Any organisation name starting with "Personal" is now a placeholder for grouping colleagues. A real firm of that
name loses only its name grouping; its staff are still grouped by their work email domain.

**Overdue steps.** A strategy whose next step's date has passed still counted as fresh; on 7 Oct most steps were dated
28 Sep to 5 Oct. The checker now reports "N with a next step whose date has passed" and lists them with `--overdue`,
reading the date from the step's words (`stepDue`). It is a count for the next revision batch, not a problem.
