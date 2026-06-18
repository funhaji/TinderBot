import { z } from "zod";
function parseAdminIds(raw) {
    if (!raw?.trim())
        return [];
    return raw
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
        .map((s) => Number(s))
        .filter((n) => Number.isFinite(n) && Number.isInteger(n) && n > 0);
}
const EnvSchema = z.object({
    BOT_TOKEN: z.string().min(1),
    // Allow empty for local no-DB test mode; DB code is only loaded when DATABASE_URL is set.
    DATABASE_URL: z.string().optional().default(""),
    LOG_LEVEL: z
        .enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
        .default("info"),
    USE_POSTGIS: z
        .string()
        .optional()
        .transform((v) => (v ?? "").toLowerCase())
        .transform((v) => v === "1" || v === "true" || v === "yes"),
    DISCOVERY_BATCH_SIZE: z
        .string()
        .optional()
        .transform((v) => (v ? Number(v) : 25))
        .pipe(z.number().int().min(5).max(100)),
    DISCOVERY_RADIUS_METERS: z
        .string()
        .optional()
        .transform((v) => (v ? Number(v) : 20000))
        .pipe(z.number().int().min(1000).max(200000)),
    ADMIN_TELEGRAM_IDS: z
        .string()
        .optional()
        .transform((v) => parseAdminIds(v)),
    BOT_OWNER_TELEGRAM_ID: z
        .string()
        .optional()
        .transform((v) => {
        const n = Number((v ?? "").trim());
        return Number.isFinite(n) && Number.isInteger(n) && n > 0 ? n : 0;
    }),
});
const parsed = EnvSchema.parse(process.env);
export const config = {
    ...parsed,
    adminTelegramIdSet: new Set(parsed.ADMIN_TELEGRAM_IDS ?? []),
    ownerTelegramId: parsed.BOT_OWNER_TELEGRAM_ID ?? 0,
};
