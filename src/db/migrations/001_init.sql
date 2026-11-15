CREATE TABLE IF NOT EXISTS conversations (
  id         TEXT PRIMARY KEY,
  title      TEXT,
  tz         TEXT NOT NULL DEFAULT 'UTC',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS messages (
  rid             INTEGER PRIMARY KEY AUTOINCREMENT,
  id              TEXT NOT NULL UNIQUE,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  seq             INTEGER NOT NULL,
  role            TEXT NOT NULL CHECK (role IN ('user','assistant')),
  content         TEXT NOT NULL,
  created_at      INTEGER NOT NULL,
  status          TEXT NOT NULL DEFAULT 'complete' CHECK (status IN ('complete','aborted','error')),
  evidence        TEXT,
  meta            TEXT NOT NULL DEFAULT '{}',
  imported        INTEGER NOT NULL DEFAULT 0,
  demo            INTEGER NOT NULL DEFAULT 0,
  UNIQUE (conversation_id, seq)
);

CREATE INDEX IF NOT EXISTS idx_messages_time      ON messages (created_at);
CREATE INDEX IF NOT EXISTS idx_messages_conv_time ON messages (conversation_id, created_at);

CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
  content,
  content = 'messages',
  content_rowid = 'rid',
  tokenize = 'porter unicode61 remove_diacritics 2'
);

CREATE TRIGGER IF NOT EXISTS messages_ai AFTER INSERT ON messages BEGIN
  INSERT INTO messages_fts (rowid, content) VALUES (new.rid, new.content);
END;

CREATE TRIGGER IF NOT EXISTS messages_ad AFTER DELETE ON messages BEGIN
  INSERT INTO messages_fts (messages_fts, rowid, content) VALUES ('delete', old.rid, old.content);
END;

CREATE TRIGGER IF NOT EXISTS messages_au AFTER UPDATE OF content ON messages BEGIN
  INSERT INTO messages_fts (messages_fts, rowid, content) VALUES ('delete', old.rid, old.content);
  INSERT INTO messages_fts (rowid, content) VALUES (new.rid, new.content);
END;

