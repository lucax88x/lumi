CREATE TABLE access_requests (
 id TEXT PRIMARY KEY,
 user_id TEXT NOT NULL UNIQUE REFERENCES identities(id),
 status TEXT NOT NULL CHECK(status IN ('pending','approved','rejected')),
 attempt INTEGER NOT NULL DEFAULT 1 CHECK(attempt > 0),
 requested_at INTEGER NOT NULL,
 decided_at INTEGER,
 decided_by TEXT REFERENCES identities(id)
);
CREATE INDEX access_requests_pending ON access_requests(status,requested_at,id);
CREATE TABLE access_request_events (
 id INTEGER PRIMARY KEY,
 request_id TEXT NOT NULL REFERENCES access_requests(id),
 attempt INTEGER NOT NULL,
 event TEXT NOT NULL CHECK(event IN ('requested','approved','rejected','external_approval')),
 occurred_at INTEGER NOT NULL,
 actor_id TEXT NOT NULL REFERENCES identities(id)
);
