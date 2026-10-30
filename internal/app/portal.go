package app

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/coreos/go-oidc/v3/oidc"
	"golang.org/x/oauth2"
	"lumi/internal/api"
)

// Portal is the only HTTP entrypoint. Family servers are private runtimes, never listeners.
type Portal struct {
	config     Config
	db         *sql.DB
	provider   *oidc.Provider
	oauth      oauth2.Config
	client     *http.Client
	familiesMu sync.Mutex
	families   map[string]*Server
	admin      *Server    // One ChatGPT grant and model shared by every family.
	sessionMu  sync.Mutex // Serialize rotating refresh-token use across concurrent browser requests.
}
type portalSession struct {
	Hash, CSRF, UserID, Email    string
	Verified, Access, Admin      bool
	AccessToken, RefreshToken    string
	AccessExpires, Expires, Idle int64
}
type portalSessionKey struct{}

// Discovery retains the canonical public issuer; only transport to this exact origin
// is routed through the private container network. Redirects are never followed.
type issuerTransport struct {
	public, internal *url.URL
	base             http.RoundTripper
}

func (t issuerTransport) RoundTrip(r *http.Request) (*http.Response, error) {
	c := r.Clone(r.Context())
	u := *r.URL
	c.URL = &u
	if u.Scheme == t.public.Scheme && u.Host == t.public.Host && strings.HasPrefix(u.Path, t.public.Path+"/") {
		c.URL.Scheme = t.internal.Scheme
		c.URL.Host = t.internal.Host
		c.URL.Path = t.internal.Path + strings.TrimPrefix(u.Path, t.public.Path)
		c.Host = t.public.Host
	}
	return t.base.RoundTrip(c)
}
func NewPortal(ctx context.Context, c Config) (*Portal, error) {
	origin, err := url.Parse(c.Origin)
	if err != nil || origin.Host == "" || (origin.Scheme != "http" && origin.Scheme != "https") || origin.Path != "" || origin.RawQuery != "" || origin.Fragment != "" || origin.User != nil {
		return nil, errors.New("PUBLIC_ORIGIN must be an HTTP(S) origin without a path")
	}
	if c.OIDCIssuer == "" || c.OIDCClientID == "" || c.OIDCClientSecret == "" {
		return nil, errors.New("OIDC issuer, client ID and client secret are required")
	}
	issuer, err := url.Parse(c.OIDCIssuer)
	if err != nil || issuer.Host == "" || issuer.User != nil || issuer.RawQuery != "" || issuer.Fragment != "" || (issuer.Scheme != "http" && issuer.Scheme != "https") {
		return nil, errors.New("invalid OIDC issuer")
	}
	client := &http.Client{Timeout: 15 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	if c.OIDCInternalURL != "" {
		internal, e := url.Parse(c.OIDCInternalURL)
		if e != nil || internal.Host == "" || internal.User != nil || internal.RawQuery != "" || internal.Fragment != "" || (internal.Scheme != "http" && internal.Scheme != "https") {
			return nil, errors.New("invalid private OIDC URL")
		}
		client.Transport = issuerTransport{issuer, internal, http.DefaultTransport}
	}
	provider, err := oidc.NewProvider(oidc.ClientContext(ctx, client), c.OIDCIssuer)
	if err != nil {
		return nil, fmt.Errorf("OIDC discovery: %w", err)
	}
	db, err := openControl(c.DataDir)
	if err != nil {
		return nil, err
	}
	p := &Portal{config: c, db: db, provider: provider, client: client, families: map[string]*Server{}}
	p.admin, err = newSharedServer(c)
	if err != nil {
		db.Close()
		return nil, err
	}
	p.oauth = oauth2.Config{ClientID: c.OIDCClientID, ClientSecret: c.OIDCClientSecret, Endpoint: provider.Endpoint(), RedirectURL: c.Origin + "/auth/callback", Scopes: []string{oidc.ScopeOpenID, "profile", "email"}}
	return p, nil
}
func openControl(dir string) (*sql.DB, error) {
	dir = filepath.Join(dir, "portal")
	if err := os.MkdirAll(dir, 0700); err != nil {
		return nil, err
	}
	db, err := sql.Open("sqlite", filepath.Join(dir, "control.db"))
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(1)
	fail := func(e error) (*sql.DB, error) { db.Close(); return nil, e }
	if _, err = db.Exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS migrations(version TEXT PRIMARY KEY)`); err != nil {
		return fail(err)
	}
	if err = os.Chmod(filepath.Join(dir, "control.db"), 0600); err != nil {
		return fail(err)
	}
	entries, err := resources.ReadDir("control_migrations")
	if err != nil {
		return fail(err)
	}
	for _, entry := range entries {
		var count int
		if err = db.QueryRow(`SELECT count(*) FROM migrations WHERE version=?`, entry.Name()).Scan(&count); err != nil {
			return fail(err)
		}
		if count > 0 {
			continue
		}
		b, e := resources.ReadFile("control_migrations/" + entry.Name())
		if e != nil {
			return fail(e)
		}
		tx, e := db.Begin()
		if e != nil {
			return fail(e)
		}
		if _, e = tx.Exec(string(b)); e == nil {
			_, e = tx.Exec(`INSERT INTO migrations VALUES(?)`, entry.Name())
		}
		if e != nil {
			tx.Rollback()
			return fail(e)
		}
		if e = tx.Commit(); e != nil {
			return fail(e)
		}
	}
	return db, nil
}
func (p *Portal) Close() error {
	p.familiesMu.Lock()
	defer p.familiesMu.Unlock()
	for _, f := range p.families {
		f.Close()
	}
	if p.admin != nil {
		p.admin.Close()
	}
	return p.db.Close()
}
func (p *Portal) family(id string) (*Server, error) {
	p.familiesMu.Lock()
	defer p.familiesMu.Unlock()
	if !validID.MatchString(id) {
		return nil, errors.New("invalid family")
	}
	// Recheck inside the registry lock: an authorized request may have waited
	// here while another request suspended or deleted the family.
	var enabled bool
	if err := p.db.QueryRow(`SELECT access_enabled FROM families WHERE id=?`, id).Scan(&enabled); err != nil {
		return nil, err
	}
	if !enabled {
		return nil, errFamilySuspended
	}
	if f := p.families[id]; f != nil {
		return f, nil
	}
	if p.admin == nil {
		return nil, errors.New("shared connection is unavailable")
	}
	c := p.config
	c.DataDir = filepath.Join(c.DataDir, "families", id)
	f, err := newServer(c, p.admin)
	if err != nil {
		return nil, err
	}
	p.families[id] = f
	return f, nil
}

var errFamilySuspended = errors.New("family suspended")

func (p *Portal) withFamily(w http.ResponseWriter, r *http.Request, id string, parent bool, serve func(*Server)) {
	sess := currentSession(r)
	var role string
	var enabled bool
	err := p.db.QueryRow(`SELECT m.role,f.access_enabled FROM memberships m JOIN families f ON f.id=m.family_id WHERE family_id=? AND user_id=?`, id, sess.UserID).Scan(&role, &enabled)
	if errors.Is(err, sql.ErrNoRows) {
		problem(w, 404, "not_found", "Questa famiglia non è disponibile.")
		return
	}
	if err != nil {
		internalError(w, err)
		return
	}
	if !enabled {
		problem(w, 403, "family_suspended", "L’accesso a questa famiglia è sospeso. Contatta un amministratore.")
		return
	}
	if parent && role != "parent" {
		problem(w, 403, "parent_required", "Questa parte è riservata ai genitori.")
		return
	}
	f, err := p.family(id)
	if errors.Is(err, sql.ErrNoRows) {
		problem(w, 404, "not_found", "Questa famiglia non è disponibile.")
		return
	}
	if errors.Is(err, errFamilySuspended) {
		problem(w, 403, "family_suspended", "L’accesso a questa famiglia è sospeso. Contatta un amministratore.")
		return
	}
	if err != nil {
		internalError(w, err)
		return
	}
	serve(f)
}
func currentSession(r *http.Request) portalSession {
	v, _ := r.Context().Value(portalSessionKey{}).(portalSession)
	return v
}
func securityHeaders(w http.ResponseWriter) {
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("Referrer-Policy", "no-referrer")
	w.Header().Set("X-Frame-Options", "DENY")
	w.Header().Set("Permissions-Policy", "microphone=(self), camera=(), geolocation=()")
	w.Header().Set("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https://upload.wikimedia.org https://thumb.wikimedia.org; font-src 'self'; connect-src 'self'; media-src 'self' blob:; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'")
	w.Header().Set("Cache-Control", "no-store")
}
func (p *Portal) Handler() http.Handler {
	mux := http.NewServeMux()
	api.HandlerWithOptions(&portalAPI{p}, api.StdHTTPServerOptions{BaseRouter: mux})
	mux.HandleFunc("GET /auth/login", p.beginLogin)
	mux.HandleFunc("GET /auth/callback", p.finishLogin)
	mux.HandleFunc("GET /auth/invite", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		_, _ = w.Write([]byte(`<!doctype html><html lang="it"><meta name="viewport" content="width=device-width"><title>Invito Lumi</title><body><p id="message">Apro il tuo invito…</p><script src="/auth/invite.js" defer></script></body></html>`))
	})
	mux.HandleFunc("GET /auth/invite.js", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/javascript; charset=utf-8")
		_, _ = w.Write([]byte(`const token = location.hash.slice(1); if (/^[A-Z2-7]{52}$/.test(token)) location.replace('/auth/login?return=' + encodeURIComponent('/invito#' + token)); else document.getElementById('message').textContent = 'Questo invito non è completo.';`))
	})
	mux.HandleFunc("GET /healthz", func(w http.ResponseWriter, r *http.Request) {
		if p.db.PingContext(r.Context()) != nil {
			problem(w, 503, "unhealthy", "Database unavailable")
			return
		}
		sendJSON(w, 200, map[string]string{"status": "ok"})
	})
	mux.HandleFunc("/api/", func(w http.ResponseWriter, r *http.Request) { problem(w, 404, "not_found", "Pagina non trovata.") })
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != "GET" && r.Method != "HEAD" {
			w.WriteHeader(405)
			return
		}
		(&Server{config: p.config}).static(w, r)
	})
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		securityHeaders(w)
		if (r.Method == "GET" || r.Method == "HEAD") && (r.URL.Path == "/errore" || strings.HasPrefix(r.URL.Path, "/assets/") || r.URL.Path == "/lumi.svg" || r.URL.Path == "/manifest.webmanifest" || r.URL.Path == "/icon-192.png" || r.URL.Path == "/icon-512.png" || r.URL.Path == "/icon-maskable.png" || r.URL.Path == "/sw.js") {
			mux.ServeHTTP(w, r)
			return
		}
		if r.URL.Path == "/healthz" || r.URL.Path == "/auth/login" || r.URL.Path == "/auth/callback" || r.URL.Path == "/auth/invite" || r.URL.Path == "/auth/invite.js" {
			mux.ServeHTTP(w, r)
			return
		}
		if r.Method != "GET" && r.Method != "HEAD" && r.Header.Get("Origin") != p.config.Origin {
			problem(w, 403, "origin_mismatch", "Origine della richiesta non autorizzata.")
			return
		}
		sess, err := p.resolveSession(r)
		if err != nil {
			if (r.Method == "GET" || r.Method == "HEAD") && !strings.HasPrefix(r.URL.Path, "/api/") {
				loginError(w, r, "identity_unavailable")
				return
			}
			problem(w, 503, "identity_unavailable", "Non riesco a controllare l’accesso. Riprova.")
			return
		}
		if sess.Hash == "" {
			if strings.HasPrefix(r.URL.Path, "/api/") {
				problem(w, 401, "unauthorized", "Accedi a Lumi.")
			} else {
				http.Redirect(w, r, "/auth/login?return="+url.QueryEscape(r.URL.RequestURI()), http.StatusSeeOther)
			}
			return
		}
		r = r.WithContext(context.WithValue(r.Context(), portalSessionKey{}, sess))
		r = r.WithContext(context.WithValue(r.Context(), sessionKey{}, session{Hash: sess.Hash, CSRF: sess.CSRF}))
		if r.Method != "GET" && r.Method != "HEAD" && !equal(sess.CSRF, r.Header.Get("X-CSRF-Token")) {
			problem(w, 403, "csrf", "Sessione non valida. Ricarica la pagina.")
			return
		}
		// Only session metadata and logout are available before administrator approval.
		if strings.HasPrefix(r.URL.Path, "/api/") && r.URL.Path != "/api/v1/session" && r.URL.Path != "/api/v1/logout" && (!sess.Access || !sess.Verified) {
			problem(w, 403, "approval_required", "L’accesso deve essere approvato da un amministratore.")
			return
		}
		if strings.HasPrefix(r.URL.Path, "/api/v1/admin/") && !sess.Admin {
			problem(w, 403, "admin_required", "Questa parte è riservata agli amministratori.")
			return
		}
		mux.ServeHTTP(w, r)
	})
}
