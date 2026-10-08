# A retype and a merge for one group apply together · 8 Oct 2026

Issue 0138. The Mac pushed two W13 lines for the accelerator's group: retype one member to an organization, then
merge five organizations. The duplicates job refused both as "Conflicting decisions for this group" and showed
nothing about it. Its status listed only the first 50 refusals, and those were all older lines.

A retype no longer conflicts with a merge or separation for the same group. Retypes apply in file order, then the
merge. Two different retypes for one group still conflict, and so do a merge and a separation. A later proposal
now supersedes an earlier one only when both are the same kind, so a merge can no longer swallow a retype.

The job status lists the newest 50 refusals first, along with the total count and the superseded lines. When the
identity review read fails, it now says why instead of returning a bare 500. A new identity-review property covers a
retype and a merge in one file.
