# Identity review — evidence-backed duplicate decisions

**27 Sep 2026 · `codex/identity-review` · issue 0105**

| | |
|---|---|
| ![Developer → Enrichment, the page where identity review's results and reversal controls appear](docs/changelog/shots/identity-review/01-enrich-identity-review.webp) | Developer → Enrichment, where the applied/refused counts, refusal reasons and separation-reversal control described below appear once an import has run. |

Export the research set now also writes `enrich/identity-review.jsonl`: one stable hashed
group per ambiguous identity, with names/types, source identifiers, affiliations, titles,
personal URLs, pursuits, reference counts, source resolution rules and refusal reasons.
Existing aliases contribute their context. Contact fields, note bodies, embedded contact
strings and URL query/fragment tokens are excluded. Export previews the duplicate pass
inside a rolled-back savepoint and does not apply its repairs.

Merge duplicate identities reads `enrich/identity-decisions.jsonl` after the deterministic
rules. Evidenced `merge`, `separate` and `retype` decisions use reversible redirects,
pairwise identity assertions and the existing 0063 type-correction journal. Same-source
different-ID merges require explicit evidence for every conflicting pair; Affinity
exceptions record `decision:affinity-duplicate`. Every line is atomic, malformed/invalid
lines are listed, and persisted receipts prevent retries from reapplying an undone decision.
Separation suppresses the exact group and can be reversed. Partial changes refresh the
remaining ambiguity report without applying another automatic repair round.

The existing Enrichment results show applied/refused counts and refusal reasons, plus a
separation reversal control. [W13](docs/workflows/w13-identity-review.md) documents the
formats, evidence standard, public-page query restrictions inherited from W1, and handoff.
No connectors, external writes or migrations were added. Only invented fixtures were used;
no real records were read.

Validation: `npx tsc --noEmit` and `npm run boundaries` passed; `npm run props` passed
**830 of 830 properties** on demo fixtures. The identity-review
suite adds 27 properties covering export privacy/read-only behavior, evidence and same-source
guards, stale membership, atomic rollback, malformed neighbors, conflicting proposals,
separation suppression and merge/type/separation reversibility and idempotency.
