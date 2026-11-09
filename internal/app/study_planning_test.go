package app

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"testing"

	"lumi/internal/api"
)

func namedCall(name, args string) map[string]any {
	c := toolCall(name, args)
	c["name"] = name
	return c
}
func plannedStream(decision, topic string, world bool, continents int) *http.Response {
	data, _ := json.Marshal(studyPlan{decision, topic, world, continents})
	return completedStream("Questa pianificazione è privata.", []any{namedCall("plan_study", string(data))})
}
func studyContext(subject api.Subject) context.Context {
	return context.WithValue(context.Background(), subjectKey{}, subject)
}
func studyHistory(text string) []api.Message {
	return []api.Message{{Role: "user", Text: text, Status: "completed"}}
}
func testSettings() api.Settings { return api.Settings{Model: "test", Prompt: "Studiamo."} }

func TestStudyPlanningContract(t *testing.T) {
	for _, decision := range []string{"map", "topic_map", "continue", "other"} {
		calls := 0
		g := toolGenerator(t, func(r *http.Request) (*http.Response, error) {
			calls++
			b := requestBody(t, r)
			if b["store"] != false || b["parallel_tool_calls"] != false {
				t.Fatal("invalid request", b)
			}
			if calls == 1 {
				if b["tool_choice"] != "required" {
					t.Fatal("planner is optional")
				}
				tools := b["tools"].([]any)[0].(map[string]any)["tools"].([]any)
				if len(tools) != 1 {
					t.Fatal("content tools exposed during planning")
				}
				tool := tools[0].(map[string]any)
				if tool["name"] != "plan_study" || tool["strict"] != true {
					t.Fatal(tool)
				}
				schema := tool["parameters"].(map[string]any)
				if schema["additionalProperties"] != false || len(schema["required"].([]any)) != 4 {
					t.Fatal(schema)
				}
				return plannedStream(decision, "Italia", false, 0), nil
			}
			encoded, _ := json.Marshal(b["input"])
			if strings.Contains(string(encoded), "plan_study") || strings.Contains(string(encoded), "pianificazione è privata") {
				t.Fatal("planner output leaked into history")
			}
			return completedStream("Risposta breve.", nil), nil
		})
		var text string
		err := g.Stream(studyContext(api.Geography), testSettings(), studyHistory("Italia"), func(e GenerationEvent) error { text += e.Text; return nil })
		if decision == "map" { // Plain text is corrected once, then rejected.
			if err == nil || calls != 3 || text != "" {
				t.Fatalf("map accepted prose: %s %v", text, err)
			}
		} else if err != nil || calls != 2 || text != "Risposta breve." {
			t.Fatalf("%s: %s %v", decision, text, err)
		}
	}
}

func TestStudyPlanValidation(t *testing.T) {
	valid := `{"decision":"map","topic":"I continenti","world":true,"continents":6}`
	if _, err := decodeStudyPlan(valid); err != nil {
		t.Fatal(err)
	}
	for _, args := range []string{
		`{}`, strings.Replace(valid, `"map"`, `"diagram"`, 1), strings.Replace(valid, `"map"`, `"other"`, 1),
		strings.Replace(valid, `"continents":6`, `"continents":0`, 1), strings.Replace(valid, `"world":true`, `"world":false`, 1),
		strings.Replace(valid, `"world":true,`, "", 1), strings.Replace(valid, `"topic":"I continenti"`, `"topic":null`, 1),
		strings.Replace(valid, `"decision":`, `"extra":1,"decision":`, 1), valid + `{}`,
	} {
		if _, err := decodeStudyPlan(args); err == nil {
			t.Fatal("invalid plan accepted", args)
		}
	}
}

