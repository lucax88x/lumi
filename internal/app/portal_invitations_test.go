package app

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"testing"

	"lumi/internal/api"
)

func createTestInvitation(t *testing.T, p *Portal, parent *http.Cookie, csrf, familyID, email string) api.InvitationCreated {
	t.Helper()
	w := portalCall(p, "POST", "/api/v1/families/"+familyID+"/invitations", fmt.Sprintf(`{"email":%q}`, email), parent, csrf)
	if w.Code != 201 {
		t.Fatalf("create invitation: %d %s", w.Code, w.Body.String())
	}
	var invitation api.InvitationCreated
	if err := json.Unmarshal(w.Body.Bytes(), &invitation); err != nil {
		t.Fatal(err)
	}
	return invitation
}

func TestReceivedInvitationsFilterByVerifiedRecipientAndAvailability(t *testing.T) {
	p := portalTest(t)
	parent, pc, _ := seedPortalUser(t, p, "parent", true, true)
	guest, gc, _ := seedPortalUser(t, p, "guest", true, true)
	family := createTestFamily(t, p, parent, pc, "Family")
	valid := createTestInvitation(t, p, parent, pc, family.Id, "GUEST@example.test")
	createTestInvitation(t, p, parent, pc, family.Id, "someone@example.test")
	expired := createTestInvitation(t, p, parent, pc, family.Id, "guest@example.test")
	if _, err := p.db.Exec(`UPDATE invitations SET expires_at=0 WHERE id=?`, expired.Invitation.Id); err != nil {
		t.Fatal(err)
	}
	revoked := createTestInvitation(t, p, parent, pc, family.Id, "guest@example.test")
	if w := portalCall(p, "DELETE", "/api/v1/families/"+family.Id+"/invitations/"+revoked.Invitation.Id, "", parent, pc); w.Code != 204 {
		t.Fatal(w.Body.String())
	}
	suspended := createTestFamily(t, p, parent, pc, "Suspended")
	createTestInvitation(t, p, parent, pc, suspended.Id, "guest@example.test")
	if _, err := p.db.Exec(`UPDATE families SET access_enabled=0 WHERE id=?`, suspended.Id); err != nil {
		t.Fatal(err)
	}
	joined := createTestFamily(t, p, guest, gc, "Already joined")
	createTestInvitation(t, p, guest, gc, joined.Id, "guest@example.test")
	w := portalCall(p, "GET", "/api/v1/invitations", "", guest, "")
	var invitations []api.ReceivedInvitation
	if err := json.Unmarshal(w.Body.Bytes(), &invitations); err != nil {
		t.Fatal(w.Code, w.Body.String())
	}
	if len(invitations) != 1 || invitations[0].Id != valid.Invitation.Id || invitations[0].FamilyId != family.Id || invitations[0].FamilyName != family.Name {
		t.Fatalf("wrong invitations: %+v", invitations)
	}
	if strings.Contains(w.Body.String(), "token") || strings.Contains(w.Body.String(), "email") || strings.Contains(w.Body.String(), "someone") {
		t.Fatal("recipient listing exposed unnecessary identity or token data")
	}
	for _, who := range []struct {
		name             string
		access, verified bool
	}{{"pending", false, true}, {"unverified", true, false}} {
		cookie, csrf, _ := seedPortalUser(t, p, who.name, who.access, who.verified)
		for _, call := range []struct{ method, path string }{{"GET", "/api/v1/invitations"}, {"POST", "/api/v1/invitations/" + valid.Invitation.Id + "/accept"}, {"DELETE", "/api/v1/invitations/" + valid.Invitation.Id}} {
			if w := portalCall(p, call.method, call.path, "", cookie, csrf); w.Code != 403 {
				t.Fatalf("%s bypassed approval/verification: %d", who.name, w.Code)
			}
		}
	}
}

