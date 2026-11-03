package app

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"net/http"
	"path/filepath"
	"reflect"
	"strings"
	"testing"

	"lumi/internal/api"
)

var formatClarification = api.WordClarification{
	Word: "formato", Question: "Mi scrivi o mi dici la frase in cui hai trovato “formato”?",
	Language: "it", Examples: []api.WordClarificationExample{},
}

func clarificationExamples() api.WordClarification {
	result := formatClarification
	result.Question = "Quale esempio si avvicina al senso che cerchi?"
	result.Examples = []api.WordClarificationExample{
		{Sentence: "Il formato del foglio è A4.", Meaning: "La forma e le dimensioni del foglio."},
		{Sentence: "Il gruppo è formato da tre persone.", Meaning: "Il gruppo è composto da tre persone."},
	}
	return result
}

func clarificationArguments(t *testing.T, clarification api.WordClarification) string {
	t.Helper()
	encoded, err := json.Marshal(clarification)
	if err != nil {
		t.Fatal(err)
	}
	return string(encoded)
}

func TestWordClarificationValidation(t *testing.T) {
	valid := clarificationArguments(t, formatClarification)
	examples := clarificationExamples()
	for _, tc := range []struct {
		name, args, question string
		valid                bool
	}{
		{"word", valid, "formato", true},
		{"question", valid, "Cosa significa formato?", true},
		{"examples", clarificationArguments(t, examples), "formato", true},
		{"assistant only", valid, "vigoroso", false},
		{"substring", valid, "riformato", false},
		{"null", "null", "formato", false},
		{"empty", "{}", "formato", false},
		{"invalid JSON", "{", "formato", false},
		{"trailing JSON", valid + "{}", "formato", false},
		{"unknown field", strings.Replace(valid, `"word":`, `"extra":true,"word":`, 1), "formato", false},
		{"missing examples", strings.Replace(valid, `"examples":[],`, "", 1), "formato", false},
		{"null examples", strings.Replace(valid, `"examples":[]`, `"examples":null`, 1), "formato", false},
		{"invalid language", strings.Replace(valid, `"it"`, `"fr"`, 1), "formato", false},
		{"empty question", strings.Replace(valid, formatClarification.Question, " ", 1), "formato", false},
		{"long question", strings.Replace(valid, formatClarification.Question, strings.Repeat("a", 241), 1), "formato", false},
		{"oversized", strings.Repeat(" ", 8193) + valid, "formato", false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			got, problem := executeWordClarificationTool(tc.args, []api.Message{{Role: "assistant", Text: "formato"}, {Role: "user", Text: tc.question}})
			if (got != nil) != tc.valid || (problem == "") != tc.valid {
				t.Fatalf("clarification=%+v problem=%s", got, problem)
			}
		})
	}
	for _, count := range []int{1, 4} {
		bad := examples
		bad.Examples = make([]api.WordClarificationExample, count)
		if got, _ := executeWordClarificationTool(clarificationArguments(t, bad), []api.Message{{Role: "user", Text: "formato"}}); got != nil {
			t.Fatal("accepted wrong example count", count)
		}
	}
	for _, badExample := range []api.WordClarificationExample{
		{Sentence: "Una frase diversa.", Meaning: "Non contiene la parola."},
		{Sentence: "Il foglio è riformato.", Meaning: "Solo una sottostringa."},
		{Sentence: "Il formato è A4.", Meaning: " "},
		{Sentence: strings.Repeat("a", 241), Meaning: "Troppo lunga."},
		examples.Examples[1],
	} {
		bad := clarificationExamples()
		bad.Examples[0] = badExample
		if got, _ := executeWordClarificationTool(clarificationArguments(t, bad), []api.Message{{Role: "user", Text: "formato"}}); got != nil {
			t.Fatal("accepted invalid or duplicate example", badExample)
		}
	}
	if got, _ := executeWordClarificationTool(valid, []api.Message{{Role: "assistant", Text: "formato"}}); got != nil {
		t.Fatal("accepted word invented by assistant")
	}
}

