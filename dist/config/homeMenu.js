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
    verify_face: "home.verify_face",
    placeholder: "home.placeholder",
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
        }
    }
    return null;
}
