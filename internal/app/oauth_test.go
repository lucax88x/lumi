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
	"os"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	jose "github.com/go-jose/go-jose/v4"
	"github.com/google/uuid"
)

type fakeIdentity struct {
	server        *httptest.Server
	nonce         string
	refreshes     atomic.Int32
	exchanges     atomic.Int32
	revoked       atomic.Bool
	badAudience   bool
	denyScope     bool
	revokeFailure bool
}

func fakeOAuth(t *testing.T) (*OAuth, *fakeIdentity) {
	t.Helper()
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}
	signer, err := jose.NewSigner(jose.SigningKey{Algorithm: jose.RS256, Key: key}, (&jose.SignerOptions{}).WithHeader("kid", "test-key"))
	if err != nil {
		t.Fatal(err)
	}
	f := &fakeIdentity{}
	f.server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/.well-known/openid-configuration":
			sendJSON(w, 200, map[string]any{"issuer": f.server.URL, "jwks_uri": f.server.URL + "/keys", "authorization_endpoint": f.server.URL + "/authorize", "token_endpoint": f.server.URL + "/api/accounts/oauth/token", "revocation_endpoint": f.server.URL + "/revoke", "id_token_signing_alg_values_supported": []string{"RS256"}})
		case "/keys":
			sendJSON(w, 200, jose.JSONWebKeySet{Keys: []jose.JSONWebKey{{Key: &key.PublicKey, KeyID: "test-key", Algorithm: "RS256", Use: "sig"}}})
		case "/api/accounts/oauth/token":
			_ = r.ParseForm()
			if r.Form.Get("client_id") != "oaiapp_test" || r.Form.Get("resource") != resource {
				t.Error("incorrect token exchange parameters")
			}
			access := "access-test"
			refresh := "refresh-test"
			if r.Form.Get("grant_type") == "refresh_token" {
				f.refreshes.Add(1)
				access = "access-rotated"
				refresh = "refresh-rotated"
				if r.Form.Get("refresh_token") != "refresh-test" {
					t.Error("refresh token rotation raced")
				}
			} else {
				f.exchanges.Add(1)
				if r.Form.Get("redirect_uri") != callbackURI || r.Form.Get("code_verifier") == "" {
					t.Error("missing PKCE or callback")
				}
			}
			audience := "oaiapp_test"
			if f.badAudience {
				audience = "another-client"
			}
			claims, _ := json.Marshal(map[string]any{"iss": f.server.URL, "sub": "parent-123", "aud": audience, "exp": time.Now().Add(time.Hour).Unix(), "iat": time.Now().Unix(), "nonce": f.nonce, "email": "parent@example.test"})
			signature, _ := signer.Sign(claims)
			token, _ := signature.CompactSerialize()
			scope := "openid offline_access " + permission
			if f.denyScope {
				scope = "openid"
			}
			sendJSON(w, 200, map[string]any{"access_token": access, "refresh_token": refresh, "id_token": token, "scope": scope, "expires_in": 3600})
		case "/models":
			if r.Header.Get("Authorization") == "" {
				t.Error("missing bearer")
			}
			sendJSON(w, 200, map[string]any{"models": []map[string]string{{"slug": "small", "display_name": "Small", "visibility": "list"}, {"slug": "hidden", "display_name": "Hidden", "visibility": "hide"}, {"slug": "large", "display_name": "Large", "visibility": "list"}}})
		case "/revoke":
			if f.revokeFailure {
				w.WriteHeader(503)
				return
			}
			_ = r.ParseForm()
			if r.Form.Get("token_type_hint") != "refresh_token" {
				t.Error("invalid revocation")
			}
			f.revoked.Store(true)
			w.WriteHeader(200)
		default:
			http.NotFound(w, r)
		}
	}))
	t.Cleanup(f.server.Close)
	o, err := NewOAuth(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	o.issuer = f.server.URL
	o.apiURL = f.server.URL
	o.http = f.server.Client()
	o.http.Timeout = 5 * time.Second
	return o, f
}
func callbackFor(o *OAuth, session string) string {
	a := o.pending[session]
	return callbackURI + "?" + url.Values{"code": {"temporary-code"}, "state": {a.State}, "client_id": {"oaiapp_test"}}.Encode()
}
func connectFake(t *testing.T, o *OAuth, f *fakeIdentity) {
	t.Helper()
	o.Start("parent-session")
	f.nonce = o.pending["parent-session"].Nonce
	if err := o.Complete(context.Background(), "parent-session", callbackFor(o, "parent-session")); err != nil {
		t.Fatal(err)
	}
}

