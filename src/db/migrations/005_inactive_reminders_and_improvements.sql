-- Migration 005: Inactive User Reminders and Feature Improvements

-- Table to track inactive user reminders
CREATE TABLE IF NOT EXISTS inactive_user_reminders (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reminder_day INT NOT NULL CHECK (reminder_day IN (3, 7, 14)),
  sent_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, reminder_day)
);

CREATE INDEX IF NOT EXISTS inactive_reminders_user_day_idx ON inactive_user_reminders(user_id, reminder_day);

-- System settings for reminder messages (configurable from admin panel)
INSERT INTO system_settings (key, value_json) VALUES
  ('reminder_3day_enabled', 'true'::jsonb),
  ('reminder_7day_enabled', 'true'::jsonb),
  ('reminder_14day_enabled', 'true'::jsonb),
  ('reminder_3day_fa', '"سلام! 3 روزه تو رو ندیدیم 😊 دلمون برات تنگ شده! بیا و با افراد جدید آشنا شو. منتظرتیم! ❤️"'::jsonb),
  ('reminder_3day_en', '"Hi! We haven''t seen you for 3 days 😊 We miss you! Come back and meet new people. We''re waiting for you! ❤️"'::jsonb),
  ('reminder_7day_fa', '"یه هفته گذشته! 🎉 افراد جدید و جذاب منتظر آشنایی با تو هستن. برگرد و شانست رو امتحان کن! 💫"'::jsonb),
  ('reminder_7day_en', '"A week has passed! 🎉 New and attractive people are waiting to meet you. Come back and try your luck! 💫"'::jsonb),
  ('reminder_14day_fa', '"2 هفته شد که نیستی! 💔 دوستات و مچ‌های احتمالی منتظرتن. الان بهترین وقته که برگردی! 🌟"'::jsonb),
  ('reminder_14day_en', '"It''s been 2 weeks! 💔 Your friends and potential matches are waiting. Now is the best time to come back! 🌟"'::jsonb)
ON CONFLICT (key) DO NOTHING;

-- Add username field tracking for better user identification
-- (username column already exists, but we ensure it's properly indexed)
CREATE INDEX IF NOT EXISTS users_username_idx ON users(username) WHERE username IS NOT NULL;

-- Add last_activity tracking if not present (for matchmaking improvements)
-- Note: last_seen_at already exists and is updated on each interaction
