export function formatProfileBadgesLine(lang, flags) {
    const parts = [];
    if (flags.isOwner)
        parts.push(lang === "fa" ? "👑 مالک" : "👑 Owner");
    if (flags.isAdmin)
        parts.push(lang === "fa" ? "🛡️ ادمین" : "🛡️ Admin");
    if (flags.verified)
        parts.push(lang === "fa" ? "✅ تأیید" : "✅ Verified");
    if (flags.vip)
        parts.push(lang === "fa" ? "💎 VIP" : "💎 VIP");
    if (parts.length === 0)
        return "";
    return (lang === "fa" ? "نشان‌ها: " : "Badges: ") + parts.join(" · ") + "\n";
}
export function formatProfileBadgesShort(lang, flags) {
    const bits = [];
    if (flags.isOwner)
        bits.push("👑");
    if (flags.isAdmin)
        bits.push("🛡️");
    if (flags.verified)
        bits.push("✅");
    if (flags.vip)
        bits.push("💎");
    return bits.join("");
}
