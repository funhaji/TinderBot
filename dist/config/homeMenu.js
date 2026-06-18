import { Keyboard } from "grammy";
import { t } from "../i18n/index.js";
/** Reply keyboard layout is code-defined; labels come from i18n (not DB). */
export const HOME_MENU_ROWS = [
    ["profile", "explore"],
    ["mystery_room"],
    ["settings", "stats"],
    ["likes", "matches", "share"],
];
const ACTION_I18N = {
    profile: "home.profile",
    explore: "home.discover",
    settings: "home.settings",
    stats: "home.stats",
    share: "home.share",
    matches: "home.matches",
    likes: "home.likes",
    mystery_room: "home.mystery_room",
    verify_face: "home.placeholder",
    placeholder: "home.placeholder",
};
const LEGACY_ACTION_LABELS = {
    profile: ["پروفایل من 👤", "My Profile 👤"],
    explore: ["جستجوی پارتنر 🔍", "Find Partner 🔍", "اکسپلور ⚡", "Explore ⚡"],
    settings: ["پنل کاربری ⚙️", "تنظیمات ⚙️", "Settings ⚙️"],
    stats: ["Level Up 🚀", "آمار 📊", "Stats 📊"],
    share: ["Share Pro 🔷", "اشتراک پرو 🔷"],
    matches: ["پیشنهادات 💌", "Matches 💌", "Matches 💞", "مچ‌ها 💞"],
    likes: ["لایک‌ها ❤️", "Likes ❤️", "Likers ❤️"],
    mystery_room: ["Mystery Room 🎭", "Mystery Room 🎭 | Quick Chat", "Mystery Room 🎭 | جت سریع", "Mystery Room 🎭 | چت سریع"],
    verify_face: ["احراز چهره 📸", "Face verify 📸"],
    placeholder: ["به‌زودی…", "Coming soon…"],
};
export function buildCodeHomeReplyKeyboard(lang) {
    const kb = new Keyboard();
    for (const row of HOME_MENU_ROWS) {
        for (const action of row) {
            const key = ACTION_I18N[action];
            kb.text(t(lang, key));
        }
        kb.row();
    }
    return kb.resized();
}
export function matchCodeHomeAction(lang, text) {
    const trimmed = text.trim();
    for (const row of HOME_MENU_ROWS) {
        for (const action of row) {
            const key = ACTION_I18N[action];
            if (t(lang, key) === trimmed)
                return action;
            if ((LEGACY_ACTION_LABELS[action] ?? []).includes(trimmed))
                return action;
        }
    }
    return null;
}
