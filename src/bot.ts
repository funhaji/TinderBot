import { Bot, InlineKeyboard } from "grammy";
import { setupAdmin, tryHandleAdminFollowupMessage } from "./admin/panel.js";
import { ensureBotConfigSeeded, getBotConfig, getBotMsg, labelForLang } from "./config/botContent.js";
import type { HomeMenuAction } from "./config/botContent.js";
import { config } from "./config.js";
import { isPanelAdmin, refreshPanelAdminCache } from "./config/access.js";
import { getStartNotifyGroupRef, normalizePublicHandle, notifyStartGroup } from "./features/startNotify.js";
import { formatDiscoverCaption, explorerMarkup, registerExplorerCallbacks } from "./features/explorer.js";
import { buildCodeHomeReplyKeyboard, matchCodeHomeAction } from "./config/homeMenu.js";
import { IRAN_COUNTRY_EN, provinceLabel } from "./config/iranGeo.js";
import { logger } from "./logger.js";
import { formatProfileBadgesLine, formatProfileBadgesShort } from "./profile/badges.js";
import { genderLabel, orientationLabel } from "./profile/compat.js";
import type { Language, LookingFor, MyContext, ProfileWizardPayload, ProfileWizardStep, SessionState } from "./types.js";
import {
  profileEditGlassKeyboard,
  profileEditStartStep,
  shouldCompleteSingleFieldEdit,
  type ProfileEditField,
} from "./ui/profileEdit.js";
import { defaultAvatarFile } from "./util/defaultAvatar.js";
import { t, tf } from "./i18n/index.js";
import { formatNowFooter } from "./util/dateFa.js";
import {
  cb,
  langKeyboard,
  seekGenderKeyboard,
  settingsKeyboardFull,
  settingsLangPickKb,
  wizardGenderKeyboard,
  wizardOrientationKeyboard,
  wizardLookingForKeyboard,
  wizardSeekKeyboard,
  wizardAgeCategoryKeyboard,
  wizardAgePickKeyboard,
  wizardIranLocationKeyboard,
} from "./ui/keyboards.js";
import type { ProfileRow } from "./db/repo.js";
import {
  addPermanentHide,
  adjustDiamondBalance,
  blockUser,
  countUsers,
  createReport,
  deleteUser,
  discoveryCandidates,
  ensureMatch,
  ensureSessionRow,
  extendedUserStats,
  getPrimaryPhoto,
  listPhotoFileIds,
  getProfile,
  getSession,
  getTelegramIdByUserId,
  findMysteryWaitUser,
  expireMysteryWaitSessions,
  expireMysteryVoteSessions,
  applyReferralMilestonesForReferrer,
  claimReferralFileReward,
  getUserByReferralCode,
  listUnclaimedReferralFileRewardsForUser,
  socialPairAllowed,
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
  getSystemSettingBool,
  getSystemSettingNumber,
  getSystemSettingJson,
} from "./db/repo.js";

// ── Hardcoded mystery-room strings (no i18n file edits needed) ──────────────
const MR: Record<string, { fa: string; en: string }> = {
  prefGender:        { fa: "🧭 می‌خوای با کی حرف بزنی؟",  en: "🧭 Who do you want to talk to?" },
  "prefGender.m":    { fa: "👦 پسر",                       en: "👦 Boy"                         },
  "prefGender.f":    { fa: "👧 دختر",                      en: "👧 Girl"                        },
  "prefGender.x":    { fa: "⚧ نان‌باینری / دیگر",          en: "⚧ Non-binary / Other"           },
  "prefGender.any":  { fa: "🎲 هر کسی",                   en: "🎲 Anyone"                      },
  prefAge:           { fa: "📅 محدوده سنی مورد نظر؟",      en: "📅 Preferred age range?"         },
  "prefAge.close":   { fa: "🎯 نزدیک به سن من",            en: "🎯 Close to my age"             },
  "prefAge.any":     { fa: "🔓 هر سنی",                    en: "🔓 Any age"                     },
  prefCountry:       { fa: "🌍 هم‌وطن باشه؟",              en: "🌍 Same country?"               },
  "prefCountry.yes": { fa: "✅ بله، هم‌کشوری",             en: "✅ Yes, same country"            },
  "prefCountry.no":  { fa: "🌐 مهم نیست",                  en: "🌐 Doesn't matter"              },
};

function mr(lang: Language, key: string): string {
  return MR[key]?.[lang] ?? key;
}
// ────────────────────────────────────────────────────────────────────────────

function langFromDb(v: unknown): Language {
  return v === "fa" ? "fa" : "en";
}

async function getLang(ctx: MyContext): Promise<Language> {
  const tgId = ctx.from?.id;
  if (!tgId) return "en";
  const u = await getUserByTelegramId(tgId);
  return langFromDb(u?.language ?? "en");
}

async function isBotEnabled(): Promise<boolean> {
  return getSystemSettingBool("bot_enabled", true);
}

function isTelegramMembershipStatusOk(status: string | undefined): boolean {
  return status === "member" || status === "administrator" || status === "creator";
}

async function getRequiredJoinHandles(): Promise<string[]> {
  const raw = await getSystemSettingJson<unknown>("must_join_channels", []);
  if (!Array.isArray(raw)) return [];
  return raw
    .map((v) => normalizePublicHandle(String(v ?? "")))
    .filter((v): v is string => !!v);
}

async function ensureJoinLocks(ctx: MyContext, lang: Language): Promise<boolean> {
  if (!ctx.from || isPanelAdmin(ctx.from.id)) return true;
  const handles = await getRequiredJoinHandles();
  if (handles.length === 0) return true;
  const missing: string[] = [];
  for (const handle of handles) {
    try {
      const member = await ctx.api.getChatMember(handle, ctx.from.id);
      if (!isTelegramMembershipStatusOk(member.status)) missing.push(handle);
    } catch {
      missing.push(handle);
    }
  }
  if (missing.length === 0) return true;
  const key = lang === "fa" ? "join.required" : "join.required";
  await ctx.reply(tf(lang, key, { channels: missing.join("\n") }));
  return false;
}

function parseStartArgs(text: string | undefined): {
  refUserId?: number;
  refCode?: string;
  matchOther?: number;
} {
  const parts = (text ?? "").trim().split(/\s+/);
  const arg = parts[1];
  const out: { refUserId?: number; refCode?: string; matchOther?: number } = {};
  if (arg?.startsWith("ref_")) {
    const rest = arg.slice(4).trim();
    const id = Number(rest);
    if (Number.isFinite(id) && id > 0) out.refUserId = id;
    else if (rest.length > 0) out.refCode = rest;
  }
  if (arg?.startsWith("match_")) {
    const id = Number(arg.slice(6));
    if (Number.isFinite(id) && id > 0) out.matchOther = id;
  }
  return out;
}

