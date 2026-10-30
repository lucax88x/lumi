package app

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"time"

	"lumi/internal/api"
)

type Config struct{ DataDir, Origin, WebDir, OpenAIAPIKey, OIDCIssuer, OIDCInternalURL, OIDCClientID, OIDCClientSecret string }
type Server struct {
	store     *Store
	auth      *OAuth
	shared    *Server
	config    Config
	http      *http.Client
	mu        sync.Mutex
	active    map[string]context.CancelFunc
	voice     chan struct{}
	generator Generator
}
type sessionKey struct{}
type session struct{ Hash, CSRF string }

var validID = regexp.MustCompile(`^[a-zA-Z0-9_-]{1,64}$`)

func NewServer(c Config) (*Server, error) {
	return newServer(c, nil)
}
func newServer(c Config, shared *Server) (*Server, error) {
	origin, err := url.Parse(c.Origin)
	if err != nil || origin.Host == "" || (origin.Scheme != "https" && origin.Scheme != "http") || origin.Path != "" || origin.RawQuery != "" || origin.Fragment != "" || origin.User != nil {
		return nil, errors.New("PUBLIC_ORIGIN deve essere un'origine HTTP(S) senza percorso")
	}
	store, err := OpenStore(c.DataDir)
	if err != nil {
		return nil, err
	}
	var auth *OAuth
	if shared != nil {
		auth = shared.auth
	} else {
		auth, err = NewOAuth(c.DataDir)
		if err != nil {
			store.Close()
			return nil, err
		}
	}
	s := &Server{store: store, auth: auth, shared: shared, config: c, http: &http.Client{Timeout: 90 * time.Second}, active: map[string]context.CancelFunc{}, voice: make(chan struct{}, 1)}
	s.generator = &OpenAIGenerator{auth: auth, searchImages: s.searchImages}
	return s, nil
}
func (s *Server) Close() error { s.cancelAll(); return s.store.Close() }
func (s *Server) cancelAll() {
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, cancel := range s.active {
		cancel()
	}
}
func (s *Server) reserve(ctx context.Context, key string) (context.Context, func(), bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if _, ok := s.active[key]; ok {
		return nil, nil, false
	}
	ctx, cancel := context.WithTimeout(ctx, 2*time.Minute)
	s.active[key] = cancel
	return ctx, func() { cancel(); s.mu.Lock(); delete(s.active, key); s.mu.Unlock() }, true
}
func sendJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}
func problem(w http.ResponseWriter, status int, code, message string) {
	sendJSON(w, status, api.Error{Code: code, Message: message})
}
func decode(w http.ResponseWriter, r *http.Request, v any) bool {
	r.Body = http.MaxBytesReader(w, r.Body, 64<<10)
	d := json.NewDecoder(r.Body)
	d.DisallowUnknownFields()
	if err := d.Decode(v); err != nil {
		problem(w, 400, "invalid_request", "Controlla i dati inviati.")
		return false
	}
	if d.Decode(&struct{}{}) != io.EOF {
		problem(w, 400, "invalid_request", "Richiesta non valida.")
		return false
	}
	return true
}
func internalError(w http.ResponseWriter, err error) {
	slog.Error("storage operation failed", "error", err)
	problem(w, 500, "storage_error", "Non riesco a salvare i dati. Riprova tra poco.")
}
func (s *Server) lookupSession(r *http.Request) session {
	sess, _ := r.Context().Value(sessionKey{}).(session)
	return sess
}
func (s *Server) static(w http.ResponseWriter, r *http.Request) {
	path := filepath.Clean("/" + r.URL.Path)
	full := filepath.Join(s.config.WebDir, path)
	info, err := os.Stat(full)
	if err != nil || info.IsDir() {
		if filepath.Ext(path) != "" {
			http.NotFound(w, r)
			return
		}
		full = filepath.Join(s.config.WebDir, "index.html")
	}
	if strings.HasPrefix(path, "/assets/") {
		w.Header().Set("Cache-Control", "private, max-age=31536000, immutable")
	} else {
		w.Header().Set("Cache-Control", "no-store")
	}
	http.ServeFile(w, r, full)
}
func (s *Server) GetStatus(w http.ResponseWriter, r *http.Request) {
	v, err := s.settings()
	if err != nil {
		internalError(w, err)
		return
	}
	sendJSON(w, 200, api.PublicStatus{Ready: s.auth.Status().Connected && v.Model != "", AutoRead: v.AutoRead, SpeechRate: v.SpeechRate})
}
func (s *Server) GetSettings(w http.ResponseWriter, r *http.Request) {
	subject, ok := requestSubject(w, r)
	if !ok {
		return
	}
	v, err := s.settingsForSubject(subject)
	if err != nil {
		internalError(w, err)
		return
	}
	sendJSON(w, 200, v)
}
func (s *Server) UpdateSettings(w http.ResponseWriter, r *http.Request) {
	subject, ok := requestSubject(w, r)
	if !ok {
		return
	}
	var v api.Settings
	if !decode(w, r, &v) {
		return
	}
	if len(strings.TrimSpace(v.Prompt)) == 0 || len(v.Prompt) > 20000 || v.SpeechRate < 0.5 || v.SpeechRate > 1.5 {
		problem(w, 400, "invalid_settings", "Controlla prompt e velocità della voce.")
		return
	}
	old, err := s.settings()
	if err != nil {
		internalError(w, err)
		return
	}
	if v.Model != old.Model {
		if s.shared != nil {
			problem(w, 403, "admin_required", "Il modello condiviso si sceglie nella sezione Admin.")
			return
		}
		models, err := s.auth.Models(r.Context())
		if err != nil {
			problem(w, 502, "models_unavailable", err.Error())
			return
		}
		found := false
		for _, m := range models {
			if m.Slug == v.Model {
				found = true
			}
		}
		if !found {
			problem(w, 400, "invalid_model", "Scegli un modello disponibile nel tuo account.")
			return
		}
	}
	if err = s.store.saveSubjectSettings(subject, v); err != nil {
		internalError(w, err)
		return
	}
	v.DefaultPrompt = defaultSubjectPrompt(subject)
	sendJSON(w, 200, v)
}

