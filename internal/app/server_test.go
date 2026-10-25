package app

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"lumi/internal/api"
)

func testServer(t *testing.T) *Server {
	t.Helper()
	s, err := NewServer(Config{DataDir: t.TempDir(), Origin: "https://lumi.test", WebDir: t.TempDir()})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { s.Close() })
	return s
}
func call(s *Server, method, path, body, origin string, cookie *http.Cookie, csrf string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(method, path, strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	if origin != "" {
		req.Header.Set("Origin", origin)
	}
	if cookie != nil {
		req.AddCookie(cookie)
	}
	if csrf != "" {
		req.Header.Set("X-CSRF-Token", csrf)
	}
	w := httptest.NewRecorder()
	familyTestHandler(s).ServeHTTP(w, req)
	return w
}

// Family handler tests exercise the private runtime; portal authentication has its own integration tests.
func adminLogin(t *testing.T, s *Server) (*http.Cookie, string) {
	t.Helper()
	return &http.Cookie{Name: "lumi_session", Value: "test-session", HttpOnly: true, Secure: true, SameSite: http.SameSiteLaxMode}, "test-csrf"
}
func familyTestHandler(s *Server) http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/v1/status", func(w http.ResponseWriter, r *http.Request) { s.GetStatus(w, r) })
	mux.HandleFunc("GET /api/v1/conversations", func(w http.ResponseWriter, r *http.Request) { s.ListConversations(w, r) })
	mux.HandleFunc("POST /api/v1/conversations", func(w http.ResponseWriter, r *http.Request) { s.CreateConversation(w, r) })
	mux.HandleFunc("GET /api/v1/conversations/{conversationId}", func(w http.ResponseWriter, r *http.Request) { s.GetConversation(w, r, r.PathValue("conversationId")) })
	mux.HandleFunc("POST /api/v1/conversations/{conversationId}/messages", func(w http.ResponseWriter, r *http.Request) { s.SendMessage(w, r, r.PathValue("conversationId")) })
	mux.HandleFunc("POST /api/v1/transcriptions", func(w http.ResponseWriter, r *http.Request) { s.Transcribe(w, r) })
	mux.HandleFunc("GET /api/v1/admin/settings", func(w http.ResponseWriter, r *http.Request) { s.GetSettings(w, r) })
	mux.HandleFunc("PUT /api/v1/admin/settings", func(w http.ResponseWriter, r *http.Request) { s.UpdateSettings(w, r) })
	mux.HandleFunc("GET /api/v1/admin/connection", func(w http.ResponseWriter, r *http.Request) { s.GetConnection(w, r) })
	mux.HandleFunc("DELETE /api/v1/admin/connection", func(w http.ResponseWriter, r *http.Request) { s.Disconnect(w, r) })
	mux.HandleFunc("POST /api/v1/admin/connection/start", func(w http.ResponseWriter, r *http.Request) { s.StartConnection(w, r) })
	mux.HandleFunc("POST /api/v1/admin/connection/complete", func(w http.ResponseWriter, r *http.Request) { s.CompleteConnection(w, r) })
	mux.HandleFunc("GET /api/v1/admin/models", func(w http.ResponseWriter, r *http.Request) { s.ListModels(w, r) })
	mux.HandleFunc("POST /api/v1/admin/preview", func(w http.ResponseWriter, r *http.Request) { s.PreviewPrompt(w, r) })
	mux.HandleFunc("DELETE /api/v1/admin/conversations", func(w http.ResponseWriter, r *http.Request) { s.ClearConversations(w, r) })
	mux.HandleFunc("DELETE /api/v1/admin/conversations/{conversationId}", func(w http.ResponseWriter, r *http.Request) {
		s.DeleteConversation(w, r, r.PathValue("conversationId"))
	})
	mux.HandleFunc("GET /api/v1/word-images", func(w http.ResponseWriter, r *http.Request) {
		s.SearchWordImages(w, r, api.SearchWordImagesParams{Word: r.URL.Query().Get("word")})
	})

	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != "GET" && r.Header.Get("Origin") != s.config.Origin {
			problem(w, 403, "origin_mismatch", "Origine non valida.")
			return
		}
		if strings.HasPrefix(r.URL.Path, "/api/v1/admin/") {
			c, e := r.Cookie("lumi_session")
			if e != nil || c.Value != "test-session" {
				problem(w, 401, "unauthorized", "Accedi.")
				return
			}
			if r.Method != "GET" && r.Header.Get("X-CSRF-Token") != "test-csrf" {
				problem(w, 403, "csrf", "Sessione non valida.")
				return
			}
			r = r.WithContext(context.WithValue(r.Context(), sessionKey{}, session{Hash: "test-session", CSRF: "test-csrf"}))
		}
		mux.ServeHTTP(w, r)
	})
}

