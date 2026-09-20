-- agents: the authorization unit is the run, not the agent.
--
-- Every run is bounded by a work envelope. A child envelope may narrow its parent and may
-- never widen it. Each tool call is checked against the envelope and recorded — including
-- the refusals, because an agent log that only contains what was permitted cannot answer
-- the question anyone actually asks.

create schema if not exists agents;

create table agents.envelope (
  envelope_id          uuid primary key default gen_random_uuid(),
  task                 text not null,
  scope                text not null,
  allowed_evidence     text[] not null,
  allowed_commands     text[] not null,
  budget               jsonb not null,
  deadline             timestamptz,
  output_schema        text not null,
  acceptance_criteria  text[] not null,
  escalation_owner     uuid not null references platform.app_user(id),
  -- Delegation cannot increase permission. Enforced in the service, recorded here.
  parent_envelope      uuid references agents.envelope(envelope_id),
  created_by           uuid not null references platform.app_user(id),
  created_at           timestamptz not null default now()
);

create type agents.run_status as enum ('proposed', 'refused', 'unavailable', 'accepted', 'rejected');

create table agents.run (
  run_id          uuid primary key default gen_random_uuid(),
  envelope_id     uuid not null references agents.envelope(envelope_id),
  status          agents.run_status not null,
  -- Pinned at run time. Editing a prompt file must not retroactively change what a
  -- completed run meant.
  config_hash     text not null,
  config_snapshot jsonb not null,
  input_hash      text not null,
  prompt_hash     text not null,
  agent_kind      text not null,
  output          jsonb,
  rationale       text,
  started_at      timestamptz not null default now(),
  finished_at     timestamptz
);

create index run_recent_idx on agents.run (started_at desc);

create table agents.tool_call (
  call_id  uuid primary key default gen_random_uuid(),
  run_id   uuid not null references agents.run(run_id),
  tool     text not null,
  allowed  boolean not null,
  refusal  text,
  at       timestamptz not null default now()
);

-- Acceptance is a human act. The key makes a double click idempotent; the unique index is
-- what actually enforces it.
create table agents.acceptance (
  run_id           uuid primary key references agents.run(run_id),
  idempotency_key  text not null unique,
  accepted_by      uuid not null references platform.app_user(id),
  accepted_at      timestamptz not null default now(),
  note             text
);

-- Correction burden. The circuit breaker reads this, so it has to be recorded by the
-- people doing the correcting rather than inferred.
create table agents.correction (
  correction_id  uuid primary key default gen_random_uuid(),
  run_id         uuid references agents.run(run_id),
  minutes        int not null check (minutes > 0),
  recorded_by    uuid not null references platform.app_user(id),
  at             timestamptz not null default now(),
  note           text not null
);

-- The protected set. The agent cannot modify its own pass criteria, which is why these
-- live in a table it has no command to write and the expectations are asserted in code.
create table agents.eval_case (
  case_id      uuid primary key default gen_random_uuid(),
  name         text not null unique,
  input        jsonb not null,
  expectation  text not null,
  -- Added from a real failure rather than invented. A fixed set overfits.
  from_failure text,
  protected    boolean not null default true,
  added_at     timestamptz not null default now()
);

create table agents.eval_result (
  result_id    uuid primary key default gen_random_uuid(),
  case_id      uuid not null references agents.eval_case(case_id),
  prompt_hash  text not null,
  passed       boolean not null,
  detail       text not null,
  at           timestamptz not null default now()
);
