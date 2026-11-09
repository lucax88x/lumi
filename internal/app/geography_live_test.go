package app

import (
	"context"
	"database/sql"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
	"time"

	"lumi/internal/api"
)

// Opt-in only: uses the configured account's plan, without saving conversations.
func TestLiveContinentFormat(t *testing.T) {
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
	for _, subject := range []api.Subject{api.Geography, api.History} {
		settings.Prompt = defaultSubjectPrompt(subject)
		for _, tc := range []struct {
			name, question     string
			correction, mental bool
			count              int
		}{
			{name: "bare-continents", question: "I continenti", count: 6},
			{name: "world", question: "Mostrami i continenti e dove si trovano", count: 6},
			{name: "correction", question: "Intendevo una cartina", correction: true, count: 6},
			{name: "seven", question: "Mostrami un planisfero dei sette continenti, con America del Nord e America del Sud separate", count: 7},
			{name: "mental", question: "Voglio una mappa mentale dei continenti", mental: true},
		} {
			t.Run(string(subject)+"/"+tc.name, func(t *testing.T) {
				history := []api.Message{}
				if tc.correction {
					history = append(history,
						api.Message{Role: "user", Status: "completed", Text: "Una mappa dei continenti e dove si trovano"},
						api.Message{Role: "assistant", Status: "completed", TopicMap: &api.TopicMap{Title: "I continenti", Branches: []api.TopicBranch{{Label: "Africa", Explanation: "Un continente.", Items: []api.TopicItem{{Label: "Africa", Explanation: "Un continente."}}}}}},
					)
				}
				history = append(history, api.Message{Role: "user", Status: "completed", Text: tc.question})
				ctx, cancel := context.WithTimeout(context.WithValue(context.Background(), subjectKey{}, subject), 2*time.Minute)
				defer cancel()
				answer := api.Message{Role: "assistant", Status: "completed"}
				err := g.Stream(ctx, settings, history, func(e GenerationEvent) error {
					answer.Text += e.Text
					if e.LearningVisual != nil {
						answer.LearningVisual = e.LearningVisual
					}
					if e.TopicMap != nil {
						answer.TopicMap = e.TopicMap
					}
					if e.StudyClarification != nil {
						t.Error("request should not need clarification")
					}
					return nil
				})
				if err != nil {
					t.Fatal(err)
				}
				if tc.mental {
					if answer.TopicMap == nil || answer.LearningVisual != nil {
						t.Fatalf("expected mental map: %+v", answer)
					}
				} else {
					if answer.LearningVisual == nil || answer.TopicMap != nil {
						t.Fatalf("expected geographic map: %+v", answer)
					}
					visual, err := answer.LearningVisual.AsGeographyVisual()
					if err != nil || visual.View == nil || *visual.View != api.World || visual.DatasetVersion != api.NeV2 || len(visual.Features) != tc.count {
						t.Fatalf("wrong world view: %+v %v", visual, err)
					}
					if answer.Text != "Tocca un continente per scoprire dove si trova" {
						t.Errorf("unexpected map introduction: %q", answer.Text)
					}
					expected, _ := findMapFeatures(`{"query":"continenti"}`)
					if tc.count == 7 {
						expected, _ = findMapFeatures(`{"query":"sette continenti"}`)
					}
					ids := map[string]bool{}
					for _, f := range visual.Features {
						ids[f.Id] = true
					}
					for _, f := range expected {
						if !ids[f.Id] {
							t.Errorf("missing %s", f.Label)
						}
					}
				}
				t.Logf("model=%s text=%s", settings.Model, answer.Text)
			})
		}
	}
}
