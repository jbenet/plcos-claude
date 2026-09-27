-- Explicit employment claims, distinct from person-to-person colleague ties.
alter type network.edge_kind add value if not exists 'employment';
