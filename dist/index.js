import "dotenv/config";
import { logger } from "./logger.js";
import { setupProxyFromEnv } from "./proxy.js";
import { checkLicenseOrExit, startLicenseWatcher } from "./killswitch.js";
async function main() {
    await checkLicenseOrExit();
    await setupProxyFromEnv();
    const hasDb = !!process.env.DATABASE_URL?.trim();
    const bot = hasDb
        ? await (async () => {
            const { migrateUp } = await import("./db/migrate.js");
            const { pruneMessageLogs } = await import("./db/repo.js");
            const { processInactiveUserReminders } = await import("./services/inactiveReminders.js");
            if (process.env.SKIP_MIGRATIONS !== "1" && process.env.SKIP_MIGRATIONS !== "true") {
                await migrateUp();
            }
            const { createBot } = await import("./bot.js");
            const bot = await createBot();
            // Prune message logs every 15 minutes
            setInterval(() => {
                pruneMessageLogs().catch((err) => logger.warn({ err }, "prune_message_logs"));
            }, 15 * 60 * 1000);
            // Check for inactive users daily at 10:00 AM
            setInterval(async () => {
                const now = new Date();
                if (now.getHours() === 10 && now.getMinutes() < 2) { // 2-minute window
                    logger.info("Running inactive user reminders check");
                    await processInactiveUserReminders(bot).catch((err) => logger.error({ err }, "inactive_reminders_error"));
                }
            }, 60 * 1000); // Check every minute
            return bot;
        })()
        : await (async () => {
            const { createBotNoDb } = await import("./botNoDb.js");
            return createBotNoDb();
        })();
    startLicenseWatcher();
    logger.info({ hasDb }, "Bot starting (long polling)...");
    await bot.start({
        onStart: (info) => logger.info({ username: info.username }, "Bot started"),
    });
}
main().catch((err) => {
    logger.fatal({ err }, "Fatal error");
    process.exitCode = 1;
});
