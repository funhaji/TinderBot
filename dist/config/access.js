import { config } from "../config.js";
/** Owner + configured admins — full admin panel access. */
export function isPanelAdmin(telegramId) {
    if (telegramId == null)
        return false;
    if (config.adminTelegramIdSet.has(telegramId))
        return true;
    if (config.ownerTelegramId > 0 && telegramId === config.ownerTelegramId)
        return true;
    return false;
}
/** Telegram IDs that receive moderation DMs (face verify, etc.). */
export function panelAdminTelegramIds() {
    const ids = new Set(config.adminTelegramIdSet);
    if (config.ownerTelegramId > 0)
        ids.add(config.ownerTelegramId);
    return Array.from(ids);
}
