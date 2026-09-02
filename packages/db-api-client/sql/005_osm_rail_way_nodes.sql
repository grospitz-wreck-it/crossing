CREATE TABLE IF NOT EXISTS osm_rail_way_nodes (
  railway_way_id INTEGER NOT NULL,
  node_id INTEGER NOT NULL,
  node_index INTEGER NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (railway_way_id, node_id, node_index),
  FOREIGN KEY (railway_way_id) REFERENCES osm_rail_ways(osm_id)
);

CREATE INDEX IF NOT EXISTS idx_osm_rail_way_nodes_node_id
  ON osm_rail_way_nodes (node_id);

CREATE INDEX IF NOT EXISTS idx_osm_rail_way_nodes_way_id
  ON osm_rail_way_nodes (railway_way_id);
