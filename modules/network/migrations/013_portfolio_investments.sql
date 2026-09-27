-- 0079: each disclosed investment keeps its own source; warehouse classifications stay explicit.
alter table network.portfolio
  add column investments jsonb not null default '[]' check (jsonb_typeof(investments) = 'array'),
  add column portfolio_status text;
