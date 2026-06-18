import { getSystemSettingBool, getSystemSettingNumber, getSystemSettingString } from "../db/repo.js";
import { tf } from "../i18n/index.js";
import { logger } from "../logger.js";
export function normalizePublicHandle(raw) {
    const trimmed = raw.trim();
    if (!trimmed)
        return null;
    const handle = trimmed.startsWith("@") ? trimmed : `@${trimmed}`;
    if (!/^@[A-Za-z0-9_]{4,}$/.test(handle))
        return null;
    return handle;
}
export async function getStartNotifyGroupRef() {
    const handle = (await getSystemSettingString("start_notify_group_ref", "")).trim();
    if (handle)
        return handle;
    const legacyId = await getSystemSettingNumber("start_notify_group_id", 0);
    return legacyId !== 0 ? String(legacyId) : null;
}
export async function isStartNotifyEnabled() {
    return getSystemSettingBool("start_notify_enabled", false);
}
export async function notifyStartGroup(api, params) {
    if (!params.isNewUser)
        return;
    const enabled = await isStartNotifyEnabled();
    const groupRef = await getStartNotifyGroupRef();
    if (!enabled || !groupRef)
        return;
    const displayName = [params.firstName, params.lastName].filter(Boolean).join(" ").trim() || "—";
    const text = tf("fa", "admin.startNotifyBody", {
        name: displayName,
        username: params.username ? `@${params.username}` : "—",
        tgId: params.telegramId,
        language: params.language === "fa" ? "فارسی" : "English",
        total: params.totalUsers,
        referred: params.referredByDbId != null ? String(params.referredByDbId) : "—",
    });
    await api.sendMessage(groupRef, text).catch((err) => {
        logger.warn({ err, groupRef }, "start_notify_send_failed");
    });
}
