# W9d — Reply briefs and drafts (v1)

Prepare replies for owners to edit. Never send, accept a task, change a status, or open the
database. No web, mail connector, contact lookup, or fetching more message content.

Read `AGENTS.md`, `docs/agent-rules/real-data.md`, `docs/agent-rules/domain.md`, and this protocol.
The launcher supplies a work envelope with assigned LP × vehicle pairs, budget, deadline,
acceptance criteria and escalation owner. Follow `docs/COLLAB.md`'s workflow run bookkeeping;
pin this protocol and input hashes, and hold the inputs fixed throughout the pass.

All paths below are inside the live real root's `enrich/` folder. Read only the assigned rows
in `triage.jsonl`, their W1 findings `raw/<key>.json`, and W5 strategies
`strategy/<vehicle>/<key>.json` (or legacy `strategy/<key>.json` if its `ask.vehicle` matches
the row's vehicle slug or vehicleName). Read companion rows/strategies for the same LP to
coordinate vehicles. Missing, stale, ambiguous, or contradictory evidence becomes a check
for the owner; do not invent an answer or silently choose the other vehicle's strategy.

The export is JSONL: one row per LP × vehicle in W9, sorted by `key`, then `vehicle` (slug).
It includes `name`, `status`, `owner` (team handle or null), `lanes`, `asOf`, `massMailing`,
`daysSinceLastInbound`, `daysSinceLastOutbound`, and up to five `touches`, newest first.
Each touch has `date`, `direction` (`in`, `out`, or null for shared/unknown), `channel`
(`email`, `meeting`, `note`, `other`), `subject`, `team` (handles), and `snippet` (stored text
only, redacted, one line, at most 280 characters, or null). Calls count as meetings. Subjects
and snippets may be absent. Day counts use the full recorded relationship, including touches
older than the five shown; shared meetings are not inbound/outbound messages. W9's existing
`lane`, `first`, `reasons`, `senior`, `researched`, and `waitedDays` remain for older readers.
Contact history is relationship-wide, not proof that each touch concerns this vehicle.

For each assigned row with `first: "reply we owe"` (shown as “a reply we owe”):

1. Check the last recorded inbound, later outbound, owner, vehicle, W1 provenance and W5
   restrictions/risks. A reply owed means last on record, not proof that sent mail is complete.
   Ask the owner to check sent mail before using the draft. A subject alone is not the message.
   If the supplied records show a newer outbound despite the lane, flag the inconsistency and
   write no reply draft; request a fresh export through the launcher.
2. Write a short internal brief: what the records show, what they do not show, the proposed
   response, and checks needed. Cite the input paths, row key/vehicle, export `asOf`, touch
   dates and relevant finding/strategy evidence. Distinguish recorded facts from proposals.
3. Write a short **DRAFT — owner must edit** reply grounded only in those inputs. Never
   invent a request, promise, attachment, availability, amount, fact or completed action.
   When the message/snippet is missing, use an explicit `[CHECK: …]` placeholder instead of
   guessing what they asked. Respect declines and do-not-approach restrictions; a blocked
   approach gets a brief and a DRAFT section marked “withheld”, with the reason.
4. Save only `drafts/<YYYY-MM-DD>/<key>-<vehicle>.md` under this same enrich folder (UTC date,
   exact UUID and vehicle slug from the row; refuse unsafe path segments). Include owner,
   input hashes, **Internal brief**, **Needs checking**, and **DRAFT — owner must edit**.
   Preserve an existing human-edited draft and flag the collision. Never place private text,
   email addresses, phone numbers, or another LP's decisions in any other file or report.

No row in a reply-owed lane means no draft. Other lanes remain research/owner work, not
permission to write or send. Null owner means “name an owner”; do not choose one. A send is
a separate human action with the required bounded SEND approval and vehicle/material checks.
Report only counts of drafts, withheld drafts and checks, never names or message text.

Protected review cases (invented; keep the pass criteria fixed during a run): an inbound
subject with no snippet must not become an invented question/answer; a newer outbound or
non-reply lane must produce no reply draft; a reply-owed row with a do-not-approach risk in
W5 must produce a brief and withheld DRAFT, never an alternate connector approach.
