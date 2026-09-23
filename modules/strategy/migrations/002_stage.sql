-- Where a pursuit is in our own process (N46): a stage, and separately an outcome and a reason.
--
-- The consent ladder says what has been *evidenced*. The stage says where the work *is* —
-- finer-grained, the way the team already tracked it in Affinity — and each stage *claims* a
-- rung (modules/strategy/types.ts, STAGES). A claim is shown beside the ladder, never written
-- into it: the gap between the two is the point of the stepper (rule 2).
--
-- Affinity's single status field mixed several things — "Passed – Timing" is an outcome and a
-- reason, "On Hold" is neither a stage nor an ending — so they are three columns here.
--
-- Append-only: 001 is applied in the real database and cannot change.

create type strategy.pursuit_stage as enum (
  'research', 'targeted', 'contacted', 'responded', 'scheduling',
  'first_meeting', 'follow_up', 'diligence', 'docs_out',
  'soft_commit', 'signed', 'funded'
);

create type strategy.pursuit_outcome as enum ('open', 'paused', 'passed', 'lost');

alter table strategy.pursuit
  add column stage          strategy.pursuit_stage,
  add column outcome        strategy.pursuit_outcome not null default 'open',
  add column outcome_reason text,
  -- Where the stage came from (rule 9). 'us' when it was set here; otherwise the source,
  -- what the source itself said, and when.
  add column source         text not null default 'us',
  add column source_ref     text,
  add column source_as_of   timestamptz,
  add column stage_said     text,
  -- The owner as the source names them, kept when that person is not on the team — a former
  -- colleague's pursuits are still theirs in the history.
  add column owner_said     text;

create index pursuit_source_idx on strategy.pursuit (source, source_ref);
