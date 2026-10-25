package app

import (
	"context"
	"database/sql"
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"testing"
	"time"

	"lumi/internal/api"
)

// Opt-in acceptance test. Uses the selected account/model and consumes its plan.
// Reads settings without opening/migrating the app store; does not save chat turns.
// OAuth renewal, when needed, uses the normal credential persistence path.
func TestLiveImageConversation(t *testing.T) {
	dir := os.Getenv("LUMI_LIVE_TEST_DATA_DIR")
	if dir == "" {
		t.Skip("set LUMI_LIVE_TEST_DATA_DIR to run against the configured account")
	}
	db, err := sql.Open("sqlite", "file:"+filepath.Join(dir, "lumi.db")+"?mode=ro")
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	var raw string
	if err = db.QueryRow(`SELECT value FROM settings WHERE key='settings'`).Scan(&raw); err != nil {
		t.Fatal(err)
	}
	var settings api.Settings
	if err = json.Unmarshal([]byte(raw), &settings); err != nil {
		t.Fatal(err)
	}
	if settings.Model == "" {
		t.Fatal("no configured model")
	}
	auth, err := NewOAuth(dir)
	if err != nil {
		t.Fatal(err)
	}
	s := &Server{http: &http.Client{Timeout: 15 * time.Second}}
	g := &OpenAIGenerator{auth: auth, searchImages: s.searchImages}
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()
	history := []api.Message{{Role: "user", Text: "Cos’è una roccia?", Status: "completed"}}
	answer := api.Message{Role: "assistant", Status: "completed"}
	err = g.Stream(ctx, settings, history, func(e GenerationEvent) error {
		answer.Text += e.Text
		if e.WordExplanation != nil {
			answer.WordExplanation = e.WordExplanation
		}
		if len(e.Images) > 0 {
			t.Error("unsolicited images for definition")
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	history = append(history, answer, api.Message{Role: "user", Text: "Me ne mostri una?", Status: "completed"})
	text := ""
	images := []api.WordImage{}
	err = g.Stream(ctx, settings, history, func(e GenerationEvent) error { text += e.Text; images = append(images, e.Images...); return nil })
	if err != nil {
		t.Fatal(err)
	}
	if len(images) == 0 {
		t.Fatalf("no images: %s", text)
	}
	t.Logf("model=%s; first answer=%s; follow-up=%s; images=%d; first title=%s", settings.Model, answer.Text, text, len(images), images[0].Title)
}