async function resolveReferrerDbId(args: { refUserId?: number; refCode?: string }): Promise<number | null> {
  if (args.refUserId && args.refUserId > 0) {
    const u = await getUserById(args.refUserId);
    return u?.id ?? null;
  }
  if (args.refCode) {
    const u = await getUserByReferralCode(args.refCode);
    return u?.id ?? null;
  }
  return null;
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
  await ctx.reply(labelForLang(cfg.start, lang), { reply_markup: buildCodeHomeReplyKeyboard(lang) });
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

type WizardDraft = ProfileWizardPayload["draft"];

function ageCategoryFromAge(age: number): "u20" | "20p" | "30p" {
  if (age < 20) return "u20";
  if (age < 30) return "20p";
  return "30p";
}

function draftFromProfile(
  p: ProfileRow,
  interestKeys: string[],
  photoFileIds: string[]
): WizardDraft {
  const prefs = p.preferences ?? {};
  let orientation = prefs.orientation ?? null;
  if (orientation === "bi") orientation = "bisexual";
  return {
    displayName: p.display_name,
    age: p.age,
    ageCategory: ageCategoryFromAge(p.age),
    country: prefs.country ?? "",
    city: p.city,
    provinceKey: prefs.province_key ?? null,
    gender: p.gender,
    orientation,
    lookingFor: (prefs.looking_for as LookingFor | undefined) ?? "both",
    seekGenders: prefs.seek_genders ?? [],
    bio: p.bio ?? "",
    personalTraits: prefs.personal_traits ?? "",
    partnerTraits: prefs.partner_traits ?? "",
    location:
      p.location_lat != null && p.location_lon != null
        ? { lat: p.location_lat, lon: p.location_lon }
        : null,
    interestKeys,
    photoFileIds,
  };
}

async function startProfileWizard(ctx: MyContext, userId: number) {
  const s: SessionState = {
    state: "profile_wizard",
    payload: { step: "name", draft: {}, editing: false },
  };
  await setSession(userId, s);
  const lang = await getLang(ctx);
  await ctx.reply(t(lang, "profile.ask.name"));
}

async function replyWithProfilePhoto(
  ctx: MyContext,
  photoId: string | null,
  caption: string,
  reply_markup?: InlineKeyboard
) {
  const opts = { caption, reply_markup };
  if (photoId) await ctx.replyWithPhoto(photoId, opts);
  else await ctx.replyWithPhoto(defaultAvatarFile(), opts);
}

async function showProfileEditPicker(ctx: MyContext) {
  const lang = await getLang(ctx);
  await ctx.reply(t(lang, "profile.editPick"), { reply_markup: profileEditGlassKeyboard(lang) });
}

async function startProfileEditField(ctx: MyContext, userId: number, field: ProfileEditField) {
  const p = await getProfile(userId);
  if (!p) {
    await startProfileWizard(ctx, userId);
    return;
  }
  const interestKeys = await getUserInterestKeys(userId);
  const photoFileIds = await listPhotoFileIds(userId);
  const draft = draftFromProfile(p, interestKeys, photoFileIds);
  const step = profileEditStartStep(field);
  await setSession(userId, {
    state: "profile_wizard",
    payload: { step, draft, editing: true, editField: field },
  });
  const lang = await getLang(ctx);
  const cancelKb = new InlineKeyboard().text(t(lang, "wizard.cancel"), cb.wizardCancel);
  await ctx.reply(t(lang, "profile.editStart"), { reply_markup: cancelKb });
  await promptProfileWizardStep(ctx, lang, step, draft);
}

async function promptProfileWizardStep(
  ctx: MyContext,
  lang: Language,
  step: ProfileWizardStep,
  draft: ProfileWizardPayload["draft"]
) {
  switch (step) {
    case "name":
      await ctx.reply(`${t(lang, "profile.ask.name")}\n(${draft.displayName ?? "—"})`);
      break;
    case "age_category":
      await ctx.reply(t(lang, "profile.ask.ageCategory"), { reply_markup: wizardAgeCategoryKeyboard(lang) });
      break;
    case "gender":
      await ctx.reply(t(lang, "profile.ask.gender"), { reply_markup: wizardGenderKeyboard(lang) });
      break;
    case "orientation":
      await ctx.reply(t(lang, "profile.ask.orientation"), { reply_markup: wizardOrientationKeyboard(lang) });
      break;
    case "looking_for":
      await ctx.reply(t(lang, "profile.ask.lookingFor"), { reply_markup: wizardLookingForKeyboard(lang) });
      break;
    case "seek_genders":
      await ctx.reply(t(lang, "profile.ask.seek"), {
        reply_markup: wizardSeekKeyboard(lang, new Set(draft.seekGenders ?? [])),
      });
      break;
    case "loc_entry":
      await ctx.reply(t(lang, "profile.ask.locEntry"), { reply_markup: wizardIranLocationKeyboard(lang) });
      break;
    case "bio":
      await ctx.reply(t(lang, "profile.ask.bio"), {
        reply_markup: new InlineKeyboard().text(t(lang, "wizard.skip"), "bio:skip"),
      });
      break;
    case "personal_traits":
      await ctx.reply(t(lang, "profile.ask.personalTraits"), {
        reply_markup: new InlineKeyboard().text(t(lang, "wizard.skip"), "pt:skip"),
      });
      break;
    case "partner_traits":
      await ctx.reply(t(lang, "profile.ask.partnerTraits"), {
        reply_markup: new InlineKeyboard().text(t(lang, "wizard.skip"), "qt:skip"),
      });
      break;
    case "interests":
      await sendInterestsPickerForEdit(ctx, lang, draft.interestKeys ?? []);
      break;
    case "photos":
      await ctx.reply(t(lang, "profile.ask.photos"), {
        reply_markup: new InlineKeyboard().text(t(lang, "wizard.doneFull"), "photos:done"),
      });
      break;
    default:
      break;
  }
}

async function sendInterestsPickerForEdit(ctx: MyContext, lang: Language, selected: string[]) {
  const interests = await listInterests();
  const kb = new InlineKeyboard();
  for (const i of interests) {
    const label = (selected.includes(i.key) ? "✅ " : "") + (lang === "fa" ? i.fa_label : i.en_label);
    kb.text(label, cb.interestToggle(i.key)).row();
  }
  kb.text(t(lang, "wizard.done"), cb.interestDone);
  await ctx.reply(t(lang, "profile.ask.interests"), { reply_markup: kb });
}

async function finishSingleFieldEditIfNeeded(
  ctx: MyContext,
  userId: number,
  payload: ProfileWizardPayload,
  completedStep: ProfileWizardStep
): Promise<boolean> {
  if (!shouldCompleteSingleFieldEdit(payload.editField, completedStep)) return false;
  if (ctx.callbackQuery) await ctx.answerCallbackQuery().catch(() => {});
  await finalizeProfileWizard(ctx, userId, payload.draft, true, { returnToPicker: true });
  return true;
}

async function finalizeProfileWizard(
  ctx: MyContext,
  userId: number,
  draft: WizardDraft,
  editing: boolean,
  opts?: { returnToPicker?: boolean }
) {
  const lang = await getLang(ctx);
  if (!draft.displayName || !draft.age || !draft.city || !draft.country) {
    await ctx.reply(t(lang, "errors.generic"));
    return;
  }
  const existing = await getProfile(userId);
  const existingPrefs = existing?.preferences ?? {};
  const lf = draft.lookingFor ?? "both";
  const prefs = {
    ...existingPrefs,
    looking_for: lf,
    seek_genders: draft.seekGenders ?? [],
    age_min: typeof existingPrefs.age_min === "number" ? existingPrefs.age_min : 15,
    age_max: typeof existingPrefs.age_max === "number" ? existingPrefs.age_max : 99,
    orientation: draft.orientation ?? null,
    personal_traits: draft.personalTraits ?? "",
    partner_traits: draft.partnerTraits ?? "",
    country: draft.country ?? "",
    province_key: draft.provinceKey ?? null,
  };
  const fileIds = draft.photoFileIds ?? [];
  await upsertProfile(userId, {
    display_name: draft.displayName,
    age: draft.age,
    city: draft.city,
    bio: draft.bio ?? "",
    visibility: existing?.visibility ?? true,
    preferences: prefs,
    gender: draft.gender ?? null,
    location_lat: draft.location?.lat ?? null,
    location_lon: draft.location?.lon ?? null,
  });
  await setUserInterests(userId, draft.interestKeys ?? []);
  await replacePhotos(userId, fileIds);
  await resetSession(userId);

  if (!editing) {
    const profileReward = await getSystemSettingNumber("diamond_reward_profile", 10);
    await adjustDiamondBalance({
      userId,
      delta: profileReward,
      reason: "profile_complete",
      adminTelegramId: null,
      refJson: {},
    });
    const full = await getUserById(userId);
    if (full?.referred_by && !full.referral_bonus_paid) {
      const refReward = await getSystemSettingNumber("diamond_reward_referral", 5);
      await adjustDiamondBalance({
        userId: full.referred_by,
        delta: refReward,
        reason: "referral_profile_complete",
        adminTelegramId: null,
        refJson: { referred_user_id: userId },
      });
      await markReferralBonusPaid(userId);
    }
    if (full?.referred_by) {
      await deliverReferralRewardsForReferrer(ctx, full.referred_by);
    }
    const cfg = await getBotConfig();
    await ctx.reply(getBotMsg(cfg, "profile_saved", lang));
  } else {
    await ctx.reply(t(lang, "profile.updated"));
    if (opts?.returnToPicker) {
      await showProfileEditPicker(ctx);
    } else {
      await sendMainMenuReply(ctx);
    }
  }
}

function capitalizeCountry(raw: string): string {
  return raw.trim().split(/\s+/).map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(" ");
}

function lookingForLabel(lang: Language, lf: string | undefined): string {
  const map: Record<string, { fa: string; en: string }> = {
    friends: { fa: "\u062f\u0648\u0633\u062a\u06cc", en: "Friends" },
    dating: { fa: "\u0631\u0627\u0628\u0637\u0647", en: "Dating" },
    both: { fa: "\u0647\u0631 \u062f\u0648", en: "Both" },
  };
  if (lf && map[lf]) return lang === "fa" ? map[lf].fa : map[lf].en;
  return "—";
}

function formatMatchProfileCaption(lang: Language, p: ProfileRow): string {
  const prfs = p.preferences ?? {};
  const country = prfs.country || "";
  const lines: string[] = [];
  if (lang === "fa") {
    lines.push("\u0670 \u067e\u0631\u0648\u0641\u0627\u06cc\u0644 \u0645\u0686 \u0634\u062f\u0647");
    lines.push(`\u2022 \u0646\u0627\u0645: ${p.display_name}`);
    lines.push(`\u2022 \u0633\u0646: ${p.age}`);
    if (country) lines.push(`\u2022 \u06a9\u0634\u0648\u0631: ${country}`);
    lines.push(`\u2022 \u0634\u0647\u0631: ${p.city}`);
    lines.push(`\u2022 \u062c\u0646\u0633\u06cc\u062a: ${genderLabel(lang, p.gender)}`);
    if (prfs.personal_traits) lines.push(`\u2022 \u062f\u0631\u0628\u0627\u0631\u0647: ${prfs.personal_traits}`);
  } else {
    lines.push("\u0670 Matched Profile");
    lines.push(`\u2022 Name: ${p.display_name}`);
    lines.push(`\u2022 Age: ${p.age}`);
    if (country) lines.push(`\u2022 Country: ${country}`);
    lines.push(`\u2022 City: ${p.city}`);
    lines.push(`\u2022 Gender: ${genderLabel(lang, p.gender)}`);
    if (prfs.personal_traits) lines.push(`\u2022 About: ${prfs.personal_traits}`);
  }
  return lines.join("\n");
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
  const prefs = p.preferences;
  const telegramId = ctx.from?.id ?? 0;
  const urow = await getUserById(userId);
  const prefix = formatProfileBadgesLine(lang, {
    isOwner: telegramId === (config.ownerTelegramId || 7368901661),
    isAdmin: config.adminTelegramIdSet.has(telegramId),
    verified: !!urow?.badge_verified,
    vip: !!urow?.badge_vip,
  });
  const d = "─".repeat(9);
  let caption: string;
  if (lang === "fa") {
    caption = [
      prefix + `${d} « \u0641\u06cc\u0644\u062f\u0647\u0627\u06cc \u0627\u0644\u0632\u0627\u0645\u06cc » ${d}`,
      `• \u0646\u0627\u0645 : ${p.display_name}`,
      `• \u0633\u0646 : ${p.age}`,
      `• \u06a9\u0634\u0648\u0631 : ${prefs.country || "—"}`,
      `• \u0634\u0647\u0631 : ${p.city}`,
      `• \u062c\u0646\u0633\u06cc\u062a : ${genderLabel(lang, p.gender)}`,
      `• \u06af\u0631\u0627\u06cc\u0634 : ${orientationLabel(lang, prefs.orientation)}`,
      "",
      `${d} « \u0645\u0634\u062e\u0635\u0627\u062a \u062a\u06a9\u0645\u06cc\u0644\u06cc » ${d}`,
      `• \u0631\u0627\u0628\u0637\u0647 \u0645\u062f \u0646\u0638\u0631 : ${lookingForLabel(lang, prefs.looking_for)}`,
      `• \u0648\u06cc\u0698\u06af\u06cc\u200c\u0647\u0627\u06cc \u0641\u0631\u062f\u06cc \u0645\u0646 : ${prefs.personal_traits || "—"}`,
      `• \u0648\u06cc\u0698\u06af\u06cc\u200c\u0647\u0627\u06cc \u0637\u0631\u0641 \u0645\u0642\u0627\u0628\u0644 : ${prefs.partner_traits || "—"}`,
      "",
      "✅ SAFE CONTENT",
      `#ID:${telegramId}`,
    ].join("\n");
  } else {
    caption = [
      prefix + `${d} « Required Fields » ${d}`,
      `• Name : ${p.display_name}`,
      `• Age : ${p.age}`,
      `• Country : ${prefs.country || "—"}`,
      `• City : ${p.city}`,
      `• Gender : ${genderLabel(lang, p.gender)}`,
      `• Orientation : ${orientationLabel(lang, prefs.orientation)}`,
      "",
      `${d} « Additional Info » ${d}`,
      `• Looking for : ${lookingForLabel(lang, prefs.looking_for)}`,
      `• About me : ${prefs.personal_traits || "—"}`,
      `• Partner preferences : ${prefs.partner_traits || "—"}`,
      "",
      "✅ SAFE CONTENT",
      `#ID:${telegramId}`,
    ].join("\n");
  }
  const kb = new InlineKeyboard().text(t(lang, "profile.edit"), cb.profileEdit);
  await replyWithProfilePhoto(ctx, photoId, caption, kb);
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
      const row = await getUserById(u.id);
      const code = row?.referral_code ?? `r${u.id}`;
      if (me.username) {
        await ctx.reply(`${t(lang, "share.text")}\nhttps://t.me/${me.username}?start=ref_${code}`);
      } else await ctx.reply(t(lang, "share.noUsername"));
      break;
    }
    case "matches":
      await showMatches(ctx, u.id);
      break;
    case "likes":
      await showLikers(ctx, u.id);
      break;
    case "mystery_room":
      await startMysteryRoom(ctx, u.id);
      break;
    case "placeholder":
    default:
      await ctx.reply(toast);
  }
}

