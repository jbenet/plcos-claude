# Cross-source identity resolution

On the real profile, `buildNetwork()` schedules `resolveIdentities()` after materializing
the network and returns while it runs. Demo builds await it for deterministic fixtures.
Route warm-up starts after the resolver settles. The resolver uses
the server's existing database handle. It reads and writes in bounded batches, yields
between batches and individual merge transactions, and serializes resolution and undo per
handle. It opens no database or external connector. A queued rebuild gets a fresh pass
with its own evidence.

Candidates are person records sharing a full name after case, accent and whitespace
normalization, with different sources among Affinity, warehouse, W3 and prospects.
Organizations, including `network_org`, are excluded. One agreeing affiliation (including
explicit former names), email domain, carried warehouse identifier or explicit source
identifier in a finding is sufficient corroboration. The rule and actual agreeing values
are recorded in `identity.match_assertion`. Affinity wins, then warehouse, W3, prospect;
a stable entity UUID breaks equal-priority ties. Existing `not_same_as` assertions constrain
the entire component, including transitive merges.

For example, invented **Éva Vale** in Affinity and **Eva  Vale** in the warehouse merge
when both name **Example Research**, including `New Example (formerly Example Research)`.
Matching names with no corroboration remain distinct. `identity.possible_match` records
these pairs at confidence 0.25 (a policy guess, not a calibrated probability). Routes can
traverse them as explicitly labelled D-tier possible-identity bridges. They establish
neither a relationship nor consent.

Source mappings and business records retain their original IDs. The recursive
`identity.entity_resolution` view and `identity.canonical_entity_id()` project them onto
the current canonical identity. Entity, relationship, pursuit, research, affiliation,
meeting, fit, exposure and guard readers follow this projection. Restrictions and connector
load include merged aliases. Separate pursuits, commitments and tickets remain separate
business records; a merge never sums away or manufactures legal or financial state.

`undoIdentityMerge(db, assertionId, reason)` restores the recorded redirect, marks the
assertion undone and prevents a subsequent pass from silently recreating that merge.
No source facts need to be moved back. Merge, undo and possible-match changes invalidate
the graph snapshot, route generation and page-input revision; subsequent ordinary writes
to an alias also invalidate affected cached routes. Unchanged passes preserve revisions.
W3 materialization follows source redirects and no longer joins new descriptors by name
alone. Prospect import deduplicates redirected names and resolves stable keys to the
canonical person, including when a pursuit remains stored on an alias.

## Verification and copy-only measurement

Invented properties exercise normalization, corroboration rules, canonical preference,
name-only separation, negative assertions, undo, idempotence, canonical prospect imports,
route joins, cache invalidation, restrictions and D-tier bridge labels.

Run `node --import tsx scripts/identity-resolution-measure.ts` from the assigned dev
worktree. It refuses a linked real-data root, uses `/bin/cp -cR` to make an APFS clone under
ignored `data/real/`, opens only that clone with PGlite and deletes it in `finally`.
It prints aggregate counts only. Routes are evaluated at one fixed time for every
pursuit entity/vehicle-kind pair before and after resolution, without a graph rebuild.
Possible-name bridges are disabled in the clone for the after measurement, so route gains
are attributable to corroborated redirects. A stronger best route means a higher maximum
recommended route `score.value`; newly reachable and stronger-existing LPs are counted
separately. “People with multiple entities before” counts cross-source normalized-name
groups, including unresolved namesakes; it does not assert they are all the same person.

Claude assigns final migration numbers at integration. No applied migration was edited.

Measured on 26 Sep 2026 from a disposable APFS clone of the real database:

| Measure | Count |
| --- | ---: |
| Cross-source normalized person-name groups with multiple entities before | 488 |
| Corroborated merges | 53 |
| Affiliation alone | 32 |
| Email domain alone | 17 |
| Affiliation and email domain | 4 |
| Warehouse-ID / finding-reference rules without the above | 0 |
| Possible-match pairs remaining | 705 |
| Pursuit entity records evaluated | 2,195 |
| Entity / vehicle-kind route searches per comparison pass | 2,236 |
| LP records gaining a recommended route | 12 |
| LP records with an existing route gaining a higher best score | 14 |

These route counts exclude name-only bridges and count original pursuit entity records,
not a claim about the number of distinct humans. The repeated identity pass took 54.586
seconds; its largest observed event-loop delay was 662 ms in this local measurement,
not a server latency guarantee. The database remained available between batches. All
357 properties, the TypeScript check and boundaries passed. The measurement clone was
deleted after close.