func TestPlannedToolRestrictions(t *testing.T) {
	for _, subject := range []api.Subject{api.Geography, api.History, api.Science, api.Geometry} {
		for _, decision := range []string{"map", "topic_map", "continue", "other"} {
			plan := studyPlan{Decision: decision, Topic: "I continenti", World: true, Continents: 6}
			tools := plannedTools(map[string]bool{}, subject, &plan)
			if decision == "map" && geographicSubject(subject) {
				tools = mapTools(plan, 0)
			}
			raw, _ := json.Marshal(tools)
			text := string(raw)
			if decision == "map" && geographicSubject(subject) {
				if strings.Contains(text, "show_topic_map") || strings.Contains(text, "ask_study_focus") || strings.Contains(text, `"diagram"`) || strings.Contains(text, `"geometry"`) || strings.Contains(text, "show_images") {
					t.Fatal("incompatible map tools", text)
				}
				if !strings.Contains(text, "find_map_features") || !strings.Contains(text, `"map"`) {
					t.Fatal("missing map tools")
				}
			} else if strings.Contains(text, `"map"`) {
				t.Fatal("map variant leaked", subject, decision)
			}
			if decision == "topic_map" && !strings.Contains(text, "show_topic_map") {
				t.Fatal("missing concept map")
			}
			if decision == "continue" && strings.Contains(text, "show_learning_visual") {
				t.Fatal("continuation recreates visual")
			}
		}
		if !geographicSubject(subject) {
			raw, _ := json.Marshal(subjectTools(map[string]bool{}, subject))
			if strings.Contains(string(raw), "find_map_features") || strings.Contains(string(raw), `"map"`) {
				t.Fatal("geography leaked", subject)
			}
			if !strings.Contains(string(raw), `"diagram"`) || !strings.Contains(string(raw), `"geometry"`) {
				t.Fatal("other visuals lost")
			}
		}
	}
}

func TestPlannedWorldValidation(t *testing.T) {
	for _, count := range []int{6, 7} {
		query := "continenti"
		if count == 7 {
			query = "sette continenti"
		}
		args, found := continentVisualArguments(t, query)
		plan := studyPlan{Decision: "map", World: true, Continents: count}
		if v, p := validatePlannedMap(args, found, plan); v == nil {
			t.Fatal(p)
		}
		var wrapper map[string]any
		_ = json.Unmarshal([]byte(args), &wrapper)
		visual := wrapper["visual"].(map[string]any)
		features := visual["features"].([]any)
		for _, mutation := range []func(){
			func() { visual["view"] = "focus" },
			func() { delete(visual, "view") },
			func() { visual["view"] = "world"; visual["features"] = features[:len(features)-1] },
			func() { visual["features"] = append(features[:len(features)-1:len(features)-1], features[0]) },
		} {
			mutation()
			raw, _ := json.Marshal(wrapper)
			if v, _ := validatePlannedMap(string(raw), found, plan); v != nil {
				t.Fatal("incomplete world accepted", string(raw))
			}
		}
		other := 6
		if count == 6 {
			other = 7
		}
		plan.Continents = other
		if v, _ := validatePlannedMap(args, found, plan); v != nil {
			t.Fatal("wrong classification accepted")
		}
	}
}

const continentDiagram = `{"visual":{"kind":"diagram","title":"I continenti","summary":"Le terre del mondo.","layout":"scene","nodes":[{"id":"africa","label":"Africa","explanation":"Un continente."},{"id":"america","label":"America","explanation":"Un continente."}],"edges":[]}}`

func TestMapRejectsDiagramWithoutEmittingOrSaving(t *testing.T) {
	for _, correct := range []bool{false, true} {
		t.Run(fmt.Sprint(correct), func(t *testing.T) {
			calls := 0
			args, _ := continentVisualArguments(t, "continenti")
			g := toolGenerator(t, func(r *http.Request) (*http.Response, error) {
				calls++
				requestBody(t, r)
				switch calls {
				case 1:
					return plannedStream("map", "I continenti", true, 6), nil
				case 2:
					return completedStream("Come vedi nella cartina precedente, ecco i continenti.", []any{namedCall("show_learning_visual", continentDiagram)}), nil
				case 3:
					if !correct {
						return completedStream("Ecco lo schema.", []any{namedCall("show_learning_visual", continentDiagram)}), nil
					}
					return completedStream("Cerco.", []any{namedCall("find_map_features", `{"query":"continenti"}`)}), nil
				case 4:
					return completedStream("Ecco la cartina inventata prima.", []any{namedCall("show_learning_visual", args)}), nil
				}
				t.Fatal("unexpected extra call", calls)
				return nil, errors.New("unexpected")
			})
			s := testServer(t)
			setupChat(t, s)
			_, err := s.store.CreateSubject("continents", "I continenti", api.Geography)
			if err != nil {
				t.Fatal(err)
			}
			s.generator = g
			response := call(s, "POST", "/api/v1/conversations/continents/messages", `{"requestId":"continents-map","text":"I continenti","action":"message"}`, s.config.Origin, nil, "")
			body := response.Body.String()
			for _, forbidden := range []string{`"kind":"diagram"`, "cartina precedente", "cartina inventata", "pianificazione è privata", "Ecco lo schema"} {
				if strings.Contains(body, forbidden) {
					t.Fatal("invalid content emitted", body)
				}
			}
			detail, err := s.store.Conversation("continents")
			if err != nil {
				t.Fatal(err)
			}
			answer := detail.Messages[len(detail.Messages)-1]
			if correct {
				if calls != 4 || answer.Status != "completed" || answer.LearningVisual == nil || answer.Text != "Tocca un continente per scoprire dove si trova" {
					t.Fatalf("invalid corrected map: calls=%d %+v", calls, answer)
				}
				v, err := answer.LearningVisual.AsGeographyVisual()
				if err != nil || v.Kind != "map" {
					t.Fatal("saved wrong visual")
				}
			} else if calls != 3 || answer.Status != "failed" || answer.Text != "" || answer.LearningVisual != nil || answer.TopicMap != nil {
				t.Fatalf("invalid content persisted: calls=%d %+v", calls, answer)
			}
		})
	}
}

