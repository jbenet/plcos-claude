-- Resolve the small role-membership set once, using only the relevant edges.
create index edge_coinvestor_from_idx on network.edge(from_entity) where kind = 'coinvestor';
create index edge_coinvestor_to_idx on network.edge(to_entity) where kind = 'coinvestor';
