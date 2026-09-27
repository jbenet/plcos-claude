-- Sources migrates after Dakota on a fresh database.
create trigger dakota_identity_changed after insert or update or delete or truncate on sources.raw_record
  for each statement execute function dakota.invalidate_identity_index();
create index raw_record_identity_latest_idx on sources.raw_record(source,kind,source_id,fetched_at desc,id desc);
