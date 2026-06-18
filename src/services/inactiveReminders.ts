import type { Bot } from "grammy";
import type { MyContext, Language } from "../types.js";
import { query } from "../db/sql.js";
import { getSystemSettingBool, getSystemSettingString } from "../db/repo.js";
import { logger } from "../logger.js";

/**
 * Inactive User Reminder System
 * Sends automated reminders to users who haven't interacted with the bot
 * for 3, 7, or 14 days based on admin configuration.
 */

type ReminderDay = 3 | 7 | 14;

interface InactiveUser {
  userId: number;
  telegramId: number;
  language: Language;
  daysSinceLastSeen: number;
}

/**
 * Get users who are inactive and haven't received a specific reminder yet
 */
async function getInactiveUsersForReminder(days: ReminderDay): Promise<InactiveUser[]> {
  const res = await query<{ user_id: number; telegram_id: number; language: string; days_since: number }>(
    `
    SELECT 
      u.id AS user_id,
      u.telegram_id,
      COALESCE(u.language, 'fa') AS language,
      EXTRACT(EPOCH FROM (now() - u.last_seen_at)) / 86400 AS days_since
    FROM users u
    WHERE 
      u.is_banned = false
      AND u.last_seen_at < now() - make_interval(days => $1)
      AND u.last_seen_at >= now() - make_interval(days => $1 + 1)
      AND NOT EXISTS (
        SELECT 1 FROM inactive_user_reminders iur
        WHERE iur.user_id = u.id AND iur.reminder_day = $1
      )
    ORDER BY u.last_seen_at ASC
    LIMIT 100
    `,
    [days]
  );

  return res.rows.map((r) => ({
    userId: r.user_id,
    telegramId: Number(r.telegram_id),
    language: (r.language === "en" ? "en" : "fa") as Language,
    daysSinceLastSeen: Math.floor(r.days_since),
  }));
}

/**
 * Mark a reminder as sent for a user
 */
async function markReminderSent(userId: number, day: ReminderDay): Promise<void> {
  await query(
    `
    INSERT INTO inactive_user_reminders (user_id, reminder_day, sent_at)
    VALUES ($1, $2, now())
    ON CONFLICT (user_id, reminder_day) DO NOTHING
    `,
    [userId, day]
  );
}

/**
 * Get reminder message text from system settings
 */
async function getReminderMessage(day: ReminderDay, lang: Language): Promise<string> {
  const key = `reminder_${day}day_${lang}`;
  const message = await getSystemSettingString(key);
  
  // Fallback messages if not configured
  const defaults = {
    3: {
      fa: "سلام! 3 روزه تو رو ندیدیم 😊 دلمون برات تنگ شده! بیا و با افراد جدید آشنا شو. منتظرتیم! ❤️",
      en: "Hi! We haven't seen you for 3 days 😊 We miss you! Come back and meet new people. We're waiting for you! ❤️",
    },
    7: {
      fa: "یه هفته گذشته! 🎉 افراد جدید و جذاب منتظر آشنایی با تو هستن. برگرد و شانست رو امتحان کن! 💫",
      en: "A week has passed! 🎉 New and attractive people are waiting to meet you. Come back and try your luck! 💫",
    },
    14: {
      fa: "2 هفته شد که نیستی! 💔 دوستات و مچ‌های احتمالی منتظرتن. الان بهترین وقته که برگردی! 🌟",
      en: "It's been 2 weeks! 💔 Your friends and potential matches are waiting. Now is the best time to come back! 🌟",
    },
  };

  return message || defaults[day][lang];
}

/**
 * Check if a specific reminder is enabled
 */
async function isReminderEnabled(day: ReminderDay): Promise<boolean> {
  const key = `reminder_${day}day_enabled`;
  return await getSystemSettingBool(key);
}

/**
 * Send reminders to inactive users for a specific day interval
 */
async function sendRemindersForDay(bot: Bot<MyContext>, day: ReminderDay): Promise<number> {
  try {
    // Check if this reminder is enabled
    const enabled = await isReminderEnabled(day);
    if (!enabled) {
      logger.debug({ day }, "reminder_disabled");
      return 0;
    }

    const users = await getInactiveUsersForReminder(day);
    logger.info({ day, count: users.length }, "sending_inactive_reminders");

    let sentCount = 0;

    for (const user of users) {
      try {
        const message = await getReminderMessage(day, user.language);
        
        await bot.api.sendMessage(user.telegramId, message);
        await markReminderSent(user.userId, day);
        
        sentCount++;
        
        // Rate limiting: small delay between messages to avoid Telegram limits
        await new Promise((resolve) => setTimeout(resolve, 100));
      } catch (err) {
        logger.warn({ err, userId: user.userId, telegramId: user.telegramId }, "reminder_send_failed");
        // Continue with other users even if one fails
      }
    }

    logger.info({ day, sentCount, totalFound: users.length }, "reminders_sent");
    return sentCount;
  } catch (err) {
    logger.error({ err, day }, "reminder_batch_failed");
    return 0;
  }
}

/**
 * Main function to process all inactive user reminders
 * Should be called periodically (e.g., once per day via cron or scheduler)
 */
export async function processInactiveUserReminders(bot: Bot<MyContext>): Promise<void> {
  logger.info("starting_inactive_user_reminder_check");

  try {
    const sent3Day = await sendRemindersForDay(bot, 3);
    const sent7Day = await sendRemindersForDay(bot, 7);
    const sent14Day = await sendRemindersForDay(bot, 14);

    logger.info(
      {
        sent3Day,
        sent7Day,
        sent14Day,
        total: sent3Day + sent7Day + sent14Day,
      },
      "inactive_reminders_completed"
    );
  } catch (err) {
    logger.error({ err }, "inactive_reminder_process_failed");
  }
}

/**
 * Clean up old reminder records (optional maintenance task)
 * Removes records older than 30 days to keep the table size manageable
 */
export async function cleanupOldReminderRecords(): Promise<number> {
  try {
    const res = await query(
      `
      DELETE FROM inactive_user_reminders
      WHERE sent_at < now() - interval '30 days'
      `,
      []
    );
    
    const deleted = res.rowCount || 0;
    logger.info({ deleted }, "old_reminder_records_cleaned");
    return deleted;
  } catch (err) {
    logger.error({ err }, "reminder_cleanup_failed");
    return 0;
  }
}
