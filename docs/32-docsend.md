# 32 — DocSend: dataroom and document views

**Status: scope for Juan's review (14 Oct 2026). Nothing here is built yet.**
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

**As far as can be verified, no public one.** Checked 14 Oct 2026:

- DocSend publishes no developer portal or API reference, and it is not on the Dropbox developer platform.
  Its own help center offers Zapier (and IFTTT) as the programmatic route. docs/09 §0.4 found the same in
  September.
- Third-party pages that describe `api.docsend.com/v1` with bearer tokens cite no DocSend documentation and
  are years old. Treat them as unconfirmed. (docsend.com itself is not reachable from the cloud container,
  so this was checked through search results, not by calling the host.)

So "a token" can mean one of three things, and the design takes all three:

| Token | Where it comes from | What it gives |
| --- | --- | --- |
| A DocSend API key | Only if DocSend support says his plan has API access. Worth one email to ask. | Polling with backfill (§4 route C). |
| A webhook secret we mint | Settings → Connections in PLC OS. Pasted into a Zapier (or IFTTT/Make) step that forwards each DocSend visit. | Every new visit, forward-only (route B). |
| None | — | Affinity's notes (route A) and Space analytics CSV exports (route D). |

**Recommendation:** start with A now (no token), add B as soon as Juan connects DocSend in Zapier, use D
once per data room for history, and switch to C only if DocSend confirms an API.

## 3. The data we want

One row per **visit**: who (visitor email), what (document, link, Space), when, and how much (seconds, pages
viewed, percent complete) when the source says. A visit is evidence of attention, never of interest or intent
(Performance page wording stays): it moves no pipeline stage and never touches a consent rung (invariant 2).

```
docsend.visit
  visit_key       text primary key    -- source + source id; idempotent re-delivery (types.ts seam 4)
  source          text                -- 'affinity_note' | 'webhook' | 'csv' | 'api'
  visitor_email   text                -- lowercased; null when the link was not email-gated
  document_name   text
  link_url        text                -- https://docsend.com/view/… when the source gives it
  space_name      text                -- the data room, when the visit was to a Space
  viewed_at       timestamptz
  duration_sec    integer null
  pages_viewed    integer null
  completion_pct  numeric null
  raw             jsonb               -- the payload as it arrived, for replay
  received_at     timestamptz
```

The same visit can arrive by Affinity and by Zapier. Rows are deduplicated per
(visitor_email, document_name, viewed_at rounded to the minute), keeping the richer source, so counts never
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

**C. API poll (only if DocSend confirms an API).** `lib/connectors/docsend/` with a GET-only, allowlisted
client like Dakota's, polled by a background job from a watermark, one request a second, stop on 429. The
key is stored encrypted in Settings like the mailguard key, never printed. Built only once we have the
actual reference, since every endpoint name today would be a guess.

**D. CSV import (history).** DocSend's Space Analytics page exports a CSV of all visits to a data room
(Advanced Data Rooms plan). An Admin uploads it on Developer → Data (a new upload there); it lands as `source = 'csv'`. This
is the only way to get duration and pages for visits before B is switched on.

Only `lib/connectors/docsend/` reads DocSend payloads (`npm run boundaries`). DocSend view data is real data:
it stays in our database and `data/real/`, never in git, screenshots or prompts (real-data rules).

## 5. Mapping visits to LPs and vehicles

**Visitor → LP.** `visitor_email` against the email identities we already resolve (Affinity person emails,
mail and calendar addresses). One match → that person and their pursuits. No match → the visit is kept and
listed as "unknown visitor" with the email, so a person can attach it; it is never guessed onto an LP by
name. Our own team's views (internal emails) are kept but excluded from every count.

**Visit → vehicle**, first rule that applies:
1. `link_url` equals a material's pasted link → that material's vehicle.
2. `space_name` or `document_name` matches a mapping row an Admin set on the Materials page
   ("Neurotech Fund I data room" → PLC Neurotech I). Unmapped names show there with their visit counts, so
   mapping one is a single pick.
3. Otherwise the visit has no vehicle and counts only in "unmapped". Never spread across vehicles
   (invariant 1's spirit: no blending).

## 6. Precomputed outputs (what the conversion page reads)

A background job (the existing daily timer plus a run after each ingest) rebuilds, never on page open:

```
docsend.vehicle_lp_views     -- one row per (vehicle, LP person)
  vehicle_id, person_id, first_view_at, last_view_at, visits, documents, total_sec (null if unknown),
  sources text[], partial boolean
docsend.vehicle_views_daily  -- one row per (vehicle, day): visits, distinct visitors, distinct LPs
```

These are what "Outreach conversion per vehicle" charts against, and what an LP's timeline shows. The
shape is the proposal to that thread; it changes only by agreement with it.

## 7. Config

```ts
docsend: {
  affinityNotes: true,   // route A; reads what the replica already holds
  webhook: false,        // route B; also needs a secret in Settings → Connections
  api: false,            // route C; needs a DocSend-confirmed API and key
}
```

## 8. Build order

1. Schema, route A, the mapping rules and the precomputed tables. Gives views per vehicle from history
   we already hold. No token, no new outside calls.
2. Route B endpoint and the Settings secret, off by default. Switched on when Juan connects the Zap.
3. Route D upload.
4. Route C, only after DocSend confirms an API and we have its reference.

## 9. Questions for Juan

1. Which data rooms and documents belong to which vehicle? (Or let the Materials page mapping do it.)
2. Can you ask DocSend support whether your plan includes API access? If not, is Zapier OK for route B?
3. Is the DocSend → Affinity integration on for all of the team's DocSend accounts, or just yours?
