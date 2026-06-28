-- Refresh-token reuse detection. Remember the hash that was just rotated OUT, so presenting an
-- already-rotated token (which only an attacker or a stale client would still hold) is recognised
-- as theft and revokes the whole session. Nullable: fresh/never-rotated sessions have no prior.
ALTER TABLE auth_sessions
  ADD COLUMN prev_refresh_token_hash CHAR(64) NULL AFTER refresh_token_hash;
