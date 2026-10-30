package app

import (
	"database/sql"
	"errors"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
)

func TestAdminDeletesOnlySuspendedFamiliesAndTheirData(t *testing.T) {
	p := portalTest(t)
	admin, ac, _ := seedPortalUser(t, p, "admin", true, true)
	parent, pc, _ := seedPortalUser(t, p, "parent", true, true)
	member, mc, _ := seedPortalUser(t, p, "member", true, true)
	if _, err := p.db.Exec(`UPDATE portal_sessions SET portal_admin=1 WHERE token_hash=?`, digest(admin.Value)); err != nil {
		t.Fatal(err)
	}
	family := createTestFamily(t, p, parent, pc, "Delete me")
	other := createTestFamily(t, p, member, mc, "Keep me")
	invite := createTestInvitation(t, p, parent, pc, family.Id, "member@example.test")
	runtime, err := p.family(family.Id)
	if err != nil {
		t.Fatal(err)
	}
	active, release, ok := runtime.reserve(t.Context(), "work")
	if !ok {
		t.Fatal("reserve")
	}
	defer release()
	path := "/api/v1/admin/families/" + family.Id
	for _, call := range []struct {
		cookie *http.Cookie
		csrf   string
		want   int
	}{{nil, "", 401}, {parent, pc, 403}, {member, mc, 403}, {admin, "", 403}, {admin, ac, 409}} {
		if w := portalCall(p, "DELETE", path, "", call.cookie, call.csrf); w.Code != call.want {
			t.Fatal(w.Code, call.want, w.Body.String())
		}
	}
	if w := portalCall(p, "PATCH", path+"/access", `{"accessEnabled":false}`, admin, ac); w.Code != 204 {
		t.Fatal(w.Body.String())
	}
	if active.Err() == nil {
		t.Fatal("work not canceled")
	}
	if w := portalCall(p, "DELETE", path, "", admin, ac); w.Code != 204 {
		t.Fatal(w.Code, w.Body.String())
	}
	if _, err := os.Stat(runtime.config.DataDir); !os.IsNotExist(err) {
		t.Fatal("family directory survived", err)
	}
	for _, query := range []string{`SELECT count(*) FROM families WHERE id=?`, `SELECT count(*) FROM memberships WHERE family_id=?`, `SELECT count(*) FROM invitations WHERE family_id=?`} {
		var count int
		if err := p.db.QueryRow(query, family.Id).Scan(&count); err != nil || count != 0 {
			t.Fatal("data survived", query, count, err)
		}
	}
	if p.families[family.Id] != nil {
		t.Fatal("runtime survived")
	}
	if _, err := runtime.store.Settings(); err == nil {
		t.Fatal("store not closed")
	}
	if _, err := p.family(family.Id); !errors.Is(err, sql.ErrNoRows) {
		t.Fatal("deleted runtime recreated", err)
	}
	if w := portalCall(p, "GET", "/api/v1/session", "", parent, ""); strings.Contains(w.Body.String(), family.Id) {
		t.Fatal("membership survived", w.Body.String())
	}
	if w := portalCall(p, "GET", "/api/v1/admin/families", "", admin, ""); strings.Contains(w.Body.String(), family.Id) || !strings.Contains(w.Body.String(), other.Id) {
		t.Fatal(w.Body.String())
	}
	if w := portalCall(p, "POST", "/api/v1/invitations/"+invite.Invitation.Id+"/accept", "", member, mc); w.Code != 404 {
		t.Fatal("invite survived")
	}
	if w := portalCall(p, "GET", "/api/v1/families/"+family.Id+"/status", "", parent, ""); w.Code != 404 {
		t.Fatal("access survived")
	}
	if w := portalCall(p, "GET", "/api/v1/families/"+other.Id+"/status", "", member, ""); w.Code != 200 {
		t.Fatal("other family affected")
	}
	if _, err := p.admin.store.Settings(); err != nil {
		t.Fatal("shared server affected", err)
	}
	for _, suffix := range []string{family.Id, "missing"} {
		if w := portalCall(p, "DELETE", "/api/v1/admin/families/"+suffix, "", admin, ac); w.Code != 404 {
			t.Fatal(w.Code, w.Body.String())
		}
	}
	// The deletion is durable, not just hidden from the current runtime.
	db, err := openControl(p.config.DataDir)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	var count int
	if err := db.QueryRow(`SELECT count(*) FROM families WHERE id=?`, family.Id).Scan(&count); err != nil || count != 0 {
		t.Fatal("deletion did not persist", err)
	}
}

