-- Access role is separate from the existing free-text job title (`role`).
create type platform.access_role as enum ('admin', 'gp', 'viewer');
alter table platform.app_user
  add column access platform.access_role not null default 'gp',
  add column vehicles uuid[] default null,
  add column approves text[] not null default '{}';
update platform.app_user set access = 'admin' where handle = 'juan';
-- Inactive automation actors are never privileged roster members.
update platform.app_user set access = 'viewer', vehicles = '{}' where not active;
