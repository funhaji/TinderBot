import { Bot } from "grammy";
import { DEFAULT_BOT_CONFIG, labelForLang } from "./config/botContent.js";
import type { HomeMenuAction } from "./config/botContent.js";
import { buildCodeHomeReplyKeyboard, matchCodeHomeAction } from "./config/homeMenu.js";
import { config } from "./config.js";
import { t } from "./i18n/index.js";
import { logger } from "./logger.js";
import type { Language, MyContext } from "./types.js";
import { cb, langKeyboard } from "./ui/keyboards.js";

function langFromTg(ctx: MyContext): Language {
  return ctx.from?.language_code?.startsWith("fa") ? "fa" : "en";
}

async function sendMenu(ctx: MyContext, lang: Language) {
  await ctx.reply(labelForLang(DEFAULT_BOT_CONFIG.start, lang), {
    reply_markup: buildCodeHomeReplyKeyboard(lang),
  });
}

async function dispatchHomeActionNoDb(ctx: MyContext, lang: Language, action: HomeMenuAction) {
  switch (action) {
    case "share":
      await ctx.reply(t(lang, "share.noUsername"));
      return;
    case "placeholder":
    default:
      await ctx.reply(
        lang === "fa"
          ? "حالت تست بدون دیتابیس فعال است. برای امکانات کامل DATABASE_URL را تنظیم کنید."
          : "No-DB test mode is enabled. Set DATABASE_URL for full features."
      );
      return;
  }
}

export async function createBotNoDb() {
  const bot = new Bot<MyContext>(config.BOT_TOKEN);

  bot.catch((err) => {
    logger.error({ update_id: err.ctx?.update?.update_id, err: err.error }, "bot_error");
  });

  bot.command("start", async (ctx) => {
    const lang = langFromTg(ctx);
    await ctx.reply(
      lang === "fa"
        ? "⚠️ دیتابیس پیدا نشد. ربات در حالت تست (بدون ذخیره‌سازی) اجرا می‌شود."
        : "⚠️ No database found. Running in test mode (no persistence)."
    );
    await ctx.reply(t(lang, "lang.choose"), { reply_markup: langKeyboard() });
  });

  bot.callbackQuery(/^lang:(fa|en)$/, async (ctx) => {
    const lang = (ctx.match?.[1] as Language) ?? "en";
    await ctx.answerCallbackQuery();
    try {
      await ctx.deleteMessage();
    } catch {
      /* ignore */
    }
    await sendMenu(ctx, lang);
  });

  bot.on("message:text", async (ctx) => {
    const lang = langFromTg(ctx);
    const action = matchCodeHomeAction(lang, ctx.msg.text);
    if (action) {
      await dispatchHomeActionNoDb(ctx, lang, action);
      return;
    }
    // Keep it simple for proxy/connection testing.
    await ctx.reply(
      lang === "fa"
        ? "در حالت تست بدون دیتابیس هستی. از /start برای منو استفاده کن."
        : "You are in no-DB test mode. Use /start to open the menu."
    );
  });

  // Minimal command set; keep callback ids compatible with existing keyboards.
  bot.callbackQuery(cb.settings, async (ctx) => {
    const lang = langFromTg(ctx);
    await ctx.answerCallbackQuery({
      text:
        lang === "fa"
          ? "تنظیمات در حالت بدون دیتابیس غیرفعال است."
          : "Settings are disabled in no-DB mode.",
      show_alert: true,
    });
  });

  return bot;
}

