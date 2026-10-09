# Routes: two people on bad terms, and your own ties · 9 Oct 2026

Issue 0143. A tie's warmth says how close two people are, not whether they get on, so a portfolio founder at odds
with an LP could still come out as the top "Recommend" route. On /routes, any route row now has "Two people here on
bad terms?": pick the two, say why if you like, and every route that would ask one of them about the other is
excluded, with the mark as its reason (who marked it, when, and the note). An "On bad terms" card lists the marks
for the target; Undo restores the routes. Marks are read live on every route read, like restrictions, and are
undone, never deleted (`network.bad_terms`, migration network/019).

Issue 0144. The graph never makes a personal tie out of a shared organisation: a path through an organisation is
proximity only, and a large one (an accelerator, say) is dropped from routes. So two former partners at one firm
had no tie between them. Under Connection feedback on /routes there is now "Your own tie to …": say how you know
them (worked together, know them directly, close friends, co-founders, family), where, and when you were last in
touch. It is recorded as your reviewed tie, graded like any other (worked together is B), used by routes at once,
and kept by network rebuilds; Remove ends it. Separately, the research's paths no longer read a team member who
worked at an accelerator (a partner, director or staff) as a batch alumnus (D); it is a shared employer (C).
