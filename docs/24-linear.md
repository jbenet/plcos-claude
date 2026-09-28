# 24 — Linear, read-only first

**Status:** read-only connector built 27 Sep 2026. The pages below §3 are a **plan for Juan to
approve**; nothing in §3–§5 is built except the Developer pages.

Juan, 27 Sep 2026: "let's implement Linear support … start with a read-only version. Create a
connector, test the API, wire it up to all the relevant pages (connectors, status, etc) … we just
started using linear, so just very recent stuff in there, and likely incomplete … Consider which of
the vehicle + overview pages we should add it to. Think about it (less is more for stuff like this
sometimes), and give me a plan to approve … consider both a read-only and a read-write version."

## Decision: an exception to "no connectors before L13"

AGENTS.md said *No Linear before L13*. Juan overrode it on 27 Sep 2026, the same way he did for
Affinity on 22 Sep (docs/15): **Linear, read-only, now.** Writes are still prohibited until he
approves §5. AGENTS.md's exception line names both. docs/14 (the integration points written before
any connector) stays as the record of what the product already assumed; this document supersedes
its "nothing is wired" status and answers its open question on custom fields.

## 1. What was built

| Piece | Where | What it does |
|---|---|---|
| Key | Keychain `plcos-linear` / `api-key` (`npm run linear:store`); `scripts/with-linear-key.sh`; `lib/connectors/linear/key.ts` | `npm run dev:real` hands it to the live server's environment only. Never printed, never in a file. Demo and previews never see it. |
| Client | `lib/connectors/linear/client.ts`, `queries.ts` | The only code that talks to `api.linear.app` (`npm run boundaries`). Sends only the ten allowlisted queries, by name; each text is checked for `mutation`/`subscription` before sending. Cursor pagination; reads Linear's hourly request and complexity budgets from every answer, waits for the reset when either is low, backs off on 429 or `RATELIMITED`, stops when the reset is too far off. Counts requests, bytes and records into the activity log (source `linear`). |
| Raw replica | `<real root>/linear/raw/<entity>/<stamp>.jsonl` + `<stamp>.manifest.json` | Pages as Linear sent them. The first pull reads everything; later ones only what changed since the last complete pull started, less a ten-minute overlap (GUESS). Archived records are included, so an archive or a trash shows up as `archived_at`. |
| Translation | `lib/connectors/linear/replica.ts`, `translate.ts`, schema `linear` (`modules/linear/migrations/001_replica.sql`) | Teams, members, workflow states, labels, projects (status, lead, dates, teams, labels), milestones, cycles, issues (identifier, title, description, state, assignee, creator, priority, estimate, labels, project, milestone, cycle, due date, created/started/completed/canceled dates, parent) and comments. Newer `updatedAt` wins; an explicit null clears a column; an absent field is kept; each file's hash is pinned and a changed one refused. Provenance on every row: `source`, `updated_at` as as-of, `replica_file`, `last_verified_by` (who ran the sync). |
| Job | import job kind `linear` (`platform/009_linear_job.sql`), `lib/connectors/linear/sync.ts` | "Sync Linear" and "Full resync" on Developer → Linear queue it. Real data: live server only, with the key. The demo syncs an invented workspace (`fixtures/linear/workspace.json`) through the same client. |
| Pages | Developer → Linear (new), Connectors, Status | Sync state and budget; counts by team, project and state; a name-only reading of vehicles, our team and LPs; the allowlist. Connectors shows Linear's activity; Status lists it as a source. |

Checks: `scripts/properties/linear.ts` (no mutation leaves the client; the key is never logged,
thrown or written; pagination and backoff; the translation including nulls clearing fields).

## 2. What is in Linear (study, 27 Sep 2026, counts only)

Read from the API with the real key, from a worktree, counts and field names only.

