/**
 * Inactive User Reminder Scheduler
 * 
 * Automatically sends reminders to users who haven't interacted with the bot for:
 * - 3 days
 * - 7 days  
 * - 14 days
 * 
 * All reminder messages are configurable from the admin panel via system_settings.
 */

import type { Bot } from "grammy";
import type { MyContext } from "../src/types.js";
import { query } from "../src/db/sql.js";
import { getSystemSettingBool, getSystemSettingJson } from "../src/db/repo.js";
import { logger } from "../src/log.js";

type ReminderType = '3day' | '7day' | '14day';

interface InactiveUser {
  user_id: number;
  telegram_id: number;
  language: string;
  days_inactive: number;
}

/**
 * Get text for a specific reminder type and language from system settings
 */
async function getReminderText(type: ReminderType, lang: 'fa' | 'en'): Promise<string> {
  const key = `reminder_${type}_text_${lang}`;
  const defaultTexts = {
    '3day_fa': "سلام! 🌟 مدتیه که تو رو ندیدیم. بیا و با افراد جدید آشنا شو!",
    '3day_en': "Hi! 🌟 We haven't seen you in a while. Come back and meet new people!",
    '7day_fa': "هنوز منتظریم! 💕 هفته‌ای میشه که غیبت کردی. پروفایل‌های جدید زیادی اضافه شدن!",
    '7day_en': "Still waiting for you! 💕 It's been a week. Lots of new profiles have been added!",
    '14day_fa': "دلمون برات تنگ شده! 🎉 دو هفته‌ای که نیستی. بیا و شانستو امتحان کن!",
    '14day_en': "We miss you! 🎉 It's been two weeks. Come back and try your luck!"
  };
  
  const fallback = defaultTexts[`${type}_${lang}` as keyof typeof defaultTexts] || '';
  const text = await getSystemSettingJson<string>(key, fallback);
  return typeof text === 'string' ? text : fallback;
}

/**
 * Check if a specific reminder type is enabled in system settings
 */
async function isReminderEnabled(type: ReminderType): Promise<boolean> {
  const key = `reminder_${type}_enabled`;
  return await getSystemSettingBool(key, true);
}

/**
 * Get users who are inactive for a specific number of days
 * and haven't received this type of reminder recently
 */
async function getInactiveUsers(days: number, reminderType: ReminderType, batchSize: number = 100): Promise<InactiveUser[]> {
  const result = await query<{
    user_id: number;
    telegram_id: number;
    language: string;
    days_inactive: string;
  }>(`
    SELECT 
      u.id as user_id,
      u.telegram_id::bigint as telegram_id,
      COALESCE(u.language, 'fa') as language,
      EXTRACT(DAY FROM (now() - COALESCE(u.last_activity_at, u.last_seen_at)))::text as days_inactive
    FROM users u
    WHERE u.is_banned = false
      AND COALESCE(u.last_activity_at, u.last_seen_at) < (now() - interval '1 day' * $1)
      AND COALESCE(u.last_activity_at, u.last_seen_at) >= (now() - interval '1 day' * ($1 + 1))
      AND NOT EXISTS (
        SELECT 1 FROM reminder_sends rs
        WHERE rs.user_id = u.id
          AND rs.reminder_type = $2
          AND rs.sent_at > (now() - interval '1 day' * $1)
      )
    ORDER BY u.last_activity_at ASC NULLS FIRST
    LIMIT $3
  `, [days, reminderType, batchSize]);

  return result.rows.map(row => ({
    user_id: row.user_id,
    telegram_id: row.telegram_id,
    language: row.language as 'fa' | 'en',
    days_inactive: parseInt(row.days_inactive, 10)
  }));
}

/**
 * Record that a reminder was sent to a user
 */
async function recordReminderSent(userId: number, reminderType: ReminderType): Promise<void> {
  await query(`
    INSERT INTO reminder_sends (user_id, reminder_type, sent_at)
    VALUES ($1, $2, now())
  `, [userId, reminderType]);
}

/**
 * Send reminder to a single inactive user
 */
async function sendReminder(
  bot: Bot<MyContext>,
  user: InactiveUser,
  reminderType: ReminderType
): Promise<boolean> {
  try {
    const lang = user.language === 'fa' ? 'fa' : 'en';
    const text = await getReminderText(reminderType, lang);
    
    if (!text) {
      logger.warn(`No reminder text found for ${reminderType} in ${lang}`);
      return false;
    }

    await bot.api.sendMessage(user.telegram_id, text);
    await recordReminderSent(user.user_id, reminderType);
    
    logger.info(`Sent ${reminderType} reminder to user ${user.user_id} (${user.days_inactive} days inactive)`);
    return true;
  } catch (error) {
    logger.error(`Failed to send ${reminderType} reminder to user ${user.user_id}:`, error);
    return false;
  }
}

/**
 * Process reminders for a specific type (3day, 7day, or 14day)
 */
async function processReminderType(
  bot: Bot<MyContext>,
  reminderType: ReminderType,
  days: number
): Promise<{ sent: number; failed: number }> {
  const enabled = await isReminderEnabled(reminderType);
  
  if (!enabled) {
    logger.info(`${reminderType} reminders are disabled, skipping`);
    return { sent: 0, failed: 0 };
  }

  logger.info(`Processing ${reminderType} reminders (${days} days inactive)...`);
  
  const users = await getInactiveUsers(days, reminderType);
  
  if (users.length === 0) {
    logger.info(`No users found for ${reminderType} reminders`);
    return { sent: 0, failed: 0 };
  }

  logger.info(`Found ${users.length} users for ${reminderType} reminders`);
  
  let sent = 0;
  let failed = 0;

  for (const user of users) {
    const success = await sendReminder(bot, user, reminderType);
    if (success) {
      sent++;
    } else {
      failed++;
    }
    
    // Small delay to avoid rate limiting
    await new Promise(resolve => setTimeout(resolve, 50));
  }

  logger.info(`${reminderType} reminders complete: ${sent} sent, ${failed} failed`);
  return { sent, failed };
}

/**
 * Run the reminder scheduler
 * Checks for users inactive for 3, 7, and 14 days and sends appropriate reminders
 */
export async function runReminderScheduler(bot: Bot<MyContext>): Promise<void> {
  try {
    logger.info('Starting reminder scheduler run...');
    
    const results = await Promise.all([
      processReminderType(bot, '3day', 3),
      processReminderType(bot, '7day', 7),
      processReminderType(bot, '14day', 14)
    ]);

    const totalSent = results.reduce((sum, r) => sum + r.sent, 0);
    const totalFailed = results.reduce((sum, r) => sum + r.failed, 0);

    logger.info(`Reminder scheduler complete: ${totalSent} total sent, ${totalFailed} total failed`);
  } catch (error) {
    logger.error('Error in reminder scheduler:', error);
  }
}

/**
 * Start the reminder scheduler with a daily interval
 * Returns a function to stop the scheduler
 */
export function startReminderScheduler(bot: Bot<MyContext>): () => void {
  // Run once immediately on startup
  runReminderScheduler(bot).catch(err => {
    logger.error('Error in initial reminder scheduler run:', err);
  });

  // Schedule to run once per day (every 24 hours)
  const interval = setInterval(() => {
    runReminderScheduler(bot).catch(err => {
      logger.error('Error in scheduled reminder run:', err);
    });
  }, 24 * 60 * 60 * 1000); // 24 hours in milliseconds

  logger.info('Reminder scheduler started (runs daily)');

  // Return cleanup function
  return () => {
    clearInterval(interval);
    logger.info('Reminder scheduler stopped');
  };
}
