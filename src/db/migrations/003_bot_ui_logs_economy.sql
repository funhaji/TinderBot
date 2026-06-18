CREATE TABLE IF NOT EXISTS bot_config (
  id INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  document JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO bot_config (id, document) VALUES (1, '{}'::jsonb)
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS system_settings (
  key TEXT PRIMARY KEY,
  value_json JSONB NOT NULL
);

INSERT INTO system_settings (key, value_json) VALUES
  ('message_logging_enabled', 'true'::jsonb),
  ('message_log_retention_hours', '72'::jsonb),
  ('diamond_reward_profile', '10'::jsonb),
  ('diamond_reward_referral', '5'::jsonb)
ON CONFLICT (key) DO NOTHING;

CREATE TABLE IF NOT EXISTS message_logs (
  id BIGSERIAL PRIMARY KEY,
  direction TEXT NOT NULL CHECK (direction IN ('in', 'out')),
  user_id BIGINT NULL REFERENCES users(id) ON DELETE SET NULL,
  telegram_user_id BIGINT NOT NULL,
  chat_id BIGINT NOT NULL,
  message_id BIGINT NULL,
  update_type TEXT NOT NULL DEFAULT '',
  text_preview TEXT NOT NULL DEFAULT '',
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS message_logs_created_idx ON message_logs(created_at);
CREATE INDEX IF NOT EXISTS message_logs_tg_created_idx ON message_logs(telegram_user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS profile_impressions (
  id BIGSERIAL PRIMARY KEY,
  viewer_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  shown_user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS profile_impressions_shown_idx ON profile_impressions(shown_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS profile_impressions_viewer_idx ON profile_impressions(viewer_id, created_at DESC);

CREATE TABLE IF NOT EXISTS user_permanent_hides (
  hider_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  hidden_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (hider_id, hidden_id),
  CHECK (hider_id <> hidden_id)
);

CREATE INDEX IF NOT EXISTS user_permanent_hides_hidden_idx ON user_permanent_hides(hidden_id);

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS diamond_balance INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS face_verification_status TEXT NOT NULL DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS referral_bonus_paid BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE users DROP CONSTRAINT IF EXISTS users_face_verification_status_check;
ALTER TABLE users ADD CONSTRAINT users_face_verification_status_check
  CHECK (face_verification_status IN ('none', 'pending', 'approved', 'rejected'));

CREATE TABLE IF NOT EXISTS face_verification_submissions (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  photo_file_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  reviewed_at TIMESTAMPTZ NULL,
  reviewer_telegram_id BIGINT NULL,
  reject_reason TEXT NULL
);

CREATE INDEX IF NOT EXISTS face_submissions_pending_idx ON face_verification_submissions(status, created_at DESC)
  WHERE status = 'pending';

CREATE TABLE IF NOT EXISTS diamond_ledger (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  delta INT NOT NULL,
  reason TEXT NOT NULL,
  ref_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  admin_telegram_id BIGINT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS diamond_ledger_user_idx ON diamond_ledger(user_id, created_at DESC);
