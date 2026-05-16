import type { Bot } from "grammy";
import { InlineKeyboard } from "grammy";
import {
  BOT_MESSAGE_KEYS,
  BotConfigDocumentSchema,
  DEFAULT_BOT_CONFIG,
  getBotConfig,
  invalidateBotConfigCache,
  labelForLang,
  setBotConfigDocument,
} from "../config/botContent.js";
import type { BotMessageKey } from "../config/botContent.js";
import {
  addPanelAdminId,
  isPanelAdmin,
  listDynamicPanelAdminIds,
  removePanelAdminId,
} from "../config/access.js";
import { resolveAdminLang } from "./lang.js";
import {
  getStartNotifyGroupRef,
  isStartNotifyEnabled,
  normalizePublicHandle,
} from "../features/startNotify.js";
import { logger } from "../logger.js";
import type { Language, MyContext, SessionState } from "../types.js";
import { t, tf } from "../i18n/index.js";
import {
  adjustDiamondBalance,
  countMatches,
  countOpenReports,
  banUser,
  unbanUser,
  deleteReferralFileReward,
  getAdminDashboardStats,
  adminGenderDistribution,
  adminOrientationDistribution,
  getUserByTelegramId,
  getUserById,
  getTelegramIdByUserId,
  listMessageLogs,
  getMessageLogById,
  listOpenReports,
  listReferralFileRewards,
  insertReferralFileReward,
  purgeAllMessageLogs,
  resolveReport,
  resetUserNopes,
  setProfileVisibility,
  setSession,
  getSystemSettingBool,
  getSystemSettingJson,
  getSystemSettingNumber,
  getSystemSettingString,
  setSystemSetting,
  updateUserBadges,
} from "../db/repo.js";

const REP_PAGE = 5;

const MSG_LABEL_KEY: Record<BotMessageKey, string> = {
  welcome: "admin.msgWelcome",
  no_profile: "admin.msgNoProfile",
  match_notify: "admin.msgMatchNotify",
  profile_saved: "admin.msgProfileSaved",
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
  logsPage: (page: number) => `adm:logs:${page}`,
  logView: (id: number) => `adm:logv:${id}`,
  logToggle: "adm:logtog",
  logPurge: "adm:logpurge",
  logPurgeY: "adm:logpy",
  ret: (h: number) => `adm:ret:${h}`,
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
  sendUser: "adm:su",
  rewardNew: "adm:rw",
  rewardList: "adm:rwl",
  rewardDelete: (id: number) => `adm:rwd:${id}`,
  referralCfg: "adm:rwc",
  referralSet: (key: string) => `adm:rws:${key}`,
  admins: "adm:admins",
  adminAdd: "adm:admins:add",
  adminRemove: "adm:admins:remove",
  botToggle: "adm:bot:toggle",
  joins: "adm:joins",
  joinAdd: "adm:joins:add",
  joinClear: "adm:joins:clear",
  userBadgeVerified: (userId: number, enabled: 0 | 1) => `adm:ubv:${userId}:${enabled}`,
  userBadgeVip: (userId: number, enabled: 0 | 1) => `adm:ubp:${userId}:${enabled}`,
  startNotify: "adm:sn",
  startNotifyToggle: "adm:snt",
  startNotifySet: "adm:sns",
};

const CFG_SECTIONS = [
  "start",
  "home_menu",
  "explorer_main",
  "explorer_more",
  "settings",
  "stats",
] as const;

const LOG_PAGE = 12;

function adminValueLabel(lang: Language, value: string): string {
  const key = value.trim().toLowerCase();
  if (key === "yes") return lang === "fa" ? "بله" : "Yes";
  if (key === "no") return lang === "fa" ? "خیر" : "No";
  if (key === "null" || key === "none" || key === "") return "—";
  return value;
}

function adminGenderLabel(lang: Language, value: string): string {
  const map: Record<string, { fa: string; en: string }> = {
    boy: { fa: "پسر", en: "Boy" },
    girl: { fa: "دختر", en: "Girl" },
    trans_boy: { fa: "ترنس پسر", en: "Trans boy" },
    trans_girl: { fa: "ترنس دختر", en: "Trans girl" },
    nb_male: { fa: "نـان‌باینری (مذکر)", en: "Non-binary (male)" },
    nb_female: { fa: "نـان‌باینری (مونث)", en: "Non-binary (female)" },
    m: { fa: "مرد", en: "Male" },
    f: { fa: "زن", en: "Female" },
    x: { fa: "سایر", en: "Other" },
    null: { fa: "ثبت نشده", en: "Unset" },
  };
  const row = map[value] ?? map.null!;
  return lang === "fa" ? row.fa : row.en;
}

function adminOrientationLabel(lang: Language, value: string): string {
  const map: Record<string, { fa: string; en: string }> = {
    straight: { fa: "استریت", en: "Straight" },
    gay: { fa: "گی", en: "Gay" },
    lesbian: { fa: "لزبین", en: "Lesbian" },
    bi: { fa: "دوجنس‌گرا", en: "Bisexual" },
    bisexual: { fa: "دوجنس‌گرا", en: "Bisexual" },
    other: { fa: "سایر", en: "Other" },
    null: { fa: "ثبت نشده", en: "Unset" },
  };
  const row = map[value] ?? map.null!;
  return lang === "fa" ? row.fa : row.en;
}

