## Pursuit duplicates — canonical identity consolidation

Identity merges can leave several pursuits for one canonical person and vehicle. “Import the findings” now consolidates these after team identity repair and entity-type corrections. Developer → Enrichment also has “Consolidate pursuits” and reports **N pursuits merged, M ambiguous**. Corrected organization identities are included.

The survivor has the furthest status in the existing pipeline order (New through Passed), then the latest person status change, then the oldest opening date, then its ID for a deterministic tie. Different person-set statuses are ambiguous and untouched. The merge does not change the survivor's status. Human history and legacy person provenance on any merged member also protect the survivor from prospect rule updates and later Affinity translation.

Losers remain as `merged_into` records. All pursuit foreign keys are discovered from the database catalog and moved: consent evidence, strategy proposals, updates, meetings and additional owners. Colliding consent rungs and strategy hashes retain their separate evidence and decisions, with uniqueness preserved per original pursuit. Plans are combined; source owners, headlines and next steps remain in attributed merge updates. Notes and approval payloads follow the survivor. Moved pending tickets are deferred and all moved tickets expire, requiring fresh approval for a bounded action. Audit rows and pinned historical snapshots remain immutable; status-history readers follow pursuit redirects. Target-wide do-not-contact restrictions still include merged records.

Each decision records `rule:pursuit-merge`, the survivor, losers and exact before/after records. Reversal restores those records atomically and refuses if a moved record has subsequently changed. Later survivor work is retained. Reversed groups are listed for manual review rather than silently merged again on the next pass.

Prospect import now uses the single active pursuit after canonical identity resolution. Conflicting rule dispositions use the latest filename date, then line number (filename breaks remaining ties); undated files sort before dated ones. The selected file, line and input hash are retained in the prospect note or audit history. Person-set statuses are never overridden. The normal action considers every settled JSONL file in the prospects directory together.

An optional `entityId` pins a prospect to an existing active canonical entity. It defaults to a person; `entityType: "org"` explicitly permits an organization. Missing, retired, malformed and wrong-type pins are skipped without creating fallback identities. Identity-conflict messages list candidate database IDs, names and types so a fixer can supply the pin.

### Migration

New **`strategy/009_pursuit_merge.sql`** adds pursuit redirects, an active view and canonical lookup, original-pursuit provenance for consent/proposals, the owner ledger, inherited-human-status lookup with an audit index, and the reversible merge journal. No previously applied migration changes. Confirm the number is still free when integrating.

### Running on live

After integration, the live server's normal migration runner applies the new migration. On **Developer → Enrichment**, run **Import the findings**, or run **Consolidate pursuits** alone for already-corrected identities. Review ambiguous groups, then retry **Add prospects to the pipeline**. All database work uses the live server's existing handle; there is no standalone real-database-opening script.

Expand **Merge details and reversals** to reverse a displayed merge with a reason. For a retained merge ID from an earlier report/audit, the live server also accepts `POST /api/identity/pursuit-merge` with `{"operation":"reverse","mergeId":"<merge UUID>","reason":"Reviewed duplicate identity"}`. `{"operation":"consolidate"}` runs consolidation alone. Reversal may require undoing a newer dependent merge or reviewing later edits first. Reverse pursuit consolidation before undoing the identity merge that caused it.

### Validation

Built and tested exclusively with invented demo fixtures. `npx tsc --noEmit`, `npm run boundaries` and `npm run props` pass: **653 of 653 properties hold**, including 19 consolidation properties and the Affinity inherited-status regression. Coverage includes reference collisions, approval expiry, immutable history, survivor order, person conflicts, idempotence, exact reversal, rollback after a conflicting edit, file precedence and validated pins. Browser screenshot verification could not run because the sandbox refused local server binding (`listen EPERM`); no screenshot is claimed.
