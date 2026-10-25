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

func spaceMap() api.TopicMap {
	planets := []api.TopicItem{}
	for _, name := range []string{"Mercurio", "Venere", "Terra", "Marte", "Giove", "Saturno", "Urano", "Nettuno"} {
		planets = append(planets, api.TopicItem{Label: name, Explanation: "Un pianeta del Sistema solare."})
	}
	return api.TopicMap{Title: "Il Sistema solare e i corpi celesti", Branches: []api.TopicBranch{
		{Label: "Pianeti", Explanation: "Gli otto pianeti girano intorno al Sole.", Items: planets},
		{Label: "Stelle", Explanation: "Le stelle producono luce e calore.", Items: []api.TopicItem{{Label: "Sole", Explanation: "È la stella più vicina alla Terra."}}},
		{Label: "Piccoli corpi e scie luminose", Explanation: "Scopriamo alcuni nomi diversi.", Items: []api.TopicItem{
			{Label: "Asteroide", Explanation: "Un corpo roccioso che gira intorno al Sole."},
			{Label: "Meteorite", Explanation: "Un frammento arrivato al suolo."},
		}},
	}}
}

func topicArguments(t *testing.T, m api.TopicMap) string {
	t.Helper()
	b, err := json.Marshal(m)
	if err != nil {
		t.Fatal(err)
	}
	return string(b)
}

func TestTopicMapValidation(t *testing.T) {
	valid := topicArguments(t, spaceMap())
	for _, tc := range []struct {
		name, args string
		valid      bool
	}{
		{"all eight planets", valid, true},
		{"invalid JSON", "{", false},
		{"null", "null", false},
		{"missing branches", `{"title":"Spazio"}`, false},
		{"trailing JSON", valid + `{}`, false},
		{"unexpected field", strings.Replace(valid, `"title":`, `"extra":true,"title":`, 1), false},
		{"empty label", strings.Replace(valid, `"label":"Sole"`, `"label":" "`, 1), false},
		{"long label", strings.Replace(valid, `"label":"Sole"`, `"label":"`+strings.Repeat("a", 81)+`"`, 1), false},
		{"duplicate planets", strings.Replace(valid, `"label":"Venere"`, `"label":" mercurio "`, 1), false},
		{"duplicate branches", strings.Replace(valid, `"label":"Stelle"`, `"label":" pianeti "`, 1), false},
		{"oversized JSON", strings.Repeat(" ", 65537) + valid, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			m, problem := executeTopicMapTool(tc.args)
			if (m != nil) != tc.valid || (problem == "") != tc.valid {
				t.Fatalf("map=%+v error=%s", m, problem)
			}
		})
	}
	for _, count := range []int{0, 1, 7} {
		m := spaceMap()
		m.Branches = make([]api.TopicBranch, count)
		if result, _ := executeTopicMapTool(topicArguments(t, m)); result != nil {
			t.Fatalf("accepted %d branches", count)
		}
	}
	for _, count := range []int{0, 9} {
		m := spaceMap()
		m.Branches[0].Items = make([]api.TopicItem, count)
		if result, _ := executeTopicMapTool(topicArguments(t, m)); result != nil {
			t.Fatalf("accepted %d items", count)
		}
	}
}

