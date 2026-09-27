# W3 — Connect LP units

Deterministic local file join: `scripts/enrich-connect.ts`, using `lib/enrich/connect.ts`.
Read `docs/agent-rules/real-data.md`, `docs/23-lp-units.md` and this protocol.

Inputs are a frozen research export (`candidates.jsonl`), public findings in `raw/`,
`us/network.json`, `us/team.json`, `us/pl-directory.jsonl`, and the optional complete,
hash-checked `warehouse/` graph. No web requests or database access occur in W3.

An organisation LP exports `contacts`: pursuit contacts and people whose current primary
work affiliation says they speak for the firm. Board, adviser and investor affiliations
alone do not qualify. Each nested contact keeps its entity key and `contactRole`; the
private candidates file also carries its own records and restrictions. The public
`research-set.jsonl` includes only the corresponding research identities.

W3 joins each contact once, even when that person also has an individual LP row. It keeps
the original person paths for the graph and projects them onto the organisation with
`viaContact: {key, name, role}` and a “via <role> (<name>)” basis. Projection never changes
the tier, warmth or warehouse hops. Contact-only endpoints do not enter the LP denominator;
a firm and a person investing personally are two distinct LP units, each counted once.
The graph importer ignores projected rows when building edges: membership is not a new
relationship. Runtime routes resolve current contacts, retaining both firm and contact
restrictions.

## Live rerun (Claude, after integration)

1. On the live app, Developer → Enrich → **Export the research set**. An old export lacks
   contact records, so running only W3 will not recover their paths.
2. Freeze that export and the named inputs. Record the authorized W3 run in the workflow
   ledger using `docs/COLLAB.md` (protocol hash includes this file and the implementation).
3. From `plcos-claude-live`, run:

   ```sh
   DATA_PROFILE=real npx tsx scripts/enrich-connect.ts
   ```

4. Inspect the printed LP coverage counts and diagnostics. If updating saved W9 triage,
   rerun `DATA_PROFILE=real npx tsx scripts/enrich-triage.ts` against the same frozen inputs.
5. Use the live app's **Import the findings**, then record completion in the ledger.
   Only the live server imports into the real database. Check routes, Selection, triage
   and the LP stats path panel. No prior coverage total is promised: eligibility and
   current evidence determine it.
