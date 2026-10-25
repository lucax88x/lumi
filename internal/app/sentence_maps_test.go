package app

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"reflect"
	"strings"
	"testing"

	"lumi/internal/api"
)

var catMap = api.SentenceMap{Sentence: "La gatta si accoccolò sul tappeto.", Parts: []api.SentencePart{
	{Text: "La gatta", Question: "Chi?", Explanation: "Si parla di una gatta."},
	{Text: "si accoccolò", Question: "Che cosa fa?", Explanation: "Si mise comoda, tutta raccolta."},
	{Text: "sul tappeto.", Question: "Dove?", Explanation: "Sopra il tappeto."},
}}

func mapArguments(t *testing.T, m api.SentenceMap) string {
	t.Helper()
	b, err := json.Marshal(m)
	if err != nil {
		t.Fatal(err)
	}
	return string(b)
}

func TestSentenceMapValidation(t *testing.T) {
	history := []api.Message{{Role: "user", Text: "Mi spieghi questa frase: " + catMap.Sentence}}
	valid := mapArguments(t, catMap)
	for _, tc := range []struct {
		name, arguments string
		valid           bool
	}{
		{"valid", valid, true},
		{"invalid json", "{", false},
		{"null", "null", false},
		{"missing fields", `{}`, false},
		{"unknown field", strings.Replace(valid, `"sentence":`, `"extra":true,"sentence":`, 1), false},
		{"trailing json", valid + `{}`, false},
		{"omitted word", strings.Replace(valid, `"text":"La gatta"`, `"text":"gatta"`, 1), false},
		{"invented sentence", strings.ReplaceAll(valid, "gatta", "cagnolina"), false},
		{"empty explanation", strings.Replace(valid, "Sopra il tappeto.", "  ", 1), false},
		{"long explanation", strings.Replace(valid, "Sopra il tappeto.", strings.Repeat("a", 241), 1), false},
		{"huge arguments", strings.Repeat(" ", 16385) + valid, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			m, problem := executeSentenceMapTool(tc.arguments, history)
			if (m != nil) != tc.valid || (problem == "") != tc.valid {
				t.Fatalf("map=%+v error=%s", m, problem)
			}
		})
	}
	for _, count := range []int{1, 7} {
		m := catMap
		m.Parts = make([]api.SentencePart, count)
		if result, _ := executeSentenceMapTool(mapArguments(t, m), history); result != nil {
			t.Fatalf("accepted %d parts", count)
		}
	}
	if result, _ := executeSentenceMapTool(valid, []api.Message{{Role: "assistant", Text: catMap.Sentence}}); result != nil {
		t.Fatal("accepted an invented assistant example")
	}
}

func TestMapAndImageToolsShareATurn(t *testing.T) {
	calls, searches := 0, 0
	var events []GenerationEvent
	g := toolGenerator(t, func(r *http.Request) (*http.Response, error) {
		calls++
		body := requestBody(t, r)
		switch calls {
		case 1:
			if !strings.Contains(body["instructions"].(string), "MAPPA DELLA FRASE") {
				t.Error("missing map instructions")
			}
			tools := body["tools"].([]any)[0].(map[string]any)["tools"].([]any)
			if len(tools) != 3 || tools[1].(map[string]any)["strict"] != true {
				t.Fatal("missing strict map tool")
			}
			call := toolCall("map", mapArguments(t, catMap))
			call["name"] = "show_sentence_map"
			return streamedItems([]any{call, call}), nil
		case 2:
			if len(events) != 1 || !reflect.DeepEqual(events[0].SentenceMap, &catMap) {
				t.Fatal("map not emitted exactly once before continuation")
			}
			tools := body["tools"].([]any)[0].(map[string]any)["tools"].([]any)
			if len(tools) != 1 || tools[0].(map[string]any)["name"] != "show_images" {
				t.Fatal("map tool was not consumed")
			}
			return completedStream("", []any{toolCall("image", `{"word":"gatta"}`)}), nil
		default:
			if calls != 3 || body["tool_choice"] != "none" {
				t.Fatal("tool loop is not bounded")
			}
			return completedStream("La gatta si mette comoda sul tappeto.", nil), nil
		}
	})
	g.searchImages = func(context.Context, string) ([]api.WordImage, error) { searches++; return rockImages, nil }
	err := g.Stream(context.Background(), api.Settings{Model: "test"}, []api.Message{{Role: "user", Text: catMap.Sentence, Status: "completed"}}, func(e GenerationEvent) error { events = append(events, e); return nil })
	if err != nil || calls != 3 || searches != 1 || len(events) != 3 {
		t.Fatalf("err=%v calls=%d searches=%d events=%+v", err, calls, searches, events)
	}
}

