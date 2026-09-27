-- 0068–0070: derived route scores and source-backed portfolio membership.
alter table network.route_cache add column best_score numeric check (best_score between 0 and 100);
create table network.portfolio (
  portfolio_id text primary key,
  vehicle_id uuid not null references platform.vehicle,
  company_entity uuid not null references identity.entity,
  company_name text not null,
  founders jsonb not null default '[]',
  source jsonb not null,
  fund_labels jsonb not null default '[]',
  note text,
  input_hash text not null,
  imported_at timestamptz not null default now()
);
create index portfolio_vehicle_idx on network.portfolio(vehicle_id);
create trigger portfolio_reads_changed after insert or update or delete or truncate on network.portfolio
  for each statement execute function network.invalidate_reads();

-- These are two deterministic source keys for our own institution, not a name-based match.
-- The W3 key is sha256('w3-person:pl:https://protocol.ai'), in connectionPersonKey's UUID format.
do $$ declare legacy uuid; newer uuid; begin
  select identity.canonical_entity_id(entity_id) into legacy from identity.source_record
    where source='w3_person' and source_id='713c0c5f-8600-59da-abef-c84cc771b81a';
  select identity.canonical_entity_id(entity_id) into newer from identity.source_record
    where source='network_org' and source_id='pl';
  if legacy is not null and newer is not null and legacy <> newer and not exists (
    select 1 from identity.match_assertion where kind='not_same_as' and
      ((left_source='w3_person' and left_source_id='713c0c5f-8600-59da-abef-c84cc771b81a' and right_source='network_org' and right_source_id='pl') or
       (right_source='w3_person' and right_source_id='713c0c5f-8600-59da-abef-c84cc771b81a' and left_source='network_org' and left_source_id='pl'))
  ) then
    insert into identity.match_assertion(kind,left_source,left_source_id,right_source,right_source_id,merged_entity,canonical_entity,rule,signals,note)
      values ('same_as','network_org','pl','w3_person','713c0c5f-8600-59da-abef-c84cc771b81a',newer,legacy,
      'own-institution-source-keys','["explicit PL source namespaces"]','0068–0070: one PL institution; preserve source facts.');
    update identity.entity set merged_into=legacy where entity_id=newer;
  end if;
end $$;
