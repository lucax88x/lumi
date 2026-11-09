package app

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"lumi/internal/api"
)

const studyFocusJSON = `{"topic":"Gli Egiziani","question":"Che cosa vuoi scoprire degli Egiziani?","choices":[{"label":"Il Nilo","reply":"Il Nilo"},{"label":"Le piramidi","reply":"Le piramidi"},{"label":"La vita quotidiana","reply":"La vita quotidiana"}]}`
const angleJSON = `{"visual":{"kind":"geometry","title":"L'angolo retto","summary":"Si apre come l'angolo di un quaderno.","figures":[{"shape":"angle","label":"Angolo retto","explanation":"Ha la forma di un angolo del quaderno.","degrees":90,"width":null,"height":null}]}}`

func TestStudyToolsAndValidation(t *testing.T) {
	spec, err := studySpec()
	if err != nil {
		t.Fatal(err)
	}
	if err = spec.Validate(context.Background()); err != nil {
		t.Fatal(err)
	}
	for _, subject := range []api.Subject{api.History, api.Geography, api.Science, api.Geometry} {
		if subject, _ := normalizeSubject(subject); !studySubject(subject) {
			t.Fatal("missing profile")
		}
		if !strings.Contains(defaultSubjectPrompt(subject), "prima–seconda") {
			t.Fatal("missing level")
		}
		tools := subjectTools(map[string]bool{}, subject).OfNamespace.Tools
		names := map[string]bool{}
		for _, tool := range tools {
			names[tool.OfFunction.Name] = true
		}
		for _, name := range []string{"show_topic_map", "ask_study_focus", "show_learning_visual", "find_map_features"} {
			if !names[name] {
				t.Fatal("missing tool", name)
			}
		}
		if names["show_sentence_map"] || subjectToolAllowed(subject, "show_word_explanation") {
			t.Fatal("linguistic tools leaked")
		}
	}
	if _, problem := executeStudyFocus(studyFocusJSON); problem != "" {
		t.Fatal(problem)
	}
	for _, bad := range []string{
		strings.Replace(studyFocusJSON, `"Il Nilo","reply"`, `"Non lo so","reply"`, 1),
		strings.Replace(studyFocusJSON, `"Le piramidi","reply"`, `"Il Nilo","reply"`, 1),
		strings.Replace(studyFocusJSON, `"topic":`, `"unknown":1,"topic":`, 1),
		strings.Replace(studyFocusJSON, `"Il Nilo","reply":"Il Nilo"`, `" ","reply":"Il Nilo"`, 1),
		studyFocusJSON + `{}`,
	} {
		if result, _ := executeStudyFocus(bad); result != nil {
			t.Fatal("accepted bad focus", bad)
		}
	}
	if result, problem := executeLearningVisual(angleJSON, nil); result == nil {
		t.Fatal(problem)
	}
	for _, bad := range []string{
		strings.Replace(angleJSON, `"degrees":90`, `"degrees":60`, 1),
		strings.Replace(angleJSON, `"degrees":90`, `"degrees":361`, 1),
		strings.Replace(angleJSON, `"degrees":90,`, "", 1),
		strings.Replace(angleJSON, `"width":null`, `"width":20`, 1),
		strings.Replace(angleJSON, `"angle"`, `"square"`, 1),
		strings.Replace(angleJSON, `"summary":`, `"unknown":1,"summary":`, 1),
	} {
		if result, _ := executeLearningVisual(bad, nil); result != nil {
			t.Fatal("accepted bad geometry", bad)
		}
	}
	for _, tc := range []struct {
		degrees float64
		label   string
	}{{0, "nullo"}, {45, "acuto"}, {90, "retto"}, {135, "ottuso"}, {180, "piatto"}, {270, "concavo"}, {360, "giro"}} {
		if angleClass(tc.degrees) != tc.label {
			t.Fatal(tc)
		}
		value := map[string]any{"visual": map[string]any{"kind": "geometry", "title": "Un angolo", "summary": "Guardiamo la sua apertura.", "figures": []any{map[string]any{"shape": "angle", "label": "Angolo " + tc.label, "explanation": "Osserva le due semirette.", "degrees": tc.degrees}}}}
		data, _ := json.Marshal(value)
		if result, problem := executeLearningVisual(string(data), nil); result == nil {
			t.Fatalf("%s: %s", data, problem)
		}
	}
	for _, shape := range []string{"line", "ray", "segment", "triangle", "square", "rectangle", "circle"} {
		arg := `{"visual":{"kind":"geometry","title":"Una figura","summary":"Scopriamo la sua forma.","figures":[{"shape":"` + shape + `","label":"Figura","explanation":"Guarda il disegno."}]}}`
		if result, problem := executeLearningVisual(arg, nil); result == nil {
			t.Fatal(shape, problem)
		}
	}
}
func TestStudyDiagramEdges(t *testing.T) {
	valid := `{"visual":{"kind":"diagram","title":"L'acqua","summary":"L'acqua si muove.","layout":"cycle","nodes":[{"id":"a","label":"Nuvola","explanation":"Contiene goccioline."},{"id":"b","label":"Pioggia","explanation":"Le gocce cadono."}],"edges":[{"from":"a","to":"b"},{"from":"b","to":"a"}]}}`
	if v, p := executeLearningVisual(valid, nil); v == nil {
		t.Fatal(p)
	}
	for _, bad := range []string{strings.Replace(valid, `"to":"b"`, `"to":"inventato"`, 1), strings.Replace(valid, `"id":"b"`, `"id":"a"`, 1), strings.Replace(valid, `,{"from":"b","to":"a"}`, "", 1)} {
		if v, _ := executeLearningVisual(bad, nil); v != nil {
			t.Fatal("accepted invalid edges")
		}
	}
}
func TestGeographyCatalogAndAssets(t *testing.T) {
	for _, query := range []string{"Italia", "Toscana", "Creta", "Nilo", "il fiume Nilo", "Il Cairo"} {
		results, problem := findMapFeatures(`{"query":"` + query + `"}`)
		if problem != "" || len(results) == 0 {
			t.Fatal(query, problem)
		}
	}
	results, _ := findMapFeatures(`{"query":"Nilo"}`)
	id := results[0].Id
	valid := `{"visual":{"kind":"map","title":"Il Nilo","summary":"Un fiume importante per gli Egiziani.","datasetVersion":"ne-v1","features":[{"id":"` + id + `","label":"Nilo","explanation":"L'acqua aiutava a coltivare."}]}}`
	if v, p := executeLearningVisual(valid, map[string]bool{id: true}); v == nil {
		t.Fatal(p)
	}
	if v, _ := executeLearningVisual(valid, nil); v != nil {
		t.Fatal("accepted unsearched place")
	}
	for _, bad := range []string{strings.Replace(valid, id, "invented-place", 1), strings.Replace(valid, "ne-v1", "ne-v99", 1)} {
		if v, _ := executeLearningVisual(bad, map[string]bool{id: true}); v != nil {
			t.Fatal("accepted invalid map")
		}
	}
	matches, problem := findMapFeatures(`{"query":"un-luogo-che-non-esiste"}`)
	if problem != "" || len(matches) != 0 {
		t.Fatal(matches, problem)
	}
	if _, problem = findMapFeatures(`{"query":"Nilo","url":"https://example.com"}`); problem == "" {
		t.Fatal("accepted unknown key")
	}
	assets := map[string]bool{}
	for _, group := range []string{"continents", "countries", "regions", "cities", "rivers", "lakes", "islands"} {
		data, err := os.ReadFile(filepath.Join("../../web/public/geography/ne-v2", group+".json"))
		if err != nil {
			t.Fatal(err)
		}
		var collection struct {
			Features []struct {
				Id string `json:"id"`
			} `json:"features"`
		}
		if err = json.Unmarshal(data, &collection); err != nil {
			t.Fatal(err)
		}
		if group == "regions" && len(collection.Features) != 20 {
			t.Fatal("expected 20 Italian regions")
		}
		for _, f := range collection.Features {
			if assets[f.Id] {
				t.Fatal("duplicate asset id", f.Id)
			}
			assets[f.Id] = true
		}
	}
	for _, entry := range geographyCatalog() {
		if !assets[entry.Id] {
			t.Fatal("missing geographic asset", entry.Id)
		}
	}
}

