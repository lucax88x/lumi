package app

import (
	"context"
	"database/sql"
	"errors"
	"log/slog"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/coreos/go-oidc/v3/oidc"
	"golang.org/x/oauth2"
	"lumi/internal/api"
)

func loginError(w http.ResponseWriter, r *http.Request, code string) {
	http.Redirect(w, r, "/errore?code="+url.QueryEscape(code), http.StatusSeeOther)
}
func loginInternalError(w http.ResponseWriter, r *http.Request, err error) {
	slog.Error("storage operation failed", "error", err)
	loginError(w, r, "storage_error")
}

func safeReturn(raw string) string {
	u, e := url.Parse(raw)
	if e != nil || u.IsAbs() || u.Host != "" || !strings.HasPrefix(raw, "/") || strings.HasPrefix(raw, "//") || strings.ContainsAny(raw, "\\\r\n") || strings.HasPrefix(u.Path, "/auth/") {
		return "/"
	}
	return u.String()
}
func (p *Portal) cookie(w http.ResponseWriter, name, value string, seconds int) {
	http.SetCookie(w, &http.Cookie{Name: name, Value: value, Path: "/", HttpOnly: true, Secure: strings.HasPrefix(p.config.Origin, "https://"), SameSite: http.SameSiteLaxMode, MaxAge: seconds})
}
func (p *Portal) beginLogin(w http.ResponseWriter, r *http.Request) {
	binding, state, nonce, verifier := randomID()+randomID(), randomID(), randomID(), oauth2.GenerateVerifier()
	_, err := p.db.Exec(`DELETE FROM login_attempts WHERE expires_at<?`, time.Now().Unix())
	if err != nil {
		loginInternalError(w, r, err)
		return
	}
	_, err = p.db.Exec(`INSERT INTO login_attempts VALUES(?,?,?,?,?,?)`, digest(binding), state, nonce, verifier, safeReturn(r.URL.Query().Get("return")), time.Now().Add(10*time.Minute).Unix())
	if err != nil {
		loginInternalError(w, r, err)
		return
	}
	p.cookie(w, "lumi_login", binding, 600)
	http.Redirect(w, r, p.oauth.AuthCodeURL(state, oidc.Nonce(nonce), oauth2.S256ChallengeOption(verifier), oauth2.SetAuthURLParam("ui_locales", "it")), http.StatusSeeOther)
}
func (p *Portal) finishLogin(w http.ResponseWriter, r *http.Request) {
	query := r.URL.Query()
	logFailure := func(reason string, extra ...any) {
		attrs := []any{"stage", "callback", "reason", reason,
			"state_present", query.Get("state") != "", "code_present", query.Get("code") != "",
			"provider_error_present", query.Get("error") != ""}
		slog.Warn("OIDC login validation failed", append(attrs, extra...)...)
	}
	cookie, err := r.Cookie("lumi_login")
	if err != nil || len(cookie.Value) > 100 {
		if err != nil {
			logFailure("missing_cookie")
		} else {
			logFailure("oversized_cookie")
		}
		loginError(w, r, "invalid_login")
		return
	}
	var state, nonce, verifier, target string
	err = p.db.QueryRow(`DELETE FROM login_attempts WHERE token_hash=? AND expires_at>? RETURNING state,nonce,verifier,return_to`, digest(cookie.Value), time.Now().Unix()).Scan(&state, &nonce, &verifier, &target)
	p.cookie(w, "lumi_login", "", -1)
	if err != nil || !equal(state, query.Get("state")) || query.Get("code") == "" {
		switch {
		case errors.Is(err, sql.ErrNoRows):
			logFailure("attempt_missing_or_expired")
		case err != nil:
			logFailure("database_error", "error", err)
		case !equal(state, query.Get("state")):
			logFailure("state_mismatch")
		default:
			logFailure("missing_code")
		}
		loginError(w, r, "invalid_login")
		return
	}
	ctx := oidc.ClientContext(r.Context(), p.client)
	token, err := p.oauth.Exchange(ctx, query.Get("code"), oauth2.VerifierOption(verifier))
	if err != nil {
		loginError(w, r, "login_failed")
		return
	}
	raw, _ := token.Extra("id_token").(string)
	id, err := p.provider.Verifier(&oidc.Config{ClientID: p.config.OIDCClientID}).Verify(ctx, raw)
	if err != nil || !equal(id.Nonce, nonce) {
		slog.Warn("OIDC login validation failed", "stage", "id_token_or_nonce")
		loginError(w, r, "invalid_identity")
		return
	}
	var identity struct {
		Email    string `json:"email"`
		Verified bool   `json:"email_verified"`
	}
	if id.Claims(&identity) != nil || identity.Email == "" || !identity.Verified {
		loginError(w, r, "email_unverified")
		return
	}
	access, err := p.verifyAccess(ctx, token.AccessToken)
	if err != nil || access.Subject != id.Subject {
		slog.Warn("OIDC login validation failed", "stage", "access_token_or_subject")
		loginError(w, r, "invalid_identity")
		return
	}
	if old, _ := r.Cookie("lumi_session"); old != nil {
		_, err = p.db.Exec(`DELETE FROM portal_sessions WHERE token_hash=?`, digest(old.Value))
		if err != nil {
			loginInternalError(w, r, err)
			return
		}
	}
	value, err := p.createSession(identity.Email, id.Subject, token, access)
	if err != nil {
		loginInternalError(w, r, err)
		return
	}
	target, err = p.loginDestination(target, digest(p.config.OIDCIssuer+"\x00"+id.Subject), hasPortal(access))
	if err != nil {
		loginInternalError(w, r, err)
		return
	}
	p.cookie(w, "lumi_session", value, 43200)
	http.Redirect(w, r, safeReturn(target), http.StatusSeeOther)
}

