CREATE TABLE IF NOT EXISTS message_embeddings (
  message_id TEXT PRIMARY KEY REFERENCES messages(id) ON DELETE CASCADE,
  dimensions INTEGER NOT NULL,
  vector     BLOB NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_embeddings_created ON message_embeddings (created_at);