func TestFamilyDeletionFailureRemainsSuspendedAndRetryable(t *testing.T) {
	for _, failure := range []string{"filesystem", "database"} {
		t.Run(failure, func(t *testing.T) {
			p := portalTest(t)
			admin, ac, _ := seedPortalUser(t, p, "admin", true, true)
			if _, err := p.db.Exec(`UPDATE portal_sessions SET portal_admin=1 WHERE token_hash=?`, digest(admin.Value)); err != nil {
				t.Fatal(err)
			}
			family := createTestFamily(t, p, admin, ac, "Retry")
			if _, err := p.db.Exec(`UPDATE families SET access_enabled=0 WHERE id=?`, family.Id); err != nil {
				t.Fatal(err)
			}
			familiesDir := filepath.Join(p.config.DataDir, "families")
			if failure == "filesystem" {
				if err := os.WriteFile(familiesDir, []byte("blocks family directory"), 0600); err != nil {
					t.Fatal(err)
				}
			} else {
				if _, err := p.db.Exec(`CREATE TRIGGER prevent_delete BEFORE DELETE ON families BEGIN SELECT RAISE(FAIL,'test failure'); END`); err != nil {
					t.Fatal(err)
				}
			}
			path := "/api/v1/admin/families/" + family.Id
			if w := portalCall(p, "DELETE", path, "", admin, ac); w.Code != 500 {
				t.Fatal("expected failure", w.Code, w.Body.String())
			}
			var enabled bool
			if err := p.db.QueryRow(`SELECT access_enabled FROM families WHERE id=?`, family.Id).Scan(&enabled); err != nil || enabled {
				t.Fatal("family not retryable", err)
			}
			if failure == "filesystem" {
				if err := os.Remove(familiesDir); err != nil {
					t.Fatal(err)
				}
			} else {
				if _, err := p.db.Exec(`DROP TRIGGER prevent_delete`); err != nil {
					t.Fatal(err)
				}
			}
			if w := portalCall(p, "DELETE", path, "", admin, ac); w.Code != 204 {
				t.Fatal("retry failed", w.Code, w.Body.String())
			}
		})
	}
}

func TestFamilyDeletionSerializesWithReactivation(t *testing.T) {
	p := portalTest(t)
	admin, ac, _ := seedPortalUser(t, p, "admin", true, true)
	if _, err := p.db.Exec(`UPDATE portal_sessions SET portal_admin=1 WHERE token_hash=?`, digest(admin.Value)); err != nil {
		t.Fatal(err)
	}
	family := createTestFamily(t, p, admin, ac, "Race")
	if _, err := p.db.Exec(`UPDATE families SET access_enabled=0 WHERE id=?`, family.Id); err != nil {
		t.Fatal(err)
	}
	path := "/api/v1/admin/families/" + family.Id
	var wg sync.WaitGroup
	var deleted, activated int
	wg.Go(func() { deleted = portalCall(p, "DELETE", path, "", admin, ac).Code })
	wg.Go(func() { activated = portalCall(p, "PATCH", path+"/access", `{"accessEnabled":true}`, admin, ac).Code })
	wg.Wait()
	if !((deleted == 204 && activated == 404) || (deleted == 409 && activated == 204)) {
		t.Fatal("inconsistent result", deleted, activated)
	}
}
