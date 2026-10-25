CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE conversations (
 id TEXT PRIMARY KEY, title TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE messages (
 seq INTEGER PRIMARY KEY AUTOINCREMENT,
 id TEXT NOT NULL UNIQUE,
 conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
 request_id TEXT NOT NULL,
 role TEXT NOT NULL CHECK(role IN ('user','assistant')),
 text TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('streaming','completed','interrupted','failed')),
 created_at TEXT NOT NULL,
 UNIQUE(conversation_id,request_id,role)
);
CREATE INDEX messages_conversation ON messages(conversation_id,seq);
CREATE TABLE sessions (
 token_hash TEXT PRIMARY KEY, csrf TEXT NOT NULL, expires_at INTEGER NOT NULL, password_version TEXT NOT NULL
);
