package app

import (
	"context"
	"crypto/rand"
	"crypto/rsa"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	jose "github.com/go-jose/go-jose/v4"
	"lumi/internal/api"
)

func portalTest(t *testing.T) *Portal {
	t.Helper()
	dir := t.TempDir()
	db, e := openControl(dir)
	if e != nil {
		t.Fatal(e)
	}
	p := &Portal{config: Config{DataDir: dir, Origin: "https://lumi.test", WebDir: t.TempDir(), OIDCIssuer: "https://id.test"}, db: db, families: map[string]*Server{}}
	p.admin, e = NewServer(p.config)
	if e != nil {
		t.Fatal(e)
	}
	t.Cleanup(func() { p.Close() })
	return p
}
func seedPortalUser(t *testing.T, p *Portal, name string, access, verified bool) (*http.Cookie, string, string) {
	t.Helper()
	id := digest(p.config.OIDCIssuer + "\x00" + name)
	value := randomID() + randomID()
	csrf := randomID()
	now := time.Now()
	if _, e := p.db.Exec(`INSERT INTO identities VALUES(?,?,?,?)`, id, p.config.OIDCIssuer, name, name+"@example.test"); e != nil {
		t.Fatal(e)
	}
	if _, e := p.db.Exec(`INSERT INTO portal_sessions VALUES(?,?,?,?,?,?,?,?,?,?,?)`, digest(value), id, csrf, "server-only-access-token", "server-only-refresh-token", now.Add(5*time.Minute).Unix(), now.Add(12*time.Hour).Unix(), now.Add(30*time.Minute).Unix(), verified, access, false); e != nil {
		t.Fatal(e)
	}
	return &http.Cookie{Name: "lumi_session", Value: value}, csrf, id
}
func portalCall(p *Portal, method, path, body string, cookie *http.Cookie, csrf string) *httptest.ResponseRecorder {
	r := httptest.NewRequest(method, path, strings.NewReader(body))
	r.Header.Set("Origin", p.config.Origin)
	r.Header.Set("Content-Type", "application/json")
	if cookie != nil {
		r.AddCookie(cookie)
	}
	if csrf != "" {
		r.Header.Set("X-CSRF-Token", csrf)
	}
	w := httptest.NewRecorder()
	p.Handler().ServeHTTP(w, r)
	return w
}
func createTestFamily(t *testing.T, p *Portal, c *http.Cookie, csrf, name string) api.Family {
	t.Helper()
	w := portalCall(p, "POST", "/api/v1/families", fmt.Sprintf(`{"name":%q}`, name), c, csrf)
	if w.Code != 201 {
		t.Fatalf("create family %d %s", w.Code, w.Body.String())
	}
	var f api.Family
	if e := json.Unmarshal(w.Body.Bytes(), &f); e != nil {
		t.Fatal(e)
	}
	return f
}
func TestPortalCookieGateCSRFAndPendingApproval(t *testing.T) {
	p := portalTest(t)
	for _, path := range []string{"/api/v1/families", "/api/v1/status", "/api/v1/families/other/conversations"} {
		if w := portalCall(p, "GET", path, "", nil, ""); w.Code != 401 {
			t.Fatalf("exposed %s: %d", path, w.Code)
		}
	}
	if w := portalCall(p, "GET", "/", "", nil, ""); w.Code != 303 || !strings.HasPrefix(w.Header().Get("Location"), "/auth/login") {
		t.Fatal("page did not redirect")
	}
	c, csrf, _ := seedPortalUser(t, p, "pending", false, true)
	if w := portalCall(p, "GET", "/api/v1/session", "", c, ""); w.Code != 200 || strings.Contains(w.Body.String(), "server-only") || !strings.Contains(w.Body.String(), `"portalAccess":false`) {
		t.Fatal(w.Body.String())
	}
	if w := portalCall(p, "POST", "/api/v1/families", `{"name":"Denied"}`, c, csrf); w.Code != 403 {
		t.Fatal("pending user admitted")
	}
	c, csrf, _ = seedPortalUser(t, p, "approved", true, true)
	if w := portalCall(p, "POST", "/api/v1/families", `{"name":"Denied"}`, c, ""); w.Code != 403 {
		t.Fatal("missing CSRF accepted")
	}
	r := httptest.NewRequest("POST", "/api/v1/families", strings.NewReader(`{"name":"Denied"}`))
	r.AddCookie(c)
	r.Header.Set("Origin", "https://attacker.test")
	r.Header.Set("X-CSRF-Token", csrf)
	w := httptest.NewRecorder()
	p.Handler().ServeHTTP(w, r)
	if w.Code != 403 {
		t.Fatal("cross-origin accepted")
	}
	createTestFamily(t, p, c, csrf, "Allowed")
	_, e := p.db.Exec(`UPDATE portal_sessions SET idle_expires=0 WHERE token_hash=?`, digest(c.Value))
	if e != nil {
		t.Fatal(e)
	}
	if w := portalCall(p, "GET", "/api/v1/session", "", c, ""); w.Code != 401 {
		t.Fatal("expired session accepted")
	}
}
func TestFamiliesIsolateDataAndPermissionsWithSharedConnection(t *testing.T) {
	p := portalTest(t)
	a, ac, aid := seedPortalUser(t, p, "alice", true, true)
	b, bc, bid := seedPortalUser(t, p, "bob", true, true)
	fa := createTestFamily(t, p, a, ac, "Alice")
	fb := createTestFamily(t, p, b, bc, "Bob")
	baseA := "/api/v1/families/" + fa.Id
	baseB := "/api/v1/families/" + fb.Id
	for _, base := range []string{baseA, baseB} {
		cookie, csrf := a, ac
		if base == baseB {
			cookie, csrf = b, bc
		}
		w := portalCall(p, "POST", base+"/conversations", `{"id":"same-id","title":"Private"}`, cookie, csrf)
		if w.Code != 200 {
			t.Fatal(w.Body.String())
		}
	}
	for _, suffix := range []string{"/status", "/conversations", "/conversations/same-id", "/admin/settings"} {
		if w := portalCall(p, "GET", baseA+suffix, "", b, ""); w.Code != 404 {
			t.Fatalf("cross-family %s: %d", suffix, w.Code)
		}
	}
	if w := portalCall(p, "DELETE", baseA+"/admin/conversations", "", b, bc); w.Code != 404 {
		t.Fatal("cross-family deletion")
	}
	if _, e := p.db.Exec(`INSERT INTO memberships VALUES(?,?,'member')`, fa.Id, bid); e != nil {
		t.Fatal(e)
	}
	if w := portalCall(p, "GET", baseA+"/conversations/same-id", "", b, ""); w.Code != 200 {
		t.Fatal("member cannot read family")
	}
	if w := portalCall(p, "GET", baseA+"/admin/settings", "", b, ""); w.Code != 403 {
		t.Fatal("member read parent settings")
	}
	if w := portalCall(p, "GET", baseB+"/admin/settings", "", b, ""); w.Code != 200 {
		t.Fatal("parent rights leaked between memberships")
	}
	sa, _ := p.family(fa.Id)
	sb, _ := p.family(fb.Id)
	if sa.auth != sb.auth || sa.auth != p.admin.auth {
		t.Fatal("families must reuse the shared ChatGPT connection")
	}
	settings := defaultSettings()
	settings.Prompt = "Alice prompt"
	settings.Model = "test-model"
	if e := p.admin.store.SaveSettings(settings); e != nil {
		t.Fatal(e)
	}
	if e := sa.store.SaveSettings(settings); e != nil {
		t.Fatal(e)
	}
	other, e := sb.store.Settings()
	if e != nil || other.Prompt == settings.Prompt {
		t.Fatal("shared settings")
	}
	sa.generator = &fakeGenerator{}
	sb.generator = &fakeGenerator{}
	if w := portalCall(p, "POST", baseA+"/conversations/same-id/messages", `{"requestId":"turn","action":"message","text":"Hello"}`, a, ac); w.Code != 200 || !strings.Contains(w.Body.String(), "completed") {
		t.Fatal(w.Body.String())
	}
	if detail, e := sb.store.Conversation("same-id"); e != nil || len(detail.Messages) != 0 {
		t.Fatal("messages leaked")
	}
	if w := portalCall(p, "DELETE", baseA+"/admin/conversations", "", a, ac); w.Code != 204 {
		t.Fatal(w.Body.String())
	}
	if w := portalCall(p, "GET", baseB+"/conversations/same-id", "", b, ""); w.Code != 200 {
		t.Fatal("other family's conversation deleted")
	}
	if w := portalCall(p, "DELETE", baseA+"/members/"+aid, "", a, ac); w.Code != 409 {
		t.Fatal("last parent removed")
	}
	if w := portalCall(p, "PATCH", baseA+"/members/"+aid, `{"role":"member"}`, a, ac); w.Code != 409 {
		t.Fatal("last parent demoted")
	}
	if w := portalCall(p, "DELETE", baseA+"/members/"+bid, "", a, ac); w.Code != 204 {
		t.Fatal(w.Body.String())
	}
	if w := portalCall(p, "GET", baseA+"/conversations", "", b, ""); w.Code != 404 {
		t.Fatal("removed member retained access")
	}
}
func TestInvitationsRequireApprovalVerifiedTargetAndSingleUse(t *testing.T) {
	p := portalTest(t)
	parent, pc, _ := seedPortalUser(t, p, "parent", true, true)
	guest, gc, gid := seedPortalUser(t, p, "guest", true, true)
	wrong, wc, _ := seedPortalUser(t, p, "wrong", true, true)
	pending, pendc, _ := seedPortalUser(t, p, "pending", false, true)
	f := createTestFamily(t, p, parent, pc, "Family")
	base := "/api/v1/families/" + f.Id
	makeInvite := func() api.InvitationCreated {
		w := portalCall(p, "POST", base+"/invitations", `{"email":"guest@example.test"}`, parent, pc)
		if w.Code != 201 {
			t.Fatal(w.Body.String())
		}
		var v api.InvitationCreated
		json.Unmarshal(w.Body.Bytes(), &v)
		return v
	}
	invite := makeInvite()
	u, _ := url.Parse(invite.Url)
	body := fmt.Sprintf(`{"token":%q}`, u.Fragment)
	if invite.Invitation.Email != "guest@example.test" {
		t.Fatal("missing email")
	}
	if w := portalCall(p, "POST", "/api/v1/invitations/accept", body, pending, pendc); w.Code != 403 {
		t.Fatal("invitation bypassed approval")
	}
	if w := portalCall(p, "POST", "/api/v1/invitations/accept", body, wrong, wc); w.Code != 403 {
		t.Fatal("wrong email accepted")
	}
	p.db.Exec(`UPDATE portal_sessions SET verified=0 WHERE user_id=?`, gid)
	if w := portalCall(p, "POST", "/api/v1/invitations/accept", body, guest, gc); w.Code != 403 {
		t.Fatal("unverified email accepted")
	}
	p.db.Exec(`UPDATE portal_sessions SET verified=1 WHERE user_id=?`, gid)
	if w := portalCall(p, "POST", "/api/v1/invitations/accept", body, guest, gc); w.Code != 200 {
		t.Fatal(w.Body.String())
	}
	if w := portalCall(p, "POST", "/api/v1/invitations/accept", body, guest, gc); w.Code != 404 {
		t.Fatal("invitation reused")
	}
	for _, mode := range []string{"expired", "revoked"} {
		v := makeInvite()
		u, _ := url.Parse(v.Url)
		if mode == "expired" {
			p.db.Exec(`UPDATE invitations SET expires_at=0 WHERE id=?`, v.Invitation.Id)
		} else {
			w := portalCall(p, "DELETE", base+"/invitations/"+v.Invitation.Id, "", parent, pc)
			if w.Code != 204 {
				t.Fatal(w.Body.String())
			}
		}
		if w := portalCall(p, "POST", "/api/v1/invitations/accept", fmt.Sprintf(`{"token":%q}`, u.Fragment), guest, gc); w.Code != 404 {
			t.Fatal(mode + " invite accepted")
		}
	}
}

