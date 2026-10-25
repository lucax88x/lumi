package app

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"reflect"
	"strings"
	"testing"
	"time"

	"lumi/internal/api"
)

var vigorousWord = api.WordExplanation{Word: "vigoroso", Meaning: "forte", Example: "Il bambino dà un calcio vigoroso al pallone."}

func wordArguments(t *testing.T, word api.WordExplanation) string {
	t.Helper()
	b, err := json.Marshal(word)
	if err != nil {
		t.Fatal(err)
	}
	return string(b)
}

func TestWordExplanationValidation(t *testing.T) {
	valid := wordArguments(t, vigorousWord)
	for _, tc := range []struct {
		name, args, question string
		valid                bool
	}{
		{"bare word", valid, "Vigoroso", true},
		{"question", valid, "Cosa significa «vigoroso»?", true},
		{"elided article", valid, "Cosa significa l’aggettivo «vigoroso»?", true},
		{"context", valid, "Nella frase: un calcio vigoroso.", true},
		{"missing fields", `{}`, "vigoroso", false},
		{"null", `null`, "vigoroso", false},
		{"invalid JSON", `{`, "vigoroso", false},
		{"trailing JSON", valid + `{}`, "vigoroso", false},
		{"unknown field", strings.Replace(valid, `"word":`, `"extra":true,"word":`, 1), "vigoroso", false},
		{"sentence", strings.ReplaceAll(valid, "vigoroso", "molto forte"), "molto forte", false},
		{"substring", valid, "vigorosamente", false},
		{"invented word", valid, "arcobaleno", false},
		{"greeting", valid, "Ciao!", false},
		{"empty meaning", strings.Replace(valid, `"forte"`, `" "`, 1), "vigoroso", false},
		{"long meaning", strings.Replace(valid, `"forte"`, `"`+strings.Repeat("a", 241)+`"`, 1), "vigoroso", false},
		{"too large", strings.Repeat(" ", 8193) + valid, "vigoroso", false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			got, problem := executeWordExplanationTool(tc.args, []api.Message{{Role: "user", Text: tc.question}})
			if (got != nil) != tc.valid || (problem == "") != tc.valid {
				t.Fatalf("word=%+v problem=%s", got, problem)
			}
		})
	}
	for _, word := range []string{"perché", "citta\u0300", "l’amico", "nord-est"} {
		entry := vigorousWord
		entry.Word = word
		if got, problem := executeWordExplanationTool(wordArguments(t, entry), []api.Message{{Role: "user", Text: word}}); got == nil {
			t.Fatal(word, problem)
		}
	}
	entry := vigorousWord
	entry.Word = "arcobaleno"
	if got, problem := executeWordExplanationTool(wordArguments(t, entry), []api.Message{{Role: "user", Text: "Che cos’è l’arcobaleno?"}}); got == nil {
		t.Fatal("elided article blocked noun lookup:", problem)
	}
	if got, _ := executeWordExplanationTool(valid, []api.Message{{Role: "assistant", Text: "vigoroso"}}); got != nil {
		t.Fatal("accepted assistant's example")
	}
}

func TestWordToolStreamsWithoutDuplicateProseAndPreservesContext(t *testing.T) {
	calls := 0
	var events []GenerationEvent
	g := toolGenerator(t, func(r *http.Request) (*http.Response, error) {
		calls++
		body := requestBody(t, r)
		if calls == 1 {
			tools := body["tools"].([]any)[0].(map[string]any)["tools"].([]any)
			if len(tools) != 4 || tools[3].(map[string]any)["name"] != "show_word_explanation" || tools[3].(map[string]any)["strict"] != true {
				t.Fatal("missing strict word tool")
			}
			input := body["input"].([]any)
			if !strings.Contains(input[1].(map[string]any)["content"].(string), wordArguments(t, vigorousWord)) {
				t.Fatal("lost saved word context")
			}
			call := toolCall("word", wordArguments(t, vigorousWord))
			call["name"] = "show_word_explanation"
			other := toolCall("map", mapArguments(t, catMap))
			other["name"] = "show_sentence_map"
			return streamedItems([]any{call, call, other}), nil
		}
		tools := body["tools"].([]any)[0].(map[string]any)["tools"].([]any)
		if len(tools) != 1 || tools[0].(map[string]any)["name"] != "show_images" {
			t.Fatal("word tool did not consume content slot")
		}
		return completedStream("", nil), nil
	})
	err := g.Stream(context.Background(), api.Settings{Model: "test"}, []api.Message{
		{Role: "user", Text: "Cosa significa vigoroso?", Status: "completed"},
		{Role: "assistant", WordExplanation: &vigorousWord, Status: "completed"},
		{Role: "user", Text: "Più facile", Status: "completed"},
	}, func(e GenerationEvent) error { events = append(events, e); return nil })
	if err != nil || calls != 2 || len(events) != 1 || !reflect.DeepEqual(events[0].WordExplanation, &vigorousWord) {
		t.Fatalf("err=%v calls=%d events=%+v", err, calls, events)
	}
}

type wordGenerator struct {
	calls int
	fail  bool
	word  api.WordExplanation
}

func (g *wordGenerator) Stream(_ context.Context, _ api.Settings, _ []api.Message, emit func(GenerationEvent) error) error {
	g.calls++
	if err := emit(GenerationEvent{WordExplanation: &g.word}); err != nil {
		return err
	}
	if g.fail {
		return errors.New("interrotto")
	}
	return nil
}

