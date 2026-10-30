package app

import (
	"bytes"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/url"
	"strings"
	"testing"
	"time"
)

func TestInvalidLoginDiagnostics(t *testing.T) {
	const binding = "private-login-cookie"
	const state = "private-login-state"
	const code = "private-authorization-code"
	for _, tc := range []struct {
		name, cookie, attempt, state, code, reason string
		providerError                              bool
	}{
		{name: "missing cookie", attempt: "active", state: state, code: code, reason: "missing_cookie"},
		{name: "oversized cookie", cookie: strings.Repeat(binding, 6), attempt: "active", state: state, code: code, reason: "oversized_cookie"},
		{name: "missing attempt", cookie: binding, attempt: "missing", state: state, code: code, reason: "attempt_missing_or_expired"},
		{name: "expired attempt", cookie: binding, attempt: "expired", state: state, code: code, reason: "attempt_missing_or_expired"},
		{name: "consumed attempt", cookie: binding, attempt: "consumed", state: state, code: code, reason: "attempt_missing_or_expired"},
		{name: "database error", cookie: binding, attempt: "database error", state: state, code: code, reason: "database_error"},
		{name: "state mismatch", cookie: binding, attempt: "active", state: "private-wrong-state", code: code, reason: "state_mismatch"},
		{name: "missing state", cookie: binding, attempt: "active", code: code, reason: "state_mismatch"},
		{name: "missing code", cookie: binding, attempt: "active", state: state, reason: "missing_code", providerError: true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			p := portalTest(t)
			expires := time.Now().Add(time.Minute).Unix()
			if tc.attempt == "expired" {
				expires = time.Now().Add(-time.Minute).Unix()
			}
			if tc.attempt != "missing" {
				if _, err := p.db.Exec(`INSERT INTO login_attempts VALUES(?,?,?,?,?,?)`, digest(binding), state, "private-nonce", "private-verifier", "/private-return-path", expires); err != nil {
					t.Fatal(err)
				}
			}
			var logs bytes.Buffer
			previous := slog.Default()
			slog.SetDefault(slog.New(slog.NewJSONHandler(&logs, nil)))
			defer slog.SetDefault(previous)
			if tc.attempt == "consumed" {
				// A rejected callback still consumes the attempt, preventing replay.
				portalCall(p, "GET", "/auth/callback?state="+state, "", &http.Cookie{Name: "lumi_login", Value: binding}, "")
				logs.Reset()
			}
			if tc.attempt == "database error" {
				if err := p.db.Close(); err != nil {
					t.Fatal(err)
				}
			}
			query := url.Values{}
			if tc.state != "" {
				query.Set("state", tc.state)
			}
			if tc.code != "" {
				query.Set("code", tc.code)
			}
			if tc.providerError {
				query.Set("error", "private-provider-error")
				query.Set("error_description", "private-provider-description")
			}
			var cookie *http.Cookie
			if tc.cookie != "" {
				cookie = &http.Cookie{Name: "lumi_login", Value: tc.cookie}
			}
			response := portalCall(p, "GET", "/auth/callback?"+query.Encode(), "", cookie, "")
			if response.Code != http.StatusSeeOther || response.Header().Get("Location") != "/errore?code=invalid_login" {
				t.Fatalf("callback: %d %s", response.Code, response.Body.String())
			}
			var entry struct {
				Level                string `json:"level"`
				Message              string `json:"msg"`
				Stage                string `json:"stage"`
				Reason               string `json:"reason"`
				StatePresent         bool   `json:"state_present"`
				CodePresent          bool   `json:"code_present"`
				ProviderErrorPresent bool   `json:"provider_error_present"`
				Error                string `json:"error"`
			}
			decoder := json.NewDecoder(strings.NewReader(logs.String()))
			if err := decoder.Decode(&entry); err != nil {
				t.Fatal(err)
			}
			if entry.Level != "WARN" || entry.Message != "OIDC login validation failed" || entry.Stage != "callback" || entry.Reason != tc.reason {
				t.Fatalf("unexpected diagnostic: %+v", entry)
			}
			if entry.StatePresent != (tc.state != "") || entry.CodePresent != (tc.code != "") || entry.ProviderErrorPresent != tc.providerError {
				t.Fatalf("incorrect callback presence flags: %+v", entry)
			}
			if (entry.Error != "") != (tc.reason == "database_error") {
				t.Fatalf("unexpected database error detail: %+v", entry)
			}
			if err := decoder.Decode(&entry); err != io.EOF {
				t.Fatalf("expected exactly one log entry, got %q", logs.String())
			}
			for _, secret := range []string{binding, digest(binding), state, code, "private-wrong-state", "private-nonce", "private-verifier", "/private-return-path", "private-provider-error", "private-provider-description", "/auth/callback"} {
				if strings.Contains(logs.String(), secret) {
					t.Fatalf("sensitive value %q appeared in diagnostic", secret)
				}
			}
		})
	}
}

func TestLoginDestinationUsesOnlyActiveFamilyAndPreservesExplicitTargets(t *testing.T) {
	p := portalTest(t)
	parent, pc, userID := seedPortalUser(t, p, "parent", true, true)
	check := func(target string, approved bool, want string) {
		t.Helper()
		got, err := p.loginDestination(target, userID, approved)
		if err != nil || got != want {
			t.Fatalf("destination %q approved=%t: got %q want %q: %v", target, approved, got, want, err)
		}
	}
	check("/", true, "/")
	family := createTestFamily(t, p, parent, pc, "Only family")
	check("/", true, "/famiglie/"+family.Id)
	check("/", false, "/")
	for _, target := range []string{"/invito#secret", "/admin", "/admin/famiglie", "/famiglie/another/domande/saved"} {
		check(target, true, target)
	}
	other := createTestFamily(t, p, parent, pc, "Other family")
	check("/", true, "/")
	if _, err := p.db.Exec(`UPDATE families SET access_enabled=0 WHERE id=?`, other.Id); err != nil {
		t.Fatal(err)
	}
	check("/", true, "/famiglie/"+family.Id)
	if _, err := p.db.Exec(`UPDATE families SET access_enabled=0`); err != nil {
		t.Fatal(err)
	}
	check("/", true, "/")
}

func TestLoginCallbackRedirectsToSingleFamily(t *testing.T) {
	issuer := newPortalIssuer(t)
	p := oidcPortal(t, issuer)
	login, _, _ := loginPortal(t, p, issuer)
	var cookie *http.Cookie
	for _, c := range login.Result().Cookies() {
		if c.Name == "lumi_session" {
			cookie = c
		}
	}
	if cookie == nil {
		t.Fatal("no session")
	}
	var csrf string
	if err := p.db.QueryRow(`SELECT csrf FROM portal_sessions WHERE token_hash=?`, digest(cookie.Value)).Scan(&csrf); err != nil {
		t.Fatal(err)
	}
	family := createTestFamily(t, p, cookie, csrf, "Only family")
	start := portalCall(p, "GET", "/auth/login?return=%2F", "", cookie, "")
	u, err := url.Parse(start.Header().Get("Location"))
	if err != nil {
		t.Fatal(err)
	}
	issuer.nonce = u.Query().Get("nonce")
	callback := portalCall(p, "GET", "/auth/callback?code=good&state="+u.Query().Get("state"), "", start.Result().Cookies()[0], "")
	if callback.Code != 303 || callback.Header().Get("Location") != "/famiglie/"+family.Id {
		t.Fatal(callback.Code, callback.Header().Get("Location"))
	}
}
