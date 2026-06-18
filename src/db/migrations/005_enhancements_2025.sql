-- Migration 005: Bot Enhancements 2025
-- Features: Inactive user reminders, advanced search filters, like notifications redesign

-- Add last_activity_at tracking for inactive user detection
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS last_activity_at TIMESTAMPTZ NULL;

-- Initialize last_activity_at with last_seen_at for existing users
UPDATE users
SET last_activity_at = last_seen_at
WHERE last_activity_at IS NULL;

-- Add index for efficient inactive user queries
CREATE INDEX IF NOT EXISTS users_last_activity_idx ON users(last_activity_at)
  WHERE is_banned = false;

-- Add gender field to profiles if not exists (for better filtering)
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS gender TEXT NULL;

-- Add indexes for advanced search performance
CREATE INDEX IF NOT EXISTS profiles_age_idx ON profiles(age);
CREATE INDEX IF NOT EXISTS profiles_city_lower_idx ON profiles(LOWER(city));
CREATE INDEX IF NOT EXISTS profiles_gender_idx ON profiles(gender) WHERE gender IS NOT NULL;

-- System settings for inactive user reminders
INSERT INTO system_settings (key, value_json) VALUES
  ('reminder_3day_enabled', 'true'::jsonb),
  ('reminder_7day_enabled', 'true'::jsonb),
  ('reminder_14day_enabled', 'true'::jsonb),
  ('reminder_3day_text_fa', '"سلام! 🌟 مدتیه که تو رو ندیدیم. بیا و با افراد جدید آشنا شو!"'::jsonb),
  ('reminder_3day_text_en', '"Hi! 🌟 We haven''t seen you in a while. Come back and meet new people!"'::jsonb),
  ('reminder_7day_text_fa', '"هنوز منتظریم! 💕 هفته‌ای میشه که غیبت کردی. پروفایل‌های جدید زیادی اضافه شدن!"'::jsonb),
  ('reminder_7day_text_en', '"Still waiting for you! 💕 It''s been a week. Lots of new profiles have been added!"'::jsonb),
  ('reminder_14day_text_fa', '"دلمون برات تنگ شده! 🎉 دو هفته‌ای که نیستی. بیا و شانستو امتحان کن!"'::jsonb),
  ('reminder_14day_text_en', '"We miss you! 🎉 It''s been two weeks. Come back and try your luck!"'::jsonb)
ON CONFLICT (key) DO NOTHING;

-- Track reminder sends to avoid duplicates
CREATE TABLE IF NOT EXISTS reminder_sends (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reminder_type TEXT NOT NULL CHECK (reminder_type IN ('3day', '7day', '14day')),
  sent_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS reminder_sends_user_type_idx ON reminder_sends(user_id, reminder_type, sent_at DESC);

-- Advanced search: add last matchmaking queue entry timestamp
ALTER TABLE sessions
  ADD COLUMN IF NOT EXISTS queue_entered_at TIMESTAMPTZ NULL;