func TestWordClarificationStreamsAndPreservesHistory(t *testing.T) {
	for _, subject := range []api.Subject{api.Italian, api.English} {
		t.Run(string(subject), func(t *testing.T) {
			calls := 0
			examples := clarificationExamples()
			g := toolGenerator(t, func(r *http.Request) (*http.Response, error) {
				calls++
				body := requestBody(t, r)
				if calls == 1 {
					instructions := body["instructions"].(string)
					if !strings.Contains(instructions, wordClarificationInstructions) {
						t.Fatal("saved custom prompt lost clarification instructions")
					}
					tools := body["tools"].([]any)[0].(map[string]any)["tools"].([]any)
					if len(tools) != 5 || tools[4].(map[string]any)["name"] != "ask_word_context" || tools[4].(map[string]any)["strict"] != true {
						t.Fatal("missing strict clarification tool")
					}
					input := body["input"].([]any)
					if !strings.Contains(input[1].(map[string]any)["content"].(string), clarificationArguments(t, formatClarification)) {
						t.Fatal("lost attachment-only clarification history")
					}
					clarify := toolCall("context", clarificationArguments(t, examples))
					clarify["name"] = "ask_word_context"
					word := toolCall("word", wordArguments(t, api.WordExplanation{Word: "formato", Meaning: "composto", Example: "Il gruppo è formato da tre persone."}))
					word["name"] = "show_word_explanation"
					return streamedItems([]any{clarify, clarify, word}), nil
				}
				tools := body["tools"].([]any)[0].(map[string]any)["tools"].([]any)
				if len(tools) != 1 || tools[0].(map[string]any)["name"] != "show_images" {
					t.Fatal("clarification did not consume content slot")
				}
				return completedStream("", nil), nil
			})
			var events []GenerationEvent
			ctx := context.WithValue(context.Background(), subjectKey{}, subject)
			err := g.Stream(ctx, api.Settings{Model: "test", Prompt: "Istruzioni personalizzate."}, []api.Message{
				{Role: "user", Text: "formato", Status: "completed"},
				{Role: "assistant", WordClarification: &formatClarification, Status: "completed"},
				{Role: "user", Text: "Non ho una frase.", Status: "completed"},
			}, func(event GenerationEvent) error { events = append(events, event); return nil })
			if err != nil || calls != 2 || len(events) != 1 || !reflect.DeepEqual(events[0].WordClarification, &examples) {
				t.Fatalf("err=%v calls=%d events=%+v", err, calls, events)
			}
		})
	}
}

type clarificationGenerator struct {
	clarification api.WordClarification
	fail          bool
	calls         int
}

func (g *clarificationGenerator) Stream(_ context.Context, _ api.Settings, _ []api.Message, emit func(GenerationEvent) error) error {
	g.calls++
	if err := emit(GenerationEvent{WordClarification: &g.clarification}); err != nil {
		return err
	}
	if g.fail {
		return errors.New("interrotto")
	}
	return nil
}

