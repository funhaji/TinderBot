import { z } from "zod";
import { query } from "../db/sql.js";

const HomeActionSchema = z.enum([
  "profile",
  "explore",
  "settings",
  "stats",
  "share",
  "matches",
  "likes",
  "verify_face",
  "placeholder",
]);

const HomeBtnSchema = z.object({
  action: HomeActionSchema,
  fa: z.string().min(1).max(80),
  en: z.string().min(1).max(80),
});

const ExplorerKeySchema = z.enum([
  "dislike",
  "like",
  "like_direct",
  "more",
  "back",
  "exit",
  "never_show",
  "report",
  "back_explore",
]);

const ExplorerBtnSchema = z.object({
  key: ExplorerKeySchema,
  fa: z.string().min(1).max(40),
  en: z.string().min(1).max(40),
});

const LangPairSchema = z.object({
  fa: z.string(),
  en: z.string(),
});

export const BotConfigDocumentSchema = z.object({
  v: z.number().int().default(1),
  start: LangPairSchema,
  start_no_profile: LangPairSchema.optional(),
  home_menu: z.object({
    rows: z.array(z.array(HomeBtnSchema)).min(1).max(8),
  }),
  explorer_main: z.object({
    rows: z.array(z.array(ExplorerBtnSchema)).min(1).max(4),
  }),
  explorer_more: z.object({
    rows: z.array(z.array(ExplorerBtnSchema)).min(1).max(4),
  }),
  settings: z.object({
    title: LangPairSchema,
    toggles: z.object({
      only_verified: LangPairSchema,
      notify_like: LangPairSchema,
      notify_match: LangPairSchema,
      receive_chat: LangPairSchema,
      receive_direct: LangPairSchema,
    }),
  }),
  stats: z.object({
    title: LangPairSchema,
    tip: LangPairSchema,
    extra_profile: LangPairSchema,
    view_profile: LangPairSchema,
  }),
  placeholder_toast: LangPairSchema,
  diamond_messages: z.object({
    granted: LangPairSchema,
    deducted: LangPairSchema,
  }),
  bot_messages: z.object({
    welcome: LangPairSchema,
    no_profile: LangPairSchema,
    match_notify: LangPairSchema,
    profile_saved: LangPairSchema,
    face_submitted: LangPairSchema,
    face_approved: LangPairSchema,
    face_rejected: LangPairSchema,
  }).optional(),
});

export type BotConfigDocument = z.infer<typeof BotConfigDocumentSchema>;
export type HomeMenuAction = z.infer<typeof HomeActionSchema>;

export const BOT_MESSAGE_KEYS = [
  "welcome",
  "no_profile",
  "match_notify",
  "profile_saved",
  "face_submitted",
  "face_approved",
  "face_rejected",
] as const;
export type BotMessageKey = typeof BOT_MESSAGE_KEYS[number];

