-- Persistent node -> railway-way lookup.
--
-- This replaces the need to scan osm_rail_ways.node_ids_json when
-- traversing the railway topology. The importer populates this table
-- whenever a railway way is imported.

CREATE TABLE IF NOT EXISTS osm_rail_way_nodes (
  node_id INTEGER NOT NULL,
  railway_way_id INTEGER NOT NULL,
  node_index INTEGER NOT NULL,
  PRIMARY KEY (node_id, railway_way_id),
  FOREIGN KEY (railway_way_id) REFERENCES osm_rail_ways(osm_id)
);

CREATE INDEX IF NOT EXISTS idx_osm_rail_way_nodes_node
  ON osm_rail_way_nodes(node_id);

CREATE INDEX IF NOT EXISTS idx_osm_rail_way_nodes_way
  ON osm_rail_way_nodes(railway_way_id);
