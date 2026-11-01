package app

import (
	"bytes"
	"database/sql"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"strconv"
	"time"

	"lumi/internal/api"
)

const accessRetryDelay = 24 * time.Hour

type accessRequest struct {
	id, userID, status string
	attempt            int
	requestedAt        int64
	decidedAt          sql.NullInt64
}

func (p *Portal) accessRequest(userID string) (accessRequest, error) {
	var a accessRequest
	err := p.db.QueryRow(`SELECT id,user_id,status,attempt,requested_at,decided_at FROM access_requests WHERE user_id=?`, userID).Scan(&a.id, &a.userID, &a.status, &a.attempt, &a.requestedAt, &a.decidedAt)
	return a, err
}
func (a accessRequest) state() api.AccessRequestState {
	result := api.AccessRequestState{Status: api.AccessRequestStateStatus(a.status)}
	if a.status == "" {
		result.Status = "not_requested"
		return result
	}
	requested := time.Unix(a.requestedAt, 0).UTC()
	result.RequestedAt = &requested
	if a.decidedAt.Valid {
		decided := time.Unix(a.decidedAt.Int64, 0).UTC()
		result.DecidedAt = &decided
		if a.status == "rejected" {
			retry := decided.Add(accessRetryDelay)
			result.RetryAfter = &retry
		}
	}
	return result
}

func (p *Portal) GetAccessRequest(w http.ResponseWriter, r *http.Request) {
	sess := currentSession(r)
	a, err := p.accessRequest(sess.UserID)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		internalError(w, err)
		return
	}
	if sess.Access {
		sendJSON(w, 200, api.AccessRequestState{Status: "approved"})
		return
	}
	// An approval is history, not permission: revoked users must request access again.
	if a.status == "approved" {
		sendJSON(w, 200, api.AccessRequestState{Status: "not_requested"})
		return
	}
	sendJSON(w, 200, a.state())
}

func (p *Portal) RequestAccess(w http.ResponseWriter, r *http.Request) {
	body, err := io.ReadAll(http.MaxBytesReader(w, r.Body, 1024))
	if err != nil || len(bytes.TrimSpace(body)) != 0 {
		problem(w, 400, "invalid_body", "La richiesta non deve contenere dati personali o ruoli.")
		return
	}
	p.accessMu.Lock()
	defer p.accessMu.Unlock()
	sess := currentSession(r)
	if sess.Access {
		sendJSON(w, 200, api.AccessRequestState{Status: "approved"})
		return
	}
	a, err := p.accessRequest(sess.UserID)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		internalError(w, err)
		return
	}
	now := time.Now().Unix()
	if a.status == "pending" {
		sendJSON(w, 200, a.state())
		return
	}
	if a.status == "rejected" && now < a.decidedAt.Int64+int64(accessRetryDelay/time.Second) {
		w.Header().Set("Retry-After", strconv.FormatInt(a.decidedAt.Int64+int64(accessRetryDelay/time.Second)-now, 10))
		sendJSON(w, 429, a.state())
		return
	}
	status := 200
	if a.id == "" {
		a.id = randomID()
		a.userID = sess.UserID
		status = 201
	}
	a.status = "pending"
	a.attempt++
	a.requestedAt = now
	a.decidedAt = sql.NullInt64{}
	tx, err := p.db.Begin()
	if err != nil {
		internalError(w, err)
		return
	}
	defer tx.Rollback()
	_, err = tx.Exec(`INSERT INTO access_requests(id,user_id,status,attempt,requested_at) VALUES(?,?,?,?,?)
 ON CONFLICT(user_id) DO UPDATE SET status='pending',attempt=excluded.attempt,requested_at=excluded.requested_at,decided_at=NULL,decided_by=NULL`, a.id, a.userID, a.status, a.attempt, now)
	if err == nil {
		_, err = tx.Exec(`INSERT INTO access_request_events(request_id,attempt,event,occurred_at,actor_id) VALUES(?,?,'requested',?,?)`, a.id, a.attempt, now, sess.UserID)
	}
	if err == nil {
		err = tx.Commit()
	}
	if err != nil {
		internalError(w, err)
		return
	}
	sendJSON(w, status, a.state())
}

func (p *Portal) ListAccessRequests(w http.ResponseWriter, r *http.Request) {
	rows, err := p.db.Query(`SELECT a.id,i.email,a.requested_at,a.attempt FROM access_requests a JOIN identities i ON i.id=a.user_id WHERE a.status='pending' ORDER BY a.requested_at,a.id`)
	if err != nil {
		internalError(w, err)
		return
	}
	defer rows.Close()
	result := []api.PendingAccessRequest{}
	for rows.Next() {
		var a api.PendingAccessRequest
		var requested int64
		if err = rows.Scan(&a.Id, &a.Email, &requested, &a.Attempt); err != nil {
			internalError(w, err)
			return
		}
		a.RequestedAt = time.Unix(requested, 0).UTC()
		result = append(result, a)
	}
	if err = rows.Err(); err != nil {
		internalError(w, err)
		return
	}
	sendJSON(w, 200, result)
}