- **Workspace:** 7 teams, 27 members (1 app), 51 active workflow states (types: backlog, unstarted,
  started, completed, canceled, duplicate), 72 labels (5 label groups), 56 active projects (101 with
  archived), 1 active milestone (31 with archived), 12 cycles (all on one team), 15 saved issue
  views, 16 documents. **No custom fields on issues** (checked by schema introspection). **Customer
  requests are not enabled**, so Linear's own "customer" object cannot hold LPs.
- **Issues:** 1,320 active (2,037 including archived), 1,188 comments on 434 issues. A full sync is
  44 requests, 3,832 records, 6 MB, 12 seconds, 2% of the hourly request budget; an incremental one
  with nothing changed is 9 requests.
- **Most of it is not the raise.** One team outside the raise holds 942 issues (71%) and has used
  Linear since mid-2025. The fundraising team was created on 14 Sep 2026 and holds 219 issues, all
  created 18–26 Sep: this is the "very recent, likely incomplete" part Juan flagged. Four smaller
  teams outside the raise hold the rest; one of them has projects and no issues yet.
- **The fundraising team is well structured for its age.** 29 projects, 28 with a lead, all with a
  start date, 14 with a target date; 218 of 219 issues are in a project; 214 carry labels; 176 carry
  a key-result label from an objectives-and-key-results label group; 200 are assigned. Its other
  label groups are function, owner initials and cadence. 183 are open, 35 done. 60 have due dates;
  23 comments. No milestones, no cycles, no estimates.
- **Vehicles:** project names map cleanly: 5 projects name Neurotech (by name or its short code),
  2 Rails, 3 an SPV. By words anywhere in title, description, project and labels: 106 issues mention
  Neurotech, 76 Rails, 36 an SPV, all but a handful on the fundraising team. "Grants" matches mostly
  another team's unrelated use of the word.
- **LPs:** matching 1,825 names of the ~1,190 people and organisations in the research export
  against issue text found **no LP named anywhere in the fundraising team's issues.** 167 issues
  elsewhere matched 15 distinct names, 151 of them on the largest team outside the raise, where they
  are almost certainly portfolio companies and common words rather than LPs. Titles alone: 28. So
  LP-level work lives in Affinity and here, not in Linear, and name matching would be mostly noise.
- **Owners:** 3 of our 10 team members match a Linear member by email; the fundraising team's
  issues have 6 assignees, 3 of them matched. 123 of its 219 issues (102 open) are assigned to a
  matched team member. The owner-initials label group is a second way to match, not yet checked.
- **Strategies and meetings:** none of the issues point back to a strategy, a move or a meeting in
  this tool. 56 descriptions carry a link; none to Affinity.

**What's missing:** LP-level tasks, due dates on most issues, estimates, milestones and cycles on
the fundraising team, and email matches for most of our team. **What's complete enough to use:**
projects as workstreams (status, lead, start and target), issue ownership, and the key-result
labels.

## 3. Read-only phase: which pages, and why (for approval)

Less is more. Linear is where the team plans its own work; this tool is where the raise is reasoned
about. Showing Linear back to the people who live in it is only worth it where it answers a
question this tool asks.

**Recommended, in order:**

1. **Vehicle overview: a "Workstreams" card** (one per vehicle). The vehicle's Linear projects
   (by the mapping in §4): status, lead, target date, open/done counts, and the next few open issues
   by due date. A simple timeline strip of project start → target dates. This is the one place the
   data is complete (projects are well kept) and it answers "what is the team doing to close this
   vehicle, and is it on time?". **Not** a full gantt: 5 projects per vehicle don't need one, and
   Linear's own timeline is one click away.
2. **Today: "My Linear" for the current user** — their open issues due this week or overdue, and
   their in-progress ones, from the fundraising team, capped at five with a link out. It replaces the
   fixture pane in the daily standup rather than adding a second. Only for members matched to a
   Linear member, so it depends on fixing the email matches (a `linearEmail` in the init file, like
   `affinityEmail`).
3. **Developer → Linear** (built) stays the place for sync, counts and the mapping review.