func TestWordPersistenceReplayDictionaryAndPreview(t *testing.T) {
	for _, fail := range []bool{false, true} {
		t.Run(map[bool]string{false: "completed", true: "interrupted"}[fail], func(t *testing.T) {
			s := testServer(t)
			setupChat(t, s)
			g := &wordGenerator{fail: fail, word: vigorousWord}
			s.generator = g
			body := `{"requestId":"word-1","text":"Cosa significa vigoroso?","action":"message"}`
			first := call(s, "POST", "/api/v1/conversations/one/messages", body, s.config.Origin, nil, "")
			if !strings.Contains(first.Body.String(), `"type":"word_explanation"`) {
				t.Fatal(first.Body.String())
			}
			replay := call(s, "POST", "/api/v1/conversations/one/messages", body, s.config.Origin, nil, "")
			if g.calls != 1 || !strings.Contains(replay.Body.String(), `"meaning":"forte"`) {
				t.Fatal("replay regenerated or lost cards")
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
			m := detail.Messages[1]
			status := "completed"
			if fail {
				status = "interrupted"
			}
			if m.Status != status || !reflect.DeepEqual(m.WordExplanation, &vigorousWord) {
				t.Fatalf("lost cards: %+v", m)
			}
			entries, err := reopened.Dictionary()
			if err != nil {
				t.Fatal(err)
			}
			want := 1
			if fail {
				want = 0
			}
			if len(entries) != want {
				t.Fatalf("dictionary=%+v", entries)
			}
			if !fail {
				if err := reopened.Finish(m); err != nil {
					t.Fatal(err)
				}
				if err := reopened.Delete(""); err != nil {
					t.Fatal(err)
				}
				after, _ := reopened.Dictionary()
				if !reflect.DeepEqual(entries, after) {
					t.Fatal("replay or chat deletion changed dictionary")
				}
			}
			cookie, csrf := adminLogin(t, s)
			preview := call(s, "POST", "/api/v1/admin/preview", `{"text":"vigoroso","prompt":"Spiega","model":"test-model"}`, s.config.Origin, cookie, csrf)
			if preview.Code != 200 || !strings.Contains(preview.Body.String(), `"wordExplanation"`) {
				t.Fatal(preview.Body.String())
			}
			after, _ := reopened.Dictionary()
			if len(after) != want {
				t.Fatal("preview saved a dictionary word")
			}
		})
	}
}

func TestDictionaryDeduplicationAndAtomicCompletion(t *testing.T) {
	s := testServer(t).store
	if _, err := s.Create("one", "Parole"); err != nil {
		t.Fatal(err)
	}
	var first time.Time
	for i, word := range []string{"CITTÀ", "citta\u0300", "forte", "forti"} {
		m, _, err := s.StartTurn("one", word, "Parola")
		if err != nil {
			t.Fatal(err)
		}
		m.CreatedAt = time.Date(2026, 1, 1+i, 12, 0, 0, 0, time.UTC)
		m.WordExplanation = &api.WordExplanation{Word: word, Meaning: "Un luogo con tante case.", Example: "Vivo in città."}
		if i == 0 {
			first = m.CreatedAt
		}
		if err := s.Finish(m); err != nil {
			t.Fatal(err)
		}
		entries, _ := s.Dictionary()
		if len(entries) > i {
			t.Fatal("checkpoint saved word")
		}
		m.Status = "completed"
		if err := s.Finish(m); err != nil {
			t.Fatal(err)
		}
	}
	entries, _ := s.Dictionary()
	if len(entries) != 3 || wordKey(entries[2].Word) != "città" || !entries[2].FirstAskedAt.Equal(first) || entries[2].LastAskedAt.Equal(first) {
		t.Fatalf("bad deduplication: %+v", entries)
	}
	// A failed dictionary write must roll back message completion as well.
	m, _, _ := s.StartTurn("one", "rollback", "vigoroso")
	m.Status = "completed"
	m.WordExplanation = &vigorousWord
	if _, err := s.db.Exec(`CREATE TRIGGER fail_dictionary BEFORE INSERT ON dictionary_entries BEGIN SELECT RAISE(ABORT,'failure'); END`); err != nil {
		t.Fatal(err)
	}
	if err := s.Finish(m); err == nil {
		t.Fatal("expected persistence error")
	}
	detail, _ := s.Conversation("one")
	if detail.Messages[len(detail.Messages)-1].Status != "streaming" {
		t.Fatal("message committed without word")
	}
}

func TestDictionarySaveFailureLeavesInterruptedCards(t *testing.T) {
	s := testServer(t)
	setupChat(t, s)
	s.generator = &wordGenerator{word: vigorousWord}
	if _, err := s.store.db.Exec(`CREATE TRIGGER fail_dictionary BEFORE INSERT ON dictionary_entries BEGIN SELECT RAISE(ABORT,'failure'); END`); err != nil {
		t.Fatal(err)
	}
	w := call(s, "POST", "/api/v1/conversations/one/messages", `{"requestId":"failure","text":"vigoroso","action":"message"}`, s.config.Origin, nil, "")
	if !strings.Contains(w.Body.String(), `"type":"failed"`) {
		t.Fatal(w.Body.String())
	}
	detail, err := s.store.Conversation("one")
	if err != nil || detail.Messages[1].Status != "interrupted" || detail.Messages[1].WordExplanation == nil {
		t.Fatalf("lost interrupted cards: %+v err=%v", detail, err)
	}
	entries, _ := s.store.Dictionary()
	if len(entries) != 0 {
		t.Fatal("failed completion saved a dictionary word")
	}
}
