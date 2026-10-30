package app

import (
	"database/sql"
	"errors"
	"net/http"
	"net/mail"
	"strings"
	"time"

	"lumi/internal/api"
)

func (p *Portal) userFamilies(user string) ([]api.Family, error) {
	rows, err := p.db.Query(`SELECT f.id,f.name,m.role,f.access_enabled FROM families f JOIN memberships m ON m.family_id=f.id WHERE m.user_id=? ORDER BY f.name,f.id`, user)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []api.Family{}
	for rows.Next() {
		var f api.Family
		if err = rows.Scan(&f.Id, &f.Name, &f.Role, &f.AccessEnabled); err != nil {
			return nil, err
		}
		out = append(out, f)
	}
	return out, rows.Err()
}
func (p *Portal) ListFamilies(w http.ResponseWriter, r *http.Request) {
	families, err := p.userFamilies(currentSession(r).UserID)
	if err != nil {
		internalError(w, err)
		return
	}
	sendJSON(w, 200, families)
}
func (p *Portal) CreateFamily(w http.ResponseWriter, r *http.Request) {
	var body api.FamilyName
	if !decode(w, r, &body) {
		return
	}
	name := strings.TrimSpace(body.Name)
	if len([]rune(name)) < 1 || len([]rune(name)) > 80 {
		problem(w, 400, "invalid_name", "Scegli un nome da 1 a 80 caratteri.")
		return
	}
	id := randomID()
	tx, err := p.db.Begin()
	if err != nil {
		internalError(w, err)
		return
	}
	defer tx.Rollback()
	if _, err = tx.Exec(`INSERT INTO families(id,name) VALUES(?,?)`, id, name); err == nil {
		_, err = tx.Exec(`INSERT INTO memberships VALUES(?,?,'parent')`, id, currentSession(r).UserID)
	}
	if err == nil {
		err = tx.Commit()
	}
	if err != nil {
		internalError(w, err)
		return
	}
	sendJSON(w, 201, api.Family{Id: id, Name: name, Role: api.FamilyRoleParent, AccessEnabled: true})
}
func (p *Portal) ListMembers(w http.ResponseWriter, r *http.Request, familyID string) {
	p.withFamilyManagement(w, r, familyID, func() {
		rows, err := p.db.Query(`SELECT i.id,i.email,m.role FROM memberships m JOIN identities i ON i.id=m.user_id WHERE m.family_id=? ORDER BY i.email`, familyID)
		if err != nil {
			internalError(w, err)
			return
		}
		defer rows.Close()
		out := []api.FamilyMember{}
		for rows.Next() {
			var m api.FamilyMember
			if err = rows.Scan(&m.UserId, &m.Email, &m.Role); err != nil {
				internalError(w, err)
				return
			}
			out = append(out, m)
		}
		if err = rows.Err(); err != nil {
			internalError(w, err)
			return
		}
		sendJSON(w, 200, out)
	})
}
func (p *Portal) UpdateMember(w http.ResponseWriter, r *http.Request, familyID, userID string) {
	var body api.MemberRole
	if !decode(w, r, &body) {
		return
	}
	if body.Role != api.MemberRoleRoleParent && body.Role != api.MemberRoleRoleMember {
		problem(w, 400, "invalid_role", "Scegli genitore o membro.")
		return
	}
	p.changeMember(w, r, familyID, userID, string(body.Role))
}
func (p *Portal) RemoveMember(w http.ResponseWriter, r *http.Request, familyID, userID string) {
	p.changeMember(w, r, familyID, userID, "")
}
func (p *Portal) changeMember(w http.ResponseWriter, r *http.Request, familyID, userID, role string) {
	tx, err := p.db.Begin()
	if err != nil {
		internalError(w, err)
		return
	}
	defer tx.Rollback()
	// Authorization and last-parent checks share the same transaction as the mutation.
	var actor, target string
	if !currentSession(r).Admin {
		var enabled bool
		err = tx.QueryRow(`SELECT m.role,f.access_enabled FROM memberships m JOIN families f ON f.id=m.family_id WHERE family_id=? AND user_id=?`, familyID, currentSession(r).UserID).Scan(&actor, &enabled)
		if err != nil || actor != "parent" || !enabled {
			problem(w, 403, "parent_required", "Questa parte è riservata ai genitori di una famiglia attiva.")
			return
		}
	}
	err = tx.QueryRow(`SELECT role FROM memberships WHERE family_id=? AND user_id=?`, familyID, userID).Scan(&target)
	if errors.Is(err, sql.ErrNoRows) {
		problem(w, 404, "not_found", "Membro non trovato.")
		return
	}
	if err != nil {
		internalError(w, err)
		return
	}
	if target == "parent" && role != "parent" {
		var count int
		if err = tx.QueryRow(`SELECT count(*) FROM memberships WHERE family_id=? AND role='parent'`, familyID).Scan(&count); err != nil {
			internalError(w, err)
			return
		}
		if count <= 1 {
			problem(w, 409, "last_parent", "La famiglia deve avere almeno un genitore.")
			return
		}
	}
	if role == "" {
		_, err = tx.Exec(`DELETE FROM memberships WHERE family_id=? AND user_id=?`, familyID, userID)
	} else {
		_, err = tx.Exec(`UPDATE memberships SET role=? WHERE family_id=? AND user_id=?`, role, familyID, userID)
	}
	if err == nil {
		err = tx.Commit()
	}
	if err != nil {
		internalError(w, err)
		return
	}
	w.WriteHeader(204)
}
func (p *Portal) CreateInvitation(w http.ResponseWriter, r *http.Request, familyID string) {
	p.withFamilyManagement(w, r, familyID, func() {
		var body api.InviteEmail
		if !decode(w, r, &body) {
			return
		}
		email := strings.ToLower(strings.TrimSpace(string(body.Email)))
		parsed, err := mail.ParseAddress(email)
		if err != nil || parsed.Address != email || len(email) > 254 {
			problem(w, 400, "invalid_email", "Controlla l’indirizzo email.")
			return
		}
		token, id := randomID()+randomID(), randomID()
		expiry := time.Now().UTC().Add(7 * 24 * time.Hour)
		_, err = p.db.Exec(`INSERT INTO invitations VALUES(?,?,?,?,?)`, id, digest(token), familyID, email, expiry.Unix())
		if err != nil {
			internalError(w, err)
			return
		}
		sendJSON(w, 201, api.InvitationCreated{Invitation: api.Invitation{Id: id, Email: email, ExpiresAt: expiry}, Url: p.config.Origin + "/auth/invite#" + token})
		// The URL fragment is not sent in HTTP access logs or Referer headers.
	})
}
func (p *Portal) ListInvitations(w http.ResponseWriter, r *http.Request, familyID string) {
	p.withFamilyManagement(w, r, familyID, func() {
		rows, err := p.db.Query(`SELECT id,email,expires_at FROM invitations WHERE family_id=? AND expires_at>? ORDER BY expires_at`, familyID, time.Now().Unix())
		if err != nil {
			internalError(w, err)
			return
		}
		defer rows.Close()
		out := []api.Invitation{}
		for rows.Next() {
			var v api.Invitation
			var expires int64
			if err = rows.Scan(&v.Id, &v.Email, &expires); err != nil {
				internalError(w, err)
				return
			}
			v.ExpiresAt = time.Unix(expires, 0).UTC()
			out = append(out, v)
		}
		if err = rows.Err(); err != nil {
			internalError(w, err)
			return
		}
		sendJSON(w, 200, out)
	})
}
func (p *Portal) RevokeInvitation(w http.ResponseWriter, r *http.Request, familyID, invitationID string) {
	p.withFamilyManagement(w, r, familyID, func() {
		_, err := p.db.Exec(`DELETE FROM invitations WHERE family_id=? AND id=?`, familyID, invitationID)
		if err != nil {
			internalError(w, err)
			return
		}
		w.WriteHeader(204)
	})
}
func (p *Portal) AcceptInvitation(w http.ResponseWriter, r *http.Request) {
	var body api.InvitationToken
	if !decode(w, r, &body) {
		return
	}
	if len(body.Token) > 256 {
		problem(w, 400, "invalid_invitation", "Invito non valido.")
		return
	}
	p.acceptInvitation(w, r, "", digest(body.Token))
}

