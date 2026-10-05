-- A cloud push may carry researched prospects (docs/prospects-import.md; 5 Oct 2026): the Mac pushes a
-- prospects/<name>.jsonl file, the server checks every line and every vehicle slug, writes it under a
-- run-specific name and queues the prospects import as the token's owner (lib/sync/push.ts). One more
-- value for sync_push.workflow; the rows already taken are unchanged.
--
-- Append-only: 001–020 are applied in the real database and cannot change.
alter table platform.sync_push drop constraint sync_push_workflow_check;
alter table platform.sync_push add constraint sync_push_workflow_check check (workflow in ('W1', 'W1c', 'W5', 'prospects'));
