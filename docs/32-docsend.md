# 32 — DocSend: dataroom and document views

**Status: scope for Juan's review (14 Oct 2026). Nothing here is built yet.** Updated 15 Oct 2026: DocSend has an MCP server (§2).
Juan, 14 Oct 2026: "Are you connected to Docsend yet? if not … add API support, i'll try to get a token
later today. scope it out for now and get it for my review." The thread "Outreach conversion per vehicle"
consumes what this produces (§6).

This lifts the "No DocSend before L13" line in AGENTS.md for read-only DocSend view data only, on Juan's
ask. Nothing in this doc writes to DocSend, creates links, or downloads documents.

---

## 1. What exists today

- **No DocSend connection.** `fixtures/sources.json` lists DocSend as `not_connected`; the Performance page
  says so.
- **Materials carry a pasted DocSend link** (`modules/content`, `asset.link`, docs/27 §"A material's link").
  Each material also has a vehicle (`asset.vehicleId`). So a DocSend link URL already maps to a vehicle for
  every material someone pasted a link on.
- **Affinity already logs DocSend views.** DocSend's Affinity integration writes a note per visit:
  `DocSend Deck Viewed / Document: … / Email: … / Time Viewed: …` (see `fixtures/affinity/notes.json`).
  We replicate those notes, and `lib/connectors/affinity/notes.ts` already flags them (`deckView`) for the
  LP timeline. That is real history we hold now: visitor email, document name, time. No duration, no pages.

## 2. Does DocSend have an API?

**No REST API, but an official MCP server (Juan, 15 Oct 2026: "i think they have an MCP").** Checked 15 Oct
2026 through search results (docsend.com and help.dropbox.com are not reachable from the cloud container):

