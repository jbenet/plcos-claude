# The mail desk's reads stop scanning whole tables · 7 Oct 2026

JuanMail's queue took 0.5 to 3 s a call even for a small vehicle, and its cost grew with the size of the tables, not the
vehicle. Every read matched an LP with `identity.canonical_entity_id(column) = …`, which Postgres cannot index, so it
called that function on every row of meetings, Gmail messages, research claims, restrictions, asks and affiliations.

A new helper, `identity.alias_ids(ids)` (and `identity.alias_pairs`), lists every alias of a set of canonical ids by
walking `merged_into` down its index. The queue, its `updatedSince` test, the comms trace, touchpoints, contacts and
addresses now ask for `column = any(identity.alias_ids(…))`, or join the Gmail messages by their GIN index, so each
table answers from its own index. The answers are the same; a property checks the helper against
`canonical_entity_id` across aliases, a multi-hop alias, a retired root and a cycle.

Migration: `modules/identity/migrations/008_alias_ids.sql` (new; its number is the integrator's to change at merge).
