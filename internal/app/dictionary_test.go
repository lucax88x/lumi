package app

import (
	"encoding/json"
	"testing"

	"lumi/internal/api"
)

func TestDictionaryFamilyIsolationParentDeletionAndCSRF(t *testing.T) {
	p := portalTest(t)
	parent, csrf, _ := seedPortalUser(t, p, "parent", true, true)
	member, memberCSRF, memberID := seedPortalUser(t, p, "member", true, true)
	family := createTestFamily(t, p, parent, csrf, "Family")
	other := createTestFamily(t, p, member, memberCSRF, "Other")
	base := "/api/v1/families/" + family.Id
	f, err := p.family(family.Id)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = f.store.Create("word", "Word"); err != nil {
		t.Fatal(err)
	}
	m, _, err := f.store.StartTurn("word", "one", "vigoroso")
	if err != nil {
		t.Fatal(err)
	}
	m.Status = "completed"
	m.WordExplanation = &vigorousWord
	if err = f.store.Finish(m); err != nil {
		t.Fatal(err)
	}
	entries, _ := f.store.Dictionary()
	id := entries[0].Id
	if w := portalCall(p, "GET", base+"/dictionary", "", nil, ""); w.Code != 401 {
		t.Fatal("anonymous dictionary access", w.Code)
	}
	if w := portalCall(p, "GET", base+"/dictionary", "", member, ""); w.Code != 404 {
		t.Fatal("cross-family dictionary access", w.Code)
	}
	for _, suffix := range []string{"", "/" + id} {
		if w := portalCall(p, "DELETE", base+"/admin/dictionary"+suffix, "", member, memberCSRF); w.Code != 404 {
			t.Fatal("cross-family dictionary deletion", w.Code)
		}
	}
	if w := portalCall(p, "GET", "/api/v1/families/"+other.Id+"/dictionary", "", member, ""); w.Code != 200 || w.Body.String() != "[]\n" {
		t.Fatal("family data leaked", w.Body.String())
	}
	if _, err = p.db.Exec(`INSERT INTO memberships VALUES(?,?,'member')`, family.Id, memberID); err != nil {
		t.Fatal(err)
	}
	w := portalCall(p, "GET", base+"/dictionary", "", member, "")
	var got []api.DictionaryEntry
	if w.Code != 200 || json.Unmarshal(w.Body.Bytes(), &got) != nil || len(got) != 1 || got[0].Word != "vigoroso" {
		t.Fatal("member cannot read dictionary", w.Body.String())
	}
	for _, suffix := range []string{"", "/" + id} {
		if w := portalCall(p, "DELETE", base+"/admin/dictionary"+suffix, "", member, memberCSRF); w.Code != 403 {
			t.Fatal("member could delete dictionary", w.Code)
		}
		if w := portalCall(p, "DELETE", base+"/admin/dictionary"+suffix, "", parent, ""); w.Code != 403 {
			t.Fatal("dictionary deletion bypassed CSRF", w.Code)
		}
	}
	_, release, ok := f.reserve(t.Context(), "active")
	if !ok {
		t.Fatal("reserve failed")
	}
	if w := portalCall(p, "DELETE", base+"/admin/dictionary", "", parent, csrf); w.Code != 409 {
		t.Fatal("deleted during generation", w.Code)
	}
	release()
	if w := portalCall(p, "DELETE", base+"/admin/dictionary/"+id, "", parent, csrf); w.Code != 204 {
		t.Fatal(w.Body.String())
	}
	entries, _ = f.store.Dictionary()
	if len(entries) != 0 {
		t.Fatal("word was not deleted")
	}
	// Replays of an already completed message must not resurrect a removed card.
	if err = f.store.Finish(m); err != nil {
		t.Fatal(err)
	}
	entries, _ = f.store.Dictionary()
	if len(entries) != 0 {
		t.Fatal("replay restored deleted word")
	}
	detail, _ := f.store.Conversation("word")
	if detail.Messages[1].WordExplanation == nil {
		t.Fatal("dictionary deletion removed chat cards")
	}
	m, _, _ = f.store.StartTurn("word", "two", "vigoroso")
	m.Status = "completed"
	m.WordExplanation = &vigorousWord
	if err = f.store.Finish(m); err != nil {
		t.Fatal(err)
	}
	if w := portalCall(p, "DELETE", base+"/admin/dictionary", "", parent, csrf); w.Code != 204 {
		t.Fatal(w.Body.String())
	}
	entries, _ = f.store.Dictionary()
	if len(entries) != 0 {
		t.Fatal("dictionary was not cleared")
	}
}