func (p *Portal) DecideAccessRequest(w http.ResponseWriter, r *http.Request, requestID string) {
	var decision api.AccessDecision
	if !decode(w, r, &decision) {
		return
	}
	if decision.Attempt < 1 || (decision.Decision != "approve" && decision.Decision != "reject") {
		problem(w, 400, "invalid_decision", "Scegli Approva o Rifiuta.")
		return
	}
	p.accessMu.Lock()
	defer p.accessMu.Unlock()
	var a accessRequest
	var subject, issuer string
	err := p.db.QueryRow(`SELECT a.id,a.user_id,a.status,a.attempt,a.requested_at,a.decided_at,i.subject,i.issuer FROM access_requests a JOIN identities i ON i.id=a.user_id WHERE a.id=?`, requestID).Scan(&a.id, &a.userID, &a.status, &a.attempt, &a.requestedAt, &a.decidedAt, &subject, &issuer)
	if errors.Is(err, sql.ErrNoRows) {
		problem(w, 404, "not_found", "Questa richiesta non è disponibile.")
		return
	}
	if err != nil {
		internalError(w, err)
		return
	}
	target := "approved"
	if decision.Decision == "reject" {
		target = "rejected"
	}
	if a.attempt != decision.Attempt || (a.status != "pending" && a.status != target) {
		problem(w, 409, "request_changed", "La richiesta è cambiata. Aggiorna le notifiche.")
		return
	}
	if a.status == target {
		sendJSON(w, 200, a.state())
		return
	}
	if target == "approved" {
		if p.approvals == nil {
			problem(w, 503, "approval_not_configured", "Configura il collegamento amministrativo a Keycloak per approvare gli accessi.")
			return
		}
		if issuer != p.config.OIDCIssuer {
			problem(w, 409, "invalid_identity", "L’identità della richiesta non è disponibile.")
			return
		}
		if err = p.approvals.grantAccess(r.Context(), subject); err != nil {
			slog.Warn("access approval failed", "request_id", a.id, "error", err)
			problem(w, 502, "approval_failed", "Non riesco ad aggiornare l’accesso su Keycloak. La richiesta resta in attesa: riprova.")
			return
		}
	}
	// The session lock prevents a concurrent refresh from overwriting forced expiry.
	p.sessionMu.Lock()
	defer p.sessionMu.Unlock()
	tx, err := p.db.Begin()
	if err != nil {
		internalError(w, err)
		return
	}
	defer tx.Rollback()
	now := time.Now().Unix()
	actor := currentSession(r).UserID
	_, err = tx.Exec(`UPDATE access_requests SET status=?,decided_at=?,decided_by=? WHERE id=? AND attempt=?`, target, now, actor, a.id, a.attempt)
	if err == nil {
		_, err = tx.Exec(`INSERT INTO access_request_events(request_id,attempt,event,occurred_at,actor_id) VALUES(?,?,?,?,?)`, a.id, a.attempt, target, now, actor)
	}
	if err == nil && target == "approved" {
		_, err = tx.Exec(`UPDATE portal_sessions SET access_expires=0 WHERE user_id=?`, a.userID)
	}
	if err == nil {
		err = tx.Commit()
	}
	if err != nil {
		internalError(w, err)
		return
	}
	a.status = target
	a.decidedAt = sql.NullInt64{Int64: now, Valid: true}
	sendJSON(w, 200, a.state())
}

// A manually granted Keycloak role also resolves pending notifications. Only a
// verified signed access token can reach this path; local history grants nothing.
func (p *Portal) reconcileAccessRequest(sess portalSession) error {
	// Normal sessions must not wait behind an unrelated Keycloak approval call.
	a, err := p.accessRequest(sess.UserID)
	if errors.Is(err, sql.ErrNoRows) || (err == nil && a.status != "pending") {
		return nil
	}
	if err != nil {
		return err
	}
	p.accessMu.Lock()
	defer p.accessMu.Unlock()
	a, err = p.accessRequest(sess.UserID)
	if errors.Is(err, sql.ErrNoRows) || (err == nil && a.status != "pending") {
		return nil
	}
	if err != nil {
		return err
	}
	tx, err := p.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	now := time.Now().Unix()
	_, err = tx.Exec(`UPDATE access_requests SET status='approved',decided_at=?,decided_by=? WHERE id=?`, now, sess.UserID, a.id)
	if err == nil {
		_, err = tx.Exec(`INSERT INTO access_request_events(request_id,attempt,event,occurred_at,actor_id) VALUES(?,?,'external_approval',?,?)`, a.id, a.attempt, now, sess.UserID)
	}
	if err != nil {
		return err
	}
	return tx.Commit()
}