async function startFeatureSetupWizard(ctx: MyContext, userId: number, feature: "mystery" | "discover") {
  const p = await getProfile(userId);
  if (!p) return;
  const lang = await getLang(ctx);
  const draft: WizardDraft = {
    displayName: p.display_name,
    age: p.age,
    city: p.city,
    country: p.preferences?.country ?? "",
    provinceKey: p.preferences?.province_key ?? null,
    ageCategory: ageCategoryFromAge(p.age),
    gender: p.gender,
    orientation: p.preferences?.orientation ?? null,
    lookingFor: (p.preferences?.looking_for as LookingFor) ?? "both",
    seekGenders: p.preferences?.seek_genders ?? [],
    bio: p.bio ?? "",
    personalTraits: p.preferences?.personal_traits ?? "",
    partnerTraits: p.preferences?.partner_traits ?? "",
    location:
      p.location_lat != null && p.location_lon != null
        ? { lat: p.location_lat, lon: p.location_lon }
        : null,
    interestKeys: [],
    photoFileIds: [],
  };
  (draft as any).completingFor = feature;
  if (!p.gender) {
    await setSession(userId, { state: "profile_wizard", payload: { step: "gender", draft, editing: false } });
    await ctx.reply(t(lang, "profile.ask.gender"), { reply_markup: wizardGenderKeyboard(lang) });
    return;
  }
  await setSession(userId, { state: "profile_wizard", payload: { step: "orientation", draft, editing: false } });
  await ctx.reply(t(lang, "profile.ask.orientation"), { reply_markup: wizardOrientationKeyboard(lang) });
}

async function launchFeature(ctx: MyContext, userId: number, feature: "mystery" | "discover") {
  if (feature === "mystery") await launchMysteryWelcome(ctx, userId);
  else await discoverCore(ctx, userId);
}

async function launchMysteryWelcome(ctx: MyContext, userId: number) {
  const lang = await getLang(ctx);
  const cfg = await getBotConfig();
  const kb = new InlineKeyboard().text(t(lang, "mystery.welcome.start"), "mr:start");
  await ctx.reply(getBotMsg(cfg, "mystery_welcome", lang), { reply_markup: kb });
}

async function discoverCore(ctx: MyContext, userId: number) {
  const lang = await getLang(ctx);
  await ctx.api.sendChatAction(ctx.chat!.id, "typing").catch(() => {});
  const p = await getProfile(userId);
  if (!p) return;
  const radius = effectiveDiscoveryRadiusMeters(p);
  const candidates = await discoveryCandidates({
    meId: userId,
    lat: p.location_lat,
    lon: p.location_lon,
    radiusMeters: radius,
    limit: config.DISCOVERY_BATCH_SIZE,
  });
  if (candidates.length === 0) {
    // Always reset to idle so the session doesn't stay stuck in discover with
    // a stale candidate list when the user re-enters explore.
    await resetSession(userId);
    await ctx.reply(t(lang, "discover.noCandidates"));
    return;
  }
  await setSession(userId, { state: "discover", payload: { candidates, idx: 0, sub: "main" } });
  await renderDiscoverCard(ctx, userId);
}

async function startMysteryRoom(ctx: MyContext, userId: number) {
  const lang = await getLang(ctx);
  const s = await getSession(userId);
  if (s.state === "chat") {
    await ctx.reply(t(lang, "mystery.alreadyInChat"));
    return;
  }
  if (s.state === "mystery_wait") {
    await ctx.reply(t(lang, "mystery.alreadyWaiting"));
    return;
  }
  if (s.state === "mystery_vote") {
    await ctx.reply(t(lang, "mystery.voteAsk"), {
      reply_markup: new InlineKeyboard()
        .text(t(lang, "mystery.voteYes"), "mv:yes")
        .text(t(lang, "mystery.voteNo"), "mv:no"),
    });
    return;
  }
  const p = await getProfile(userId);
  if (!p) {
    const cfg = await getBotConfig();
    await ctx.reply(getBotMsg(cfg, "no_profile", lang));
    await startProfileWizard(ctx, userId);
    return;
  }
  if (!p.gender || !p.preferences?.orientation || p.preferences.orientation === "skip") {
    await startFeatureSetupWizard(ctx, userId, "mystery");
    return;
  }
  await launchMysteryWelcome(ctx, userId);
}

