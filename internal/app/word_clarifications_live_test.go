package app

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"testing"
	"time"

	"lumi/internal/api"
)

// Opt-in: consumes the configured plan. Reads the database without migrations or
// saving conversations; OAuth refresh can persist renewed credentials as usual.
func TestLiveWordClarification(t *testing.T) {
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
	for _, tc := range []struct {
		name                    string
		subject                 api.Subject
		question, word, context string
		ambiguous               bool
	}{
		{"Italian ambiguity", api.Italian, "Cosa significa formato?", "formato", "Il gruppo è formato da tre persone.", true},
		{"English ambiguity", api.English, "Cosa significa bank?", "bank", "I sit on the river bank.", true},
		{"Italian to English ambiguity", api.English, "Come si dice pesca?", "pesca", "Mangio una pesca.", true},
		{"context already supplied", api.Italian, "Cosa significa formato nella frase «Il gruppo è formato da tre persone»?", "formato", "", false},
		{"clear English word", api.English, "Cosa significa dog?", "dog", "", false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			profileSettings := settings
			if tc.subject == api.English {
				profileSettings.Prompt = defaultSubjectPrompt(tc.subject)
				var custom string
				if err := db.QueryRow(`SELECT value FROM settings WHERE key='prompt:english'`).Scan(&custom); err == nil {
					profileSettings.Prompt = custom
				} else if !errors.Is(err, sql.ErrNoRows) {
					t.Fatal(err)
				}
			}
			ctx, cancel := context.WithTimeout(context.WithValue(context.Background(), subjectKey{}, tc.subject), 4*time.Minute)
			defer cancel()
			stream := func(history []api.Message) api.Message {
				answer := api.Message{Role: "assistant", Status: "completed"}
				err := g.Stream(ctx, profileSettings, history, func(event GenerationEvent) error {
					answer.Text += event.Text
					if event.WordClarification != nil {
						answer.WordClarification = event.WordClarification
					}
					if event.WordExplanation != nil {
						answer.WordExplanation = event.WordExplanation
					}
					if event.SentenceMap != nil || event.TopicMap != nil || len(event.Images) > 0 {
						t.Error("unexpected map or image")
					}
					return nil
				})
				if err != nil {
					t.Fatal(err)
				}
				return answer
			}
			history := []api.Message{{Role: "user", Text: tc.question, Status: "completed"}}
			answer := stream(history)
			if tc.ambiguous {
				if answer.WordClarification == nil || wordKey(answer.WordClarification.Word) != tc.word || len(answer.WordClarification.Examples) != 0 || answer.WordExplanation != nil {
					t.Fatalf("expected clarification: %+v", answer)
				}
				history = append(history, answer, api.Message{Role: "user", Text: "Non ho una frase.", Status: "completed"})
				answer = stream(history)
				if answer.WordClarification == nil || len(answer.WordClarification.Examples) < 2 || answer.WordExplanation != nil {
					t.Fatalf("expected alternatives: %+v", answer)
				}
				history = append(history, answer, api.Message{Role: "user", Text: tc.context, Status: "completed"})
				answer = stream(history)
			}
			if answer.WordExplanation == nil || answer.WordClarification != nil {
				t.Fatalf("expected final word explanation: %+v", answer)
			}
			word := answer.WordExplanation.Word
			if tc.subject == api.English && answer.WordExplanation.SourceWord != nil {
				word = *answer.WordExplanation.SourceWord
			}
			if wordKey(word) != tc.word {
				t.Fatalf("lost original word: %s", word)
			}
			t.Logf("model=%s; word=%s; meaning=%s", settings.Model, answer.WordExplanation.Word, answer.WordExplanation.Meaning)
		})
	}
}
