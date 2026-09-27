-- The warehouse reserves this explicit organization key. Earlier node imports typed
-- every warehouse row as a person; correct that source identity, never namesakes.
do $$ declare canonical uuid; warehouse_id uuid; begin
  select identity.canonical_entity_id(entity_id) into canonical from identity.source_record
    where source='w3_person' and source_id='713c0c5f-8600-59da-abef-c84cc771b81a';
  if canonical is null then
    select identity.canonical_entity_id(entity_id) into canonical from identity.source_record where source='network_org' and source_id='pl';
  end if;
  select identity.canonical_entity_id(entity_id) into warehouse_id from identity.source_record
    where source='warehouse' and source_id='organization:protocol-labs';
  if warehouse_id is not null and canonical is not null and warehouse_id <> canonical and not exists (
    select 1 from identity.match_assertion where kind='not_same_as' and
      ((left_source='warehouse' and left_source_id='organization:protocol-labs') or (right_source='warehouse' and right_source_id='organization:protocol-labs'))
  ) then
    insert into identity.match_assertion(kind,left_source,left_source_id,right_source,right_source_id,merged_entity,canonical_entity,rule,signals,note)
      values ('same_as','warehouse','organization:protocol-labs','w3_person','713c0c5f-8600-59da-abef-c84cc771b81a',warehouse_id,canonical,
      'own-institution-source-keys','["explicit warehouse organization key"]','0070: correct the warehouse institution previously typed as a person; preserve source facts.');
    update identity.entity set merged_into=canonical where entity_id=warehouse_id;
  elsif warehouse_id is not null and canonical is null then
    update identity.entity set entity_type='org' where entity_id=warehouse_id;
  end if;
end $$;
