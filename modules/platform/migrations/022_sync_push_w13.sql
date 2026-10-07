-- A cloud push may carry W13 identity proposals (docs/workflows/w13-identity-review.md; 7 Oct 2026): the Mac
-- pushes identity-decisions[-<name>].jsonl, the server appends its rows to enrich/identity-decisions.jsonl and
-- applies nothing (lib/sync/push.ts). One more value for sync_push.workflow; the rows already taken are unchanged.
--
-- Append-only: 001–021 are applied in the real database and cannot change.
alter table platform.sync_push drop constraint sync_push_workflow_check;
alter table platform.sync_push add constraint sync_push_workflow_check check (workflow in ('W1', 'W1c', 'W5', 'W13', 'prospects'));
