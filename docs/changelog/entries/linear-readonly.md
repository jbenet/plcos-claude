## Linear, read-only — a connector, a replica, and a plan to approve

Juan, 27 Sep 2026: "let's implement Linear support … start with a read-only version." He overrode
"no connectors before L13" for Linear, as he did for Affinity; AGENTS.md's exception line names both.
The design, the study of the workspace and the plan for what comes next are in
[docs/24-linear.md](docs/24-linear.md).

**The connector** (`lib/connectors/linear/`) is the only code that talks to Linear, and
`npm run boundaries` enforces it. A personal key can write, so read-only lives in the client: it
sends only ten allowlisted GraphQL queries, by name, and checks each text for a `mutation` or
`subscription` before sending. It follows Linear's cursors, reads the hourly request and complexity
budgets from every answer, waits for the reset when either runs low (or stops when the reset is too
far off), backs off on 429 and `RATELIMITED`, and counts requests, bytes and records into the
activity log as a new source, Linear. The key comes from the Keychain (`plcos-linear` / `api-key`)
through `scripts/with-linear-key.sh`, which `npm run dev:real` now runs beside the Affinity one; the
demo and previews never see it.

**The sync** follows Dakota's split. A pull writes pages as Linear sent them under
`<real root>/linear/raw/<entity>/<stamp>.jsonl` with a manifest; after the first complete pull, only
what changed since (less a ten-minute overlap, a GUESS) is asked for, archived records included. A
translation replays the files into a new `linear` schema: teams, members, workflow states, labels,
projects, milestones, cycles, issues and comments. A newer `updatedAt` wins, an explicit null clears
a column, an absent field is kept, each file's hash is pinned and a changed one refused. It runs as
a new import job, `linear`, from **Sync Linear** on the new Developer → Linear page, and on the real
data only on the live server.

**Pages.** Developer → Linear shows the sync's state and budget, what is in the replica by team,
project and state, fill rates, a by-name reading of vehicles, our team and LPs (labelled
unconfirmed; nothing is linked), and the allowlist. Connectors gains a Linear row and chart group;
Status lists Linear as a source, with its counts and last sync. The standup's Linear pane still shows
fixtures, and now says so accurately.

**The study** (counts only) found a small workspace: 7 teams, 1,320 active issues (2,037 with
archived), 56 active projects; a full sync is 44 requests and about 6 MB. 71% of it belongs to a team
outside the raise. The fundraising team is two weeks old, with 219 issues that are well kept at the
project level (leads, start and target dates, key-result labels) and name no LPs. Linear has no
custom fields on issues, which answers open question 3.

**The plan, for Juan to approve:** in the read-only phase, a Workstreams card on each vehicle's
overview (its Linear projects and a start-to-target strip) and a "My Linear" list on Today in place
of the standup's fixture pane; not an LP card (there is nothing to show), not a gantt, not the
Calendar. Links through a table we own, proposals by name confirmed once per project, never inferred
for LPs. Writes later, behind a human click, an approval ticket, an idempotency key checked against
Linear before creating, a rollback that archives, and a switch that turns them off.

Checked on the invented workspace in `fixtures/linear/` only: fifteen new properties (no mutation
leaves the client by any route; the key is never in a log, an error, the activity log, a file or the
database; pagination and backoff; the translation, nulls clearing fields). The real API was read
from a worktree to learn its shapes and counts; nothing real is in this change. No screenshots.
