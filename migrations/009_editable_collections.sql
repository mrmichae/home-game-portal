ALTER TABLE custom_collections RENAME TO collections;
ALTER TABLE custom_collection_games RENAME TO collection_games;

DROP INDEX IF EXISTS custom_collection_games_order;
CREATE INDEX IF NOT EXISTS collection_games_order
  ON collection_games(collection_id, position);

CREATE TABLE IF NOT EXISTS presentation_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  collections_materialized INTEGER NOT NULL DEFAULT 0 CHECK (collections_materialized IN (0, 1))
);

INSERT OR IGNORE INTO presentation_state(id, collections_materialized)
VALUES (1, 0);
