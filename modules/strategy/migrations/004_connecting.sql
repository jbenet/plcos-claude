-- A seventh status, between Selected and Discussing (N60). Juan, 24 Sep: "maybe let's add
-- 'connecting' (finding connectors, reaching out) in between 'selected' and 'discussing'."
--
-- Selected is the decision to approach. Connecting is the approach under way: looking for a
-- connector, asking one for an introduction, writing to them, waiting on a first reply.
-- Discussing starts when they engage. Like every status, it is our plan and claims nothing
-- about the LP; it moves no rung.
--
-- Append-only: 001 to 003 are applied in the real database and cannot change.

alter type strategy.pursuit_status add value if not exists 'connecting' before 'discussing';
