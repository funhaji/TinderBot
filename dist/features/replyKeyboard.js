import { Keyboard } from "grammy";
import { labelForLang } from "../config/botContent.js";
export function buildHomeReplyKeyboard(cfg, lang) {
    const kb = new Keyboard();
    for (const row of cfg.home_menu.rows) {
        for (const btn of row) {
            kb.text(labelForLang(btn, lang));
        }
        kb.row();
    }
    return kb.resized();
}
export function matchHomeAction(cfg, lang, text) {
    const t = text.trim();
    for (const row of cfg.home_menu.rows) {
        for (const btn of row) {
            if (labelForLang(btn, lang) === t)
                return btn.action;
        }
    }
    return null;
}
