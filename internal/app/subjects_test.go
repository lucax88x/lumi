package app

import (
	"context"
	"database/sql"
	"encoding/json"
	"net/http"
	"path/filepath"
	"reflect"
	"strings"
	"testing"

	"lumi/internal/api"
)

func englishWord(source, language string) api.WordExplanation {
	lang := api.WordExplanationSourceLanguage(language)
	translation := "Il cane è felice."
	return api.WordExplanation{Word: "dog", Meaning: "cane", Example: "The dog is happy.", ExampleTranslation: &translation, SourceWord: &source, SourceLanguage: &lang}
}
func TestEnglishWordValidation(t *testing.T) {
	for _, tc := range []struct {
		name, source, language, question string
		valid                            bool
	}{
		{"english", "dog", "en", "Cosa significa dog?", true},
		{"italian", "cane", "it", "Come si dice cane?", true},
		{"elided article", "cane", "it", "Come si dice il cane?", true},
		{"substring", "cane", "it", "canevas", false},
		{"invented source", "gatto", "it", "Come si dice cane?", false},
		{"changed english", "dogs", "en", "dogs", false},
		{"invalid language", "dog", "fr", "dog", false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			word := englishWord(tc.source, tc.language)
			result, problem := executeProfileWord(wordArguments(t, word), []api.Message{{Role: "user", Text: tc.question}}, api.English)
			if (result != nil) != tc.valid || (problem == "") != tc.valid {
				t.Fatalf("word=%+v problem=%s", result, problem)
			}
		})
	}
	word := englishWord("gelato", "it")
	word.Word = "ice cream"
	if result, problem := executeProfileWord(wordArguments(t, word), []api.Message{{Role: "user", Text: "come si dice gelato?"}}, api.English); result == nil {
		t.Fatal(problem)
	}
	if result, _ := executeProfileWord(wordArguments(t, word), []api.Message{{Role: "assistant", Text: "gelato"}}, api.English); result != nil {
		t.Fatal("accepted invented source")
	}
	word.ExampleTranslation = nil
	if result, _ := executeProfileWord(wordArguments(t, word), []api.Message{{Role: "user", Text: "gelato"}}, api.English); result != nil {
		t.Fatal("accepted missing translation")
	}
}

func TestEnglishToolsAndStreaming(t *testing.T) {
	word := englishWord("cane", "it")
	calls := 0
	g := toolGenerator(t, func(r *http.Request) (*http.Response, error) {
		calls++
		body := requestBody(t, r)
		if calls == 1 {
			instructions := body["instructions"].(string)
			if !strings.Contains(instructions, "Parla sempre in italiano") || strings.Contains(instructions, "vigoroso → forte") {
				t.Fatal("wrong subject instructions")
			}
			tools := body["tools"].([]any)[0].(map[string]any)["tools"].([]any)
			properties := tools[3].(map[string]any)["parameters"].(map[string]any)["properties"].(map[string]any)
			if properties["sourceWord"] == nil || properties["exampleTranslation"] == nil {
				t.Fatal("missing bilingual tool schema")
			}
			call := toolCall("english-word", wordArguments(t, word))
			call["name"] = "show_word_explanation"
			return streamedItems([]any{call}), nil
		}
		return completedStream("", nil), nil
	})
	var events []GenerationEvent
	ctx := context.WithValue(context.Background(), subjectKey{}, api.English)
	err := g.Stream(ctx, api.Settings{Model: "test", Prompt: "Usa parole semplici."}, []api.Message{{Role: "user", Text: "Come si dice cane?", Status: "completed"}}, func(event GenerationEvent) error { events = append(events, event); return nil })
	if err != nil || calls != 2 || len(events) != 1 || !reflect.DeepEqual(events[0].WordExplanation, &word) {
		t.Fatalf("err=%v events=%+v", err, events)
	}
}

