import { getUserByTelegramId } from "../db/repo.js";
import type { Language } from "../types.js";

/** Admin UI language: bot profile language first, then Telegram client, default Persian. */
export async function resolveAdminLang(
  telegramId: number | undefined,
  languageCode?: string
): Promise<Language> {
  if (telegramId) {
    const u = await getUserByTelegramId(telegramId);
    if (u?.language === "fa" || u?.language === "en") return u.language;
  }
  if (languageCode?.startsWith("fa")) return "fa";
  if (languageCode?.startsWith("en")) return "en";
  return "fa";
}
