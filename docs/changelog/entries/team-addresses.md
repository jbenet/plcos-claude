# A person's addresses — a login, a default-to, and aliases · 5 Oct 2026

| | |
|---|---|
| ![Settings → People: each person's addresses with their kind, and the editor open on one of them](docs/changelog/shots/team-addresses/01-people-addresses.webp) | **Settings → People.** Each person's addresses, each with its kind: **login** (their Google sign-in), **default-to** (the one we email them at) and **alias**. Edit addresses sets all three; an address someone else holds is refused. Read-only under the Mac's user switcher. |

Juan, 5 Oct: each team member has several addresses — one they sign in with (usually @plcapital.xyz), one they
mostly use, and others — and "if the login appears in one of the other accounts, would be good to let them in
too". So a person has addresses now, not one email.

**`platform.user_address`** (migration `platform/019_user_addresses.sql`): one login, one default-to, any aliases.
An address belongs to one person, whatever its kind, active or not: a unique index on its lower case across
everyone. A login that is also the default-to is one row. `app_user.email` stays equal to the default-to, kept in
step by two triggers, so every existing reader keeps working. The migration copies each person's email in as
their default-to.

**Sign-in by any address.** Google sign-in admits a verified address that is any address of exactly one active
person; the `hd` rule is unchanged. /setup's first admin and Settings → People match any address too.

**The init file** gains `login` and `aliases` beside `email`, which now means the default-to. Loading makes each
person's addresses exactly the file's. An address on two people in the file, or already someone else's, is a
problem like any other, and nothing is applied: for example, listing alex@example.org as Sam's alias while it is
still Alex's stops the load until it is removed from one of them.

**Mail finds the person through any address.** The comms team map (what `comms_ingest` and the LP mail trace use
to tell ours from theirs), the outreach desk's `confirmedBy`, Linear's member matching (its own address first),
the team labels, Affinity's team matching and email evidence, and the enrichment roster all read every address.
Anything we send a team member still goes to their default-to.

Tests: 6 properties (`scripts/properties/team-addresses.ts`), on PGlite and Postgres: the default-to and
`app_user.email` in step from either side; one owner per address in the database, Add person and Edit addresses;
exact sets and clashes from the init file with nothing applied; mail matched by an alias; sign-in by an alias and
by the login through the real route handlers and a fake Google; People edits audited and refused under the
switcher. Invented addresses only.
