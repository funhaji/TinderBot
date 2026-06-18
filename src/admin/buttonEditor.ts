/**
 * Improved Button & Text Editor for Admin Panel
 * Much more user-friendly than JSON editing
 */

import type { Bot } from "grammy";
import { InlineKeyboard } from "grammy";
import type { Language, MyContext, SessionState } from "../types.js";
import { t, tf } from "../i18n/index.js";
import { getBotConfig, setBotConfigDocument, invalidateBotConfigCache } from "../config/botContent.js";
import { resolveAdminLang } from "./lang.js";
import { setSession, getSession, getUserById } from "../db/repo.js";
import { isPanelAdmin } from "../config/access.js";

// Callback prefixes
const btn = {
  menu: "btnedit:menu",
  section: (section: string) => `btnedit:sec:${section}`,
  editButton: (section: string, row: number, col: number) => `btnedit:btn:${section}:${row}:${col}`,
  editText: (section: string, field: string) => `btnedit:txt:${section}:${field}`,
  back: "btnedit:back",
};

/**
 * Show main button editor menu
 */
export async function showButtonEditorMenu(ctx: MyContext, lang: Language) {
  const kb = new InlineKeyboard();
  
  kb.text("🏠 " + (lang === "fa" ? "منوی خانه" : "Home Menu"), btn.section("home_menu")).row();
  kb.text("🔍 " + (lang === "fa" ? "اکسپلور اصلی" : "Explorer Main"), btn.section("explorer_main")).row();
  kb.text("⚙️ " + (lang === "fa" ? "اکسپلور بیشتر" : "Explorer More"), btn.section("explorer_more")).row();
  kb.text("💬 " + (lang === "fa" ? "پیام‌های ربات" : "Bot Messages"), btn.section("bot_messages")).row();
  kb.text("« " + t(lang, "admin.back"), "adm:root");
  
  const title = lang === "fa" 
    ? "✏️ ویرایش دکمه‌ها و متن‌ها\n\nبخش مورد نظر را انتخاب کنید:"
    : "✏️ Edit Buttons & Texts\n\nSelect a section:";
  
  await ctx.editMessageText(title, { reply_markup: kb });
  await ctx.answerCallbackQuery();
}

/**
 * Show buttons in a section for editing
 */