**Not now:**

- **An "Open work" card on the LP page.** The study found no LP named in the fundraising team's
  issues, so the card would be empty for every LP. Revisit when §5's write path creates LP-linked
  issues; then the card shows those, by explicit link.
- **Strategy moves linked to issues, read-only.** Nothing links them today. This belongs to the
  write phase (a move becomes an issue), not to reading.
- **A gantt or a separate Linear timeline page, reusing the Calendar.** The Calendar is for raise
  windows and meetings; mixing task due dates into it adds noise. Keep dates on the Workstreams card.
- **Comments, cycles, other teams' work, label groups as filters.** Replicated, not shown.
- **Any per-issue editing surface.** Linear already is one.

## 4. The linking model (for approval)

Three options were weighed:

| Option | For | Against |
|---|---|---|
| IDs in a label or custom field | Visible in Linear | No custom fields exist; a label per LP would put hundreds of LP names into Linear's label list, visible to every team in the workspace. Rejected for LPs. |
| Name matching, confirmed by a person | No work in Linear | The study: zero true LP hits on the fundraising team, 15 noisy ones elsewhere. Mostly noise. |
| **A link table we own** | Exact, private, reversible; carries provenance; works for issues we create later | Someone has to make the link |

**Recommendation:**

- **Vehicle ↔ Linear project:** a table `linear.link(target_kind, target_id, linear_kind, linear_id,
  source, as_of, confidence, last_verified_by)`, seeded by proposals from project names and the
  vehicle's aliases (the reading on Developer → Linear already does this), each accepted by a person
  once. Five projects per vehicle is a two-minute review. Unaccepted proposals are shown as such.
- **LP unit ↔ issue:** the same table, `target_kind = 'pursuit'` (an LP unit × vehicle, docs/23),
  created only by an explicit act: a person linking an issue on the LP page, or §5 creating the issue
  from here. Never by name matching alone.
- **Strategy move ↔ issue:** the same table, created by §5.
- **Members ↔ our team:** an optional `linearEmail` in the init file, matched like `affinityEmail`.

## 5. Read-write phase (later, gated; for approval)

What would write, from where, and when:

1. **A strategy's next action → a Linear issue for its owner** (the strategy board's "Assign", which
   today writes a `plays.handoff` row with `provider = 'linear'` and a full payload; docs/14 §1). The
   button becomes "Create in Linear". Team and project come from the vehicle's link (§4); assignee
   from the owner's matched member; labels the fundraising team already uses (key results, cadence), not
   new ones.
2. **A drafted reply or a meeting follow-up → an issue**, from the same place the draft lives, for
   the pursuit's owner.
3. **Mark done from our page** — only on issues this tool created, and only the state.

Rules:

- **A human click, every time.** No agent and no rule creates, updates or closes an issue. An agent
  may propose; the person accepts (AGENTS.md: no tool accepts its own proposed task).
- **The same approval model as other outward actions.** A new ticket kind (`TRACKER_WRITE`),
  bounded to one issue, one target team, an expiry; fail closed without it. The first version
  auto-approves the ticket for the clicking user on their own pursuits and requires approval for
  anyone else's; Juan decides the policy.
- **Idempotency:** each write carries a key, the handoff id, stored in our outbox *before* the call
  and attached to the issue as a link back to this tool. Before creating, the client asks Linear's
  `attachmentsForURL` for that link, so a retry or a double click finds the existing issue instead
  of making a second. The outbox row moves `pending → sent` only on Linear's receipt with the issue
  id.
- **What never goes to Linear:** amounts, soft or hard; ladder rungs; notes; restrictions; Dakota
  data; health detail. An LP's name goes only in an issue title that the person sees before clicking,
  on a team whose membership Juan has approved for LP names (§6).
