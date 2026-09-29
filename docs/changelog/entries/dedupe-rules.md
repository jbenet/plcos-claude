## Deterministic duplicate rules

The import identity phase and **Merge duplicate identities** now accept the same normalized
person name plus a non-free-mail email domain, a personal URL/domain, or a shared current
affiliation. This includes corroborated records from multiple established sources. Every
redirect records its specific rule and supporting signals; source records remain intact.

Different external IDs from Affinity, warehouse, Dakota or network_finding produce audited
`different_external_id` separations, including IDs held by aliases. A recorded difference or
reversed merge constrains the entire proposed component. Distinct-source conflicts and
ambiguous chains never select an arbitrary winner. Fully separated groups leave review;
partly resolved groups contain only their remaining canonical members.

A person's full name with a family-office, foundation or holding suffix keeps the person
and organization distinct and adds an inferred affiliation, without claiming ownership or
authority. Same-name mixed records with that suffix also stay distinct. Multiple same-name
people do not get an inferred affiliation chosen for them. Current-role rules ignore ended,
future and prior roles and use the latest version of each raw source record.

Invented queue fixture, mixed sources and group sizes 2–6: email-domain rule **1 merge**,
personal-URL rule **2 merges**, current-affiliation rule **3 merges**, external-ID rule
**1 separation**, own-named-organization rule **1 separation and affiliation**. Free-mail
and former-role groups stay ambiguous; a three-member constrained bridge stays separate.
A separate same-name foundation property exercises another separation/affiliation.
Exact same-source ID equality creates **0 duplicate redirects**: the existing
`source_record(source, source_id)` primary key already enforces one owner, tested with a
repeated key. Counts describe invented fixtures, not measured real-queue reduction.

The W13 protocol and existing properties now reflect the requested hard different-ID rule:
legacy duplicate attestations cannot override a recorded separation. No schema changes,
external calls or real-data reads. Postgres verification remains an integration gate.

Validation: `npx tsc --noEmit`, `npm run boundaries`, and `npm run props`
(**1,333/1,333** on PGlite) pass. The focused invented queue's 14 checks also pass.