func TestEnglishMaps(t *testing.T) {
	language := api.SentenceMapLanguage("en")
	translation := "Il gatto dorme."
	cat := "Il gatto"
	sleep := "dorme."
	m := api.SentenceMap{Sentence: "The cat sleeps.", Language: &language, Translation: &translation, Parts: []api.SentencePart{
		{Text: "The cat", Question: "Chi?", Explanation: "Si parla del gatto.", Translation: &cat},
		{Text: "sleeps.", Question: "Che cosa fa?", Explanation: "Sta dormendo.", Translation: &sleep},
	}}
	history := []api.Message{{Role: "user", Text: m.Sentence}}
	encoded, _ := json.Marshal(m)
	if result, problem := executeProfileSentenceMap(string(encoded), history, api.English); result == nil {
		t.Fatal(problem)
	}
	m.Parts[0].Translation = nil
	encoded, _ = json.Marshal(m)
	if result, _ := executeProfileSentenceMap(string(encoded), history, api.English); result != nil {
		t.Fatal("accepted missing part translation")
	}
	m.Parts[0].Translation = &cat
	m.Parts[0].Text = "A cat"
	encoded, _ = json.Marshal(m)
	if result, _ := executeProfileSentenceMap(string(encoded), history, api.English); result != nil {
		t.Fatal("accepted changed source")
	}
	topic := api.TopicMap{Title: "Animali", Branches: []api.TopicBranch{
		{Label: "Pets", Explanation: "Animali domestici.", Items: []api.TopicItem{{Label: "Dog", Explanation: "Cane."}}},
		{Label: "Farm animals", Explanation: "Animali della fattoria.", Items: []api.TopicItem{{Label: "Cow", Explanation: "Mucca."}}},
	}}
	encoded, _ = json.Marshal(topic)
	if result, _ := executeProfileTopicMap(string(encoded), api.English); result != nil {
		t.Fatal("accepted missing label language")
	}
	labelLanguage := api.TopicMapLabelLanguage("en")
	topic.LabelLanguage = &labelLanguage
	encoded, _ = json.Marshal(topic)
	if result, problem := executeProfileTopicMap(string(encoded), api.English); result == nil {
		t.Fatal(problem)
	}
}

type subjectGenerator struct {
	subject api.Subject
	prompt  string
	calls   int
	fail    bool
}

