-- capystack's whole D1 schema (docs/CONTRACT.md section 10). One owner, so no users table: every row belongs to the
-- owner, and api_keys says which device or tool made a call. Times are ms since the epoch (integers), ids lowercase
-- UUIDs unless a comment says otherwise. Both Workers bind this database as DB: the web Worker writes auth_handoffs and
-- mints sessions/keys, the API Worker does everything else.
--
-- Apply (remote, from the repo root): cf d1 migrations apply <d1 id> --dir d1/migrations

-- ---- credentials -------------------------------------------------------------------------------------------------
-- A bearer token is 32 random bytes, base64url (43 characters). Only its SHA-256 (lowercase hex) is stored.
--   kind 'session': a signed-in device (app or web page). Expires 90 days after its last use (expires_at slides,
--                   at most once a day); at most 50 active, minting one more revokes the least recently used.
--   kind 'key':     a named "key for tools" (MCP, scripts). No expiry until revoked.
CREATE TABLE api_keys (
    id           TEXT PRIMARY KEY,
    kind         TEXT NOT NULL CHECK (kind IN ('session', 'key')),
    name         TEXT NOT NULL,                 -- a key's name; a session's device name
    token_hash   TEXT NOT NULL UNIQUE,
    device       TEXT,                          -- session: "Harmony's iPhone"
    platform     TEXT,                          -- session: ios | ipados | mac | web
    created_at   INTEGER NOT NULL,
    last_used_at INTEGER,                       -- bumped at most once a day (with a session's expiry)
    expires_at   INTEGER,                       -- session only; NULL for keys
    revoked_at   INTEGER
);
CREATE INDEX api_keys_kind ON api_keys (kind, revoked_at, last_used_at DESC);

-- One-time sign-in codes: the web Worker's GET /api/auth/app writes one (2 minutes), the API's POST /auth/exchange
-- deletes it whatever the outcome (a code is tried once). code_hash = SHA-256 hex of the code; challenge = the app's
-- PKCE S256 challenge as sent (base64url, no padding).
CREATE TABLE auth_handoffs (
    code_hash  TEXT PRIMARY KEY,
    challenge  TEXT NOT NULL,
    platform   TEXT NOT NULL,
    device     TEXT NOT NULL,
    expires_at INTEGER NOT NULL
);

-- ---- the demo entity ---------------------------------------------------------------------------------------------
CREATE TABLE notes (
    id         TEXT PRIMARY KEY,                -- client-chosen for offline creates
    title      TEXT NOT NULL DEFAULT '',
    body       TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);
CREATE INDEX notes_updated ON notes (updated_at DESC, id DESC);

-- ---- sync (section 5) ----------------------------------------------------------------------------------------------
-- One row per synced thing (entity, id). A newer change deletes the older row and takes the next seq, so the log stays
-- the size of the data. gone = 1 is a delete marker; only those are trimmed (after 30 days, by the cron).
CREATE TABLE changes (
    seq    INTEGER PRIMARY KEY AUTOINCREMENT,
    entity TEXT NOT NULL,
    id     TEXT NOT NULL,
    gone   INTEGER NOT NULL DEFAULT 0,
    at     INTEGER NOT NULL
);
CREATE UNIQUE INDEX changes_thing ON changes (entity, id);
CREATE INDEX changes_gone ON changes (gone, at);

-- The highest seq of a delete marker the cron threw away. A client whose `since` is below it missed a delete and gets
-- 410 sync.too_old (it drops its copy and pulls from 0). 0 = nothing trimmed yet.
CREATE TABLE sync_state (
    id          INTEGER PRIMARY KEY CHECK (id = 1),
    trimmed_seq INTEGER NOT NULL DEFAULT 0
);
INSERT INTO sync_state (id, trimmed_seq) VALUES (1, 0);

-- The triggers keep the log: every write to notes, from any route, the chat, MCP or a console query, is synced.
-- unixepoch('subsec') * 1000 is ms; recursive_triggers is off in D1, so the DELETE here never re-enters anything.
CREATE TRIGGER notes_changes_insert AFTER INSERT ON notes
BEGIN
    DELETE FROM changes WHERE entity = 'note' AND id = NEW.id;
    INSERT INTO changes (entity, id, gone, at) VALUES ('note', NEW.id, 0, CAST(unixepoch('subsec') * 1000 AS INTEGER));
END;

CREATE TRIGGER notes_changes_update AFTER UPDATE ON notes
BEGIN
    DELETE FROM changes WHERE entity = 'note' AND id = NEW.id;
    INSERT INTO changes (entity, id, gone, at) VALUES ('note', NEW.id, 0, CAST(unixepoch('subsec') * 1000 AS INTEGER));
END;

CREATE TRIGGER notes_changes_delete AFTER DELETE ON notes
BEGIN
    DELETE FROM changes WHERE entity = 'note' AND id = OLD.id;
    INSERT INTO changes (entity, id, gone, at) VALUES ('note', OLD.id, 1, CAST(unixepoch('subsec') * 1000 AS INTEGER));
END;

-- A retried write (Idempotency-Key header) replays its first answer instead of running again. Scoped per credential
-- (key_id), kept 7 days by the cron.
CREATE TABLE idempotency (
    key        TEXT NOT NULL,
    key_id     TEXT NOT NULL,
    status     INTEGER NOT NULL,
    body       TEXT NOT NULL,                   -- the JSON answer
    created_at INTEGER NOT NULL,
    PRIMARY KEY (key, key_id)
);
CREATE INDEX idempotency_created ON idempotency (created_at);

-- ---- push (section 8) ----------------------------------------------------------------------------------------------
--   kind 'device':      the app's APNs device token (background "pull now" hints)
--   kind 'live_start':  the ActivityKit push-to-start token (server-started Live Activities)
--   kind 'live_update': one activity's update token; activity_id = the job id the activity shows
CREATE TABLE push_tokens (
    id          TEXT PRIMARY KEY,
    key_id      TEXT NOT NULL,
    kind        TEXT NOT NULL CHECK (kind IN ('device', 'live_start', 'live_update')),
    token       TEXT NOT NULL,
    platform    TEXT NOT NULL,                  -- ios | ipados | mac
    env         TEXT NOT NULL CHECK (env IN ('sandbox', 'production')),
    activity_id TEXT,
    created_at  INTEGER NOT NULL,
    updated_at  INTEGER NOT NULL
);
CREATE INDEX push_tokens_owner ON push_tokens (key_id, kind, activity_id);
CREATE INDEX push_tokens_kind ON push_tokens (kind, updated_at DESC);
CREATE INDEX push_tokens_token ON push_tokens (token);

-- ---- jobs (section 8) ----------------------------------------------------------------------------------------------
CREATE TABLE jobs (
    id         TEXT PRIMARY KEY,
    kind       TEXT NOT NULL,                   -- demo
    state      TEXT NOT NULL CHECK (state IN ('running', 'done', 'failed')),
    progress   REAL NOT NULL DEFAULT 0,         -- 0..1
    title      TEXT NOT NULL,
    key_id     TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);
CREATE INDEX jobs_updated ON jobs (updated_at);

-- ---- chat (section 6) ----------------------------------------------------------------------------------------------
CREATE TABLE chat_threads (
    id         TEXT PRIMARY KEY,
    key_id     TEXT,
    title      TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);
CREATE INDEX chat_threads_updated ON chat_threads (updated_at DESC);

-- content_json: the Anthropic content blocks of one turn (text, tool_use, tool_result), as sent to the model again.
CREATE TABLE chat_messages (
    id           TEXT PRIMARY KEY,
    thread_id    TEXT NOT NULL REFERENCES chat_threads (id) ON DELETE CASCADE,
    role         TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
    content_json TEXT NOT NULL,
    created_at   INTEGER NOT NULL
);
CREATE INDEX chat_messages_thread ON chat_messages (thread_id, created_at, id);
