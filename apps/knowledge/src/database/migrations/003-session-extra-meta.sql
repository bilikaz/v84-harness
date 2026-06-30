-- 003-session-extra-meta: persist the SessionMeta fields the remote store was dropping.
-- graph_id is the one with teeth: without it a restored graph session loses its binding and
-- silently runs as a plain chat. last_model / error_kind / bytes were dropped the same way.
-- ADD COLUMN IF NOT EXISTS so a fresh DB that already created them via 001 is a no-op.

ALTER TABLE sessions
  ADD COLUMN IF NOT EXISTS graph_id   VARCHAR(64)     NULL,
  ADD COLUMN IF NOT EXISTS last_model VARCHAR(255)    NULL,
  ADD COLUMN IF NOT EXISTS error_kind VARCHAR(32)     NULL,
  ADD COLUMN IF NOT EXISTS bytes      BIGINT UNSIGNED NULL;
