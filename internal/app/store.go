package app

import (
	"database/sql"
	"embed"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"time"

	"lumi/internal/api"
	_ "modernc.org/sqlite"
)

//go:embed prompt.txt migrations/*.sql control_migrations/*.sql
var resources embed.FS

type Store struct{ db *sql.DB }

func OpenStore(dir string) (*Store, error) {
	if err := os.MkdirAll(dir, 0700); err != nil {
		return nil, err
	}
	if err := os.Chmod(dir, 0700); err != nil {
		return nil, err
	}
	db, err := sql.Open("sqlite", filepath.Join(dir, "lumi.db"))
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(1)
	fail := func(err error) (*Store, error) { db.Close(); return nil, err }
	if _, err = db.Exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS migrations (version TEXT PRIMARY KEY);`); err != nil {
		return fail(err)
	}
	if err = os.Chmod(filepath.Join(dir, "lumi.db"), 0600); err != nil {
		return fail(err)
	}
	entries, err := resources.ReadDir("migrations")
	if err != nil {
		return fail(err)
	}
	for _, entry := range entries {
		var n int
		if err = db.QueryRow(`SELECT count(*) FROM migrations WHERE version=?`, entry.Name()).Scan(&n); err != nil {
			return fail(err)
		}
		if n != 0 {
			continue
		}
		b, _ := resources.ReadFile("migrations/" + entry.Name())
		tx, e := db.Begin()
		if e != nil {
			return fail(e)
		}
		if _, e = tx.Exec(string(b)); e == nil {
			_, e = tx.Exec(`INSERT INTO migrations(version) VALUES(?)`, entry.Name())
		}
		if e != nil {
			tx.Rollback()
			return fail(e)
		}
		if e = tx.Commit(); e != nil {
			return fail(e)
		}
	}
	// A process restart cannot resume an upstream stream safely.
	if _, err = db.Exec(`UPDATE messages SET status='interrupted' WHERE status='streaming'`); err != nil {
		return fail(err)
	}
	return &Store{db: db}, nil
}
func (s *Store) Close() error { return s.db.Close() }
func defaultSettings() api.Settings {
	prompt, _ := resources.ReadFile("prompt.txt")
	return api.Settings{Prompt: string(prompt), DefaultPrompt: string(prompt), AutoRead: true, SpeechRate: 0.7}
}
func (s *Store) Settings() (api.Settings, error) {
	settings := defaultSettings()
	var b string
	err := s.db.QueryRow(`SELECT value FROM settings WHERE key='settings'`).Scan(&b)
	if errors.Is(err, sql.ErrNoRows) {
		return settings, nil
	}
	if err != nil {
		return settings, err
	}
	err = json.Unmarshal([]byte(b), &settings)
	settings.DefaultPrompt = defaultSettings().DefaultPrompt
	return settings, err
}
func (s *Store) SaveSettings(v api.Settings) error {
	v.DefaultPrompt = defaultSettings().DefaultPrompt
	b, err := json.Marshal(v)
	if err != nil {
		return err
	}
	_, err = s.db.Exec(`INSERT INTO settings(key,value) VALUES('settings',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`, string(b))
	return err
}
func (s *Store) Conversations() ([]api.Conversation, error) {
	rows, err := s.db.Query(`SELECT id,title,created_at,updated_at FROM conversations ORDER BY updated_at DESC,id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []api.Conversation{}
	for rows.Next() {
		var c api.Conversation
		var created, updated string
		if err = rows.Scan(&c.Id, &c.Title, &created, &updated); err != nil {
			return nil, err
		}
		c.CreatedAt, _ = time.Parse(time.RFC3339Nano, created)
		c.UpdatedAt, _ = time.Parse(time.RFC3339Nano, updated)
		out = append(out, c)
	}
	return out, rows.Err()
}
func (s *Store) Create(id, title string) (api.Conversation, error) {
	now := time.Now().UTC()
	stamp := now.Format(time.RFC3339Nano)
	_, err := s.db.Exec(`INSERT INTO conversations(id,title,created_at,updated_at) VALUES(?,?,?,?) ON CONFLICT(id) DO NOTHING`, id, title, stamp, stamp)
	if err != nil {
		return api.Conversation{}, err
	}
	d, err := s.Conversation(id)
	return d.Conversation, err
}
func (s *Store) Conversation(id string) (api.ConversationDetail, error) {
	d := api.ConversationDetail{Messages: []api.Message{}}
	var created, updated string
	err := s.db.QueryRow(`SELECT id,title,created_at,updated_at FROM conversations WHERE id=?`, id).Scan(&d.Conversation.Id, &d.Conversation.Title, &created, &updated)
	if err != nil {
		return d, err
	}
	d.Conversation.CreatedAt, _ = time.Parse(time.RFC3339Nano, created)
	d.Conversation.UpdatedAt, _ = time.Parse(time.RFC3339Nano, updated)
	rows, err := s.db.Query(`SELECT id,role,text,status,created_at,images,sentence_map,topic_map FROM messages WHERE conversation_id=? ORDER BY seq`, id)
	if err != nil {
		return d, err
	}
	defer rows.Close()
	for rows.Next() {
		m := api.Message{ConversationId: id}
		var stamp, images, sentenceMap, topicMap string
		if err = rows.Scan(&m.Id, &m.Role, &m.Text, &m.Status, &stamp, &images, &sentenceMap, &topicMap); err != nil {
			return d, err
		}
		if err = json.Unmarshal([]byte(images), &m.Images); err != nil {
			return d, err
		}
		if err = json.Unmarshal([]byte(sentenceMap), &m.SentenceMap); err != nil {
			return d, err
		}
		if err = json.Unmarshal([]byte(topicMap), &m.TopicMap); err != nil {
			return d, err
		}
		m.CreatedAt, _ = time.Parse(time.RFC3339Nano, stamp)
		d.Messages = append(d.Messages, m)
	}
	return d, rows.Err()
}
func (s *Store) StartTurn(cid, rid, text string) (api.Message, bool, error) {
	var existing api.Message
	var stamp, storedText, images, sentenceMap, topicMap string
	err := s.db.QueryRow(`SELECT m.id,m.role,m.text,m.status,m.created_at,u.text,m.images,m.sentence_map,m.topic_map FROM messages m JOIN messages u ON u.request_id=m.request_id AND u.conversation_id=m.conversation_id AND u.role='user' WHERE m.conversation_id=? AND m.request_id=? AND m.role='assistant'`, cid, rid).Scan(&existing.Id, &existing.Role, &existing.Text, &existing.Status, &stamp, &storedText, &images, &sentenceMap, &topicMap)
	if err == nil {
		if storedText != text {
			return existing, false, fmt.Errorf("request id reused")
		}
		if err = json.Unmarshal([]byte(images), &existing.Images); err != nil {
			return existing, false, err
		}
		if err = json.Unmarshal([]byte(sentenceMap), &existing.SentenceMap); err != nil {
			return existing, false, err
		}
		if err = json.Unmarshal([]byte(topicMap), &existing.TopicMap); err != nil {
			return existing, false, err
		}
		existing.ConversationId = cid
		existing.CreatedAt, _ = time.Parse(time.RFC3339Nano, stamp)
		return existing, true, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return existing, false, err
	}
	now := time.Now().UTC()
	m := api.Message{Id: randomID(), ConversationId: cid, Role: "assistant", Text: "", Status: "streaming", CreatedAt: now}
	tx, err := s.db.Begin()
	if err != nil {
		return m, false, err
	}
	defer tx.Rollback()
	stamp = now.Format(time.RFC3339Nano)
	if _, err = tx.Exec(`INSERT INTO messages(id,conversation_id,request_id,role,text,status,created_at) VALUES(?,?,?,'user',?,'completed',?),(?,?,?,'assistant','','streaming',?)`, randomID(), cid, rid, text, stamp, m.Id, cid, rid, stamp); err != nil {
		return m, false, err
	}
	if _, err = tx.Exec(`UPDATE conversations SET updated_at=? WHERE id=?`, stamp, cid); err != nil {
		return m, false, err
	}
	return m, false, tx.Commit()
}
func (s *Store) Finish(m api.Message) error {
	images := []api.WordImage{}
	if m.Images != nil {
		images = *m.Images
	}
	if images == nil {
		images = []api.WordImage{}
	}
	encoded, err := json.Marshal(images)
	if err != nil {
		return err
	}
	encodedMap, err := json.Marshal(m.SentenceMap)
	if err != nil {
		return err
	}
	encodedTopicMap, err := json.Marshal(m.TopicMap)
	if err != nil {
		return err
	}
	_, err = s.db.Exec(`UPDATE messages SET text=?,status=?,images=?,sentence_map=?,topic_map=? WHERE id=?`, m.Text, m.Status, string(encoded), string(encodedMap), string(encodedTopicMap), m.Id)
	return err
}
func (s *Store) Delete(id string) error {
	if id == "" {
		_, err := s.db.Exec(`DELETE FROM conversations`)
		return err
	}
	_, err := s.db.Exec(`DELETE FROM conversations WHERE id=?`, id)
	return err
}
