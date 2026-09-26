-- Stable foreground list order. Applied migrations are append-only.
create index entity_active_name_idx on identity.entity(display_name, entity_id)
  where merged_into is null and retired_at is null;
