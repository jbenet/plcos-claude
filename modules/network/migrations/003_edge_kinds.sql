-- The kinds of tie the team's own records and the research find (N82).
--
-- Juan, 24 Sep, on "Routes to —": "How do i fix this? you have our names, can you set these
-- connections yourself, or suggest some for me to verify?" No edge existed on the real account, so
-- no route could run. They are built now from two sources (modules/network/build.ts):
--
--   the records   a one-to-one meeting or call held with someone on the team — tier A, "met" — or
--                 a message from them to someone on the team — tier B, "corresponded";
--   the research  the paths W3 found (docs/19), with the tier each was given: a colleague, an
--                 alumni tie, a co-investment, a board, a portfolio company. C and D wait for a
--                 person, as rule 6 says; the planner already refuses to route through them.
--
-- Each edge built this way says so in its evidence ("derived": "records" or "research"), so a
-- rebuild replaces its own and never a person's decision.
--
-- Append-only: 001 and 002 are applied in the real database and cannot change.

alter type network.edge_kind add value if not exists 'met';
alter type network.edge_kind add value if not exists 'corresponded';
alter type network.edge_kind add value if not exists 'alumni';
alter type network.edge_kind add value if not exists 'portfolio';
alter type network.edge_kind add value if not exists 'other';
