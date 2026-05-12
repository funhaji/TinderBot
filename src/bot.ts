import { Bot, InlineKeyboard } from "grammy";
import { setupAdmin, tryHandleAdminFollowupMessage } from "./admin/panel.js";
import { ensureBotConfigSeeded, getBotConfig, labelForLang } from "./config/botContent.js";
import type { HomeMenuAction } from "./config/botContent.js";
import { config } from "./config.js";
import { formatDiscoverCaption, explorerMarkup, registerExplorerCallbacks } from "./features/explorer.js";
import { buildHomeReplyKeyboard, matchHomeAction } from "./features/replyKeyboard.js";
import { logger } from "./logger.js";
import type { Language, LookingFor, MyContext, SessionState } from "./types.js";
import { t, tf } from "./i18n/index.js";
import { formatNowFooter } from "./util/dateFa.js";
import {
  cb,
  langKeyboard,
  seekGenderKeyboard,
  settingsKeyboardFull,
  settingsLangPickKb,
  wizardGenderKeyboard,
  wizardLookingForKeyboard,
  wizardSeekKeyboard,
} from "./ui/keyboards.js";
import {
  addPermanentHide,
  adjustDiamondBalance,
  blockUser,
  createFaceSubmission,
  createReport,
  deleteUser,
  discoveryCandidates,
  ensureMatch,
  ensureSessionRow,
  extendedUserStats,
  getPrimaryPhoto,
  getProfile,
  getSession,
  getTelegramIdByUserId,
  getUserById,
  getUserByTelegramId,
  getUserInterestKeys,
  hasLiked,
  hasMatchBetween,
  insertMessageLog,
  insertProfileImpression,
  listInterests,
  listLikersNotMatched,
  listMatchesFor,
  listTelegramIdsForBroadcast,
  markReferralBonusPaid,
  mergeProfilePreferences,
  replacePhotos,
  resetSession,
  setLanguage,
  setProfileVisibility,
  setSession,
  setUserInterests,
  swipe,
  upsertProfile,
  upsertUser,
  getSystemSettingNumber,
} from "./db/repo.js";

function langFromDb(v: unknown): Language {
  return v === "fa" ? "fa" : "en";
}

async function getLang(ctx: MyContext): Promise<Language> {
  const tgId = ctx.from?.id;
  if (!tgId) return "en";
  const u = await getUserByTelegramId(tgId);
  return langFromDb(u?.language ?? "en");
}

function parseStartArgs(text: string | undefined): {
  ref?: number;
  matchOther?: number;
} {
  const parts = (text ?? "").trim().split(/\s+/);
  const arg = parts[1];
  const out: { ref?: number; matchOther?: number } = {};
  if (arg?.startsWith("ref_")) {
    const id = Number(arg.slice(4));
    if (Number.isFinite(id) && id > 0) out.ref = id;
  }
  if (arg?.startsWith("match_")) {
    const id = Number(arg.slice(6));
    if (Number.isFinite(id) && id > 0) out.matchOther = id;
  }
  return out;
}

async function ensureDbUser(ctx: MyContext, referredBy?: number | null) {
  if (!ctx.from) return null;
  const u = await upsertUser({
    telegramId: ctx.from.id,
    username: ctx.from.username ?? null,
    referredBy: referredBy ?? undefined,
  });
  await ensureSessionRow(u.id);
  return u;
}

function parseIntStrict(s: string): number | null {
  const n = Number(s.trim());
  if (!Number.isFinite(n)) return null;
  if (!Number.isInteger(n)) return null;
  return n;
}

function effectiveDiscoveryRadiusMeters(profile: Awaited<ReturnType<typeof getProfile>>): number {
  if (!profile) return config.DISCOVERY_RADIUS_METERS;
  const custom = profile.preferences.discovery_radius_m;
  const cap = config.DISCOVERY_RADIUS_METERS;
  if (typeof custom === "number" && custom > 0) return Math.min(custom, cap);
  return cap;
}

async function sendMainMenuReply(ctx: MyContext) {
  const u = await ensureDbUser(ctx);
  if (!u) return;
  await ensureBotConfigSeeded();
  const cfg = await getBotConfig();
  const lang = await getLang(ctx);
  await ctx.reply(labelForLang(cfg.start, lang), { reply_markup: buildHomeReplyKeyboard(cfg, lang) });
}

async function settingsReplyMarkup(ctx: MyContext) {
  const lang = await getLang(ctx);
  const u = await ensureDbUser(ctx);
  if (!u) return new InlineKeyboard();
  const cfg = await getBotConfig();
  const p = await getProfile(u.id);
  return settingsKeyboardFull(cfg, lang, p?.preferences ?? {});
}

async function showHome(ctx: MyContext) {
  await sendMainMenuReply(ctx);
}

async function startProfileWizard(ctx: MyContext, userId: number) {
  const s: SessionState = {
    state: "profile_wizard",
    payload: { step: "name", draft: {} },
  };
  await setSession(userId, s);
  const lang = await getLang(ctx);
  await ctx.reply(t(lang, "profile.ask.name"));
}

async function renderMyProfile(ctx: MyContext, userId: number) {
  const lang = await getLang(ctx);
  const p = await getProfile(userId);
  if (!p) {
    await ctx.reply(t(lang, "profile.need"));
    await startProfileWizard(ctx, userId);
    return;
  }
  const photoId = await getPrimaryPhoto(userId);
  const interestKeys = await getUserInterestKeys(userId);
  const interestsAll = await listInterests();
  const interestLabels = interestKeys
    .map((k) => interestsAll.find((i) => i.key === k))
    .filter(Boolean)
    .map((i: { fa_label: string; en_label: string }) =>
      lang === "fa" ? i.fa_label : i.en_label
    );

  const caption = [
    `(${p.age}) ${p.display_name}`,
    `${p.city}`,
    interestLabels.length ? interestLabels.join(" • ") : "",
    p.bio ? `\n${p.bio}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  const kb = new InlineKeyboard()
    .text(t(lang, "profile.edit"), cb.profile)
    .row()
    .text(t(lang, "home.discover"), cb.discover)
    .text(t(lang, "home.matches"), cb.matches);

  if (photoId) {
    await ctx.replyWithPhoto(photoId, { caption, reply_markup: kb });
  } else {
    await ctx.reply(caption, { reply_markup: kb });
  }
}

async function dispatchHomeAction(
  ctx: MyContext,
  u: NonNullable<Awaited<ReturnType<typeof ensureDbUser>>>,
  action: HomeMenuAction
) {
  const cfg = await getBotConfig();
  const lang = await getLang(ctx);
  const toast = labelForLang(cfg.placeholder_toast, lang);
  switch (action) {
    case "profile":
      await renderMyProfile(ctx, u.id);
      break;
    case "explore":
      await discoverStart(ctx, u.id);
      break;
    case "settings":
      await ctx.reply(labelForLang(cfg.settings.title, lang), {
        reply_markup: await settingsReplyMarkup(ctx),
      });
      break;
    case "stats":
      await showStats(ctx, u.id);
      break;
    case "share": {
      const me = await ctx.api.getMe();
      if (me.username) {
        await ctx.reply(`${t(lang, "share.text")}\nhttps://t.me/${me.username}?start=ref_${u.id}`);
      } else await ctx.reply(t(lang, "share.noUsername"));
      break;
    }
    case "matches":
      await showMatches(ctx, u.id);
      break;
    case "verify_face":
      await setSession(u.id, { state: "face_verify_wait", payload: {} });
      await ctx.reply(t(lang, "face.askPhoto"), {
        reply_markup: new InlineKeyboard().text(lang === "fa" ? "انصراف ❌" : "Cancel ❌", "face:cancel"),
      });
      break;
    case "placeholder":
    default:
      await ctx.reply(toast);
  }
}

