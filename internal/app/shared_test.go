package app

import (
	"context"
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"
)

func TestSharedAdminAuthorizationAndFamilyReadiness(t *testing.T) {
	p := portalTest(t)
	p.config.OpenAIAPIKey = "server-only-api-key"
	p.admin.config.OpenAIAPIKey = p.config.OpenAIAPIKey
	parent, csrf, _ := seedPortalUser(t, p, "parent", true, true)
	admin, ac, _ := seedPortalUser(t, p, "admin", true, true)
	if _, err := p.db.Exec(`UPDATE portal_sessions SET portal_admin=1 WHERE token_hash=?`, digest(admin.Value)); err != nil {
		t.Fatal(err)
	}
	family := createTestFamily(t, p, parent, csrf, "Family")
	base := "/api/v1/families/" + family.Id
	for _, call := range []struct{ method, path, body string }{
		{"GET", "/api/v1/admin/connection", ""},
		{"POST", "/api/v1/admin/connection/start", ""},
		{"POST", "/api/v1/admin/connection/complete", `{"callbackUrl":"invalid"}`},
		{"DELETE", "/api/v1/admin/connection", ""},
		{"GET", "/api/v1/admin/models", ""},
		{"GET", "/api/v1/admin/settings", ""},
		{"PUT", "/api/v1/admin/settings", `{}`},
	} {
		if w := portalCall(p, call.method, call.path, call.body, parent, csrf); w.Code != 403 {
			t.Fatalf("parent allowed global %s %s: %d", call.method, call.path, w.Code)
		}
	}
	for _, path := range []string{base + "/admin/connection", base + "/admin/models"} {
		if w := portalCall(p, "GET", path, "", parent, ""); w.Code != 404 {
			t.Fatalf("retained per-family credentials endpoint %s: %d", path, w.Code)
		}
	}
	if w := portalCall(p, "POST", "/api/v1/admin/connection/start", "", admin, ""); w.Code != 403 {
		t.Fatal("Admin mutation bypassed CSRF")
	}
	if w := portalCall(p, "GET", "/api/v1/admin/connection", "", admin, ""); w.Code != 200 || !strings.Contains(w.Body.String(), `"transcriptionConfigured":true`) || strings.Contains(w.Body.String(), "server-only") {
		t.Fatal("Admin status leaked credentials or is unavailable:", w.Body.String())
	}
	if w := portalCall(p, "POST", "/api/v1/admin/connection/start", "", admin, ac); w.Code != 200 {
		t.Fatal("Admin without family membership cannot connect:", w.Body.String())
	}
	settings := defaultSettings()
	settings.Model = "shared-model"
	if err := p.admin.store.SaveSettings(settings); err != nil {
		t.Fatal(err)
	}
	p.admin.auth.creds.RefreshToken = "shared-server-grant"
	p.admin.auth.creds.Scopes = permission
	other := createTestFamily(t, p, parent, csrf, "Another family")
	for _, id := range []string{family.Id, other.Id} {
		f, err := p.family(id)
		if err != nil || f.auth != p.admin.auth || f.config.OpenAIAPIKey != p.config.OpenAIAPIKey {
			t.Fatal("family does not reuse global credentials")
		}
		if _, err := os.Stat(filepath.Join(f.config.DataDir, "chatgpt.json")); !os.IsNotExist(err) {
			t.Fatal("family created a separate grant file")
		}
		if w := portalCall(p, "GET", "/api/v1/families/"+id+"/status", "", parent, ""); w.Code != 200 || !strings.Contains(w.Body.String(), `"ready":true`) {
			t.Fatal("family is not ready from shared model and connection:", w.Body.String())
		}
	}
	settings.Model = "family-cannot-change-global-model"
	body, _ := json.Marshal(settings)
	if w := portalCall(p, "PUT", base+"/admin/settings", string(body), parent, csrf); w.Code != 403 {
		t.Fatal("family can change shared model")
	}
	if w := portalCall(p, "POST", base+"/admin/preview", `{"model":"other-model","prompt":"Explain simply","text":"Hello"}`, parent, csrf); w.Code != 403 {
		t.Fatal("preview bypassed shared model")
	}
	// Disconnect stops work in all family runtimes and affects their readiness.
	f, _ := p.family(family.Id)
	ctx, release, ok := f.reserve(context.Background(), "work")
	if !ok {
		t.Fatal("reserve")
	}
	defer release()
	p.admin.auth.creds = credentials{HostID: p.admin.auth.creds.HostID}
	if w := portalCall(p, "DELETE", "/api/v1/admin/connection", "", admin, ac); w.Code != 204 {
		t.Fatal(w.Body.String())
	}
	select {
	case <-ctx.Done():
	default:
		t.Fatal("family generation continued after global disconnect")
	}
	if w := portalCall(p, "GET", base+"/status", "", parent, ""); strings.Contains(w.Body.String(), `"ready":true`) {
		t.Fatal("family ready after global disconnect")
	}
	p.db.Exec(`UPDATE portal_sessions SET portal_admin=0 WHERE token_hash=?`, digest(admin.Value))
	if w := portalCall(p, "GET", "/api/v1/admin/connection", "", admin, ""); w.Code != http.StatusForbidden {
		t.Fatal("revoked admin retained access")
	}
}