export async function showSectionButtons(ctx: MyContext, section: string, lang: Language) {
  const config = await getBotConfig();
  const kb = new InlineKeyboard();
  
  if (section === "home_menu") {
    const rows = config.home_menu.rows;
    let title = lang === "fa" ? "📱 منوی خانه - دکمه‌ها:\n\n" : "📱 Home Menu Buttons:\n\n";
    
    rows.forEach((row, rowIdx) => {
      row.forEach((button, colIdx) => {
        const label = lang === "fa" ? button.fa : button.en;
        const shortLabel = label.length > 25 ? label.slice(0, 22) + "..." : label;
        kb.text(`✏️ ${shortLabel}`, btn.editButton("home_menu", rowIdx, colIdx));
        if (colIdx === row.length - 1) kb.row();
      });
    });
    
    kb.text("« " + t(lang, "admin.back"), btn.menu);
    await ctx.editMessageText(title + (lang === "fa" ? "دکمه‌ای را برای ویرایش انتخاب کنید:" : "Select a button to edit:"), { reply_markup: kb });
    
  } else if (section === "explorer_main") {
    const rows = config.explorer_main.rows;
    let title = lang === "fa" ? "🔍 اکسپلور اصلی - دکمه‌ها:\n\n" : "🔍 Explorer Main Buttons:\n\n";
    
    rows.forEach((row, rowIdx) => {
      row.forEach((button, colIdx) => {
        const label = lang === "fa" ? button.fa : button.en;
        const shortLabel = label.length > 25 ? label.slice(0, 22) + "..." : label;
        kb.text(`✏️ ${shortLabel}`, btn.editButton("explorer_main", rowIdx, colIdx));
        if (colIdx === row.length - 1) kb.row();
      });
    });
    
    kb.text("« " + t(lang, "admin.back"), btn.menu);
    await ctx.editMessageText(title + (lang === "fa" ? "دکمه‌ای را برای ویرایش انتخاب کنید:" : "Select a button to edit:"), { reply_markup: kb });
    
  } else if (section === "explorer_more") {
    const rows = config.explorer_more.rows;
    let title = lang === "fa" ? "⚙️ اکسپلور بیشتر - دکمه‌ها:\n\n" : "⚙️ Explorer More Buttons:\n\n";
    
    rows.forEach((row, rowIdx) => {
      row.forEach((button, colIdx) => {
        const label = lang === "fa" ? button.fa : button.en;
        const shortLabel = label.length > 25 ? label.slice(0, 22) + "..." : label;
        kb.text(`✏️ ${shortLabel}`, btn.editButton("explorer_more", rowIdx, colIdx));
        if (colIdx === row.length - 1) kb.row();
      });
    });
    
    kb.text("« " + t(lang, "admin.back"), btn.menu);
    await ctx.editMessageText(title + (lang === "fa" ? "دکمه‌ای را برای ویرایش انتخاب کنید:" : "Select a button to edit:"), { reply_markup: kb });
    
  } else if (section === "bot_messages") {
    const messages = config.bot_messages || {};
    let title = lang === "fa" ? "💬 پیام‌های ربات:\n\n" : "💬 Bot Messages:\n\n";
    
    kb.text("✏️ " + (lang === "fa" ? "پیام خوش‌آمد" : "Welcome Message"), btn.editText("bot_messages", "welcome")).row();
    kb.text("✏️ " + (lang === "fa" ? "پیام مچ" : "Match Message"), btn.editText("bot_messages", "match_notify")).row();
    kb.text("✏️ " + (lang === "fa" ? "پروفایل ذخیره شد" : "Profile Saved"), btn.editText("bot_messages", "profile_saved")).row();
    
    kb.text("« " + t(lang, "admin.back"), btn.menu);
    await ctx.editMessageText(title + (lang === "fa" ? "متنی را برای ویرایش انتخاب کنید:" : "Select a text to edit:"), { reply_markup: kb });
  }
  
  await ctx.answerCallbackQuery();
}

/**
 * Start editing a specific button
 */
export async function startEditButton(
  ctx: MyContext, 
  section: string, 
  row: number, 
  col: number,
  lang: Language
) {
  const config = await getBotConfig();
  const u = ctx.from ? await getUserById(ctx.from.id) : null;
  if (!u) return;
  
  let button;
  if (section === "home_menu") {
    button = config.home_menu.rows[row]?.[col];
  } else if (section === "explorer_main") {
    button = config.explorer_main.rows[row]?.[col];
  } else if (section === "explorer_more") {
    button = config.explorer_more.rows[row]?.[col];
  }
  
  if (!button) {
    await ctx.answerCallbackQuery({ text: "❌ Button not found", show_alert: true });
    return;
  }
  
  // Store edit state
  await setSession(u.id, {
    state: "admin_button_edit",
    payload: { section, row, col, step: "fa" },
  });
  
  const currentFa = button.fa;
  const currentEn = button.en;
  
  const prompt = lang === "fa"
    ? `✏️ ویرایش دکمه\n\n` +
      `متن فعلی (فارسی): ${currentFa}\n` +
      `متن فعلی (انگلیسی): ${currentEn}\n\n` +
      `متن جدید فارسی را بفرستید:\n` +
      `(یا /cancel برای لغو)`
    : `✏️ Edit Button\n\n` +
      `Current text (Persian): ${currentFa}\n` +
      `Current text (English): ${currentEn}\n\n` +
      `Send new Persian text:\n` +
      `(or /cancel to abort)`;
  
  await ctx.reply(prompt);
  await ctx.answerCallbackQuery();
}

/**
 * Handle button edit messages - called from tryHandleAdminFollowupMessage
 */