async function discoverStart(ctx: MyContext, userId: number) {
  const lang = await getLang(ctx);
  await ctx.api.sendChatAction(ctx.chat!.id, "typing").catch(() => {});
  const p = await getProfile(userId);
  if (!p) {
    await ctx.reply(t(lang, "profile.need"));
    await startProfileWizard(ctx, userId);
    return;
  }

  const radius = effectiveDiscoveryRadiusMeters(p);
  const candidates = await discoveryCandidates({
    meId: userId,
    lat: p.location_lat,
    lon: p.location_lon,
    radiusMeters: radius,
    limit: config.DISCOVERY_BATCH_SIZE,
  });

  if (candidates.length === 0) {
    await ctx.reply(t(lang, "discover.noCandidates"));
    return;
  }

  await setSession(userId, {
    state: "discover",
    payload: { candidates, idx: 0, sub: "main" },
  });
  await renderDiscoverCard(ctx, userId);
}

async function renderDiscoverCard(ctx: MyContext, userId: number) {
  const lang = await getLang(ctx);
  const s = await getSession(userId);
  if (s.state !== "discover") return;
  const sub = s.payload.sub ?? "main";
  const { candidates, idx, cardMessageId } = s.payload;
  const targetId = candidates[idx];
  if (!targetId) {
    await resetSession(userId);
    await ctx.reply(t(lang, "discover.noCandidates"));
    return;
  }

  const p = await getProfile(targetId);
  if (!p) {
    await setSession(userId, {
      state: "discover",
      payload: { ...s.payload, idx: idx + 1, sub: "main" },
    });
    return renderDiscoverCard(ctx, userId);
  }

  const me = await getProfile(userId);
  if (!me) return;

  await insertProfileImpression(userId, targetId);

  const cfg = await getBotConfig();
  const caption = formatDiscoverCaption({ lang, target: p, viewer: me });
  const markup = explorerMarkup(cfg, lang, sub);

  const photoId = await getPrimaryPhoto(targetId);

  if (!cardMessageId) {
    if (photoId) {
      const msg = await ctx.replyWithPhoto(photoId, { caption, reply_markup: markup });
      await setSession(userId, {
        state: "discover",
        payload: { ...s.payload, cardMessageId: msg.message_id, sub },
      });
    } else {
      const msg = await ctx.reply(caption, { reply_markup: markup });
      await setSession(userId, {
        state: "discover",
        payload: { ...s.payload, cardMessageId: msg.message_id, sub },
      });
    }
    return;
  }

  try {
    if (photoId) {
      await ctx.api.editMessageMedia(
        ctx.chat!.id,
        cardMessageId,
        {
          type: "photo",
          media: photoId,
          caption,
        },
        { reply_markup: markup }
      );
    } else {
      await ctx.api.editMessageText(ctx.chat!.id, cardMessageId, caption, { reply_markup: markup });
    }
  } catch (err) {
    logger.warn({ err }, "card_edit_fail");
    const msg = photoId
      ? await ctx.replyWithPhoto(photoId, { caption, reply_markup: markup })
      : await ctx.reply(caption, { reply_markup: markup });
    await setSession(userId, {
      state: "discover",
      payload: { ...s.payload, cardMessageId: msg.message_id, sub },
    });
  }
}

async function notifyMatch(ctx: MyContext, swiperId: number, targetId: number) {
  const targetP = await getProfile(targetId);
  const swiperP = await getProfile(swiperId);
  const targetUser = await getUserById(targetId);
  const swiperUser = await getUserById(swiperId);
  const targetLang = langFromDb(targetUser?.language);
  const swiperLang = langFromDb(swiperUser?.language);
  if (targetP?.preferences.notify_match !== false) {
    const otherTg = await getTelegramIdByUserId(targetId);
    if (otherTg) await ctx.api.sendMessage(otherTg, t(targetLang, "match.notify")).catch(() => {});
  }
  if (swiperP?.preferences.notify_match !== false) {
    await ctx.reply(t(swiperLang, "match.notify"));
  }
}

async function canPostLike(swiperUserId: number, targetId: number): Promise<boolean> {
  const targetP = await getProfile(targetId);
  const swiperRow = await getUserById(swiperUserId);
  if (targetP?.preferences.only_verified_can_like_me && swiperRow?.face_verification_status !== "approved") {
    return false;
  }
  return true;
}

async function handleSwipe(ctx: MyContext, direction: 1 | 2) {
  const u = await ensureDbUser(ctx);
  if (!u) return;
  const s = await getSession(u.id);
  if (s.state !== "discover") return;
  const targetId = s.payload.candidates[s.payload.idx];
  if (!targetId) return;

  if (direction === 1) {
    const ok = await canPostLike(u.id, targetId);
    if (!ok) return;
  }

  await swipe({ swiperId: u.id, targetId, direction });

  if (direction === 1) {
    const tp = await getProfile(targetId);
    if (tp?.preferences.notify_like !== false) {
      const likeTg = await getTelegramIdByUserId(targetId);
      if (likeTg) {
        const myP = await getProfile(u.id);
        const targetUser = await getUserById(targetId);
        const tl = langFromDb(targetUser?.language ?? "en");
        await ctx.api
          .sendMessage(likeTg, `${myP?.display_name ?? (tl === "fa" ? "یک نفر" : "Someone")} ❤️`)
          .catch(() => {});
      }
    }
    const mutual = await hasLiked(targetId, u.id);
    if (mutual) {
      const created = await ensureMatch(u.id, targetId);
      if (created) {
        await notifyMatch(ctx, u.id, targetId);
      }
    }
  }

  await setSession(u.id, {
    state: "discover",
    payload: { ...s.payload, idx: s.payload.idx + 1, sub: "main" },
  });
  await renderDiscoverCard(ctx, u.id);
}

async function showMatches(ctx: MyContext, userId: number) {
  const lang = await getLang(ctx);
  await ctx.api.sendChatAction(ctx.chat!.id, "typing").catch(() => {});
  const matches = await listMatchesFor(userId);
  if (matches.length === 0) {
    await ctx.reply(t(lang, "matches.none"));
    return;
  }
  const kb = new InlineKeyboard();
  for (const m of matches.slice(0, 20)) {
    const p = await getProfile(m.other_id);
    const label = p ? `${p.display_name} (${p.age})` : `User ${m.other_id}`;
    kb.text(label, cb.matchChat(m.other_id)).row();
  }
  await ctx.reply(t(lang, "matches.title"), { reply_markup: kb });
}