function formatDistribution(
  lang: Language,
  rows: Array<{ key: string; c: number }>,
  labeler: (lang: Language, value: string) => string
): string {
  if (rows.length === 0) return "—";
  return rows.map((row) => `${labeler(lang, row.key)}: ${row.c}`).join("\n");
}

const REFERRAL_SETTING_KEYS = [
  "diamond_reward_profile",
  "diamond_reward_referral",
  "referral_vip_threshold",
  "referral_badge_verify_threshold",
] as const;

type ReferralSettingKey = (typeof REFERRAL_SETTING_KEYS)[number];

async function referralSettingsText(lang: Language): Promise<string> {
  const [profileReward, referralReward, vipThreshold, verifyThreshold] = await Promise.all([
    getSystemSettingNumber("diamond_reward_profile", 10),
    getSystemSettingNumber("diamond_reward_referral", 5),
    getSystemSettingNumber("referral_vip_threshold", 10),
    getSystemSettingNumber("referral_badge_verify_threshold", 10),
  ]);
  return tf(lang, "admin.referralConfigCurrent", {
    profileReward,
    referralReward,
    vipThreshold,
    verifyThreshold,
  });
}

async function joinLocksText(lang: Language): Promise<string> {
  const raw = await getSystemSettingJson<unknown>("must_join_channels", []);
  const items = Array.isArray(raw) ? raw.map((v) => String(v)).filter(Boolean) : [];
  return tf(lang, "admin.joinLocksCurrent", {
    channels: items.length ? items.join("\n") : "—",
  });
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
    .text(t(lang, "admin.botConfig"), adm.cfg)
    .row()
    .text(t(lang, "admin.editMessages"), adm.editMessages)
    .row()
    .text(t(lang, "admin.diamonds"), adm.dim)
    .row()
    .text(t(lang, "admin.sendUser"), adm.sendUser)
    .text(t(lang, "admin.referralRewards"), adm.rewardNew)
    .row()
    .text(t(lang, "admin.rewardList"), adm.rewardList)
    .text(t(lang, "admin.referralConfig"), adm.referralCfg)
    .row()
    .text(t(lang, "admin.admins"), adm.admins)
    .text(t(lang, "admin.joinLocks"), adm.joins)
    .row()
    .text(t(lang, "admin.botToggle"), adm.botToggle)
    .row()
    .text(t(lang, "admin.startNotify"), adm.startNotify);
}

