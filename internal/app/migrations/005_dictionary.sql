ALTER TABLE messages ADD COLUMN word_explanation TEXT NOT NULL DEFAULT 'null';

CREATE TABLE dictionary_entries (
 id TEXT PRIMARY KEY,
 word_key TEXT NOT NULL UNIQUE,
 word TEXT NOT NULL,
 meaning TEXT NOT NULL,
 example TEXT NOT NULL,
 first_asked_at TEXT NOT NULL,
 last_asked_at TEXT NOT NULL
);
CREATE INDEX dictionary_recent ON dictionary_entries(last_asked_at DESC, id);
