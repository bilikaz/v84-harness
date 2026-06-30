-- users: login identities
CREATE TABLE IF NOT EXISTS users (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  username      VARCHAR(255) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  created_at    DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- auth_sessions: one row per device login; refresh token sha256-hashed, expires_at = revocation.
-- (Renamed from `sessions` — that name now belongs to chat sessions below.)
CREATE TABLE IF NOT EXISTS auth_sessions (
  id                 CHAR(36)        NOT NULL PRIMARY KEY,
  user_id            BIGINT UNSIGNED NOT NULL,
  refresh_token_hash CHAR(64)        NOT NULL,
  device_name        VARCHAR(255)        NULL,
  ip_address         VARCHAR(45)         NULL,
  expires_at         DATETIME(3)     NOT NULL,
  last_seen_at       DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  created_at         DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX idx_auth_sessions_user (user_id),
  CONSTRAINT fk_auth_sessions_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- The harness data model, real tables (NOT a kv blob), per user. Same column shape as the
-- client; the difference is delete semantics: the client/local backend DELETEs the row, the
-- remote API stamps deleted_at (soft delete) and filters it from reads — the client called
-- delete, so it considers the row gone and never sees the retained copy. deleted_at = restore window.

-- containers: chat / local / remote (replaces workspaces + the magic null "Chat" group)
CREATE TABLE IF NOT EXISTS containers (
  id          VARCHAR(36)     NOT NULL,
  user_id     BIGINT UNSIGNED NOT NULL,
  type        VARCHAR(16)     NOT NULL, -- chat | local | remote
  name        VARCHAR(255)    NOT NULL,
  permissions JSON            NOT NULL,
  config      JSON            NOT NULL,
  created_at  DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at  DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  deleted_at  DATETIME(3)         NULL,
  PRIMARY KEY (user_id, id),
  INDEX idx_containers_user (user_id, deleted_at),
  CONSTRAINT fk_containers_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- sessions: a conversation thread inside a container (the chat domain's Session)
CREATE TABLE IF NOT EXISTS sessions (
  id           VARCHAR(36)     NOT NULL,
  user_id      BIGINT UNSIGNED NOT NULL,
  container_id VARCHAR(36)     NOT NULL,
  parent_id    VARCHAR(36)         NULL, -- sub-agent run's parent session
  agent_id     VARCHAR(36)         NULL,
  graph_id     VARCHAR(64)         NULL, -- the graph this session runs (plugin graph id); null for plain sessions
  title        VARCHAR(512)    NOT NULL,
  system       MEDIUMTEXT          NULL,
  tools        JSON            NOT NULL, -- SessionTool[]
  used_tokens  INT                 NULL,
  last_model   VARCHAR(255)        NULL, -- model that last answered (composer label)
  error_kind   VARCHAR(32)         NULL, -- last turn's failure class: capacity | transport | other
  bytes        BIGINT UNSIGNED     NULL, -- approx transcript size for the storage meter
  unread       TINYINT(1)      NOT NULL DEFAULT 0,
  created_at   DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at   DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  deleted_at   DATETIME(3)         NULL,
  PRIMARY KEY (user_id, id),
  INDEX idx_sessions_container (user_id, container_id, deleted_at),
  CONSTRAINT fk_sessions_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- messages: rows per session
CREATE TABLE IF NOT EXISTS messages (
  id                VARCHAR(36)     NOT NULL,
  user_id           BIGINT UNSIGNED NOT NULL,
  session_id        VARCHAR(36)     NOT NULL,
  role              VARCHAR(16)     NOT NULL, -- user | assistant | tool
  text              LONGTEXT            NULL,
  thinking          LONGTEXT            NULL,
  tool_calls        JSON                NULL,
  tool_call_id      VARCHAR(64)         NULL,
  child_session_ids JSON                NULL,
  images            JSON                NULL, -- media:<id> refs (blobs live in the media table)
  videos            JSON                NULL,
  files             JSON                NULL, -- FileAttachment[] (inline, not externalized)
  summary           TINYINT(1)          NULL,
  hidden            TINYINT(1)          NULL,
  created_at        DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  deleted_at        DATETIME(3)         NULL,
  PRIMARY KEY (user_id, id),
  INDEX idx_messages_session (user_id, session_id, deleted_at),
  CONSTRAINT fk_messages_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- media: blobs referenced by messages (data URLs), own rows so messages stay light
CREATE TABLE IF NOT EXISTS media (
  id         VARCHAR(36)     NOT NULL,
  user_id    BIGINT UNSIGNED NOT NULL,
  session_id VARCHAR(36)     NOT NULL,
  message_id VARCHAR(36)     NOT NULL,
  kind       VARCHAR(16)     NOT NULL, -- image | video | file
  mime       VARCHAR(128)    NOT NULL,
  name       VARCHAR(255)        NULL,
  data       LONGTEXT        NOT NULL,
  created_at DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  deleted_at DATETIME(3)         NULL,
  PRIMARY KEY (user_id, id),
  INDEX idx_media_session (user_id, session_id, deleted_at),
  CONSTRAINT fk_media_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- agents: stored agent definitions
CREATE TABLE IF NOT EXISTS agents (
  id                 VARCHAR(36)     NOT NULL,
  user_id            BIGINT UNSIGNED NOT NULL,
  name               VARCHAR(255)    NOT NULL,
  description        TEXT                NULL,
  system             MEDIUMTEXT          NULL,
  `user`             MEDIUMTEXT          NULL, -- the run template
  workspace          TINYINT(1)      NOT NULL DEFAULT 0, -- workspace-bound? (harness Agent.workspace)
  tools              JSON            NOT NULL, -- AgentTools — per-tool ceiling map (harness Agent.tools)
  created_at         DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at         DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  deleted_at         DATETIME(3)         NULL,
  PRIMARY KEY (user_id, id),
  INDEX idx_agents_user (user_id, deleted_at),
  CONSTRAINT fk_agents_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- settings: key/value scoped per user (the synced/account scope; machine-local scope stays on the device)
CREATE TABLE IF NOT EXISTS settings (
  user_id    BIGINT UNSIGNED NOT NULL,
  `key`      VARCHAR(255)    NOT NULL,
  scope      VARCHAR(16)     NOT NULL, -- local | account
  value      JSON            NOT NULL,
  updated_at DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  deleted_at DATETIME(3)         NULL,
  PRIMARY KEY (user_id, `key`),
  CONSTRAINT fk_settings_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- plugin_data: a plugin's own namespaced rows (its "tables"). plugin_id is the plugin's SLUG
-- (its in-tree folder name) — first-party plugins have no installed-registration row; enable +
-- settings live in the settings table under config.plugins.<slug>.
CREATE TABLE IF NOT EXISTS plugin_data (
  user_id    BIGINT UNSIGNED NOT NULL,
  plugin_id  VARCHAR(64)     NOT NULL,
  collection VARCHAR(128)    NOT NULL,
  `key`      VARCHAR(255)    NOT NULL,
  value      JSON            NOT NULL,
  updated_at DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  deleted_at DATETIME(3)         NULL,
  PRIMARY KEY (user_id, plugin_id, collection, `key`),
  CONSTRAINT fk_plugin_data_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
