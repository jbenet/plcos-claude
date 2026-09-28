# Dakota provenance inventory for cutover

Rev 3 decision 3 applies to the **restored target only**. The Mac database and raw
replica stay untouched. Names may stay; a retained name does not authorize keeping
its contact details, identifiers, affiliation, financial claims or derived signals.
This inventory comes from tracked migrations and writers, without reading real data.

## Explicit source columns

Unless qualified below, the column is `source`.

| Tables | Columns / interpretation |
|---|---|
| `identity.source_record`, `identity.external_identifier`, `identity.affiliation` | Source-owned rows; affiliation `note` also holds serialized evidence |
| `identity.match_assertion` | `left_source`, `right_source`, `signals`; applied assertions can set `identity.entity.merged_into` |
| `research.source_doc` | `origin`; its `doc_id` is the source key in referencing tables |
| `research.claim`, `research.read_cache`, `research.snapshot`, `research.method` | Claims reference source documents; cache/snapshot payloads can contain entire records |
| `fit.gate`, `fit.dimension`, `fit.value_item`, `fit.perception`, `fit.link`, `scoring.factor`, `coordination.restriction` | Source-document references |
| `fit.firm_profile` | `provenance_note`, `provenance_since` describe relationship provenance, not a source key |
| `platform.source_sync` | Source status |
| `sources.request_log`, `sources.connection_test`, `sources.raw_record`, `sources.sync_run` | Source logs, payloads and run details |
| `network.standing`, `network.portfolio` | Portfolio `source` is JSON, not text |
| `pipeline.exposure`, `pipeline.capital_pool`, `pipeline.commitment_event` | Financial provenance; also inspect `source_ref` and `evidence_ref` where present |
| `strategy.pursuit`, `strategy.pursuit_contact`, `strategy.spv_evidence` | Pursuit also has `status_source`, `source_ref` and copied source/status text; SPV evidence also has `kind` and `claim_id` |
| `signals.signal` | `source`, `source_ref`, `source_key` |
| `meetings.meeting`, `meetings.note_reading`, `meetings.event_tag` | Source-owned meeting / interpretation records |
| `meetings.objection`, `meetings.diligence_question` | `answer_source`: remove the unsupported answer fields, retain the question |
| `plays.need` | Source of the recorded need |
| `standup.external` | Source enum currently permits only Affinity and Linear |
| `linear` replica tables | Source constrained to Linear; link source constrained to `name` / `person` |
| `dakota.account`, `dakota.contact`, `dakota.claim` | Source constrained to Dakota; empty all seven Dakota tables, including jobs and replication metadata |

## JSON, references and derived copies

| Container | Relevant provenance |
|---|---|
| `identity.possible_match.signals`, `identity.entity_type_correction.evidence` | Identity inference and correction evidence |
| `research.note.data` | Source-tagged notes and nested public-profile fields / facts |
| `network.edge.evidence` | Evidence array; retain independently supported evidence on mixed edges |
| `network.portfolio.investments` | Each investment has its own source |
| `strategy.suggestion.data`, `strategy.move.evidence` | Nested proposed facts and supporting evidence |
| `strategy.lp_repoint.evidence`, `.reason`, `.changes`, `.file_decision` | Derived LP decisions and full before/after row copies |
| `strategy.pursuit_merge.changes`, `strategy.pursuit_update.suggested` | Journalled rows can preserve removed source values |
| `platform.audit_log.detail` | Reasons and before/after values; append-only triggers require explicit target-only handling |
| `network.route_cache` | Disposable derived route payloads; clearing these prevents stale evidence surviving |

Source-document deletion must cover `research.claim`, the fit/scoring/restriction
references above and `library.answer_source.doc_id`. Claim deletion must cover
`research.claim.superseded_by`, `strategy.spv_evidence.claim_id`,
`library.answer_source.claim_id`, `content.claim_ref.claim_id` and
`content.refresh_flag.claim_id`. Answers/assets whose only evidence disappears must
not keep their unsupported prose. Mixed prose cannot be separated safely merely by
removing its evidence links.

Pursuit references include `strategy.pursuit.merged_into`, `ladder_event`,
`suggestion`, `pursuit_update`, `pursuit_owner`, `pursuit_contact` and
`meetings.meeting.pursuit_id`. Historical `origin_pursuit_id` and JSON references
are not all foreign keys. Preserve independently sourced children; do not cascade
delete them simply because their parent was originally sourced from Dakota.

For Dakota-only meeting answers, clear `answer`, `answer_source`, `answered_at`
and (on objections) `answered_by`, and return the answer status to `open`.
The current `identity.entity` has no email/title/address columns: only its type,
display name, merge pointer and timestamps. Identifier values live in
`identity.external_identifier`; profile values can live in notes and claims.

## Writer paths and ambiguous derivatives

`lib/connectors/dakota/translate.ts` writes the Dakota schema, affiliations,
employment edges and sourced pursuits. Its call to
`modules/identity/external.ts` writes source records, identifiers, possible matches,
match assertions and merge pointers. `modules/strategy/spv.ts` derives Dakota
co-investment evidence. These paths retain explicit provenance.

`modules/strategy/lp-units.ts` also uses Dakota affiliations and allocator presence.
A re-point can copy a Dakota title into a contact whose source becomes
`rule:lp-unit-repoint`, into a pursuit update, and into its journal and audit reason.
It can create an organisation pursuit carrying the person's non-Dakota source.
Therefore testing only `source = 'dakota'` is insufficient. Check the originating
person/organisation affiliation and the recorded reason before discarding source
records. Entity type correction and identity merge evidence also need inspection
before removing the facts that supported them.

For reversible Dakota-only re-points, `restoreChanges` in
`modules/strategy/merge.ts` compares every current row with the journalled postimage
before restoring the previous state. Process dependent journals newest first.
Later independent edits cause a conflict: fail closed instead of overwriting them.
Similarly, mixed unstructured prose or an unrecognized provenance shape must block
cutover until it can be separated without losing independent information. Report
counts only, never values, names, JSON payloads or database error details.
