# A tie between two LPs no longer moves a strategy's best-path pin; alias findings count in triage · 7 Oct 2026

Netholabs Selected rewrites on 7 Oct found 13 of 17 strategies stale only because their best-path pin moved from none
to C, every time through a tie between two LPs (same employer, co-investors), with no route of ours changed. The
batcher and the checker now give the pin two tiers to match (`bestTiers`): the best over every path, and the best
over the paths that start from our side (the team and our organizations). A pin that matches either holds,
so old pins written over all paths stay fresh, and a new tie from our side still stales the strategy.

Triage read "researched: false" for an LP whose finding is filed under an alias. It now resolves each finding to its
candidate through `entity-keys.json`, as the batcher does.
