# W3 alias keys — every path filed under its LP's key

W5 passes (30 Sep–1 Oct 2026) kept meeting W3 rows whose LP was filed under an alias: a research key,
or a person's key from before a merge. The checker refused the rows whose key was not an entity UUID,
and a strategy could not cite as its route a warm connector that lived only in the other rows. The cause
was in `lib/enrich/connect.ts`. W3 keyed each finding by the key in its file, and wrote the research's
own ties under that key. The LP's paths looked findings up by the candidate key alone, so a finding
filed under an alias was never matched to its LP.

W3 now files each finding under its LP's key before building any path (`resolveFindingKeys`). It uses
the resolver the checker and the strategy batch already use (`lib/enrich/candidate-key.ts`) and the
export's `entity-keys.json`, matched against W3's endpoints: the LP units and the people who speak for
them.

- A person merged into a firm's contact gets their ties back as the firm's contact routes, with
  `viaContact` set, in the shape the import and the network build already read (docs/23).
- When two findings land on one LP, the finding already filed under the LP's key stays its profile, so
  no LP loses paths it had. Every finding's recorded ties still count.
- The same record arriving twice for one LP and connector becomes one row, at the better tier, with a
  source if either copy had one. A different basis is different evidence and stays a separate row, as
  W3 already did.
- A key nothing resolves is not dropped. If it is an entity UUID, its rows stay in the file: they are
  ties for someone outside the LP set, and the network build reads them. Any other key's rows go to
  `enrich/connections-unresolved.jsonl`, which W3 counts and the import does not read.

A read-only dry run on the real files (counts only; nothing written) gave these results. Of 14,926 rows,
786 sat under a key that was not an LP unit, a contact or a sourced connector, and the checker refused
364 of them. With the fix, 387 of those 786 rows resolve to their LP: 316 to an LP unit and 71 to a
contact, which now also route to the firm. 361 stay as connector rows for people outside the LP set,
and 38 rows (30 keys) go to the unresolved file. No row fails the checker's path test. 1,867 findings
filed under another key now count for their LP. LPs with an A or B path rise from 198 to 235.

Invented properties (`scripts/properties/w3-alias-keys.ts`) cover:
- an alias from the export's map;
- a merged person reaching the firm as a contact route;
- both kinds of unresolvable key;
- duplicate rows merging to their best tier, in both orders;
- 40 seeded random cases checking that each tie lands once, under its LP at its best tier or in the
  unresolved file, in whatever order the findings arrive;
- the file run reading `entity-keys.json`.

Validation: `bash scripts/gate.sh`. The integrator reruns W3 on the real folder.