func TestMapRejectsConceptMapAndWorldClarification(t *testing.T) {
	for _, name := range []string{"show_topic_map", "ask_study_focus"} {
		calls := 0
		g := toolGenerator(t, func(r *http.Request) (*http.Response, error) {
			requestBody(t, r)
			calls++
			if calls == 1 {
				return plannedStream("map", "I continenti", true, 6), nil
			}
			return completedStream("Ecco la mappa.", []any{namedCall(name, studyFocusJSON)}), nil
		})
		events := 0
		err := g.Stream(studyContext(api.History), testSettings(), studyHistory("I continenti"), func(GenerationEvent) error { events++; return nil })
		if err == nil || events != 0 || calls != 3 {
			t.Fatalf("accepted %s events=%d calls=%d err=%v", name, events, calls, err)
		}
	}
}

func TestPlannedRequestsAndContext(t *testing.T) {
	for _, tc := range []struct {
		question, decision string
		count              int
	}{
		{"I continenti", "map", 6}, {"I sei continenti", "map", 6}, {"I sette continenti", "map", 7},
		{"Dove si trovano?", "map", 6}, {"Intendevo una cartina", "map", 6},
		{"Voglio una mappa mentale dei continenti", "topic_map", 0},
		{"Puoi spiegarmi questo pezzetto con parole più facili? Il punto selezionato è «Oceania»", "continue", 0},
	} {
		t.Run(tc.question, func(t *testing.T) {
			calls := 0
			query := "continenti"
			if tc.count == 7 {
				query = "sette continenti"
			}
			args, _ := continentVisualArguments(t, query)
			history := []api.Message{
				{Role: "user", Status: "completed", Text: "I continenti"},
				{Role: "assistant", Status: "completed", TopicMap: &api.TopicMap{Title: "I continenti"}},
				{Role: "user", Status: "completed", Text: tc.question},
			}
			if tc.decision == "continue" {
				visual, _ := executeLearningVisual(args, func() map[string]bool { _, f := continentVisualArguments(t, query); return f }())
				history[1].LearningVisual = visual
				history[1].TopicMap = nil
			}
			g := toolGenerator(t, func(r *http.Request) (*http.Response, error) {
				b := requestBody(t, r)
				calls++
				input, _ := json.Marshal(b["input"])
				if !strings.Contains(string(input), tc.question) || !strings.Contains(string(input), "I continenti") {
					t.Fatal("missing context")
				}
				if calls == 1 {
					if tc.decision == "continue" {
						if !strings.Contains(string(input), "Cartina geografica già mostrata") {
							t.Fatal("missing map label")
						}
					} else if !strings.Contains(string(input), "Mappa concettuale già mostrata") || strings.Contains(string(input), "Cartina geografica già mostrata") {
						t.Fatal("invented previous map")
					}
					return plannedStream(tc.decision, "I continenti", tc.decision == "map", tc.count), nil
				}
				if tc.decision == "continue" {
					return completedStream("L'Oceania comprende l'Australia e tante isole.", nil), nil
				}
				if tc.decision == "topic_map" {
					if calls == 2 {
						return completedStream("", []any{namedCall("show_topic_map", topicArguments(t, api.TopicMap{Title: "I continenti", Branches: []api.TopicBranch{{Label: "Africa", Explanation: "Una grande terra.", Items: []api.TopicItem{{Label: "Savana", Explanation: "Un paesaggio africano."}}}, {Label: "America", Explanation: "Una grande terra.", Items: []api.TopicItem{{Label: "Foreste", Explanation: "Ci sono grandi foreste."}}}}}))}), nil
					}
					return completedStream("Scopriamo i continenti.", nil), nil
				}
				if calls == 2 {
					return completedStream("Testo da trattenere.", []any{namedCall("find_map_features", `{"query":"`+query+`"}`)}), nil
				}
				return completedStream("Altro testo da trattenere.", []any{namedCall("show_learning_visual", args)}), nil
			})
			answer := api.Message{}
			err := g.Stream(studyContext(api.Geography), testSettings(), history, func(e GenerationEvent) error {
				answer.Text += e.Text
				if e.LearningVisual != nil {
					answer.LearningVisual = e.LearningVisual
				}
				if e.TopicMap != nil {
					answer.TopicMap = e.TopicMap
				}
				return nil
			})
			if err != nil {
				t.Fatal(err)
			}
			switch tc.decision {
			case "map":
				if calls != 3 || answer.LearningVisual == nil || answer.Text != "Tocca un continente per scoprire dove si trova" {
					t.Fatal(answer, calls)
				}
			case "topic_map":
				if answer.TopicMap == nil || answer.LearningVisual != nil {
					t.Fatal(answer)
				}
			case "continue":
				if answer.LearningVisual != nil || !strings.Contains(answer.Text, "Oceania") {
					t.Fatal(answer)
				}
			}
		})
	}
}