func TestTopicMapToolStreamsAndPreservesHistory(t *testing.T) {
	calls := 0
	m := spaceMap()
	var events []GenerationEvent
	g := toolGenerator(t, func(r *http.Request) (*http.Response, error) {
		calls++
		body := requestBody(t, r)
		if calls == 1 {
			if !strings.Contains(body["instructions"].(string), "MAPPE DI ARGOMENTI") {
				t.Fatal("missing topic map instructions")
			}
			input := body["input"].([]any)
			if !strings.Contains(input[0].(map[string]any)["content"].(string), topicArguments(t, m)) {
				t.Fatal("lost previous map context")
			}
			tools := body["tools"].([]any)[0].(map[string]any)["tools"].([]any)
			if len(tools) != 3 || tools[2].(map[string]any)["name"] != "show_topic_map" || tools[2].(map[string]any)["strict"] != true {
				t.Fatal("missing strict topic tool")
			}
			call := toolCall("map", topicArguments(t, m))
			call["name"] = "show_topic_map"
			other := toolCall("sentence", mapArguments(t, catMap))
			other["name"] = "show_sentence_map"
			return streamedItems([]any{call, call, other}), nil
		}
		if calls != 2 || len(events) != 1 || !reflect.DeepEqual(events[0].TopicMap, &m) {
			t.Fatal("map not emitted exactly once")
		}
		tools := body["tools"].([]any)[0].(map[string]any)["tools"].([]any)
		if len(tools) != 1 || tools[0].(map[string]any)["name"] != "show_images" {
			t.Fatal("map tools were not consumed")
		}
		input := body["input"].([]any)
		output := input[len(input)-1].(map[string]any)["output"].(string)
		if !strings.Contains(output, `"error"`) {
			t.Fatal("accepted a second map in the same turn")
		}
		return completedStream("Tocca un ramo per esplorare lo spazio.", nil), nil
	})
	err := g.Stream(context.Background(), api.Settings{Model: "test"}, []api.Message{{Role: "assistant", Status: "completed", TopicMap: &m}, {Role: "user", Text: "Aggiorna la mappa", Status: "completed"}}, func(e GenerationEvent) error { events = append(events, e); return nil })
	if err != nil || calls != 2 || len(events) != 2 {
		t.Fatalf("err=%v events=%+v", err, events)
	}
}

func TestInvalidTopicMapFallsBackToText(t *testing.T) {
	calls := 0
	g := toolGenerator(t, func(r *http.Request) (*http.Response, error) {
		calls++
		body := requestBody(t, r)
		if calls == 1 {
			call := toolCall("map", `{}`)
			call["name"] = "show_topic_map"
			return completedStream("", []any{call}), nil
		}
		input := body["input"].([]any)
		if !strings.Contains(input[len(input)-1].(map[string]any)["output"].(string), `"error"`) {
			t.Fatal("no map failure reported")
		}
		return completedStream("Non riesco a mostrare la mappa adesso.", nil), nil
	})
	text := ""
	err := g.Stream(context.Background(), api.Settings{Model: "test"}, nil, func(e GenerationEvent) error {
		if e.TopicMap != nil {
			t.Fatal("invalid map emitted")
		}
		text += e.Text
		return nil
	})
	if err != nil || text == "" || calls != 2 {
		t.Fatalf("bad fallback: %v", err)
	}
}

type topicGenerator struct {
	calls int
	fail  bool
}

func (g *topicGenerator) Stream(_ context.Context, _ api.Settings, _ []api.Message, emit func(GenerationEvent) error) error {
	g.calls++
	m := spaceMap()
	if err := emit(GenerationEvent{TopicMap: &m}); err != nil {
		return err
	}
	if g.fail {
		return errors.New("interrotto")
	}
	return emit(GenerationEvent{Text: "Esploriamo lo spazio."})
}

func TestTopicMapPersistenceReplayAndInterruption(t *testing.T) {
	for _, fail := range []bool{false, true} {
		t.Run(map[bool]string{false: "complete", true: "interrupted"}[fail], func(t *testing.T) {
			s := testServer(t)
			setupChat(t, s)
			g := &topicGenerator{fail: fail}
			s.generator = g
			body := `{"requestId":"topic-1","text":"Una mappa dei pianeti","action":"message"}`
			first := call(s, "POST", "/api/v1/conversations/one/messages", body, s.config.Origin, nil, "")
			if !strings.Contains(first.Body.String(), `"type":"topic_map"`) {
				t.Fatal(first.Body.String())
			}
			second := call(s, "POST", "/api/v1/conversations/one/messages", body, s.config.Origin, nil, "")
			if g.calls != 1 || !strings.Contains(second.Body.String(), `"topicMap"`) {
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
			expected := spaceMap()
			status := "completed"
			if fail {
				status = "interrupted"
			}
			if m.Status != status || !reflect.DeepEqual(m.TopicMap, &expected) {
				t.Fatalf("lost map: %+v", m)
			}
		})
	}
}
