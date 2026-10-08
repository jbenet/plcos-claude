# A W13 merge can name two records instead of a review group · 8 Oct 2026

Issue 0138. Two records the import keeps apart because their external IDs differ form no review group, so they had
no group hash and no W13 merge could reach them. A merge line may now leave out `group` and name the two records in
`members`. Everything else a merge needs still applies: active records of one type, and for each pair of differing
IDs a "Same real organization: source:X = source:Y" line with a supporting excerpt. As before, only the import's own
`different_external_id` separation is cleared; one a person recorded still refuses. Only a merge may leave out the
group, and a line that gives a group still needs it to be current. Two identity-review properties cover this.