func TestStudyLookupStreamAndAttachmentOnlyCompletion(t *testing.T) {
	calls := 0
	nile, _ := findMapFeatures(`{"query":"Nilo"}`)
	egypt, _ := findMapFeatures(`{"query":"Egitto"}`)
	if len(nile) == 0 || len(egypt) == 0 {
		t.Fatal("missing test places")
	}
	visual := `{"visual":{"kind":"map","title":"Il Nilo","summary":"Il fiume degli Egiziani.","datasetVersion":"ne-v1","features":[{"id":"` + nile[0].Id + `","label":"Nilo","explanation":"Aiutava a coltivare."},{"id":"` + egypt[0].Id + `","label":"Egitto","explanation":"Il paese attraversato dal Nilo."}]}}`
	g := toolGenerator(t, func(r *http.Request) (*http.Response, error) {
		calls++
		body := requestBody(t, r)
		if !strings.Contains(body["instructions"].(string), "Non chiedere MAI quale formato") {
			t.Fatal("wrong instructions")
		}
		var name, args string
		switch calls {
		case 1:
			name, args = "find_map_features", `{"query":"Nilo"}`
		case 2:
			name, args = "find_map_features", `{"query":"Egitto"}`
		case 3:
			name, args = "show_learning_visual", visual
		default:
			if body["tool_choice"] != "none" {
				t.Fatal("tools should be disabled after visual")
			}
			return completedStream("", nil), nil
		}
		c := toolCall(name, args)
		c["name"] = name
		return streamedItems([]any{c}), nil
	})
	var events []GenerationEvent
	ctx := context.WithValue(context.Background(), subjectKey{}, api.History)
	history := []api.Message{{Role: "assistant", Status: "completed", StudyClarification: mustStudyFocus(t)}, {Role: "user", Status: "completed", Text: "Il Nilo"}}
	err := g.Stream(ctx, api.Settings{Model: "test", Prompt: "Studiamo."}, history, func(e GenerationEvent) error { events = append(events, e); return nil })
	if err != nil || calls != 4 || len(events) != 1 || events[0].LearningVisual == nil {
		t.Fatalf("calls=%d events=%v err=%v", calls, events, err)
	}
}
func mustStudyFocus(t *testing.T) *api.StudyClarification {
	t.Helper()
	v, p := executeStudyFocus(studyFocusJSON)
	if v == nil {
		t.Fatal(p)
	}
	return v
}