func TestWordClarificationPersistenceReplayAndPreview(t *testing.T) {
	for _, fail := range []bool{false, true} {
		t.Run(map[bool]string{false: "completed", true: "interrupted"}[fail], func(t *testing.T) {
			s := testServer(t)
			setupChat(t, s)
			g := &clarificationGenerator{clarification: clarificationExamples(), fail: fail}
			s.generator = g
			body := `{"requestId":"context-1","text":"formato","action":"message"}`
			response := call(s, "POST", "/api/v1/conversations/one/messages", body, s.config.Origin, nil, "")
			if !strings.Contains(response.Body.String(), `"type":"word_clarification"`) {
				t.Fatal(response.Body.String())
			}
			replay := call(s, "POST", "/api/v1/conversations/one/messages", body, s.config.Origin, nil, "")
			if g.calls != 1 || !strings.Contains(replay.Body.String(), `"wordClarification"`) {
				t.Fatal("replay lost context or regenerated")
			}
			reopened, err := OpenStore(s.config.DataDir)
			if err != nil {
				t.Fatal(err)
			}
			defer reopened.Close()
			detail, err := reopened.Conversation("one")
			if err != nil {
				t.Fatal(err)
			}
			wantStatus := "completed"
			if fail {
				wantStatus = "interrupted"
			}
			if detail.Messages[1].Status != wantStatus || !reflect.DeepEqual(detail.Messages[1].WordClarification, &g.clarification) {
				t.Fatalf("lost context: %+v", detail.Messages[1])
			}
			entries, err := reopened.Dictionary()
			if err != nil || len(entries) != 0 {
				t.Fatalf("clarification saved a word: %+v %v", entries, err)
			}
			cookie, csrf := adminLogin(t, s)
			preview := call(s, "POST", "/api/v1/admin/preview", `{"text":"formato","prompt":"Spiega","model":"test"}`, s.config.Origin, cookie, csrf)
			if preview.Code != 200 || !strings.Contains(preview.Body.String(), `"wordClarification"`) {
				t.Fatal(preview.Body.String())
			}
			conversations, _ := reopened.Conversations()
			if len(conversations) != 2 {
				t.Fatal("preview persisted a conversation")
			}
			if !fail {
				s.generator = &wordGenerator{word: api.WordExplanation{Word: "formato", Meaning: "composto", Example: "Il gruppo è formato da tre persone."}}
				call(s, "POST", "/api/v1/conversations/one/messages", `{"requestId":"context-2","text":"Il gruppo è formato da tre persone.","action":"message"}`, s.config.Origin, nil, "")
				entries, err = reopened.Dictionary()
				if err != nil || len(entries) != 1 || entries[0].Word != "formato" {
					t.Fatal("final explanation not saved", entries, err)
				}
			}
		})
	}
}

func TestWordClarificationMigrationPreservesExistingMessagesAndDictionary(t *testing.T) {
	dir := t.TempDir()
	db, err := sql.Open("sqlite", filepath.Join(dir, "lumi.db"))
	if err != nil {
		t.Fatal(err)
	}
	if _, err = db.Exec(`CREATE TABLE migrations(version TEXT PRIMARY KEY)`); err != nil {
		t.Fatal(err)
	}
	migrations, _ := resources.ReadDir("migrations")
	for _, entry := range migrations {
		if entry.Name() >= "007_word_clarifications.sql" {
			continue
		}
		data, _ := resources.ReadFile("migrations/" + entry.Name())
		if _, err = db.Exec(string(data)); err != nil {
			t.Fatal(err)
		}
		if _, err = db.Exec(`INSERT INTO migrations VALUES(?)`, entry.Name()); err != nil {
			t.Fatal(err)
		}
	}
	_, err = db.Exec(`INSERT INTO conversations(id,title,created_at,updated_at) VALUES('old','Forme','2026-01-01T00:00:00Z','2026-01-01T00:00:00Z');
	 INSERT INTO messages(id,conversation_id,request_id,role,text,status,created_at) VALUES('old-message','old','old-request','user','formato','completed','2026-01-01T00:00:00Z');
	 INSERT INTO dictionary_entries(id,word_key,word,meaning,example,first_asked_at,last_asked_at) VALUES('old-word','vigoroso','vigoroso','forte','Un calcio vigoroso.','2026-01-01T00:00:00Z','2026-01-01T00:00:00Z')`)
	if err != nil {
		t.Fatal(err)
	}
	if err = db.Close(); err != nil {
		t.Fatal(err)
	}
	store, err := OpenStore(dir)
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	detail, err := store.Conversation("old")
	if err != nil || len(detail.Messages) != 1 || detail.Messages[0].Text != "formato" || detail.Messages[0].WordClarification != nil {
		t.Fatal("legacy message damaged", detail, err)
	}
	entries, err := store.Dictionary()
	if err != nil || len(entries) != 1 || entries[0].Id != "old-word" {
		t.Fatal("legacy dictionary damaged", entries, err)
	}
}
