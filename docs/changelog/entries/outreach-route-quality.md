# Routes say how good they are, and search works over REST · 7 Oct 2026

JuanMail is building an Intros page that lists routes to an LP the way Capital OS's routes page compares them. Until now
`routes_to` returned each route's people and tiers but not the rest of what the comparison rows show.

Each route in `GET /api/outreach/routes-to` (and the MCP tool) now also says its score out of 100 (null while it is still
provisional), its weakest tier, its first reasons, the introducer's asks used this quarter against the cap, and whether
it is folded under another route. Each hop says how warm the tie reads (0 to 5), what kind of tie it is, and the year it
dates from. Reasons that could quote a restriction appear only to people who may read restriction reasons.

`GET /api/outreach/search?query=…` runs the same search as the MCP `search` tool. docs/27 §4a has the details.
