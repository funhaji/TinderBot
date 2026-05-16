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
  "mystery_room",
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
    mystery_welcome: LangPairSchema.optional(),
    mystery_chat_started: LangPairSchema.optional(),
    mystery_queue_expired: LangPairSchema.optional(),
  }).optional(),
});

export type BotConfigDocument = z.infer<typeof BotConfigDocumentSchema>;
export type HomeMenuAction = z.infer<typeof HomeActionSchema>;

export const BOT_MESSAGE_KEYS = [
  "welcome",
  "no_profile",
  "match_notify",
  "profile_saved",
  "mystery_welcome",
  "mystery_chat_started",
  "mystery_queue_expired",
] as const;
export type BotMessageKey = typeof BOT_MESSAGE_KEYS[number];

export const DEFAULT_BOT_CONFIG: BotConfigDocument = {
  v: 5,
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
        { action: "mystery_room", fa: "Mystery Room 🎭", en: "Mystery Room 🎭" },
      ],
      [
        { action: "settings", fa: "پنل کاربری ⚙️", en: "Settings ⚙️" },
        { action: "stats", fa: "Level Up 🚀", en: "Level Up 🚀" },
      ],
      [
        { action: "likes", fa: "لایک‌ها ❤️", en: "Likes ❤️" },
        { action: "matches", fa: "پیشنهادات 💌", en: "Matches 💌" },
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
    mystery_welcome: {
      fa: "🎭 Mystery Room\n\n🔸 مچ با تطبیق متقابل جنسیت و گرایش.\n\n🔸 ورود فقط با تکمیل نام، سن، کشور، شهر، جنسیت و گرایش.\n\n🔸 انتظار تا ۵ دقیقه.\n\n🔸 برای استفاده از این بخش هزینه‌ای نداره!\n\n🔸 بعد از ۱۵ دقیقه چت قطع می‌شود و ۵ دقیقه فرصت داری بله/خیر بزنی؛ هر دو بله → اتصال کامل و ارسال پروفایل.\n\nبرای شروع روی دکمه زیر بزن.",
      en: "🎭 Mystery Room\n\n🔸 Matched by mutual gender & orientation compatibility.\n\n🔸 Entry requires a complete profile: name, age, country, city, gender & orientation.\n\n🔸 Queue wait up to 5 minutes.\n\n🔸 Completely free!\n\n🔸 After 15 min the chat ends and you have 5 min to vote yes/no — both yes → full connect & profiles shared.\n\nPress the button below to start.",
    },
    mystery_chat_started: {
      fa: "🎭 با یک نفر وصل شدی! بنویس (برای خروج: /exit)",
      en: "🎭 Connected! Start chatting (to leave: /exit)",
    },
    mystery_queue_expired: {
      fa: "❌ کسی در صف پیدا نشد. دوباره تلاش کن.",
      en: "❌ No one found in the queue. Try again.",
    },
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
  const parsed = BotConfigDocumentSchema.safeParse(d);
  const empty = !d || (typeof d === "object" && d !== null && Object.keys(d as object).length === 0);
  const stale = parsed.success && parsed.data.v < DEFAULT_BOT_CONFIG.v;
  if (empty || !parsed.success || stale) {
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
  const msgStore = cfg.bot_messages ?? DEFAULT_BOT_CONFIG.bot_messages!;
  const pair = msgStore[key] ?? DEFAULT_BOT_CONFIG.bot_messages![key];
  if (!pair) return key;
  return labelForLang(pair, lang);
}