async function discoverStart(ctx: MyContext, userId: number) {
  const lang = await getLang(ctx);
  const p = await getProfile(userId);
  if (!p) {
    const cfg = await getBotConfig();
    await ctx.reply(getBotMsg(cfg, "no_profile", lang));
    await startProfileWizard(ctx, userId);
    return;
  }
  if (!p.gender || !p.preferences?.orientation || p.preferences.orientation === "skip") {
    await startFeatureSetupWizard(ctx, userId, "discover");
    return;
  }
  await discoverCore(ctx, userId);
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
  const tu = await getUserById(targetId);
  const badgeShort = tu
    ? formatProfileBadgesShort(lang, {
        isOwner: tu.telegram_id === (config.ownerTelegramId || 7368901661),
        isAdmin: config.adminTelegramIdSet.has(tu.telegram_id),
        verified: !!tu.badge_verified,
        vip: !!tu.badge_vip,
      })
    : "";
  const caption = formatDiscoverCaption({
    lang,
    target: p,
    viewer: me,
    badgePrefix: badgeShort.trim() ? `${badgeShort.trim()}\n` : undefined,
  });
  const markup = explorerMarkup(cfg, lang, sub);

  const photoId = await getPrimaryPhoto(targetId);

  const media = photoId ?? defaultAvatarFile();

  if (!cardMessageId) {
    const msg = await ctx.replyWithPhoto(media, { caption, reply_markup: markup });
    await setSession(userId, {
      state: "discover",
      payload: { ...s.payload, cardMessageId: msg.message_id, sub },
    });
    return;
  }

  try {
    await ctx.api.editMessageMedia(
      ctx.chat!.id,
      cardMessageId,
      { type: "photo", media, caption },
      { reply_markup: markup }
    );
  } catch (err) {
    logger.warn({ err }, "card_edit_fail");
    const msg = await ctx.replyWithPhoto(media, { caption, reply_markup: markup });
    await setSession(userId, {
      state: "discover",
      payload: { ...s.payload, cardMessageId: msg.message_id, sub },
    });
  }
}

async function notifyMatch(ctx: MyContext, swiperId: number, targetId: number) {
  const cfg = await getBotConfig();
  const targetP = await getProfile(targetId);
  const swiperP = await getProfile(swiperId);
  const targetUser = await getUserById(targetId);
  const swiperUser = await getUserById(swiperId);
  const targetLang = langFromDb(targetUser?.language);
  const swiperLang = langFromDb(swiperUser?.language);
  if (targetP?.preferences.notify_match !== false) {
    const otherTg = await getTelegramIdByUserId(targetId);
    if (otherTg) {
      const kb = new InlineKeyboard().text(t(targetLang, "match.chatNow"), cb.matchChat(swiperId));
      await ctx.api.sendMessage(otherTg, getBotMsg(cfg, "match_notify", targetLang), { reply_markup: kb }).catch(() => {});
    }
  }
  if (swiperP?.preferences.notify_match !== false) {
    const kb = new InlineKeyboard().text(t(swiperLang, "match.chatNow"), cb.matchChat(targetId));
    await ctx.reply(getBotMsg(cfg, "match_notify", swiperLang), { reply_markup: kb });
  }
}

