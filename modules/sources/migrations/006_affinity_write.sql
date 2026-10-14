-- Affinity writes (Juan, 14 Oct 2026): people Juan emailed who are missing from Affinity, and a note of the mail
-- Affinity's own sync did not capture. JuanMail proposes items; they gather in the one open batch; a person approves
-- the batch in Approvals, and only then does lib/connectors/affinity/write.ts create anything.
create table sources.affinity_write_batch (
  batch_id    uuid primary key default gen_random_uuid(),
  status      text not null default 'open' check (status in ('open', 'decided')),
  opened_at   timestamptz not null default now(),
  decided_by  uuid references platform.app_user(id),
  decided_at  timestamptz,
  finished_at timestamptz
);
-- One open batch at a time: every proposal joins it until someone decides it.
create unique index affinity_write_batch_one_open on sources.affinity_write_batch ((true)) where status = 'open';

create table sources.affinity_write_item (
  item_id            uuid primary key default gen_random_uuid(),
  batch_id           uuid not null references sources.affinity_write_batch(batch_id),
  address            text not null,
  name               text,
  firm               text,
  -- [{at, subject?, gmailThreadId?}]: what the note records. Mail metadata only, never a body.
  messages           jsonb not null default '[]'::jsonb,
  plan               text not null check (plan in ('person+note', 'note', 'skip')),
  reason             text not null,
  -- The person in our copy of Affinity, when the plan is a note on someone already there.
  affinity_person_id bigint,
  state              text not null default 'proposed' check (state in ('proposed', 'approved', 'skipped', 'rejected', 'written', 'failed')),
  created_person_id  bigint,
  affinity_note_id   bigint,
  error              text,
  proposed_by        uuid not null references platform.app_user(id),
  token_id           text,
  proposed_at        timestamptz not null default now(),
  written_at         timestamptz,
  unique (batch_id, address)
);
create index affinity_write_item_address on sources.affinity_write_item (address);
