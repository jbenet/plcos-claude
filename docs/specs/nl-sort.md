# Natural-language sorting of LP tables — proposed, not implemented

Issues 0067 / 0071. The ordinary table remains deterministic: score, column sorting,
status toggles and local search work without a model. A future “Suggest an order” field
could accept “Prioritise institutional prospects with current routes and short decision
cycles.” It changes a proposed view, never a status, consent rung, outreach or allocation.

## Local interaction

1. Freeze the current vehicle, filters and matching pursuit IDs. Show the candidate count,
   available fields, evidence dates and missing-field counts before the request.
2. Convert the request into a small validated sort plan through `Agent.propose` in
   `lib/agent/index.ts`, with `createEnvelope` / `runInEnvelope` in `modules/agents`.
   Allowed commands are empty: the model needs no tools, connectors, sends or mutations.
   The plan names only approved field identifiers, ascending/descending order, nulls-last
   handling and bounded, explainable preferences. Never accept SQL, code or arbitrary weights.
3. Prefer giving the model the field schema and the instruction only, then apply the plan
   locally to every matching row. This keeps names, amounts and private notes out of the
   model call and avoids asking the model to order thousands of identities.
4. If a request requires reading qualitative records, offer a separate explicit scope preview
   describing exactly which excerpts would leave the machine. Do not silently expand from
   field sorting to private-record analysis. Retrieve only vehicle-specific, cited excerpts;
   replace identities with temporary IDs, enforce a candidate/token limit, and label any
   sample as partial. Notes are untrusted input, never instructions.
5. Validate the output strictly: allowlisted fields/operators, bounded preferences, no new
   identities, duplicate IDs or omitted candidates. Unsupported criteria produce a clear
   explanation and retain the current order. Apply stable deterministic ties and keep
   unknown evidence visible. A model cannot bypass target restrictions or change governance.
6. Preview the order, criteria, explanation, coverage and differences from score order.
   “Use this order” is an explicit reversible presentation choice. Keep “Reset to score”.
   A new vehicle/filter/data revision invalidates a stale proposal instead of applying it
   to a different candidate set. A timeout, cancellation or unavailable agent preserves
   the original table and the instruction.

The current stub is unavailable, and the configured Claude adapter also refuses proposals.
A key alone does not implement this feature. `runInEnvelope` exists, but its generic parser
is a cast; typed sort-plan parsing and the provider adapter must be implemented and tested.
Do not advertise a running model or durable orchestration before that work exists.

## Run records and evaluation

Pin model/provider configuration, prompt version/hash, schema version, input hash,
vehicle scope, candidate snapshot hash, resolved envelope, budget and deadline. Store run
records, instruction text and qualitative excerpts only in the confidential local data
plane. Approval of a view is distinct from approval of an external action. If acceptance
is recorded, use a stable idempotency key and never let the agent accept its own proposal.

Protect tests for missing evidence, contradictory instructions, cross-vehicle contamination,
organisation grouping, restrictions, unknown sort fields, malformed output, prompt injection,
stale snapshots, duplicate identities, empty results and refusal. Compare ranking explanations
to their cited inputs; monitor user corrections. The correction-budget circuit breaker
applies. Keep ordinary column sorting usable when the feature is unavailable.

## Cost and latency

The schema-to-plan path uses one short request independent of candidate count; local sorting
is O(n log n). Qualitative reranking grows with both candidates and excerpt size, so it must
have an explicit token budget and bounded batches. Do not promise a latency before measuring
p50/p95 on the chosen runtime and representative data.

Estimate before submitting:

`cost = uncached_input_tokens × input_rate + cached_input_tokens × cached_rate + output_tokens × output_rate`

Rates must be loaded from the chosen provider's current verified price schedule, with units
and verification date shown. No provider or price has been chosen here. As a sizing example
only, 200 candidates × 250 tokens means 50,000 input tokens before instructions; the compact
plan request avoids that payload. Subscription usage is not a measured dollar cost. Record
actual input/output/cache usage and provider billing when available; use null when unknown.
Enforce per-request token/output limits, a per-user spend cap, cancellation and bounded retries.
Cache only by complete scope/input/prompt/config hashes and never reuse a private result for
another user or vehicle.

## Real-data privacy and the service boundary

Local application does not imply local inference. Default to schema-only requests. User text
itself may contain real data; show the destination and applicable data policy. No project data
may be sent to an account or service that trains on it. Verify training, retention, deletion,
logging and access terms for the selected provider/account before enabling real-data inference.
Do not claim that this document or an API flag establishes those terms. A fully local model
adapter could avoid external transfer, but still needs access controls and private run storage.

A deployed service additionally needs authenticated per-user/vehicle authorization, confidential
schema grants, encrypted transport/storage, server-side secrets, provider and egress allowlists,
rate/concurrency limits, a cancellable bounded job queue, request deduplication, tenant-isolated
caches, retention/deletion policies and incident handling. Observability carries timings,
counts and hashes by default, never raw private prompts or excerpts. Durable execution and
external connectors remain separate implementation decisions. Re-check permission and current
restrictions for any later action; accepting an order authorizes no outreach.