export const DEFAULT_BOT_CONFIG: BotConfigDocument = {
  v: 1,
  start: {
    fa: "منو",
    en: "Menu",
  },
  start_no_profile: {
    fa: "زبان را انتخاب کنید",
    en: "Choose your language",
  },
  home_menu: {
    rows: [
      [
        { action: "profile", fa: "پروفایل من 👤", en: "My Profile 👤" },
        { action: "explore", fa: "جستجوی پارتنر 🔍", en: "Find Partner 🔍" },
      ],
      [
        { action: "placeholder", fa: "Mystery Room 🎭", en: "Mystery Room 🎭" },
        { action: "placeholder", fa: "آزمون شخصیت 🧪", en: "Personality Test 🧪" },
      ],
      [
        { action: "settings", fa: "پنل کاربری ⚙️", en: "Settings ⚙️" },
        { action: "stats", fa: "Level Up 🚀", en: "Level Up 🚀" },
      ],
      [
        { action: "likes", fa: "لایک‌ها ❤️", en: "Likes ❤️" },
        { action: "matches", fa: "پیشنهادات 💌", en: "Matches 💌" },
        { action: "verify_face", fa: "احراز چهره 📸", en: "Verify Face 📸" },
      ],
    ],
  },
  explorer_main: {
    rows: [
      [
        { key: "dislike", fa: "دیسلایک 👎", en: "Dislike 👎" },
        { key: "like_direct", fa: "لایک + چت 💌", en: "Like + chat 💌" },
        { key: "like", fa: "لایک ❤️", en: "Like ❤️" },
      ],
      [
        { key: "more", fa: "بیشتر ⚙️", en: "More ⚙️" },
        { key: "back", fa: "بازگشت 🔙", en: "Back 🔙" },
        { key: "exit", fa: "خروج", en: "Exit" },
      ],
    ],
  },
  explorer_more: {
    rows: [
      [
        { key: "never_show", fa: "دیگه نشون نده ✋", en: "Never show ✋" },
        { key: "report", fa: "گزارش 🚫", en: "Report 🚫" },
      ],
      [{ key: "back_explore", fa: "بازگشت به اکسپلور 🔙", en: "Back to explore 🔙" }],
    ],
  },
  settings: {
    title: { fa: "تنظیمات", en: "Settings" },
    toggles: {
      only_verified: {
        fa: "فقط افراد احرازشده بتوانند لایک کنند",
        en: "Only face-verified users can like me",
      },
      notify_like: { fa: "اعلان لایک", en: "Like notifications" },
      notify_match: { fa: "اعلان مچ", en: "Match notifications" },
      receive_chat: { fa: "دریافت چت", en: "Receive chat" },
      receive_direct: { fa: "دریافت دایرکت", en: "Receive direct" },
    },
  },
  stats: {
    title: { fa: "آمار شخصی شما", en: "Your stats" },
    tip: {
      fa: "با تکمیل پروفایل شانس مچ و نرخ جذابیت بهتر می‌شود.",
      en: "Complete your profile to improve matches and attractiveness.",
    },
    extra_profile: { fa: "اطلاعات تکمیلی 📝", en: "Extra profile 📝" },
    view_profile: { fa: "پروفایل من 📱", en: "View my profile 📱" },
  },
  placeholder_toast: { fa: "به‌زودی.", en: "Coming soon." },
  diamond_messages: {
    granted: { fa: "الماس دریافت شد: +{n}", en: "Diamonds received: +{n}" },
    deducted: { fa: "الماس کم شد: {n}", en: "Diamonds deducted: {n}" },
  },
  bot_messages: {
    welcome: { fa: "منو", en: "Menu" },
    no_profile: { fa: "اول پروفایل‌ات را بسازیم.", en: "Let's create your profile first." },
    match_notify: { fa: "مچ شدید! 🎉", en: "It's a match! 🎉" },
    profile_saved: { fa: "پروفایل ذخیره شد.", en: "Profile saved." },
    face_submitted: { fa: "درخواست ثبت شد؛ بعد از بررسی اطلاع می‌دهیم.", en: "Submitted; we will notify you after review." },
    face_approved: { fa: "احراز چهره تأیید شد. ✅", en: "Face verification approved. ✅" },
    face_rejected: { fa: "احراز چهره رد شد؛ می‌توانی دوباره تلاش کنی.", en: "Face verification rejected; you can try again." },
  },
};

let cache: { doc: BotConfigDocument; loadedAt: number } | null = null;
const TTL_MS = 45_000;

export function invalidateBotConfigCache() {
  cache = null;
}

export async function getBotConfig(): Promise<BotConfigDocument> {
  const now = Date.now();
  if (cache && now - cache.loadedAt < TTL_MS) return cache.doc;
  const res = await query<{ document: unknown }>(`SELECT document FROM bot_config WHERE id = 1`);
  const raw = res.rows[0]?.document ?? {};
  const parsed = BotConfigDocumentSchema.safeParse(raw);
  if (!parsed.success) {
    return DEFAULT_BOT_CONFIG;
  }
  cache = { doc: parsed.data, loadedAt: now };
  return parsed.data;
}

export async function setBotConfigDocument(doc: BotConfigDocument) {
  const validated = BotConfigDocumentSchema.parse(doc);
  await query(`UPDATE bot_config SET document = $1::jsonb, updated_at = now() WHERE id = 1`, [
    JSON.stringify(validated),
  ]);
  invalidateBotConfigCache();
}

export async function ensureBotConfigSeeded() {
  const res = await query<{ document: unknown }>(`SELECT document FROM bot_config WHERE id = 1`);
  const row = res.rows[0];
  const d = row?.document;
  const empty = !d || (typeof d === "object" && d !== null && Object.keys(d as object).length === 0);
  if (empty || !BotConfigDocumentSchema.safeParse(d).success) {
    await query(`UPDATE bot_config SET document = $1::jsonb, updated_at = now() WHERE id = 1`, [
      JSON.stringify(DEFAULT_BOT_CONFIG),
    ]);
    invalidateBotConfigCache();
  }
}

export function labelForLang(pair: { fa: string; en: string }, lang: "fa" | "en"): string {
  return lang === "fa" ? pair.fa : pair.en;
}

export function getBotMsg(cfg: BotConfigDocument, key: BotMessageKey, lang: "fa" | "en"): string {
  const pair = cfg.bot_messages?.[key] ?? DEFAULT_BOT_CONFIG.bot_messages[key];
  return labelForLang(pair, lang);
}