async function showStats(ctx: MyContext, userId: number) {
  const lang = await getLang(ctx);
  await ctx.api.sendChatAction(ctx.chat!.id, "typing").catch(() => {});
  const ex = await extendedUserStats(userId);
  const cfg = await getBotConfig();
  const footer = formatNowFooter(lang);
  const lines = [
    labelForLang(cfg.stats.title, lang),
    `${t(lang, "stats.impressionsOut")}: ${ex.impressionsOut}`,
    `${t(lang, "stats.impressionsIn")}: ${ex.impressionsIn}`,
    `${t(lang, "stats.likesSent")}: ${ex.likesSent}`,
    `${t(lang, "stats.likesReceived")}: ${ex.likesReceived}`,
    `${t(lang, "stats.matches")}: ${ex.matches}`,
    `${t(lang, "stats.pickiness")}: ${ex.pickinessPct}%`,
    `${t(lang, "stats.attractiveness")}: ${ex.attractivenessPct}%`,
    `${t(lang, "stats.diamonds")}: ${ex.diamonds}`,
    labelForLang(cfg.stats.tip, lang),
    footer,
  ];
  const kb = new InlineKeyboard()
    .text(labelForLang(cfg.stats.extra_profile, lang), "stat:extra")
    .row()
    .text(labelForLang(cfg.stats.view_profile, lang), cb.profile);
  await ctx.reply(lines.join("\n"), { reply_markup: kb });
}

async function showLikers(ctx: MyContext, userId: number) {
  const lang = await getLang(ctx);
  await ctx.api.sendChatAction(ctx.chat!.id, "typing").catch(() => {});
  const ids = await listLikersNotMatched(userId);
  if (ids.length === 0) {
    await ctx.reply(t(lang, "likers.none"));
    return;
  }
  const kb = new InlineKeyboard();
  for (const id of ids.slice(0, 15)) {
    const p = await getProfile(id);
    const label = p ? `${p.display_name} (${p.age})` : `User ${id}`;
    kb.text(label, cb.likerLikeBack(id)).row();
  }
  await ctx.reply(t(lang, "likers.title"), { reply_markup: kb });
}

async function setupUx(bot: Bot<MyContext>) {
  await bot.api.setMyCommands(
    [
      { command: "start", description: "Menu / language" },
      { command: "profile", description: "My profile" },
      { command: "discover", description: "Discover people" },
      { command: "matches", description: "Your matches" },
      { command: "exit", description: "Leave match chat" },
      { command: "block", description: "Block current chat partner" },
      { command: "help", description: "Help" },
      { command: "admin", description: "Admin panel" },
    ],
    { scope: { type: "default" } }
  );
  await bot.api.setChatMenuButton({ menu_button: { type: "commands" } });
}

async function assertDiscoverContext(ctx: MyContext) {
  const u = await ensureDbUser(ctx);
  if (!u) return null;
  const s = await getSession(u.id);
  if (s.state !== "discover") return null;
  const targetId = s.payload.candidates[s.payload.idx];
  if (!targetId) return null;
  const lang = await getLang(ctx);
  return { u, s, targetId, lang };
}

