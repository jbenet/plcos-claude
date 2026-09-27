-- Linear, read-only (Juan, 27 Sep 2026; docs/24-linear.md). A translation of the raw replica under
-- <real root>/linear/raw: our team's own work items, not claims about anyone. No foreign keys between
-- these tables, because an incremental pull can deliver an issue before the state or project it
-- names. Every row keeps where it came from: source, as_of (Linear's updatedAt), the replica file,
-- and who ran the sync.
create schema linear;

create table linear.team (
  id text primary key,
  key text, name text, created_at timestamptz,
  updated_at timestamptz not null, archived_at timestamptz,
  source text not null default 'linear' check (source = 'linear'),
  replica_file text not null, last_verified_by uuid references platform.app_user(id), synced_at timestamptz not null default now()
);

-- Linear's users. "user" is a reserved word.
create table linear.member (
  id text primary key,
  name text, display_name text, email text, active boolean, created_at timestamptz,
  updated_at timestamptz not null, archived_at timestamptz,
  source text not null default 'linear' check (source = 'linear'),
  replica_file text not null, last_verified_by uuid references platform.app_user(id), synced_at timestamptz not null default now()
);

create table linear.state (
  id text primary key,
  name text, type text, position double precision, team_id text,
  updated_at timestamptz not null, archived_at timestamptz,
  source text not null default 'linear' check (source = 'linear'),
  replica_file text not null, last_verified_by uuid references platform.app_user(id), synced_at timestamptz not null default now()
);

create table linear.label (
  id text primary key,
  name text, is_group boolean, parent_id text, team_id text,
  updated_at timestamptz not null, archived_at timestamptz,
  source text not null default 'linear' check (source = 'linear'),
  replica_file text not null, last_verified_by uuid references platform.app_user(id), synced_at timestamptz not null default now()
);

create table linear.project (
  id text primary key,
  name text, description text, slug_id text, url text, status_name text, status_type text, lead_id text,
  start_date date, target_date date, started_at timestamptz, completed_at timestamptz, canceled_at timestamptz,
  created_at timestamptz, team_ids text[], label_ids text[], health text, priority integer,
  updated_at timestamptz not null, archived_at timestamptz,
  source text not null default 'linear' check (source = 'linear'),
  replica_file text not null, last_verified_by uuid references platform.app_user(id), synced_at timestamptz not null default now()
);

create table linear.milestone (
  id text primary key,
  name text, target_date date, project_id text, sort_order double precision,
  updated_at timestamptz not null, archived_at timestamptz,
  source text not null default 'linear' check (source = 'linear'),
  replica_file text not null, last_verified_by uuid references platform.app_user(id), synced_at timestamptz not null default now()
);

create table linear.cycle (
  id text primary key,
  number integer, name text, starts_at timestamptz, ends_at timestamptz, completed_at timestamptz, team_id text,
  updated_at timestamptz not null, archived_at timestamptz,
  source text not null default 'linear' check (source = 'linear'),
  replica_file text not null, last_verified_by uuid references platform.app_user(id), synced_at timestamptz not null default now()
);

create table linear.issue (
  id text primary key,
  identifier text, title text, description text, url text, priority integer, estimate double precision, due_date date,
  created_at timestamptz, started_at timestamptz, completed_at timestamptz, canceled_at timestamptz,
  state_id text, assignee_id text, creator_id text, team_id text, project_id text, milestone_id text, cycle_id text,
  parent_id text, label_ids text[],
  updated_at timestamptz not null, archived_at timestamptz,
  source text not null default 'linear' check (source = 'linear'),
  replica_file text not null, last_verified_by uuid references platform.app_user(id), synced_at timestamptz not null default now()
);
create index issue_team_idx on linear.issue(team_id);
create index issue_project_idx on linear.issue(project_id);
create index issue_assignee_idx on linear.issue(assignee_id);
create index issue_state_idx on linear.issue(state_id);

create table linear.comment (
  id text primary key,
  body text, issue_id text, user_id text, parent_id text, created_at timestamptz,
  updated_at timestamptz not null, archived_at timestamptz,
  source text not null default 'linear' check (source = 'linear'),
  replica_file text not null, last_verified_by uuid references platform.app_user(id), synced_at timestamptz not null default now()
);
create index comment_issue_idx on linear.comment(issue_id);

-- Each replica file translated, pinned by its hash: a completed file that changes is refused.
create table linear.replica (
  entity text not null,
  file text not null,
  hash text not null,
  records integer not null,
  imported_at timestamptz not null default now(),
  primary key (entity, file)
);