func (g *subjectGenerator) Stream(ctx context.Context, settings api.Settings, _ []api.Message, emit func(GenerationEvent) error) error {
	g.subject = contextSubject(ctx)
	g.prompt = settings.Prompt
	g.calls++
	word := englishWord("cane", "it")
	if err := emit(GenerationEvent{WordExplanation: &word}); err != nil {
		return err
	}
	if g.fail {
		return context.Canceled
	}
	return nil
}
func TestSubjectAPISettingsPersistenceAndReplay(t *testing.T) {
	s := testServer(t)
	setupChat(t, s)
	cookie, csrf := adminLogin(t, s)
	old, err := s.store.Settings()
	if err != nil {
		t.Fatal(err)
	}
	old.Prompt = "Istruzioni italiane personalizzate."
	if err := s.store.SaveSettings(old); err != nil {
		t.Fatal(err)
	}
	english := old
	english.Prompt = "Istruzioni inglesi personalizzate."
	english.SpeechRate = 0.8
	encoded, _ := json.Marshal(english)
	response := call(s, "PUT", "/api/v1/admin/settings?subject=english", string(encoded), s.config.Origin, cookie, csrf)
	if response.Code != 200 {
		t.Fatal(response.Body.String())
	}
	for _, subject := range []api.Subject{api.Italian, api.English} {
		settings, err := s.settingsForSubject(subject)
		if err != nil {
			t.Fatal(err)
		}
		want := old.Prompt
		if subject == api.English {
			want = english.Prompt
		}
		if settings.Prompt != want || settings.SpeechRate != 0.8 || settings.DefaultPrompt != defaultSubjectPrompt(subject) {
			t.Fatalf("settings=%+v", settings)
		}
	}
	response = call(s, "POST", "/api/v1/conversations", `{"id":"english","title":"Cane","subject":"english"}`, s.config.Origin, nil, "")
	if response.Code != 200 || !strings.Contains(response.Body.String(), `"subject":"english"`) {
		t.Fatal(response.Body.String())
	}
	if conflict := call(s, "POST", "/api/v1/conversations", `{"id":"english","title":"Altra materia","subject":"italian"}`, s.config.Origin, nil, ""); conflict.Code != 409 {
		t.Fatalf("subject conflict status=%d", conflict.Code)
	}
	g := &subjectGenerator{}
	s.generator = g
	body := `{"requestId":"english-turn","text":"Come si dice cane?","action":"message"}`
	response = call(s, "POST", "/api/v1/conversations/english/messages", body, s.config.Origin, nil, "")
	if !strings.Contains(response.Body.String(), `"type":"completed"`) || g.subject != api.English || g.prompt != english.Prompt {
		t.Fatalf("subject=%s prompt=%s body=%s", g.subject, g.prompt, response.Body.String())
	}
	call(s, "POST", "/api/v1/conversations/english/messages", body, s.config.Origin, nil, "")
	if g.calls != 1 {
		t.Fatal("replay regenerated")
	}
	// The same spelling can have independent Italian and English entries.
	italianWord := englishWord("dog", "en")
	italianWord.ExampleTranslation = nil
	s.generator = &wordGenerator{word: italianWord}
	call(s, "POST", "/api/v1/conversations/one/messages", `{"requestId":"italian-turn","text":"dog","action":"message"}`, s.config.Origin, nil, "")
	reopened, err := OpenStore(s.config.DataDir)
	if err != nil {
		t.Fatal(err)
	}
	defer reopened.Close()
	entries, err := reopened.Dictionary()
	if err != nil || len(entries) != 2 {
		t.Fatalf("entries=%+v err=%v", entries, err)
	}
	for _, entry := range entries {
		if entry.Subject == api.English && (entry.ExampleTranslation == nil || *entry.ExampleTranslation != "Il cane è felice.") {
			t.Fatal("lost example translation")
		}
	}
	detail, err := reopened.Conversation("english")
	if err != nil || detail.Conversation.Subject != api.English || detail.Messages[1].WordExplanation.SourceWord == nil {
		t.Fatal("lost profile or source")
	}
	// Preview selects English but never saves a conversation or dictionary entry.
	s.generator = g
	preview := `{"subject":"english","prompt":"Prompt di prova","model":"test","text":"cane"}`
	response = call(s, "POST", "/api/v1/admin/preview", preview, s.config.Origin, cookie, csrf)
	if response.Code != 200 || g.subject != api.English || g.prompt != "Prompt di prova" {
		t.Fatal(response.Body.String())
	}
	entries, _ = s.store.Dictionary()
	if len(entries) != 2 {
		t.Fatal("preview saved a word")
	}
	for _, endpoint := range []string{"/api/v1/admin/settings?subject=math", "/api/v1/transcriptions?subject=math"} {
		method := "GET"
		if strings.Contains(endpoint, "transcriptions") {
			method = "POST"
		}
		if res := call(s, method, endpoint, `{}`, s.config.Origin, cookie, csrf); res.Code != 400 {
			t.Fatalf("unsupported subject accepted: %s %d", endpoint, res.Code)
		}
	}
}
func TestEnglishInterruptedTurnDoesNotSaveDictionary(t *testing.T) {
	s := testServer(t)
	setupChat(t, s)
	if _, err := s.store.CreateSubject("english", "Cane", api.English); err != nil {
		t.Fatal(err)
	}
	s.generator = &subjectGenerator{fail: true}
	call(s, "POST", "/api/v1/conversations/english/messages", `{"requestId":"failed","text":"cane","action":"message"}`, s.config.Origin, nil, "")
	entries, err := s.store.Dictionary()
	if err != nil || len(entries) != 0 {
		t.Fatal("interrupted card saved")
	}
	detail, err := s.store.Conversation("english")
	if err != nil || detail.Messages[1].Status != "interrupted" || detail.Messages[1].WordExplanation.ExampleTranslation == nil {
		t.Fatal("lost interrupted checkpoint")
	}
}
func TestSubjectMigrationPreservesLegacyData(t *testing.T) {
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
		if entry.Name() >= "006_subjects.sql" {
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
	_, err = db.Exec(`INSERT INTO conversations VALUES('old','La parola','2026-01-01T00:00:00Z','2026-01-01T00:00:00Z'); INSERT INTO dictionary_entries VALUES('word','vigoroso','vigoroso','forte','Un calcio vigoroso.','2026-01-01T00:00:00Z','2026-01-01T00:00:00Z')`)
	if err != nil {
		t.Fatal(err)
	}
	db.Close()
	store, err := OpenStore(dir)
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	detail, err := store.Conversation("old")
	if err != nil || detail.Conversation.Subject != api.Italian {
		t.Fatal("legacy conversation lost")
	}
	entries, err := store.Dictionary()
	if err != nil || len(entries) != 1 || entries[0].Subject != api.Italian || entries[0].Id != "word" || entries[0].Meaning != "forte" {
		t.Fatalf("entries=%+v err=%v", entries, err)
	}
}
