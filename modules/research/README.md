# research

What we believe about an entity, and why.

## The promotion rule

`research.note` holds anything not yet worth a migration. A concept is promoted into real
columns when — and only when — one of these is true:

1. Users repeatedly need to **filter** on it.
2. A **mistake recurs** because it was unstructured.
3. A **tool needs a precise input** and cannot parse prose reliably.
4. **Performance** becomes a demonstrated problem, not a predicted one.

Open questions currently live in `note` with `kind = 'open_question'`. They have not met
any of the four tests yet. When someone asks for "every target with an unanswered
authority question", that is test 1 and they get a table.

## Cache versus snapshot

Two tables that would collapse into one if they were named by shape instead of by purpose:

| | `read_cache` | `snapshot` |
|---|---|---|
| Exists for | latency and API quota | explaining a historical output |
| Guarantee | none; may vanish | durable |
| Reading it means | "this is probably current" | "this is what we saw then" |
| Rendered as | current data | labelled non-authoritative |

Collapsing them is how a six-week-old copy gets read as today's CRM state.