export async function tryHandleAdminFollowupMessage(
  ctx: MyContext,
  u: { id: number },
  s: SessionState,
  lang: Language
): Promise<boolean> {
  if (!isPanelAdmin(ctx.from?.id)) return false;
  const txt = ctx.message?.text?.trim() ?? "";

  if (s.state === "admin_reward_file" && ctx.message?.document) {
    const pl = s.payload as { minReferrals: number; captionFa: string; captionEn: string };
    const fid = ctx.message.document.file_id;
    await insertReferralFileReward({
      minReferrals: pl.minReferrals,
      captionFa: pl.captionFa,
      captionEn: pl.captionEn,
      fileId: fid,
    });
    await setSession(u.id, { state: "idle", payload: {} });
    await ctx.reply(t(lang, "admin.rewardSaved"));
    logger.info({ admin: ctx.from?.id, min: pl.minReferrals }, "admin_referral_reward_created");
    return true;
  }

  if (s.state === "admin_reward_file" && !ctx.message?.document) {
    if (txt === "/cancel") {
      await setSession(u.id, { state: "idle", payload: {} });
      await ctx.reply(t(lang, "admin.broadcastCancelled"));
      return true;
    }
    await ctx.reply(t(lang, "admin.rewardPromptFile"));
    return true;
  }

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

  if (s.state === "admin_send_user") {
    const pl = s.payload as { step?: "await_telegram" | "await_text"; targetTelegram?: number };
    if (txt === "/cancel") {
      await setSession(u.id, { state: "idle", payload: {} });
      await ctx.reply(t(lang, "admin.broadcastCancelled"));
      return true;
    }
    if (!pl.targetTelegram) {
      const tg = Number(txt);
      if (!Number.isFinite(tg) || !Number.isInteger(tg)) {
        await ctx.reply(t(lang, "admin.findInvalid"));
        return true;
      }
      await setSession(u.id, { state: "admin_send_user", payload: { step: "await_text", targetTelegram: tg } });
      await ctx.reply(t(lang, "admin.sendUserPromptText"));
      return true;
    }
    const targetUser = await getUserByTelegramId(pl.targetTelegram);
    if (!targetUser) {
      await ctx.reply(t(lang, "admin.userNotFound"));
      await setSession(u.id, { state: "idle", payload: {} });
      return true;
    }
    const destTg = await getTelegramIdByUserId(targetUser.id);
    if (!destTg) {
      await ctx.reply(t(lang, "admin.sendUserFail"));
      await setSession(u.id, { state: "idle", payload: {} });
      return true;
    }
    try {
      await ctx.api.copyMessage(destTg, ctx.chat!.id, ctx.message!.message_id);
      await ctx.reply(t(lang, "admin.sendUserDone"));
      logger.info({ admin: ctx.from?.id, toTg: pl.targetTelegram }, "admin_send_user");
    } catch {
      await ctx.reply(t(lang, "admin.sendUserFail"));
    }
    await setSession(u.id, { state: "idle", payload: {} });
    return true;
  }

  if (s.state === "admin_start_notify_setup") {
    if (txt === "/cancel") {
      await setSession(u.id, { state: "idle", payload: {} });
      await ctx.reply(t(lang, "admin.broadcastCancelled"));
      return true;
    }
    const groupRef = normalizePublicHandle(txt);
    if (!groupRef) {
      await ctx.reply(t(lang, "admin.startNotifySetPrompt"));
      return true;
    }
    await setSystemSetting("start_notify_group_ref", groupRef);
    await setSystemSetting("start_notify_enabled", true);
    await setSession(u.id, { state: "idle", payload: {} });
    await ctx.reply(tf(lang, "admin.startNotifySetDone", { title: groupRef, id: groupRef }));
    await ctx.reply(t(lang, "admin.startNotifyBotAdminHint"));
    return true;
  }

  if (s.state === "admin_reward_meta") {
    if (txt === "/cancel") {
      await setSession(u.id, { state: "idle", payload: {} });
      await ctx.reply(t(lang, "admin.broadcastCancelled"));
      return true;
    }
    const space = txt.indexOf(" ");
    if (space < 0) {
      await ctx.reply(t(lang, "admin.rewardPrompt"));
      return true;
    }
    const minRef = Number(txt.slice(0, space).trim());
    const rest = txt.slice(space + 1).trim();
    const cap = rest.split("|").map((x) => x.trim());
    if (!Number.isFinite(minRef) || cap.length < 2 || !cap[0] || !cap[1]) {
      await ctx.reply(t(lang, "admin.rewardPrompt"));
      return true;
    }
    await setSession(u.id, {
      state: "admin_reward_file",
      payload: { minReferrals: minRef, captionFa: cap[0]!, captionEn: cap[1]! },
    });
    await ctx.reply(t(lang, "admin.rewardPromptFile"));
    return true;
  }

  if (s.state === "admin_referral_setting_wait") {
    if (txt === "/cancel") {
      await setSession(u.id, { state: "idle", payload: {} });
      await ctx.reply(t(lang, "admin.broadcastCancelled"));
      return true;
    }
    const key = (s.payload as { key?: string }).key as ReferralSettingKey | undefined;
    const value = Number(txt);
    if (!key || !Number.isFinite(value) || !Number.isInteger(value) || value < 0) {
      await ctx.reply(t(lang, "admin.referralSettingPrompt"));
      return true;
    }
    await setSystemSetting(key, value);
    await setSession(u.id, { state: "idle", payload: {} });
    await ctx.reply(t(lang, "admin.cfgSaved"));
    return true;
  }

  if (s.state === "admin_join_lock_add") {
    if (txt === "/cancel") {
      await setSession(u.id, { state: "idle", payload: {} });
      await ctx.reply(t(lang, "admin.broadcastCancelled"));
      return true;
    }
    const handle = normalizePublicHandle(txt);
    if (!handle) {
      await ctx.reply(t(lang, "admin.joinLocksPrompt"));
      return true;
    }
    const current = await getSystemSettingJson<unknown>("must_join_channels", []);
    const next = new Set(Array.isArray(current) ? current.map((v) => String(v)) : []);
    next.add(handle);
    await setSystemSetting("must_join_channels", Array.from(next));
    await setSession(u.id, { state: "idle", payload: {} });
    await ctx.reply(await joinLocksText(lang));
    return true;
  }

  if (s.state === "admin_admin_add" || s.state === "admin_admin_remove") {
    if (txt === "/cancel") {
      await setSession(u.id, { state: "idle", payload: {} });
      await ctx.reply(t(lang, "admin.broadcastCancelled"));
      return true;
    }
    const tgId = Number(txt);
    if (!Number.isFinite(tgId) || !Number.isInteger(tgId) || tgId <= 0) {
      await ctx.reply(t(lang, "admin.findInvalid"));
      return true;
    }
    if (s.state === "admin_admin_add") await addPanelAdminId(tgId);
    else await removePanelAdminId(tgId);
    await setSession(u.id, { state: "idle", payload: {} });
    const ids = await listDynamicPanelAdminIds();
    await ctx.reply(tf(lang, "admin.adminListBody", { ids: ids.length ? ids.join(", ") : "—" }));
    return true;
  }

  return false;
}

