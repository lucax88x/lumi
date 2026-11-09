package app

import (
	"context"
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"lumi/internal/api"
)

func TestContinentSearch(t *testing.T) {
	for _, query := range []string{"continenti", "mondo", "planisfero", "sei continenti", "sette continenti", "7 continenti"} {
		results, problem := findMapFeatures(`{"query":"` + query + `"}`)
		want := 6
		seven := query == "sette continenti" || query == "7 continenti"
		if seven {
			want = 7
		}
		if problem != "" || len(results) != want {
			t.Fatalf("%s: %v %s", query, results, problem)
		}
		ids := map[string]bool{}
		for _, f := range results {
			if f.Kind != "continents" {
				t.Fatalf("%s returned %s", query, f.Kind)
			}
			ids[f.Id] = true
		}
		if ids["continents-america"] == seven || ids["continents-north-america"] != seven || ids["continents-south-america"] != seven {
			t.Fatal("wrong American continents", ids)
		}
	}
	for query, id := range map[string]string{"Europa": "europe", "Oceania": "oceania", "Antartide": "antarctica", "America del Nord": "north-america", "Nord America": "north-america", "America del Sud": "south-america", "America meridionale": "south-america", "America": "america"} {
		results, problem := findMapFeatures(`{"query":"` + query + `"}`)
		if problem != "" || len(results) == 0 || results[0].Id != "continents-"+id {
			t.Fatalf("%s: %v %s", query, results, problem)
		}
	}
}

func continentVisualArguments(t *testing.T, query string) (string, map[string]bool) {
	t.Helper()
	results, _ := findMapFeatures(`{"query":"` + query + `"}`)
	features := []api.MapFeature{}
	found := map[string]bool{}
	for _, f := range results {
		features = append(features, api.MapFeature{Id: f.Id, Label: f.Label, Explanation: "Tocca per scoprire dove si trova."})
		found[f.Id] = true
	}
	world := api.World
	visual := api.GeographyVisual{Kind: "map", Title: "I continenti", Summary: "Le grandi terre del mondo.", DatasetVersion: api.NeV2, View: &world, Features: features}
	encoded, err := json.Marshal(map[string]any{"visual": visual})
	if err != nil {
		t.Fatal(err)
	}
	return string(encoded), found
}

func TestWorldMapContract(t *testing.T) {
	for _, query := range []string{"continenti", "sette continenti"} {
		arguments, found := continentVisualArguments(t, query)
		result, problem := executeLearningVisual(arguments, found)
		if result == nil {
			t.Fatal(problem)
		}
		visual, err := result.AsGeographyVisual()
		if err != nil || visual.View == nil || *visual.View != api.World || visual.DatasetVersion != api.NeV2 || len(visual.Features) != len(found) {
			t.Fatalf("wrong world map: %+v %v", visual, err)
		}
		if result, _ := executeLearningVisual(strings.Replace(arguments, `"world"`, `"invented"`, 1), found); result != nil {
			t.Fatal("accepted unknown view")
		}
	}
	arguments, found := continentVisualArguments(t, "sette continenti")
	var raw map[string]any
	_ = json.Unmarshal([]byte(arguments), &raw)
	visual := raw["visual"].(map[string]any)
	visual["features"] = append(visual["features"].([]any), map[string]any{"id": "continents-america", "label": "America", "explanation": "Terra."})
	found["continents-america"] = true
	encoded, _ := json.Marshal(raw)
	if result, _ := executeLearningVisual(string(encoded), found); result != nil {
		t.Fatal("accepted eight places")
	}
	// The API still reads legacy messages; tools advertise only the new version.
	schema, _ := json.Marshal(studySchema("LearningVisual"))
	if strings.Contains(string(schema), "ne-v1") || !strings.Contains(string(schema), "ne-v2") {
		t.Fatal("wrong tool atlas versions")
	}
}

func TestNewMapsUpgradeLegacyToolArguments(t *testing.T) {
	arguments := `{"visual":{"kind":"map","title":"Italia","summary":"Il nostro paese.","datasetVersion":"ne-v1","features":[{"id":"countries-ITA","label":"Italia","explanation":"Si trova in Europa."}]}}`
	result, problem := executeLearningVisual(arguments, map[string]bool{"countries-ITA": true})
	if result == nil {
		t.Fatal(problem)
	}
	visual, _ := result.AsGeographyVisual()
	if visual.DatasetVersion != api.NeV2 || visual.View != nil {
		t.Fatal("new map should use current atlas and default focus", visual)
	}
}

func TestLegacyAtlasPreservedInV2(t *testing.T) {
	for _, group := range []string{"countries", "regions", "cities", "rivers", "lakes", "islands"} {
		old, err := os.ReadFile(filepath.Join("../../web/public/geography/ne-v1", group+".json"))
		if err != nil {
			t.Fatal(err)
		}
		current, err := os.ReadFile(filepath.Join("../../web/public/geography/ne-v2", group+".json"))
		if err != nil || string(old) != string(current) {
			t.Fatalf("legacy layer changed: %s %v", group, err)
		}
	}
}

func TestContinentCorrectionUsesHistoryAndOneLookup(t *testing.T) {
	calls := 0
	arguments, _ := continentVisualArguments(t, "continenti")
	g := toolGenerator(t, func(r *http.Request) (*http.Response, error) {
		calls++
		body := requestBody(t, r)
		encoded, _ := json.Marshal(body["input"])
		for _, text := range []string{"Intendevo una cartina", "I continenti", "Mappa concettuale già mostrata"} {
			if !strings.Contains(string(encoded), text) {
				t.Fatalf("missing correction context %s", text)
			}
		}
		if calls == 1 {
			return plannedStream("map", "I continenti", true, 6), nil
		}
		instructions := body["instructions"].(string)
		for _, instruction := range []string{"view=world", "Intendevo una cartina", "Non presentare una mappa delle idee"} {
			if !strings.Contains(instructions, instruction) {
				t.Fatal("missing cartography instruction", instruction)
			}
		}
		name, args := "find_map_features", `{"query":"continenti"}`
		if calls == 3 {
			name, args = "show_learning_visual", arguments
		}
		call := toolCall(name, args)
		call["name"] = name
		return streamedItems([]any{call}), nil
	})
	history := []api.Message{
		{Role: "user", Status: "completed", Text: "Una mappa dei continenti e dove si trovano"},
		{Role: "assistant", Status: "completed", TopicMap: &api.TopicMap{Title: "I continenti", Branches: []api.TopicBranch{{Label: "America", Explanation: "A ovest.", Items: []api.TopicItem{{Label: "America", Explanation: "A ovest."}}}}}},
		{Role: "user", Status: "completed", Text: "Intendevo una cartina"},
	}
	var result *api.LearningVisual
	err := g.Stream(context.WithValue(context.Background(), subjectKey{}, api.Geography), api.Settings{Model: "test", Prompt: "Studiamo."}, history, func(e GenerationEvent) error {
		if e.LearningVisual != nil {
			result = e.LearningVisual
		}
		return nil
	})
	if err != nil || calls != 3 || result == nil {
		t.Fatalf("calls=%d map=%v err=%v", calls, result, err)
	}
}
