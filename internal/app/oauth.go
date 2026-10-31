package app

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/coreos/go-oidc/v3/oidc"
	"github.com/google/uuid"
	"lumi/internal/api"
)

const permission = "chatgpt.tokens.use.direct"
const callbackURI = "http://127.0.0.1:1455/auth/callback"
const resource = "https://api.openai.com/v1"

var errConnection = errors.New("Un amministratore deve collegare il piano ChatGPT nella sezione Admin.")

func randomID() string       { return rand.Text() }
func digest(s string) string { h := sha256.Sum256([]byte(s)); return hex.EncodeToString(h[:]) }
func equal(a, b string) bool { return subtle.ConstantTimeCompare([]byte(a), []byte(b)) == 1 }

type credentials struct {
	HostID       string    `json:"hostId"`
	ClientID     string    `json:"clientId"`
	Subject      string    `json:"subject"`
	Email        string    `json:"email"`
	AccessToken  string    `json:"accessToken"`
	RefreshToken string    `json:"refreshToken"`
	IDToken      string    `json:"idToken"`
	Scopes       string    `json:"scopes"`
	ExpiresAt    time.Time `json:"expiresAt"`
}
type authAttempt struct {
	State, Nonce, Verifier, ClientID, Subject string
	Expires                                   time.Time
}
type OAuth struct {
	mu                   sync.Mutex
	path, issuer, apiURL string
	http                 *http.Client
	creds                credentials
	pending              map[string]authAttempt
	provider             *oidc.Provider
	reason               string
}

func NewOAuth(dir string) (*OAuth, error) {
	o := &OAuth{path: filepath.Join(dir, "chatgpt.json"), issuer: "https://auth.openai.com", apiURL: resource, http: &http.Client{Timeout: 30 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}, pending: map[string]authAttempt{}}
	b, err := os.ReadFile(o.path)
	if err == nil {
		if err = json.Unmarshal(b, &o.creds); err != nil {
			return nil, fmt.Errorf("invalid credential file")
		}
	} else if !os.IsNotExist(err) {
		return nil, err
	}
	// Earlier versions prefixed rand.Text() with urn:uuid:, producing an invalid
	// UUID URI. Repair that value only before registration; never rotate a host
	// identity associated with an existing grant.
	_, hostErr := uuid.Parse(o.creds.HostID)
	legacyHost := strings.HasPrefix(o.creds.HostID, "urn:uuid:") && hostErr != nil
	unregistered := o.creds.ClientID == "" && o.creds.AccessToken == "" && o.creds.RefreshToken == "" && o.creds.IDToken == ""
	if o.creds.HostID == "" || (legacyHost && unregistered) {
		o.creds.HostID = uuid.New().URN()
		if err = o.save(); err != nil {
			return nil, err
		}
	}
	return o, nil
}
func (o *OAuth) save() error {
	b, err := json.Marshal(o.creds)
	if err != nil {
		return err
	}
	f, err := os.CreateTemp(filepath.Dir(o.path), ".credentials-*")
	if err != nil {
		return err
	}
	name := f.Name()
	defer os.Remove(name)
	if err = f.Chmod(0600); err == nil {
		_, err = f.Write(b)
	}
	if err == nil {
		err = f.Sync()
	}
	closeErr := f.Close()
	if err == nil {
		err = closeErr
	}
	if err != nil {
		return err
	}
	return os.Rename(name, o.path)
}
func hasPermission(scope string) bool {
	for _, s := range strings.Fields(scope) {
		if s == permission {
			return true
		}
	}
	return false
}
func (o *OAuth) Status() api.ConnectionStatus {
	o.mu.Lock()
	defer o.mu.Unlock()
	return api.ConnectionStatus{Connected: o.creds.RefreshToken != "" && hasPermission(o.creds.Scopes) && o.reason == "", Email: o.creds.Email, Message: o.reason}
}
func (o *OAuth) Start(session string) api.OAuthStart {
	o.mu.Lock()
	defer o.mu.Unlock()
	for k, a := range o.pending {
		if time.Now().After(a.Expires) {
			delete(o.pending, k)
		}
	}
	a := authAttempt{State: randomID(), Nonce: randomID(), Verifier: randomID() + randomID(), ClientID: o.creds.ClientID, Subject: o.creds.Subject, Expires: time.Now().Add(10 * time.Minute)}
	o.pending[session] = a
	hash := sha256.Sum256([]byte(a.Verifier))
	clientID := a.ClientID
	if clientID == "" {
		clientID = "dynamic_agent_client"
	}
	q := url.Values{"client_id": {clientID}, "ext_agent_host_id": {o.creds.HostID}, "redirect_uri": {callbackURI}, "response_type": {"code"}, "scope": {"openid profile email offline_access resource.invoke " + permission}, "resource": {resource}, "state": {a.State}, "nonce": {a.Nonce}, "code_challenge_method": {"S256"}, "code_challenge": {base64.RawURLEncoding.EncodeToString(hash[:])}}
	if a.ClientID == "" {
		q.Set("agent_name_hint", "Lumi")
	}
	// No retained ID token in a URL returned to browser JavaScript.
	return api.OAuthStart{AuthorizationUrl: o.issuer + "/api/accounts/authorize?" + q.Encode(), ExpiresAt: a.Expires}
}
func (o *OAuth) discovery(ctx context.Context) (*oidc.Provider, error) {
	if o.provider != nil {
		return o.provider, nil
	}
	p, err := oidc.NewProvider(oidc.ClientContext(ctx, o.http), o.issuer)
	if err == nil {
		o.provider = p
	}
	return p, err
}

