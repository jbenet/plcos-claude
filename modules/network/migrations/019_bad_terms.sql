-- Issue 0143: two people on bad terms. A tie's warmth says how close two people are, not whether they are
-- friendly; a person marks a pair here, and any route that would ask one of them about the other is excluded,
-- with the reason. Undone, never deleted. Read live on every route read, like restrictions, so no cache trigger.
create table network.bad_terms (
  mark_id     uuid primary key default gen_random_uuid(),
  a_entity    uuid not null references identity.entity(entity_id),
  b_entity    uuid not null references identity.entity(entity_id),
  note        text,
  recorded_by uuid not null references platform.app_user(id),
  recorded_at timestamptz not null default now(),
  undone_by   uuid references platform.app_user(id),
  undone_at   timestamptz,
  check (a_entity < b_entity)
);
create unique index bad_terms_active on network.bad_terms (a_entity, b_entity) where undone_at is null;
create index bad_terms_b on network.bad_terms (b_entity) where undone_at is null;