func TestInvalidMapFallsBackToText(t *testing.T) {
	calls := 0
	g := toolGenerator(t, func(r *http.Request) (*http.Response, error) {
		calls++
		body := requestBody(t, r)
		if calls == 1 {
			call := toolCall("map", `{}`)
			call["name"] = "show_sentence_map"
			return completedStream("", []any{call}), nil
		}
		input := body["input"].([]any)
		output := input[len(input)-1].(map[string]any)["output"].(string)
		if !strings.Contains(output, `"error"`) {
			t.Fatal("invalid map was not reported")
		}
		return completedStream("La gatta si mette comoda.", nil), nil
	})
	text := ""
	err := g.Stream(context.Background(), api.Settings{Model: "test"}, nil, func(e GenerationEvent) error {
		if e.SentenceMap != nil {
			t.Fatal("invalid map reached UI")
		}
		text += e.Text
		return nil
	})
	if err != nil || text == "" || calls != 2 {
		t.Fatalf("fallback failed: %v", err)
	}
}

func TestSentenceMapIsIncludedInFollowupContext(t *testing.T) {
	g := toolGenerator(t, func(r *http.Request) (*http.Response, error) {
		body := requestBody(t, r)
		input := body["input"].([]any)
		if !strings.Contains(input[1].(map[string]any)["content"].(string), mapArguments(t, catMap)) {
			t.Fatal("map missing from history")
		}
		return completedStream("Vuol dire che si mise comoda.", nil), nil
	})
	err := g.Stream(context.Background(), api.Settings{Model: "test"}, []api.Message{
		{Role: "user", Text: catMap.Sentence, Status: "completed"},
		{Role: "assistant", SentenceMap: &catMap, Status: "completed"},
		{Role: "user", Text: "Più facile", Status: "completed"},
	}, func(GenerationEvent) error { return nil })
	if err != nil {
		t.Fatal(err)
	}
}

type mapGenerator struct {
	calls int
	fail  bool
}

func (g *mapGenerator) Stream(_ context.Context, _ api.Settings, _ []api.Message, emit func(GenerationEvent) error) error {
	g.calls++
	if err := emit(GenerationEvent{SentenceMap: &catMap}); err != nil {
		return err
	}
	if g.fail {
		return errors.New("interrotto")
	}
	return emit(GenerationEvent{Text: "La gatta si mette comoda."})
}

func TestSentenceMapPersistenceReplayAndInterruption(t *testing.T) {
	for _, fail := range []bool{false, true} {
		t.Run(map[bool]string{false: "complete", true: "interrupted"}[fail], func(t *testing.T) {
			s := testServer(t)
			setupChat(t, s)
			g := &mapGenerator{fail: fail}
			s.generator = g
			body := `{"requestId":"map-1","text":"La gatta si accoccolò sul tappeto.","action":"message"}`
			first := call(s, "POST", "/api/v1/conversations/one/messages", body, s.config.Origin, nil, "")
			if !strings.Contains(first.Body.String(), `"type":"sentence_map"`) {
				t.Fatal(first.Body.String())
			}
			second := call(s, "POST", "/api/v1/conversations/one/messages", body, s.config.Origin, nil, "")
			if g.calls != 1 || !strings.Contains(second.Body.String(), `"sentenceMap"`) {
				t.Fatal("lost map or regenerated replay")
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
			if m.Status != status || !reflect.DeepEqual(m.SentenceMap, &catMap) {
				t.Fatalf("lost map: %+v", m)
			}
		})
	}
}