- **Rollback:** every write is one outbox row with the payload sent and the issue id returned.
  "Undo" archives the created issue (Linear keeps archived issues, so nothing is lost) and marks the
  row `reverted`; a state change is undone by restoring the previous state from the row. A global
  switch in `config.linear` turns writes off without a deploy; turning it off leaves every link and
  outbox row intact.
- **When:** after (a) the read-only phase has run for two weeks on the live server without a
  sync failure, (b) §4's vehicle links are accepted, (c) Juan approves the ticket policy and which
  team may carry LP names, and (d) the write client exists as a separate, second allowlist
  (`issueCreate`, `issueUpdate` state only, `attachmentCreate`) with its own property tests. The
  read client stays queries-only.
- **Webhooks** (Linear signs them) could replace polling for issues we created, as invalidations
  only (docs/14 §2). Not before writes exist.

## 6. Risks

- **Data volume:** small today (6 MB, 44 requests for everything) and 71% of it is another team's
  work. Kept, because filtering at read time is cheaper than a second sync scope, and the pages count
  only what they show. If it grows past ~20k issues, scope the sync to named teams.
- **Recency:** the fundraising team is two weeks old. Any page built on it will look thin or
  wrong at first; that is why §3 starts with projects, the part that is already complete, and waits
  on LP-level cards.
- **Two task systems:** strategies, moves and next actions here; issues in Linear. The rule to keep
  them from drifting: **Linear owns execution state, this tool owns why the work exists** (docs/14
  §3). Nothing here duplicates an issue list; cards summarise and link out.
- **Confidentiality of LP names in Linear:** Linear is a SaaS workspace shared with teams outside
  the raise, and its data leaves our machine by definition. Today no LP names are in the fundraising
  team's issues. The write phase must not change that without Juan choosing a team whose membership
  is limited to the raise; labels are workspace-visible and never carry LP names.
- **Training:** reading sends Linear nothing of ours. Before any write, check that Linear's terms
  keep workspace data out of model training (AGENTS.md: no training on this project's data); not
  verified here.
- **Key scope:** a personal key can do anything its owner can. Read-only is enforced in our client
  and proven by the properties; the key lives only in the live server's environment. An OAuth app
  with the `read` scope would make it true on Linear's side too — worth doing before writes, when
  the write path gets its own `write`-scoped credential.

## Decision, 27 Sep 2026 (Juan)

**Read-only, fewer pages:** only Developer → Linear, Connectors and Status for now. The vehicle Workstreams card and "My Linear" on Today are not built. The read-write phase is not started. Revisit once the fundraising team's Linear use has settled.

## PLC-only scope (Juan, 27 Sep; implemented 28 Sep 2026)

This supersedes the workspace-wide replica and the data-volume decision above. Juan asked to
read and sync only PLC and purge other teams. `config.linear.teams` defaults to `['PLC']`.
The reviewed GraphQL texts require team filters; caller filters cannot widen that scope.
Users are read by IDs referenced by scoped projects, issues and comments. A changed allowlist
forces a full scoped pull. The mutation guard is unchanged.

Developer → Linear shows the allowlist and scopes its database reads, including before cleanup.
**Purge and re-map** queues `linear-rebuild` on the live server without needing the connector key.
It filters every saved entity JSONL file (including orphan/partial files), removes empty files,
updates manifest counts with a counts-only purge note, then truncates and replays the Linear
schema in one database transaction. Audit and activity contain counts only. Pull and rebuild
share the same job exclusion so they cannot modify the replica concurrently.

Claude's live procedure after integration: apply the new migration through the live server,
open Developer → Linear, verify the visible allowlist, click **Purge and re-map**, wait for the
job to finish, and reload the counts. Then use **Full resync** for a fresh scoped copy if desired.
The purge makes no API calls. If interrupted during file rewriting, rerun the rebuild before
syncing: each rewrite is atomic and replay resets the old file pins. Repeating a completed
rebuild preserves the same records and retained purge counts. No live purge was run during
implementation; all development evidence uses invented fixtures.