type portalIssuer struct {
	server                           *httptest.Server
	nonce                            string
	badAudience, badIssuer, badNonce bool
	access, admin                    bool
	refreshes                        atomic.Int32
	logout                           atomic.Bool
}

func newPortalIssuer(t *testing.T) *portalIssuer {
	t.Helper()
	key, e := rsa.GenerateKey(rand.Reader, 2048)
	if e != nil {
		t.Fatal(e)
	}
	signer, e := jose.NewSigner(jose.SigningKey{Algorithm: jose.RS256, Key: key}, (&jose.SignerOptions{}).WithHeader("kid", "portal-key"))
	if e != nil {
		t.Fatal(e)
	}
	f := &portalIssuer{access: true}
	f.server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/.well-known/openid-configuration":
			sendJSON(w, 200, map[string]any{"issuer": f.server.URL, "authorization_endpoint": f.server.URL + "/authorize", "token_endpoint": f.server.URL + "/token", "jwks_uri": f.server.URL + "/keys", "id_token_signing_alg_values_supported": []string{"RS256"}})
		case "/keys":
			sendJSON(w, 200, jose.JSONWebKeySet{Keys: []jose.JSONWebKey{{Key: &key.PublicKey, KeyID: "portal-key", Algorithm: "RS256", Use: "sig"}}})
		case "/token":
			r.ParseForm()
			if r.Form.Get("grant_type") == "refresh_token" {
				f.refreshes.Add(1)
			} else if r.Form.Get("code_verifier") == "" {
				t.Error("no PKCE verifier")
			}
			audience, issuer, nonce := "lumi", f.server.URL, f.nonce
			if f.badAudience {
				audience = "wrong"
			}
			if f.badIssuer {
				issuer = "https://wrong.test"
			}
			if f.badNonce {
				nonce = "wrong"
			}
			roles := []string{}
			if f.access {
				roles = append(roles, "portal-access")
			}
			if f.admin {
				roles = append(roles, "portal-admin")
			}
			claims := map[string]any{"iss": issuer, "aud": audience, "sub": "subject", "nonce": nonce, "email": "test@example.test", "email_verified": true, "exp": time.Now().Add(5 * time.Minute).Unix(), "iat": time.Now().Unix(), "realm_access": map[string]any{"roles": roles}}
			b, _ := json.Marshal(claims)
			sig, _ := signer.Sign(b)
			jwt, _ := sig.CompactSerialize()
			sendJSON(w, 200, map[string]any{"access_token": jwt, "refresh_token": "server-refresh", "id_token": jwt, "token_type": "Bearer", "expires_in": 300})
		case "/protocol/openid-connect/logout":
			r.ParseForm()
			user, pass, ok := r.BasicAuth()
			if !ok || user != "lumi" || pass != "secret" || r.Form.Get("refresh_token") != "server-refresh" {
				t.Error("invalid server-side logout")
			}
			f.logout.Store(true)
			w.WriteHeader(204)
		default:
			http.NotFound(w, r)
		}
	}))
	t.Cleanup(f.server.Close)
	return f
}
func oidcPortal(t *testing.T, f *portalIssuer) *Portal {
	t.Helper()
	p, e := NewPortal(context.Background(), Config{DataDir: t.TempDir(), WebDir: t.TempDir(), Origin: "https://lumi.test", OIDCIssuer: f.server.URL, OIDCClientID: "lumi", OIDCClientSecret: "secret"})
	if e != nil {
		t.Fatal(e)
	}
	t.Cleanup(func() { p.Close() })
	return p
}
func loginPortal(t *testing.T, p *Portal, f *portalIssuer) (*httptest.ResponseRecorder, string, *http.Cookie) {
	t.Helper()
	w := portalCall(p, "GET", "/auth/login?return=%2Finvito%23secret-invite", "", nil, "")
	u, e := url.Parse(w.Header().Get("Location"))
	if e != nil {
		t.Fatal(e)
	}
	f.nonce = u.Query().Get("nonce")
	if u.Query().Get("code_challenge_method") != "S256" {
		t.Fatal("no PKCE")
	}
	cookie := w.Result().Cookies()[0]
	callback := "/auth/callback?code=good&state=" + u.Query().Get("state")
	return portalCall(p, "GET", callback, "", cookie, ""), callback, cookie
}
func TestOIDCCookieRefreshLogoutAndCallbackValidation(t *testing.T) {
	f := newPortalIssuer(t)
	p := oidcPortal(t, f)
	w, callback, binding := loginPortal(t, p, f)
	if w.Code != 303 || w.Header().Get("Location") != "/invito#secret-invite" {
		t.Fatalf("callback: %d %s", w.Code, w.Body.String())
	}
	var cookie *http.Cookie
	for _, c := range w.Result().Cookies() {
		if c.Name == "lumi_session" {
			cookie = c
		}
	}
	if cookie == nil || !cookie.HttpOnly || !cookie.Secure || cookie.SameSite != http.SameSiteLaxMode || strings.Contains(cookie.Value, ".") {
		t.Fatal("session cookie is not opaque and secure")
	}
	if retry := portalCall(p, "GET", callback, "", binding, ""); retry.Code != 303 || retry.Header().Get("Location") != "/errore?code=invalid_login" {
		t.Fatal("replayed callback")
	}
	sessionResponse := portalCall(p, "GET", "/api/v1/session", "", cookie, "")
	var sess api.Session
	json.Unmarshal(sessionResponse.Body.Bytes(), &sess)
	if !sess.PortalAccess || strings.Contains(sessionResponse.Body.String(), "server-refresh") || strings.Contains(sessionResponse.Body.String(), "eyJ") {
		t.Fatal("token leakage or missing role")
	}
	p.db.Exec(`UPDATE portal_sessions SET access_expires=0`)
	f.access = false
	var group sync.WaitGroup
	for range 6 {
		group.Go(func() {
			if r := portalCall(p, "GET", "/api/v1/session", "", cookie, ""); r.Code != 200 {
				t.Errorf("refresh: %d %s", r.Code, r.Body.String())
			}
		})
	}
	group.Wait()
	if f.refreshes.Load() != 1 {
		t.Fatal("rotating refresh token used concurrently")
	}
	if denied := portalCall(p, "POST", "/api/v1/families", `{"name":"Denied"}`, cookie, sess.CsrfToken); denied.Code != 403 {
		t.Fatal("revoked portal role still accepted")
	}
	if out := portalCall(p, "POST", "/api/v1/logout", "", cookie, sess.CsrfToken); out.Code != 204 || !f.logout.Load() {
		t.Fatal("logout failed")
	}
	if out := portalCall(p, "GET", "/api/v1/session", "", cookie, ""); out.Code != 401 {
		t.Fatal("logged-out cookie accepted")
	}
	for _, mode := range []string{"audience", "issuer", "nonce"} {
		t.Run(mode, func(t *testing.T) {
			bad := newPortalIssuer(t)
			q := oidcPortal(t, bad)
			bad.badAudience = mode == "audience"
			bad.badIssuer = mode == "issuer"
			bad.badNonce = mode == "nonce"
			result, _, _ := loginPortal(t, q, bad)
			if result.Code != 303 || result.Header().Get("Location") != "/errore?code=invalid_identity" {
				t.Fatal("invalid token accepted")
			}
		})
	}
}
func TestSafeLoginReturn(t *testing.T) {
	for _, raw := range []string{"https://evil.test", "//evil.test", "/\\evil.test", "/auth/login"} {
		if safeReturn(raw) != "/" {
			t.Fatal(raw)
		}
	}
}