func (p *Portal) AcceptReceivedInvitation(w http.ResponseWriter, r *http.Request, invitationID string) {
	p.acceptInvitation(w, r, invitationID, "")
}

// Both entry points consume the same invitation in the membership transaction.
func (p *Portal) acceptInvitation(w http.ResponseWriter, r *http.Request, invitationID, tokenHash string) {
	sess := currentSession(r)
	tx, err := p.db.Begin()
	if err != nil {
		internalError(w, err)
		return
	}
	defer tx.Rollback()
	var id, familyID, email, name string
	query := `SELECT i.id,i.family_id,i.email,f.name FROM invitations i JOIN families f ON f.id=i.family_id WHERE expires_at>? AND f.access_enabled=1 AND `
	if invitationID != "" {
		err = tx.QueryRow(query+`i.id=? AND i.email=? COLLATE NOCASE`, time.Now().Unix(), invitationID, sess.Email).Scan(&id, &familyID, &email, &name)
	} else {
		err = tx.QueryRow(query+`token_hash=?`, time.Now().Unix(), tokenHash).Scan(&id, &familyID, &email, &name)
	}
	if errors.Is(err, sql.ErrNoRows) {
		problem(w, 404, "invalid_invitation", "L’invito è scaduto o non è più disponibile.")
		return
	}
	if err != nil {
		internalError(w, err)
		return
	}
	if !sess.Verified || !strings.EqualFold(email, sess.Email) {
		problem(w, 403, "invitation_email", "Accedi con l’indirizzo email verificato a cui è destinato l’invito.")
		return
	}
	_, err = tx.Exec(`INSERT INTO memberships VALUES(?,?,'member') ON CONFLICT(family_id,user_id) DO NOTHING`, familyID, sess.UserID)
	if err == nil {
		_, err = tx.Exec(`DELETE FROM invitations WHERE id=?`, id)
	}
	var role api.FamilyRole
	if err == nil {
		err = tx.QueryRow(`SELECT role FROM memberships WHERE family_id=? AND user_id=?`, familyID, sess.UserID).Scan(&role)
	}
	if err == nil {
		err = tx.Commit()
	}
	if err != nil {
		internalError(w, err)
		return
	}
	sendJSON(w, 200, api.Family{Id: familyID, Name: name, Role: role, AccessEnabled: true})
}

