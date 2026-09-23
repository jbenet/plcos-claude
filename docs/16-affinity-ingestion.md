# 16 — How Affinity gets in, and how it is read

**Status:** living document, started 23 Sep 2026 (N46). Juan asked for "how we do all the
ingestion and mapping" to be kept track of. `docs/15-affinity-integration.md` is the plan and
the decisions; this is the machinery, step by step, and what to do when a step is wrong.

The principle, in Juan's words: first get a local copy we can query and reprocess. Every
step below reads the step before it from the local database and never goes back to Affinity to
fix a mistake. A wrong mapping is an edit and a re-run.

```
Affinity ──GET──▶ raw ──────▶ inventory ──▶ mapping ──▶ translation ──▶ the views
         (read-only)  sources.   aggregates    a file you    the tool's own    pursuits, money,
                      raw_record  and questions  edit          tables            people, routes
```

Everything real lives under `data/real/`, which git ignores: the database, `init.jsonc`,
`mapping.jsonc` and `reports/`. The demo runs every step against a fake Affinity in
`fixtures/affinity/`.

---

## 1. Read (lib/connectors/affinity/)

One client, GET only, allowlisted paths (`allowlist.ts`), a budget that follows Affinity's
rate-limit headers, and a log of every request without bodies (docs/15 §5).

| Step | Page | Reads | Cost |
|---|---|---|---|
| Connection test | Developer → Affinity | whoami, rate limit | 2 requests |
| Discovery (N41) | → Lists | every list, its fields, the account's users | one per list, plus a few |
| First slice (N42) | → First slice | the entries on each list the init file names, plus SPV lists | one per hundred entries |
| Notes (N49) | → Notes | every note in the account but replies, with what each is attached to | one per hundred notes, plus a count |
| Relationships | → First slice, after a go-ahead | per person on a vehicle's lists | one per person — **held** |

Everything lands in `sources.raw_record` keyed by source id and a hash of the payload, so a
second read stores only what changed, and an old version is kept beside a new one. Each run is a
row in `sources.sync_run` with its counts, its gaps and, for a held run, its estimate.

