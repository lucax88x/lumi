package app

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"lumi/internal/api"
)

func accessAdmin(t *testing.T, p *Portal) (*http.Cookie, string) {
	t.Helper()
	cookie, csrf, _ := seedPortalUser(t, p, "access-admin", true, true)
	if _, err := p.db.Exec(`UPDATE portal_sessions SET portal_admin=1 WHERE token_hash=?`, digest(cookie.Value)); err != nil {
		t.Fatal(err)
	}
	return cookie, csrf
}
func pendingRequest(t *testing.T, p *Portal, cookie *http.Cookie, csrf string) accessRequest {
	t.Helper()
	res := portalCall(p, "POST", "/api/v1/access-request", "", cookie, csrf)
	if res.Code != 201 && res.Code != 200 {
		t.Fatalf("request: %d %s", res.Code, res.Body.String())
	}
	var user string
	if err := p.db.QueryRow(`SELECT user_id FROM portal_sessions WHERE token_hash=?`, digest(cookie.Value)).Scan(&user); err != nil {
		t.Fatal(err)
	}
	a, err := p.accessRequest(user)
	if err != nil {
		t.Fatal(err)
	}
	return a
}
func decisionPath(a accessRequest) string {
	return "/api/v1/admin/access-requests/" + a.id + "/decision"
}
func decisionBody(a accessRequest, decision string) string {
	return fmt.Sprintf(`{"decision":%q,"attempt":%d}`, decision, a.attempt)
}

func TestAccessRequestGateAndNoDuplicates(t *testing.T) {
	p := portalTest(t)
	pending, csrf, user := seedPortalUser(t, p, "pending-access", false, true)
	for _, method := range []string{"GET", "POST"} {
		if got := portalCall(p, method, "/api/v1/access-request", "", nil, ""); got.Code != 401 {
			t.Fatal(got.Code)
		}
	}
	unverified, uc, _ := seedPortalUser(t, p, "unverified-access", false, false)
	if got := portalCall(p, "POST", "/api/v1/access-request", "", unverified, uc); got.Code != 403 {
		t.Fatal(got.Code)
	}
	if got := portalCall(p, "POST", "/api/v1/access-request", "", pending, ""); got.Code != 403 {
		t.Fatal("missing CSRF accepted")
	}
	if got := portalCall(p, "POST", "/api/v1/access-request", `{"email":"other@example.test","role":"portal-admin"}`, pending, csrf); got.Code != 400 {
		t.Fatal("identity supplied by browser accepted")
	}
	if got := portalCall(p, "GET", "/api/v1/access-request", "", pending, ""); !strings.Contains(got.Body.String(), `"not_requested"`) {
		t.Fatal(got.Body.String())
	}
	var wg sync.WaitGroup
	for i := 0; i < 16; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			res := portalCall(p, "POST", "/api/v1/access-request", "", pending, csrf)
			if res.Code != 200 && res.Code != 201 {
				t.Errorf("concurrent request %d", res.Code)
			}
		}()
	}
	wg.Wait()
	var count, events int
	p.db.QueryRow(`SELECT count(*) FROM access_requests WHERE user_id=?`, user).Scan(&count)
	p.db.QueryRow(`SELECT count(*) FROM access_request_events`).Scan(&events)
	if count != 1 || events != 1 {
		t.Fatalf("duplicates: requests=%d events=%d", count, events)
	}
	// A second session of the same identity reuses the same request.
	if _, err := p.db.Exec(`INSERT INTO portal_sessions SELECT ?,user_id,?,access_token,refresh_token,access_expires,expires_at,idle_expires,verified,portal_access,portal_admin FROM portal_sessions WHERE token_hash=?`, digest("second-session"), "second-csrf", digest(pending.Value)); err != nil {
		t.Fatal(err)
	}
	if got := portalCall(p, "POST", "/api/v1/access-request", "", &http.Cookie{Name: "lumi_session", Value: "second-session"}, "second-csrf"); got.Code != 200 {
		t.Fatal(got.Code)
	}
	for _, path := range []string{"/api/v1/families", "/api/v1/invitations", "/api/v1/admin/access-requests"} {
		if got := portalCall(p, "GET", path, "", pending, ""); got.Code != 403 {
			t.Fatalf("pending user admitted to %s", path)
		}
	}
	approved, ac, _ := seedPortalUser(t, p, "member-access", true, true)
	if got := portalCall(p, "GET", "/api/v1/admin/access-requests", "", approved, ac); got.Code != 403 {
		t.Fatal("nonadmin sees requests")
	}
	admin, adminCSRF := accessAdmin(t, p)
	res := portalCall(p, "GET", "/api/v1/admin/access-requests", "", admin, adminCSRF)
	var list []api.PendingAccessRequest
	json.Unmarshal(res.Body.Bytes(), &list)
	if res.Code != 200 || len(list) != 1 || list[0].Email != "pending-access@example.test" {
		t.Fatal(res.Body.String())
	}
	if strings.Contains(res.Body.String(), "server-only") {
		t.Fatal("token leaked")
	}
}

