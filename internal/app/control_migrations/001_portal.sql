CREATE TABLE identities (
 id TEXT PRIMARY KEY, issuer TEXT NOT NULL, subject TEXT NOT NULL, email TEXT NOT NULL,
 UNIQUE(issuer,subject)
);
CREATE TABLE portal_sessions (
 token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES identities(id), csrf TEXT NOT NULL,
 access_token TEXT NOT NULL, refresh_token TEXT NOT NULL, access_expires INTEGER NOT NULL,
 expires_at INTEGER NOT NULL, idle_expires INTEGER NOT NULL, verified INTEGER NOT NULL,
 portal_access INTEGER NOT NULL
);
CREATE TABLE login_attempts (
 token_hash TEXT PRIMARY KEY, state TEXT NOT NULL, nonce TEXT NOT NULL, verifier TEXT NOT NULL,
 return_to TEXT NOT NULL, expires_at INTEGER NOT NULL
);
CREATE TABLE families (id TEXT PRIMARY KEY, name TEXT NOT NULL);
CREATE TABLE memberships (
 family_id TEXT NOT NULL REFERENCES families(id), user_id TEXT NOT NULL REFERENCES identities(id),
 role TEXT NOT NULL CHECK(role IN ('parent','member')), PRIMARY KEY(family_id,user_id)
);
CREATE TABLE invitations (
 id TEXT PRIMARY KEY, token_hash TEXT NOT NULL UNIQUE, family_id TEXT NOT NULL REFERENCES families(id),
 email TEXT NOT NULL, expires_at INTEGER NOT NULL
);
