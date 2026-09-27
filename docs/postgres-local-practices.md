# Running Postgres locally for one project

These are the practices one project uses on a shared Mac (27 Sep 2026). They're written so another project can
follow them: each project gets its own isolated, password-protected cluster, and no project can touch another's
data by accident.

## 1. One cluster per project, in the project's own data folder

- **Its own data directory**, under the project's data folder and **outside git**, for example
  `<project-data>/postgres`. Never use Homebrew's default cluster (`/opt/homebrew/var/postgresql@17`), and never
  share one cluster between projects.
- **Create it with a real locale.** Without `LC_ALL`, Postgres on macOS can refuse to start with "postmaster
  became multithreaded during startup".
  ```bash
  export LC_ALL=en_US.UTF-8 LANG=en_US.UTF-8
  /opt/homebrew/opt/postgresql@17/bin/initdb -D <project-data>/postgres -U <admin-role> -E UTF8 --locale=en_US.UTF-8 --auth=scram-sha-256 --pwprompt
  ```

## 2. Its own port, and not a common one

- **Avoid the usual ports:** 5432 is the default, 5433 is the usual second server, and 54321–54322 are taken by
  Supabase. Pick something distinctive per project (this project uses 57433) and write it down in the project's
  docs.
- **Before choosing, check it's free:** `lsof -nP -iTCP:<port> -sTCP:LISTEN`.

## 3. Loopback only, and a socket inside its own folder

In `<data dir>/postgresql.conf`:
```
listen_addresses = '127.0.0.1'
port = <your port>
unix_socket_directories = '<absolute path to the data dir>'
password_encryption = 'scram-sha-256'
```
The socket then lives in the project's folder rather than `/tmp`, so two projects' sockets can never collide.

## 4. Passwords on every connection (no trust auth)

`<data dir>/pg_hba.conf`:
```
local   all   all                  scram-sha-256
host    all   all   127.0.0.1/32   scram-sha-256
host    all   all   ::1/128        scram-sha-256
```
After editing, reload with `pg_ctl -D <data dir> reload`. Changing the port or socket folder needs a restart.

## 5. Separate roles; only the app writes

| Role | Rights | Used by |
|---|---|---|
| `<proj>_app` | Owns the database and all its schemas; not a superuser | The app |
| `<proj>_ro` | `SELECT` on everything, including future tables and sequences | Scripts, agents, reports, backups |
| `<admin>` | Superuser (the `initdb` role) | By hand only |

Grant the read-only role:
```sql
alter database <db> owner to <proj>_app;
grant connect on database <db> to <proj>_ro;
-- for each schema s:
grant usage on schema s to <proj>_ro;
grant select on all tables in schema s to <proj>_ro;
grant select on all sequences in schema s to <proj>_ro;
alter default privileges for role <proj>_app in schema s grant select on tables to <proj>_ro;
alter default privileges for role <proj>_app in schema s grant select on sequences to <proj>_ro;
revoke create on schema public from public;
```
Default privileges don't cover **new schemas**. The migration that creates a schema must grant the read-only role
usage on it.

## 6. Passwords in the Keychain, never in files

- **Store them:**
  `security add-generic-password -s <proj>-postgres -a app|ro|admin -w "$(openssl rand -hex 24)"`.
- **The connection URL names the role but no password**, for example
  `postgres://<proj>_app@127.0.0.1:<port>/<db>`. Keep it in a small file in the data folder.
- **The launcher adds the password** at start:
  `PGPASSWORD="$(security find-generic-password -s <proj>-postgres -a app -w)"`. Every Postgres client reads
  `PGPASSWORD`.
- **Never put a password on a command line, in a log, in `.env` files committed to git, or in `~/.pgpass`.**

## 7. Start and stop with the project, not the machine

- **No login item and no `brew services`.** The database runs only while you're developing that project.
- **Explicit scripts:**
  - `npm run dev:start` starts the cluster if it's down;
  - `npm run dev:stop` stops the app and then the cluster;
  - `npm run dev:status` shows what's running.
- **Restarting the app never stops the database.** The app's own launcher may *start* Postgres if it's down, but
  it never stops it.
- **Use `pg_ctl -D <data dir> status | start -w | stop -m fast`.** They work on the folder and need no password.

## 8. Timeouts: short for pages, long for jobs

- **Web requests get tight limits**, for example `statement_timeout = 20s` and
  `idle_in_transaction_session_timeout = 60s`, set on the app's connection pool. A stuck request can't hold locks.
- **Background jobs** (imports, merges) that compute between statements inside one transaction **need their own
  limits:** no statement limit and a long idle-in-transaction limit (we use 30 min). Otherwise Postgres kills
  their connection partway through. Set these on the job process's own pool, or with `SET LOCAL` at the start of
  the job's transaction.
- **Run heavy jobs in a separate process**, so pages keep answering while the job writes.

## 9. Backups

- **Dump with the read-only role:** `pg_dump -Fc` as `<proj>_ro`. The dump is consistent by construction.
- **Check it before keeping it:** `pg_restore --list <file> | grep -c 'TABLE DATA'` should count your tables.
- **Encrypt while packing**, so no plain archive is ever written, e.g. `tar | gzip | gpg --symmetric AES256`. Keep
  the passphrase in the Keychain and a copy in your password manager.
- **Schedule and thin them:** daily, plus before and after big changes; keep fewer the older they get, under a
  size cap. Store outside every repository.

## 10. Test and rehearse on separate databases

- **Tests get their own cluster** (another port and folder), with invented data only and no real data.
- **Big changes (moving data in, bulk migrations) are rehearsed first** on a disposable database copied from a
  backup, verified table by table (row counts plus checksums), and only then run on the real one.
- **Keep a rollback** until the change has run cleanly for a while: the previous database, untouched, plus a
  backup taken just before.

## Checklist for a new project

- [ ] Own data dir outside git; `initdb` with `LC_ALL` set and SCRAM auth
- [ ] Distinctive port (checked free); loopback only; socket in the data dir
- [ ] `pg_hba.conf` requires passwords everywhere
- [ ] Roles app / ro / admin; the app owns the data; ro has read-only grants, including sequences and defaults
- [ ] Passwords in the Keychain; URL file without a password; the launcher sets `PGPASSWORD`
- [ ] `dev:start` / `dev:stop` / `dev:status`; app restarts never stop the database
- [ ] Short foreground timeouts, long job timeouts; heavy jobs in a separate process
- [ ] Encrypted `pg_dump` backups as ro, verified, thinned, stored outside the repository
- [ ] A separate test cluster with invented data; rehearse big changes on a copy