func TestAccessRejectionCooldownPersistenceAndStaleDecisions(t *testing.T) {
	p := portalTest(t)
	admin, ac := accessAdmin(t, p)
	cookie, csrf, user := seedPortalUser(t, p, "rejected-access", false, true)
	a := pendingRequest(t, p, cookie, csrf)
	reject := func(want int) {
		t.Helper()
		res := portalCall(p, "POST", decisionPath(a), decisionBody(a, "reject"), admin, ac)
		if res.Code != want {
			t.Fatal(res.Code, res.Body.String())
		}
	}
	reject(200)
	first, _ := p.accessRequest(user)
	reject(200)
	second, _ := p.accessRequest(user)
	if first.decidedAt != second.decidedAt {
		t.Fatal("duplicate rejection resets cooldown")
	}
	res := portalCall(p, "POST", "/api/v1/access-request", "", cookie, csrf)
	if res.Code != 429 || res.Header().Get("Retry-After") == "" || !strings.Contains(res.Body.String(), "retryAfter") {
		t.Fatal(res.Code, res.Body.String())
	}
	// Reopening the on-disk control DB preserves requests and audit events.
	db, err := openControl(p.config.DataDir)
	if err != nil {
		t.Fatal(err)
	}
	var count int
	db.QueryRow(`SELECT count(*) FROM access_request_events`).Scan(&count)
	db.Close()
	if count != 2 {
		t.Fatal(count)
	}
	old := time.Now().Add(-accessRetryDelay).Unix()
	if _, err = p.db.Exec(`UPDATE access_requests SET decided_at=? WHERE id=?`, old, a.id); err != nil {
		t.Fatal(err)
	}
	next := pendingRequest(t, p, cookie, csrf)
	if next.id != a.id || next.attempt != 2 {
		t.Fatal("resubmission duplicated request", next)
	}
	reject(409)
	// Exactly one new request event; no duplicate decision from the old attempt.
	p.db.QueryRow(`SELECT count(*) FROM access_request_events`).Scan(&count)
	if count != 3 {
		t.Fatal(count)
	}
}

type fakeApprovals struct {
	server           *httptest.Server
	fail             atomic.Bool
	grants           atomic.Int32
	tokens           atomic.Int32
	granted          atomic.Bool
	disabled         atomic.Bool
	rejectFirstToken atomic.Bool
}

