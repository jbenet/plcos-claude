# W13 — Review ambiguous identities

Version 1. Identity only: decide whether exported records describe the same person or organization,
different namesakes, or a person/organization type error. Do not change pipeline status, consent,
capital, routes, contact permissions or source systems. A missing match is unresolved, not proof of
different identities.

## Read set and authorization

Read this protocol, AGENTS.md, `docs/agent-rules/real-data.md`, W1's **Firm rules** in
`docs/workflows/w1-profile.md`, and the workflow-run recording section of `docs/COLLAB.md`.
Use only the assigned rows of `enrich/identity-review.jsonl`, matching existing findings in
`enrich/raw/`, and public pages. The launcher supplies the authorized profile root, batch,
work envelope, run ID, input/protocol hashes, budget and deadline. Freeze them during the pass.
Do not open the database, raw connector replicas, other batches or contact exports.

Real inputs and outputs stay under the authorized shared real root, never in git, screenshots,
issues, remote sub-agent prompts or a final reply. Build/evaluate this protocol with invented
demo fixtures. No external writes, sign-ins, paid services, contact brokers, forms or posts.
Decisions are local proposals; a human runs **Merge duplicate identities** to apply them.

## Export format

**Export the research set** also writes `enrich/identity-review.jsonl`, including ambiguous
identities outside the current LP research statuses. One JSON object per group:

```text
{
  group: SHA256(JSON.stringify(sorted unique canonical member UUIDs)),
  name: normalized name, type: person | org | mixed,
  members: [{
    entityId, displayName, entityType,
    sources: [{source, externalId}], affiliations: [{org, role}],
    titles: [], personalUrls: [], pursuits: [{vehicle, status}],
    counts: {claims, paths, notes}, createdBy: []
  }],
  reasons: []
}
```

The source records, affiliations and counts include existing aliases of each canonical member.
`createdBy` contains the source resolution rules on file, not an inferred author. Counts describe
available records, not evidence strength. Empty fields mean unavailable in this export.
The export contains URL locators, never email/phone fields or note bodies; embedded contact
strings are redacted and URL query/fragment tokens removed. Connector IDs remain identifiers.
An export previews the deterministic pass and rolls back its writes: it does not merge identities.

## Research steps and query rules

1. Compare every member's source IDs, type, affiliations, role chronology and personal URLs.
   Read the pass's refusal reasons before deciding. Shared names, firms or titles alone cannot
   establish identity. Different roles or employers at different dates need not be a conflict.
2. Read the matching findings and their sources. Prefer a person's own biography, an official
   organization/team page or an explicit link between two profiles. Check that a LinkedIn URL
   is personal, not the organization's page. An organization and its founder remain distinct.
3. Search public pages only where needed. Apply W1's query rules: a query carries only name,
   organization, title, location and public topic words. Never carry group/entity/source IDs,
   pipeline membership, vehicle/status, private notes, amounts, contact information or our
   identity into a query. Pursuits and counts are local context only. Do not export a batch to
   any outside service. Dakota's private/aggregated fields never enter queries.
4. Requests carry no identity of ours in headers, including User-Agent. Where the service
   requires a contact address, follow W1's privacy-preserving address rule. Government pages
   are read sparingly: SEC at most one request per second, no bursts or loops over names;
   stop on 403/429/503 and return later. No retries in a burst. Do not collect health details.
5. Record the inspected corpus, dates and what each source actually establishes. Use exact
   excerpts for public pages; label a local comparison as the reviewer's own assertion, with
   the local finding/record reference. Do not invent a quotation or imply that a public page
   mentions private connector IDs. If insufficient, leave the group unresolved and record the
   gap in the private run report. Do not use `separate` as a synonym for uncertain.
6. Write one proposal per group to the assigned decision file. A subset merge is allowed when
   only that subset is proved identical. Retype explicit members first; export again before
   proposing their merge. Keep inputs fixed during a batch; remove settled proposals before
   writing a different decision for the same group.

## Decision format

`enrich/identity-decisions.jsonl` accepts one object per line:

```text
{
  group: exported SHA-256,
  decision: "merge" | "separate" | "retype",
  survivor?: canonical member UUID,
  members?: [canonical member UUIDs],
  newType?: "person" | "org",
  evidence: [{source: URL or local record/finding reference, as_of: "YYYY-MM-DD", quote: text}],
  decided_by: reviewer identifier
}
```

- `merge`: `members` defaults to the entire group; minimum two. `survivor` must be among the
  selected members, or defaults to the lexically first UUID. Same effective type is required.
- `separate`: means every member is distinct. Omit `members` or include the complete group.
  Writes pairwise `not_same_as` assertions and suppresses exactly this group's member set.
  Adding a new member requires another review.
- `retype`: requires explicit `members` and `newType`; no survivor. Uses the 0063 correction
  journal and preserves sources. An active correction must be reversed before replacement.
- Every decision needs nonempty `decided_by` and at least one evidence item with nonempty
  source/quote and a valid calendar date. Malformed JSON and invalid decisions are listed by
  physical line number; neighboring valid decisions can apply. Each line applies atomically.
- Unknown/stale groups, retired/noncanonical members, outsiders, account identities, mixed-type
  merges and conflicting proposals for one group are refused. Existing active separations or
  reversed merges cannot be overridden by a merge proposal.

### Same-source different-ID exception

For every pair of different external IDs from each source across the complete selected
components (aliases included), provide supporting identity evidence and an explicit local
comparison assertion. The `quote` must include this exact standalone line, substituting the
actual source and exported IDs:

```text
Same real person: affinity:person:101 = affinity:person:202
```

For organizations use `Same real organization:`. Either pair order is accepted. For three
IDs, attest all three pairs, and repeat for any other conflicting source. For example, the
invented proposal's evidence can contain a public bio excerpt and a second item referencing
the local comparison, whose quote contains the marker. A marker alone is refused: include
the supporting excerpt/comparison context too. The marker is a reviewer assertion, never a
fabricated quotation from the public page. It attests that the two **external records** are
duplicates, not merely that two exported names resemble each other.

Code checks the presence of this evidence and assertion; it cannot independently verify the
researcher's conclusion. Record how both source records were connected to the cited identity.
An Affinity exception stores rule `decision:affinity-duplicate`; source records stay intact.

## Application, reversal and acceptance checks

The human's **Merge duplicate identities** action runs deterministic rules first, then the
local decision file, then existing pursuit consolidation. The Enrichment page reports
“N decisions applied, M refused” and line-specific reasons. It shows merge, correction and
separation IDs. Exact retries use persisted decision receipts and do not duplicate mutations,
even after an operator reverses a decision. Do not erase receipts to force reapplication.

Reverse related pursuit consolidations before reversing a merge with the existing identity
undo. Reverse subsequent merges before using the existing type-correction reversal. **Reverse
separation** reopens the entire group's assertions for review. Export afresh after any reversal;
the original proposal remains consumed. Nothing moves/deletes original source facts.

Before finishing, check every proposed member against the frozen group, all same-source pairs,
the evidence dates and citations, person versus organization distinction, and contact exclusion.
Run the protected invented cases via `npm run props` for protocol/code changes; never change a
pass criterion or permission merely to make a proposal succeed. Finish the run ledger with
selected/proposed/unresolved counts and actual checks. The public handoff contains counts only.