type studyGenerator struct {
	calls int
	fail  bool
}

func (g *studyGenerator) Stream(_ context.Context, _ api.Settings, _ []api.Message, emit func(GenerationEvent) error) error {
	g.calls++
	v, p := executeLearningVisual(angleJSON, nil)
	if v == nil {
		return errors.New(p)
	}
	if err := emit(GenerationEvent{LearningVisual: v}); err != nil {
		return err
	}
	if g.fail {
		return context.Canceled
	}
	return nil
}
func TestStudyPersistenceMigrationReplayAndInterrupted(t *testing.T) {
	s := testServer(t)
	setupChat(t, s)
	for _, subject := range []api.Subject{api.History, api.Geography, api.Science, api.Geometry} {
		if _, err := s.store.CreateSubject(string(subject), "Una scoperta", subject); err != nil {
			t.Fatal(err)
		}
		settings, err := s.store.subjectSettings(subject)
		if err != nil {
			t.Fatal(err)
		}
		settings.Prompt = "Prompt per " + string(subject)
		if err = s.store.saveSubjectSettings(subject, settings); err != nil {
			t.Fatal(err)
		}
		got, err := s.store.subjectSettings(subject)
		if err != nil || got.Prompt != settings.Prompt {
			t.Fatal("lost subject prompt", err)
		}
	}
	g := &studyGenerator{}
	s.generator = g
	body := `{"requestId":"angle-study","text":"Spiegami l'angolo retto","action":"message"}`
	path := "/api/v1/conversations/geometry/messages"
	response := call(s, "POST", path, body, s.config.Origin, nil, "")
	if !strings.Contains(response.Body.String(), `"type":"learning_visual"`) || !strings.Contains(response.Body.String(), `"type":"completed"`) {
		t.Fatal(response.Body.String())
	}
	call(s, "POST", path, body, s.config.Origin, nil, "")
	if g.calls != 1 {
		t.Fatal("replay generated again")
	}
	g.fail = true
	call(s, "POST", path, strings.Replace(body, "angle-study", "angle-interrupted", 1), s.config.Origin, nil, "")
	reopened, err := OpenStore(s.config.DataDir)
	if err != nil {
		t.Fatal(err)
	}
	defer reopened.Close()
	detail, err := reopened.Conversation("geometry")
	if err != nil || len(detail.Messages) != 4 {
		t.Fatal(detail, err)
	}
	for _, index := range []int{1, 3} {
		if detail.Messages[index].LearningVisual == nil {
			t.Fatal("lost visual")
		}
	}
	if detail.Messages[1].Status != "completed" || detail.Messages[3].Status != "interrupted" {
		t.Fatal("wrong status")
	}
	focus, _, err := reopened.StartTurn("history", "focus", "Egiziani")
	if err != nil {
		t.Fatal(err)
	}
	focus.Status = "completed"
	focus.StudyClarification = mustStudyFocus(t)
	if err = reopened.Finish(focus); err != nil {
		t.Fatal(err)
	}
	replay, ok, err := reopened.StartTurn("history", "focus", "Egiziani")
	if err != nil || !ok || replay.StudyClarification == nil {
		t.Fatal("lost clarification", err)
	}
	entries, err := reopened.Dictionary()
	if err != nil || len(entries) != 0 {
		t.Fatal("study visual saved to dictionary", err)
	}
	if err = reopened.Delete("geometry"); err != nil {
		t.Fatal(err)
	}
	var n int
	if err = reopened.db.QueryRow("SELECT count(*) FROM messages WHERE conversation_id='geometry'").Scan(&n); err != nil || n != 0 {
		t.Fatal("cascade broken", n, err)
	}
}

