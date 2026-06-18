import { Keyboard } from "grammy";
import type { BotConfigDocument, HomeMenuAction } from "../config/botContent.js";
import { labelForLang } from "../config/botContent.js";
import type { Language } from "../types.js";

export function buildHomeReplyKeyboard(cfg: BotConfigDocument, lang: Language) {
  const kb = new Keyboard();
  for (const row of cfg.home_menu.rows) {
    for (const btn of row) {
      kb.text(labelForLang(btn, lang));
    }
    kb.row();
  }
  return kb.resized();
}

export function matchHomeAction(
  cfg: BotConfigDocument,
  lang: Language,
  text: string
): HomeMenuAction | null {
  const t = text.trim();
  for (const row of cfg.home_menu.rows) {
    for (const btn of row) {
      if (labelForLang(btn, lang) === t) return btn.action;
    }
  }
  return null;
}
