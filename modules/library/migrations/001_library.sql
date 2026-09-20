-- library: approved answers, with their own versioning and approval state.
--
-- The distinction that makes this worth a table: an answer is approved separately from the
-- documents it cites. A source document can change while the answer stays approved — which
-- is wrong — so the answer carries its own lineage and gets flagged, exactly like a content
-- variant does.

create schema if not exists library;

create type library.answer_status as enum ('draft', 'approved', 'needs_review', 'superseded', 'withdrawn');

create table library.answer (
  answer_id    uuid primary key default gen_random_uuid(),
  -- The canonical form of the question, not the wording any one person used.
  question     text not null,
  answer       text not null,
  version      int not null default 1,
  status       library.answer_status not null default 'draft',
  -- Its own approval, separate from anything it cites.
  approved_by  uuid references platform.app_user(id),
  approved_on  date,
  -- Answers go stale on a date as well as on a fact. Both are recorded.
  expires_on   date,
  supersedes   uuid references library.answer(answer_id),
  owner_id     uuid not null references platform.app_user(id),
  created_at   timestamptz not null default now()
);

create index answer_status_idx on library.answer (status);

-- What the answer rests on. Either a claim (with its provenance tuple) or a source
-- document directly.
create table library.answer_source (
  answer_id  uuid not null references library.answer(answer_id),
  claim_id   uuid references research.claim(claim_id),
  doc_id     text references research.source_doc(doc_id),
  note       text,
  check (claim_id is not null or doc_id is not null)
);

create index answer_source_idx on library.answer_source (answer_id);

-- Where an answer has actually been used. This is what makes "the same question keeps
-- coming up" a number rather than an impression.
create table library.answer_use (
  use_id       uuid primary key default gen_random_uuid(),
  answer_id    uuid not null references library.answer(answer_id),
  context      text not null,
  entity_id    uuid references identity.entity(entity_id),
  used_on      date not null,
  used_by      uuid references platform.app_user(id)
);
