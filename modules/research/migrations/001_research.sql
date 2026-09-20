-- research: what we believe about an entity, and why.
--
-- Rule 9 from CLAUDE.md is the whole point of this schema: every externally-sourced field
-- carries (source, as_of, confidence, last_verified_by), and anything that cannot show
-- them refuses to make the claim rather than showing it bare.

create schema if not exists research;

create type research.confidence as enum ('high', 'medium', 'low');

-- How much weight a document can carry. A conference attendee list and a countersigned
-- letter are not the same kind of thing and the schema should not pretend otherwise.
create type research.doc_strength as enum ('strong', 'moderate', 'weak');

create table research.source_doc (
  doc_id     text primary key,
  title      text not null,
  kind       text not null,
  origin     text not null,
  as_of      date not null,
  strength   research.doc_strength not null,
  -- What this document can and cannot be used to support. Written once, read everywhere.
  supports   text not null,
  body       text not null
);

create table research.claim (
  claim_id          uuid primary key default gen_random_uuid(),
  entity_id         uuid not null references identity.entity(entity_id),
  field             text not null,
  value             text not null,
  -- the provenance tuple
  source            text not null references research.source_doc(doc_id),
  as_of             date not null,
  confidence        research.confidence not null,
  last_verified_by  uuid references platform.app_user(id),
  last_verified_at  timestamptz,
  -- Supersession rather than update: what we used to believe stays legible.
  superseded_by     uuid references research.claim(claim_id),
  created_at        timestamptz not null default now()
);

create index claim_entity_idx on research.claim (entity_id, field);

-- The promotion rule (see modules/research/README.md). Anything not yet worth a migration
-- lives here. Promote to real columns when users repeatedly need to filter it, a mistake
-- recurs, a tool needs a precise input, or performance becomes a demonstrated problem.
create table research.note (
  note_id     uuid primary key default gen_random_uuid(),
  entity_id   uuid references identity.entity(entity_id),
  author_id   uuid references platform.app_user(id),
  kind        text not null default 'note',
  body        text not null,
  tags        text[] not null default '{}',
  -- Free-form until it earns a column.
  data        jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);

create index note_entity_idx on research.note (entity_id, kind);

-- A cache exists for latency and quota. It has no persistence guarantee and may be
-- dropped at any time. Never read it to answer "what did we see in June".
create table research.read_cache (
  source      text not null,
  source_id   text not null,
  payload     jsonb not null,
  fetched_at  timestamptz not null default now(),
  expires_at  timestamptz,
  primary key (source, source_id)
);

-- A snapshot exists to explain a historical output. It is explicitly not today's truth,
-- and the UI labels it as non-authoritative wherever it appears.
create table research.snapshot (
  snapshot_id  uuid primary key default gen_random_uuid(),
  source       text not null,
  source_id    text not null,
  payload      jsonb not null,
  taken_at     timestamptz not null default now(),
  -- What output this copy exists to explain. A snapshot with no reason is a cache.
  taken_for    text not null,
  note         text
);
