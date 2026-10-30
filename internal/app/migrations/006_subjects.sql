ALTER TABLE conversations ADD COLUMN subject TEXT NOT NULL DEFAULT 'italian' CHECK(subject IN ('italian','english'));

ALTER TABLE dictionary_entries RENAME TO dictionary_entries_old;
CREATE TABLE dictionary_entries (
 id TEXT PRIMARY KEY,
 subject TEXT NOT NULL DEFAULT 'italian' CHECK(subject IN ('italian','english')),
 word_key TEXT NOT NULL,
 word TEXT NOT NULL,
 meaning TEXT NOT NULL,
 example TEXT NOT NULL,
 example_translation TEXT NOT NULL DEFAULT '',
 first_asked_at TEXT NOT NULL,
 last_asked_at TEXT NOT NULL,
 UNIQUE(subject,word_key)
);
INSERT INTO dictionary_entries(id,word_key,word,meaning,example,first_asked_at,last_asked_at)
 SELECT id,word_key,word,meaning,example,first_asked_at,last_asked_at FROM dictionary_entries_old;
DROP TABLE dictionary_entries_old;
CREATE INDEX dictionary_recent ON dictionary_entries(last_asked_at DESC,id);
