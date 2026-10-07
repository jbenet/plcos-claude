# Every LP and its addresses in one light read · 7 Oct 2026

JuanMail matches the mail it reads to LPs. Until now it had to page through the whole queue for that, 25 rows at a time,
each row carrying checks, the comms trace and the strategy it does not need there.

`GET /api/outreach/contacts?vehicle=…` (or `vehicle=all`), and the MCP tool `outreach_contacts`, now answer every LP on
the vehicle in one page with only its pursuit, name, status, whether it passed, and the addresses on file. Addresses
follow the queue's rule: shown only where the token reads words on that vehicle, never licensed ones.

`updatedSince` keeps only what changed, and `ifChanged` with the last `version` answers `{ "unchanged": true }` when
nothing did. Recording an address (`POST /api/outreach/contacts`) works as before. docs/27 §4d has the details.
