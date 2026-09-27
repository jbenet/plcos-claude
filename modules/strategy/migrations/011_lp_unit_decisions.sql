-- Public-research decisions share the LP page's reversible journal, with distinct authorship.
alter table strategy.lp_repoint drop constraint lp_repoint_decided_by_check;
alter table strategy.lp_repoint add constraint lp_repoint_decided_by_check
  check (decided_by in ('rule', 'person', 'file'));
alter table strategy.lp_repoint add column file_decision jsonb;
-- The receipt survives reversal; replaying the same file must never reapply an undone answer.
create unique index lp_repoint_file_key_idx on strategy.lp_repoint ((file_decision->>'key'))
  where file_decision is not null;
