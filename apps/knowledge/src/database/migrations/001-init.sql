-- users: login identities
CREATE TABLE IF NOT EXISTS users (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  username      VARCHAR(255) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  created_at    DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- sessions: one row per device login; refresh token sha256-hashed, expires_at = revocation
CREATE TABLE IF NOT EXISTS sessions (
  id                 CHAR(36)        NOT NULL PRIMARY KEY,
  user_id            BIGINT UNSIGNED NOT NULL,
  refresh_token_hash CHAR(64)        NOT NULL,
  device_name        VARCHAR(255)        NULL,
  ip_address         VARCHAR(45)         NULL,
  expires_at         DATETIME(3)     NOT NULL,
  last_seen_at       DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  created_at         DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX idx_sessions_user (user_id),
  CONSTRAINT fk_sessions_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- data: the harness Storage port, scoped per user (chats + media; settings stay local)
CREATE TABLE IF NOT EXISTS data (
  user_id    BIGINT UNSIGNED NOT NULL,
  `key`      VARCHAR(512)    NOT NULL,
  `value`    LONGTEXT        NOT NULL,
  updated_at DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (user_id, `key`),
  CONSTRAINT fk_data_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
