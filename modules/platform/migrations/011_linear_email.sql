-- The address a team member signs in to Linear with, when it differs from their email (Juan,
-- 27 Sep 2026; docs/24-linear.md). Optional: `linearEmail` in the init file's team roster, like
-- `affinityEmail`. Matching a Linear member reads it first, then `email`.
alter table platform.app_user add column linear_email text;
