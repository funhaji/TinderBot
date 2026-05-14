import type { Bot } from "grammy";
import { InlineKeyboard } from "grammy";
import {
  BOT_MESSAGE_KEYS,
  BotConfigDocumentSchema,
  DEFAULT_BOT_CONFIG,
  getBotConfig,
  getBotMsg,
  invalidateBotConfigCache,
  labelForLang,
  setBotConfigDocument,
} from "../config/botContent.js";
import type { BotMessageKey } from "../config/botContent.js";
import { config } from "../config.js";
import { logger } from "../logger.js";
import type { Language, MyContext, SessionState } from "../types.js";
import { t, tf } from "../i18n/index.js";
import {
  adjustDiamondBalance,
  approveFaceSubmission,
  banUser,
  unbanUser,
  countMatches,
  countOpenReports,
  countUsers,
  getUserByTelegramId,
  getUserById,
  getTelegramIdByUserId,
  getPendingFaceSubmissionUserId,
  listMessageLogs,
  listOpenReports,
  listPendingFaceSubmissions,
  purgeAllMessageLogs,
  rejectFaceSubmission,
  resolveReport,
  resetUserNopes,
  setProfileVisibility,
  setSession,
  getSystemSettingBool,
  setSystemSetting,
} from "../db/repo.js";

const REP_PAGE = 5;

const MSG_LABEL_KEY: Record<BotMessageKey, string> = {
  welcome: "admin.msgWelcome",
  no_profile: "admin.msgNoProfile",
  match_notify: "admin.msgMatchNotify",
  profile_saved: "admin.msgProfileSaved",
  face_submitted: "admin.msgFaceSubmitted",
  face_approved: "admin.msgFaceApproved",
  face_rejected: "admin.msgFaceRejected",
  mystery_welcome: "admin.msgMysteryWelcome",
  mystery_chat_started: "admin.msgMysteryWelcome",
  mystery_queue_expired: "admin.msgMysteryWelcome",
};

const adm = {
  root: "adm:root",
  stats: "adm:st",
  reports: (page: number) => `adm:rp:${page}`,
  dismiss: (reporterId: number, targetId: number) => `adm:d:${reporterId}:${targetId}`,
  ban: (reporterId: number, targetId: number) => `adm:b:${reporterId}:${targetId}`,
  hide: (reporterId: number, targetId: number) => `adm:h:${reporterId}:${targetId}`,
  broadcast: "adm:bc",
  find: "adm:fn",
  logs: "adm:logs",
  logToggle: "adm:logtog",
  logPurge: "adm:logpurge",
  logPurgeY: "adm:logpy",
  ret: (h: number) => `adm:ret:${h}`,
  face: "adm:face",
  fap: (id: number) => `adm:fap:${id}`,
  far: (id: number) => `adm:far:${id}`,
  cfg: "adm:cfg",
  cfgReset: "adm:cfgrst",
  cfgHome: "adm:cfghm",
  cfgStart: "adm:cfgst",
  cfgExplorerMain: "adm:cfgem",
  cfgExplorerMore: "adm:cfgeo",
  cfgSettings: "adm:cfgs",
  cfgStats: "adm:cfgstats",
  dim: "adm:dim",
  dimg: "adm:dimg",
  dimd: "adm:dimd",
  editMessages: "adm:msgedit",
  msgPick: (key: string) => `adm:msp:${key}`,
};

function adminLang(ctx: MyContext): Language {
  return ctx.from?.language_code?.startsWith("fa") ? "fa" : "en";
}

function isAdminTg(id: number | undefined): boolean {
  return id != null && config.adminTelegramIdSet.has(id);
}