export function setupAdmin(bot: Bot<MyContext>) {
  bot.command("admin", async (ctx) => {
    if (!isPanelAdmin(ctx.from?.id)) {
      await ctx.reply(t(await resolveAdminLang(ctx.from?.id, ctx.from?.language_code), "admin.denied"));
      return;
    }
    const lang = await resolveAdminLang(ctx.from?.id, ctx.from?.language_code);
    await ctx.reply(t(lang, "admin.menu"), { reply_markup: adminRootKb(lang) });
  });

  bot.command("setstartnotify", async (ctx) => {
    if (!isPanelAdmin(ctx.from?.id)) return;
    const chat = ctx.chat;
    if (!chat || (chat.type !== "group" && chat.type !== "supergroup")) return;
    const groupChat = chat as Extract<typeof chat, { type: "group" | "supergroup" }>;
    const lang = await resolveAdminLang(ctx.from?.id, ctx.from?.language_code);
    await setSystemSetting("start_notify_group_id", groupChat.id);
    await setSystemSetting("start_notify_enabled", true);
    const title = groupChat.title ?? String(groupChat.id);
    await ctx.reply(tf(lang, "admin.startNotifySetDone", { title, id: groupChat.id }));
  });

  bot.callbackQuery(adm.root, async (ctx) => {
    if (!isPanelAdmin(ctx.from?.id)) return;
    const lang = await resolveAdminLang(ctx.from?.id, ctx.from?.language_code);
    await ctx.answerCallbackQuery();
    await ctx.editMessageText(t(lang, "admin.menu"), { reply_markup: adminRootKb(lang) });
  });

  bot.callbackQuery(adm.stats, async (ctx) => {
    if (!isPanelAdmin(ctx.from?.id)) return;
    const lang = await resolveAdminLang(ctx.from?.id, ctx.from?.language_code);
    await ctx.answerCallbackQuery();
    const [dash, gRows, oRows, matches, reports] = await Promise.all([
      getAdminDashboardStats(),
      adminGenderDistribution(),
      adminOrientationDistribution(),
      countMatches(),
      countOpenReports(),
    ]);
    const users = dash.totalUsers;
    const genders = formatDistribution(lang, gRows, adminGenderLabel);
    const orientations = formatDistribution(lang, oRows, adminOrientationLabel);
    const body = tf(lang, "admin.statsDetailed", {
      users,
      active24: dash.activeUsers24h,
      matches24: dash.chats24h,
      mwait: dash.mysteryWaiting,
      mvote: dash.mysteryVote,
      genders,
      orientations,
    });
    const short = tf(lang, "admin.statsLine", { users, matches, reports });
    await ctx.editMessageText(`${short}\n\n${body}`, {
      reply_markup: new InlineKeyboard().text(t(lang, "admin.back"), adm.root),
    });
  });

  bot.callbackQuery(/^adm:rp:(\d+)$/, async (ctx) => {
    if (!isPanelAdmin(ctx.from?.id)) return;
    const lang = await resolveAdminLang(ctx.from?.id, ctx.from?.language_code);
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
      lines += `${tf(lang, "admin.reportRow", {
        target: r.target_id,
        reporter: r.reporter_id,
        reason: r.reason || "—",
      })}\n`;
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
    if (!isPanelAdmin(ctx.from?.id)) return;
    const reporterId = Number(ctx.match?.[1]);
    const targetId = Number(ctx.match?.[2]);
    await ctx.answerCallbackQuery();
    await resolveReport({
      reporterId,
      targetId,
      adminTelegramId: ctx.from!.id,
    });
    logger.info({ reporterId, targetId, admin: ctx.from!.id }, "admin_report_dismiss");
    await ctx.reply(t(await resolveAdminLang(ctx.from?.id, ctx.from?.language_code), "admin.dismiss"));
  });

  bot.callbackQuery(/^adm:b:(\d+):(\d+)$/, async (ctx) => {
    if (!isPanelAdmin(ctx.from?.id)) return;
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
    await ctx.reply(t(await resolveAdminLang(ctx.from?.id, ctx.from?.language_code), "admin.ban"));
  });

  bot.callbackQuery(/^adm:h:(\d+):(\d+)$/, async (ctx) => {
    if (!isPanelAdmin(ctx.from?.id)) return;
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
    await ctx.reply(t(await resolveAdminLang(ctx.from?.id, ctx.from?.language_code), "admin.hide"));
  });

  bot.callbackQuery(adm.broadcast, async (ctx) => {
    if (!isPanelAdmin(ctx.from?.id)) return;
    const lang = await resolveAdminLang(ctx.from?.id, ctx.from?.language_code);
    await ctx.answerCallbackQuery();
    const u = await getUserByTelegramId(ctx.from!.id);
    if (!u) return;
    await setSession(u.id, { state: "admin_broadcast", payload: {} });
    await ctx.reply(t(lang, "admin.broadcastPrompt"));
  });

  bot.callbackQuery(adm.find, async (ctx) => {
    if (!isPanelAdmin(ctx.from?.id)) return;
    const lang = await resolveAdminLang(ctx.from?.id, ctx.from?.language_code);
    await ctx.answerCallbackQuery();
    const u = await getUserByTelegramId(ctx.from!.id);
    if (!u) return;
    await setSession(u.id, { state: "admin_find", payload: {} });
    await ctx.reply(t(lang, "admin.findPrompt"));
  });

  bot.callbackQuery(adm.logs, async (ctx) => {
    if (!isPanelAdmin(ctx.from?.id)) return;
    const lang = await resolveAdminLang(ctx.from?.id, ctx.from?.language_code);
    await ctx.answerCallbackQuery();
    const rows = await listMessageLogs(LOG_PAGE, 0);
    const lines = rows.length
      ? rows
          .map((r) => `#${r.id} ${r.created_at.slice(0, 19)} [${r.direction}] tg:${r.telegram_user_id} ${r.update_type} ${r.text_preview.slice(0, 45)}`)
          .join("\n")
      : t(lang, "admin.logsEmpty");
    const nextRows = rows.length === LOG_PAGE ? await listMessageLogs(1, LOG_PAGE) : [];
    const kb = new InlineKeyboard();
    for (const row of rows.slice(0, 6)) kb.text(`#${row.id}`, adm.logView(Number(row.id))).row();
    if (nextRows.length > 0) kb.text("»", adm.logsPage(1)).row();
    kb.text(t(lang, "admin.back"), adm.root);
    await ctx.editMessageText(lines.slice(0, 3500), {
      reply_markup: kb,
    });
  });

  bot.callbackQuery(/^adm:logs:(\d+)$/, async (ctx) => {
    if (!isPanelAdmin(ctx.from?.id)) return;
    const lang = await resolveAdminLang(ctx.from?.id, ctx.from?.language_code);
    const page = Number(ctx.match?.[1] ?? 0);
    await ctx.answerCallbackQuery();
    const rows = await listMessageLogs(LOG_PAGE, page * LOG_PAGE);
    const lines = rows.length
      ? rows
          .map((r) => `#${r.id} ${r.created_at.slice(0, 19)} [${r.direction}] tg:${r.telegram_user_id} ${r.update_type} ${r.text_preview.slice(0, 45)}`)
          .join("\n")
      : t(lang, "admin.logsEmpty");
    const nextRows = rows.length === LOG_PAGE ? await listMessageLogs(1, (page + 1) * LOG_PAGE) : [];
    const kb = new InlineKeyboard();
    for (const row of rows.slice(0, 6)) kb.text(`#${row.id}`, adm.logView(Number(row.id))).row();
    if (page > 0) kb.text("«", adm.logsPage(page - 1));
    if (nextRows.length > 0) kb.text("»", adm.logsPage(page + 1));
    if (page > 0 || nextRows.length > 0) kb.row();
    kb.text(t(lang, "admin.back"), adm.root);
    await ctx.editMessageText(lines.slice(0, 3500), {
      reply_markup: kb,
    });
  });

  bot.callbackQuery(/^adm:logv:(\d+)$/, async (ctx) => {
    if (!isPanelAdmin(ctx.from?.id)) return;
    const lang = await resolveAdminLang(ctx.from?.id, ctx.from?.language_code);
    const id = Number(ctx.match?.[1] ?? 0);
    await ctx.answerCallbackQuery();
    const row = await getMessageLogById(id);
    if (!row) {
      await ctx.reply(t(lang, "admin.logsEmpty"));
      return;
    }
    await ctx.reply(
      tf(lang, "admin.logDetail", {
        id: row.id,
        createdAt: row.created_at,
        direction: row.direction,
        telegramId: row.telegram_user_id,
        chatId: row.chat_id,
        messageId: row.message_id ?? "—",
        updateType: row.update_type,
        preview: row.text_preview || "—",
        payload: JSON.stringify(row.payload ?? {}, null, 2).slice(0, 1200),
      }),
      { reply_markup: new InlineKeyboard().text(t(lang, "admin.back"), adm.logs) }
    );
  });

  bot.callbackQuery(adm.logToggle, async (ctx) => {
    if (!isPanelAdmin(ctx.from?.id)) return;
    const lang = await resolveAdminLang(ctx.from?.id, ctx.from?.language_code);
    const cur = await getSystemSettingBool("message_logging_enabled", true);
    await setSystemSetting("message_logging_enabled", !cur);
    await ctx.answerCallbackQuery({
      text: t(lang, !cur ? "admin.logOn" : "admin.logOff"),
      show_alert: false,
    });
  });

  bot.callbackQuery(/^adm:ret:(\d+)$/, async (ctx) => {
    if (!isPanelAdmin(ctx.from?.id)) return;
    const lang = await resolveAdminLang(ctx.from?.id, ctx.from?.language_code);
    const h = Number(ctx.match?.[1]);
    await setSystemSetting("message_log_retention_hours", h);
    await ctx.answerCallbackQuery({ text: tf(lang, "admin.retSet", { h }), show_alert: false });
  });

  bot.callbackQuery(adm.logPurge, async (ctx) => {
    if (!isPanelAdmin(ctx.from?.id)) return;
    const lang = await resolveAdminLang(ctx.from?.id, ctx.from?.language_code);
    await ctx.answerCallbackQuery();
    await ctx.reply(t(lang, "admin.logPurgeConfirm"), {
      reply_markup: new InlineKeyboard()
        .text(t(lang, "delete.yes"), adm.logPurgeY)
        .text(t(lang, "delete.no"), adm.root),
    });
  });

  bot.callbackQuery(adm.logPurgeY, async (ctx) => {
    if (!isPanelAdmin(ctx.from?.id)) return;
    await ctx.answerCallbackQuery();
    await purgeAllMessageLogs();
    await ctx.reply(t(await resolveAdminLang(ctx.from?.id, ctx.from?.language_code), "admin.logPurgeDone"));
  });

  bot.callbackQuery(adm.cfg, async (ctx) => {
    if (!isPanelAdmin(ctx.from?.id)) return;
    const lang = await resolveAdminLang(ctx.from?.id, ctx.from?.language_code);
    await ctx.answerCallbackQuery();
    const cfgKb = new InlineKeyboard();
    for (let i = 0; i < CFG_SECTIONS.length; i++) {
      const section = CFG_SECTIONS[i]!;
      const cbMap: Record<string, string> = {
        start: adm.cfgStart,
        home_menu: adm.cfgHome,
        explorer_main: adm.cfgExplorerMain,
        explorer_more: adm.cfgExplorerMore,
        settings: adm.cfgSettings,
        stats: adm.cfgStats,
      };
      cfgKb.text(t(lang, `admin.cfgSection.${section}`), cbMap[section]!);
      if (i % 2 === 1) cfgKb.row();
    }
    cfgKb.row().text(t(lang, "admin.cfgReset"), adm.cfgReset).text(t(lang, "admin.back"), adm.root);
    await ctx.editMessageText(t(lang, "admin.cfgMenu"), { reply_markup: cfgKb });
  });

  bot.callbackQuery(adm.cfgReset, async (ctx) => {
    if (!isPanelAdmin(ctx.from?.id)) return;
    await ctx.answerCallbackQuery();
    await setBotConfigDocument(DEFAULT_BOT_CONFIG);
    invalidateBotConfigCache();
    await ctx.reply(t(await resolveAdminLang(ctx.from?.id, ctx.from?.language_code), "admin.cfgResetDone"));
  });

  const cfgWait = (section: string) => async (ctx: MyContext) => {
    if (!isPanelAdmin(ctx.from?.id)) return;
    const lang = await resolveAdminLang(ctx.from?.id, ctx.from?.language_code);
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
    if (!isPanelAdmin(ctx.from?.id)) return;
    const lang = await resolveAdminLang(ctx.from?.id, ctx.from?.language_code);
    await ctx.answerCallbackQuery();
    const kb = new InlineKeyboard();
    for (const key of BOT_MESSAGE_KEYS) {
      kb.text(t(lang, MSG_LABEL_KEY[key]), adm.msgPick(key)).row();
    }
    kb.text(t(lang, "admin.back"), adm.root);
    await ctx.editMessageText(t(lang, "admin.msgMenu"), { reply_markup: kb });
  });

  bot.callbackQuery(/^adm:msp:(.+)$/, async (ctx) => {
    if (!isPanelAdmin(ctx.from?.id)) return;
    const lang = await resolveAdminLang(ctx.from?.id, ctx.from?.language_code);
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
    if (!isPanelAdmin(ctx.from?.id)) return;
    const lang = await resolveAdminLang(ctx.from?.id, ctx.from?.language_code);
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
    if (!isPanelAdmin(ctx.from?.id)) return;
    const lang = await resolveAdminLang(ctx.from?.id, ctx.from?.language_code);
    await ctx.answerCallbackQuery();
    const u = await getUserByTelegramId(ctx.from!.id);
    if (!u) return;
    await setSession(u.id, { state: "admin_diamond_wait", payload: { mode: "grant" } });
    await ctx.reply(t(lang, "admin.diamondPrompt"));
  });

  bot.callbackQuery(adm.dimd, async (ctx) => {
    if (!isPanelAdmin(ctx.from?.id)) return;
    const lang = await resolveAdminLang(ctx.from?.id, ctx.from?.language_code);
    await ctx.answerCallbackQuery();
    const u = await getUserByTelegramId(ctx.from!.id);
    if (!u) return;
    await setSession(u.id, { state: "admin_diamond_wait", payload: { mode: "deduct" } });
    await ctx.reply(t(lang, "admin.diamondPrompt"));
  });

  bot.callbackQuery(/^adm:rnopes:(\d+)$/, async (ctx) => {
    if (!isPanelAdmin(ctx.from?.id)) return;
    const lang = await resolveAdminLang(ctx.from?.id, ctx.from?.language_code);
    const targetId = Number(ctx.match?.[1]);
    await ctx.answerCallbackQuery();
    await resetUserNopes(targetId);
    logger.info({ targetId, admin: ctx.from!.id }, "admin_reset_nopes");
    await ctx.reply(t(lang, "admin.nopesReset"));
  });

  bot.callbackQuery(/^adm:usrban:(\d+):(0|1)$/, async (ctx) => {
    if (!isPanelAdmin(ctx.from?.id)) return;
    const lang = await resolveAdminLang(ctx.from?.id, ctx.from?.language_code);
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

  bot.callbackQuery(adm.sendUser, async (ctx) => {
    if (!isPanelAdmin(ctx.from?.id)) return;
    const lang = await resolveAdminLang(ctx.from?.id, ctx.from?.language_code);
    await ctx.answerCallbackQuery();
    const u = await getUserByTelegramId(ctx.from!.id);
    if (!u) return;
    await setSession(u.id, { state: "admin_send_user", payload: { step: "await_telegram" } });
    await ctx.reply(t(lang, "admin.sendUserPromptTg"));
  });

  bot.callbackQuery(adm.rewardNew, async (ctx) => {
    if (!isPanelAdmin(ctx.from?.id)) return;
    const lang = await resolveAdminLang(ctx.from?.id, ctx.from?.language_code);
    await ctx.answerCallbackQuery();
    const u = await getUserByTelegramId(ctx.from!.id);
    if (!u) return;
    await setSession(u.id, { state: "admin_reward_meta", payload: {} });
    await ctx.reply(t(lang, "admin.rewardPrompt"));
  });

  bot.callbackQuery(adm.rewardList, async (ctx) => {
    if (!isPanelAdmin(ctx.from?.id)) return;
    const lang = await resolveAdminLang(ctx.from?.id, ctx.from?.language_code);
    await ctx.answerCallbackQuery();
    const rows = await listReferralFileRewards();
    if (rows.length === 0) {
      await ctx.reply(t(lang, "admin.rewardListEmpty"));
      return;
    }
    const kb = new InlineKeyboard();
    const lines = rows.map((r) => {
      kb.text(t(lang, "admin.rewardDelete"), adm.rewardDelete(r.id)).row();
      return tf(lang, "admin.rewardRow", {
        id: r.id,
        n: r.min_referrals,
        fa: r.caption_fa,
        en: r.caption_en,
      });
    });
    kb.text(t(lang, "admin.back"), adm.root);
    await ctx.reply(lines.join("\n\n"), { reply_markup: kb });
  });

  bot.callbackQuery(/^adm:rwd:(\d+)$/, async (ctx) => {
    if (!isPanelAdmin(ctx.from?.id)) return;
    const lang = await resolveAdminLang(ctx.from?.id, ctx.from?.language_code);
    const id = Number(ctx.match?.[1]);
    await ctx.answerCallbackQuery();
    await deleteReferralFileReward(id);
    await ctx.reply(tf(lang, "admin.rewardDeleted", { id }));
  });

  bot.callbackQuery(adm.referralCfg, async (ctx) => {
    if (!isPanelAdmin(ctx.from?.id)) return;
    const lang = await resolveAdminLang(ctx.from?.id, ctx.from?.language_code);
    await ctx.answerCallbackQuery();
    await ctx.editMessageText(await referralSettingsText(lang), {
      reply_markup: new InlineKeyboard()
        .text(t(lang, "admin.referralProfileReward"), adm.referralSet("diamond_reward_profile"))
        .text(t(lang, "admin.referralReferralReward"), adm.referralSet("diamond_reward_referral"))
        .row()
        .text(t(lang, "admin.referralVipThreshold"), adm.referralSet("referral_vip_threshold"))
        .text(t(lang, "admin.referralVerifyThreshold"), adm.referralSet("referral_badge_verify_threshold"))
        .row()
        .text(t(lang, "admin.back"), adm.root),
    });
  });

  bot.callbackQuery(/^adm:rws:(.+)$/, async (ctx) => {
    if (!isPanelAdmin(ctx.from?.id)) return;
    const lang = await resolveAdminLang(ctx.from?.id, ctx.from?.language_code);
    const key = String(ctx.match?.[1] ?? "");
    if (!REFERRAL_SETTING_KEYS.includes(key as ReferralSettingKey)) {
      await ctx.answerCallbackQuery();
      return;
    }
    await ctx.answerCallbackQuery();
    const u = await getUserByTelegramId(ctx.from!.id);
    if (!u) return;
    await setSession(u.id, { state: "admin_referral_setting_wait", payload: { key } });
    await ctx.reply(t(lang, "admin.referralSettingPrompt"));
  });

  bot.callbackQuery(adm.admins, async (ctx) => {
    if (!isPanelAdmin(ctx.from?.id)) return;
    const lang = await resolveAdminLang(ctx.from?.id, ctx.from?.language_code);
    await ctx.answerCallbackQuery();
    const ids = await listDynamicPanelAdminIds();
    await ctx.editMessageText(tf(lang, "admin.adminListBody", { ids: ids.length ? ids.join(", ") : "—" }), {
      reply_markup: new InlineKeyboard()
        .text(t(lang, "admin.adminAdd"), adm.adminAdd)
        .text(t(lang, "admin.adminRemove"), adm.adminRemove)
        .row()
        .text(t(lang, "admin.back"), adm.root),
    });
  });

  bot.callbackQuery(adm.adminAdd, async (ctx) => {
    if (!isPanelAdmin(ctx.from?.id)) return;
    const lang = await resolveAdminLang(ctx.from?.id, ctx.from?.language_code);
    await ctx.answerCallbackQuery();
    const u = await getUserByTelegramId(ctx.from!.id);
    if (!u) return;
    await setSession(u.id, { state: "admin_admin_add", payload: {} });
    await ctx.reply(t(lang, "admin.adminPrompt"));
  });

  bot.callbackQuery(adm.adminRemove, async (ctx) => {
    if (!isPanelAdmin(ctx.from?.id)) return;
    const lang = await resolveAdminLang(ctx.from?.id, ctx.from?.language_code);
    await ctx.answerCallbackQuery();
    const u = await getUserByTelegramId(ctx.from!.id);
    if (!u) return;
    await setSession(u.id, { state: "admin_admin_remove", payload: {} });
    await ctx.reply(t(lang, "admin.adminPrompt"));
  });

  bot.callbackQuery(adm.botToggle, async (ctx) => {
    if (!isPanelAdmin(ctx.from?.id)) return;
    const lang = await resolveAdminLang(ctx.from?.id, ctx.from?.language_code);
    const cur = await getSystemSettingBool("bot_enabled", true);
    await setSystemSetting("bot_enabled", !cur);
    await ctx.answerCallbackQuery({
      text: !cur ? t(lang, "admin.botEnabled") : t(lang, "admin.botDisabled"),
      show_alert: false,
    });
  });

  bot.callbackQuery(adm.joins, async (ctx) => {
    if (!isPanelAdmin(ctx.from?.id)) return;
    const lang = await resolveAdminLang(ctx.from?.id, ctx.from?.language_code);
    await ctx.answerCallbackQuery();
    await ctx.editMessageText(await joinLocksText(lang), {
      reply_markup: new InlineKeyboard()
        .text(t(lang, "admin.joinLocksAdd"), adm.joinAdd)
        .text(t(lang, "admin.joinLocksClear"), adm.joinClear)
        .row()
        .text(t(lang, "admin.back"), adm.root),
    });
  });

  bot.callbackQuery(adm.joinAdd, async (ctx) => {
    if (!isPanelAdmin(ctx.from?.id)) return;
    const lang = await resolveAdminLang(ctx.from?.id, ctx.from?.language_code);
    await ctx.answerCallbackQuery();
    const u = await getUserByTelegramId(ctx.from!.id);
    if (!u) return;
    await setSession(u.id, { state: "admin_join_lock_add", payload: {} });
    await ctx.reply(t(lang, "admin.joinLocksPrompt"));
  });

  bot.callbackQuery(adm.joinClear, async (ctx) => {
    if (!isPanelAdmin(ctx.from?.id)) return;
    const lang = await resolveAdminLang(ctx.from?.id, ctx.from?.language_code);
    await ctx.answerCallbackQuery();
    await setSystemSetting("must_join_channels", []);
    await ctx.reply(await joinLocksText(lang));
  });

  bot.callbackQuery(adm.startNotify, async (ctx) => {
    if (!isPanelAdmin(ctx.from?.id)) return;
    const lang = await resolveAdminLang(ctx.from?.id, ctx.from?.language_code);
    await ctx.answerCallbackQuery();
    const enabled = await isStartNotifyEnabled();
    const groupId = await getStartNotifyGroupRef();
    const status = enabled ? t(lang, "admin.startNotifyEnabled") : t(lang, "admin.startNotifyDisabled");
    const group = groupId != null ? String(groupId) : "—";
    await ctx.editMessageText(tf(lang, "admin.startNotifyCurrent", { status, group }), {
      reply_markup: new InlineKeyboard()
        .text(t(lang, "admin.startNotifyToggle"), adm.startNotifyToggle)
        .text(t(lang, "admin.startNotifySetGroup"), adm.startNotifySet)
        .row()
        .text(t(lang, "admin.back"), adm.root),
    });
  });

  bot.callbackQuery(adm.startNotifyToggle, async (ctx) => {
    if (!isPanelAdmin(ctx.from?.id)) return;
    const lang = await resolveAdminLang(ctx.from?.id, ctx.from?.language_code);
    const cur = await isStartNotifyEnabled();
    await setSystemSetting("start_notify_enabled", !cur);
    await ctx.answerCallbackQuery({
      text: !cur ? t(lang, "admin.startNotifyEnabled") : t(lang, "admin.startNotifyDisabled"),
      show_alert: false,
    });
  });

  bot.callbackQuery(adm.startNotifySet, async (ctx) => {
    if (!isPanelAdmin(ctx.from?.id)) return;
    const lang = await resolveAdminLang(ctx.from?.id, ctx.from?.language_code);
    await ctx.answerCallbackQuery();
    const u = await getUserByTelegramId(ctx.from!.id);
    if (!u) return;
    await setSession(u.id, { state: "admin_start_notify_setup", payload: {} });
    await ctx.reply(t(lang, "admin.startNotifySetPrompt"));
  });

  bot.callbackQuery(/^adm:ubv:(\d+):(0|1)$/, async (ctx) => {
    if (!isPanelAdmin(ctx.from?.id)) return;
    const lang = await resolveAdminLang(ctx.from?.id, ctx.from?.language_code);
    const userId = Number(ctx.match?.[1]);
    const enabled = ctx.match?.[2] === "1";
    await updateUserBadges({ userId, verified: enabled });
    await ctx.answerCallbackQuery({
      text: enabled ? t(lang, "admin.badgeVerifiedOn") : t(lang, "admin.badgeVerifiedOff"),
      show_alert: false,
    });
  });

  bot.callbackQuery(/^adm:ubp:(\d+):(0|1)$/, async (ctx) => {
    if (!isPanelAdmin(ctx.from?.id)) return;
    const lang = await resolveAdminLang(ctx.from?.id, ctx.from?.language_code);
    const userId = Number(ctx.match?.[1]);
    const enabled = ctx.match?.[2] === "1";
    await updateUserBadges({ userId, vip: enabled });
    await ctx.answerCallbackQuery({
      text: enabled ? t(lang, "admin.badgeVipOn") : t(lang, "admin.badgeVipOff"),
      show_alert: false,
    });
  });
}
