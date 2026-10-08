-- Nothing reads dakota.identity_revision (the worker's matching index never used it), yet every
-- write to identities, claims and research notes updated its one row and held that row's lock until
-- commit, so a long import made every other such write wait for it (performance pass, 8 Oct 2026).
-- The table and function stay for the migration history; only the triggers go.
do $$ declare relation text; begin
  foreach relation in array array['identity.entity','identity.source_record','identity.external_identifier',
    'identity.match_assertion','research.claim','research.note'] loop
    if to_regclass(relation) is not null then
      execute format('drop trigger if exists dakota_identity_changed on %s', relation);
    end if;
  end loop;
end; $$;