export function adminRootKb(lang: Language) {
  return new InlineKeyboard()
    .text(t(lang, "admin.stats"), adm.stats)
    .row()
    .text(t(lang, "admin.reports"), adm.reports(0))
    .row()
    .text(t(lang, "admin.broadcast"), adm.broadcast)
    .text(t(lang, "admin.find"), adm.find)
    .row()
    .text(t(lang, "admin.logs"), adm.logs)
    .text(t(lang, "admin.logToggle"), adm.logToggle)
    .row()
    .text(t(lang, "admin.ret24"), adm.ret(24))
    .text(t(lang, "admin.ret72"), adm.ret(72))
    .text(t(lang, "admin.ret168"), adm.ret(168))
    .row()
    .text(t(lang, "admin.logPurge"), adm.logPurge)
    .row()
    .text(t(lang, "admin.faceQueue"), adm.face)
    .text(t(lang, "admin.botConfig"), adm.cfg)
    .row()
    .text(t(lang, "admin.editMessages"), adm.editMessages)
    .row()
    .text(t(lang, "admin.diamonds"), adm.dim);
}

export async function tryHandleAdminFollowupMessage(
  ctx: MyContext,
  u: { id: number },
  s: SessionState,
  lang: Language
): Promise<boolean> {
  if (!isAdminTg(ctx.from?.id)) return false;
  const txt = ctx.message?.text?.trim() ?? "";

  if (s.state === "admin_config_wait") {
    const section = (s.payload as { section?: string }).section ?? "";
    if (txt === "/cancel") {
      await setSession(u.id, { state: "idle", payload: {} });
      await ctx.reply(t(lang, "admin.broadcastCancelled"));
      return true;
    }
    try {
      const parsed = JSON.parse(txt) as unknown;
      const doc = await getBotConfig();
      const sh = BotConfigDocumentSchema.shape;
      let next = { ...doc };
      if (section === "home_menu") next = { ...doc, home_menu: sh.home_menu.parse(parsed) };
      else if (section === "start") next = { ...doc, start: sh.start.parse(parsed) };
      else if (section === "explorer_main") next = { ...doc, explorer_main: sh.explorer_main.parse(parsed) };
      else if (section === "explorer_more") next = { ...doc, explorer_more: sh.explorer_more.parse(parsed) };
      else if (section === "settings") next = { ...doc, settings: sh.settings.parse(parsed) };
      else if (section === "stats") next = { ...doc, stats: sh.stats.parse(parsed) };
      else if (section === "placeholder_toast")
        next = { ...doc, placeholder_toast: sh.placeholder_toast.parse(parsed) };
      else if (section === "diamond_messages")
        next = { ...doc, diamond_messages: sh.diamond_messages.parse(parsed) };
      else {
        await ctx.reply(t(lang, "admin.cfgUnknownSection"));
        return true;
      }
      await setBotConfigDocument(BotConfigDocumentSchema.parse(next));
      invalidateBotConfigCache();
      await setSession(u.id, { state: "idle", payload: {} });
      await ctx.reply(t(lang, "admin.cfgSaved"));
    } catch (e) {
      logger.warn({ e }, "admin_cfg_parse");
      await ctx.reply(t(lang, "admin.cfgInvalidJson"));
    }
    return true;
  }

  if (s.state === "admin_diamond_wait") {
    const mode = (s.payload as { mode?: "grant" | "deduct" }).mode ?? "grant";
    if (txt === "/cancel") {
      await setSession(u.id, { state: "idle", payload: {} });
      await ctx.reply(t(lang, "admin.broadcastCancelled"));
      return true;
    }
    const parts = txt.split(/\s+/);
    const tg = Number(parts[0]);
    const amt = Number(parts[1]);
    if (!Number.isFinite(tg) || !Number.isFinite(amt) || !Number.isInteger(amt)) {
      await ctx.reply(t(lang, "admin.diamondBadFormat"));
      return true;
    }
    const target = await getUserByTelegramId(tg);
    if (!target) {
      await ctx.reply(t(lang, "admin.userNotFound"));
      return true;
    }
    const delta = mode === "grant" ? Math.abs(amt) : -Math.abs(amt);
    await adjustDiamondBalance({
      userId: target.id,
      delta,
      reason: mode === "grant" ? "admin_grant" : "admin_deduct",
      adminTelegramId: ctx.from!.id,
      refJson: {},
    });
    await setSession(u.id, { state: "idle", payload: {} });
    await ctx.reply(tf(lang, "admin.diamondDone", { delta, userId: target.id }));
    const notifyTg = await getTelegramIdByUserId(target.id);
    if (notifyTg) {
      const cfg = await getBotConfig();
      const targetRow = await getUserById(target.id);
      const ulang: Language = targetRow?.language === "fa" ? "fa" : "en";
      const dm = cfg.diamond_messages;
      const body =
        mode === "grant"
          ? labelForLang(dm.granted, ulang).replace("{n}", String(Math.abs(delta)))
          : labelForLang(dm.deducted, ulang).replace("{n}", String(delta));
      await ctx.api.sendMessage(notifyTg, body).catch(() => {});
    }
    return true;
  }

  if (s.state === "admin_msg_edit") {
    const { key, step } = s.payload as { key: string; step: "fa" | "en"; fa?: string };
    if (txt === "/cancel") {
      await setSession(u.id, { state: "idle", payload: {} });
      await ctx.reply(t(lang, "admin.broadcastCancelled"));
      return true;
    }
    if (step === "fa") {
      await setSession(u.id, { state: "admin_msg_edit", payload: { key, step: "en", fa: txt } });
      await ctx.reply(t(lang, "admin.msgAskEn"));
      return true;
    }
    if (step === "en") {
      const faText = (s.payload as { fa?: string }).fa ?? "";
      const cfg = await getBotConfig();
      const msgKey = key as BotMessageKey;
      if (!BOT_MESSAGE_KEYS.includes(msgKey)) {
        await ctx.reply(t(lang, "admin.cfgUnknownSection"));
        await setSession(u.id, { state: "idle", payload: {} });
        return true;
      }
      const updatedMessages = { ...DEFAULT_BOT_CONFIG.bot_messages, ...cfg.bot_messages, [msgKey]: { fa: faText, en: txt } } as NonNullable<typeof cfg.bot_messages>;
      await setBotConfigDocument({ ...cfg, bot_messages: updatedMessages });
      invalidateBotConfigCache();
      await setSession(u.id, { state: "idle", payload: {} });
      await ctx.reply(t(lang, "admin.msgSaved"));
      return true;
    }
    return true;
  }

  return false;
}

