-- The comms trace (Juan, 5 Oct 2026; docs/27-outreach-api.md §5–§6). "as much as possible we should record
-- all this stuff from events directly in email and let email be the state ... let the actual comms trace
-- reveal what happened".
--
-- 1. email.comms_message: the messages juanmail sees in a team mailbox, sent and received, as metadata —
--    Message-ID, Gmail ids, date, addresses, subject, direction. Never a body. One row per message: the
--    Message-ID is the key, so the same message reported from two mailboxes, or twice, is one row
--    (`comms_ingest` is idempotent by it). A message without one is keyed `gmail:<id>` and has_message_id
--    is false. entity_ids are the people (and their current firms) its outside addresses belong to, read
--    when it was ingested; about* is the Affinity rule (N59) read from its subject and addresses.
--    Nothing else is written: no touchpoint, status, rung or ticket. The LP's timeline and the queue merge
--    these with Affinity's records when they are read (lib/comms/trace.ts).
-- 2. email.message_link: what juanmail linked after it sent or read a message (`outreach_link_message`,
--    formerly outreach_record_send): the same metadata, the pursuit, and the agent ticket it used, if any.
--    An action logged, not outreach state: the trace is the state, and the LP page flags a link the trace
--    has not shown. A body only when juanmail sent one explicitly.
--
-- Numbered 020: platform 018/019 belong to the deploy branch, and numbers after 019 are this branch's in
-- every schema (5 Oct 2026). Append-only: 001–004 are applied in the real database and cannot change.

create table email.comms_message (
  message_id      text primary key check (length(message_id) between 3 and 400),
  has_message_id  boolean not null,
  gmail_id        text,
  thread_id       text,
  sent_at         timestamptz not null,
  direction       text not null check (direction in ('ours', 'theirs')),
  from_addr       text not null,
  to_addrs        text[] not null default '{}',
  cc_addrs        text[] not null default '{}',
  subject         text,
  entity_ids      uuid[] not null default '{}',
  -- The LP juanmail said it was about, when it said; its vehicle counts the message for that pursuit.
  pursuit_id      uuid references strategy.pursuit(pursuit_id),
  about           text check (about is null or about in ('raise', 'other')),
  about_vehicles  text[] not null default '{}',
  about_basis     text,
  -- Whose mailbox reported it first, with which token; and every mailbox owner that has reported it.
  mailbox_of      uuid not null references platform.app_user(id),
  token_id        uuid references platform.mcp_token(token_id),
  seen_by         uuid[] not null default '{}',
  ingested_at     timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index comms_message_entities_idx on email.comms_message using gin (entity_ids);
create index comms_message_thread_idx on email.comms_message (thread_id) where thread_id is not null;
create index comms_message_sent_idx on email.comms_message (sent_at desc);
create unique index comms_message_gmail_idx on email.comms_message (gmail_id) where gmail_id is not null and not has_message_id;

create table email.message_link (
  link_id           uuid primary key default gen_random_uuid(),
  message_id        text not null unique check (length(message_id) between 3 and 400),
  gmail_id          text,
  thread_id         text,
  sent_at           timestamptz not null,
  direction         text not null check (direction in ('ours', 'theirs')),
  from_addr         text not null,
  to_addrs          text[] not null default '{}',
  cc_addrs          text[] not null default '{}',
  subject           text,
  body              text,
  pursuit_id        uuid not null references strategy.pursuit(pursuit_id),
  ticket_id         uuid references governance.approval_ticket(id),
  outreach_send_id  uuid references email.outreach_send(send_id),
  autonomous        boolean not null default false,
  linked_by         uuid not null references platform.app_user(id),
  token_id          uuid references platform.mcp_token(token_id),
  linked_at         timestamptz not null default now()
);

create index message_link_pursuit_idx on email.message_link (pursuit_id, sent_at desc);
create unique index message_link_ticket_idx on email.message_link (ticket_id) where ticket_id is not null;