func TestSharedGrantMigrationAndPersistence(t *testing.T) {
	for _, count := range []int{1, 2} {
		t.Run(strconv.Itoa(count)+" connected families", func(t *testing.T) {
			config := Config{DataDir: t.TempDir(), Origin: "https://lumi.test"}
			var familyDirs []string
			for i := range count {
				dir := filepath.Join(config.DataDir, "families", string(rune('a'+i)))
				familyDirs = append(familyDirs, dir)
				family, err := NewServer(Config{DataDir: dir, Origin: config.Origin})
				if err != nil {
					t.Fatal(err)
				}
				family.auth.creds.RefreshToken = "private-grant"
				family.auth.creds.Scopes = permission
				family.auth.creds.ExpiresAt = time.Now().Add(time.Hour)
				if err := family.auth.save(); err != nil {
					t.Fatal(err)
				}
				settings := defaultSettings()
				settings.Model = "existing-model"
				family.store.SaveSettings(settings)
				family.Close()
			}
			shared, err := newSharedServer(config)
			if err != nil {
				t.Fatal(err)
			}
			settings, err := shared.settings()
			if err != nil {
				t.Fatal(err)
			}
			if count == 1 && (!shared.auth.Status().Connected || settings.Model != "existing-model") {
				t.Fatal("the single existing grant and model were not preserved")
			}
			if count == 2 && shared.auth.Status().Connected {
				t.Fatal("picked an account from ambiguous family grants")
			}
			shared.Close()
			reopened, err := newSharedServer(config)
			if err != nil {
				t.Fatal(err)
			}
			defer reopened.Close()
			if reopened.auth.Status().Connected != (count == 1) {
				t.Fatal("global grant did not persist")
			}
			for _, dir := range familyDirs {
				if _, err := os.Stat(filepath.Join(dir, "chatgpt.json")); err != nil {
					t.Fatal("migration removed an existing credential file")
				}
			}
		})
	}
}

func TestSignedAdminRoleRefreshAndRevocation(t *testing.T) {
	issuer := newPortalIssuer(t)
	issuer.admin = true
	p := oidcPortal(t, issuer)
	login, _, _ := loginPortal(t, p, issuer)
	var cookie *http.Cookie
	for _, c := range login.Result().Cookies() {
		if c.Name == "lumi_session" {
			cookie = c
		}
	}
	if cookie == nil {
		t.Fatal("missing login session")
	}
	if w := portalCall(p, "GET", "/api/v1/session", "", cookie, ""); !strings.Contains(w.Body.String(), `"admin":true`) {
		t.Fatal("signed admin role not persisted:", w.Body.String())
	}
	if w := portalCall(p, "GET", "/api/v1/admin/connection", "", cookie, ""); w.Code != 200 {
		t.Fatal("signed admin denied")
	}
	issuer.admin = false
	if _, err := p.db.Exec(`UPDATE portal_sessions SET access_expires=0`); err != nil {
		t.Fatal(err)
	}
	if w := portalCall(p, "GET", "/api/v1/session", "", cookie, ""); !strings.Contains(w.Body.String(), `"admin":false`) || !strings.Contains(w.Body.String(), `"portalAccess":true`) {
		t.Fatal("admin revocation did not preserve normal portal access:", w.Body.String())
	}
	if w := portalCall(p, "GET", "/api/v1/admin/connection", "", cookie, ""); w.Code != 403 {
		t.Fatal("revoked signed admin still authorized")
	}
}

func TestAdminRoleIsExplicit(t *testing.T) {
	var claims accessClaims
	claims.Realm.Roles = []string{"portal-access"}
	if hasAdmin(claims) {
		t.Fatal("portal approval grants administrator rights")
	}
	claims.Realm.Roles = append(claims.Realm.Roles, "portal-admin")
	if !hasAdmin(claims) {
		t.Fatal("explicit administrator role ignored")
	}
}