// Teaching preferences and history remain private; the model comes from Admin.
func (s *Server) settings() (api.Settings, error) {
	settings, err := s.store.Settings()
	if err != nil || s.shared == nil {
		return settings, err
	}
	global, err := s.shared.store.Settings()
	settings.Model = global.Model
	return settings, err
}
func (s *Server) ListConversations(w http.ResponseWriter, r *http.Request) {
	v, err := s.store.Conversations()
	if err != nil {
		internalError(w, err)
		return
	}
	sendJSON(w, 200, v)
}
func (s *Server) CreateConversation(w http.ResponseWriter, r *http.Request) {
	var b api.NewConversation
	if !decode(w, r, &b) {
		return
	}
	b.Title = strings.TrimSpace(b.Title)
	if !validID.MatchString(b.Id) || b.Title == "" || len([]rune(b.Title)) > 100 {
		problem(w, 400, "invalid_conversation", "Scrivi una domanda breve.")
		return
	}
	subject := api.Italian
	if b.Subject != nil {
		subject = *b.Subject
	}
	subject, ok := normalizeSubject(subject)
	if !ok {
		problem(w, 400, "invalid_subject", "Scegli Italiano o Inglese.")
		return
	}
	v, err := s.store.CreateSubject(b.Id, b.Title, subject)
	if errors.Is(err, errConversationSubjectConflict) {
		problem(w, 409, "conversation_conflict", "Questa conversazione usa già un’altra materia. Apri una nuova domanda.")
		return
	}
	if err != nil {
		internalError(w, err)
		return
	}
	sendJSON(w, 200, v)
}
func (s *Server) GetConversation(w http.ResponseWriter, r *http.Request, id string) {
	v, err := s.store.Conversation(id)
	if errors.Is(err, sql.ErrNoRows) {
		problem(w, 404, "not_found", "Questa domanda non c'è più.")
		return
	}
	if err != nil {
		internalError(w, err)
		return
	}
	sendJSON(w, 200, v)
}
func (s *Server) delete(w http.ResponseWriter, id string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if (id == "" && len(s.active) > 0) || s.active[id] != nil {
		problem(w, 409, "busy", "Aspetta che Lumi finisca prima di eliminare le conversazioni.")
		return
	}
	if err := s.store.Delete(id); err != nil {
		internalError(w, err)
		return
	}
	w.WriteHeader(204)
}
func (s *Server) DeleteConversation(w http.ResponseWriter, r *http.Request, id string) {
	s.delete(w, id)
}
func (s *Server) ClearConversations(w http.ResponseWriter, r *http.Request) { s.delete(w, "") }
func (s *Server) GetConnection(w http.ResponseWriter, r *http.Request) {
	status := s.auth.Status()
	status.TranscriptionConfigured = strings.TrimSpace(s.config.OpenAIAPIKey) != ""
	sendJSON(w, 200, status)
}
func (s *Server) StartConnection(w http.ResponseWriter, r *http.Request) {
	sendJSON(w, 200, s.auth.Start(s.lookupSession(r).Hash))
}
func (s *Server) CompleteConnection(w http.ResponseWriter, r *http.Request) {
	var b api.OAuthComplete
	if !decode(w, r, &b) {
		return
	}
	if len(b.CallbackUrl) > 8192 {
		problem(w, 400, "invalid_callback", "URL troppo lungo.")
		return
	}
	if err := s.auth.Complete(r.Context(), s.lookupSession(r).Hash, b.CallbackUrl); err != nil {
		problem(w, 400, "connection_failed", err.Error())
		return
	}
	models, err := s.auth.Models(r.Context())
	if err == nil && len(models) > 0 {
		v, e := s.store.Settings()
		if e != nil {
			internalError(w, e)
			return
		}
		available := false
		for _, m := range models {
			if v.Model == m.Slug {
				available = true
			}
		}
		if !available {
			v.Model = models[0].Slug
			if e = s.store.SaveSettings(v); e != nil {
				internalError(w, e)
				return
			}
		}
	}
	status := s.auth.Status()
	status.TranscriptionConfigured = strings.TrimSpace(s.config.OpenAIAPIKey) != ""
	if err != nil {
		status.Message = "Collegamento riuscito. Riprova il caricamento dei modelli."
	}
	sendJSON(w, 200, status)
}
func (s *Server) Disconnect(w http.ResponseWriter, r *http.Request) {
	s.cancelAll()
	if err := s.auth.Disconnect(r.Context()); err != nil {
		problem(w, 502, "revocation_failed", err.Error())
		return
	}
	w.WriteHeader(204)
}
func (s *Server) ListModels(w http.ResponseWriter, r *http.Request) {
	models, err := s.auth.Models(r.Context())
	if err != nil {
		problem(w, 502, "models_unavailable", err.Error())
		return
	}
	sendJSON(w, 200, models)
}