func TestOAuthBrowserFlowAndRotatingRefresh(t *testing.T) {
	o, f := fakeOAuth(t)
	start := o.Start("parent-session")
	u, _ := url.Parse(start.AuthorizationUrl)
	host, err := uuid.Parse(u.Query().Get("ext_agent_host_id"))
	if err != nil || host.Version() != 4 || host.Variant() != uuid.RFC4122 || host.URN() != o.creds.HostID {
		t.Fatal("authorization must use a canonical UUIDv4 host URI")
	}
	if u.Query().Get("client_id") != "dynamic_agent_client" || u.Query().Get("code_challenge_method") != "S256" || u.Query().Get("redirect_uri") != callbackURI {
		t.Fatal("invalid authorization URL")
	}
	f.nonce = o.pending["parent-session"].Nonce
	callback := callbackFor(o, "parent-session")
	if err := o.Complete(context.Background(), "another-session", callback); err == nil {
		t.Fatal("accepted another browser session")
	}
	if err := o.Complete(context.Background(), "parent-session", strings.Replace(callback, "state=", "state=bad", 1)); err == nil {
		t.Fatal("accepted wrong state")
	}
	if err := o.Complete(context.Background(), "parent-session", callback); err != nil {
		t.Fatal(err)
	}
	if err := o.Complete(context.Background(), "parent-session", callback); err == nil {
		t.Fatal("accepted replay")
	}
	if !o.Status().Connected || o.Status().Email != "parent@example.test" {
		t.Fatal("not connected")
	}
	stat, _ := os.Stat(o.path)
	if stat.Mode().Perm() != 0600 {
		t.Fatal("credentials not private")
	}
	hostID := o.creds.HostID
	restored, err := NewOAuth(strings.TrimSuffix(o.path, "/chatgpt.json"))
	if err != nil || restored.creds.HostID != hostID || restored.creds.ClientID != "oaiapp_test" {
		t.Fatal("credentials did not survive restart")
	}
	models, err := o.Models(context.Background())
	if err != nil || len(models) != 2 || models[0].Slug != "small" || models[1].Slug != "large" {
		t.Fatalf("wrong catalog: %v %v", models, err)
	}
	o.creds.ExpiresAt = time.Now().Add(-time.Minute)
	var wg sync.WaitGroup
	for range 12 {
		wg.Go(func() {
			token, err := o.Token(context.Background(), "")
			if err != nil || token != "access-rotated" {
				t.Errorf("refresh failed: %v", err)
			}
		})
	}
	wg.Wait()
	if f.refreshes.Load() != 1 {
		t.Fatalf("refresh happened %d times", f.refreshes.Load())
	}
	if o.creds.RefreshToken != "refresh-rotated" {
		t.Fatal("rotation was not saved")
	}
	if err = o.Disconnect(context.Background()); err != nil {
		t.Fatal(err)
	}
	if !f.revoked.Load() || o.Status().Connected || o.creds.AccessToken != "" {
		t.Fatal("did not revoke and clear")
	}
}

func TestOAuthRepairsLegacyHostBeforeRegistration(t *testing.T) {
	for _, kind := range []string{"new", "legacy", "valid", "registered", "tokens", "other-format"} {
		t.Run(kind, func(t *testing.T) {
			dir := t.TempDir()
			previous := credentials{HostID: "urn:uuid:" + randomID()}
			switch kind {
			case "new":
				previous.HostID = ""
			case "valid":
				previous.HostID = uuid.New().URN()
			case "registered":
				previous.ClientID = "oaiapp_existing"
			case "tokens":
				previous.RefreshToken = "existing-refresh"
			case "other-format":
				previous.HostID = "urn:ietf:params:oauth:jwk-thumbprint:sha-256:existing-host"
			}
			b, err := json.Marshal(previous)
			if err != nil {
				t.Fatal(err)
			}
			if err = os.WriteFile(filepath.Join(dir, "chatgpt.json"), b, 0600); err != nil {
				t.Fatal(err)
			}
			o, err := NewOAuth(dir)
			if err != nil {
				t.Fatal(err)
			}
			if kind == "new" || kind == "legacy" {
				id, err := uuid.Parse(o.creds.HostID)
				if err != nil || id.Version() != 4 || id.Variant() != uuid.RFC4122 || id.URN() != o.creds.HostID {
					t.Fatal("host was not repaired to a canonical UUIDv4 URI")
				}
				previous.HostID = o.creds.HostID
			}
			if o.creds != previous {
				t.Fatal("existing identity or credentials changed")
			}
			restored, err := NewOAuth(dir)
			if err != nil || restored.creds != o.creds {
				t.Fatal("host identity must persist and remain stable after restart")
			}
		})
	}
}
func TestOAuthRejectsUnverifiedIdentityAndPermission(t *testing.T) {
	for _, kind := range []string{"audience", "nonce", "permission", "expired", "callback", "client"} {
		t.Run(kind, func(t *testing.T) {
			o, f := fakeOAuth(t)
			o.Start("s")
			f.nonce = o.pending["s"].Nonce
			callback := callbackFor(o, "s")
			switch kind {
			case "audience":
				f.badAudience = true
			case "nonce":
				f.nonce = "wrong"
			case "permission":
				f.denyScope = true
			case "expired":
				a := o.pending["s"]
				a.Expires = time.Now().Add(-time.Second)
				o.pending["s"] = a
			case "callback":
				callback = strings.Replace(callback, "127.0.0.1", "attacker.test", 1)
			case "client":
				callback = strings.Replace(callback, "oaiapp_test", "dynamic_agent_client", 1)
			}
			if err := o.Complete(context.Background(), "s", callback); err == nil {
				t.Fatal("accepted invalid OAuth")
			}
			if o.Status().Connected {
				t.Fatal("invalid credentials stored")
			}
		})
	}
}
func TestRevocationFailureKeepsRenewableSession(t *testing.T) {
	o, f := fakeOAuth(t)
	connectFake(t, o, f)
	f.revokeFailure = true
	if err := o.Disconnect(context.Background()); err == nil {
		t.Fatal("reported successful revocation")
	}
	if o.creds.RefreshToken == "" {
		t.Fatal("lost token before confirmed revocation")
	}
}
func TestCallbackDoesNotExposeSecretsInError(t *testing.T) {
	o, _ := fakeOAuth(t)
	o.Start("s")
	err := o.Complete(context.Background(), "s", fmt.Sprintf("%s?code=private-secret&state=wrong", callbackURI))
	if err == nil || strings.Contains(err.Error(), "private-secret") {
		t.Fatal("callback leaked")
	}
}
