package app

import (
	"context"
	"database/sql"
	"errors"
	"path/filepath"
	"strings"
	"testing"

	"lumi/internal/api"
)

type imageGenerator struct {
	calls int
	fail  bool
}

func (g *imageGenerator) Stream(_ context.Context, _ api.Settings, _ []api.Message, emit func(GenerationEvent) error) error {
	g.calls++
	if err := emit(GenerationEvent{Images: rockImages}); err != nil {
		return err
	}
	if g.fail {
		return errors.New("interrotto")
	}
	return emit(GenerationEvent{Text: "Ecco una roccia!"})
}

func TestImageMessagePersistenceReplayAndReopen(t *testing.T) {
	for _, fail := range []bool{false, true} {
		t.Run(map[bool]string{false: "completed", true: "interrupted"}[fail], func(t *testing.T) {
			s := testServer(t)
			setupChat(t, s)
			g := &imageGenerator{fail: fail}
			s.generator = g
			body := `{"requestId":"images-1","text":"Mostrami una roccia","action":"message"}`
			first := call(s, "POST", "/api/v1/conversations/one/messages", body, s.config.Origin, nil, "")
			if !strings.Contains(first.Body.String(), `"type":"images"`) {
				t.Fatal(first.Body.String())
			}
			second := call(s, "POST", "/api/v1/conversations/one/messages", body, s.config.Origin, nil, "")
			if g.calls != 1 || !strings.Contains(second.Body.String(), rockImages[0].ImageUrl) {
				t.Fatal("replay lost images or ran generation again")
			}
			// Reopen the database to verify durable attachments, not in-memory state.
			reopened, err := OpenStore(s.config.DataDir)
			if err != nil {
				t.Fatal(err)
			}
			defer reopened.Close()
			detail, err := reopened.Conversation("one")
			if err != nil {
				t.Fatal(err)
			}
			m := detail.Messages[1]
			expected := "completed"
			if fail {
				expected = "interrupted"
			}
			if m.Status != expected || m.Images == nil || len(*m.Images) != 1 || (*m.Images)[0] != rockImages[0] {
				t.Fatalf("lost attachments: %+v", m)
			}
		})
	}
}

func TestImageMigrationPreservesOldMessages(t *testing.T) {
	dir := t.TempDir()
	db, err := sql.Open("sqlite", filepath.Join(dir, "lumi.db"))
	if err != nil {
		t.Fatal(err)
	}
	initial, err := resources.ReadFile("migrations/001_initial.sql")
	if err != nil {
		t.Fatal(err)
	}
	_, err = db.Exec(string(initial))
	if err != nil {
		t.Fatal(err)
	}
	_, err = db.Exec(`CREATE TABLE migrations(version TEXT PRIMARY KEY); INSERT INTO migrations VALUES('001_initial.sql'); INSERT INTO conversations VALUES('one','Roccia','2026-01-01T00:00:00Z','2026-01-01T00:00:00Z'); INSERT INTO messages(id,conversation_id,request_id,role,text,status,created_at) VALUES('old','one','old-request','user','Cos’è una roccia?','completed','2026-01-01T00:00:00Z');`)
	if err != nil {
		t.Fatal(err)
	}
	db.Close()
	store, err := OpenStore(dir)
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	detail, err := store.Conversation("one")
	if err != nil {
		t.Fatal(err)
	}
	if len(detail.Messages) != 1 || detail.Messages[0].Text != "Cos’è una roccia?" || detail.Messages[0].Images == nil || len(*detail.Messages[0].Images) != 0 {
		t.Fatalf("migration damaged history: %+v", detail)
	}

}
