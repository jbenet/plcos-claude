# Cloud workflows: the research workflows run by the Railway app

5 Oct 2026. Design, and the record of the first slice. AGENTS.md ("Agent rules"), docs/agent-rules/real-data.md
and each workflow's own protocol under docs/workflows/ still apply; nothing here relaxes them.

## 1. Why, and where it stood

Until the move, W1 (profiles), W1c (fact checks), W5 (strategies) and prospect sourcing ran as agents on the
Mac, which read `plcos-data/real/enrich/` and wrote back there, and the live server imported the files. Since
5 Oct the cloud is the only writer, the Mac's database is frozen, and research reaches the cloud through
`POST /api/sync/push` (docs/deploy/railway.md §7). The Mac is not always on, so the cloud should be able to
run the workflows itself.

The app already had a first cut, `lib/workflows/api.ts` (Developer → Enrichment, "Run W1 / W1c / W5"): an
import job that sends a batch and its findings to the Messages API with Anthropic's web search and fetch
tools, validates the files that come back, and records a ledger run. It works, but it falls short of the
rules in four places:

- **W1c gets web search.** W1c's rules allow only the cited URLs: "no search, no other page". The model also
  chooses what to fetch, so "only cited pages" is an instruction, not a property.
- **No envelope.** No work envelope, no per-call policy check, no circuit breaker (AGENTS.md, "Agent rules").
- **No off switch.** The buttons turn on whenever an Anthropic key is present.
- **Grades and corrections in one pass.** W1c's protocol corrects findings only when the launch asks for it.

## 2. Principles

1. **The server reads, the model judges.** Wherever a workflow's rules limit what may be read, the server
   does the reading under those limits and hands the model the text. The model gets a tool only where the
   workflow needs open-ended search (W1, sourcing), and then only tools the server implements and checks.
2. **One envelope per run.** `modules/agents` `createEnvelope`: the evidence a run may use, the commands it
   may call, its budget and deadline. A frozen circuit breaker refuses it. Every page read and model call is
   checked against the envelope and recorded as an `agents.tool_call`; a refusal is recorded too.
3. **Pinned before it runs.** The ledger run (`lib/workflows/ledger.ts`) is begun before the first request,
   with the protocol hash (the rules and prompt as sent), and the batch hash (the batch and the findings as
   read). `agents.run` carries the config hash and snapshot.
4. **The same gates as a push.** Output passes the validators the push and the import use
   (`lib/enrich/fact-review.ts`, `lib/enrich/schema.ts` `check`, `lib/enrich/strategy.ts`), then lands where
   the workflow writes. A file is never written over: a review file is new, by round and part.
5. **Off by default.** Settings → Connections → "Cloud workflows" (`workflows.cloud`, env
   `PLCOS_CLOUD_WORKFLOWS`) must say `on`, and the Anthropic key must be set. A preview copy is always off.
6. **Zero retention, no training.** A cloud run sends findings and page text to Anthropic. The key must
   come from a workspace with zero data retention and training off (approved for drafting context on 4 Oct).
   The app cannot check that, so turning the setting on is the vouching, and its help text says so.
7. **Counts out, never content.** Audit rows, the job receipt and the ledger carry counts, hashes and hosts.
   A tool call records the host of a page, not its address, which can carry a name.
8. **A run is a proposal.** A cloud run's output is graded research, not an accepted change: it reaches LPs
   only through the normal import, and acceptance stays a person's act.

## 3. The runner

An import job of kind `workflow` (lib/import-jobs), as today: started by an Admin from Developer →
Enrichment, run in the import worker, its progress and receipt on the same page. `input.protocol` picks
the runner; `w1c-cloud` is the first one built on the principles above. A refusal before any work
(`lib/workflows/refusal.ts`) is shown to the person as written; any other failure shows the generic import
receipt, so no record text reaches the page.

Bounds live in `config.cloudWorkflows` and are copied into each run's envelope. Every number there is a
labelled guess until real runs measure it.

## 4. Slice 1, built: W1c in the cloud

