# A busy introducer is flagged, not held · 8 Oct 2026

Feedback 0124 asked what should happen when one person is already being asked for many intros. Juan: "flag only".

A route whose introducer has been asked at or past the per-quarter guide (3, a guess in config) used to drop from Recommend
to Hold. It now stays Recommend, carries a "busy introducer" warning in its reasons and an amber flag on the routes page, and
still appears among the top routes. The outreach API's connectors gain `busy` (true at or past the guide); nothing is hidden
or refused because of it. Setting `guard.askLimit` to `enforce` would bring the hold back.