- Dropbox DocSend runs a **remote MCP server**, in open beta for **Advanced Data Rooms** plans, signed into
  with **OAuth** as the DocSend user, and limited to what that user's account and plan can already see. The
  organization must allow third-party AI connections. Sources: [Dropbox help, "How to connect the Dropbox
  DocSend remote MCP server"](https://help.dropbox.com/integrations/connect-docsend-mcp-server) and
  [DocSend's announcement](https://www.docsend.com/blog/introducing-mcp-for-docsend/).
- Its tools, as the help page lists them: read and analyze documents or pages; list the Spaces you can
  access; show a Space's documents and folders; **search contacts who visited your documents; show the
  documents a contact visited**; and update a Space group's members and download settings (a write).
- Server URL: `https://docsend.com/mcp` (Juan, 15 Oct 2026). Not yet known: the exact tool names and arguments, and whether a visit comes back with
  duration, pages or time per page. These decide how much of §3 the MCP can fill.
- There is still no REST API or developer portal. Third-party pages describing `api.docsend.com/v1` cite no
  DocSend documentation; treat them as unconfirmed.

So the "token" is an OAuth sign-in to DocSend's MCP server, not an API key:

| Access | Where it comes from | What it gives |
| --- | --- | --- |
| DocSend MCP sign-in | Juan signs in once (OAuth) from Settings → Connections in PLC OS. | Spaces, documents, and who visited what, with history (route E). |
| A webhook secret we mint | Settings → Connections. Pasted into a Zapier step that forwards each DocSend visit. | Every new visit, forward-only (route B). Only if E lacks durations. |
| None | — | Affinity's notes (route A) and Space analytics CSV exports (route D). |

**Recommendation:** route A now (no sign-in), route E as the main source once we have seen its tool
schemas, D once per data room for history if E does not give duration and pages, and B only if E turns
out not to cover new visits well enough.

## 3. The data we want

One row per **visit**: who (visitor email), what (document, link, Space), when, and how much (seconds, pages
viewed, percent complete) when the source says. A visit is evidence of attention, never of interest or intent
(Performance page wording stays): it moves no pipeline stage and never touches a consent rung (invariant 2).

```
docsend.visit
  visit_id        text primary key    -- source + source id; idempotent re-delivery (types.ts seam 4)
  source          text                -- 'affinity_note' | 'mcp' | 'webhook' | 'csv'
  started_at      timestamptz
  duration_sec    integer null
  pages_viewed    integer null
  page_count      integer null        -- pages in the document, so share viewed = pages_viewed / page_count
  page_seconds    jsonb null          -- {"1": 42, "2": 7, …} when the source gives time per page
  viewer_email    text null           -- lowercased; null when the link was not email-gated
  entity_id       uuid null           -- canonical LP entity, matched by email the way comms are (§5)
  link_id         text null           -- DocSend link id (the docsend.com/view/<id> part)
  link_url        text null
  document_id     text null
  document_title  text null
  space_id        text null           -- the data room, when the visit was to a Space
  space_name      text null
  vehicle_id      uuid null           -- from docsend.vehicle_map (§5); null when unmapped
  raw             jsonb               -- the payload as it arrived, for replay
  received_at     timestamptz
```

`docsend.vehicle_map(kind 'link'|'document'|'space', key, vehicle_id, set_by, set_at)` holds the mapping.
`docsend.sync_state(source, last_synced_at, last_error)` gives each source's as-of time.

The same visit can arrive by Affinity and by Zapier. Rows are deduplicated per
(viewer_email, document title, started_at rounded to the minute), keeping the richer source, so counts never
double.

## 4. Routes

**A. Affinity notes (now, no token).** A step in the existing Affinity sync reads notes whose text starts
`DocSend Deck Viewed`, parses document, email and time, and upserts `docsend.visit` with
`source = 'affinity_note'`. Runs wherever the Affinity replica updates; no new calls to Affinity.
Gap: only documents whose DocSend owner turned on the Affinity integration, and no duration.

**B. Webhook (forward-only).** `POST /api/connectors/docsend/visit`, accepting one visit as JSON, with the
secret in a header. A Zap "DocSend: New Visit" (and "New Space Visit") → "Webhooks by Zapier: POST" maps the
DocSend fields onto §3. Lands raw first, normalizes after; a bad payload is stored and shown, never
dropped. Off unless `config.docsend.webhook` is on and a secret is set. Zapier gives no signature and no
retries we can rely on, so the UI marks DocSend numbers partial (docs/09). Webhooks by Zapier is on Zapier's
paid plans (inferred from Zapier's plan pages; check when connecting).

**C. REST API poll.** Dropped: no REST API exists (§2).

**D. CSV import (history).** DocSend's Space Analytics page exports a CSV of all visits to a data room
(Advanced Data Rooms plan). An Admin uploads it on Developer → Data (a new upload there); it lands as `source = 'csv'`. This
is the only way to get duration and pages for visits before B is switched on.

**E. DocSend MCP (main source).** The PLC OS server is the MCP client: `lib/connectors/docsend/` speaks
MCP over HTTP to DocSend's remote server, signed in by OAuth (dynamic client registration and PKCE, the
way any remote MCP client signs in). Juan clicks "Connect DocSend" in Settings → Connections once; the
refresh token is stored encrypted like the mailguard key, never printed. A background job (night schedule
plus the daily timer) walks Spaces → documents → visiting contacts → their visits, upserts
`docsend.visit` with `source = 'mcp'`, and records `docsend.sync_state`. The client calls only an
allowlist of read tools; the Space-group update tool and any other write tool throw in the client (a
property test checks this, as for Affinity). One call a second, stop on a rate-limit error. If the
sign-in lapses, the sync stops and Settings says so; nothing falls back to another connector.

Only `lib/connectors/docsend/` reads DocSend payloads (`npm run boundaries`). DocSend view data is real data:
it stays in our database and `data/real/`, never in git, screenshots or prompts (real-data rules).

## 5. Mapping visits to LPs and vehicles

**Visitor → LP.** `viewer_email` resolved to a canonical `entity_id` the same way comms are (`lib/comms`,
`identity.canonical_entity_id`). One match → that LP and their pursuits. No match → the visit is kept and
listed as "unknown visitor" with the email, so a person can attach it; it is never guessed onto an LP by
name. Our own team's views (internal emails) are kept but excluded from every count.

**Visit → vehicle**, first rule that applies:
1. `link_url` equals a material's pasted link → that material's vehicle.
2. `space_id`, `document_id` or their names match a `docsend.vehicle_map` row an Admin set on the Materials page
   ("Neurotech Fund I data room" → PLC Neurotech I). Unmapped names show there with their visit counts, so
   mapping one is a single pick.
3. Otherwise the visit has no vehicle and counts only in "unmapped". Never spread across vehicles
   (invariant 1's spirit: no blending).

## 6. Precomputed outputs (what the conversion page reads)

The module exposes one read, `visitsFor(vehicleId)` in `modules/docsend`, for the conversion page's
buildCache: every visit mapped to that vehicle with the §3 fields, plus `asOf` (the oldest
`last_synced_at` across the sources that are on). Unmatched visits come back with `entity_id = null`.
Fields a source cannot fill (duration and pages from Affinity notes) are null, never zero.

A background job (the existing daily timer plus a run after each ingest) refreshes the mapping and
entity matches on stored rows, never on page open, so `visitsFor` is a plain indexed read. Agreed with
the "Outreach conversion per vehicle" thread (14 Oct 2026); the shape changes only by agreement with it.

## 7. Config

```ts
docsend: {
  affinityNotes: true,   // route A; reads what the replica already holds
  mcp: false,            // route E; also needs the DocSend sign-in in Settings → Connections
  webhook: false,        // route B; also needs a secret in Settings → Connections
}
```

## 8. Build order

1. Schema, route A, the mapping rules and `visitsFor`. Gives views per vehicle from history we already
   hold. No sign-in, no new outside calls.
2. Inspect the DocSend MCP's real tool list and a sample response (needs a DocSend sign-in; see §9), then
   build route E behind `docsend.mcp`, with the read-only allowlist.
3. Route D upload, if E lacks duration and pages.
4. Route B, only if E misses new visits.

## 9. Questions for Juan

1. Is your DocSend on Advanced Data Rooms, and does your DocSend org allow third-party AI connections?
   The MCP needs both.
2. Fastest way to see the real tools: add DocSend's MCP as a custom connector in claude.ai (Settings →
   Connectors, server URL `https://docsend.com/mcp`) and enable it in this thread. I list its tools,
   read one visit, and build E against what it actually returns. The PLC OS server then gets its own
   sign-in.
3. Which data rooms and documents belong to which vehicle? (Or let the Materials page mapping do it.)
4. Is the DocSend → Affinity integration on for all of the team's DocSend accounts, or just yours?
