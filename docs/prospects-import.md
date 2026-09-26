# Adding researched prospects

Juan's instruction of 26 Sep 2026 authorizes adding good LP fits with useful check sizes
(ideally $500K or more) or strategic value for the vehicle. This is a pipeline plan,
not investor interest, consent, a commitment or permission to contact anyone.

Place JSONL files in `plcos-data/real/enrich/prospects/`. The live checkout reads these
through `data/real/enrich/prospects/`. Each line describes one person–vehicle pair:

```json
{"personKey":"warehouse:invented-person","name":"Example Person","org":"Example Organization","vehicle":"neurotech","status":"sourcing","capacity":{"band":"$500K–1M","basis":"Invented fixture: estimated investment capacity","guess":true},"reason":"Their investment interests fit this vehicle.","strategic":false,"route":null,"sources":["Invented fixture only"]}
```

`personKey` must be the person's existing entity UUID or the exact stored source ID in
the `warehouse` or `w3_person` namespace. The example key is illustrative, not a naming
convention. A matching name alone never resolves an identity. Missing mappings, multiple
mapped entities, name mismatches, organizations, merged or retired entities are skipped
as ambiguous or unresolved, with their file and line listed. Import the network records
first if their identities do not exist yet.

`status` is `new` or `sourcing`; `vehicle` is an existing vehicle slug. `org` may be null.
Capacity requires nonempty `band` and `basis` and a boolean `guess`. `strategic` is boolean.
`route` is null or `{ "best": "description", "score": 60 }`; the score must be finite and
is retained as supplied, never interpreted as consent. `sources` is a nonempty array of
source strings or objects; preserve their provenance. Capacity, fit and route remain
supplied research context, not verified claims. This action does not make an independent
capacity or fit judgment and does not impose $500K as a hard cutoff.

On the live server, open **Developer → Enrich → Add prospects to the pipeline**. All files
and vehicle slugs validate before any pursuit is written. A malformed line prevents the
whole batch from importing. The response shows added, existing, and ambiguous/unresolved
counts. Correct invalid inputs or identity mappings, then rerun.

Each new pursuit belongs to the person running the action and gets a context note:
`Added by rule on Juan's instruction (26 Sep): <reason>; capacity <band> (guess)`
(or `not marked as a guess`). Its note data retains the full input, vehicle and pursuit
IDs, file/line, input SHA-256, and rule identifier. The note and pursuit are written in
one transaction. The unique person–vehicle constraint makes reruns and concurrent clicks
safe: any existing pursuit, including a passed or closed one, and its notes stay unchanged.

These are ordinary pursuits on Pipeline and LP pages. W0 also includes imported New and
Sourcing prospects on nonhistorical vehicles next time it is exported; the previous
research scope for other pursuits stays unchanged. Passed prospects stay out of W0.
The importer writes no ladder event, approval, commitment, network edge or external system.
There is no DB-opening import script. Real imports run only through the live server action;
demo files can be exercised under `data/demo/enrich/prospects/`.

Implementation work envelope: code and invented fixtures in `codex/prospects-import`;
repository reads, edits, demo property checks, typecheck, boundaries and commit only;
no real-data reads/writes or external calls. Acceptance: idempotent additions, existing
pursuits preserved, ambiguous identities listed, normal page/export visibility. Deadline:
this assigned task; budget: bounded implementation and one full validation pass, with
targeted follow-up for failures. Escalation owner: Juan; integration owner: Claude.