export async function createBot() {
  await ensureBotConfigSeeded();
  const bot = new Bot<MyContext>(config.BOT_TOKEN);

  bot.api.config.use(async (prev, method, payload, signal) => {
    try {
      return await prev(method, payload, signal);
    } catch (err: unknown) {
      const anyErr = err as { parameters?: { retry_after?: number }; retry_after?: number };
      const retryAfter = anyErr?.parameters?.retry_after ?? anyErr?.retry_after;
      if (typeof retryAfter === "number") {
        const ms = Math.min(60_000, Math.max(250, retryAfter * 1000));
        logger.warn({ method, ms }, "rate_limit_retry");
        await new Promise((r) => setTimeout(r, ms));
        return await prev(method, payload, signal);
      }
      throw err;
    }
  });

  bot.catch((err) => {
    logger.error({ update_id: err.ctx?.update?.update_id, err: err.error }, "bot_error");
  });

  bot.use(async (ctx, next) => {
    if (ctx.chat?.type !== "private") return next();
    const tg = ctx.from?.id;
    if (!tg) return next();
    const u = await getUserByTelegramId(tg);
    if (u?.is_banned) {
      const lang = ctx.from?.language_code?.startsWith("fa") ? "fa" : "en";
      await ctx.reply(t(lang, "settings.banned"));
      return;
    }
    return next();
  });

  bot.use(async (ctx, next) => {
    if (!ctx.message || ctx.chat?.type !== "private" || !ctx.from) return next();
    const u = await getUserByTelegramId(ctx.from.id);
    const m = ctx.message;
    const text =
      ("text" in m && m.text) || ("caption" in m && m.caption && String(m.caption)) || "";
    const pre =
      text.trim().slice(0, 512) ||
      ("photo" in m && m.photo?.length ? "[photo]" : "[media]");
    try {
      await insertMessageLog({
        direction: "in",
        userId: u?.id ?? null,
        telegramUserId: ctx.from.id,
        chatId: ctx.chat!.id,
        messageId: m.message_id,
        updateType: "message",
        textPreview: pre,
        payload: { hasPhoto: !!(m as { photo?: unknown }).photo },
      });
    } catch {
      /* ignore log failures */
    }
    return next();
  });

  bot.use(async (ctx, next) => {
    if (!ctx.from || !config.adminTelegramIdSet.has(ctx.from.id)) return next();
    if (!ctx.message) return next();
    const u = await getUserByTelegramId(ctx.from.id);
    if (!u) return next();
    const s = await getSession(u.id);
    const lang = adminLangFromCtx(ctx);

    if (s.state === "admin_broadcast") {
      const txt = ctx.message.text?.trim();
      if (txt === "/cancel") {
        await resetSession(u.id);
        await ctx.reply(t(lang, "admin.broadcastCancelled"));
        return;
      }
      const ids = await listTelegramIdsForBroadcast();
      let ok = 0;
      let fail = 0;
      const fromChat = ctx.chat!.id;
      const mid = ctx.message.message_id;
      for (const tid of ids) {
        if (tid === ctx.from!.id) {
          ok++;
          continue;
        }
        try {
          await ctx.api.copyMessage(tid, fromChat, mid);
          ok++;
        } catch {
          fail++;
        }
        await new Promise((r) => setTimeout(r, 45));
      }
      await resetSession(u.id);
      await ctx.reply(tf(lang, "admin.broadcastDone", { ok, fail }));
      return;
    }

    if (s.state === "admin_find") {
      const txt = ctx.message.text?.trim();
      if (txt === "/cancel") {
        await resetSession(u.id);
        await ctx.reply(t(lang, "admin.broadcastCancelled"));
        return;
      }
      const n = Number(txt);
      if (!Number.isFinite(n) || !Number.isInteger(n)) {
        await ctx.reply(t(lang, "admin.findInvalid"));
        return;
      }
      const target = await getUserByTelegramId(n);
      await resetSession(u.id);
      if (!target) {
        await ctx.reply(t(lang, "admin.userNotFound"));
        return;
      }
      await ctx.reply(
        tf(lang, "admin.userLine", {
          id: target.id,
          tg: target.telegram_id,
          username: target.username ?? "—",
          banned: target.is_banned ? "yes" : "no",
        })
      );
      return;
    }

    if (await tryHandleAdminFollowupMessage(ctx, u, s, lang)) return;

    return next();
  });

  bot.use(async (ctx, next) => {
    if (!ctx.message || ctx.chat?.type !== "private") return next();
    const u = await ensureDbUser(ctx);
    if (!u) return next();
    const s = await getSession(u.id);
    if (
      s.state === "admin_broadcast" ||
      s.state === "admin_find" ||
      s.state === "admin_config_wait" ||
      s.state === "admin_diamond_wait"
    )
      return next();
    if (s.state !== "chat") return next();
    const txt = ctx.message.text;
    if (txt?.startsWith("/")) return next();
    const otherTg = await getTelegramIdByUserId(s.payload.withUserId);
    if (otherTg) {
      try {
        await ctx.api.copyMessage(otherTg, ctx.chat!.id, ctx.message.message_id);
      } catch {
        const lang = await getLang(ctx);
        await ctx.reply(t(lang, "chat.unsupported"));
      }
    }
  });

  bot.command("start", async (ctx) => {
    const args = parseStartArgs(ctx.message?.text);
    const u = await ensureDbUser(ctx, args.ref ?? null);
    if (!u) return;
    let lang = langFromDb(u.language);

    if (args.matchOther != null) {
      const ok = await hasMatchBetween(u.id, args.matchOther);
      if (ok) {
        await setSession(u.id, { state: "chat", payload: { withUserId: args.matchOther } });
        await ctx.reply(t(lang, "chat.start"));
        return;
      }
      await ctx.reply(t(lang, "matches.invalid"));
    }

    const p = await getProfile(u.id);
    if (p) {
      await sendMainMenuReply(ctx);
      return;
    }
    await ensureBotConfigSeeded();
    const cfg = await getBotConfig();
    await ctx.reply(labelForLang(cfg.start_no_profile ?? cfg.start, lang), { reply_markup: langKeyboard() });
    return;
  });

  bot.command("profile", async (ctx) => {
    const u = await ensureDbUser(ctx);
    if (!u) return;
    await renderMyProfile(ctx, u.id);
  });

  bot.command("discover", async (ctx) => {
    const u = await ensureDbUser(ctx);
    if (!u) return;
    await discoverStart(ctx, u.id);
  });

  bot.command("matches", async (ctx) => {
    const u = await ensureDbUser(ctx);
    if (!u) return;
    await showMatches(ctx, u.id);
  });

  bot.command("exit", async (ctx) => {
    const u = await ensureDbUser(ctx);
    if (!u) return;
    const s = await getSession(u.id);
    if (s.state === "chat") {
      await resetSession(u.id);
      const lang = await getLang(ctx);
      await ctx.reply(t(lang, "chat.exit"));
    }
  });

  bot.command("block", async (ctx) => {
    const u = await ensureDbUser(ctx);
    if (!u) return;
    const s = await getSession(u.id);
    const lang = await getLang(ctx);
    if (s.state !== "chat") return;
    await blockUser(u.id, s.payload.withUserId);
    await resetSession(u.id);
    await ctx.reply(t(lang, "chat.blocked"));
  });

  bot.command("cancel", async (ctx) => {
    const u = await ensureDbUser(ctx);
    if (!u) return;
    const s = await getSession(u.id);
    const lang = await getLang(ctx);
    if (
      s.state === "admin_broadcast" ||
      s.state === "admin_find" ||
      s.state === "admin_config_wait" ||
      s.state === "admin_diamond_wait"
    ) {
      await resetSession(u.id);
      await ctx.reply(t(lang, "admin.broadcastCancelled"));
    }
  });

  bot.callbackQuery(/^lang:(fa|en)$/, async (ctx) => {
    const u = await ensureDbUser(ctx);
    if (!u) return;
    const lang = (ctx.match?.[1] as Language) ?? "en";
    await setLanguage(u.id, lang);
    await ctx.answerCallbackQuery();
    const p = await getProfile(u.id);
    await ensureBotConfigSeeded();
    const cfg = await getBotConfig();
    try {
      await ctx.deleteMessage();
    } catch {
      /* ignore */
    }
    if (p) {
      await sendMainMenuReply(ctx);
      return;
    }
    await ctx.reply(labelForLang(cfg.start_no_profile ?? cfg.start, lang));
    await startProfileWizard(ctx, u.id);
  });

  bot.callbackQuery(/^slang:(fa|en)$/, async (ctx) => {
    const u = await ensureDbUser(ctx);
    if (!u) return;
    const lang = (ctx.match?.[1] as Language) ?? "en";
    await setLanguage(u.id, lang);
    await ctx.answerCallbackQuery();
    const cfg = await getBotConfig();
    await ctx.editMessageText(labelForLang(cfg.settings.title, lang), {
      reply_markup: await settingsReplyMarkup(ctx),
    });
  });

  bot.callbackQuery(cb.settings, async (ctx) => {
    const u = await ensureDbUser(ctx);
    if (!u) return;
    await ctx.answerCallbackQuery();
    const cfg = await getBotConfig();
    const lang = await getLang(ctx);
    await ctx.editMessageText(labelForLang(cfg.settings.title, lang), {
      reply_markup: await settingsReplyMarkup(ctx),
    });
  });

  bot.callbackQuery(cb.settingsLang, async (ctx) => {
    const lang = await getLang(ctx);
    await ctx.answerCallbackQuery();
    await ctx.editMessageText(t(lang, "lang.choose"), {
      reply_markup: settingsLangPickKb(),
    });
  });

  bot.callbackQuery(cb.settingsVis, async (ctx) => {
    const u = await ensureDbUser(ctx);
    if (!u) return;
    const lang = await getLang(ctx);
    const cfg = await getBotConfig();
    const p = await getProfile(u.id);
    const nextVis = !(p?.visibility ?? true);
    await setProfileVisibility(u.id, nextVis);
    await ctx.answerCallbackQuery({
      text: nextVis ? t(lang, "settings.visibility.on") : t(lang, "settings.visibility.off"),
      show_alert: false,
    });
    await ctx.editMessageText(labelForLang(cfg.settings.title, lang), {
      reply_markup: await settingsReplyMarkup(ctx),
    });
  });

  bot.callbackQuery(/^set:rad:(\d+)$/, async (ctx) => {
    const u = await ensureDbUser(ctx);
    if (!u) return;
    const m = Number(ctx.match?.[1]);
    await mergeProfilePreferences(u.id, { discovery_radius_m: m });
    const lang = await getLang(ctx);
    const cfg = await getBotConfig();
    await ctx.answerCallbackQuery({ text: t(lang, "settings.radiusSet") });
    await ctx.editMessageText(labelForLang(cfg.settings.title, lang), {
      reply_markup: await settingsReplyMarkup(ctx),
    });
  });

  bot.callbackQuery(cb.settingsSeekPick, async (ctx) => {
    const u = await ensureDbUser(ctx);
    if (!u) return;
    const lang = await getLang(ctx);
    const p = await getProfile(u.id);
    const sel = new Set(p?.preferences?.seek_genders ?? []);
    await ctx.answerCallbackQuery();
    await ctx.editMessageText(t(lang, "settings.seekPrompt"), {
      reply_markup: seekGenderKeyboard(lang, sel),
    });
  });

  bot.callbackQuery(/^seek:(m|f|x)$/, async (ctx) => {
    const u = await ensureDbUser(ctx);
    if (!u) return;
    const g = ctx.match?.[1] ?? "";
    const p = await getProfile(u.id);
    const cur = new Set(p?.preferences?.seek_genders ?? []);
    if (cur.has(g)) cur.delete(g);
    else cur.add(g);
    await mergeProfilePreferences(u.id, { seek_genders: Array.from(cur) });
    const lang = await getLang(ctx);
    await ctx.answerCallbackQuery();
    await ctx.editMessageReplyMarkup({
      reply_markup: seekGenderKeyboard(lang, cur),
    });
  });

  bot.callbackQuery(cb.seekDone, async (ctx) => {
    const u = await ensureDbUser(ctx);
    if (!u) return;
    const lang = await getLang(ctx);
    const cfg = await getBotConfig();
    await ctx.answerCallbackQuery();
    await ctx.editMessageText(labelForLang(cfg.settings.title, lang), {
      reply_markup: await settingsReplyMarkup(ctx),
    });
  });

  bot.callbackQuery(cb.settingsHome, async (ctx) => {
    const u = await ensureDbUser(ctx);
    if (!u) return;
    await ctx.answerCallbackQuery();
    await sendMainMenuReply(ctx);
  });

  bot.callbackQuery(cb.discover, async (ctx) => {
    const u = await ensureDbUser(ctx);
    if (!u) return;
    await ctx.answerCallbackQuery();
    await discoverStart(ctx, u.id);
  });

  bot.callbackQuery(cb.matches, async (ctx) => {
    const u = await ensureDbUser(ctx);
    if (!u) return;
    await ctx.answerCallbackQuery();
    await showMatches(ctx, u.id);
  });

  bot.callbackQuery(cb.likes, async (ctx) => {
    const u = await ensureDbUser(ctx);
    if (!u) return;
    await ctx.answerCallbackQuery();
    await showLikers(ctx, u.id);
  });

  bot.callbackQuery(cb.share, async (ctx) => {
    const u = await ensureDbUser(ctx);
    if (!u) return;
    const lang = await getLang(ctx);
    await ctx.answerCallbackQuery();
    const me = await ctx.api.getMe();
    const un = me.username;
    if (!un) {
      await ctx.reply(t(lang, "share.noUsername"));
      return;
    }
    const link = `https://t.me/${un}?start=ref_${u.id}`;
    await ctx.reply(`${t(lang, "share.text")}\n${link}`);
  });

  bot.callbackQuery(cb.stats, async (ctx) => {
    const u = await ensureDbUser(ctx);
    if (!u) return;
    await ctx.answerCallbackQuery();
    await showStats(ctx, u.id);
  });

  bot.callbackQuery("stat:extra", async (ctx) => {
    const lang = await getLang(ctx);
    await ctx.answerCallbackQuery({
      text: lang === "fa" ? "به‌زودی." : "Coming soon.",
      show_alert: false,
    });
  });

  bot.callbackQuery(cb.setToggleVc, async (ctx) => {
    const u = await ensureDbUser(ctx);
    if (!u) return;
    const p = await getProfile(u.id);
    if (!p) return;
    await mergeProfilePreferences(u.id, { only_verified_can_like_me: !p.preferences.only_verified_can_like_me });
    const lang = await getLang(ctx);
    const cfg = await getBotConfig();
    await ctx.answerCallbackQuery();
    await ctx.editMessageText(labelForLang(cfg.settings.title, lang), {
      reply_markup: await settingsReplyMarkup(ctx),
    });
  });

  bot.callbackQuery(cb.setToggleNl, async (ctx) => {
    const u = await ensureDbUser(ctx);
    if (!u) return;
    const p = await getProfile(u.id);
    if (!p) return;
    await mergeProfilePreferences(u.id, { notify_like: !p.preferences.notify_like });
    const lang = await getLang(ctx);
    const cfg = await getBotConfig();
    await ctx.answerCallbackQuery();
    await ctx.editMessageText(labelForLang(cfg.settings.title, lang), {
      reply_markup: await settingsReplyMarkup(ctx),
    });
  });

  bot.callbackQuery(cb.setToggleNm, async (ctx) => {
    const u = await ensureDbUser(ctx);
    if (!u) return;
    const p = await getProfile(u.id);
    if (!p) return;
    await mergeProfilePreferences(u.id, { notify_match: !p.preferences.notify_match });
    const lang = await getLang(ctx);
    const cfg = await getBotConfig();
    await ctx.answerCallbackQuery();
    await ctx.editMessageText(labelForLang(cfg.settings.title, lang), {
      reply_markup: await settingsReplyMarkup(ctx),
    });
  });

  bot.callbackQuery(cb.setToggleRc, async (ctx) => {
    const u = await ensureDbUser(ctx);
    if (!u) return;
    const p = await getProfile(u.id);
    if (!p) return;
    await mergeProfilePreferences(u.id, { receive_chat_requests: !p.preferences.receive_chat_requests });
    const lang = await getLang(ctx);
    const cfg = await getBotConfig();
    await ctx.answerCallbackQuery();
    await ctx.editMessageText(labelForLang(cfg.settings.title, lang), {
      reply_markup: await settingsReplyMarkup(ctx),
    });
  });

  bot.callbackQuery(cb.setToggleRd, async (ctx) => {
    const u = await ensureDbUser(ctx);
    if (!u) return;
    const p = await getProfile(u.id);
    if (!p) return;
    await mergeProfilePreferences(u.id, { receive_direct: !p.preferences.receive_direct });
    const lang = await getLang(ctx);
    const cfg = await getBotConfig();
    await ctx.answerCallbackQuery();
    await ctx.editMessageText(labelForLang(cfg.settings.title, lang), {
      reply_markup: await settingsReplyMarkup(ctx),
    });
  });

  bot.callbackQuery(cb.deleteAccount, async (ctx) => {
    const lang = await getLang(ctx);
    await ctx.answerCallbackQuery();
    await ctx.reply(t(lang, "delete.confirm"), {
      reply_markup: new InlineKeyboard()
        .text(t(lang, "delete.yes"), cb.deleteConfirm)
        .text(t(lang, "delete.no"), cb.deleteCancel),
    });
  });

  bot.callbackQuery(cb.deleteConfirm, async (ctx) => {
    const u = await ensureDbUser(ctx);
    if (!u) return;
    const lang = await getLang(ctx);
    await ctx.answerCallbackQuery();
    await deleteUser(u.id);
    await ctx.reply(t(lang, "delete.done"));
  });

  bot.callbackQuery(cb.deleteCancel, async (ctx) => {
    await ctx.answerCallbackQuery();
    await sendMainMenuReply(ctx);
  });

  registerExplorerCallbacks(bot, {
    onDislike: async (ctx) => {
      const x = await assertDiscoverContext(ctx);
      if (!x) return void (await ctx.answerCallbackQuery());
      await ctx.answerCallbackQuery();
      await handleSwipe(ctx, 2);
    },
    onLike: async (ctx) => {
      const x = await assertDiscoverContext(ctx);
      if (!x) return void (await ctx.answerCallbackQuery());
      const ok = await canPostLike(x.u.id, x.targetId);
      if (!ok) {
        return void (await ctx.answerCallbackQuery({
          text: t(x.lang, "explore.likeBlocked"),
          show_alert: true,
        }));
      }
      await ctx.answerCallbackQuery();
      await handleSwipe(ctx, 1);
    },
    onLikeDirect: async (ctx) => {
      const x = await assertDiscoverContext(ctx);
      if (!x) return void (await ctx.answerCallbackQuery());
      const ok = await canPostLike(x.u.id, x.targetId);
      if (!ok) {
        return void (await ctx.answerCallbackQuery({
          text: t(x.lang, "explore.likeBlocked"),
          show_alert: true,
        }));
      }
      await ctx.answerCallbackQuery();
      await handleSwipe(ctx, 1);
    },
    onMore: async (ctx) => {
      const x = await assertDiscoverContext(ctx);
      if (!x) return void (await ctx.answerCallbackQuery());
      await ctx.answerCallbackQuery();
      await setSession(x.u.id, { state: "discover", payload: { ...x.s.payload, sub: "more" } });
      await renderDiscoverCard(ctx, x.u.id);
    },
    onBack: async (ctx) => {
      const x = await assertDiscoverContext(ctx);
      if (!x) return void (await ctx.answerCallbackQuery());
      if (x.s.payload.sub === "more") {
        await ctx.answerCallbackQuery();
        await setSession(x.u.id, { state: "discover", payload: { ...x.s.payload, sub: "main" } });
        await renderDiscoverCard(ctx, x.u.id);
        return;
      }
      if (x.s.payload.idx > 0) {
        await ctx.answerCallbackQuery();
        await setSession(x.u.id, {
          state: "discover",
          payload: { ...x.s.payload, idx: x.s.payload.idx - 1, sub: "main" },
        });
        await renderDiscoverCard(ctx, x.u.id);
        return;
      }
      await ctx.answerCallbackQuery({
        text: x.lang === "fa" ? "اولین کارت است." : "This is the first card.",
        show_alert: false,
      });
    },
    onExit: async (ctx) => {
      const x = await assertDiscoverContext(ctx);
      if (!x) return void (await ctx.answerCallbackQuery());
      await ctx.answerCallbackQuery();
      await resetSession(x.u.id);
      await sendMainMenuReply(ctx);
    },
    onNeverShow: async (ctx) => {
      const x = await assertDiscoverContext(ctx);
      if (!x) return void (await ctx.answerCallbackQuery());
      await ctx.answerCallbackQuery();
      await addPermanentHide(x.u.id, x.targetId);
      await setSession(x.u.id, {
        state: "discover",
        payload: { ...x.s.payload, idx: x.s.payload.idx + 1, sub: "main" },
      });
      await renderDiscoverCard(ctx, x.u.id);
    },
    onReport: async (ctx) => {
      const x = await assertDiscoverContext(ctx);
      if (!x) return void (await ctx.answerCallbackQuery());
      await ctx.answerCallbackQuery();
      await createReport({ reporterId: x.u.id, targetId: x.targetId, reason: "user_reported" });
      await setSession(x.u.id, {
        state: "discover",
        payload: { ...x.s.payload, idx: x.s.payload.idx + 1, sub: "main" },
      });
      await renderDiscoverCard(ctx, x.u.id);
    },
    onBackExplore: async (ctx) => {
      const x = await assertDiscoverContext(ctx);
      if (!x) return void (await ctx.answerCallbackQuery());
      await ctx.answerCallbackQuery();
      await setSession(x.u.id, { state: "discover", payload: { ...x.s.payload, sub: "main" } });
      await renderDiscoverCard(ctx, x.u.id);
    },
  });

  bot.callbackQuery(/^mchat:(\d+)$/, async (ctx) => {
    const u = await ensureDbUser(ctx);
    if (!u) return;
    const otherId = Number(ctx.match?.[1]);
    const lang = await getLang(ctx);
    const ok = await hasMatchBetween(u.id, otherId);
    if (!ok) {
      await ctx.answerCallbackQuery({ text: t(lang, "matches.invalid"), show_alert: true });
      return;
    }
    await ctx.answerCallbackQuery();
    await setSession(u.id, { state: "chat", payload: { withUserId: otherId } });
    await ctx.reply(t(lang, "chat.start"));
  });

  bot.callbackQuery(/^lkback:(\d+)$/, async (ctx) => {
    const u = await ensureDbUser(ctx);
    if (!u) return;
    const targetId = Number(ctx.match?.[1]);
    const lang = langFromDb(u.language);
    const ok = await canPostLike(u.id, targetId);
    if (!ok) {
      await ctx.answerCallbackQuery({ text: t(lang, "explore.likeBlocked"), show_alert: true });
      return;
    }
    await swipe({ swiperId: u.id, targetId, direction: 1 });
    const mutual = await hasLiked(targetId, u.id);
    if (mutual) {
      const created = await ensureMatch(u.id, targetId);
      if (created) await notifyMatch(ctx, u.id, targetId);
    }
    await ctx.answerCallbackQuery({ text: t(lang, "likers.likeBack") });
  });

  bot.callbackQuery(/^wg:(.+)$/, async (ctx) => {
    const u = await ensureDbUser(ctx);
    if (!u) return;
    const s = await getSession(u.id);
    if (s.state !== "profile_wizard" || s.payload.step !== "gender") return;
    const raw = ctx.match?.[1] ?? "skip";
    s.payload.draft.gender = raw === "skip" ? null : raw;
    s.payload.step = "looking_for";
    await setSession(u.id, { state: "profile_wizard", payload: s.payload });
    const lang = await getLang(ctx);
    await ctx.answerCallbackQuery();
    await ctx.reply(t(lang, "profile.ask.lookingFor"), {
      reply_markup: wizardLookingForKeyboard(lang),
    });
  });

  bot.callbackQuery(/^wlf:(friends|dating|both)$/, async (ctx) => {
    const u = await ensureDbUser(ctx);
    if (!u) return;
    const s = await getSession(u.id);
    if (s.state !== "profile_wizard" || s.payload.step !== "looking_for") return;
    const lf = ctx.match?.[1] as LookingFor;
    s.payload.draft.lookingFor = lf;
    s.payload.step = "seek_genders";
    s.payload.draft.seekGenders = [];
    await setSession(u.id, { state: "profile_wizard", payload: s.payload });
    const lang = await getLang(ctx);
    await ctx.answerCallbackQuery();
    await ctx.reply(t(lang, "profile.ask.seek"), {
      reply_markup: wizardSeekKeyboard(lang, new Set()),
    });
  });

  bot.callbackQuery(/^wsk:(m|f|x)$/, async (ctx) => {
    const u = await ensureDbUser(ctx);
    if (!u) return;
    const s = await getSession(u.id);
    if (s.state !== "profile_wizard" || s.payload.step !== "seek_genders") return;
    const g = ctx.match?.[1] ?? "";
    const cur = new Set(s.payload.draft.seekGenders ?? []);
    if (cur.has(g)) cur.delete(g);
    else cur.add(g);
    s.payload.draft.seekGenders = Array.from(cur);
    await setSession(u.id, { state: "profile_wizard", payload: s.payload });
    const lang = await getLang(ctx);
    await ctx.answerCallbackQuery();
    await ctx.editMessageReplyMarkup({
      reply_markup: wizardSeekKeyboard(lang, cur),
    });
  });

  bot.callbackQuery(cb.wizardSeekDone, async (ctx) => {
    const u = await ensureDbUser(ctx);
    if (!u) return;
    const s = await getSession(u.id);
    if (s.state !== "profile_wizard" || s.payload.step !== "seek_genders") return;
    s.payload.step = "location";
    await setSession(u.id, { state: "profile_wizard", payload: s.payload });
    const lang = await getLang(ctx);
    await ctx.answerCallbackQuery();
    await ctx.reply(t(lang, "profile.ask.location"), {
      reply_markup: new InlineKeyboard().text(lang === "fa" ? "رد کردن" : "Skip", "loc:skip"),
    });
  });

  bot.on("message:text", async (ctx, next) => {
    const u = await ensureDbUser(ctx);
    if (!u) return;
    const lang = langFromDb(u.language);
    const s = await getSession(u.id);

    if (s.state === "chat") return;
    if (
      s.state === "admin_broadcast" ||
      s.state === "admin_find" ||
      s.state === "admin_config_wait" ||
      s.state === "admin_diamond_wait"
    )
      return;

    if (ctx.msg.text.startsWith("/")) return next();

    if (s.state === "face_verify_wait") {
      await ctx.reply(t(lang, "face.askPhoto"), {
        reply_markup: new InlineKeyboard().text(lang === "fa" ? "انصراف ❌" : "Cancel ❌", "face:cancel"),
      });
      return;
    }

    if (s.state === "idle" || s.state === "discover") {
      await ensureBotConfigSeeded();
      const cfg = await getBotConfig();
      const action = matchHomeAction(cfg, lang, ctx.msg.text.trim());
      if (action) {
        if (s.state === "discover" && action !== "explore") await resetSession(u.id);
        await dispatchHomeAction(ctx, u, action);
        return;
      }
    }

    if (s.state === "idle") {
      const p = await getProfile(u.id);
      if (!p) {
        await ctx.reply(t(lang, "profile.need"));
        await startProfileWizard(ctx, u.id);
        return;
      }
    }

    if (s.state !== "profile_wizard") return;
    const text = ctx.msg.text.trim();
    const payload = s.payload;

    if (payload.step === "name") {
      payload.draft.displayName = text.slice(0, 32);
      payload.step = "age";
      await setSession(u.id, { state: "profile_wizard", payload });
      await ctx.reply(t(lang, "profile.ask.age"));
      return;
    }
    if (payload.step === "age") {
      const n = parseIntStrict(text);
      if (!n || n < 18 || n > 99) {
        await ctx.reply(t(lang, "profile.ask.age"));
        return;
      }
      payload.draft.age = n;
      payload.step = "city";
      await setSession(u.id, { state: "profile_wizard", payload });
      await ctx.reply(t(lang, "profile.ask.city"));
      return;
    }
    if (payload.step === "city") {
      payload.draft.city = text.slice(0, 64);
      payload.step = "gender";
      await setSession(u.id, { state: "profile_wizard", payload });
      await ctx.reply(t(lang, "profile.ask.gender"), {
        reply_markup: wizardGenderKeyboard(lang),
      });
      return;
    }
    if (payload.step === "bio") {
      payload.draft.bio = text === "/skip" ? "" : text.slice(0, 280);
      payload.step = "interests";
      await setSession(u.id, { state: "profile_wizard", payload });
      await sendInterestsPicker(ctx, lang, payload.draft.interestKeys ?? []);
      return;
    }

    if (payload.step === "photos") {
      return next();
    }
  });

  bot.on("message:location", async (ctx) => {
    const u = await ensureDbUser(ctx);
    if (!u) return;
    const s = await getSession(u.id);
    if (s.state !== "profile_wizard") return;
    if (s.payload.step !== "location") return;
    const loc = ctx.msg.location;
    s.payload.draft.location = { lat: loc.latitude, lon: loc.longitude };
    s.payload.step = "bio";
    await setSession(u.id, { state: "profile_wizard", payload: s.payload });
    const lang = await getLang(ctx);
    await ctx.reply(t(lang, "profile.ask.bio"), {
      reply_markup: new InlineKeyboard().text(lang === "fa" ? "رد کردن" : "Skip", "bio:skip"),
    });
  });

  bot.callbackQuery("loc:skip", async (ctx) => {
    const u = await ensureDbUser(ctx);
    if (!u) return;
    const s = await getSession(u.id);
    if (s.state !== "profile_wizard") return;
    if (s.payload.step !== "location") return;
    s.payload.draft.location = null;
    s.payload.step = "bio";
    await setSession(u.id, { state: "profile_wizard", payload: s.payload });
    const lang = await getLang(ctx);
    await ctx.answerCallbackQuery();
    await ctx.reply(t(lang, "profile.ask.bio"), {
      reply_markup: new InlineKeyboard().text(lang === "fa" ? "رد کردن" : "Skip", "bio:skip"),
    });
  });

  bot.callbackQuery("bio:skip", async (ctx) => {
    const u = await ensureDbUser(ctx);
    if (!u) return;
    const s = await getSession(u.id);
    if (s.state !== "profile_wizard" || s.payload.step !== "bio") return;
    s.payload.draft.bio = "";
    s.payload.step = "interests";
    await setSession(u.id, { state: "profile_wizard", payload: s.payload });
    const lang = await getLang(ctx);
    await ctx.answerCallbackQuery();
    await sendInterestsPicker(ctx, lang, []);
  });

  async function sendInterestsPicker(ctx: MyContext, lang: Language, selected: string[]) {
    const interests = await listInterests();
    const kb = new InlineKeyboard();
    for (const i of interests) {
      const label =
        (selected.includes(i.key) ? "✅ " : "") + (lang === "fa" ? i.fa_label : i.en_label);
      kb.text(label, cb.interestToggle(i.key)).row();
    }
    kb.text(lang === "fa" ? "تمام" : "Done", cb.interestDone);
    await ctx.reply(t(lang, "profile.ask.interests"), { reply_markup: kb });
  }

  bot.callbackQuery(/^int:(?!done$)(.+)$/, async (ctx) => {
    const u = await ensureDbUser(ctx);
    if (!u) return;
    const s = await getSession(u.id);
    if (s.state !== "profile_wizard") return;
    if (s.payload.step !== "interests") return;
    const lang = langFromDb(u.language);
    const key = String(ctx.match?.[1]);
    const current = new Set(s.payload.draft.interestKeys ?? []);
    if (current.has(key)) current.delete(key);
    else if (current.size < 6) current.add(key);
    s.payload.draft.interestKeys = Array.from(current);
    await setSession(u.id, { state: "profile_wizard", payload: s.payload });
    await ctx.answerCallbackQuery();
    const interests = await listInterests();
    const kb = new InlineKeyboard();
    const selected = s.payload.draft.interestKeys ?? [];
    for (const i of interests) {
      const label =
        (selected.includes(i.key) ? "✅ " : "") + (lang === "fa" ? i.fa_label : i.en_label);
      kb.text(label, cb.interestToggle(i.key)).row();
    }
    kb.text(lang === "fa" ? "تمام" : "Done", cb.interestDone);
    await ctx.editMessageReplyMarkup({ reply_markup: kb });
  });

  bot.callbackQuery(cb.interestDone, async (ctx) => {
    const u = await ensureDbUser(ctx);
    if (!u) return;
    const s = await getSession(u.id);
    if (s.state !== "profile_wizard") return;
    if (s.payload.step !== "interests") return;
    s.payload.step = "photos";
    await setSession(u.id, { state: "profile_wizard", payload: s.payload });
    const lang = await getLang(ctx);
    await ctx.answerCallbackQuery();
    await ctx.reply(t(lang, "profile.ask.photos"), {
      reply_markup: new InlineKeyboard().text(lang === "fa" ? "تمام ✅" : "Done ✅", "photos:done"),
    });
  });

  bot.on("message:photo", async (ctx) => {
    const u = await ensureDbUser(ctx);
    if (!u) return;
    const s = await getSession(u.id);
    const lang = langFromDb(u.language);
    const photos = ctx.msg.photo;
    const best = photos[photos.length - 1];
    const fileId = best.file_id;

    if (s.state === "face_verify_wait") {
      const subId = await createFaceSubmission(u.id, fileId);
      await resetSession(u.id);
      await ctx.reply(t(lang, "face.submitted"));
      for (const adminTgId of config.adminTelegramIdSet) {
        const caption = `Face verification #${subId}\nUser DB id: ${u.id} | tg: ${ctx.from!.id}${ctx.from!.username ? " @" + ctx.from!.username : ""}`;
        const kb = new InlineKeyboard()
          .text("Approve ✅", `adm:fap:${subId}`)
          .text("Reject ❌", `adm:far:${subId}`);
        await ctx.api.sendPhoto(adminTgId, fileId, { caption, reply_markup: kb }).catch(() => {});
      }
      return;
    }

    if (s.state !== "profile_wizard") return;
    if (s.payload.step !== "photos") return;
    const list = s.payload.draft.photoFileIds ?? [];
    if (list.length >= 3) {
      await ctx.reply(lang === "fa" ? "حداکثر ۳ عکس." : "Max 3 photos.");
      return;
    }
    list.push(fileId);
    s.payload.draft.photoFileIds = list;
    await setSession(u.id, { state: "profile_wizard", payload: s.payload });
    await ctx.reply(
      lang === "fa" ? `ثبت شد (${list.length}/3).` : `Saved (${list.length}/3).`,
      { reply_markup: new InlineKeyboard().text(lang === "fa" ? "تمام ✅" : "Done ✅", "photos:done") }
    );
  });

  bot.command("done", async (ctx) => {
    const u = await ensureDbUser(ctx);
    if (!u) return;
    const s = await getSession(u.id);
    if (s.state !== "profile_wizard") return;
    if (s.payload.step !== "photos") return;
    const lang = langFromDb(u.language);
    const d = s.payload.draft;
    if (!d.displayName || !d.age || !d.city) {
      await ctx.reply(t(lang, "errors.generic"));
      return;
    }
    const fileIds = d.photoFileIds ?? [];
    const lf = d.lookingFor ?? "both";
    const prefs = {
      looking_for: lf,
      seek_genders: d.seekGenders ?? [],
      age_min: 18,
      age_max: 99,
    };
    await upsertProfile(u.id, {
      display_name: d.displayName,
      age: d.age,
      city: d.city,
      bio: d.bio ?? "",
      visibility: true,
      preferences: prefs,
      gender: d.gender ?? null,
      location_lat: d.location?.lat ?? null,
      location_lon: d.location?.lon ?? null,
    });
    await setUserInterests(u.id, d.interestKeys ?? []);
    await replacePhotos(u.id, fileIds);
    await resetSession(u.id);
    const profileReward = await getSystemSettingNumber("diamond_reward_profile", 10);
    await adjustDiamondBalance({
      userId: u.id,
      delta: profileReward,
      reason: "profile_complete",
      adminTelegramId: null,
      refJson: {},
    });
    const full = await getUserById(u.id);
    if (full?.referred_by && !full.referral_bonus_paid) {
      const refReward = await getSystemSettingNumber("diamond_reward_referral", 5);
      await adjustDiamondBalance({
        userId: full.referred_by,
        delta: refReward,
        reason: "referral_profile_complete",
        adminTelegramId: null,
        refJson: { referred_user_id: u.id },
      });
      await markReferralBonusPaid(u.id);
    }
    await ctx.reply(t(lang, "profile.saved"));
    await sendMainMenuReply(ctx);
  });

  bot.callbackQuery("photos:done", async (ctx) => {
    const u = await ensureDbUser(ctx);
    if (!u) return;
    const s = await getSession(u.id);
    if (s.state !== "profile_wizard" || s.payload.step !== "photos") {
      await ctx.answerCallbackQuery();
      return;
    }
    const lang = langFromDb(u.language);
    const d = s.payload.draft;
    if (!d.displayName || !d.age || !d.city) {
      await ctx.answerCallbackQuery({ text: t(lang, "errors.generic"), show_alert: true });
      return;
    }
    await ctx.answerCallbackQuery();
    const fileIds = d.photoFileIds ?? [];
    const lf = d.lookingFor ?? "both";
    const prefs = {
      looking_for: lf,
      seek_genders: d.seekGenders ?? [],
      age_min: 18,
      age_max: 99,
    };
    await upsertProfile(u.id, {
      display_name: d.displayName,
      age: d.age,
      city: d.city,
      bio: d.bio ?? "",
      visibility: true,
      preferences: prefs,
      gender: d.gender ?? null,
      location_lat: d.location?.lat ?? null,
      location_lon: d.location?.lon ?? null,
    });
    await setUserInterests(u.id, d.interestKeys ?? []);
    await replacePhotos(u.id, fileIds);
    await resetSession(u.id);
    const profileReward = await getSystemSettingNumber("diamond_reward_profile", 10);
    await adjustDiamondBalance({
      userId: u.id,
      delta: profileReward,
      reason: "profile_complete",
      adminTelegramId: null,
      refJson: {},
    });
    const full = await getUserById(u.id);
    if (full?.referred_by && !full.referral_bonus_paid) {
      const refReward = await getSystemSettingNumber("diamond_reward_referral", 5);
      await adjustDiamondBalance({
        userId: full.referred_by,
        delta: refReward,
        reason: "referral_profile_complete",
        adminTelegramId: null,
        refJson: { referred_user_id: u.id },
      });
      await markReferralBonusPaid(u.id);
    }
    await ctx.reply(t(lang, "profile.saved"));
    await sendMainMenuReply(ctx);
  });

  bot.callbackQuery("face:cancel", async (ctx) => {
    const u = await ensureDbUser(ctx);
    if (!u) return;
    await resetSession(u.id);
    await ctx.answerCallbackQuery();
    const lang = await getLang(ctx);
    await ctx.reply(lang === "fa" ? "احراز چهره لغو شد." : "Face verification cancelled.");
    await sendMainMenuReply(ctx);
  });

  bot.callbackQuery(cb.profile, async (ctx) => {
    const u = await ensureDbUser(ctx);
    if (!u) return;
    await ctx.answerCallbackQuery();
    const p = await getProfile(u.id);
    if (!p) {
      const lang = await getLang(ctx);
      await ctx.reply(t(lang, "profile.need"));
      await startProfileWizard(ctx, u.id);
      return;
    }
    await renderMyProfile(ctx, u.id);
  });

  bot.command("help", async (ctx) => {
    const lang = await getLang(ctx);
    await ctx.reply(
      lang === "fa"
        ? "/profile /discover /matches\nخروج چت: /exit • مسدود: /block"
        : "/profile /discover /matches\nLeave chat: /exit • Block: /block"
    );
  });

  setupAdmin(bot);

  await setupUx(bot);

  return bot;
}

function adminLangFromCtx(ctx: MyContext): Language {
  return ctx.from?.language_code?.startsWith("fa") ? "fa" : "en";
}
