-- Email drafts (Juan, 2 Oct 2026; docs/25-email-drafts.md). A person writes an email here — a first
-- message to an LP, an intro ask to a connector, a follow-up — and moves it into their own Gmail
-- Drafts to review and send from there. Nothing here sends.
--
-- A table rather than platform notes (AGENTS.md, promotion rule): the MIME builder and the Gmail
-- client need precise inputs (recipients, Message-ID, thread), and a move must find the Gmail
-- draft it made before.

create schema if not exists email;

create table email.draft (
  draft_id         uuid primary key default gen_random_uuid(),
  owner_id         uuid not null references platform.app_user(id),
  -- What the email is for. 'follow_up' answers an earlier draft of ours in its thread.
  purpose          text not null check (purpose in ('first_message', 'intro_ask', 'follow_up')),
  vehicle_id       uuid not null references platform.vehicle(id),
  pursuit_id       uuid references strategy.pursuit(pursuit_id),
  -- The LP the email is about, and for an intro ask, the connector it goes to.
  entity_id        uuid references identity.entity(entity_id),
  connector_id     uuid references identity.entity(entity_id),
  to_addrs         text[] not null default '{}',
  cc_addrs         text[] not null default '{}',
  bcc_addrs        text[] not null default '{}',
  subject          text not null default '',
  mode             text not null default 'rich' check (mode in ('rich', 'plain')),
  -- The rich body as the editor's document, normalised to the email schema (lib/email/doc.ts).
  doc              jsonb,
  -- The plain body: what was typed in plain mode, or the text rendering of the rich one.
  body_text        text not null default '',
  -- Where the first words came from, when they were filled in for the person (a strategy).
  prefill          jsonb,
  -- Ours, made once with the draft: <uuid@domain>. A new Gmail draft after the old one was sent
  -- or deleted gets a new one, so no two emails share a Message-ID.
  message_id       text not null unique,
  reply_to_draft_id uuid references email.draft(draft_id),
  in_reply_to      text,
  references_ids   text[] not null default '{}',
  status           text not null default 'editing' check (status in ('editing', 'in_gmail', 'discarded')),
  revision         int not null default 1,
  -- The Gmail side, once moved. moved_revision is the revision Gmail holds.
  gmail_account    text,
  gmail_draft_id   text,
  gmail_message_id text,
  gmail_thread_id  text,
  moved_at         timestamptz,
  moved_revision   int,
  -- A move in progress, so a double click cannot make two Gmail drafts.
  moving_since     timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index draft_pursuit_idx on email.draft (pursuit_id, owner_id) where status <> 'discarded';
create index draft_owner_idx on email.draft (owner_id, updated_at desc);

-- Files and pictures. The bytes live outside the database, by their hash (config.email.attachmentsDir);
-- S3 later (docs/25 §Attachment storage).
create table email.attachment (
  attachment_id uuid primary key default gen_random_uuid(),
  draft_id      uuid not null references email.draft(draft_id),
  filename      text not null,
  content_type  text not null,
  size_bytes    int not null check (size_bytes >= 0),
  sha256        text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  -- Shown in the text, as a picture with a Content-ID.
  inline        boolean not null default false,
  content_id    text not null unique,
  removed_at    timestamptz,
  created_by    uuid not null references platform.app_user(id),
  created_at    timestamptz not null default now()
);
create index attachment_draft_idx on email.attachment (draft_id) where removed_at is null;

-- Who has connected which Gmail address. The refresh token is not here: it is in the Keychain on
-- the Mac (docs/25 §Per-user OAuth).
create table email.gmail_account (
  user_id       uuid primary key references platform.app_user(id),
  google_email  text not null,
  scopes        text[] not null,
  connected_at  timestamptz not null default now(),
  last_used_at  timestamptz
);
