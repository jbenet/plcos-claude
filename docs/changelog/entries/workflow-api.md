# Workflow API · 28 Sep 2026

| | |
|---|---|
| ![Developer → Enrichment with the W1, W1c and W5 buttons](docs/changelog/shots/workflow-api/01-enrich-workflow-buttons.webp) | The W1, W1c and W5 buttons beside the existing export/import controls on Developer → Enrichment. |

`/health` reaches the existing public health handler. Developer → Enrichment has W1, W1c and W5 buttons beside the existing export/import controls; they require `ANTHROPIC_API_KEY`. `ANTHROPIC_MODEL` defaults to `claude-sonnet-5`. Existing Mac operations remain unchanged without either variable.

One import job uses plain Anthropic Messages requests, bounded server-tool continuations, blocked LinkedIn/broker domains for W1/W1c, and no web tools for W5. Batch paths must resolve under the configured root's `enrich/batches`; JSONL rows or key lists receive their matching local inputs. Keep whole firms together in W5 batches, including colleagues and leads whose records the strategy needs. Returned findings and strategies pass the existing importer validators before publication; W1c reviews are checked for complete grades and counts. Failed output stays in `enrich/rejects`. The existing buttons import valid files; the workflow itself does not accept proposals or send outreach.

The existing JSONL ledger records hashes, the resolved model, outcomes and measured response tokens under the configured data root; other ledger callers retain their Mac layout checks. Two invented-data properties use stubbed fetch only, covering continuation, usage, validation, path confinement, absent keys, limits and root health. No live API call or real data used. Verification: TypeScript, boundaries and the property suite; Postgres at merge.
