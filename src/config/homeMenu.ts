import { Keyboard } from "grammy";
import type { HomeMenuAction } from "../config/botContent.js";
import type { Language } from "../types.js";
import { t } from "../i18n/index.js";

/** Reply keyboard layout is code-defined; labels come from i18n (not DB). */
export const HOME_MENU_ROWS: HomeMenuAction[][] = [
  ["profile", "explore"],
  ["mystery_room"],
  ["settings", "stats"],
  ["likes", "matches", "share"],
];

const ACTION_I18N: Record<HomeMenuAction, string> = {
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

const LEGACY_ACTION_LABELS: Record<HomeMenuAction, string[]> = {
  profile: ["پروفایل من 👤", "My Profile 👤"],
  explore: ["جستجوی پارتنر 🔍", "Find Partner 🔍", "اکسپلور ⚡", "Explore ⚡"],
  settings: ["پنل کاربری ⚙️", "تنظیمات ⚙️", "Settings ⚙️"],
  stats: ["Level Up 🚀", "آمار 📊", "Stats 📊"],
  share: ["Share Pro 🔷", "اشتراک پرو 🔷"],
  matches: ["پیشنهادات 💌", "Matches 💌", "Matches 💞", "مچ‌ها 💞"],
  likes: ["لایک‌ها ❤️", "Likes ❤️", "Likers ❤️"],
  mystery_room: ["Mystery Room 🎭"],
  verify_face: ["احراز چهره 📸", "Face verify 📸"],
  placeholder: ["به‌زودی…", "Coming soon…"],
};

export function buildCodeHomeReplyKeyboard(lang: Language) {
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

export function matchCodeHomeAction(lang: Language, text: string): HomeMenuAction | null {
  const trimmed = text.trim();
  for (const row of HOME_MENU_ROWS) {
    for (const action of row) {
      const key = ACTION_I18N[action];
      if (t(lang, key) === trimmed) return action;
      if ((LEGACY_ACTION_LABELS[action] ?? []).includes(trimmed)) return action;
    }
  }
  return null;
}
