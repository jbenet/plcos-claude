# Decision log

One Markdown file per decision, named `YYYY-MM-DD-short-scope.md`. This log gives
feedback triage a dated, quotable source for checking contradictions. It records
decisions; it does not turn a proposal, question or agent interpretation into approval.

Run `node --import tsx scripts/decisions-index.ts` from the repository root to list the
entries by date and filename. Add `--json` for structured output. The script reads
only this folder, validates the metadata and supersedes links, and writes nothing.

Each file starts with frontmatter. Values use JSON syntax (also valid YAML), one
field per line, so the index needs no YAML dependency:

```yaml
---
date: "2026-09-28"
who: "Juan"
decision: "A short description of the decision"
quote: "The exact words recorded in the source"
source: "docs/example.md"
scope: ["pages:example", "modules:example", "fields:example", "process:example"]
supersedes: []
---
```

Use the source's decision date, not the date of transcription. Where the source
omits the year, say how it was inferred in the body. Preserve the source's wording,
including its existing ellipses; wrapped lines may become spaces. The body explains
the bounded meaning and links to the source section. `scope` names searchable pages,
modules, fields or processes; it must not contain record names or IDs.

`supersedes` contains earlier decision filenames, only when the source establishes
that change. Keep the earlier file: a newer decision replaces only the overlapping
scope, not every rule in the old entry. An empty list means no explicit predecessor
was established, not that the decision overrides everything previously written.

For a new human answer to contradiction or major-change triage, record who answered,
their quote, date and scope, with a source that can safely be committed. Never infer
permission from an agent's summary or a suggested answer in a deployment plan.

## Seed coverage and boundaries

This initial curated seed uses only `AGENTS.md`, top-level `docs/*.md`,
`docs/agent-rules/*.md` and Markdown under `docs/changelog`. Repeated quotes are
represented once using the fuller source. It is not a claim to cover the 123 quotes
counted in the deployment plan, which also counted code comments and other sources.
Headings or paraphrases without a direct quote are not seeded. Brief assent is
included only with the precise question's scope explained in the source.

No real-data directory, issue file, memory file or code comment was read to seed
this log. Skip an entire quote if it names an LP or a person outside the team; do
not redact such a quote into an apparently complete decision. Review every proposed
entry before committing it. The index validates structure, not confidentiality or
whether a human actually approved a decision. This log does not authorize external
actions, change access, or implement the deployment plan.