func TestMapMissingAndAmbiguousPlace(t *testing.T) {
	for _, topic := range []string{"", "Atlantide", "Georgia"} {
		calls := 0
		g := toolGenerator(t, func(r *http.Request) (*http.Response, error) {
			requestBody(t, r)
			calls++
			if calls == 1 {
				return plannedStream("map", topic, false, 0), nil
			}
			if calls == 2 {
				return completedStream("", []any{namedCall("find_map_features", `{"query":"`+topic+`"}`)}), nil
			}
			if topic == "Georgia" {
				return completedStream("", []any{namedCall("ask_study_focus", `{"topic":"Georgia","question":"Quale Georgia intendi?","choices":[{"label":"Il paese","reply":"Il paese Georgia"},{"label":"Lo stato americano","reply":"Lo stato americano Georgia"}]}`)}), nil
			}
			return completedStream("Ecco uno schema al posto della cartina.", nil), nil
		})
		var answer api.Message
		err := g.Stream(studyContext(api.History), testSettings(), studyHistory("Intendevo una cartina"), func(e GenerationEvent) error {
			answer.Text += e.Text
			answer.StudyClarification = e.StudyClarification
			return nil
		})
		if err != nil {
			t.Fatal(err)
		}
		if topic == "Georgia" {
			if answer.StudyClarification == nil {
				t.Fatal("missing place clarification")
			}
		} else if answer.Text == "" || strings.Contains(answer.Text, "schema") {
			t.Fatal("missing unavailability", answer)
		}
	}
}

func TestPlanningAndMapFailuresDoNotRetry(t *testing.T) {
	for _, at := range []int{1, 2} {
		for _, failure := range []string{"network", "unauthorized", "invalid-plan", "no-plan"} {
			calls, events := 0, 0
			g := toolGenerator(t, func(r *http.Request) (*http.Response, error) {
				requestBody(t, r)
				calls++
				if calls < at {
					return plannedStream("map", "I continenti", true, 6), nil
				}
				switch failure {
				case "network":
					return nil, errors.New("network unavailable")
				case "unauthorized":
					return &http.Response{StatusCode: 401, Header: http.Header{"Content-Type": {"application/json"}}, Body: http.NoBody}, nil
				case "invalid-plan":
					return completedStream("", []any{namedCall("plan_study", `{}`)}), nil
				default:
					return completedStream("Nessun piano.", nil), nil
				}
			})
			err := g.Stream(studyContext(api.Geography), testSettings(), studyHistory("I continenti"), func(GenerationEvent) error { events++; return nil })
			// An absent map call allows exactly one format correction (not a network retry).
			want := at
			if at == 2 && (failure == "no-plan" || failure == "invalid-plan") {
				want = 3
			}
			if err == nil || calls != want || events != 0 {
				t.Fatalf("at=%d failure=%s calls=%d events=%d err=%v", at, failure, calls, events, err)
			}
		}
	}
}

