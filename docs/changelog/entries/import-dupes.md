# Import duplicate identities

Imports could leave one organization represented by several organization nodes and an older,
incorrectly person-typed node. Those source keys then produced conflicting prospect candidates.
The identity phase of **Import the findings** now runs a deterministic duplicate pass after
0063's type corrections and before pursuit consolidation. **Merge duplicate identities** on
Developer → Enrichment runs the same repair independently, using the server's existing DB handle.

Only exact normalized organization names qualify. Every member of each redirect component must
have import provenance. The pass checks external source IDs independently of resolution rules:
two distinct Affinity IDs, Dakota IDs, or IDs from any other external source remain ambiguous.
Unknown provenance, prior identity separations, reversed merges, and local type decisions also
withhold the whole group. Internal prospect, W3 and investing-organization keys remain provenance.

A person-typed namesake is corrected using the existing recorded type-correction mechanism only
when available sources contain no person evidence. Historical email, role/title, personal LinkedIn,
explicit personal or biography pages, person affiliations (including sourced employment edges),
and user accounts block correction and merging. The earlier type pass now uses these same checks,
including superseded claims, so it cannot conceal that evidence before duplicate detection.

The survivor has the most references across active pursuits, claims and stored path participation,
then the earliest creation time, then the lexically first ID. Identity assertions and redirects
preserve original source and fact FKs. Claims, sources, paths and strategies follow canonical IDs;
stored path endpoints are projected when read so undo retains their original identities. The
import resolves its write keys again after merging. Pursuit consolidation retains its existing
human-status conflict safeguards and journals moved references; unresolved pursuit conflicts stay
listed rather than overwriting a person's decision.

The page reports “N duplicate identities merged, M ambiguous”; N counts redirected identities,
M counts withheld name groups. Ambiguous candidates are linked. Reports, merge assertion IDs and
type-correction IDs are retained in source-run details.

## Run on live after integration

1. Open **Developer → Enrichment** on the live server and click **Merge duplicate identities**.
   Alternatively, **Import the findings** includes this pass automatically.
2. Review ambiguous groups and any pursuit conflicts. Retry **Add prospects** once their identity
   group has merged and its pursuits have consolidated.
3. To undo, reverse related pursuit merges in the page first, then use **Reverse identity merge**
   under duplicate details. Reverse a type correction only after its identity redirects are undone:
   POST `/api/identity/entity-type` with
   `{ "operation": "reverse", "correctionId": "<recorded UUID>", "reason": "<reason>" }`.
   Reversals remain recorded and automatic passes respect them. Pursuit reversal refuses to
   overwrite later edits. Earlier reports remain available in `sources.sync_run.detail`.

No DB-opening CLI, connector request, or external write is added. Standalone real-data actions
refuse dev worktrees and preview copies. **Migrations: none.** Applied migrations are unchanged.

Validation uses invented demo fixtures only: `npx tsc --noEmit` and `npm run boundaries` pass;
`npm run props` reports **689 of 689 properties hold**, including **24 duplicate-repair properties**.
The regression cases cover ranking, full reversal, idempotence, prospect retry, import ordering,
canonical writes and paths, evidence blockers, external-ID conflicts across aliases, and prior
separation decisions. Live records and real data folders were not read. Browser screenshot QA was
blocked by the sandbox's `listen EPERM` restriction; the UI received a code review.
