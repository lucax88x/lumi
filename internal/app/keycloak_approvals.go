package app

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"

	"golang.org/x/oauth2"
	"golang.org/x/oauth2/clientcredentials"
)

type keycloakApprovals struct {
	base        string
	realm       string
	client      *http.Client
	credentials clientcredentials.Config
	mu          sync.Mutex
	token       *oauth2.Token
}

type keycloakRole struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	Composite bool   `json:"composite"`
}

func newKeycloakApprovals(c Config) (*keycloakApprovals, error) {
	if c.KeycloakApprovalClientSecret == "" {
		return nil, nil
	}
	base, err := url.Parse(c.KeycloakAdminURL)
	if err != nil || base.Host == "" || base.User != nil || base.RawQuery != "" || base.Fragment != "" || (base.Scheme != "http" && base.Scheme != "https") {
		return nil, errors.New("KEYCLOAK_ADMIN_URL must be a private HTTP(S) Keycloak base URL")
	}
	issuer, err := url.Parse(c.OIDCIssuer)
	if err != nil {
		return nil, errors.New("invalid approval realm issuer")
	}
	parts := strings.Split(strings.TrimRight(issuer.Path, "/"), "/realms/")
	if len(parts) != 2 || parts[1] == "" || strings.Contains(parts[1], "/") {
		return nil, errors.New("approval issuer must identify a Keycloak realm")
	}
	id := c.KeycloakApprovalClientID
	if id == "" {
		id = "lumi-access-approval"
	}
	private := strings.TrimRight(base.String(), "/")
	return &keycloakApprovals{base: private + "/admin/realms/" + url.PathEscape(parts[1]), realm: parts[1],
		client:      &http.Client{Timeout: 15 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }},
		credentials: clientcredentials.Config{ClientID: id, ClientSecret: c.KeycloakApprovalClientSecret, TokenURL: private + "/realms/" + url.PathEscape(parts[1]) + "/protocol/openid-connect/token", AuthStyle: oauth2.AuthStyleInHeader},
	}, nil
}

func (k *keycloakApprovals) accessToken(ctx context.Context) (string, error) {
	k.mu.Lock()
	defer k.mu.Unlock()
	if k.token != nil && k.token.Valid() {
		return k.token.AccessToken, nil
	}
	token, err := k.credentials.Token(context.WithValue(ctx, oauth2.HTTPClient, k.client))
	if err != nil {
		return "", errors.New("Keycloak service authentication failed")
	}
	k.token = token
	return token.AccessToken, nil
}

func (k *keycloakApprovals) call(ctx context.Context, method, path string, body any, out any) error {
	var data []byte
	if body != nil {
		var err error
		data, err = json.Marshal(body)
		if err != nil {
			return err
		}
	}
	for attempt := 0; attempt < 2; attempt++ {
		token, err := k.accessToken(ctx)
		if err != nil {
			return err
		}
		req, err := http.NewRequestWithContext(ctx, method, k.base+path, bytes.NewReader(data))
		if err != nil {
			return errors.New("invalid Keycloak request")
		}
		req.Header.Set("Authorization", "Bearer "+token)
		req.Header.Set("Accept", "application/json")
		if body != nil {
			req.Header.Set("Content-Type", "application/json")
		}
		res, err := k.client.Do(req)
		if err != nil {
			return errors.New("Keycloak administration is unavailable")
		}
		payload, readErr := io.ReadAll(io.LimitReader(res.Body, 65537))
		res.Body.Close()
		if res.StatusCode == http.StatusUnauthorized && attempt == 0 {
			k.mu.Lock()
			if k.token != nil && k.token.AccessToken == token {
				k.token = nil
			}
			k.mu.Unlock()
			continue
		}
		if res.StatusCode < 200 || res.StatusCode >= 300 {
			return fmt.Errorf("Keycloak administration returned HTTP %d", res.StatusCode)
		}
		if readErr != nil || len(payload) > 65536 {
			return errors.New("invalid Keycloak response")
		}
		if out != nil && json.Unmarshal(payload, out) != nil {
			return errors.New("invalid Keycloak response")
		}
		return nil
	}
	return errors.New("Keycloak service authentication failed")
}

func (k *keycloakApprovals) grantAccess(ctx context.Context, subject string) error {
	// Use the signed OIDC subject, never a browser-provided email or user ID.
	userPath := "/users/" + url.PathEscape(subject)
	var user struct {
		ID       string `json:"id"`
		Enabled  bool   `json:"enabled"`
		Verified bool   `json:"emailVerified"`
	}
	if err := k.call(ctx, "GET", userPath, nil, &user); err != nil {
		return err
	}
	if user.ID != subject || !user.Enabled || !user.Verified {
		return errors.New("Keycloak account is unavailable or unverified")
	}
	var roles []keycloakRole
	if err := k.call(ctx, "GET", userPath+"/role-mappings/realm/composite", nil, &roles); err != nil {
		return err
	}
	for _, role := range roles {
		if role.Name == "portal-access" {
			return nil
		}
	}
	// The available mappings endpoint respects the role-specific FGAP permission;
	// reading realm roles by name would require broader realm-view privileges.
	var available []keycloakRole
	if err := k.call(ctx, "GET", userPath+"/role-mappings/realm/available", nil, &available); err != nil {
		return err
	}
	for _, role := range available {
		if role.Name == "portal-access" && role.ID != "" && !role.Composite {
			return k.call(ctx, "POST", userPath+"/role-mappings/realm", []keycloakRole{role}, nil)
		}
	}
	return errors.New("portal-access is not available to the approval service")
}
