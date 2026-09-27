-- Local, reversible type decisions. Source records and canonical redirects are retained.
create table identity.entity_type_correction (
  correction_id uuid primary key default gen_random_uuid(),
  entity_id uuid not null references identity.entity,
  original_type identity.entity_type not null,
  corrected_type identity.entity_type not null check (corrected_type in ('person','org')),
  recorded_by text not null check (length(trim(recorded_by)) > 0),
  recorded_at timestamptz not null default now(),
  reason text not null check (length(trim(reason)) > 0),
  rule text not null check (length(trim(rule)) > 0),
  evidence jsonb not null default '{}',
  request_key text not null unique check (length(trim(request_key)) > 0),
  reversed_at timestamptz,
  reversed_by text,
  reversal_reason text,
  check (original_type <> corrected_type),
  check ((reversed_at is null and reversed_by is null and reversal_reason is null) or
    (reversed_at is not null and reversed_by is not null and reversal_reason is not null and length(trim(reversed_by)) > 0 and length(trim(reversal_reason)) > 0))
);
create unique index entity_type_one_active on identity.entity_type_correction(entity_id) where reversed_at is null;

-- Materialize the effective type so every identity reader (including raw SQL, W3 and
-- exports) agrees. A source translator cannot overwrite a local decision.
create function identity.preserve_entity_type_correction() returns trigger language plpgsql as $$
declare corrected identity.entity_type;
begin
  select corrected_type into corrected from identity.entity_type_correction
    where entity_id=new.entity_id and reversed_at is null;
  if found then new.entity_type := corrected; end if;
  return new;
end
$$;
create trigger preserve_entity_type_correction before update of entity_type on identity.entity
  for each row execute function identity.preserve_entity_type_correction();
