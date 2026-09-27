# Routes and portfolio — issues 0068, 0069, 0070

The routes picker orders recorded route scores, with unscored targets last. A selected target no longer jumps above the sorted list or bypasses the In touch filter. Route comparisons also order by score and show every hop’s grade.

Route strength is capped at the weakest hop, with an explicit adjustment in the breakdown. A full copied-cache audit inspected 898,844 candidates across 3,529 searches: the cap lowered 163,333 scores, including 137,006 positive scores through a zero-warmth hop. These are bounded search candidates, not every possible graph path.

PL has one canonical institutional identity and is only a source. Paths may run PL → team member → another person; none may enter PL. Shared directed relationships use one graph arc with the hop score and grade. Scores are primary; grades remain secondary and preserve weaker source evidence. A/B require close, working, investment or recent direct relationships; generic membership and proximity remain C/D. Priors remain labelled GUESS.

Added an append-only portfolio migration, an idempotent Developer → Enrich import, and portfolio pages for Neurotech and Rails. Company and founder records retain fund labels and page-level provenance. Name-only matches remain possible identities; unique names with sourced company affiliations can link to an existing person. Portfolio founders are labelled on route lists and graphs and count as In touch, without changing pipeline or consent states.

Extraction produced 14 company rows and 3 explicitly named founder records; 2 pending investments were excluded. Historical fund attribution and conflicting ownership disclosures remain visible. Rails materials were absent from the supplied local corpus, and the page says so.

Validation: 411 existing properties, 17 new scoring/import/identity properties, graph regression checks, TypeScript and module boundaries. Demo and copied-data pages were checked through HTTP and the portfolio form was submitted only to the preview copy. No screenshots or private records are included here.

Final page timings: demo first/repeat maxima 2.61s/0.28s; copied real-scale data 5.76s/0.74s. All measured pages returned 200 and met 10s/3s budgets.
