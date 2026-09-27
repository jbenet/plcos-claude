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
2. **Translate** (to build): the raw replica maps into our database, so re-mapping never asks Dakota
   again: accounts to organisations, contacts to people, contact → account to an employment tie, with
   provenance `source: dakota, as_of: lastmodifieddate`. Identity follows the usual rules: a website
   domain, a LinkedIn URL, a CRD or SEC CIK corroborates a match; a name alone is a possible match.
3. **Use**: enrichment claims on matched LPs (type, AUM, ticket size, interests, location) with
   provenance and tier-C confidence as a claim, not evidence; and a sourcing pass that proposes new
   candidates by rule (fit to a vehicle's thesis, a ticket size of $500K or more, or strategic use), as
   New prospects through the usual prospects import.
