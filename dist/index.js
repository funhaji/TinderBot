import "dotenv/config";
import { logger } from "./logger.js";
import { setupProxyFromEnv } from "./proxy.js";
async function main() {
    await setupProxyFromEnv();
    const hasDb = !!process.env.DATABASE_URL?.trim();
    const bot = hasDb
        ? await (async () => {
            const { migrateUp } = await import("./db/migrate.js");
            const { pruneMessageLogs } = await import("./db/repo.js");
            if (process.env.SKIP_MIGRATIONS !== "1" && process.env.SKIP_MIGRATIONS !== "true") {
                await migrateUp();
            }
            const { createBot } = await import("./bot.js");
            setInterval(() => {
                pruneMessageLogs().catch((err) => logger.warn({ err }, "prune_message_logs"));
            }, 15 * 60 * 1000);
            return createBot();
        })()
        : await (async () => {
            const { createBotNoDb } = await import("./botNoDb.js");
            return createBotNoDb();
        })();
    logger.info({ hasDb }, "Bot starting (long polling)...");
    await bot.start({
        onStart: (info) => logger.info({ username: info.username }, "Bot started"),
    });
}
main().catch((err) => {
    logger.fatal({ err }, "Fatal error");
    process.exitCode = 1;
});