func (p *Portal) loginDestination(target, userID string, approved bool) (string, error) {
	target = safeReturn(target)
	if target != "/" || !approved {
		return target, nil
	}
	families, err := p.userFamilies(userID)
	if err != nil {
		return "", err
	}
	var only string
	for _, family := range families {
		if !family.AccessEnabled {
			continue
		}
		if only != "" {
			return "/", nil
		}
		only = family.Id
	}
	if only != "" {
		return "/famiglie/" + only, nil
	}
	return "/", nil
}

type accessClaims struct {
	Subject string `json:"sub"`
	Realm   struct {
		Roles []string `json:"roles"`
	} `json:"realm_access"`
}

func (p *Portal) verifyAccess(ctx context.Context, raw string) (accessClaims, error) {
	var claims accessClaims
	verified, err := p.provider.Verifier(&oidc.Config{ClientID: p.config.OIDCClientID}).Verify(oidc.ClientContext(ctx, p.client), raw)
	if err != nil {
		return claims, err
	}
	err = verified.Claims(&claims)
	if err == nil && claims.Subject == "" {
		err = errors.New("missing subject")
	}
	return claims, err
}
func hasPortal(c accessClaims) bool {
	for _, role := range c.Realm.Roles {
		if role == "portal-access" {
			return true
		}
	}
	return false
}
func hasAdmin(c accessClaims) bool {
	for _, role := range c.Realm.Roles {
		if role == "portal-admin" {
			return true
		}
	}
	return false
}
func (p *Portal) createSession(email, subject string, token *oauth2.Token, claims accessClaims) (string, error) {
	if token.RefreshToken == "" || token.Expiry.IsZero() {
		return "", errors.New("provider must issue an expiring access token and refresh token")
	}
	id := digest(p.config.OIDCIssuer + "\x00" + subject)
	tx, err := p.db.Begin()
	if err != nil {
		return "", err
	}
	defer tx.Rollback()
	_, err = tx.Exec(`INSERT INTO identities(id,issuer,subject,email) VALUES(?,?,?,?) ON CONFLICT(issuer,subject) DO UPDATE SET email=excluded.email`, id, p.config.OIDCIssuer, subject, strings.ToLower(email))
	if err != nil {
		return "", err
	}
	value, csrf := randomID()+randomID(), randomID()
	now := time.Now()
	_, err = tx.Exec(`DELETE FROM portal_sessions WHERE expires_at<=? OR idle_expires<=?`, now.Unix(), now.Unix())
	if err != nil {
		return "", err
	}
	_, err = tx.Exec(`INSERT INTO portal_sessions VALUES(?,?,?,?,?,?,?,?,?,?,?)`, digest(value), id, csrf, token.AccessToken, token.RefreshToken, token.Expiry.Unix(), now.Add(12*time.Hour).Unix(), now.Add(30*time.Minute).Unix(), true, hasPortal(claims), hasAdmin(claims))
	if err != nil {
		return "", err
	}
	return value, tx.Commit()
}
func (p *Portal) resolveSession(r *http.Request) (portalSession, error) {
	cookie, err := r.Cookie("lumi_session")
	if err != nil || len(cookie.Value) > 100 {
		return portalSession{}, nil
	}
	p.sessionMu.Lock()
	defer p.sessionMu.Unlock()
	var s portalSession
	err = p.db.QueryRow(`SELECT s.token_hash,s.user_id,s.csrf,i.email,s.access_token,s.refresh_token,s.access_expires,s.expires_at,s.idle_expires,s.verified,s.portal_access,s.portal_admin FROM portal_sessions s JOIN identities i ON i.id=s.user_id WHERE s.token_hash=?`, digest(cookie.Value)).Scan(&s.Hash, &s.UserID, &s.CSRF, &s.Email, &s.AccessToken, &s.RefreshToken, &s.AccessExpires, &s.Expires, &s.Idle, &s.Verified, &s.Access, &s.Admin)
	if errors.Is(err, sql.ErrNoRows) {
		return portalSession{}, nil
	}
	if err != nil {
		return portalSession{}, err
	}
	now := time.Now()
	invalidate := func() (portalSession, error) {
		_, e := p.db.Exec(`DELETE FROM portal_sessions WHERE token_hash=?`, s.Hash)
		return portalSession{}, e
	}
	if s.Expires <= now.Unix() || s.Idle <= now.Unix() {
		return invalidate()
	}
	if s.AccessExpires <= now.Unix() && r.URL.Path != "/api/v1/logout" {
		ctx := oidc.ClientContext(r.Context(), p.client)
		token, e := p.oauth.TokenSource(ctx, &oauth2.Token{RefreshToken: s.RefreshToken}).Token()
		if e != nil {
			var rejected *oauth2.RetrieveError
			if errors.As(e, &rejected) && rejected.Response != nil && rejected.Response.StatusCode >= 400 && rejected.Response.StatusCode < 500 {
				return invalidate()
			}
			return portalSession{}, e
		}
		claims, e := p.verifyAccess(ctx, token.AccessToken)
		if e != nil {
			return invalidate()
		}
		if digest(p.config.OIDCIssuer+"\x00"+claims.Subject) != s.UserID {
			return invalidate()
		}
		// Refresh ID tokens supply current verified email; don't trust profile fields from the browser.
		if raw, ok := token.Extra("id_token").(string); ok {
			id, e := p.provider.Verifier(&oidc.Config{ClientID: p.config.OIDCClientID}).Verify(ctx, raw)
			if e != nil || id.Subject != claims.Subject {
				return invalidate()
			}
			var profile struct {
				Email    string `json:"email"`
				Verified bool   `json:"email_verified"`
			}
			if id.Claims(&profile) != nil || profile.Email == "" || !profile.Verified {
				return invalidate()
			}
			s.Email = strings.ToLower(profile.Email)
			s.Verified = profile.Verified
		}
		s.Access = hasPortal(claims)
		s.Admin = hasAdmin(claims)
		s.AccessToken = token.AccessToken
		if token.RefreshToken != "" {
			s.RefreshToken = token.RefreshToken
		}
		if token.Expiry.IsZero() {
			return invalidate()
		}
		s.AccessExpires = token.Expiry.Unix()
	}
	tx, e := p.db.Begin()
	if e != nil {
		return portalSession{}, e
	}
	defer tx.Rollback()
	if _, e = tx.Exec(`UPDATE identities SET email=? WHERE id=?`, s.Email, s.UserID); e != nil {
		return portalSession{}, e
	}
	_, e = tx.Exec(`UPDATE portal_sessions SET access_token=?,refresh_token=?,access_expires=?,portal_access=?,portal_admin=?,idle_expires=? WHERE token_hash=?`, s.AccessToken, s.RefreshToken, s.AccessExpires, s.Access, s.Admin, now.Add(30*time.Minute).Unix(), s.Hash)
	if e != nil {
		return portalSession{}, e
	}
	return s, tx.Commit()
}
func (p *Portal) GetSession(w http.ResponseWriter, r *http.Request) {
	sess := currentSession(r)
	families := []api.Family{}
	if sess.Access && sess.Verified {
		var err error
		families, err = p.userFamilies(sess.UserID)
		if err != nil {
			internalError(w, err)
			return
		}
	}
	sendJSON(w, 200, api.Session{Authenticated: true, PortalAccess: sess.Access && sess.Verified, Admin: sess.Admin && sess.Access && sess.Verified, Email: sess.Email, CsrfToken: sess.CSRF, Families: families})
}
func (p *Portal) Logout(w http.ResponseWriter, r *http.Request) {
	sess := currentSession(r)
	p.sessionMu.Lock()
	_, err := p.db.Exec(`DELETE FROM portal_sessions WHERE token_hash=?`, sess.Hash)
	p.sessionMu.Unlock()
	if err != nil {
		internalError(w, err)
		return
	}
	p.cookie(w, "lumi_session", "", -1)
	p.familiesMu.Lock()
	for _, f := range p.families {
		f.auth.mu.Lock()
		delete(f.auth.pending, sess.Hash)
		f.auth.mu.Unlock()
	}
	p.familiesMu.Unlock()
	// The refresh token is sent only over this server-to-server request.
	req, err := http.NewRequestWithContext(r.Context(), "POST", p.config.OIDCIssuer+"/protocol/openid-connect/logout", strings.NewReader(url.Values{"refresh_token": {sess.RefreshToken}}.Encode()))
	if err == nil {
		req.SetBasicAuth(p.oauth.ClientID, p.oauth.ClientSecret)
		req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
		res, e := p.client.Do(req)
		if e == nil {
			res.Body.Close()
			if res.StatusCode != 204 {
				err = errors.New("provider rejected logout")
			}
		} else {
			err = e
		}
	}
	if err != nil {
		problem(w, 502, "logout_incomplete", "Sei uscito da Lumi, ma non riesco a chiudere la sessione di accesso. Riprova da Keycloak.")
		return
	}
	w.WriteHeader(204)
}
