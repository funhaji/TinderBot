import pino from "pino";
import { config } from "./config.js";
export const logger = pino({
    level: config.LOG_LEVEL,
    base: undefined,
    redact: {
        paths: ["req.headers.authorization", "DATABASE_URL", "BOT_TOKEN"],
        remove: true,
    },
});
