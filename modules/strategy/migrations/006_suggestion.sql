-- Suggestions (N64, docs/19): a strategy proposed for an LP by the enrichment workflows (W5) —
-- the angle, the route in, the next action, the ask — for a person to accept or dismiss. Juan,
-- 24 Sep 2026: "you should have gathered a lot of info about all of these LPs… and have good
-- strategies and suggested actions."
--
-- Accepting writes only the pursuit's next step, through setNextStep, with the suggestion named in
-- the audit row. It never sets a status, records a rung, touches money or sends anything. Our plan
-- for an LP, so the confidential plane (strategy), not research.
--
--   data       the strategy as written (lib/enrich/strategy.ts), kept whole so a decision can be
--              read against exactly what was proposed
--   file_hash  the file it came from: importing the same file again changes nothing; a new file
--              withdraws the open proposal it replaces, and leaves decided ones as they were

create table strategy.suggestion (
  suggestion_id  uuid primary key default gen_random_uuid(),
  pursuit_id     uuid not null references strategy.pursuit(pursuit_id),
  kind           text not null default 'strategy' check (kind in ('strategy')),
  body           text not null,
  data           jsonb not null,
  made_by        text not null,
  made_at        timestamptz not null,
  file_hash      text not null,
  status         text not null default 'proposed' check (status in ('proposed', 'accepted', 'dismissed', 'withdrawn')),
  decided_by     uuid references platform.app_user(id),
  decided_at     timestamptz,
  decision_note  text,
  created_at     timestamptz not null default now()
);

create index suggestion_pursuit_idx on strategy.suggestion (pursuit_id, created_at desc);
create unique index suggestion_file_idx on strategy.suggestion (pursuit_id, file_hash);