func mockApprovals(t *testing.T, p *Portal) *fakeApprovals {
	t.Helper()
	f := &fakeApprovals{}
	f.server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasSuffix(r.URL.Path, "/token") {
			id, secret, ok := r.BasicAuth()
			r.ParseForm()
			if !ok || id != "lumi-access-approval" || secret != "private-service-secret" || r.Form.Get("grant_type") != "client_credentials" {
				t.Error("wrong service authentication")
			}
			index := f.tokens.Add(1)
			sendJSON(w, 200, map[string]any{"access_token": fmt.Sprintf("service-only-%d", index), "expires_in": 300, "token_type": "Bearer"})
			return
		}
		if !strings.HasPrefix(r.Header.Get("Authorization"), "Bearer service-only-") {
			t.Error("missing service token")
		}
		if f.rejectFirstToken.Load() && r.Header.Get("Authorization") == "Bearer service-only-1" {
			w.WriteHeader(401)
			return
		}
		if f.fail.Load() {
			w.WriteHeader(503)
			return
		}
		switch {
		case r.Method == "GET" && strings.HasSuffix(r.URL.Path, "/users/applicant"):
			sendJSON(w, 200, map[string]any{"id": "applicant", "enabled": !f.disabled.Load(), "emailVerified": true})
		case strings.HasSuffix(r.URL.Path, "/role-mappings/realm/composite"):
			roles := []keycloakRole{}
			if f.granted.Load() {
				roles = append(roles, keycloakRole{ID: "access-role", Name: "portal-access"})
			}
			sendJSON(w, 200, roles)
		case strings.HasSuffix(r.URL.Path, "/role-mappings/realm/available"):
			sendJSON(w, 200, []keycloakRole{{ID: "access-role", Name: "portal-access"}})
		case r.Method == "POST" && strings.HasSuffix(r.URL.Path, "/users/applicant/role-mappings/realm"):
			var roles []keycloakRole
			json.NewDecoder(r.Body).Decode(&roles)
			if len(roles) != 1 || roles[0].Name != "portal-access" {
				t.Error("unexpected role grant")
			}
			f.granted.Store(true)
			f.grants.Add(1)
			w.WriteHeader(204)
		default:
			t.Errorf("unexpected service request %s %s", r.Method, r.URL.Path)
			w.WriteHeader(404)
		}
	}))
	t.Cleanup(f.server.Close)
	p.config.OIDCIssuer = f.server.URL + "/realms/lumi"
	k, err := newKeycloakApprovals(Config{OIDCIssuer: p.config.OIDCIssuer, KeycloakAdminURL: f.server.URL, KeycloakApprovalClientSecret: "private-service-secret"})
	if err != nil {
		t.Fatal(err)
	}
	p.approvals = k
	return f
}

func TestAccessApprovalFailuresConcurrencyAndSignedSessionBoundary(t *testing.T) {
	p := portalTest(t)
	f := mockApprovals(t, p)
	admin, ac := accessAdmin(t, p)
	cookie, csrf, user := seedPortalUser(t, p, "applicant", false, true)
	a := pendingRequest(t, p, cookie, csrf)
	f.fail.Store(true)
	res := portalCall(p, "POST", decisionPath(a), decisionBody(a, "approve"), admin, ac)
	if res.Code != 502 || strings.Contains(res.Body.String(), "service-only") {
		t.Fatal(res.Code, res.Body.String())
	}
	stored, _ := p.accessRequest(user)
	if stored.status != "pending" {
		t.Fatal("failure consumed request")
	}
	f.fail.Store(false)
	f.disabled.Store(true)
	if got := portalCall(p, "POST", decisionPath(a), decisionBody(a, "approve"), admin, ac); got.Code != 502 {
		t.Fatal("disabled user approved")
	}
	f.disabled.Store(false)
	f.rejectFirstToken.Store(true)
	var wg sync.WaitGroup
	for i := 0; i < 8; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			got := portalCall(p, "POST", decisionPath(a), decisionBody(a, "approve"), admin, ac)
			if got.Code != 200 {
				t.Errorf("decision %d", got.Code)
			}
		}()
	}
	wg.Wait()
	if f.grants.Load() != 1 || f.tokens.Load() != 2 {
		t.Fatal("non-idempotent grant or failed token recovery", f.grants.Load(), f.tokens.Load())
	}
	var access, adminRole bool
	var expires int64
	if err := p.db.QueryRow(`SELECT portal_access,portal_admin,access_expires FROM portal_sessions WHERE token_hash=?`, digest(cookie.Value)).Scan(&access, &adminRole, &expires); err != nil {
		t.Fatal(err)
	}
	if access || adminRole || expires != 0 {
		t.Fatal("local approval bypassed signed roles or failed to force refresh")
	}
	// Simulate loss of the HTTP response or local commit: Keycloak already has the role.
	if _, err := p.db.Exec(`UPDATE access_requests SET status='pending' WHERE id=?`, a.id); err != nil {
		t.Fatal(err)
	}
	if got := portalCall(p, "POST", decisionPath(a), decisionBody(a, "approve"), admin, ac); got.Code != 200 {
		t.Fatal(got.Code)
	}
	if f.grants.Load() != 1 {
		t.Fatal("retry granted role again")
	}
}