func TestPortalAndFamilyPersistenceAcrossRestart(t *testing.T) {
	p := portalTest(t)
	c, csrf, _ := seedPortalUser(t, p, "persistent", true, true)
	f := createTestFamily(t, p, c, csrf, "Persistent family")
	runtime, e := p.family(f.Id)
	if e != nil {
		t.Fatal(e)
	}
	settings := defaultSettings()
	settings.Prompt = "A persistent prompt"
	if e = runtime.store.SaveSettings(settings); e != nil {
		t.Fatal(e)
	}
	if _, e = runtime.store.Create("persistent-chat", "A question"); e != nil {
		t.Fatal(e)
	}
	if e = p.Close(); e != nil {
		t.Fatal(e)
	}
	db, e := openControl(p.config.DataDir)
	if e != nil {
		t.Fatal(e)
	}
	reopened := &Portal{config: p.config, db: db, families: map[string]*Server{}}
	reopened.admin, e = newSharedServer(p.config)
	if e != nil {
		t.Fatal(e)
	}
	defer reopened.Close()
	w := portalCall(reopened, "GET", "/api/v1/session", "", c, "")
	if w.Code != 200 || !strings.Contains(w.Body.String(), f.Id) {
		t.Fatal("session or membership did not persist")
	}
	w = portalCall(reopened, "GET", "/api/v1/families/"+f.Id+"/admin/settings", "", c, "")
	if w.Code != 200 || !strings.Contains(w.Body.String(), settings.Prompt) {
		t.Fatal("family settings did not persist")
	}
	w = portalCall(reopened, "GET", "/api/v1/families/"+f.Id+"/conversations/persistent-chat", "", c, "")
	if w.Code != 200 {
		t.Fatal("conversation did not persist")
	}
}
