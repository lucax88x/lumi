package app

import (
	"context"
	"database/sql"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"lumi/internal/api"
)

// Opt-in: uses the configured model and account, without saving a chat or
// migrating the live database. The prompt is a synthetic, public topic.
func TestLiveTopicMap(t *testing.T) {
	dir := os.Getenv("LUMI_LIVE_TEST_DATA_DIR")
	if dir == "" {
		t.Skip("set LUMI_LIVE_TEST_DATA_DIR to use the configured account")
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
	g := &OpenAIGenerator{auth: auth}
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()
	answer := api.Message{Role: "assistant", Status: "completed"}
	err = g.Stream(ctx, settings, []api.Message{{Role: "user", Status: "completed", Text: "mi fai la mappa mentale con tutti i pianeti e i nomi stellari? tipo meteorite, asteroide, etc"}}, func(e GenerationEvent) error {
		answer.Text += e.Text
		if e.TopicMap != nil {
			answer.TopicMap = e.TopicMap
		}
		if e.SentenceMap != nil || len(e.Images) > 0 {
			t.Error("wrong attachment for topic map request")
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	if answer.TopicMap == nil {
		t.Fatalf("no visual map: %s", answer.Text)
	}
	encoded, err := json.Marshal(answer)
	if err != nil {
		t.Fatal(err)
	}
	labels := ""
	for _, branch := range answer.TopicMap.Branches {
		for _, item := range branch.Items {
			labels += " " + strings.ToLower(item.Label)
		}
	}
	for _, name := range []string{"mercurio", "venere", "terra", "marte", "giove", "saturno", "urano", "nettuno", "meteorite", "asteroid"} {
		if !strings.Contains(labels, name) {
			t.Errorf("missing requested concept: %s", name)
		}
	}
	if path := os.Getenv("LUMI_LIVE_TEST_OUTPUT"); path != "" {
		if err := os.WriteFile(path, encoded, 0600); err != nil {
			t.Fatal(err)
		}
	}
	t.Logf("model=%s; branches=%d; text=%s", settings.Model, len(answer.TopicMap.Branches), answer.Text)
}