func TestAccessApprovalConfigurationAndDecisionAuthorization(t *testing.T) {
	p := portalTest(t)
	admin, ac := accessAdmin(t, p)
	cookie, csrf, _ := seedPortalUser(t, p, "unconfigured-applicant", false, true)
	a := pendingRequest(t, p, cookie, csrf)
	if got := portalCall(p, "POST", decisionPath(a), decisionBody(a, "approve"), admin, ac); got.Code != 503 {
		t.Fatal(got.Code)
	}
	if got := portalCall(p, "POST", decisionPath(a), decisionBody(a, "reject"), admin, ""); got.Code != 403 {
		t.Fatal("missing CSRF accepted")
	}
	if got := portalCall(p, "POST", decisionPath(a), `{"decision":"portal-admin","attempt":1}`, admin, ac); got.Code != 400 {
		t.Fatal(got.Code)
	}
	if got := portalCall(p, "POST", decisionPath(a), `{"decision":"approve","attempt":1,"role":"portal-admin"}`, admin, ac); got.Code != 400 {
		t.Fatal(got.Code)
	}
	member, mc, _ := seedPortalUser(t, p, "ordinary-member", true, true)
	if got := portalCall(p, "POST", decisionPath(a), decisionBody(a, "reject"), member, mc); got.Code != 403 {
		t.Fatal("member made decision")
	}
	if got := portalCall(p, "POST", decisionPath(a), decisionBody(a, "reject"), admin, ac); got.Code != 200 {
		t.Fatal("rejection unnecessarily requires Keycloak")
	}
}

func TestAccessApprovalRefreshesSignedRolesWithoutNewLogin(t *testing.T) {
	issuer := newPortalIssuer(t)
	issuer.access = false
	p := oidcPortal(t, issuer)
	callback, _, _ := loginPortal(t, p, issuer)
	var cookie *http.Cookie
	for _, c := range callback.Result().Cookies() {
		if c.Name == "lumi_session" {
			cookie = c
		}
	}
	if cookie == nil {
		t.Fatal("missing session")
	}
	response := portalCall(p, "GET", "/api/v1/session", "", cookie, "")
	var session api.Session
	json.Unmarshal(response.Body.Bytes(), &session)
	a := pendingRequest(t, p, cookie, session.CsrfToken)
	// The grant completed elsewhere; force the same refresh boundary used by decisions.
	issuer.access = true
	if _, err := p.db.Exec(`UPDATE portal_sessions SET access_expires=0 WHERE token_hash=?`, digest(cookie.Value)); err != nil {
		t.Fatal(err)
	}
	response = portalCall(p, "GET", "/api/v1/session", "", cookie, "")
	if response.Code != 200 || !strings.Contains(response.Body.String(), `"portalAccess":true`) || !strings.Contains(response.Body.String(), `"admin":false`) {
		t.Fatal(response.Code, response.Body.String())
	}
	stored, err := p.accessRequest(a.userID)
	if err != nil || stored.status != "approved" {
		t.Fatal("manual grant not reconciled", stored, err)
	}
	// A later revoked signed role is not restored by this historical approval.
	issuer.access = false
	p.db.Exec(`UPDATE portal_sessions SET access_expires=0 WHERE token_hash=?`, digest(cookie.Value))
	response = portalCall(p, "GET", "/api/v1/session", "", cookie, "")
	if !strings.Contains(response.Body.String(), `"portalAccess":false`) {
		t.Fatal("approval history granted access")
	}
	response = portalCall(p, "GET", "/api/v1/access-request", "", cookie, "")
	if !strings.Contains(response.Body.String(), `"not_requested"`) {
		t.Fatal(response.Body.String())
	}
}

