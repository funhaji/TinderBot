import { getUserByTelegramId } from "../db/repo.js";
/** Admin UI language: bot profile language first, then Telegram client, default Persian. */
export async function resolveAdminLang(telegramId, languageCode) {
    if (telegramId) {
        const u = await getUserByTelegramId(telegramId);
        if (u?.language === "fa" || u?.language === "en")
            return u.language;
    }
    if (languageCode?.startsWith("fa"))
        return "fa";
    if (languageCode?.startsWith("en"))
        return "en";
    return "fa";
}
