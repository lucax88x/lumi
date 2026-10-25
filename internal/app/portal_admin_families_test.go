package app

import (
	"encoding/json"
	"net/url"
	"strings"
	"testing"

	"lumi/internal/api"
)

func TestAdminManagesEveryFamilyAccess(t *testing.T) {
	p := portalTest(t)
	admin, ac, _ := seedPortalUser(t, p, "admin", true, true)
	parent, pc, pid := seedPortalUser(t, p, "parent", true, true)
	member, mc, mid := seedPortalUser(t, p, "member", true, true)
	if _, err := p.db.Exec(`UPDATE portal_sessions SET portal_admin=1 WHERE token_hash=?`, digest(admin.Value)); err != nil {
		t.Fatal(err)
	}
	f := createTestFamily(t, p, parent, pc, "Family A")
	other := createTestFamily(t, p, member, mc, "Family B")
	if !f.AccessEnabled {
		t.Fatal("new families must be enabled")
	}
	base := "/api/v1/families/" + f.Id
	access := "/api/v1/admin/families/" + f.Id + "/access"
	call := func(method, path, body string, want int) string {
		t.Helper()
		w := portalCall(p, method, path, body, admin, ac)
		if w.Code != want {
			t.Fatalf("%s %s: %d %s", method, path, w.Code, w.Body.String())
		}
		return w.Body.String()
	}
	var families []api.AdminFamily
	if err := json.Unmarshal([]byte(call("GET", "/api/v1/admin/families", "", 200)), &families); err != nil {
		t.Fatal(err)
	}
	if len(families) != 2 || families[0].Id != f.Id || families[1].Id != other.Id || families[0].MemberCount != 1 || !families[0].AccessEnabled {
		t.Fatalf("missing families: %+v", families)
	}
	for _, c := range []struct{ method, path, body string }{{"GET", "/api/v1/admin/families", ""}, {"PATCH", access, `{"accessEnabled":false}`}} {
		if w := portalCall(p, c.method, c.path, c.body, parent, pc); w.Code != 403 {
			t.Fatal("non-admin allowed to manage global access")
		}
	}
	if w := portalCall(p, "PATCH", access, `{"accessEnabled":false}`, admin, ""); w.Code != 403 {
		t.Fatal("missing CSRF accepted")
	}
	call("PATCH", access, `{}`, 400)
	call("PATCH", access, `{"accessEnabled":null}`, 400)
	call("PATCH", "/api/v1/admin/families/missing/access", `{"accessEnabled":false}`, 404)
	// Administrators may manage memberships without reading family conversations.
	call("GET", base+"/members", "", 200)
	call("GET", base+"/conversations", "", 404)
	call("PATCH", base+"/members/"+pid, `{"role":"member"}`, 409)
	call("DELETE", base+"/members/"+pid, "", 409)
	var invite api.InvitationCreated
	if err := json.Unmarshal([]byte(call("POST", base+"/invitations", `{"email":"member@example.test"}`, 201)), &invite); err != nil {
		t.Fatal(err)
	}
	u, err := url.Parse(invite.Url)
	if err != nil {
		t.Fatal(err)
	}
	body := `{"token":"` + u.Fragment + `"}`
	runtime, err := p.family(f.Id)
	if err != nil {
		t.Fatal(err)
	}
	active, release, ok := runtime.reserve(t.Context(), "active-response")
	if !ok {
		t.Fatal("could not start a response")
	}
	defer release()
	call("PATCH", access, `{"accessEnabled":false}`, 204)
	if active.Err() == nil {
		t.Fatal("suspension did not cancel the active response")
	}
	// Suspended families stay visible in session metadata, and the state survives reopening the database.
	w := portalCall(p, "GET", "/api/v1/session", "", parent, "")
	if !strings.Contains(w.Body.String(), `"accessEnabled":false`) {
		t.Fatal(w.Body.String())
	}
	db, err := openControl(p.config.DataDir)
	if err != nil {
		t.Fatal(err)
	}
	var enabled bool
	err = db.QueryRow(`SELECT access_enabled FROM families WHERE id=?`, f.Id).Scan(&enabled)
	db.Close()
	if err != nil || enabled {
		t.Fatal("suspension did not persist", err)
	}
	for _, path := range []string{"/status", "/conversations", "/admin/settings", "/members", "/invitations", "/dictionary"} {
		if w := portalCall(p, "GET", base+path, "", parent, ""); w.Code != 403 {
			t.Fatalf("suspended family exposed %s: %d", path, w.Code)
		}
	}
	if w := portalCall(p, "PATCH", base+"/members/"+pid, `{"role":"member"}`, parent, pc); w.Code != 403 {
		t.Fatal("suspended parent may change roles")
	}
	if w := portalCall(p, "POST", "/api/v1/invitations/accept", body, member, mc); w.Code != 404 {
		t.Fatal("suspended invitation accepted")
	}
	call("GET", base+"/members", "", 200)
	call("GET", base+"/invitations", "", 200)
	if w := portalCall(p, "GET", "/api/v1/families/"+other.Id+"/status", "", member, ""); w.Code != 200 {
		t.Fatal("suspension affected another family")
	}
	call("PATCH", access, `{"accessEnabled":true}`, 204)
	if w := portalCall(p, "POST", "/api/v1/invitations/accept", body, member, mc); w.Code != 200 {
		t.Fatal(w.Body.String())
	}
	call("PATCH", base+"/members/"+mid, `{"role":"parent"}`, 204)
	call("PATCH", base+"/members/"+pid, `{"role":"member"}`, 204)
	call("DELETE", base+"/members/"+pid, "", 204)
	if w := portalCall(p, "GET", base+"/status", "", parent, ""); w.Code != 404 {
		t.Fatal("removed parent retained access")
	}
	call("DELETE", base+"/members/"+mid, "", 409)
	call("POST", base+"/invitations", `{"email":"another@example.test"}`, 201)
	var invitations []api.Invitation
	if err := json.Unmarshal([]byte(call("GET", base+"/invitations", "", 200)), &invitations); err != nil {
		t.Fatal(err)
	}
	if len(invitations) != 1 {
		t.Fatal(invitations)
	}
	call("DELETE", base+"/invitations/"+invitations[0].Id, "", 204)
	call("GET", "/api/v1/families/missing/members", "", 404)
}