`lib/workflows/cloud-w1c.ts`, `lib/workflows/cited-pages.ts`; properties in `scripts/properties/cloud-w1c.ts`.

**Launch.** Developer → Enrichment shows "Fact check in the cloud" when the setting is on and the key set:
a batch file under `enrich/batches/` (keys, as the Mac's batches) and the review file's name,
`fact-review-<NN><part>.jsonl`. At most 25 findings a run.

**Refuses before any work** when the setting is off, there is no key, the review name is wrong or already
taken, the batch is outside `enrich/batches/`, a finding it names is not on the server, or the batch is
over the limit. Nothing is recorded or sent.

**Reading.** Every URL the findings cite, once each, by the server:
- a generic User-Agent and no identifying header; SEC gets the privacy contact address the rules name, at
  one request a second; other hosts at least half a second apart;
- LinkedIn is never fetched and a broker is never read; a 402, sign-in wall or checkpoint is `unavailable`;
- a 403, 429 or 503 stops that host for the pass, and it is tried once more at the end;
- only public addresses: loopback, private, link-local (cloud metadata) and similar are refused on every
  redirect hop, so a cited URL cannot make the server read its own network. DNS is checked before the
  request, so a host that changes its answer between the check and the request is not covered (a known gap,
  small for a read-only GET with no credentials);
- the page's own text, with scripts and styles dropped and image alt text, image file names and link targets
  kept, as W1c's rules ask for a page drawn by script.

**Grading.** One Messages API call a finding, with no tools: the system prompt is W1c's grading section and
W1's standard for a fact; the user message is the finding's facts and the text of their pages. Then the
server holds the answer to the rules:
- a fact whose page was not read is `unavailable`, with the reason, whatever the model said;
- a `supported` fact whose quote is not on its page as a normalised substring is `partly` (the mechanical
  quote check W1 asks for; SEC filings skipped, as the rules say);
- counts are recomputed from the grades; the row must pass `factReviewProblems` against the server's finding;
- an answer that is not JSON, is cut off or fails the validator counts as failed for that finding. No retry.

**Writing.** The rows that passed, as a new `enrich/fact-review-<NN><part>.jsonl` (hard-link write: it
fails rather than replace a file). The enrichment page's fact-quality counts read it by round, as they read
the Mac's. Findings are not corrected: that is slice 2.

**Recording.** Ledger run `W1c / cloud`, source `app`, model, measured token usage, counts, checks and an
outcome: `succeeded`, `partial` (a budget or deadline reached, or some findings failed) or `failed`.
`agents.run` (kind `cloud-w1c`, status `proposed` when anything was graded) with its tool calls, and one
`workflow.cloud_run` audit row with counts.

**Model and cost.** `claude-haiku-4-5`, the fact-checker agent's model. At about 20K input and 1–2K output
tokens a finding, a 25-finding run is about 0.5M input and 50K output tokens. The price per token is not
recorded here; check the console before a large pass (ledger `usage.cost` stays null, not zero).

**Tested** on invented findings and pages, with page fetches and the model stubbed (`npm run props`, PGlite
and Postgres): the refusals, cited-pages-only reading, LinkedIn and private addresses never requested, the
come-back-once rule, SEC pacing and contact header, the overrides, the validator, the never-overwrite
rule, the ledger and envelope records and an audit row free of names. **Not yet run:** a real call to the
API or a real page. The first real run should be a five-finding batch whose grades a person compares with
the Mac's fact-checker on the same findings.

## 5. The run ledger after the move, built

`scripts/workflow-run.ts` writes `plcos-data/real/workflows/runs.jsonl` on the Mac, which is frozen. So:

- `POST /api/sync/runs` (`lib/sync/runs.ts`), with a `sync:push` token: `{event: "begin", run}` answers a
  run id; `{event: "finish", runId, result}` finishes it. The server's own ledger writer validates every line,
  so the 4 KB limit, the hashes, start-before-finish and the rule that a second different finish is refused
  all hold. `source` must be claude-code, chatgpt or script (the app records its own runs), and only the person
  who began a run can finish it (their handle is appended to the run's `launchFolder`).
- `scripts/cloud-run.sh begin <metadata.json>` and `finish <runId> <result.json>` take the same files as
  `scripts/workflow-run.ts`, with the push token and app URL from the Keychain, as `cloud-push.sh` does.
- A push still records its own run, with the Mac run as parent (`--run`).
- Fixed on the way: `finishRun` recorded activity under the Mac's layout even when given a server root, so a
  claude-code or chatgpt finish on the server would have failed after writing its line.

## 6. Next slices, in order

1. **W1c corrections. Built 6 Oct** (`lib/workflows/cloud-w1c-correct.ts`). A tick on the launch form
   ("and correct the findings"). After a finding is graded, and only if a grade is partly, not supported or
   someone else, a second call proposes the corrected finding from the pages already read. The server refuses
   it if it changes the identity, the name or the capacity band, cites a page the finding didn't cite, changes
   a fact on a page that wasn't read, carries a quote that isn't on its page, drops or changes a supported or
   unavailable fact, or fails the importer's validator. The server, not the model, writes the dated
   `researched.corrected` entry (`by: "claude (cloud), W1c"`); `researched.at` stays. The original is kept
   under `enrich/inbox/<run>/replaced/raw/` before the corrected finding replaces it. The import is not
   queued: Import findings picks the corrections up, as with the first cut's output.
2. **Prospect sourcing for a vehicle.** Needs search. A server-implemented `search` tool, not Anthropic's,
   so each query is checked before it leaves: names, organizations, titles, locations and topic words only,
   never a status, amount, note, list name or the fact of the pipeline (real-data.md). Output is a prospects
   file through the prospects import, as the push takes it.
3. **W1 (profiles). Built 6 Oct** (`lib/workflows/cloud-w1.ts`; "Profile in the cloud", at most 10 LPs). The
   model is given only the batch row's name, organization, title, location, work domains and Affinity's links
   (`minimalRow`): status, amounts, notes and lists never reach the prompt. Tools: Anthropic's `web_search`
   (brokers and LinkedIn blocked, six uses an LP) and the server's own `fetch_page` on `cited-pages.ts` (eight
   reads an LP). Anthropic runs the searches, so each query is checked as it comes back: one carrying an amount,
   our pipeline or one of our vehicles' names fails that LP and marks the run's query check failed. Before
   writing, the server sets `researched` and `queries` from what ran, moves to `profile.cautions` any fact whose
   page was not read in this run or whose quote is not on it, and runs `check`; a rejected finding goes to
   `enrich/rejects/`. A finding on file is kept under `enrich/inbox/<run>/replaced/` first. Sonnet, the system
   prompt (protocol plus schema) cached.
4. **W5 (strategies).** No web. Inputs from the server's own files and database; output through
   `checkStrategy`. Opus-class model, per the throughput rules.
5. **Retire or fence the first cut.** Fenced (6 Oct, see §8): `lib/workflows/api.ts` and its buttons now need
   Cloud workflows on, like the rest. Its W1c path should go once `w1c-cloud` has a real run behind it, because it
   gives W1c web search.

## 7. Open questions for Juan

- Turn on "Cloud workflows" on Railway for a first five-finding W1c run? It sends those findings and their
  cited pages' text to Anthropic under the key in Settings.
- Is the Anthropic workspace behind the Railway key the zero-retention one, with a monthly spend limit?
- Fence the first-cut buttons behind the setting now (recommended), or leave them until slice 2?

## 8. Choices made without Juan (night of 5–6 Oct 2026)

Juan was away and asked for work to continue, with any choice made, written down and kept going. These are a
builder's choices, not Juan's decisions (docs/decisions/ records only his); each is reversible in one commit.

- **The first-cut buttons are behind Cloud workflows.** Run W1 / W1c / W5 on Developer → Enrichment, and the job
  they queue, refuse while the setting is off, as the cloud fact check does. Before, an Anthropic key alone
  turned them on. Reason: the setting is the one place that says this server sends research to Anthropic, and
  the first cut's W1c gives the model web search, which W1c's rules forbid.
