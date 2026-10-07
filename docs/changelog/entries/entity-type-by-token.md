# A person that is really a firm can be marked an organisation, in the app or by token · 7 Oct 2026

Issue 0063. A record Affinity types as a person that is really an organisation splits the firm in two, and every
W3 path through it. The local correction already existed (`identity.entity_type_correction`: reversible, kept by
the database against a later Affinity sync, honoured by the exports and W3), and the findings import applied it
on its own when no person evidence held it back. A person could not apply it, though.

- **Developer → Enrichment** lists every pipeline person whose name is an organisation we hold, with the person
  evidence found (a title, an email, an affiliation…), and a "Mark as organisation" button for each.
- **By an Admin's token**: `GET /api/sync/entity-type` returns the same list; `POST` corrects a record (`correct`,
  with a reason and a stable request key) or reverses a correction. `scripts/cloud-entity-type.sh list | org |
  person | reverse` wraps it on the Mac and writes the list to `data/real/entity-types.tsv`, printing only counts.

**Later the same day:** the list also catches a firm whose name differs only in punctuation or a legal form
("Cedar Capital, LLC" and "Cedar Capital"), marked as a loose match. `GET /api/sync/entity-type?id=` (and
`scripts/cloud-entity-type.sh show <id>`) looks up one record by its pipeline or entity id, or their first 8
characters: its type, pipelines, source records, type corrections and same-name organisations.