**Notes, in bulk (N49).** Juan, 23 Sep: replicate Affinity locally — each record downloaded
once, then only its changes — and keep the notes on every list, not just Neurotech's. So the
per-entry plan (a request per entry, one vehicle's notes kept) was replaced by `GET /v2/notes`,
which pages through every note a hundred at a time. With `includes`, each note carries the
people, organizations and opportunities it is attached to (the first hundred of each, with a
total). The count comes first, from one request that returns no notes (`limit=0&totalCount=true`),
and a read is approved as that number: it stops if it would go past it.

- **After the first read**, the next asks only for notes created or updated since that read
  began, less a day, in two passes because a note nobody edited has no `updatedAt`. A note
  deleted in Affinity stays here until someone reads everything again.
- **Replies** are not in the bulk list. Each note says how many it has; reading them would be a
  request per note, so they are counted and wait.
- **Which LP a note is about.** A note attached to a person on a list is theirs. So is one
  attached to the organization the list gives as theirs: most of the team's notes about an LP
  sit on the LP's firm (measured on the first read). A note on no list's people or firms is
  kept for later.
- **Where they show.** On an LP's page in this tool, newest first, with who wrote each and when
  it was read. A note that mentions someone's health is closed until opened, and nothing
  derived ever quotes it (Report 4 §6.2).

The first real read took 54 requests, exactly its estimate. Relationships have no bulk
endpoint; they stay per person, and held.

## 2. Inventory (→ Inventory)

Aggregates over the landed entries: fill rates, every dropdown value with its count, the team's
names on person fields, date ranges, amounts described but never summed, and recency from the
interaction fields. It names nobody outside the team. A dropdown whose values look like names is
counted and not listed. It generates the questions only a person can answer, and a report in
`data/real/reports/`.

**Lists compared** (N45): for a vehicle with more than one list, the first list the init file
names is the one in use, and each older list is checked against it by person, then by
organization. The names of entries that would be lost go to a report, as candidates to move
across. Nothing is moved.

## 3. Mapping (→ Mapping, `data/<profile>/mapping.jsonc`)

How each list's words become this tool's. Per list:

- **role**: `pipeline` becomes pursuits; `history` is kept raw and not translated. A vehicle's
  first list is its pipeline; its others are history.
- **status**: the fields that say where an entry is, tried in order. For each of their values
  (N50, docs/17): our **status** (new, sourcing, selected, discussing, committed, passed); where
  it passed, **who** ended it (they declined, we stopped, it went quiet) and **why**; what the word
  **implies** happened, undated (reached out, replied, met, met twice, signed…); and a **next**
  step for words like "On Hold", which say nothing about where the effort is. The team's status
  field held all of these at once, so they are taken apart here. A file written in N46's stages
  still reads; an unreviewed list in one is re-proposed when the file is next written.
- **commitment**, **softRange**, **checkSize**, **aum**, **owner**, **introducer**,
  **doNotContact**, **passReason**: which field holds each, or null.

The first version is **proposed** from the words, and each list says `reviewed: false` until a
person sets it true. A word the proposer can't place stays null: a question, not a guess.
Regenerating (after a new read) proposes only what is new and keeps every edit.

**Our statuses** (`modules/strategy/types.ts`, `STATUSES`, docs/17): six, for where our effort
is. What happened is the dated log and the close track, not the status. A word's implied facts
each **claim** a ladder rung ("met" claims *meeting held*), shown beside the ladder and never
written into it: the ladder moves on evidence. N46's twelve stages are retired; their columns
stay in the database, unread (migrations are append-only).

If we later decide our model is right and Affinity's should change to match, that's a write to
Affinity. It's a separate decision, and it would go through approval tickets.

## 4. Translation (N47, → Mapping → Translate into the tool)

Reads raw plus the mapping, and writes the tool's own tables, in one transaction and without a
request to Affinity. It can be re-run at any time: a mapping edit takes effect on the next run,
and running twice changes nothing (a property checks it). Each run is a `sync_run` of kind
`translate`, with its counts in `detail`. Pursuits and exposures the tool created itself
(`source = 'us'`) are never overwritten by a translation.

- **People and organizations** → `identity.entity`, linked to Affinity through
  `identity.source_record` (`affinity`, `person:<id>` / `company:<id>`).
- **Pursuits**: one per entry on a pipeline list, per vehicle, with our status, who and why where
  it passed, what Affinity said, what that implies, and when (`status`, `stage_said`, `implied`,
  `source_as_of`). An entry with an amount on the commitment field is Committed unless it passed.
  **A status a person set here is never overwritten**; Affinity's reading of its word is kept
  beside it (`status_said`), so the LP page can say when the two differ. The
  owner is matched to the team by Affinity email. Someone who isn't on the team — a former
  colleague — is kept by name in `owner_said`, and the pursuit goes to a placeholder owner who
  doesn't appear in the user switcher.
- **Money**: the commitment field becomes a **soft** exposure, always. A word implying *signed*
  marks it ready to harden, and becomes an undated *signed* event on the close track marked as
  Affinity's claim (N52, docs/17 §3); *wired* likewise. Such a claim is removed again if Affinity
  stops saying it. Only the close room's countersignature makes money hard (rule 1). On a
  historical vehicle, or once the pursuit passed, the exposure is closed, so no current figure
  counts it.
- **Check size and AUM** become research claims on the LP, with the list as their source
  document. AUM is low confidence and unverified (issue 0022).
- **Do not contact**: a "yes" becomes a blanket do-not-approach restriction on the person
  (rule 8).
- **Touchpoints** (N51, docs/17 §2): each list entry's interaction dates — the last email, the
  last and next meeting — and every meeting, call and email note attached to someone in the
  tool, including notes on their firm, become dated rows in `meetings.meeting`, keyed by the
  interaction so that a meeting with both a calendar entry and a note is one row (the
  calendar's date wins). No subject line, note text or outside attendee's name is copied. They
  are tied to no vehicle, because Affinity's interactions are not; each counts for every open
  pursuit of that LP. Translating again adds none.
- **The ladder is not touched.** No status, no implied fact and no touchpoint creates a ladder
  event; a person asks for a rung, with the evidence, through a STAGE ticket.

## When something is wrong

| What | Fix | Re-run |
|---|---|---|
| A status means something else | edit `mapping.jsonc` | translation |
| A new status appeared | regenerate the mapping (it is proposed, marked) | translation |
| A list is missing or named wrong | edit `init.jsonc`, reload it | discovery, slice |
| A field was read wrongly | fix the code; the raw copy is untouched | translation |
| Affinity changed | read the slice again (only changes are stored) | inventory, translation |
| New or edited notes | Notes → read what changed (counted first, usually two requests) | nothing — the LP pages read the copy |
| A note was deleted in Affinity | Notes → read everything again | nothing |
