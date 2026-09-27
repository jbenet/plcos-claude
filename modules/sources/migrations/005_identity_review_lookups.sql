-- Identity review and its duplicate preview join only the selected identities.
-- The existing unique index has kind between source and source_id, so it cannot
-- efficiently serve untyped IDs. Preserve all raw versions and lookup semantics.
create index raw_record_identity_id_idx on sources.raw_record(source,source_id);
create index raw_record_affinity_typed_id_idx
  on sources.raw_record ((kind||':'||source_id)) where source='affinity';
create index raw_record_affinity_list_subject_idx
  on sources.raw_record (((payload->>'type')||':'||(payload->'entity'->>'id')))
  where source='affinity' and kind='list_entry';
