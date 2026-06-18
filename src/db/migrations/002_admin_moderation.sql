ALTER TABLE users
  ADD COLUMN IF NOT EXISTS is_banned BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS banned_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS banned_reason TEXT NULL,
  ADD COLUMN IF NOT EXISTS referred_by BIGINT NULL REFERENCES users(id);

CREATE INDEX IF NOT EXISTS users_is_banned_idx ON users(is_banned) WHERE is_banned = true;

CREATE TABLE IF NOT EXISTS user_blocks (
  blocker_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  blocked_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (blocker_id, blocked_id),
  CHECK (blocker_id <> blocked_id)
);

CREATE INDEX IF NOT EXISTS user_blocks_blocked_idx ON user_blocks(blocked_id);

ALTER TABLE reports
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'open',
  ADD COLUMN IF NOT EXISTS resolved_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS resolved_by_telegram BIGINT NULL;

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS gender TEXT NULL;

ALTER TABLE profiles DROP CONSTRAINT IF EXISTS profiles_gender_check;
ALTER TABLE profiles ADD CONSTRAINT profiles_gender_check
  CHECK (gender IS NULL OR gender IN ('m', 'f', 'x'));