export function setupAdmin(bot: Bot<MyContext>) {
  bot.command("admin", async (ctx) => {
    if (!isAdminTg(ctx.from?.id)) {
      await ctx.reply(t(adminLang(ctx), "admin.denied"));
      return;
    }
    const lang = adminLang(ctx);
    await ctx.reply(t(lang, "admin.menu"), { reply_markup: adminRootKb(lang) });
  });

  bot.callbackQuery(adm.root, async (ctx) => {
    if (!isAdminTg(ctx.from?.id)) return;
    const lang = adminLang(ctx);
    await ctx.answerCallbackQuery();
    await ctx.editMessageText(t(lang, "admin.menu"), { reply_markup: adminRootKb(lang) });
  });

  bot.callbackQuery(adm.stats, async (ctx) => {
    if (!isAdminTg(ctx.from?.id)) return;
    const lang = adminLang(ctx);
    await ctx.answerCallbackQuery();
    const users = await countUsers();
    const matches = await countMatches();
    const reports = await countOpenReports();
    await ctx.editMessageText(tf(lang, "admin.statsLine", { users, matches, reports }), {
      reply_markup: new InlineKeyboard().text(t(lang, "admin.back"), adm.root),
    });
  });

  bot.callbackQuery(/^adm:rp:(\d+)$/, async (ctx) => {
    if (!isAdminTg(ctx.from?.id)) return;
    const lang = adminLang(ctx);
    const page = Number(ctx.match?.[1] ?? 0);
    await ctx.answerCallbackQuery();
    const rows = await listOpenReports(REP_PAGE, page * REP_PAGE);
    const kb = new InlineKeyboard();
    if (rows.length === 0) {
      await ctx.editMessageText(t(lang, "admin.reportsEmpty"), {
        reply_markup: new InlineKeyboard().text(t(lang, "admin.back"), adm.root),
      });
      return;
    }
    let lines = "";
    for (const r of rows) {
      lines += `${tf(lang, "admin.reportRow", { target: r.target_id, reporter: r.reporter_id })}\n`;
      kb.text(t(lang, "admin.dismiss"), adm.dismiss(r.reporter_id, r.target_id))
        .text(t(lang, "admin.ban"), adm.ban(r.reporter_id, r.target_id))
        .text(t(lang, "admin.hide"), adm.hide(r.reporter_id, r.target_id))
        .row();
    }
    const peek = await listOpenReports(1, (page + 1) * REP_PAGE);
    if (page > 0 || peek.length > 0) {
      if (page > 0) kb.text("«", adm.reports(page - 1));
      if (peek.length > 0) kb.text("»", adm.reports(page + 1));
      kb.row();
    }
    kb.text(t(lang, "admin.back"), adm.root);
    await ctx.editMessageText(lines.trimEnd(), { reply_markup: kb });
  });

  bot.callbackQuery(/^adm:d:(\d+):(\d+)$/, async (ctx) => {
    if (!isAdminTg(ctx.from?.id)) return;
    const reporterId = Number(ctx.match?.[1]);
    const targetId = Number(ctx.match?.[2]);
    await ctx.answerCallbackQuery();
    await resolveReport({
      reporterId,
      targetId,
      adminTelegramId: ctx.from!.id,
    });
    logger.info({ reporterId, targetId, admin: ctx.from!.id }, "admin_report_dismiss");
    await ctx.reply(t(adminLang(ctx), "admin.dismiss"));
  });

  bot.callbackQuery(/^adm:b:(\d+):(\d+)$/, async (ctx) => {
    if (!isAdminTg(ctx.from?.id)) return;
    const reporterId = Number(ctx.match?.[1]);
    const targetId = Number(ctx.match?.[2]);
    await ctx.answerCallbackQuery();
    await banUser(targetId, "admin");
    await resolveReport({
      reporterId,
      targetId,
      adminTelegramId: ctx.from!.id,
    });
    logger.warn({ targetId, admin: ctx.from!.id }, "admin_ban");
    await ctx.reply(t(adminLang(ctx), "admin.ban"));
  });

  bot.callbackQuery(/^adm:h:(\d+):(\d+)$/, async (ctx) => {
    if (!isAdminTg(ctx.from?.id)) return;
    const reporterId = Number(ctx.match?.[1]);
    const targetId = Number(ctx.match?.[2]);
    await ctx.answerCallbackQuery();
    await setProfileVisibility(targetId, false);
    await resolveReport({
      reporterId,
      targetId,
      adminTelegramId: ctx.from!.id,
    });
    logger.info({ targetId, admin: ctx.from!.id }, "admin_hide_profile");
    await ctx.reply(t(adminLang(ctx), "admin.hide"));
  });

  bot.callbackQuery(adm.broadcast, async (ctx) => {
    if (!isAdminTg(ctx.from?.id)) return;
    const lang = adminLang(ctx);
    await ctx.answerCallbackQuery();
    const u = await getUserByTelegramId(ctx.from!.id);
    if (!u) return;
    await setSession(u.id, { state: "admin_broadcast", payload: {} });
    await ctx.reply(t(lang, "admin.broadcastPrompt"));
  });

  bot.callbackQuery(adm.find, async (ctx) => {
    if (!isAdminTg(ctx.from?.id)) return;
    const lang = adminLang(ctx);
    await ctx.answerCallbackQuery();
    const u = await getUserByTelegramId(ctx.from!.id);
    if (!u) return;
    await setSession(u.id, { state: "admin_find", payload: {} });
    await ctx.reply(t(lang, "admin.findPrompt"));
  });

  bot.callbackQuery(adm.logs, async (ctx) => {
    if (!isAdminTg(ctx.from?.id)) return;
    const lang = adminLang(ctx);
    await ctx.answerCallbackQuery();
    const rows = await listMessageLogs(15, 0);
    const lines = rows.length
      ? rows.map((r) => `${r.created_at.slice(0, 19)} [${r.direction}] tg:${r.telegram_user_id} ${r.update_type} ${r.text_preview.slice(0, 40)}`).join("\n")
      : t(lang, "admin.logsEmpty");
    await ctx.reply(lines.slice(0, 3500), {
      reply_markup: new InlineKeyboard().text(t(lang, "admin.back"), adm.root),
    });
  });

  bot.callbackQuery(adm.logToggle, async (ctx) => {
    if (!isAdminTg(ctx.from?.id)) return;
    const lang = adminLang(ctx);
    const cur = await getSystemSettingBool("message_logging_enabled", true);
    await setSystemSetting("message_logging_enabled", !cur);
    await ctx.answerCallbackQuery({
      text: t(lang, !cur ? "admin.logOn" : "admin.logOff"),
      show_alert: false,
    });
  });

  bot.callbackQuery(/^adm:ret:(\d+)$/, async (ctx) => {
    if (!isAdminTg(ctx.from?.id)) return;
    const lang = adminLang(ctx);
    const h = Number(ctx.match?.[1]);
    await setSystemSetting("message_log_retention_hours", h);
    await ctx.answerCallbackQuery({ text: tf(lang, "admin.retSet", { h }), show_alert: false });
  });

  bot.callbackQuery(adm.logPurge, async (ctx) => {
    if (!isAdminTg(ctx.from?.id)) return;
    const lang = adminLang(ctx);
    await ctx.answerCallbackQuery();
    await ctx.reply(t(lang, "admin.logPurgeConfirm"), {
      reply_markup: new InlineKeyboard()
        .text(t(lang, "delete.yes"), adm.logPurgeY)
        .text(t(lang, "delete.no"), adm.root),
    });
  });

  bot.callbackQuery(adm.logPurgeY, async (ctx) => {
    if (!isAdminTg(ctx.from?.id)) return;
    await ctx.answerCallbackQuery();
    await purgeAllMessageLogs();
    await ctx.reply(t(adminLang(ctx), "admin.logPurgeDone"));
  });

  bot.callbackQuery(adm.face, async (ctx) => {
    if (!isAdminTg(ctx.from?.id)) return;
    const lang = adminLang(ctx);
    await ctx.answerCallbackQuery();
    const pending = await listPendingFaceSubmissions(5);
    if (pending.length === 0) {
      await ctx.reply(t(lang, "admin.faceEmpty"));
      return;
    }
    const kb = new InlineKeyboard();
    for (const p of pending) {
      kb.text(
        tf(lang, "admin.faceRow", { id: p.id, uid: p.user_id }),
        adm.fap(Number(p.id))
      )
        .text("R", adm.far(Number(p.id)))
        .row();
    }
    kb.text(t(lang, "admin.back"), adm.root);
    await ctx.reply(t(lang, "admin.facePick"), { reply_markup: kb });
  });

  bot.callbackQuery(/^adm:fap:(\d+)$/, async (ctx) => {
    if (!isAdminTg(ctx.from?.id)) return;
    const lang = adminLang(ctx);
    const id = Number(ctx.match?.[1]);
    await ctx.answerCallbackQuery();
    const uid = await getPendingFaceSubmissionUserId(id);
    if (uid == null) return;
    await approveFaceSubmission({ submissionId: id, reviewerTelegramId: ctx.from!.id });
    if (uid != null) {
      const tg = await getTelegramIdByUserId(uid);
      const cfg = await getBotConfig();
      const targetRow = await getUserById(uid);
      const ulang: Language = targetRow?.language === "fa" ? "fa" : "en";
      if (tg) await ctx.api.sendMessage(tg, getBotMsg(cfg, "face_approved", ulang)).catch(() => {});
    }
    await ctx.reply(tf(lang, "admin.faceApproved", { id }));
  });

  bot.callbackQuery(/^adm:far:(\d+)$/, async (ctx) => {
    if (!isAdminTg(ctx.from?.id)) return;
    const lang = adminLang(ctx);
    const id = Number(ctx.match?.[1]);
    await ctx.answerCallbackQuery();
    const uid = await getPendingFaceSubmissionUserId(id);
    await rejectFaceSubmission({
      submissionId: id,
      reviewerTelegramId: ctx.from!.id,
      reason: "admin",
    });
    if (uid != null) {
      const tg = await getTelegramIdByUserId(uid);
      const cfg = await getBotConfig();
      const targetRow = await getUserById(uid);
      const ulang: Language = targetRow?.language === "fa" ? "fa" : "en";
      if (tg) await ctx.api.sendMessage(tg, getBotMsg(cfg, "face_rejected", ulang)).catch(() => {});
    }
    await ctx.reply(tf(lang, "admin.faceRejected", { id }));
  });

  bot.callbackQuery(adm.cfg, async (ctx) => {
    if (!isAdminTg(ctx.from?.id)) return;
    const lang = adminLang(ctx);
    await ctx.answerCallbackQuery();
    await ctx.editMessageText(t(lang, "admin.cfgMenu"), {
      reply_markup: new InlineKeyboard()
        .text("start", adm.cfgStart)
        .text("home_menu", adm.cfgHome)
        .row()
        .text("explorer_main", adm.cfgExplorerMain)
        .text("explorer_more", adm.cfgExplorerMore)
        .row()
        .text("settings", adm.cfgSettings)
        .text("stats", adm.cfgStats)
        .row()
        .text(t(lang, "admin.cfgReset"), adm.cfgReset)
        .text(t(lang, "admin.back"), adm.root),
    });
  });

  bot.callbackQuery(adm.cfgReset, async (ctx) => {
    if (!isAdminTg(ctx.from?.id)) return;
    await ctx.answerCallbackQuery();
    await setBotConfigDocument(DEFAULT_BOT_CONFIG);
    invalidateBotConfigCache();
    await ctx.reply(t(adminLang(ctx), "admin.cfgResetDone"));
  });

  const cfgWait = (section: string) => async (ctx: MyContext) => {
    if (!isAdminTg(ctx.from?.id)) return;
    const lang = adminLang(ctx);
    await ctx.answerCallbackQuery();
    const u = await getUserByTelegramId(ctx.from!.id);
    if (!u) return;
    await setSession(u.id, { state: "admin_config_wait", payload: { section } });
    await ctx.reply(tf(lang, "admin.cfgSendJson", { section }));
  };

  bot.callbackQuery(adm.cfgHome, cfgWait("home_menu"));
  bot.callbackQuery(adm.cfgStart, cfgWait("start"));
  bot.callbackQuery(adm.cfgExplorerMain, cfgWait("explorer_main"));
  bot.callbackQuery(adm.cfgExplorerMore, cfgWait("explorer_more"));
  bot.callbackQuery(adm.cfgSettings, cfgWait("settings"));
  bot.callbackQuery(adm.cfgStats, cfgWait("stats"));

  bot.callbackQuery(adm.editMessages, async (ctx) => {
    if (!isAdminTg(ctx.from?.id)) return;
    const lang = adminLang(ctx);
    await ctx.answerCallbackQuery();
    const kb = new InlineKeyboard();
    for (const key of BOT_MESSAGE_KEYS) {
      kb.text(t(lang, MSG_LABEL_KEY[key]), adm.msgPick(key)).row();
    }
    kb.text(t(lang, "admin.back"), adm.root);
    await ctx.editMessageText(t(lang, "admin.msgMenu"), { reply_markup: kb });
  });

  bot.callbackQuery(/^adm:msp:(.+)$/, async (ctx) => {
    if (!isAdminTg(ctx.from?.id)) return;
    const lang = adminLang(ctx);
    const key = ctx.match?.[1] ?? "";
    if (!BOT_MESSAGE_KEYS.includes(key as BotMessageKey)) {
      await ctx.answerCallbackQuery();
      return;
    }
    const cfg = await getBotConfig();
    const current = cfg.bot_messages?.[key as BotMessageKey] ?? DEFAULT_BOT_CONFIG.bot_messages?.[key as BotMessageKey];
    await ctx.answerCallbackQuery();
    const u = await getUserByTelegramId(ctx.from!.id);
    if (!u) return;
    await setSession(u.id, { state: "admin_msg_edit", payload: { key, step: "fa" } });
    await ctx.reply(
      tf(lang, "admin.msgCurrent", { fa: current?.fa ?? "", en: current?.en ?? "" })
    );
  });

  bot.callbackQuery(adm.dim, async (ctx) => {
    if (!isAdminTg(ctx.from?.id)) return;
    const lang = adminLang(ctx);
    await ctx.answerCallbackQuery();
    await ctx.editMessageText(t(lang, "admin.diamondMenu"), {
      reply_markup: new InlineKeyboard()
        .text(t(lang, "admin.diamondGrant"), adm.dimg)
        .text(t(lang, "admin.diamondDeduct"), adm.dimd)
        .row()
        .text(t(lang, "admin.back"), adm.root),
    });
  });

  bot.callbackQuery(adm.dimg, async (ctx) => {
    if (!isAdminTg(ctx.from?.id)) return;
    const lang = adminLang(ctx);
    await ctx.answerCallbackQuery();
    const u = await getUserByTelegramId(ctx.from!.id);
    if (!u) return;
    await setSession(u.id, { state: "admin_diamond_wait", payload: { mode: "grant" } });
    await ctx.reply(t(lang, "admin.diamondPrompt"));
  });

  bot.callbackQuery(adm.dimd, async (ctx) => {
    if (!isAdminTg(ctx.from?.id)) return;
    const lang = adminLang(ctx);
    await ctx.answerCallbackQuery();
    const u = await getUserByTelegramId(ctx.from!.id);
    if (!u) return;
    await setSession(u.id, { state: "admin_diamond_wait", payload: { mode: "deduct" } });
    await ctx.reply(t(lang, "admin.diamondPrompt"));
  });

  bot.callbackQuery(/^adm:rnopes:(\d+)$/, async (ctx) => {
    if (!isAdminTg(ctx.from?.id)) return;
    const lang = adminLang(ctx);
    const targetId = Number(ctx.match?.[1]);
    await ctx.answerCallbackQuery();
    await resetUserNopes(targetId);
    logger.info({ targetId, admin: ctx.from!.id }, "admin_reset_nopes");
    await ctx.reply(t(lang, "admin.nopesReset"));
  });

  bot.callbackQuery(/^adm:usrban:(\d+):(0|1)$/, async (ctx) => {
    if (!isAdminTg(ctx.from?.id)) return;
    const lang = adminLang(ctx);
    const targetId = Number(ctx.match?.[1]);
    const doBan = ctx.match?.[2] === "1";
    await ctx.answerCallbackQuery();
    if (doBan) {
      await banUser(targetId, "admin");
      logger.warn({ targetId, admin: ctx.from!.id }, "admin_ban");
      await ctx.reply(t(lang, "admin.ban"));
    } else {
      await unbanUser(targetId);
      logger.info({ targetId, admin: ctx.from!.id }, "admin_unban");
      await ctx.reply(t(lang, "admin.unban"));
    }
  });
}
