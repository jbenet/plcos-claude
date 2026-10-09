-- What the mail says about the people in it (Juan, 9 Oct 2026: "develop some workflows or actions to run on top
-- all the mail my new mail client reads"; docs/29-mail-actions.md). juanmail reads a thread and reports, per
-- message, short signals about each person or firm in it, by the role they play in that thread (an LP, a
-- connector, someone else): interest, a soft commitment or an indicated amount, a question, an objection, a
-- decline, timing, a request for materials or a meeting, a referral, an offer to introduce. Capital OS keeps them
-- with the message they came from, shows them beside the LP, suggests the update box's boxes from them, and sums
-- them per vehicle so strategy can learn from what LPs ask and object to.
--
-- A signal is a reading of words, not a record of an act: it moves no status, rung, money or ticket. The words
-- are the reader's summary (and at most a short quote), never the message body. One row per message, entity,
-- kind and pursuit: reporting the same message again replaces the reading (idempotent).
--
-- Promoted from research.note at birth (AGENTS.md, promotion rule: "a tool needs a precise input"): the desk's
-- tool keys it by message, and the per-vehicle sums filter it by kind and topic.
--
-- Append-only: 001–021 are applied in the real database and cannot change.

create table email.mail_signal (
  signal_id     uuid primary key default gen_random_uuid(),
  message_id    text not null check (length(message_id) between 3 and 400),
  thread_id     text,
  sent_at       timestamptz not null,
  direction     text not null check (direction in ('ours', 'theirs')),
  entity_id     uuid not null references identity.entity(entity_id),
  -- The LP on one vehicle it is about, when there is one: a connector's signal may name none.
  pursuit_id    uuid references strategy.pursuit(pursuit_id),
  -- Who may read it: the vehicles of the pursuit, or the entity's vehicles the writer could change (R2 words).
  vehicle_ids   uuid[] not null default '{}',
  role          text not null check (role in ('lp', 'connector', 'other')),
  kind          text not null check (kind in ('interest', 'soft_commit', 'indication', 'question', 'objection', 'decline',
                                             'timing', 'materials_request', 'meeting_request', 'referral', 'intro_offer', 'other')),
  topic         text check (topic is null or length(topic) between 1 and 60),
  summary       text not null check (length(summary) between 1 and 500),
  quote         text check (quote is null or length(quote) <= 300),
  amount_low    numeric check (amount_low is null or amount_low >= 0),
  amount_high   numeric check (amount_high is null or amount_high >= amount_low),
  follow_up_on  date,
  confidence    research.confidence not null,
  -- Who read it: the desk's reader ("rules", or a model's name), for correction and cost tracking.
  read_by       text not null check (length(read_by) between 1 and 80),
  owner_id      uuid not null references platform.app_user(id),
  token_id      uuid references platform.mcp_token(token_id),
  -- A person said this reading is wrong: kept, not shown, not counted.
  dismissed_at  timestamptz,
  dismissed_by  uuid references platform.app_user(id),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create unique index mail_signal_key_idx on email.mail_signal (message_id, entity_id, kind, coalesce(pursuit_id, '00000000-0000-0000-0000-000000000000'::uuid));
create index mail_signal_entity_idx on email.mail_signal (entity_id, sent_at desc);
create index mail_signal_pursuit_idx on email.mail_signal (pursuit_id, sent_at desc) where pursuit_id is not null;
create index mail_signal_vehicles_idx on email.mail_signal using gin (vehicle_ids);
