import type { Bot } from "grammy";
import { InlineKeyboard } from "grammy";
import type { Language, MyContext } from "../types.js";
import type { BotConfigDocument } from "../config/botContent.js";
import { labelForLang } from "../config/botContent.js";
import type { ProfileRow } from "../db/repo.js";

const EX = {
  dislike: "ex:dl",
  like: "ex:lk",
  like_direct: "ex:ld",
  more: "ex:mo",
  back: "ex:ba",
  exit: "ex:xn",
  never_show: "ex:ns",
  report: "ex:rp",
  back_explore: "ex:be",
} as const;

export function explorerMarkup(cfg: BotConfigDocument, lang: Language, sub: "main" | "more") {
  const rows = sub === "main" ? cfg.explorer_main.rows : cfg.explorer_more.rows;
  const kb = new InlineKeyboard();
  for (const row of rows) {
    for (const btn of row) {
      const label = labelForLang(btn, lang);
      const code = EX[btn.key as keyof typeof EX];
      if (code) kb.text(label, code);
    }
    kb.row();
  }
  return kb;
}

export function haversineMeters(
  a: { lat: number; lon: number },
  b: { lat: number; lon: number }
): number {
  const R = 6371000;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLon = ((b.lon - a.lon) * Math.PI) / 180;
  const la1 = (a.lat * Math.PI) / 180;
  const la2 = (b.lat * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(la1) * Math.cos(la2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

function orientationDiscoverLabel(lang: Language, o: string | null | undefined): string | null {
  if (!o || o === "skip") return null;
  const map: Record<string, { fa: string; en: string }> = {
    straight: { fa: "مستقیم", en: "Straight" },
    gay: { fa: "همجنس‌گرا", en: "Gay/Lesbian" },
    bi: { fa: "دوجنس‌گرا", en: "Bisexual" },
    other: { fa: "سایر", en: "Other" },
  };
  if (map[o]) return lang === "fa" ? map[o].fa : map[o].en;
  return null;
}

function genderDiscoverLabel(lang: Language, g: string | null | undefined): string | null {
  if (!g) return null;
  const map: Record<string, { fa: string; en: string }> = {
    m: { fa: "مرد", en: "Male" },
    f: { fa: "زن", en: "Female" },
    x: { fa: "سایر", en: "Other" },
  };
  if (map[g]) return lang === "fa" ? map[g].fa : map[g].en;
  return null;
}

export function formatDiscoverCaption(params: {
  lang: Language;
  target: ProfileRow;
  viewer: ProfileRow;
}): string {
  const { lang, target, viewer } = params;
  const lines: string[] = [];

  const genderStr = genderDiscoverLabel(lang, target.gender);
  const nameLine = genderStr
    ? `${target.display_name} · ${target.age} · ${genderStr}`
    : `${target.display_name} (${target.age})`;
  lines.push(nameLine);

  const country = target.preferences?.country;
  if (country) {
    lines.push(lang === "fa" ? `🌍 ${country}` : `🌍 ${country}`);
  }

  if (
    viewer.location_lat != null &&
    viewer.location_lon != null &&
    target.location_lat != null &&
    target.location_lon != null
  ) {
    const m = haversineMeters(
      { lat: viewer.location_lat, lon: viewer.location_lon },
      { lat: target.location_lat, lon: target.location_lon }
    );
    const km = (m / 1000).toFixed(1);
    lines.push(lang === "fa" ? `📍 ${target.city} · ${km} کیلومتر` : `📍 ${target.city} · ${km} km`);
  } else {
    lines.push(`📍 ${target.city}`);
  }

  const orientation = orientationDiscoverLabel(lang, target.preferences?.orientation);
  if (orientation) {
    lines.push(lang === "fa" ? `💜 ${orientation}` : `💜 ${orientation}`);
  }

  if (target.preferences?.personal_traits) {
    lines.push(`\n${target.preferences.personal_traits}`);
  } else if (target.bio) {
    lines.push(`\n${target.bio}`);
  }

  return lines.join("\n");
}

export function registerExplorerCallbacks(
  bot: Bot<MyContext>,
  handlers: {
    onDislike: (ctx: MyContext) => Promise<void>;
    onLike: (ctx: MyContext) => Promise<void>;
    onLikeDirect: (ctx: MyContext) => Promise<void>;
    onMore: (ctx: MyContext) => Promise<void>;
    onBack: (ctx: MyContext) => Promise<void>;
    onExit: (ctx: MyContext) => Promise<void>;
    onNeverShow: (ctx: MyContext) => Promise<void>;
    onReport: (ctx: MyContext) => Promise<void>;
    onBackExplore: (ctx: MyContext) => Promise<void>;
  }
) {
  bot.callbackQuery(EX.dislike, handlers.onDislike);
  bot.callbackQuery(EX.like, handlers.onLike);
  bot.callbackQuery(EX.like_direct, handlers.onLikeDirect);
  bot.callbackQuery(EX.more, handlers.onMore);
  bot.callbackQuery(EX.back, handlers.onBack);
  bot.callbackQuery(EX.exit, handlers.onExit);
  bot.callbackQuery(EX.never_show, handlers.onNeverShow);
  bot.callbackQuery(EX.report, handlers.onReport);
  bot.callbackQuery(EX.back_explore, handlers.onBackExplore);
}

export { EX };
