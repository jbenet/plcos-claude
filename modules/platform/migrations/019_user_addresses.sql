-- A person's addresses (Juan, 5 Oct 2026): one login (the Google sign-in), one default-to (the one they mostly
-- use, and the one we email them at), and any number of aliases. Sign-in accepts any of them, and mail is
-- matched to the person through any of them.
--
-- An address belongs to one person, whatever its kind and whether they are active: a unique index on its lower
-- case across everyone. So a login that is also the default-to is one row, kind 'default' (the login is then the
-- default); a person has at most one login row and one default row.
--
-- platform.app_user.email stays equal to the default address, so every existing reader keeps working. Two
-- triggers keep them in step, each skipping when the other one called it (pg_trigger_depth): writing
-- app_user.email makes that address the default row (unless someone else holds it: then they keep it, and the
-- write paths that matter refuse it before it gets here); writing or removing the default row writes
-- app_user.email.
create table platform.user_address (
  user_id     uuid not null references platform.app_user(id) on delete cascade,
  address     text not null check (address = btrim(address) and address ~ '^[^\s@]+@[^\s@]+$' and length(address) <= 254),
  kind        text not null check (kind in ('login', 'default', 'alias')),
  created_at  timestamptz not null default now()
);
create unique index user_address_address_idx on platform.user_address (lower(address));
create unique index user_address_one_login_idx on platform.user_address (user_id) where kind = 'login';
create unique index user_address_one_default_idx on platform.user_address (user_id) where kind = 'default';
create index user_address_user_idx on platform.user_address (user_id);

-- Backfill: each person's email as their default. Should two people share one (an old inactive row beside an
-- active one), the active, then the oldest, keeps it; the other keeps the address in app_user.email only.
insert into platform.user_address (user_id, address, kind)
select distinct on (lower(btrim(email))) id, btrim(email), 'default'
  from platform.app_user
 where btrim(email) <> '' and btrim(email) ~ '^[^\s@]+@[^\s@]+$'
 order by lower(btrim(email)), active desc, created_at, id;

create function platform.app_user_email_to_address() returns trigger
language plpgsql as $$
declare
  addr text := btrim(coalesce(new.email, ''));
  owner uuid;
begin
  if pg_trigger_depth() > 1 then return null; end if;
  if tg_op = 'UPDATE' and lower(btrim(coalesce(old.email, ''))) = lower(addr) then return null; end if;
  delete from platform.user_address where user_id = new.id and kind = 'default';
  if addr = '' then return null; end if;
  select user_id into owner from platform.user_address where lower(address) = lower(addr);
  -- Someone else holds it: they keep it. This row keeps the address in app_user.email only, as the backfill
  -- does for a duplicate; the app's own paths (Settings → People, the init file, /setup) refuse it first.
  if owner is not null and owner <> new.id then return null; end if;
  if owner = new.id then
    update platform.user_address set kind = 'default', address = addr where user_id = new.id and lower(address) = lower(addr);
  else
    insert into platform.user_address (user_id, address, kind) values (new.id, addr, 'default');
  end if;
  return null;
end;
$$;

create trigger app_user_email_address
after insert or update of email on platform.app_user
for each row execute function platform.app_user_email_to_address();

create function platform.default_address_to_app_user() returns trigger
language plpgsql as $$
begin
  if pg_trigger_depth() > 1 then return null; end if;
  if tg_op in ('UPDATE', 'DELETE') and old.kind = 'default' then
    update platform.app_user set email = '' where id = old.user_id
      and not exists (select 1 from platform.user_address where user_id = old.user_id and kind = 'default');
  end if;
  if tg_op in ('INSERT', 'UPDATE') and new.kind = 'default' then
    update platform.app_user set email = new.address where id = new.user_id and email is distinct from new.address;
  end if;
  return null;
end;
$$;

create trigger user_address_default_email
after insert or update or delete on platform.user_address
for each row execute function platform.default_address_to_app_user();
