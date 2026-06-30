-- 004-harness-shape: align the remote schema with the harness (desktop) data shapes.
-- Every clause is guarded (IF EXISTS / IF NOT EXISTS), so this is safe to run from ANY prior state: a fresh
-- DB whose 001 already created the final shape (all clauses no-op), an original DB, or a half-applied retry
-- (an earlier version of this file failed mid-way after renaming permissions->tools).

-- permissions (JSON) -> tools (JSON): a pure rename — the agent tool-ceiling data is preserved.
ALTER TABLE agents CHANGE COLUMN IF EXISTS permissions tools JSON NOT NULL;

-- requires_workspace (VARCHAR local|remote|null) -> workspace (boolean). We must NOT cast the string to
-- TINYINT: MariaDB strict mode rejects 'local'/'remote' ("Data truncated"). So add the boolean (default 0)
-- and drop the old column. No backfill — the UPDATE would reference a column absent on a fresh DB, and the
-- string was an approximate 3-value field anyway; existing agents reset to workspace=0 (a minor, re-settable
-- flag, while `tools` — the field that matters — is preserved by the rename above).
ALTER TABLE agents ADD COLUMN IF NOT EXISTS workspace TINYINT(1) NOT NULL DEFAULT 0;
ALTER TABLE agents DROP COLUMN IF EXISTS requires_workspace;

-- placement: server-only redesign field with no harness equivalent (the per-row placement work is deferred).
ALTER TABLE agents DROP COLUMN IF EXISTS placement;
ALTER TABLE containers DROP COLUMN IF EXISTS placement;

-- messages: + files (FileAttachment[], stored inline).
ALTER TABLE messages ADD COLUMN IF NOT EXISTS files JSON NULL;