export async function handleButtonEditMessage(ctx: MyContext, u: { id: number }, s: Extract<SessionState, { state: "admin_button_edit" }>, lang: Language): Promise<boolean> {
  const text = ctx.message?.text;
  if (!text) return false;
  
  if (text === "/cancel") {
    await setSession(u.id, { state: "idle", payload: {} });
    await ctx.reply(t(lang, "admin.broadcastCancelled"));
    return true;
  }
  
  const { section, row, col, step, textFa } = s.payload;
  
  if (step === "fa") {
    // Got Persian text, ask for English
    await setSession(u.id, {
      state: "admin_button_edit",
      payload: { section, row, col, step: "en", textFa: text },
    });
    
    const prompt = lang === "fa"
      ? `✅ متن فارسی ثبت شد: ${text}\n\nحالا متن انگلیسی را بفرستید:`
      : `✅ Persian text saved: ${text}\n\nNow send English text:`;
    
    await ctx.reply(prompt);
    return true;
    
  } else if (step === "en" && textFa) {
    // Got both texts, save to database
    const textEn = text;
    
    const config = await getBotConfig();
    
    // Update the button
    if (section === "home_menu" && config.home_menu.rows[row]?.[col]) {
      config.home_menu.rows[row][col].fa = textFa;
      config.home_menu.rows[row][col].en = textEn;
    } else if (section === "explorer_main" && config.explorer_main.rows[row]?.[col]) {
      config.explorer_main.rows[row][col].fa = textFa;
      config.explorer_main.rows[row][col].en = textEn;
    } else if (section === "explorer_more" && config.explorer_more.rows[row]?.[col]) {
      config.explorer_more.rows[row][col].fa = textFa;
      config.explorer_more.rows[row][col].en = textEn;
    }
    
    // Save to database
    await setBotConfigDocument(config);
    invalidateBotConfigCache();
    
    await setSession(u.id, { state: "idle", payload: {} });
    
    const success = lang === "fa"
      ? `✅ دکمه به‌روزرسانی شد!\n\n` +
        `فارسی: ${textFa}\n` +
        `انگلیسی: ${textEn}\n\n` +
        `تغییرات بلافاصله اعمال می‌شود.`
      : `✅ Button updated!\n\n` +
        `Persian: ${textFa}\n` +
        `English: ${textEn}\n\n` +
        `Changes take effect immediately.`;
    
    await ctx.reply(success);
    return true;
  }
  
  return false;
}

/**
 * Register all button editor handlers
 */
export function setupButtonEditor(bot: Bot<MyContext>) {
  // Main menu
  bot.callbackQuery(btn.menu, async (ctx) => {
    if (!isPanelAdmin(ctx.from?.id)) return;
    const lang = await resolveAdminLang(ctx.from?.id, ctx.from?.language_code);
    await showButtonEditorMenu(ctx, lang);
  });
  
  // Section selection
  bot.callbackQuery(/^btnedit:sec:(.+)$/, async (ctx) => {
    if (!isPanelAdmin(ctx.from?.id)) return;
    const section = ctx.match?.[1];
    if (!section) return;
    const lang = await resolveAdminLang(ctx.from?.id, ctx.from?.language_code);
    await showSectionButtons(ctx, section, lang);
  });
  
  // Button edit
  bot.callbackQuery(/^btnedit:btn:(.+):(\d+):(\d+)$/, async (ctx) => {
    if (!isPanelAdmin(ctx.from?.id)) return;
    const section = ctx.match?.[1];
    const row = parseInt(ctx.match?.[2] || "0");
    const col = parseInt(ctx.match?.[3] || "0");
    if (!section) return;
    const lang = await resolveAdminLang(ctx.from?.id, ctx.from?.language_code);
    await startEditButton(ctx, section, row, col, lang);
  });
  
  // Back button
  bot.callbackQuery(btn.back, async (ctx) => {
    if (!isPanelAdmin(ctx.from?.id)) return;
    const lang = await resolveAdminLang(ctx.from?.id, ctx.from?.language_code);
    await showButtonEditorMenu(ctx, lang);
  });
}
