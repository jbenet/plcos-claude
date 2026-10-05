-- One message, several LPs (juanmail's third round, 5 Oct 2026; docs/27-outreach-api.md §5). An intro ask to a
-- connector can name three of our LPs; `outreach_link_message` with `pursuitIds` links that one message to each of
-- them, all or none, in one transaction. A link was one row per message (message_id unique); it is now one row per
-- message and LP. Tickets are unchanged: a row carries at most the one agent ticket it used, a ticket is used by one row
-- only (message_link_ticket_idx), and one Gmail message by one SEND ticket (email 004). A link to several LPs is a
-- person's and uses no ticket; an autonomous send about several LPs is refused in code.
--
-- Append-only: 020 is applied in the real database and cannot change.

alter table email.message_link drop constraint message_link_message_id_key;
-- Also the lookup by message: its leading column.
create unique index message_link_message_pursuit_idx on email.message_link (message_id, pursuit_id);
