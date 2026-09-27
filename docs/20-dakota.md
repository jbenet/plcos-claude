# 20 — Dakota Marketplace, read-only

Decided with Juan, 27 Sep 2026. Dakota Marketplace is a database of institutional and private
allocators (pensions, endowments, foundations, family offices, RIAs) and their people. We use it for
two things: to enrich LPs already in our pipeline, and to source new candidate LPs. The rules are in
`docs/agent-rules/real-data.md`; the short form is read-only, in bulk, few queries, workflows only, and
the data stays in `plcos-data/real/dakota/` and our database.

## Access

- The API is public-documented at docs.dakota.com (Mintlify; `llms.txt` indexes it). Sign-in is a
  password grant (`POST …/api/oauth2`), a token for an hour and a refresh token for five; every read is
  `POST …/api/dakota` with a `module`, `filters` (`fields`, `filter`, `order_by`, `max_num`, `offset`) or
  `count_only`. Pages of 20–50 are recommended. No rate limit is documented; we send one request a
  second (a GUESS at polite) and stop on 429 or a run of 5xx.
- The same endpoint can create, update and delete. `lib/connectors/dakota/client.ts` only builds list and
  count bodies, checks every module, field and operator name, and has no other method.
- Our plan reads `account` (5,100 records on 27 Sep) and `contact` (9,253). `investment` and
  `investment_strategy` answer 403.
- The sign-in lives in two Keychain items (`npm run dakota:store`); `scripts/with-dakota-key.sh` hands
  them to one process's environment.

## Syncing: the same split as Affinity

1. **Pull** (`scripts/dakota-sync.ts pull`): pages into `plcos-data/real/dakota/raw/<module>/<stamp>.jsonl`,
   with a manifest and a ledger run. The first pull (27 Sep, 312 requests) took every documented field
   Dakota would serve (180 of 182 on accounts; two relationship fields answer 500). From then on a pull
   asks only for the fields in `fields.json` "needed" and only for records changed since the last
   complete pull.
2. **Translate** (`lib/connectors/dakota/translate.ts`, Developer → Enrichment → Import Dakota): the raw replica maps into our database, so re-mapping never asks Dakota
   again: accounts to organisations, contacts to people, contact → account to an employment tie, with
   provenance `source: dakota, as_of: lastmodifieddate`. Identity follows the usual rules: a website
   domain, a LinkedIn URL, a CRD or SEC CIK corroborates a match; a name alone is a possible match.
3. **Use**: enrichment claims on matched LPs (type, AUM, ticket size, interests, location) with
   provenance and tier-C confidence as a claim, not evidence; and a sourcing pass that proposes new
   candidates by rule (fit to a vehicle's thesis, a ticket size of $500K or more, or strategic use), as
   New prospects through the usual prospects import.


## Translation and use

The button uses the live server's existing database handle; there is no database-opening import
CLI. It reads complete manifests and replays their incremental batches in chronological order
through the newest complete batch for each module. A database checkpoint pins each input hash.
A changed completed file is refused, an older record cannot replace a newer one, omitted fields
preserve prior values, and an explicit null clears a field. A failed transaction writes nothing.

`dakota.account` and `dakota.contact` contain only the `needed` fields plus mapping/provenance
metadata and the derived likely-contact marker. The public account needed list contains no name:
account labels use a contact's allowed `account_name__c`, then website, then the source account ID.
No unrequested raw name or blob is retained. ID aliases `account_id` / `contact_id` and `id` are
accepted, as is the `accountid` contact link. Dates come from `lastmodifieddate`; a record without
that date is refused. Numeric ticket values are treated as USD; explicit K/M/B suffixes are also
accepted, and ambiguous prose or ranges are not treated as amounts.

`dakota.claim` is separate from exported public research. LP pages project these source-owned
claims through canonical identity and label them as vendor claims, not evidence. Ticket sizes
supply a capacity estimate fallback after existing planning estimates; recorded soft amounts and
hard commitments keep their existing meanings. A contact's employer ticket estimate is labelled
as the account's ticket, not personal wealth.

Sourcing uses `config.dakota`: vehicle thesis terms, flag matches, a $500K minimum on the average,
lower check bound or PE/VC average ticket, or the explicit fund-allocator-with-flag exception.
Ranking weights and the 150-per-vehicle cap are GUESSES. A high upper bound alone never qualifies.
Existing pursuits, restrictions and unresolved namesakes of pursued/restricted entities are
excluded. The cap includes earlier Dakota pursuits so repeated clicks cannot add another 150.
New candidates may match multiple vehicles in the same pass; no status, consent, approval or
capital amount on an existing pursuit changes.

File exporters exclude Dakota-derived identities/affiliations. Real file feedback, connection
feedback and screenshot intake are refused while Dakota is present, before screenshots are
captured or drafts persisted. Real feedback uses in-memory text only, without image capture,
attachments or browser drafts, even before the first import; this prevents a stale open drawer
from capturing later-imported records. A future database-only feedback path can remove this restriction.
Preview copying skips the raw Dakota directory before traversal. Agents must still never inspect
a database projection containing Dakota records. Only invented fixtures are used for checks.

The public documentation URLs could not be reached from the coding sandbox during implementation;
the checked-in public `fields.json` was the field contract. Claude should verify amount units and
response field coverage on the live server without exposing records to an agent.
