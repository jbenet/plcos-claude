-- The mail desk's outreach API (docs/27-outreach-api.md), 4 Oct 2026.
--
-- 1. The actor that asks for approval when the desk opens a SEND or INTRO_ASK ticket. The ticket has
--    to say who asked, and it must not be the person who approves: the desk proposes, a person
--    accepts (AGENTS.md, "no tool accepts its own proposed task"). Like Reconciliation (003), it is
--    inactive: not in the user switcher, and nobody can act as it or decide a ticket as it. The
--    token and its owner behind each request are in the ticket's basis and the audit log.
-- 2. Where a token was last used from — the client's User-Agent, cut short — so Preferences can show
--    which device is behind each token (Juan, 4 Oct: "will run in my devices probably").
--
-- Append-only: 001–014 are applied in the real database and cannot change.

insert into platform.app_user (handle, name, initials, role, email, active)
values ('mail-desk', 'Mail desk', 'MD', 'system', '', false)
on conflict (handle) do nothing;

alter table platform.mcp_token add column last_used_from text;