func TestKeycloakApprovalsRejectsRedirects(t *testing.T) {
	p := portalTest(t)
	f := mockApprovals(t, p)
	external := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { t.Error("service credentials followed a redirect") }))
	defer external.Close()
	redirect := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { http.Redirect(w, r, external.URL, 307) }))
	defer redirect.Close()
	p.approvals.credentials.TokenURL = redirect.URL
	if err := p.approvals.grantAccess(context.Background(), "applicant"); err == nil {
		t.Fatal("redirect accepted")
	}
	if f.grants.Load() != 0 {
		t.Fatal("unexpected grant")
	}
}

func TestAccessGrantRetryAfterLocalCommitFailure(t *testing.T) {
	p := portalTest(t)
	f := mockApprovals(t, p)
	admin, ac := accessAdmin(t, p)
	cookie, csrf, user := seedPortalUser(t, p, "applicant", false, true)
	a := pendingRequest(t, p, cookie, csrf)
	if _, err := p.db.Exec(`CREATE TRIGGER fail_approval_audit BEFORE INSERT ON access_request_events WHEN NEW.event='approved' BEGIN SELECT RAISE(ABORT,'simulated local failure'); END`); err != nil {
		t.Fatal(err)
	}
	response := portalCall(p, "POST", decisionPath(a), decisionBody(a, "approve"), admin, ac)
	if response.Code != 500 || f.grants.Load() != 1 {
		t.Fatal(response.Code, f.grants.Load())
	}
	stored, _ := p.accessRequest(user)
	if stored.status != "pending" {
		t.Fatal("failed transaction consumed request")
	}
	if _, err := p.db.Exec(`DROP TRIGGER fail_approval_audit`); err != nil {
		t.Fatal(err)
	}
	response = portalCall(p, "POST", decisionPath(a), decisionBody(a, "approve"), admin, ac)
	if response.Code != 200 || f.grants.Load() != 1 {
		t.Fatal("retry did not recover idempotently", response.Code, f.grants.Load())
	}
	var events int
	p.db.QueryRow(`SELECT count(*) FROM access_request_events WHERE request_id=?`, a.id).Scan(&events)
	if events != 2 {
		t.Fatal("non-atomic audit", events)
	}
}

func TestConcurrentAccessApprovalAndRejectionHaveOneWinner(t *testing.T) {
	p := portalTest(t)
	f := mockApprovals(t, p)
	admin, ac := accessAdmin(t, p)
	cookie, csrf, user := seedPortalUser(t, p, "applicant", false, true)
	a := pendingRequest(t, p, cookie, csrf)
	responses := make(chan int, 2)
	for _, decision := range []string{"approve", "reject"} {
		go func() { responses <- portalCall(p, "POST", decisionPath(a), decisionBody(a, decision), admin, ac).Code }()
	}
	first, second := <-responses, <-responses
	if !((first == 200 && second == 409) || (first == 409 && second == 200)) {
		t.Fatal(first, second)
	}
	stored, _ := p.accessRequest(user)
	if (stored.status == "approved") != (f.grants.Load() == 1) {
		t.Fatal("Keycloak disagrees with decision", stored.status, f.grants.Load())
	}
	var events int
	p.db.QueryRow(`SELECT count(*) FROM access_request_events WHERE request_id=?`, a.id).Scan(&events)
	if events != 2 {
		t.Fatal("both decisions recorded", events)
	}
}
