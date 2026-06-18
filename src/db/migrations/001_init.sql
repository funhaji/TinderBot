CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS users (
  id BIGSERIAL PRIMARY KEY,
  telegram_id BIGINT NOT NULL UNIQUE,
  username TEXT NULL,
  language TEXT NOT NULL DEFAULT 'en',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS profiles (
  user_id BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  display_name TEXT NOT NULL,
  age INT NOT NULL CHECK (age >= 18 AND age <= 99),
  city TEXT NOT NULL,
  bio TEXT NOT NULL DEFAULT '',
  visibility BOOLEAN NOT NULL DEFAULT true,
  preferences JSONB NOT NULL DEFAULT '{}'::jsonb,
  location_lat DOUBLE PRECISION NULL,
  location_lon DOUBLE PRECISION NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS photos (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  file_id TEXT NOT NULL,
  is_primary BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS photos_user_id_idx ON photos(user_id);

CREATE TABLE IF NOT EXISTS interests (
  id BIGSERIAL PRIMARY KEY,
  key TEXT NOT NULL UNIQUE,
  fa_label TEXT NOT NULL,
  en_label TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS user_interests (
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  interest_id BIGINT NOT NULL REFERENCES interests(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, interest_id)
);
CREATE INDEX IF NOT EXISTS user_interests_interest_idx ON user_interests(interest_id);

CREATE TABLE IF NOT EXISTS swipes (
  swiper_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  target_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  direction SMALLINT NOT NULL CHECK (direction IN (1, 2)),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (swiper_id, target_id)
);
CREATE INDEX IF NOT EXISTS swipes_swiper_created_idx ON swipes(swiper_id, created_at DESC);
CREATE INDEX IF NOT EXISTS swipes_target_idx ON swipes(target_id);

CREATE TABLE IF NOT EXISTS matches (
  user_a BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  user_b BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  unmatched_at TIMESTAMPTZ NULL,
  PRIMARY KEY (user_a, user_b),
  CHECK (user_a < user_b)
);
CREATE INDEX IF NOT EXISTS matches_user_a_idx ON matches(user_a, created_at DESC);
CREATE INDEX IF NOT EXISTS matches_user_b_idx ON matches(user_b, created_at DESC);

CREATE TABLE IF NOT EXISTS reports (
  reporter_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  target_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reason TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (reporter_id, target_id)
);

CREATE TABLE IF NOT EXISTS sessions (
  user_id BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  state TEXT NOT NULL DEFAULT 'idle',
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO interests(key, fa_label, en_label) VALUES
  ('music', 'موسیقی', 'Music'),
  ('movies', 'فیلم', 'Movies'),
  ('sports', 'ورزش', 'Sports'),
  ('travel', 'سفر', 'Travel'),
  ('gaming', 'بازی', 'Gaming'),
  ('books', 'کتاب', 'Books'),
  ('food', 'غذا', 'Food'),
  ('tech', 'تکنولوژی', 'Tech')
ON CONFLICT (key) DO NOTHING;
