package app

import (
	"database/sql"
	"errors"
	"net/http"

	"lumi/internal/api"
)

func (p *Portal) ListAdminFamilies(w http.ResponseWriter, r *http.Request) {
	rows, err := p.db.Query(`SELECT f.id,f.name,f.access_enabled,count(m.user_id) FROM families f LEFT JOIN memberships m ON m.family_id=f.id GROUP BY f.id ORDER BY f.name,f.id`)
	if err != nil {
		internalError(w, err)
		return
	}
	defer rows.Close()
	families := []api.AdminFamily{}
	for rows.Next() {
		var f api.AdminFamily
		if err = rows.Scan(&f.Id, &f.Name, &f.AccessEnabled, &f.MemberCount); err != nil {
			internalError(w, err)
			return
		}
		families = append(families, f)
	}
	if err = rows.Err(); err != nil {
		internalError(w, err)
		return
	}
	sendJSON(w, 200, families)
}

func (p *Portal) UpdateFamilyAccess(w http.ResponseWriter, r *http.Request, familyID string) {
	var body struct {
		AccessEnabled *bool `json:"accessEnabled"`
	}
	if !decode(w, r, &body) {
		return
	}
	if body.AccessEnabled == nil {
		problem(w, 400, "invalid_access", "Indica se abilitare l’accesso alla famiglia.")
		return
	}
	result, err := p.db.Exec(`UPDATE families SET access_enabled=? WHERE id=?`, *body.AccessEnabled, familyID)
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
		problem(w, 404, "not_found", "Questa famiglia non è disponibile.")
		return
	}
	if !*body.AccessEnabled {
		p.familiesMu.Lock()
		if f := p.families[familyID]; f != nil {
			f.cancelAll()
		}
		p.familiesMu.Unlock()
	}
	w.WriteHeader(204)
}

// Administrators manage access without gaining access to family conversations.
func (p *Portal) withFamilyManagement(w http.ResponseWriter, r *http.Request, id string, serve func()) {
	if !currentSession(r).Admin {
		p.withFamily(w, r, id, true, func(_ *Server) { serve() })
		return
	}
	var exists int
	err := p.db.QueryRow(`SELECT 1 FROM families WHERE id=?`, id).Scan(&exists)
	if errors.Is(err, sql.ErrNoRows) {
		problem(w, 404, "not_found", "Questa famiglia non è disponibile.")
		return
	}
	if err != nil {
		internalError(w, err)
		return
	}
	serve()
}
