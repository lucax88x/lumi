CREATE TABLE conversations_new (
 id TEXT PRIMARY KEY, title TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
 subject TEXT NOT NULL DEFAULT 'italian' CHECK(subject IN ('italian','english','history','geography','science','geometry'))
);
INSERT INTO conversations_new SELECT id,title,created_at,updated_at,subject FROM conversations;
DROP TABLE conversations;
ALTER TABLE conversations_new RENAME TO conversations;
ALTER TABLE messages ADD COLUMN study_clarification TEXT NOT NULL DEFAULT 'null';
ALTER TABLE messages ADD COLUMN learning_visual TEXT NOT NULL DEFAULT 'null';
