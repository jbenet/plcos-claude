# The fact check runs in the cloud, and Mac runs are recorded there · 5 Oct 2026

The first workflow the Railway app runs itself (docs/28-cloud-workflows.md): W1c, the fact check, graded on the
server under W1c's own rules. It is off until an Admin turns on **Settings → Connections → Cloud workflows**; then
Developer → Enrichment shows **Fact check in the cloud**, which takes a batch file and a review file name
(`fact-review-07a.jsonl`, by round and part) and queues an import job.

**What it reads.** Only the pages the findings cite, each once, fetched by the server rather than by the model: a
generic User-Agent, SEC at one request a second with the privacy contact address, LinkedIn never, brokers never, a
refusing site tried once more at the end, and no address on the server's own network. The model gets the page text and
no tools, so "only the cited pages" holds by construction.

**What it writes.** A new `enrich/fact-review-<NN><part>.jsonl`, never over one, which the fact-quality counts read
as they read the Mac's. A fact whose page wasn't read is graded unavailable whatever the model said; a "supported" fact
whose quote is not on its page word for word becomes "partly"; counts are recomputed and every row passes the push's
validator.

**Corrections, when ticked** (6 Oct). A second call proposes the corrected finding from the same pages; the server
refuses one that changes the identity, name or capacity band, reaches past the cited pages, drops a supported fact or
fails the validator, dates the correction itself, and keeps the original under `enrich/inbox/<run>/replaced/`.

**The first-cut buttons** (Run W1 / W1c / W5) now need Cloud workflows on too (docs/28 §8).

**What it records.** A work envelope (its only evidence the cited pages, its only commands reading a cited page and
calling the model, a token budget and a deadline; a frozen circuit breaker refuses it), every page read and model call
as a tool call, a ledger run with the rules and inputs pinned by hash and measured token usage, and an audit row of
counts.

**The ledger after the move.** `POST /api/sync/runs` and `scripts/cloud-run.sh begin|finish` record a run made on the
Mac in the server's ledger with a push token, by the same writer and rules as `scripts/workflow-run.ts`. Only the person
who began a run finishes it.

**Cleanups.** lp-units `gather` runs its queries one after another (pg deprecates a second query on a busy client);
the MCP tool-name rule names connector systems instead of banning the word "connector", which is a person on a route.

Tested on invented findings and pages with the model stubbed (`scripts/properties/cloud-w1c.ts`,
`scripts/properties/sync-runs.ts`). No real page or API call has been made. Screenshots of the new setting row and form
are owed: this was built in a cloud session, and the integrator takes them at merge.
