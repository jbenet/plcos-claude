-- The mail desk sends; Capital OS records that it did (Juan, 4 Oct 2026: "a tool may send";
-- docs/27-outreach-api.md §4). Capital OS itself still never sends.
--
-- One row per email the desk asked to send: the LP (pursuit), the recipients the approval covers, the
-- material if any, and the SEND ticket that gates it. The ticket's subject is this row (or, with a
-- material, the content.send row, which keeps "wrong-wrap sends = 0" counting every material that
-- leaves). When the desk has sent it through MailGuard it records the send here, once: the Gmail
-- message id and the time. The record refuses unless the ticket is approved, unexpired, for this
-- pursuit, the recipients are within the approval, and the row has not been used.
--
-- Append-only: 001–003 are applied in the real database and cannot change.

create table email.outreach_send (
  send_id          uuid primary key,
  pursuit_id       uuid not null references strategy.pursuit(pursuit_id),
  entity_id        uuid not null references identity.entity(entity_id),
  vehicle_id       uuid not null references platform.vehicle(id),
  purpose          text not null check (purpose in ('invite', 'reply', 'follow_up')),
  -- Lower-cased addresses. The approval covers these and no others.
  recipients       text[] not null check (cardinality(recipients) between 1 and 10),
  asset_id         uuid references content.asset(asset_id),
  content_send_id  uuid references content.send(send_id),
  ticket_id        uuid not null unique references governance.approval_ticket(id),
  -- The person whose desk asked (the token's owner), and the token. The ticket's requester is the
  -- inactive "Mail desk" actor (platform 015), so a person approves what a tool proposed.
  requested_for    uuid not null references platform.app_user(id),
  token_id         uuid references platform.mcp_token(token_id),
  requested_at     timestamptz not null default now(),
  -- The send, recorded once.
  sent_at          timestamptz,
  gmail_message_id text,
  recorded_by      uuid references platform.app_user(id),
  recorded_at      timestamptz,
  touchpoint_id    uuid,
  constraint outreach_send_once check ((sent_at is null) = (gmail_message_id is null) and (sent_at is null) = (recorded_at is null))
);

create unique index outreach_send_gmail_idx on email.outreach_send (gmail_message_id) where gmail_message_id is not null;
create index outreach_send_pursuit_idx on email.outreach_send (pursuit_id, requested_at desc);

-- Idempotency for the desk's writes (docs/27 §3): a request key is used once; a retry with the same key
-- gets the first answer back and changes nothing.
create table email.outreach_request (
  request_key  text primary key check (length(request_key) between 8 and 200),
  op           text not null,
  token_id     uuid references platform.mcp_token(token_id),
  result       jsonb,
  created_at   timestamptz not null default now()
);