type fakeGenerator struct {
	calls   atomic.Int32
	fail    bool
	entered chan struct{}
	unblock chan struct{}
}

func (g *fakeGenerator) Stream(ctx context.Context, _ api.Settings, _ []api.Message, delta func(GenerationEvent) error) error {
	g.calls.Add(1)
	if g.entered != nil {
		close(g.entered)
		select {
		case <-g.unblock:
		case <-ctx.Done():
			return ctx.Err()
		}
	}
	if err := delta(GenerationEvent{Text: "Meraviglia è una bella sorpresa."}); err != nil {
		return err
	}
	if g.fail {
		return errors.New("interrotto")
	}
	return nil
}
func setupChat(t *testing.T, s *Server) *fakeGenerator {
	t.Helper()
	settings := defaultSettings()
	settings.Model = "test-model"
	if err := s.store.SaveSettings(settings); err != nil {
		t.Fatal(err)
	}
	_, err := s.store.Create("one", "Meraviglia")
	if err != nil {
		t.Fatal(err)
	}
	_, _ = s.store.Create("two", "Seconda domanda")
	g := &fakeGenerator{}
	s.generator = g
	return g
}
func TestStreamingPersistenceIdempotencyAndIsolation(t *testing.T) {
	s := testServer(t)
	g := setupChat(t, s)
	body := `{"requestId":"req-1","text":"Meraviglia","action":"message"}`
	for range 2 {
		w := call(s, "POST", "/api/v1/conversations/one/messages", body, s.config.Origin, nil, "")
		if w.Code != 200 || !strings.Contains(w.Body.String(), `"type":"completed"`) {
			t.Fatal(w.Body.String())
		}
	}
	if g.calls.Load() != 1 {
		t.Fatal("duplicate upstream call")
	}
	d, _ := s.store.Conversation("one")
	if len(d.Messages) != 2 || d.Messages[1].Status != "completed" {
		t.Fatal("turn not persisted")
	}
	other, _ := s.store.Conversation("two")
	if len(other.Messages) != 0 {
		t.Fatal("conversation context leaked")
	}
	w := call(s, "POST", "/api/v1/conversations/one/messages", strings.Replace(body, "Meraviglia", "different", 1), s.config.Origin, nil, "")
	if w.Code != 409 {
		t.Fatal("request ID reused with different input")
	}
	cookie, csrf := adminLogin(t, s)
	w = call(s, "DELETE", "/api/v1/admin/conversations/one", "", s.config.Origin, cookie, csrf)
	if w.Code != 204 {
		t.Fatal(w.Body.String())
	}
	var count int
	_ = s.store.db.QueryRow(`SELECT count(*) FROM messages WHERE conversation_id='one'`).Scan(&count)
	if count != 0 {
		t.Fatal("messages not deleted")
	}
}
func TestPartialAnswerSurvivesRestart(t *testing.T) {
	s := testServer(t)
	g := setupChat(t, s)
	g.fail = true
	w := call(s, "POST", "/api/v1/conversations/one/messages", `{"requestId":"partial","text":"Meraviglia","action":"message"}`, s.config.Origin, nil, "")
	if !strings.Contains(w.Body.String(), `"type":"failed"`) {
		t.Fatal(w.Body.String())
	}
	d, _ := s.store.Conversation("one")
	if d.Messages[1].Text == "" || d.Messages[1].Status != "interrupted" {
		t.Fatal("lost partial answer")
	}
	_, _, err := s.store.StartTurn("two", "crash", "test")
	if err != nil {
		t.Fatal(err)
	}
	_ = s.store.Close()
	restored, err := OpenStore(s.config.DataDir)
	if err != nil {
		t.Fatal(err)
	}
	s.store = restored
	d, _ = restored.Conversation("two")
	if d.Messages[1].Status != "interrupted" {
		t.Fatal("restart left a permanently streaming message")
	}
}
func TestConcurrentTurnsAndDeleteAreRejected(t *testing.T) {
	s := testServer(t)
	g := setupChat(t, s)
	g.entered = make(chan struct{})
	g.unblock = make(chan struct{})
	done := make(chan struct{})
	go func() {
		defer close(done)
		call(s, "POST", "/api/v1/conversations/one/messages", `{"requestId":"first","text":"test","action":"message"}`, s.config.Origin, nil, "")
	}()
	<-g.entered
	w := call(s, "POST", "/api/v1/conversations/one/messages", `{"requestId":"second","text":"test","action":"message"}`, s.config.Origin, nil, "")
	if w.Code != 409 {
		t.Fatal("concurrent turn allowed")
	}
	cookie, csrf := adminLogin(t, s)
	w = call(s, "DELETE", "/api/v1/admin/conversations/one", "", s.config.Origin, cookie, csrf)
	if w.Code != 409 {
		t.Fatal("deleted active conversation")
	}
	close(g.unblock)
	<-done
}
func TestOfficialSDKSubscriptionContract(t *testing.T) {
	t.Setenv("OPENAI_API_KEY", "paid-audio-key-must-not-be-used-for-chat")
	var requests atomic.Int32
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requests.Add(1)
		if r.URL.Path != "/responses" {
			t.Errorf("wrong path %s", r.URL.Path)
		}
		if r.Header.Get("Authorization") != "Bearer test-access" {
			t.Error("wrong token")
		}
		b, _ := io.ReadAll(r.Body)
		var body map[string]any
		_ = json.Unmarshal(b, &body)
		if body["store"] != false || body["stream"] != true || body["instructions"] != "test prompt\n\n"+imageInstructions+"\n\n"+sentenceMapInstructions+"\n\n"+topicMapInstructions {
			t.Errorf("wrong params %s", b)
		}
		for _, field := range []string{"temperature", "max_output_tokens", "previous_response_id", "conversation", "safety_identifier"} {
			if _, ok := body[field]; ok {
				t.Errorf("unsupported %s", field)
			}
		}
		input, ok := body["input"].([]any)
		if !ok || len(input) != 1 {
			t.Error("input must contain explicit context")
		}
		w.Header().Set("Content-Type", "text/event-stream")
		fmtStream := `data: {"type":"response.output_text.delta","delta":"Ciao!","sequence_number":1}` + "\n\n" + `data: {"type":"response.completed","response":{"status":"completed","output":[]},"sequence_number":2}` + "\n\n"
		_, _ = io.WriteString(w, fmtStream)
	}))
	defer upstream.Close()
	auth, err := NewOAuth(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	auth.apiURL = upstream.URL
	auth.creds = credentials{AccessToken: "test-access", RefreshToken: "refresh", Scopes: permission, ExpiresAt: time.Now().Add(time.Hour)}
	g := OpenAIGenerator{auth: auth}
	var text string
	err = g.Stream(context.Background(), api.Settings{Model: "test", Prompt: "test prompt"}, []api.Message{{Role: "user", Text: "ciao", Status: "completed"}}, func(e GenerationEvent) error { text += e.Text; return nil })
	if err != nil || text != "Ciao!" || requests.Load() != 1 {
		t.Fatalf("stream failed %q %v", text, err)
	}
}
