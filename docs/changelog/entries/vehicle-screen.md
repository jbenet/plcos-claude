# Screen our records for a new vehicle's LPs · 13 Oct 2026

Juan, 13 Oct 2026: "can you search the db and identify who would be good LPs for Gordian Biotech? We may do an SPV.
Ideally list them in a page we can go through like the selecting page."

- **Screen by token** (`POST /api/sync/screen`, Admin token): reads the research facts, public profiles and Dakota
  descriptions already on file for a vehicle's field words (and an SPV's company name), and scores each person or
  firm: a tie to the company, each kind of tie (backed, works in, stated interest, Dakota focus), each word matched,
  and how far they already are with us on another vehicle. A dry run answers counts only, never a name.
- With `add`, the top matches go on the vehicle as **New** through Add prospects, each with a one-line reason, so the
  list is gone through on Selection like any other. Nothing is sent and nothing moves past New.
- A **biotech** field for Gordian, so the strategic lens marks LPs who have backed or work in biotech.

Notes: `lib/sync/screen.ts`; `docs/prospects-import.md` "Screening our records".
