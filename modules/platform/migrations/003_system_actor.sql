-- The actor for proposals nobody typed (N57). After each translation, reconciliation compares
-- what the records on file support with what the ladder has accepted, and where the records are
-- ahead it opens a STAGE ticket for a person to approve (docs/18). The ticket has to say who
-- asked. That is this row, never the person who approves, and never an agent approving itself.
--
-- Inactive: it is not in the user switcher, and nobody can act as it.
--
-- Append-only: 001 and 002 are applied in the real database and cannot change.

insert into platform.app_user (handle, name, initials, role, email, active)
values ('reconciliation', 'Reconciliation', 'RC', 'system', '', false)
on conflict (handle) do nothing;
