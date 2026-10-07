# Top connectors answer at once when nothing changed · 7 Oct 2026

JuanMail's mail desk waited about 15 s for every `GET /api/outreach/connectors` (the top connectors, and one connector's
targets). Each call planned the routes to every open LP again, one by one, until the 15 s budget ran out.

Now a vehicle's plan is kept for each person asking until something it read changes: a pursuit, a route or edge, an ask,
a restriction, an entity (the same revision counters the route cache uses), or the date. The first call still waits up to
15 s and says how far it got, but planning carries on after it. Later calls take the kept plan in well under a second.

A complete answer also carries `version`, a hash of what it says. JuanMail can pass it back as `ifChanged=<version>`, and
an answer that would be the same comes back as `{ "unchanged": true, "version": … }`. docs/27 §4b has the details.
