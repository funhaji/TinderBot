-- Physical presentation bucket for matching (male / female / non-binary unknown)
CREATE OR REPLACE FUNCTION profile_phys_sex(g TEXT) RETURNS TEXT AS $$
  SELECT CASE g
    WHEN 'm' THEN 'm'
    WHEN 'boy' THEN 'm'
    WHEN 'trans_boy' THEN 'm'
    WHEN 'nb_male' THEN 'm'
    WHEN 'f' THEN 'f'
    WHEN 'girl' THEN 'f'
    WHEN 'trans_girl' THEN 'f'
    WHEN 'nb_female' THEN 'f'
    ELSE NULL
  END;
$$ LANGUAGE sql IMMUTABLE;

CREATE OR REPLACE FUNCTION effective_orientation(o TEXT, g TEXT) RETURNS TEXT AS $$
  SELECT CASE
    WHEN o IS NULL OR o = '' OR o = 'skip' THEN 'any'
    WHEN o IN ('bi','bisexual','other') THEN 'any'
    WHEN o = 'gay' AND profile_phys_sex(g) = 'm' THEN 'gay'
    WHEN o = 'gay' AND profile_phys_sex(g) = 'f' THEN 'lesbian'
    WHEN o = 'gay' THEN 'any'
    ELSE COALESCE(o, 'any')
  END;
$$ LANGUAGE sql STABLE;

CREATE OR REPLACE FUNCTION orientation_accepts(o_eff TEXT, viewer_phys TEXT, target_phys TEXT) RETURNS BOOLEAN AS $$
  SELECT CASE o_eff
    WHEN 'any' THEN true
    WHEN 'straight' THEN
      (viewer_phys = 'm' AND target_phys = 'f')
      OR (viewer_phys = 'f' AND target_phys = 'm')
      OR viewer_phys IS NULL
      OR target_phys IS NULL
    WHEN 'gay' THEN
      (viewer_phys = 'm' AND target_phys = 'm')
      OR viewer_phys IS NULL
      OR target_phys IS NULL
    WHEN 'lesbian' THEN
      (viewer_phys = 'f' AND target_phys = 'f')
      OR viewer_phys IS NULL
      OR target_phys IS NULL
    ELSE true
  END;
$$ LANGUAGE sql IMMUTABLE;

CREATE OR REPLACE FUNCTION orientation_mutual_ok(vo TEXT, vg TEXT, to_o TEXT, tg TEXT) RETURNS BOOLEAN AS $$
  SELECT orientation_accepts(effective_orientation(vo, vg), profile_phys_sex(vg), profile_phys_sex(tg))
     AND orientation_accepts(effective_orientation(to_o, tg), profile_phys_sex(tg), profile_phys_sex(vg));
$$ LANGUAGE sql STABLE;

ALTER TABLE profiles DROP CONSTRAINT IF EXISTS profiles_age_check;
ALTER TABLE profiles ADD CONSTRAINT profiles_age_check CHECK (age >= 15 AND age <= 99);

ALTER TABLE profiles DROP CONSTRAINT IF EXISTS profiles_gender_check;
ALTER TABLE profiles ADD CONSTRAINT profiles_gender_check CHECK (
  gender IS NULL OR gender IN (
    'm','f','x',
    'boy','girl','trans_boy','trans_girl','nb_male','nb_female'
  )
);

ALTER TABLE users ADD COLUMN IF NOT EXISTS referral_code TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS users_referral_code_uidx ON users(referral_code) WHERE referral_code IS NOT NULL;

ALTER TABLE users ADD COLUMN IF NOT EXISTS badge_verified BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE users ADD COLUMN IF NOT EXISTS badge_vip BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS referral_file_rewards (
  id BIGSERIAL PRIMARY KEY,
  sort_order INT NOT NULL DEFAULT 0,
  min_referrals INT NOT NULL CHECK (min_referrals >= 0),
  caption_fa TEXT NOT NULL DEFAULT '',
  caption_en TEXT NOT NULL DEFAULT '',
  file_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS referral_file_rewards_sort_idx ON referral_file_rewards(sort_order ASC, min_referrals ASC);

CREATE TABLE IF NOT EXISTS user_referral_file_claims (
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reward_id BIGINT NOT NULL REFERENCES referral_file_rewards(id) ON DELETE CASCADE,
  claimed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, reward_id)
);

INSERT INTO system_settings (key, value_json) VALUES
  ('referral_vip_threshold', '10'::jsonb),
  ('referral_badge_verify_threshold', '10'::jsonb)
ON CONFLICT (key) DO NOTHING;

UPDATE users SET referral_code = 'r' || id::text WHERE referral_code IS NULL;

CREATE OR REPLACE FUNCTION users_fill_referral_code() RETURNS trigger AS $$
BEGIN
  IF NEW.referral_code IS NULL THEN
    UPDATE users SET referral_code = 'r' || NEW.id::text WHERE id = NEW.id AND referral_code IS NULL;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS users_referral_ai ON users;
CREATE TRIGGER users_referral_ai AFTER INSERT ON users FOR EACH ROW EXECUTE PROCEDURE users_fill_referral_code();
