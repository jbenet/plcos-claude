# 0065 — Vehicle strategy from the actual raise records

The vehicle strategy page now reads pursuits, exposures, LP strategy proposals, research and dated route searches. It no longer treats an empty legacy fit table as an empty pipeline or presents network-wide edge counts as coverage for one raise.

The top box separates hard committed, configured target, soft indications and cash received, with pipeline statuses and movement since Monday UTC. The action queue exposes the capacity, likelihood, route factor, decision time and observed status-exit adjustment behind each monetary score. Unknown inputs stay unscored. A separate, explicitly guessed points system orders evidence work: restrictions, overdue steps, soft indications and missing or stale evidence. LP rows carry their strategy, recorded/proposed action, owner, route and evidence links. Coverage and risk filters, action groups, search and pagination retain the full list.

Fixed the enrichment importer’s entity-only strategy mapping. A strategy now attaches to the LP’s open pursuit in its named vehicle. An append-only repair moves undecided proposals when a unique destination exists, otherwise withdraws wrong-vehicle proposals while retaining their inputs. Human decisions remain unchanged. The acceptance command refuses a mismatched vehicle. Scoped grants URLs now stay on the grants vehicle instead of being interpreted as legacy module links.

Invented example: Cedar has pursuits in Fund Amber and Fund Birch. A strategy naming Birch belongs to Birch even when Amber’s pursuit was opened first. A recent route snapshot invalidated by a graph or scoring change cannot supply a ranking factor.

Validation: typecheck and module boundaries passed; 398 properties passed, including 14 new checks for mapping, repair idempotency, scoring, evidence freshness and action provenance. Demo and private-copy HTTP checks covered the strategy views, filters, empty states and LP links. Page timings met the existing 10-second cold / 3-second warm budgets. Browser visual verification was unavailable in the sandbox; no screenshots were created for this entry.
