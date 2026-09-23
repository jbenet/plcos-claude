-- A run can stop on purpose (N42): the first slice estimates its per-entity requests before
-- making them, and holds when the estimate is over the ceiling, until a person says go.
-- "held" is that state — neither done nor failed.
--
-- Append-only: 002 is applied in the real database and cannot change.

alter table sources.sync_run drop constraint sync_run_status_check;
alter table sources.sync_run add constraint sync_run_status_check
  check (status in ('running', 'ok', 'failed', 'held'));

-- What a run knew that its counts do not say: the estimate a held run is waiting on, the
-- lists it read, the gaps it met. Structured, so a go-ahead can be bounded by the estimate
-- it was given rather than by a number parsed out of a sentence.
alter table sources.sync_run add column detail jsonb not null default '{}'::jsonb;