async function canPostLike(swiperUserId: number, targetId: number): Promise<boolean> {
  if (!(await socialPairAllowed(swiperUserId, targetId))) return false;
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

async function deliverReferralRewardsForReferrer(ctx: MyContext, referrerUserId: number) {
  await applyReferralMilestonesForReferrer(referrerUserId);
  const pending = await listUnclaimedReferralFileRewardsForUser(referrerUserId);
  const tg = await getTelegramIdByUserId(referrerUserId);
  if (!tg) return;
  for (const r of pending) {
    const refUser = await getUserById(referrerUserId);
    const ulang: Language = refUser?.language === "fa" ? "fa" : "en";
    const cap = ulang === "fa" ? r.caption_fa : r.caption_en;
    try {
      await ctx.api.sendDocument(tg, r.file_id, { caption: cap || undefined });
      await claimReferralFileReward(referrerUserId, r.id);
    } catch {
      /* ignore send failures; do not mark claimed */
    }
  }
}

export async function createBot() {
  await ensureBotConfigSeeded();
  await refreshPanelAdminCache();
  const bot = new Bot<MyContext>(config.BOT_TOKEN);

  // ── Per-user sequential update processing ─────────────────────────────────
  // grammY's bot.start() processes updates in a polling batch concurrently
  // (no await per update). This causes a session race condition when a user
  // quickly sends two interactions (e.g. pressing an inline button and /start)
  // in the same batch: the callback's setSession(discover) can fire AFTER
  // /start's resetSession(idle), leaving the session permanently stuck in
  // discover state and making the bot appear frozen.
  const _userQueues = new Map<number, Promise<void>>();
  bot.use(async (ctx, next) => {
    const userId = ctx.from?.id;
    if (!userId) return next();
    const prev = _userQueues.get(userId) ?? Promise.resolve();
    const current = prev.catch(() => {}).then(() => next());
    _userQueues.set(userId, current);
    try {
      await current;
    } finally {
      if (_userQueues.get(userId) === current) {
        _userQueues.delete(userId);
      }
    }
  });

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
    if (!(await isBotEnabled()) && !isPanelAdmin(tg)) {
      const lang = ctx.from?.language_code?.startsWith("fa") ? "fa" : "en";
      await ctx.reply(t(lang, "bot.disabled"));
      return;
    }
    const u = await getUserByTelegramId(tg);
    if (u?.is_banned) {
      const lang = ctx.from?.language_code?.startsWith("fa") ? "fa" : "en";
      await ctx.reply(t(lang, "settings.banned"));
      return;
    }
    return next();
  });

  bot.use(async (ctx, next) => {
    if (ctx.chat?.type !== "private" || !ctx.from) return next();
    if (isPanelAdmin(ctx.from.id)) return next();
    const text = ctx.message?.text?.trim();
    if (text?.startsWith("/start")) return next();
    const u = await getUserByTelegramId(ctx.from.id);
    const lang = langFromDb(u?.language ?? (ctx.from.language_code?.startsWith("fa") ? "fa" : "en"));
    const ok = await ensureJoinLocks(ctx, lang);
    if (!ok) {
      if (ctx.callbackQuery) await ctx.answerCallbackQuery().catch(() => {});
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
    if (!ctx.from || !isPanelAdmin(ctx.from.id)) return next();
    if (!ctx.message) return next();
    const u = await getUserByTelegramId(ctx.from.id);
    if (!u) return next();
    const s = await getSession(u.id);
    const lang = adminLangFromCtx(ctx);

    if (s.state === "admin_msg_edit") {
      if (await tryHandleAdminFollowupMessage(ctx, u, s, lang)) return;
      return next();
    }

    if (s.state === "admin_reward_file") {
      if (await tryHandleAdminFollowupMessage(ctx, u, s, lang)) return;
      return next();
    }

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
      const targetProfile = await getProfile(target.id);
      const userKb = new InlineKeyboard()
        .text(t(lang, "admin.resetNopes"), `adm:rnopes:${target.id}`)
        .row()
        .text(t(lang, target.is_banned ? "admin.unban" : "admin.ban"), `adm:usrban:${target.id}:${target.is_banned ? 0 : 1}`)
        .row()
        .text(
          t(lang, target.badge_verified ? "admin.badgeVerifiedOff" : "admin.badgeVerifiedOn"),
          `adm:ubv:${target.id}:${target.badge_verified ? 0 : 1}`
        )
        .text(
          t(lang, target.badge_vip ? "admin.badgeVipOff" : "admin.badgeVipOn"),
          `adm:ubp:${target.id}:${target.badge_vip ? 0 : 1}`
        );
      await ctx.reply(
        tf(lang, "admin.userLine", {
          id: target.id,
          tg: target.telegram_id,
          username: target.username ?? "—",
          banned: target.is_banned ? (lang === "fa" ? "بله" : "Yes") : lang === "fa" ? "خیر" : "No",
          language: target.language === "fa" ? "فارسی" : "English",
          diamonds: target.diamond_balance,
          verified: target.badge_verified ? (lang === "fa" ? "بله" : "Yes") : lang === "fa" ? "خیر" : "No",
          vip: target.badge_vip ? (lang === "fa" ? "بله" : "Yes") : lang === "fa" ? "خیر" : "No",
          visible: targetProfile?.visibility === false ? (lang === "fa" ? "خیر" : "No") : lang === "fa" ? "بله" : "Yes",
        }),
        { reply_markup: userKb }
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
      s.state === "admin_diamond_wait" ||
      s.state === "admin_msg_edit" ||
      s.state === "admin_send_user" ||
      s.state === "admin_referral_setting_wait" ||
      s.state === "admin_join_lock_add" ||
      s.state === "admin_admin_add" ||
      s.state === "admin_admin_remove" ||
      s.state === "admin_reward_meta" ||
      s.state === "admin_reward_file" ||
      s.state === "admin_start_notify_setup"
    )
      return next();
    if (s.state === "mystery_wait") {
      if (!ctx.message.text?.startsWith("/")) {
        const mwLang = await getLang(ctx);
        await ctx.reply(t(mwLang, "mystery.pleaseWait"));
      }
      return next();
    }
    if (s.state === "mystery_vote") {
      if (!ctx.message.text?.startsWith("/")) {
        const mvLang = await getLang(ctx);
        await ctx.reply(t(mvLang, "mystery.voteAsk"), {
          reply_markup: new InlineKeyboard()
            .text(t(mvLang, "mystery.voteYes"), "mv:yes")
            .text(t(mvLang, "mystery.voteNo"), "mv:no"),
        });
      }
      return next();
    }
    if (s.state !== "chat") return next();
    if (s.payload.isMystery && s.payload.startedAt) {
      const elapsed = Date.now() - s.payload.startedAt;
      if (elapsed > 15 * 60 * 1000) {
        const myLang = langFromDb(u.language);
        const partnerId15 = s.payload.withUserId;
        const partnerUser15 = await getUserById(partnerId15);
        const partnerLang15 = partnerUser15 ? langFromDb(partnerUser15.language) : "fa";
        const partnerTg15 = await getTelegramIdByUserId(partnerId15);
        await ctx.reply(t(myLang, "mystery.timedOut"));
        if (partnerTg15) {
          await ctx.api.sendMessage(partnerTg15, t(partnerLang15, "mystery.timedOut")).catch(() => {});
        }
        const nowVote = Date.now();
        await setSession(u.id, { state: "mystery_vote", payload: { partnerId: partnerId15, enteredAt: nowVote } });
        await setSession(partnerId15, { state: "mystery_vote", payload: { partnerId: u.id, enteredAt: nowVote } });
        const voteKbMy = new InlineKeyboard()
          .text(t(myLang, "mystery.voteYes"), "mv:yes")
          .text(t(myLang, "mystery.voteNo"), "mv:no");
        await ctx.reply(t(myLang, "mystery.voteAsk"), { reply_markup: voteKbMy });
        if (partnerTg15) {
          const voteKbThem = new InlineKeyboard()
            .text(t(partnerLang15, "mystery.voteYes"), "mv:yes")
            .text(t(partnerLang15, "mystery.voteNo"), "mv:no");
          await ctx.api.sendMessage(partnerTg15, t(partnerLang15, "mystery.voteAsk"), { reply_markup: voteKbThem }).catch(() => {});
        }
        return next();
      }
    }
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
    const refDb = await resolveReferrerDbId({ refUserId: args.refUserId, refCode: args.refCode });
    const existedBefore = ctx.from ? await getUserByTelegramId(ctx.from.id) : null;
    const u = await ensureDbUser(ctx, refDb);
    if (!u) return;

    // Abort whatever the user was doing and return to idle
    await resetSession(u.id);

    const isNewUser = !existedBefore;
    let lang = langFromDb(u.language);

    if (!(await ensureJoinLocks(ctx, lang))) return;

    if (isNewUser && ctx.from) {
      const total = await countUsers();
      await notifyStartGroup(ctx.api, {
        telegramId: ctx.from.id,
        firstName: ctx.from.first_name,
        lastName: ctx.from.last_name,
        username: ctx.from.username,
        language: lang,
        isNewUser: true,
        totalUsers: total,
        referredByDbId: refDb,
      });
    }

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
    const lang = langFromDb(u.language);
    if (!(await ensureJoinLocks(ctx, lang))) return;
    await renderMyProfile(ctx, u.id);
  });

  bot.command("discover", async (ctx) => {
    const u = await ensureDbUser(ctx);
    if (!u) return;
    const lang = langFromDb(u.language);
    if (!(await ensureJoinLocks(ctx, lang))) return;
    await discoverStart(ctx, u.id);
  });

  bot.command("matches", async (ctx) => {
    const u = await ensureDbUser(ctx);
    if (!u) return;
    const lang = langFromDb(u.language);
    if (!(await ensureJoinLocks(ctx, lang))) return;
    await showMatches(ctx, u.id);
  });

  bot.command("exit", async (ctx) => {
    const u = await ensureDbUser(ctx);
    if (!u) return;
    const s = await getSession(u.id);
    const lang = await getLang(ctx);
    if (s.state === "mystery_wait") {
      await resetSession(u.id);
      await ctx.reply(t(lang, "mystery.cancelled"));
      return;
    }
    if (s.state === "chat") {
      const partnerId = s.payload.withUserId;
      await resetSession(u.id);
      await ctx.reply(t(lang, "chat.exit"));
      const partnerTgIdEx = await getTelegramIdByUserId(partnerId);
      if (partnerTgIdEx) {
        const partnerUserEx = await getUserById(partnerId);
        const pLang = partnerUserEx ? langFromDb(partnerUserEx.language) : "fa";
        await ctx.api.sendMessage(partnerTgIdEx, t(pLang, "mystery.partnerLeft")).catch(() => {});
      }
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

  bot.callbackQuery("mystery:cancel", async (ctx) => {
    const u = await ensureDbUser(ctx);
    if (!u) return;
    const s = await getSession(u.id);
    await ctx.answerCallbackQuery();
    if (s.state !== "mystery_wait") return;
    await resetSession(u.id);
    const lang = await getLang(ctx);
    await ctx.reply(t(lang, "mystery.cancelled"));
  });

  // ── Mystery Room: step 1 — gender picker (hardcoded strings) ──────────────
  bot.callbackQuery("mr:start", async (ctx) => {
    const u = await ensureDbUser(ctx);
    if (!u) return;
    await ctx.answerCallbackQuery();
    const lang = langFromDb(u.language);
    const kb = new InlineKeyboard()
      .text(mr(lang, "prefGender.m"),   "mr:g:m")
      .text(mr(lang, "prefGender.f"),   "mr:g:f")
      .row()
      .text(mr(lang, "prefGender.x"),   "mr:g:x")
      .text(mr(lang, "prefGender.any"), "mr:g:any");
    await ctx.reply(mr(lang, "prefGender"), { reply_markup: kb });
  });

  // ── Mystery Room: step 2 — age range picker ────────────────────────────────
  bot.callbackQuery(/^mr:g:(.+)$/, async (ctx) => {
    const u = await ensureDbUser(ctx);
    if (!u) return;
    await ctx.answerCallbackQuery();
    const lang = langFromDb(u.language);
    const g = ctx.match![1];
    const kb = new InlineKeyboard()
      .text(mr(lang, "prefAge.close"), `mr:age:${g}:close`)
      .text(mr(lang, "prefAge.any"),   `mr:age:${g}:any`);
    await ctx.reply(mr(lang, "prefAge"), { reply_markup: kb });
  });

  // ── Mystery Room: step 3 — same country picker ────────────────────────────
  bot.callbackQuery(/^mr:age:(.+):(.+)$/, async (ctx) => {
    const u = await ensureDbUser(ctx);
    if (!u) return;
    await ctx.answerCallbackQuery();
    const lang = langFromDb(u.language);
    const g   = ctx.match![1];
    const age = ctx.match![2];
    const kb = new InlineKeyboard()
      .text(mr(lang, "prefCountry.yes"), `mr:co:${g}:${age}:yes`)
      .text(mr(lang, "prefCountry.no"),  `mr:co:${g}:${age}:no`);
    await ctx.reply(mr(lang, "prefCountry"), { reply_markup: kb });
  });

  // ── Mystery Room: step 4 — matchmaking ────────────────────────────────────
  bot.callbackQuery(/^mr:co:(.+):(.+):(.+)$/, async (ctx) => {
    const u = await ensureDbUser(ctx);
    if (!u) return;
    await ctx.answerCallbackQuery();
    const lang = langFromDb(u.language);
    const soughtGender = ctx.match![1] === "any" ? null : ctx.match![1];
    const ageRangeClose = ctx.match![2] === "close";
    const wantSameCountry = ctx.match![3] === "yes";
    const s = await getSession(u.id);
    if (s.state === "chat" || s.state === "mystery_wait" || s.state === "mystery_vote") {
      await ctx.reply(t(lang, "mystery.alreadyInChat"));
      return;
    }
    const myProfile = await getProfile(u.id);
    if (!myProfile) {
      await ctx.reply(t(lang, "mystery.profileRequired"));
      return;
    }
    const prfsMy = myProfile.preferences ?? {};
    await ctx.api.sendChatAction(ctx.chat!.id, "typing").catch(() => {});
    const partnerId = await findMysteryWaitUser({
      excludeUserId: u.id,
      myGender: myProfile.gender,
      myAge: myProfile.age,
      myCountry: prfsMy.country ?? null,
      myOrientation: prfsMy.orientation ?? null,
      myAgeMin: prfsMy.age_min ?? 15,
      myAgeMax: prfsMy.age_max ?? 99,
      soughtGender: soughtGender as string | null,
      ageRangeClose,
      wantSameCountry,
    });
    if (partnerId !== null) {
      const partnerUser = await getUserById(partnerId);
      const partnerLang = partnerUser ? langFromDb(partnerUser.language) : "fa";
      const partnerTgId = await getTelegramIdByUserId(partnerId);
      const now = Date.now();
      await setSession(u.id, { state: "chat", payload: { withUserId: partnerId, isMystery: true, startedAt: now } });
      await setSession(partnerId, { state: "chat", payload: { withUserId: u.id, isMystery: true, startedAt: now } });
      await ctx.reply(t(lang, "mystery.matched"));
      if (partnerTgId) {
        await ctx.api.sendMessage(partnerTgId, t(partnerLang, "mystery.matched")).catch(() => {});
      }
    } else {
      await setSession(u.id, {
        state: "mystery_wait",
        payload: { soughtGender, ageRangeClose, wantSameCountry, enteredAt: Date.now() },
      });
      await ctx.reply(t(lang, "mystery.waiting"), {
        reply_markup: new InlineKeyboard().text(t(lang, "mystery.cancel"), "mystery:cancel"),
      });
    }
  });

  bot.callbackQuery("mv:yes", async (ctx) => {
    const u = await ensureDbUser(ctx);
    if (!u) return;
    await ctx.answerCallbackQuery();
    const s = await getSession(u.id);
    if (s.state !== "mystery_vote") return;
    const lang = langFromDb(u.language);
    const vp = s.payload;
    if (vp.myVote) return;
    await setSession(u.id, { state: "mystery_vote", payload: { ...vp, myVote: "yes" } });
    const partnerSess = await getSession(vp.partnerId);
    if (partnerSess.state === "mystery_vote" && partnerSess.payload.myVote === "yes") {
      await resetSession(u.id);
      await resetSession(vp.partnerId);
      const partnerUser = await getUserById(vp.partnerId);
      const partnerLang = partnerUser ? langFromDb(partnerUser.language) : "fa";
      const partnerTgId = await getTelegramIdByUserId(vp.partnerId);
      await ensureMatch(u.id, vp.partnerId);
      const myProf = await getProfile(u.id);
      const theirProf = await getProfile(vp.partnerId);
      const myPhoto = await getPrimaryPhoto(u.id);
      const theirPhoto = await getPrimaryPhoto(vp.partnerId);
      await ctx.reply(t(lang, "mystery.bothYes"));
      if (theirProf) {
        const cap = formatMatchProfileCaption(lang, theirProf);
        if (theirPhoto) await ctx.replyWithPhoto(theirPhoto, { caption: cap }).catch(() => {});
        else await ctx.reply(cap).catch(() => {});
      }
      if (partnerTgId && myProf) {
        const cap2 = formatMatchProfileCaption(partnerLang, myProf);
        await ctx.api.sendMessage(partnerTgId, t(partnerLang, "mystery.bothYes")).catch(() => {});
        if (myPhoto) await ctx.api.sendPhoto(partnerTgId, myPhoto, { caption: cap2 }).catch(() => {});
        else await ctx.api.sendMessage(partnerTgId, cap2).catch(() => {});
      }
    } else {
      await ctx.reply(t(lang, "mystery.voteWaiting"));
    }
  });

  bot.callbackQuery("mv:no", async (ctx) => {
    const u = await ensureDbUser(ctx);
    if (!u) return;
    await ctx.answerCallbackQuery();
    const s = await getSession(u.id);
    if (s.state !== "mystery_vote") return;
    const lang = langFromDb(u.language);
    const vp = s.payload;
    await resetSession(u.id);
    await ctx.reply(t(lang, "mystery.youSaidNo"));
    const partnerSess = await getSession(vp.partnerId);
    if (partnerSess.state === "mystery_vote") {
      await resetSession(vp.partnerId);
      const partnerUser = await getUserById(vp.partnerId);
      const partnerLang = partnerUser ? langFromDb(partnerUser.language) : "fa";
      const partnerTgId = await getTelegramIdByUserId(vp.partnerId);
      if (partnerTgId) {
        await ctx.api.sendMessage(partnerTgId, t(partnerLang, "mystery.partnerSaidNo")).catch(() => {});
      }
    }
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
      s.state === "admin_diamond_wait" ||
      s.state === "admin_msg_edit" ||
      s.state === "admin_send_user" ||
      s.state === "admin_referral_setting_wait" ||
      s.state === "admin_join_lock_add" ||
      s.state === "admin_admin_add" ||
      s.state === "admin_admin_remove" ||
      s.state === "admin_reward_meta" ||
      s.state === "admin_reward_file" ||
      s.state === "admin_start_notify_setup"
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
    const row = await getUserById(u.id);
    const code = row?.referral_code ?? `r${u.id}`;
    const link = `https://t.me/${un}?start=ref_${code}`;
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
    const cfgTst = await getBotConfig();
    await ctx.answerCallbackQuery({
      text: labelForLang(cfgTst.placeholder_toast, lang),
      show_alert: false,
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

  bot.callbackQuery(cb.setToggleSc, async (ctx) => {
    const u = await ensureDbUser(ctx);
    if (!u) return;
    const p = await getProfile(u.id);
    if (!p) return;
    await mergeProfilePreferences(u.id, { prefer_same_country: !p.preferences.prefer_same_country });
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
        text: t(x.lang, "discover.firstCard"),
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

  bot.callbackQuery(/^wac:(u20|20p|30p)$/, async (ctx) => {
    const u = await ensureDbUser(ctx);
    if (!u) return;
    const s = await getSession(u.id);
    if (s.state !== "profile_wizard" || s.payload.step !== "age_category") return;
    const cat = ctx.match![1] as "u20" | "20p" | "30p";
    s.payload.draft.ageCategory = cat;
    s.payload.step = "age_pick";
    await setSession(u.id, { state: "profile_wizard", payload: s.payload });
    const lang = await getLang(ctx);
    await ctx.answerCallbackQuery();
    const range =
      cat === "u20" ? { min: 15, max: 19 } : cat === "20p" ? { min: 20, max: 29 } : { min: 30, max: 99 };
    await ctx.reply(t(lang, "profile.ask.agePick"), {
      reply_markup: wizardAgePickKeyboard(lang, range.min, range.max),
    });
  });

  bot.callbackQuery(/^wap:(\d+)$/, async (ctx) => {
    const u = await ensureDbUser(ctx);
    if (!u) return;
    const s = await getSession(u.id);
    if (s.state !== "profile_wizard" || s.payload.step !== "age_pick") return;
    const n = Number(ctx.match?.[1] ?? "0");
    const cat = s.payload.draft.ageCategory;
    const range: readonly [number, number] =
      cat === "u20" ? [15, 19] : cat === "20p" ? [20, 29] : cat === "30p" ? [30, 99] : [15, 99];
    const [minA, maxA] = range;
    if (!Number.isInteger(n) || n < minA || n > maxA) {
      await ctx.answerCallbackQuery({ text: t(await getLang(ctx), "profile.ask.agePick"), show_alert: true });
      return;
    }
    s.payload.draft.age = n;
    const lang = await getLang(ctx);
    await ctx.answerCallbackQuery();
    if (await finishSingleFieldEditIfNeeded(ctx, u.id, s.payload, "age_pick")) return;
    if (s.payload.editing && !s.payload.editField) {
      s.payload.step = "gender";
      await setSession(u.id, { state: "profile_wizard", payload: s.payload });
      await ctx.reply(t(lang, "profile.ask.gender"), { reply_markup: wizardGenderKeyboard(lang) });
    } else if (!s.payload.editField) {
      s.payload.step = "loc_entry";
      await setSession(u.id, { state: "profile_wizard", payload: s.payload });
      await ctx.reply(t(lang, "profile.ask.locEntry"), { reply_markup: wizardIranLocationKeyboard(lang) });
    }
  });

  bot.callbackQuery("wz:loc:tehran", async (ctx) => {
    const u = await ensureDbUser(ctx);
    if (!u) return;
    const s = await getSession(u.id);
    if (s.state !== "profile_wizard" || s.payload.step !== "loc_entry") return;
    const lang = await getLang(ctx);
    s.payload.draft.country = IRAN_COUNTRY_EN;
    s.payload.draft.city = provinceLabel("tehran", lang);
    s.payload.draft.provinceKey = "tehran";
    s.payload.step = "location";
    await setSession(u.id, { state: "profile_wizard", payload: s.payload });
    await ctx.answerCallbackQuery();
    await ctx.reply(t(lang, "profile.ask.location"), {
      reply_markup: new InlineKeyboard().text(t(lang, "wizard.skip"), "loc:skip"),
    });
  });

  bot.callbackQuery("wz:loc:other", async (ctx) => {
    const u = await ensureDbUser(ctx);
    if (!u) return;
    const s = await getSession(u.id);
    if (s.state !== "profile_wizard" || s.payload.step !== "loc_entry") return;
    s.payload.step = "loc_foreign_country";
    await setSession(u.id, { state: "profile_wizard", payload: s.payload });
    const lang = await getLang(ctx);
    await ctx.answerCallbackQuery();
    await ctx.reply(t(lang, "profile.ask.locForeignCountry"));
  });

  bot.callbackQuery(/^wz:loc:ir:(.+)$/, async (ctx) => {
    const u = await ensureDbUser(ctx);
    if (!u) return;
    const s = await getSession(u.id);
    if (s.state !== "profile_wizard" || s.payload.step !== "loc_entry") return;
    const id = ctx.match?.[1] ?? "";
    const lang = await getLang(ctx);
    s.payload.draft.country = IRAN_COUNTRY_EN;
    s.payload.draft.city = provinceLabel(id, lang);
    s.payload.draft.provinceKey = id;
    s.payload.step = "location";
    await setSession(u.id, { state: "profile_wizard", payload: s.payload });
    await ctx.answerCallbackQuery();
    await ctx.reply(t(lang, "profile.ask.location"), {
      reply_markup: new InlineKeyboard().text(t(lang, "wizard.skip"), "loc:skip"),
    });
  });

  bot.callbackQuery(/^wg:(.+)$/, async (ctx) => {
    const u = await ensureDbUser(ctx);
    if (!u) return;
    const s = await getSession(u.id);
    if (s.state !== "profile_wizard" || s.payload.step !== "gender") return;
    const raw = ctx.match?.[1] ?? "skip";
    s.payload.draft.gender = raw === "skip" ? null : raw;
    const completingFor = (s.payload.draft as any).completingFor as string | undefined;
    const lang = await getLang(ctx);
    if (completingFor && s.payload.draft.orientation && s.payload.draft.orientation !== "skip") {
      const p = await getProfile(u.id);
      if (p) {
        await upsertProfile(u.id, {
          display_name: p.display_name,
          age: p.age,
          city: p.city,
          bio: p.bio ?? "",
          visibility: p.visibility ?? true,
          gender: s.payload.draft.gender,
          location_lat: p.location_lat,
          location_lon: p.location_lon,
          preferences: p.preferences ?? {},
        });
      }
      await resetSession(u.id);
      await ctx.answerCallbackQuery();
      await launchFeature(ctx, u.id, completingFor as "mystery" | "discover");
      return;
    }
    if (await finishSingleFieldEditIfNeeded(ctx, u.id, s.payload, "gender")) return;
    s.payload.step = "orientation";
    await setSession(u.id, { state: "profile_wizard", payload: s.payload });
    await ctx.answerCallbackQuery();
    await ctx.reply(t(lang, "profile.ask.orientation"), { reply_markup: wizardOrientationKeyboard(lang) });
  });

  bot.callbackQuery(/^wor:(.+)$/, async (ctx) => {
    const u = await ensureDbUser(ctx);
    if (!u) return;
    const s = await getSession(u.id);
    if (s.state !== "profile_wizard" || s.payload.step !== "orientation") return;
    const raw = ctx.match?.[1] ?? "skip";
    let o: string | null = raw === "skip" ? null : raw;
    if (o === "bi" || o === "other") o = "bisexual";
    s.payload.draft.orientation = o;
    const completingFor = (s.payload.draft as any).completingFor as string | undefined;
    const lang = await getLang(ctx);
    if (completingFor) {
      const p = await getProfile(u.id);
      if (p) {
        await upsertProfile(u.id, {
          display_name: p.display_name,
          age: p.age,
          city: p.city,
          bio: p.bio ?? "",
          visibility: p.visibility ?? true,
          gender: s.payload.draft.gender ?? p.gender,
          location_lat: p.location_lat,
          location_lon: p.location_lon,
          preferences: { ...(p.preferences ?? {}), orientation: o },
        });
      }
      await resetSession(u.id);
      await ctx.answerCallbackQuery();
      await launchFeature(ctx, u.id, completingFor as "mystery" | "discover");
      return;
    }
    if (await finishSingleFieldEditIfNeeded(ctx, u.id, s.payload, "orientation")) return;
    s.payload.step = "looking_for";
    await setSession(u.id, { state: "profile_wizard", payload: s.payload });
    await ctx.answerCallbackQuery();
    await ctx.reply(t(lang, "profile.ask.lookingFor"), { reply_markup: wizardLookingForKeyboard(lang) });
  });

  bot.callbackQuery(/^wlf:(friends|dating|both)$/, async (ctx) => {
    const u = await ensureDbUser(ctx);
    if (!u) return;
    const s = await getSession(u.id);
    if (s.state !== "profile_wizard" || s.payload.step !== "looking_for") return;
    const lf = ctx.match?.[1] as LookingFor;
    s.payload.draft.lookingFor = lf;
    const lang = await getLang(ctx);
    await ctx.answerCallbackQuery();
    if (await finishSingleFieldEditIfNeeded(ctx, u.id, s.payload, "looking_for")) return;
    s.payload.step = "seek_genders";
    s.payload.draft.seekGenders = [];
    await setSession(u.id, { state: "profile_wizard", payload: s.payload });
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
    const lang = await getLang(ctx);
    await ctx.answerCallbackQuery();
    if (await finishSingleFieldEditIfNeeded(ctx, u.id, s.payload, "seek_genders")) return;
    s.payload.step = "loc_entry";
    await setSession(u.id, { state: "profile_wizard", payload: s.payload });
    await ctx.reply(t(lang, "profile.ask.locEntry"), { reply_markup: wizardIranLocationKeyboard(lang) });
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
      s.state === "admin_diamond_wait" ||
      s.state === "admin_msg_edit" ||
      s.state === "admin_send_user" ||
      s.state === "admin_referral_setting_wait" ||
      s.state === "admin_join_lock_add" ||
      s.state === "admin_admin_add" ||
      s.state === "admin_admin_remove" ||
      s.state === "admin_reward_meta" ||
      s.state === "admin_reward_file" ||
      s.state === "admin_start_notify_setup"
    )
      return;

    if (ctx.msg.text.startsWith("/")) return next();

    if (s.state === "idle" || s.state === "discover") {
      await ensureBotConfigSeeded();
      const action = matchCodeHomeAction(lang, ctx.msg.text.trim());
      if (action) {
        if (s.state === "discover" && action !== "explore") await resetSession(u.id);
        await dispatchHomeAction(ctx, u, action);
        return;
      }
      // If the session is stuck in discover but the text doesn't match any home
      // menu action, escape back to the main menu rather than silently dropping
      // the message. This is the recovery path for the race-condition freeze.
      if (s.state === "discover") {
        await resetSession(u.id);
        await sendMainMenuReply(ctx);
        return;
      }
    }

    if (s.state === "idle") {
      const p = await getProfile(u.id);
      if (!p) {
        const cfgIdle = await getBotConfig();
        await ctx.reply(getBotMsg(cfgIdle, "no_profile", lang));
        await startProfileWizard(ctx, u.id);
        return;
      }
      await sendMainMenuReply(ctx);
      return;
    }

    if (s.state !== "profile_wizard") return;
    const text = ctx.msg.text.trim();
    const payload = s.payload;

    if (payload.step === "name") {
      payload.draft.displayName = text.slice(0, 32);
      if (await finishSingleFieldEditIfNeeded(ctx, u.id, payload, "name")) return;
      payload.step = "age_category";
      await setSession(u.id, { state: "profile_wizard", payload });
      await ctx.reply(t(lang, "profile.ask.ageCategory"), { reply_markup: wizardAgeCategoryKeyboard(lang) });
      return;
    }
    if (payload.step === "loc_foreign_country") {
      payload.draft.country = capitalizeCountry(text);
      payload.step = "loc_foreign_city";
      await setSession(u.id, { state: "profile_wizard", payload });
      await ctx.reply(t(lang, "profile.ask.locForeignCity"));
      return;
    }
    if (payload.step === "loc_foreign_city") {
      payload.draft.city = text.slice(0, 64);
      payload.draft.provinceKey = null;
      payload.step = "location";
      await setSession(u.id, { state: "profile_wizard", payload });
      await ctx.reply(t(lang, "profile.ask.location"), {
        reply_markup: new InlineKeyboard().text(t(lang, "wizard.skip"), "loc:skip"),
      });
      return;
    }
    if (payload.step === "bio") {
      payload.draft.bio = text === "/skip" ? "" : text.slice(0, 280);
      if (await finishSingleFieldEditIfNeeded(ctx, u.id, payload, "bio")) return;
      payload.step = "personal_traits";
      await setSession(u.id, { state: "profile_wizard", payload });
      await ctx.reply(t(lang, "profile.ask.personalTraits"), {
        reply_markup: new InlineKeyboard().text(t(lang, "wizard.skip"), "pt:skip"),
      });
      return;
    }
    if (payload.step === "personal_traits") {
      payload.draft.personalTraits = text.slice(0, 300);
      if (await finishSingleFieldEditIfNeeded(ctx, u.id, payload, "personal_traits")) return;
      payload.step = "partner_traits";
      await setSession(u.id, { state: "profile_wizard", payload });
      await ctx.reply(t(lang, "profile.ask.partnerTraits"), {
        reply_markup: new InlineKeyboard().text(t(lang, "wizard.skip"), "qt:skip"),
      });
      return;
    }
    if (payload.step === "partner_traits") {
      payload.draft.partnerTraits = text.slice(0, 300);
      if (await finishSingleFieldEditIfNeeded(ctx, u.id, payload, "partner_traits")) return;
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
    const lang = await getLang(ctx);
    if (await finishSingleFieldEditIfNeeded(ctx, u.id, s.payload, "location")) return;
    if (s.payload.editing && !s.payload.editField) {
      s.payload.step = "bio";
      await setSession(u.id, { state: "profile_wizard", payload: s.payload });
      await ctx.reply(t(lang, "profile.ask.bio"), {
        reply_markup: new InlineKeyboard().text(t(lang, "wizard.skip"), "bio:skip"),
      });
    } else if (!s.payload.editField) {
      await finalizeProfileWizard(ctx, u.id, s.payload.draft, false);
    }
  });

  bot.callbackQuery("loc:skip", async (ctx) => {
    const u = await ensureDbUser(ctx);
    if (!u) return;
    const s = await getSession(u.id);
    if (s.state !== "profile_wizard") return;
    if (s.payload.step !== "location") return;
    s.payload.draft.location = null;
    const lang = await getLang(ctx);
    await ctx.answerCallbackQuery();
    if (await finishSingleFieldEditIfNeeded(ctx, u.id, s.payload, "location")) return;
    if (s.payload.editing && !s.payload.editField) {
      s.payload.step = "bio";
      await setSession(u.id, { state: "profile_wizard", payload: s.payload });
      await ctx.reply(t(lang, "profile.ask.bio"), {
        reply_markup: new InlineKeyboard().text(t(lang, "wizard.skip"), "bio:skip"),
      });
    } else if (!s.payload.editField) {
      await finalizeProfileWizard(ctx, u.id, s.payload.draft, false);
    }
  });

  bot.callbackQuery("bio:skip", async (ctx) => {
    const u = await ensureDbUser(ctx);
    if (!u) return;
    const s = await getSession(u.id);
    if (s.state !== "profile_wizard" || s.payload.step !== "bio") return;
    s.payload.draft.bio = "";
    const lang = await getLang(ctx);
    await ctx.answerCallbackQuery();
    if (await finishSingleFieldEditIfNeeded(ctx, u.id, s.payload, "bio")) return;
    s.payload.step = "personal_traits";
    await setSession(u.id, { state: "profile_wizard", payload: s.payload });
    await ctx.reply(t(lang, "profile.ask.personalTraits"), {
      reply_markup: new InlineKeyboard().text(t(lang, "wizard.skip"), "pt:skip"),
    });
  });

  bot.callbackQuery("pt:skip", async (ctx) => {
    const u = await ensureDbUser(ctx);
    if (!u) return;
    const s = await getSession(u.id);
    if (s.state !== "profile_wizard" || s.payload.step !== "personal_traits") return;
    s.payload.draft.personalTraits = "";
    const lang = await getLang(ctx);
    await ctx.answerCallbackQuery();
    if (await finishSingleFieldEditIfNeeded(ctx, u.id, s.payload, "personal_traits")) return;
    s.payload.step = "partner_traits";
    await setSession(u.id, { state: "profile_wizard", payload: s.payload });
    await ctx.reply(t(lang, "profile.ask.partnerTraits"), {
      reply_markup: new InlineKeyboard().text(t(lang, "wizard.skip"), "qt:skip"),
    });
  });

  bot.callbackQuery("qt:skip", async (ctx) => {
    const u = await ensureDbUser(ctx);
    if (!u) return;
    const s = await getSession(u.id);
    if (s.state !== "profile_wizard" || s.payload.step !== "partner_traits") return;
    s.payload.draft.partnerTraits = "";
    const lang = await getLang(ctx);
    await ctx.answerCallbackQuery();
    if (await finishSingleFieldEditIfNeeded(ctx, u.id, s.payload, "partner_traits")) return;
    s.payload.step = "interests";
    await setSession(u.id, { state: "profile_wizard", payload: s.payload });
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
    kb.text(t(lang, "wizard.done"), cb.interestDone);
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
    kb.text(t(lang, "wizard.done"), cb.interestDone);
    await ctx.editMessageReplyMarkup({ reply_markup: kb });
  });

  bot.callbackQuery(cb.interestDone, async (ctx) => {
    const u = await ensureDbUser(ctx);
    if (!u) return;
    const s = await getSession(u.id);
    if (s.state !== "profile_wizard") return;
    if (s.payload.step !== "interests") return;
    const lang = await getLang(ctx);
    await ctx.answerCallbackQuery();
    if (await finishSingleFieldEditIfNeeded(ctx, u.id, s.payload, "interests")) return;
    s.payload.step = "photos";
    await setSession(u.id, { state: "profile_wizard", payload: s.payload });
    await ctx.reply(t(lang, "profile.ask.photos"), {
      reply_markup: new InlineKeyboard().text(t(lang, "wizard.doneFull"), "photos:done"),
    });
  });

  bot.on("message:photo", async (ctx) => {
    const u = await ensureDbUser(ctx);
    if (!u) return;
    const s = await getSession(u.id);
    const lang = langFromDb(u.language);
    const photos = ctx.msg.photo;
    const best = photos[photos.length - 1];
    const fileId = best!.file_id;

    if (s.state !== "profile_wizard") return;
    if (s.payload.step !== "photos") return;
    const list = s.payload.draft.photoFileIds ?? [];
    if (list.length >= 3) {
      await ctx.reply(t(lang, "photo.max"));
      return;
    }
    list.push(fileId);
    s.payload.draft.photoFileIds = list;
    await setSession(u.id, { state: "profile_wizard", payload: s.payload });
    await ctx.reply(
      tf(lang, "photo.saved", { n: list.length }),
      { reply_markup: new InlineKeyboard().text(t(lang, "wizard.doneFull"), "photos:done") }
    );
  });

  bot.command("done", async (ctx) => {
    const u = await ensureDbUser(ctx);
    if (!u) return;
    const s = await getSession(u.id);
    if (s.state !== "profile_wizard") return;
    if (s.payload.step !== "photos") return;
    await finalizeProfileWizard(ctx, u.id, s.payload.draft, s.payload.editing === true, {
      returnToPicker: !!s.payload.editField,
    });
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
    if (!d.displayName || !d.age || !d.city || !d.country) {
      await ctx.answerCallbackQuery({ text: t(lang, "errors.generic"), show_alert: true });
      return;
    }
    await ctx.answerCallbackQuery();
    await finalizeProfileWizard(ctx, u.id, d, s.payload.editing === true, {
      returnToPicker: !!s.payload.editField,
    });
  });

  bot.callbackQuery(cb.profileEdit, async (ctx) => {
    const u = await ensureDbUser(ctx);
    if (!u) return;
    await ctx.answerCallbackQuery();
    const p = await getProfile(u.id);
    if (!p) {
      const lang = await getLang(ctx);
      const cfgPr = await getBotConfig();
      await ctx.reply(getBotMsg(cfgPr, "no_profile", lang));
      await startProfileWizard(ctx, u.id);
      return;
    }
    await showProfileEditPicker(ctx);
  });

  bot.callbackQuery(/^ped:(.+)$/, async (ctx) => {
    const u = await ensureDbUser(ctx);
    if (!u) return;
    const field = ctx.match?.[1] as ProfileEditField;
    const valid: ProfileEditField[] = [
      "name",
      "age",
      "gender",
      "orientation",
      "looking_for",
      "seek_genders",
      "location",
      "bio",
      "personal_traits",
      "partner_traits",
      "interests",
      "photos",
    ];
    if (!valid.includes(field)) {
      await ctx.answerCallbackQuery();
      return;
    }
    await ctx.answerCallbackQuery();
    await startProfileEditField(ctx, u.id, field);
  });

  bot.callbackQuery(cb.profileEditBack, async (ctx) => {
    const u = await ensureDbUser(ctx);
    if (!u) return;
    await ctx.answerCallbackQuery();
    await resetSession(u.id);
    await renderMyProfile(ctx, u.id);
  });

  bot.callbackQuery(cb.wizardCancel, async (ctx) => {
    const u = await ensureDbUser(ctx);
    if (!u) return;
    const s = await getSession(u.id);
    if (s.state !== "profile_wizard") {
      await ctx.answerCallbackQuery();
      return;
    }
    await ctx.answerCallbackQuery();
    await resetSession(u.id);
    const lang = await getLang(ctx);
    if (s.payload.editing || s.payload.editField) {
      await ctx.reply(t(lang, "profile.editCancelled"));
      await renderMyProfile(ctx, u.id);
    } else {
      await ctx.reply(t(lang, "wizard.cancelled"));
      await sendMainMenuReply(ctx);
    }
  });

  bot.callbackQuery(cb.profile, async (ctx) => {
    const u = await ensureDbUser(ctx);
    if (!u) return;
    await ctx.answerCallbackQuery();
    const p = await getProfile(u.id);
    if (!p) {
      const lang = await getLang(ctx);
      const cfgPr = await getBotConfig();
      await ctx.reply(getBotMsg(cfgPr, "no_profile", lang));
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

  setInterval(async () => {
    try {
      const expiredWait = await expireMysteryWaitSessions();
      for (const ex of expiredWait) {
        try {
          const tgId = await getTelegramIdByUserId(ex.userId);
          if (tgId) {
            const lang = ex.language as Language;
            await bot.api.sendMessage(tgId, t(lang, "mystery.queueExpired"));
          }
        } catch {}
      }
      const expiredVote = await expireMysteryVoteSessions();
      for (const ev of expiredVote) {
        try {
          const tgId = await getTelegramIdByUserId(ev.userId);
          if (tgId) {
            const lang = ev.language as Language;
            await bot.api.sendMessage(tgId, t(lang, "mystery.voteExpired"));
          }
        } catch {}
      }
    } catch {}
  }, 5 * 60 * 1000);

  return bot;
}

function adminLangFromCtx(ctx: MyContext): Language {
  return ctx.from?.language_code?.startsWith("fa") ? "fa" : "en";
}