type tokenSet struct {
	AccessToken  string `json:"access_token"`
	RefreshToken string `json:"refresh_token"`
	IDToken      string `json:"id_token"`
	Scope        string `json:"scope"`
	ExpiresIn    int    `json:"expires_in"`
}

func (o *OAuth) tokenRequest(ctx context.Context, form url.Values) (tokenSet, int, error) {
	var t tokenSet
	req, err := http.NewRequestWithContext(ctx, "POST", o.issuer+"/api/accounts/oauth/token", strings.NewReader(form.Encode()))
	if err != nil {
		return t, 0, err
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	res, err := o.http.Do(req)
	if err != nil {
		return t, 0, errors.New("OpenAI non è raggiungibile. Riprova tra poco.")
	}
	defer res.Body.Close()
	if res.StatusCode != 200 {
		return t, res.StatusCode, errors.New("Autorizzazione non valida o scaduta. Avvia un nuovo collegamento.")
	}
	err = json.NewDecoder(io.LimitReader(res.Body, 1<<20)).Decode(&t)
	if err != nil || t.AccessToken == "" || t.ExpiresIn <= 0 {
		return t, 200, errors.New("Risposta di autorizzazione incompleta.")
	}
	return t, 200, nil
}
func (o *OAuth) Complete(ctx context.Context, session, raw string) error {
	o.mu.Lock()
	defer o.mu.Unlock()
	a, ok := o.pending[session]
	if !ok || time.Now().After(a.Expires) {
		delete(o.pending, session)
		return errors.New("Collegamento scaduto. Ricomincia dal pulsante ChatGPT.")
	}
	u, err := url.Parse(strings.TrimSpace(raw))
	if err != nil || u.Scheme != "http" || u.Host != "127.0.0.1:1455" || u.Path != "/auth/callback" || u.User != nil || u.Fragment != "" {
		return errors.New("Incolla l'URL completo che inizia con " + callbackURI)
	}
	q, err := url.ParseQuery(u.RawQuery)
	if err != nil {
		return errors.New("URL di ritorno non valido.")
	}
	for _, v := range q {
		if len(v) != 1 {
			return errors.New("URL di ritorno ambiguo.")
		}
	}
	if !equal(a.State, q.Get("state")) {
		return errors.New("Il collegamento non corrisponde a questa sessione.")
	}
	delete(o.pending, session)
	if q.Get("error") != "" {
		return errors.New("Consenso annullato. Puoi riprovare quando vuoi.")
	}
	if q.Get("code") == "" {
		return errors.New("Manca il codice di autorizzazione.")
	}
	cid := q.Get("client_id")
	if a.ClientID != "" {
		if cid != "" && cid != a.ClientID {
			return errors.New("Registrazione diversa da quella attesa.")
		}
		cid = a.ClientID
	}
	if cid == "" || cid == "dynamic_agent_client" {
		return errors.New("OpenAI non ha restituito l'identificativo della registrazione.")
	}
	tokens, _, err := o.tokenRequest(ctx, url.Values{"grant_type": {"authorization_code"}, "client_id": {cid}, "code": {q.Get("code")}, "code_verifier": {a.Verifier}, "redirect_uri": {callbackURI}, "resource": {resource}})
	if err != nil {
		return err
	}
	if !hasPermission(tokens.Scope) || tokens.RefreshToken == "" {
		return errors.New("Il consenso non include l'uso del piano ChatGPT e il rinnovo della sessione.")
	}
	p, err := o.discovery(ctx)
	if err != nil {
		return errors.New("Impossibile verificare l'identità OpenAI. Ricomincia il collegamento.")
	}
	id, err := p.Verifier(&oidc.Config{ClientID: cid}).Verify(oidc.ClientContext(ctx, o.http), tokens.IDToken)
	if err != nil || !equal(id.Nonce, a.Nonce) || id.Subject == "" {
		return errors.New("Identità OpenAI non verificata.")
	}
	if a.Subject != "" && a.Subject != id.Subject {
		return errors.New("L'account è diverso da quello collegato. Scollega prima l'account precedente.")
	}
	var claims struct {
		Email string `json:"email"`
	}
	if err = id.Claims(&claims); err != nil {
		return errors.New("Identità OpenAI incompleta.")
	}
	old := o.creds
	o.creds = credentials{HostID: old.HostID, ClientID: cid, Subject: id.Subject, Email: claims.Email, AccessToken: tokens.AccessToken, RefreshToken: tokens.RefreshToken, IDToken: tokens.IDToken, Scopes: tokens.Scope, ExpiresAt: time.Now().Add(time.Duration(tokens.ExpiresIn) * time.Second)}
	if err = o.save(); err != nil {
		o.creds = old
		return errors.New("Impossibile salvare il collegamento sul server.")
	}
	o.reason = ""
	return nil
}
func (o *OAuth) Token(ctx context.Context, rejected string) (string, error) {
	o.mu.Lock()
	defer o.mu.Unlock()
	if o.creds.RefreshToken == "" || !hasPermission(o.creds.Scopes) {
		return "", errConnection
	}
	if o.creds.AccessToken != "" && time.Until(o.creds.ExpiresAt) > time.Minute && (rejected == "" || rejected != o.creds.AccessToken) {
		return o.creds.AccessToken, nil
	}
	t, status, err := o.tokenRequest(ctx, url.Values{"grant_type": {"refresh_token"}, "client_id": {o.creds.ClientID}, "refresh_token": {o.creds.RefreshToken}, "resource": {resource}})
	if err != nil {
		if status == 400 || status == 401 || status == 403 {
			o.reason = "Il collegamento ChatGPT è scaduto. Ricollegalo dall'area coach."
		}
		return "", err
	}
	o.creds.AccessToken = t.AccessToken
	o.creds.ExpiresAt = time.Now().Add(time.Duration(t.ExpiresIn) * time.Second)
	if t.RefreshToken != "" {
		o.creds.RefreshToken = t.RefreshToken
	}
	if t.IDToken != "" {
		o.creds.IDToken = t.IDToken
	}
	if t.Scope != "" {
		o.creds.Scopes = t.Scope
	}
	if err = o.save(); err != nil {
		o.reason = "Impossibile salvare il rinnovo. Verifica lo spazio sul server."
		return "", errors.New(o.reason)
	}
	if !hasPermission(o.creds.Scopes) {
		o.reason = "L'uso del piano ChatGPT non è autorizzato."
		return "", errors.New(o.reason)
	}
	o.reason = ""
	return o.creds.AccessToken, nil
}
func (o *OAuth) Models(ctx context.Context) ([]api.ModelChoice, error) {
	token, err := o.Token(ctx, "")
	if err != nil {
		return nil, err
	}
	for attempt := 0; attempt < 2; attempt++ {
		req, _ := http.NewRequestWithContext(ctx, "GET", o.apiURL+"/models", nil)
		req.Header.Set("Authorization", "Bearer "+token)
		res, err := o.http.Do(req)
		if err != nil {
			return nil, errors.New("Non riesco a leggere i modelli OpenAI.")
		}
		if res.StatusCode == 401 && attempt == 0 {
			res.Body.Close()
			token, err = o.Token(ctx, token)
			if err != nil {
				return nil, err
			}
			continue
		}
		if res.StatusCode != 200 {
			res.Body.Close()
			return nil, errors.New("Catalogo modelli non disponibile per questo account.")
		}
		var body struct {
			Models []struct {
				Slug       string `json:"slug"`
				Name       string `json:"display_name"`
				Visibility string `json:"visibility"`
			} `json:"models"`
		}
		err = json.NewDecoder(io.LimitReader(res.Body, 2<<20)).Decode(&body)
		res.Body.Close()
		if err != nil {
			return nil, errors.New("Catalogo modelli non valido.")
		}
		out := []api.ModelChoice{}
		for _, m := range body.Models {
			if m.Visibility == "list" && m.Slug != "" {
				if m.Name == "" {
					m.Name = m.Slug
				}
				out = append(out, api.ModelChoice{Slug: m.Slug, DisplayName: m.Name})
			}
		}
		return out, nil
	}
	return nil, errConnection
}
func (o *OAuth) Disconnect(ctx context.Context) error {
	o.mu.Lock()
	defer o.mu.Unlock()
	if o.creds.RefreshToken != "" {
		p, err := o.discovery(ctx)
		if err != nil {
			return errors.New("Revoca non confermata: riprova o scollega Lumi dalle impostazioni ChatGPT.")
		}
		var meta struct {
			URL string `json:"revocation_endpoint"`
		}
		if p.Claims(&meta) != nil || meta.URL == "" {
			return errors.New("Endpoint di revoca non disponibile.")
		}
		u, err := url.Parse(meta.URL)
		issuer, _ := url.Parse(o.issuer)
		if err != nil || u.Host != issuer.Host || u.Scheme != issuer.Scheme {
			return errors.New("Endpoint di revoca non valido.")
		}
		req, _ := http.NewRequestWithContext(ctx, "POST", meta.URL, strings.NewReader(url.Values{"token": {o.creds.RefreshToken}, "token_type_hint": {"refresh_token"}, "client_id": {o.creds.ClientID}}.Encode()))
		req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
		res, err := o.http.Do(req)
		if err != nil {
			return errors.New("Revoca non confermata: riprova o scollega Lumi dalle impostazioni ChatGPT.")
		}
		res.Body.Close()
		if res.StatusCode != 200 {
			return errors.New("Revoca non confermata. Il collegamento è stato conservato per riprovare.")
		}
	}
	o.creds = credentials{HostID: o.creds.HostID}
	o.pending = map[string]authAttempt{}
	o.reason = ""
	return o.save()
}