func TestReceivedInvitationAcceptDeclineAndSingleUse(t *testing.T) {
	for _, action := range []string{"accept", "decline"} {
		t.Run(action, func(t *testing.T) {
			p := portalTest(t)
			parent, pc, _ := seedPortalUser(t, p, "parent", true, true)
			guest, gc, guestID := seedPortalUser(t, p, "guest", true, true)
			wrong, wc, _ := seedPortalUser(t, p, "wrong", true, true)
			family := createTestFamily(t, p, parent, pc, "Family")
			invitation := createTestInvitation(t, p, parent, pc, family.Id, "guest@example.test")
			path := "/api/v1/invitations/" + invitation.Invitation.Id
			method := "DELETE"
			if action == "accept" {
				path += "/accept"
				method = "POST"
			}
			for _, call := range []struct {
				cookie *http.Cookie
				csrf   string
				want   int
			}{{nil, "", 401}, {wrong, wc, 404}, {guest, "", 403}} {
				if w := portalCall(p, method, path, "", call.cookie, call.csrf); w.Code != call.want {
					t.Fatalf("authorization: got %d want %d: %s", w.Code, call.want, w.Body.String())
				}
			}
			if _, err := p.db.Exec(`UPDATE identities SET email='Guest@EXAMPLE.test' WHERE id=?`, guestID); err != nil {
				t.Fatal(err)
			}
			want := 204
			if action == "accept" {
				want = 200
			}
			if w := portalCall(p, method, path, "", guest, gc); w.Code != want {
				t.Fatal(w.Code, w.Body.String())
			}
			if w := portalCall(p, method, path, "", guest, gc); w.Code != 404 {
				t.Fatal("invitation reused")
			}
			u, _ := url.Parse(invitation.Url)
			if w := portalCall(p, "POST", "/api/v1/invitations/accept", fmt.Sprintf(`{"token":%q}`, u.Fragment), guest, gc); w.Code != 404 {
				t.Fatal("consumed link reused")
			}
			var count int
			if err := p.db.QueryRow(`SELECT count(*) FROM memberships WHERE family_id=? AND user_id=?`, family.Id, guestID).Scan(&count); err != nil {
				t.Fatal(err)
			}
			if (count == 1) != (action == "accept") {
				t.Fatal("wrong membership result")
			}
			if w := portalCall(p, "GET", "/api/v1/invitations", "", guest, ""); strings.TrimSpace(w.Body.String()) != "[]" {
				t.Fatal(w.Body.String())
			}
		})
	}
}

func TestReceivedInvitationRejectsUnavailableAndPreservesRole(t *testing.T) {
	p := portalTest(t)
	parent, pc, _ := seedPortalUser(t, p, "parent", true, true)
	guest, gc, _ := seedPortalUser(t, p, "guest", true, true)
	family := createTestFamily(t, p, parent, pc, "Family")
	for _, state := range []string{"expired", "revoked", "suspended", "missing"} {
		invitation := createTestInvitation(t, p, parent, pc, family.Id, "guest@example.test")
		var err error
		switch state {
		case "expired":
			_, err = p.db.Exec(`UPDATE invitations SET expires_at=0 WHERE id=?`, invitation.Invitation.Id)
		case "revoked", "missing":
			_, err = p.db.Exec(`DELETE FROM invitations WHERE id=?`, invitation.Invitation.Id)
		case "suspended":
			_, err = p.db.Exec(`UPDATE families SET access_enabled=0 WHERE id=?`, family.Id)
		}
		if err != nil {
			t.Fatal(err)
		}
		for _, call := range []struct{ method, suffix string }{{"POST", "/accept"}, {"DELETE", ""}} {
			if w := portalCall(p, call.method, "/api/v1/invitations/"+invitation.Invitation.Id+call.suffix, "", guest, gc); w.Code != 404 {
				t.Fatal(state, w.Code, w.Body.String())
			}
		}
		if _, err = p.db.Exec(`UPDATE families SET access_enabled=1 WHERE id=?`, family.Id); err != nil {
			t.Fatal(err)
		}
	}
	invitation := createTestInvitation(t, p, parent, pc, family.Id, "parent@example.test")
	if w := portalCall(p, "GET", "/api/v1/invitations", "", parent, ""); strings.TrimSpace(w.Body.String()) != "[]" {
		t.Fatal("already joined family listed")
	}
	w := portalCall(p, "POST", "/api/v1/invitations/"+invitation.Invitation.Id+"/accept", "", parent, pc)
	if w.Code != 200 || !strings.Contains(w.Body.String(), `"role":"parent"`) {
		t.Fatal("parent role changed", w.Body.String())
	}
}

func TestInvitationLinkAndNotificationRaceConsumeOnce(t *testing.T) {
	p := portalTest(t)
	parent, pc, _ := seedPortalUser(t, p, "parent", true, true)
	guest, gc, _ := seedPortalUser(t, p, "guest", true, true)
	family := createTestFamily(t, p, parent, pc, "Family")
	invitation := createTestInvitation(t, p, parent, pc, family.Id, "guest@example.test")
	u, _ := url.Parse(invitation.Url)
	var wg sync.WaitGroup
	codes := make(chan int, 2)
	for _, call := range []struct{ path, body string }{{"/api/v1/invitations/accept", fmt.Sprintf(`{"token":%q}`, u.Fragment)}, {"/api/v1/invitations/" + invitation.Invitation.Id + "/accept", ""}} {
		wg.Go(func() { codes <- portalCall(p, "POST", call.path, call.body, guest, gc).Code })
	}
	wg.Wait()
	close(codes)
	counts := map[int]int{}
	for code := range codes {
		counts[code]++
	}
	if counts[200] != 1 || counts[404] != 1 {
		t.Fatal("double acceptance", counts)
	}
}