func TestStudyMigrationPreservesVersionSevenAttachments(t *testing.T) {
	dir := t.TempDir()
	db, err := sql.Open("sqlite", filepath.Join(dir, "lumi.db"))
	if err != nil {
		t.Fatal(err)
	}
	if _, err = db.Exec("PRAGMA foreign_keys=ON; CREATE TABLE migrations(version TEXT PRIMARY KEY)"); err != nil {
		t.Fatal(err)
	}
	entries, _ := resources.ReadDir("migrations")
	for _, entry := range entries {
		if entry.Name() >= "008_study_subjects.sql" {
			continue
		}
		data, _ := resources.ReadFile("migrations/" + entry.Name())
		if err = applyMigration(db, entry.Name(), string(data)); err != nil {
			t.Fatal(err)
		}
	}
	_, err = db.Exec(`INSERT INTO conversations(id,title,created_at,updated_at,subject) VALUES('legacy','Bank','2026-01-01T00:00:00Z','2026-01-01T00:00:00Z','english');
 INSERT INTO messages(id,conversation_id,request_id,role,text,status,created_at,word_clarification,word_explanation) VALUES('legacy-answer','legacy','legacy-request','assistant','','completed','2026-01-01T00:00:00Z','{"word":"bank","question":"In quale frase?","language":"en","examples":[]}','{"word":"bank","meaning":"riva","example":"The river bank.","exampleTranslation":"La riva del fiume."}');
 INSERT INTO dictionary_entries(id,subject,word_key,word,meaning,example,example_translation,first_asked_at,last_asked_at) VALUES('bank','english','bank','bank','riva','The river bank.','La riva del fiume.','2026-01-01T00:00:00Z','2026-01-01T00:00:00Z')`)
	if err != nil {
		t.Fatal(err)
	}
	db.Close()
	store, err := OpenStore(dir)
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	detail, err := store.Conversation("legacy")
	if err != nil || detail.Conversation.Subject != api.English || len(detail.Messages) != 1 {
		t.Fatal(detail, err)
	}
	answer := detail.Messages[0]
	if answer.Id != "legacy-answer" || answer.Status != "completed" || answer.WordClarification == nil || answer.WordExplanation == nil || answer.WordExplanation.ExampleTranslation == nil || answer.LearningVisual != nil || answer.StudyClarification != nil {
		t.Fatal("legacy attachment lost", answer)
	}
	words, err := store.Dictionary()
	if err != nil || len(words) != 1 || words[0].Subject != api.English || words[0].Id != "bank" {
		t.Fatal("dictionary changed", words, err)
	}
	if _, err = store.CreateSubject("new", "Scoperta", api.Science); err != nil {
		t.Fatal(err)
	}
	var enabled int
	if err = store.db.QueryRow("PRAGMA foreign_keys").Scan(&enabled); err != nil || enabled != 1 {
		t.Fatal("foreign keys disabled", err)
	}
	if err = applyMigration(store.db, "bad-migration", `DROP TABLE conversations`); err == nil {
		t.Fatal("accepted foreign key violation")
	}
	detail, err = store.Conversation("legacy")
	if err != nil || len(detail.Messages) != 1 {
		t.Fatal("failed migration was not rolled back", err)
	}
	if err = store.db.QueryRow("PRAGMA foreign_keys").Scan(&enabled); err != nil || enabled != 1 {
		t.Fatal("foreign keys not restored after rollback", err)
	}
}