func (p *Portal) ListReceivedInvitations(w http.ResponseWriter, r *http.Request) {
	sess := currentSession(r)
	rows, err := p.db.Query(`SELECT i.id,i.family_id,f.name,i.expires_at
		FROM invitations i JOIN families f ON f.id=i.family_id
		WHERE i.email=? COLLATE NOCASE AND i.expires_at>? AND f.access_enabled=1
		AND NOT EXISTS(SELECT 1 FROM memberships m WHERE m.family_id=i.family_id AND m.user_id=?)
		ORDER BY i.expires_at,i.id`, sess.Email, time.Now().Unix(), sess.UserID)
	if err != nil {
		internalError(w, err)
		return
	}
	defer rows.Close()
	out := []api.ReceivedInvitation{}
	for rows.Next() {
		var invitation api.ReceivedInvitation
		var expires int64
		if err = rows.Scan(&invitation.Id, &invitation.FamilyId, &invitation.FamilyName, &expires); err != nil {
			internalError(w, err)
			return
		}
		invitation.ExpiresAt = time.Unix(expires, 0).UTC()
		out = append(out, invitation)
	}
	if err = rows.Err(); err != nil {
		internalError(w, err)
		return
	}
	sendJSON(w, 200, out)
}

func (p *Portal) DeclineInvitation(w http.ResponseWriter, r *http.Request, invitationID string) {
	result, err := p.db.Exec(`DELETE FROM invitations WHERE id=? AND email=? COLLATE NOCASE AND expires_at>?
		AND EXISTS(SELECT 1 FROM families f WHERE f.id=invitations.family_id AND f.access_enabled=1)`,
		invitationID, currentSession(r).Email, time.Now().Unix())
	if err != nil {
		internalError(w, err)
		return
	}
	count, err := result.RowsAffected()
	if err != nil {
		internalError(w, err)
		return
	}
	if count == 0 {
		problem(w, 404, "invalid_invitation", "L’invito è scaduto o non è più disponibile.")
		return
	}
	w.WriteHeader(204)
}
