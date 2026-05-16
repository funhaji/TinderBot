import { getSystemSettingBool, getSystemSettingNumber } from "../db/repo.js";
import { tf } from "../i18n/index.js";
export async function getStartNotifyGroupId() {
    const id = await getSystemSettingNumber("start_notify_group_id", 0);
    return id !== 0 ? id : null;
}
export async function isStartNotifyEnabled() {
    return getSystemSettingBool("start_notify_enabled", false);
}
export async function notifyStartGroup(api, params) {
    if (!params.isNewUser)
        return;
    const enabled = await isStartNotifyEnabled();
    const groupId = await getStartNotifyGroupId();
    if (!enabled || groupId == null)
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
    await api.sendMessage(groupId, text).catch(() => { });
}
export async function extractForwardedGroupId(ctx) {
    const msg = ctx.message;
    if (!msg)
        return null;
    if (msg.forward_origin?.type === "chat") {
        const chat = msg.forward_origin.sender_chat;
        if (chat.type === "group" || chat.type === "supergroup")
            return chat.id;
    }
    const legacy = msg.forward_from_chat;
    if (legacy && (legacy.type === "group" || legacy.type === "supergroup")) {
        return legacy.id;
    }
    return null;
}
export function forwardedGroupTitle(ctx) {
    const msg = ctx.message;
    if (!msg)
        return "—";
    if (msg.forward_origin?.type === "chat")
        return msg.forward_origin.sender_chat.title ?? "—";
    const legacy = msg.forward_from_chat;
    return legacy?.title ?? "—";
}
