# 32 — DocSend: dataroom and document views

**Status: route E built, off until an Admin connects DocSend (15 Oct 2026).** Scoped 14 Oct; DocSend's MCP server found and confirmed 15 Oct (§2).
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
- Server URL: `https://docsend.com/mcp` (Juan, 15 Oct 2026). Confirmed 15 Oct 2026 by connecting it to a
  Claude thread with Juan's sign-in. Its published tool schemas:
  - `list_spaces` lists the Spaces the user owns or collaborates on (`all_company: true` for company admins).
  - `list_visits(space_id | document_id | contact_id, cursor, limit ≤ 50)` returns visit history, newest
    first: `visit_created_at`, `time_spent_viewing_ms`, `link_name`, `document_name`, `document_id`,
    `contact_email`, `contact_name`, `space_id`, `space_name`, `page_views[{page_number, time_on_page}]`,
    `percentage_viewed`, `unique_pages_viewed`, `total_pages_count`. No visit id, no link id.
  - Other read tools: `list_space_content`, `list_space_permissions`, `list_space_events`,
    `search_contacts`, `list_content_library`, `read_document`, `search_documents`.
  - Write tools PLC OS never calls: `create_space`, `create_space_folder`, `create_space_group`,
    `create_space_link`, `update_space`, `update_space_group`, `update_space_link`,
    `set_space_permission_visibility`, `rename_space_content`, `move_space_content`,
    `request_space_upload`, `upload_file_to_space`.
  - The tool descriptions ask clients never to show `*_id` values to people; PLC OS keeps them for joins only.
- There is still no REST API or developer portal. Third-party pages describing `api.docsend.com/v1` cite no
  DocSend documentation; treat them as unconfirmed.

So the "token" is an OAuth sign-in to DocSend's MCP server, not an API key:

| Access | Where it comes from | What it gives |
| --- | --- | --- |
| DocSend MCP sign-in | Juan signs in once (OAuth) from Settings → Connections in PLC OS. | Every visit with history, duration and time per page (route E). |
| A webhook secret we mint | Settings → Connections. Pasted into a Zapier step that forwards each DocSend visit. | Every new visit, forward-only (route B). Only if E lacks durations. |
| None | — | Affinity's notes (route A) and Space analytics CSV exports (route D). |

**Recommendation:** route E is the source: it has history, duration and time per page, so B (Zapier) and
D (CSV) are not needed. Route A stays as a fallback for documents shared outside a Space.

## 3. The data we want

One row per **visit**: who (visitor email), what (document, link, Space), when, and how much (seconds, pages
viewed, percent complete) when the source says. A visit is evidence of attention, never of interest or intent
(Performance page wording stays): it moves no pipeline stage and never touches a consent rung (invariant 2).

The table is `docsend.visit` (`modules/docsend/migrations/001_docsend.sql`): `visit_id`, `source`, `started_at`,
`duration_sec`, `pages_viewed`, `page_count`, `percent_viewed`, `page_seconds` (`{"1": 9, "2": 6, …}`),
`viewer_email`, `viewer_name`, `entity_id` (null when no one on record has the address), `internal` (our team),
`link_name`, `document_id`, `document_title`, `space_id`, `space_name`, `vehicle_id`, `raw`. `visitsFor` returns
the same fields with `linkId` always null, since DocSend gives a link's name only.

From the MCP: `visit_id` = hash of (space_id, document_id, contact_email, visit_created_at), since visits
carry no id; `started_at` = `visit_created_at`; `duration_sec` = `time_spent_viewing_ms / 1000`;
`pages_viewed` = `unique_pages_viewed`; `page_count` = `total_pages_count`; `page_seconds` = `page_views`;
`link_name` = `link_name`.

`docsend.vehicle_map(kind 'space'|'document', key, vehicle_id, set_by, set_at)` holds the mapping; a document's
row wins over its data room's.
`docsend.space.read_through` gives each data room's as-of time.

Only the MCP writes visits today. If route A (Affinity's notes) is added, a visit it also finds is deduplicated
per (viewer_email, document title, started_at rounded to the minute), keeping the MCP's row, so counts never double.

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

**E. DocSend MCP (main source, built 15 Oct 2026).** The PLC OS server is the MCP client.
- `lib/connectors/docsend/mcp.ts` speaks Streamable HTTP (JSON-RPC over POST, JSON or event-stream answers) to
  `https://docsend.com/mcp`, the only file that names it (`npm run boundaries`). It calls only `list_spaces` and
  `list_visits` (`tools.ts`); any other name is refused before anything is sent. One call a second, backoff on 429/5xx.
- `oauth.ts` signs in the way any remote MCP client does: protected-resource and authorization-server metadata, dynamic
  client registration as a public client, the authorization code with PKCE (S256), refresh. Only https on DocSend's or
  Dropbox's hosts is fetched (a GUESS that its sign-in lives on one of them; anything else is refused and Settings says
  the sign-in could not be reached).
- DocSend refused the server's own callback address (`invalid_redirect_uri`, 17 Oct 2026). Registration now tries it,
  then the loopback addresses `http://localhost:8976/callback` and `http://127.0.0.1:8976/callback` (native-app
  redirects, RFC 8252; a GUESS that DocSend accepts them). With a loopback address the browser ends on a page that does
  not load; the Admin pastes that address on Settings, and the code in it is exchanged only with the PKCE verifier in
  their own signed state cookie (ten minutes). If DocSend refuses those too, the remaining route is asking DocSend to
  allow our callback.
- Settings → Connections → DocSend: **Connect DocSend** (an Admin signs in as themselves; the registration and tokens are
  that person's encrypted secret, purpose `docsend`), **Read now**, **Disconnect**, and a vehicle picker per data room.
  Routes `/api/connectors/docsend/connect` and `/callback`, Admins only, with a signed state cookie.
- The read is an import job, `docsend` (`lib/connectors/docsend/sync.ts`): last in the daily run, on Read now, and
  queueable by an Admin token (`POST /api/sync/jobs {"kind":"docsend"}`). Per data room it reads visits newest first
  until one is older than the last complete read less a day, so the first read takes the whole history and later
  ones a page or two. Then viewers are matched by email (`partiesOf` in `lib/calendar-sync.ts`: email claims, then
  Affinity's addresses), our team's visits are marked `internal`, and each visit takes its data room's vehicle.
- `modules/docsend` owns the tables (`connection`, `space`, `vehicle_map`, `visit`) and the read `visitsFor(vehicleId)`.
- If the sign-in is refused, the client refreshes once; a second refusal is written on the connection and shown in
  Settings. Nothing falls back to another connector.

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
complete read across the vehicle's data rooms). Unmatched visits come back with `entity_id = null`.
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

1. Schema, route E (OAuth client, read-tool allowlist, background sync from a per-Space watermark),
   the mapping rules and `visitsFor`.
2. Route A as a fallback for visits outside a Space.
3. B and D only if E proves insufficient.

## 9. Questions for Juan

1. Which Space belongs to which vehicle? (Asked in the thread; the mapping is editable.)
2. Whose DocSend sign-in should the server use? A company admin's, with `all_company`, also covers Spaces
   other people create later.
