# Person duplicates and organisation LP groups · issue 0105

The duplicate-identity pass considered only groups containing an organisation. A newly sourced
prospect key could therefore create a second person beside an existing upstream identity, and
**Merge duplicate identities** would leave the two people alone. Separately, Selection and Fit
rendered flat pursuit lists. Pipeline grouped some organisation LPs, but missed two people at the
same organisation when neither had an institutional investor type or an organisation pursuit.
These patterns were reproduced with invented demo fixtures; no real records were inspected.

The import duplicate pass now includes people. An import-created person needs the same normalized
name and a shared organisation affiliation/name or personal locator. Evidence comes from stored
prospect/profile notes, affiliations, source snapshots, typed LinkedIn identifiers, and the current
findings or W3 person descriptors. An established source identity survives. Names alone, shared
articles, and firm homepages do not authorize a merge. Competing established matches, different
external IDs from the same source (including aliases), prior separation decisions, and reversed
merges remain ambiguous and are listed. Personal URL query parameters remain significant.

Each merge keeps original source references and records its corroboration in a reversible identity
assertion. The existing pursuit consolidation follows it, retaining its human-status conflict and
reversal guards. Retry and prospect reimport are idempotent. No migration or external write is added.

Selection, Fit and Pipeline share a read-only row projection by canonical organisation ID and vehicle.
An organisation appears once with people beneath it, including when two people have pursuits and the
organisation has none. The heading creates no pursuit and moves no status, evidence or money. Each
person retains their score, status, gates and actions. Sorting and pagination keep groups together;
filtering retains organisation context. Fit groups with a failing gate keep that gate visible, and
Pipeline summaries do not blend soft and hard amounts. Renderer wiring uses the existing styles;
no stylesheet or page design was changed.

After Claude integrates this branch, open **Developer → Enrichment** (`/dev/enrich`) on the live
server and click **Merge duplicate identities**. **Import the findings** also runs the pass. Review
ambiguous identities and pursuit conflicts, then reload Selection/Fit/Pipeline. To undo, reverse the
related pursuit merges first, then **Reverse identity merge** in the duplicate details. Original
records remain attached to their original IDs, and automatic retries respect the reversal.

Validation: `npx tsc --noEmit`, `npm run boundaries`, and `npm run props`.
The suite passes **768/768 properties**, including **28 new issue-0105 properties** covering the
person-merge patterns, guards, source evidence, pursuit consolidation, reversal, retries, organisation
grouping, vehicle isolation, filtering, and preservation of child readings and actions.
