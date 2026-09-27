-- Bounded neighborhood previews read ordered edge IDs, not the large evidence heap.
-- EXPLAIN on the preview copy showed thousands of bitmap heap reads and per-entity sorts.
create index edge_from_id_idx on network.edge(from_entity, edge_id);
create index edge_to_id_idx on network.edge(to_entity, edge_id);