func TestLocationRequestsProduceCatalogMaps(t *testing.T) {
	for _, subject := range []api.Subject{api.Geography, api.History} {
		for _, place := range []string{"Italia", "Creta", "Nilo"} {
			t.Run(string(subject)+"/"+place, func(t *testing.T) {
				matches, _ := findMapFeatures(`{"query":"` + place + `"}`)
				feature := matches[0]
				visual := api.GeographyVisual{Kind: "map", Title: place, Summary: "Scopriamo dove si trova.", DatasetVersion: api.NeV2, Features: []api.MapFeature{{Id: feature.Id, Label: feature.Label, Explanation: "Osserva il luogo evidenziato sulla cartina."}}}
				args, _ := json.Marshal(map[string]any{"visual": visual})
				calls := 0
				g := toolGenerator(t, func(r *http.Request) (*http.Response, error) {
					requestBody(t, r)
					calls++
					if calls == 1 {
						return plannedStream("map", place, false, 0), nil
					}
					if calls == 2 {
						return completedStream("", []any{namedCall("find_map_features", `{"query":"`+place+`"}`)}), nil
					}
					if calls > 3 {
						t.Fatal("extra introduction request")
					}
					return completedStream("Testo non validato.", []any{namedCall("show_learning_visual", string(args))}), nil
				})
				var events []GenerationEvent
				err := g.Stream(studyContext(subject), testSettings(), studyHistory("Dove si trova "+place+"?"), func(e GenerationEvent) error { events = append(events, e); return nil })
				if err != nil || calls != 3 || len(events) != 2 || events[0].LearningVisual == nil || events[1].Text != "Tocca un luogo per scoprirlo" {
					t.Fatalf("events=%+v calls=%d err=%v", events, calls, err)
				}
				result, _ := events[0].LearningVisual.AsGeographyVisual()
				if result.Features[0].Id != feature.Id || result.DatasetVersion != api.NeV2 {
					t.Fatal("wrong place", result)
				}
			})
		}
	}
}

func TestMapCorrectionCanSucceedOnFourthRound(t *testing.T) {
	args, _ := continentVisualArguments(t, "continenti")
	calls := 0
	g := toolGenerator(t, func(r *http.Request) (*http.Response, error) {
		requestBody(t, r)
		calls++
		switch calls {
		case 1:
			return plannedStream("map", "I continenti", true, 6), nil
		case 2, 3:
			return completedStream("", []any{namedCall("find_map_features", `{"query":"continenti"}`)}), nil
		case 4:
			return completedStream("", []any{namedCall("show_learning_visual", continentDiagram)}), nil
		case 5:
			return completedStream("", []any{namedCall("show_learning_visual", args)}), nil
		}
		t.Fatal("more than four generation rounds")
		return nil, errors.New("extra call")
	})
	var result *api.LearningVisual
	err := g.Stream(studyContext(api.History), testSettings(), studyHistory("I continenti"), func(e GenerationEvent) error {
		if e.LearningVisual != nil {
			result = e.LearningVisual
		}
		return nil
	})
	if err != nil || calls != 5 || result == nil {
		t.Fatal(calls, result, err)
	}
}

func TestScienceAndGeometryRejectGeographicCalls(t *testing.T) {
	args, _ := continentVisualArguments(t, "continenti")
	for _, subject := range []api.Subject{api.Science, api.Geometry} {
		calls := 0
		g := toolGenerator(t, func(r *http.Request) (*http.Response, error) {
			b := requestBody(t, r)
			calls++
			if calls == 1 {
				return completedStream("", []any{namedCall("find_map_features", `{"query":"continenti"}`)}), nil
			}
			input, _ := json.Marshal(b["input"])
			if !strings.Contains(string(input), "Strumento non disponibile per questa materia") {
				t.Fatal("geographic lookup accepted")
			}
			if calls == 2 {
				return completedStream("", []any{namedCall("show_learning_visual", args)}), nil
			}
			if !strings.Contains(string(input), "Le cartine richiedono una pianificazione geografica") {
				t.Fatal("map accepted outside geography/history")
			}
			return completedStream("Scopriamo una figura.", nil), nil
		})
		var visual *api.LearningVisual
		err := g.Stream(studyContext(subject), testSettings(), studyHistory("Una figura"), func(e GenerationEvent) error {
			if e.LearningVisual != nil {
				visual = e.LearningVisual
			}
			return nil
		})
		if err != nil || calls != 3 || visual != nil {
			t.Fatal(subject, calls, visual, err)
		}
	}
}
