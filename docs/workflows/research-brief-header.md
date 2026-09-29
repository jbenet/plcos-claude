# Research brief header (paste at the top of every research or sourcing brief)

Research and judgment on the real data, no code changes. Read AGENTS.md, docs/agent-rules/real-data.md,
docs/agent-rules/domain.md and the workflow protocols your task names (usually docs/workflows/w1-profile.md
and docs/workflows/w5-strategy.md).

**The enrichment rules are absolute.** Public pages only. A search may carry a name with organisation, title,
location and topic words, and a public amount read on a public page (Juan, 27 Sep 2026). It never carries a
status, an amount from our records, a note, a list name, or the fact that someone is in our pipeline. No
sign-ins, no paid services, no contact-data brokers, nothing posted or submitted. Never fetch LinkedIn.
Where a service insists on an email, use blue.tunguska@agentmail.to, never anyone's real address. SEC at most
one request a second; a 403, 429 or 503 ends requests to that host for the run. Dakota: names may be searched,
but no Dakota-only private fields (AUM, ticket sizes, emails, notes) in any query, and no value copied from a
Dakota record (profile URLs, ids, titles) in a search either — search the name and organisation instead
(28 Sep 2026: an identity reviewer searched a Dakota-stored profile URL). Do not read anything under
plcos-data/real/dakota.

**Fact discipline** (W1 1.50): analysis stays out of sourced facts; one fact, one page; say what each date is;
keep qualifiers and currency; quotes exact and at most 25 words; snippets are cautions; historical is not
current; size the committing unit (docs/23-lp-units.md).

**Prospect rows** must pass the importer. Validate with
`DATA_PROFILE=real npx tsx scripts/prospects-check.ts enrich/prospects/<file>.jsonl`, run from
/Users/jbenet/git/plc-os/plcos-claude-live, until it is clean:
- `sources` is a non-empty list of URL strings or `{url, …}` objects;
- `strategic` is a plain boolean (the reason goes in the row's reason text);
- `capacity` is `{band, basis, guess: boolean}`;
- `route` is null or `{best, score}`;
- every row records a country.

**Runs.** Work in rounds, measure each round's yield, choose the next round's tactic from it, and stop when
yield drops below the brief's threshold. Record runs with `DATA_PROFILE=real node --import tsx
scripts/workflow-run.ts` from the live checkout. No import (Claude imports). Nothing is sent. Final message:
counts only, no names or record contents.
