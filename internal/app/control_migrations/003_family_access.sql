ALTER TABLE families ADD COLUMN access_enabled INTEGER NOT NULL DEFAULT 1 CHECK(access_enabled IN (0,1));
