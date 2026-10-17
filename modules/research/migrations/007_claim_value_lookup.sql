-- Claims by address and by email domain (performance pass, 17 Oct 2026).
--
-- The mail desk, Reconciliation and the calendar read find the person or firm behind an address by the claim's
-- value: `lower(btrim(value)) = …` (trim() is btrim()) on a current email claim, and the address's domain on a
-- current email or email-domain claim. The only index led with entity_id, so each lookup read every claim:
-- Reconciliation's "did the LP send this themselves" check scanned them once per LP, most of a 50-message ingest.
-- Each index's predicate is the queries' own, word for word, so the planner can prove it; only short address
-- values are indexed (a long value in another field could not fit a btree entry).
set local statement_timeout = 0;
create index claim_email_value_idx on research.claim (lower(btrim(value)))
  where superseded_by is null and field ~ '(^|\.)email$';
create index claim_email_domain_idx on research.claim (lower(regexp_replace(btrim(value), '^.*@', '')))
  where superseded_by is null and field ~ '(^|\.)(email|email_domain)$';
