# Adding researched prospects

Juan's instruction of 26 Sep 2026 authorizes adding good LP fits with useful check sizes
(ideally $500K or more) or strategic value for the vehicle. This is a pipeline plan,
not investor interest, consent, a commitment or permission to contact anyone.

Place JSONL files in `plcos-data/real/enrich/prospects/`. The live checkout reads these
through `data/real/enrich/prospects/`. Each line describes one person–vehicle pair:

```json
{"personKey":"warehouse:invented-person","name":"Example Person","org":"Example Organization","vehicle":"neurotech","status":"sourcing","capacity":{"band":"$500K–1M","basis":"Invented fixture: estimated investment capacity","guess":true},"reason":"Their investment interests fit this vehicle.","strategic":false,"route":null,"sources":["Invented fixture only"]}
```

`personKey` may be the person's existing entity UUID, an exact stored source ID in
the `warehouse` or `w3_person` namespace, or a stable key assigned by the prospect research.
The example key is illustrative, not a naming convention. Existing keys take precedence.
Without a mapped key, one exact normalized person-name match is reused; multiple matches
are skipped. Zero matches creates a person: a sourced prospect row is enough evidence
for a network node (rule 6, clarified 26 Sep). A source record in the `prospect` namespace
uses `personKey`, independent of vehicle, filename, line order, status or reason, so reruns
reuse the entity. Keep that key stable across research revisions and vehicles.

New people get a claimed organization affiliation when `org` is present: contact, role
not recorded, no decision-making capacity asserted. One matching current organization is
reused; otherwise a separate sourced organization is created, with a stable `prospect_org`
mapping. An affiliation does not assert a warm personal tie. Conflicting key mappings,
name mismatches, wrong entity types and inactive identities still require correction and
are listed with their file and line; missing identities alone no longer block import.

`status` is `new`, `sourcing` or `passed`; `vehicle` is an existing vehicle slug (an Admin adds a vehicle in
Settings → Vehicles). `org` may be null.
Capacity requires nonempty `band` and `basis` and a boolean `guess`. `strategic` is boolean.
`route` is null or `{ "best": "description", "score": 60 }`; the score must be finite and
is retained as supplied, never interpreted as consent. `sources` is a nonempty array of
source strings or objects; preserve their provenance. Capacity, fit and route remain
supplied research context, not verified claims. This action does not make an independent
capacity or fit judgment and does not impose $500K as a hard cutoff.

Before handing a file over, check it with the importer's own rules:
`DATA_PROFILE=real npx tsx scripts/prospects-check.ts <file.jsonl>`. It prints line numbers and reasons, never
row contents. It also checks each `vehicle` against the slugs this Mac knows: the last research export
(`enrich/vehicles.json`) and the init file. No database is opened. A vehicle just added on the cloud server
(Settings → Vehicles) is not on the Mac yet. Add `--vehicle <slug>` (repeatable) to treat that slug as known;
the run says it did.

From the Mac, push the file to the cloud server: `bash scripts/cloud-push.sh prospects <file.jsonl>`
(docs/deploy/railway.md §7a). The server checks every line and every vehicle slug again, against its own
vehicles. A Team member may push rows only for vehicles they can change. One bad line refuses the whole push,
by line number, and nothing is written. Accepted, the file is written to `enrich/prospects/` under a new
name (`<date>-push-<run>-<name>.jsonl`, never over an existing file). The server then runs Add prospects as
the token's owner, so the new pursuits are theirs, exactly as if they had clicked the button. The script
prints the added, existing and ambiguous counts; `cloud-push.sh status <job id>` asks again later.

The importer reads only files unchanged for two minutes, because someone may still be writing a file placed
by hand. A pushed file is written whole before the import is queued, and the job names it, so it is read at
once. Every other file in the folder still waits.

On the live server, open **Developer → Enrich → Add prospects to the pipeline**. All files
and vehicle slugs validate before any pursuit is written. A malformed line prevents the
whole batch from importing. The response shows added, existing, and ambiguous/conflicting
counts. Correct invalid inputs or identity mappings, then rerun.

Each new pursuit belongs to the person running the action and gets a context note:
`Added by rule on Juan's instruction (26 Sep): <reason>; capacity <band> (guess)`
(or `not marked as a guess`). Its note data retains the full input, vehicle and pursuit
IDs, file/line, input SHA-256, and rule identifier. The note and pursuit are written in
one transaction with any new identity and affiliation. Identity lookup and creation are
serialized within the database transaction. The unique person–vehicle constraint makes reruns and concurrent clicks
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
