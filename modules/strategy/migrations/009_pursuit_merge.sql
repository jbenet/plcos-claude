-- Retain merged pursuits and every source record. Active readers exclude redirects.
alter table strategy.pursuit add column merged_into uuid references strategy.pursuit(pursuit_id);
alter table strategy.pursuit add constraint pursuit_merge_not_self check (merged_into is null or merged_into <> pursuit_id);
create index pursuit_merged_idx on strategy.pursuit(merged_into) where merged_into is not null;
create view strategy.active_pursuit as select * from strategy.pursuit where merged_into is null;
create function strategy.canonical_pursuit_id(input_id uuid) returns uuid
language sql stable as $$
  with recursive chain as (
    select pursuit_id, merged_into, array[pursuit_id] visited from strategy.pursuit where pursuit_id=input_id
    union all
    select p.pursuit_id,p.merged_into,c.visited || p.pursuit_id from chain c
    join strategy.pursuit p on p.pursuit_id=c.merged_into where not p.pursuit_id=any(c.visited)
  ) select pursuit_id from chain where merged_into is null limit 1
$$;

-- Multiple pre-existing records may describe the same rung/file after a merge.
-- Uniqueness is retained within each original pursuit, not at the expense of evidence.
alter table strategy.ladder_event add column origin_pursuit_id uuid;
update strategy.ladder_event set origin_pursuit_id=pursuit_id;
alter table strategy.ladder_event alter column origin_pursuit_id set not null;
alter table strategy.ladder_event drop constraint ladder_event_pursuit_id_rung_key;
alter table strategy.ladder_event add unique(origin_pursuit_id,rung);
alter table strategy.suggestion add column origin_pursuit_id uuid;
update strategy.suggestion set origin_pursuit_id=pursuit_id;
alter table strategy.suggestion alter column origin_pursuit_id set not null;
drop index strategy.suggestion_file_idx;
create unique index suggestion_origin_file_idx on strategy.suggestion(origin_pursuit_id,file_hash);
create function strategy.pursuit_origin() returns trigger language plpgsql as $$
begin
  new.origin_pursuit_id := coalesce(new.origin_pursuit_id,new.pursuit_id);
  return new;
end $$;
create trigger ladder_origin before insert on strategy.ladder_event for each row execute function strategy.pursuit_origin();
create trigger suggestion_origin before insert on strategy.suggestion for each row execute function strategy.pursuit_origin();

-- Primary owner stays on the survivor; other owners remain attached and attributable.
create table strategy.pursuit_owner (
  id uuid primary key default gen_random_uuid(),
  pursuit_id uuid not null references strategy.pursuit(pursuit_id),
  owner_id uuid not null references platform.app_user(id),
  origin_pursuit_id uuid not null,
  owner_said text
);
create table strategy.pursuit_merge (
  id uuid primary key default gen_random_uuid(),
  survivor_id uuid not null,
  loser_ids uuid[] not null,
  rule text not null check(rule='rule:pursuit-merge'),
  actor_id uuid references platform.app_user(id),
  created_at timestamptz not null default now(),
  changes jsonb not null,
  reversed_at timestamptz,
  reversed_by uuid references platform.app_user(id),
  reversal_reason text
);

-- A rule/source survivor can inherit a person's decision from an alias. Keep that
-- protection on every importer without falsely labelling the survivor's status as theirs.
create index audit_pursuit_status_subject_idx on platform.audit_log(subject_id)
  where subject_type='pursuit' and action='pursuit.status_set';
create function strategy.pursuit_has_human_status(input_id uuid) returns boolean
language sql stable as $$
  with recursive aliases as (
    select pursuit_id,status_source from strategy.pursuit
      where pursuit_id=strategy.canonical_pursuit_id(input_id)
    union all
    select p.pursuit_id,p.status_source from strategy.pursuit p
      join aliases a on p.merged_into=a.pursuit_id
  ) select exists(select 1 from aliases a where a.status_source='us'
    or exists(select 1 from platform.audit_log h where h.subject_type='pursuit'
      and h.subject_id=a.pursuit_id::text and h.action='pursuit.status_set'
      and h.detail->>'statusSource' is distinct from 'rule'))
$$;
