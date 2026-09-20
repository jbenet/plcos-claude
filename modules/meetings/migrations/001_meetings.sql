-- meetings: what was said, what it justifies, and what is still unanswered.
--
-- Modules 10 and 11 share a schema because they are the same material read two ways: the
-- decision room asks "what is still unanswered", and the meeting view asks "what happened
-- and what does it entitle us to claim".

create schema if not exists meetings;

create type meetings.meeting_kind as enum ('intro', 'pitch', 'diligence', 'committee', 'follow_up');

create table meetings.meeting (
  meeting_id      uuid primary key default gen_random_uuid(),
  pursuit_id      uuid references strategy.pursuit(pursuit_id),
  entity_id       uuid not null references identity.entity(entity_id),
  vehicle_id      uuid not null references platform.vehicle(id),
  kind            meetings.meeting_kind not null,
  scheduled_for   timestamptz,
  held_on         date,
  attendees       text[] not null default '{}',
  owner_id        uuid not null references platform.app_user(id),
  summary         text,
  -- The rung this meeting's outcome actually justifies, which is usually lower than the
  -- rung the person who ran it would like to claim. Null means "nothing new".
  justifies_rung  strategy.ladder_rung,
  justification   text,
  created_at      timestamptz not null default now()
);

create index meeting_entity_idx on meetings.meeting (entity_id, held_on desc nulls first);

-- A closed taxonomy. Free-text objections cannot be counted, and an objection you cannot
-- count is one you will keep answering from scratch.
create type meetings.objection_class as enum (
  'team', 'thesis', 'track_record', 'terms', 'timing', 'structure', 'liquidity', 'governance'
);

create type meetings.objection_status as enum ('open', 'answered', 'accepted', 'fatal');

create table meetings.objection (
  objection_id  uuid primary key default gen_random_uuid(),
  meeting_id    uuid references meetings.meeting(meeting_id),
  entity_id     uuid not null references identity.entity(entity_id),
  class         meetings.objection_class not null,
  statement     text not null,
  status        meetings.objection_status not null default 'open',
  answer        text,
  -- What the answer rests on. An answer with no source is an assertion.
  answer_source text,
  answered_by   uuid references platform.app_user(id),
  answered_at   timestamptz,
  created_at    timestamptz not null default now()
);

create type meetings.question_status as enum ('open', 'answered', 'blocked', 'withdrawn');

create table meetings.diligence_question (
  question_id   uuid primary key default gen_random_uuid(),
  entity_id     uuid not null references identity.entity(entity_id),
  vehicle_id    uuid not null references platform.vehicle(id),
  question      text not null,
  asked_on      date,
  due_on        date,
  owner_id      uuid references platform.app_user(id),
  status        meetings.question_status not null default 'open',
  answer        text,
  answer_source text,
  answered_at   timestamptz
);

create index question_entity_idx on meetings.diligence_question (entity_id, status);
