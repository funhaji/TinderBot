import { InlineKeyboard } from "grammy";
import type { BotConfigDocument } from "../config/botContent.js";
import { labelForLang } from "../config/botContent.js";
import type { Language } from "../types.js";
import type { ProfilePreferences } from "../db/repo.js";
import { t } from "../i18n/index.js";

export const cb = {
  setLang: (lang: Language) => `lang:${lang}`,
  home: "home",
  profile: "profile",
  discover: "discover",
  settings: "settings",
  likes: "likes",
  matches: "matches",
  share: "share",
  stats: "stats",
  deleteAccount: "delete",
  deleteConfirm: "del:y",
  deleteCancel: "del:n",

  settingsLang: "set:lang",
  settingsVis: "set:vis",
  settingsRad: (meters: number) => `set:rad:${meters}`,
  settingsSeekPick: "set:seek",
  settingsHome: "set:home",
  seekToggle: (g: string) => `seek:${g}`,
  seekDone: "seek:done",

  setToggleVc: "set:vc",
  setToggleNl: "set:nl",
  setToggleNm: "set:nm",
  setToggleRc: "set:rc",
  setToggleRd: "set:rd",

  wizardGender: (g: string) => `wg:${g}`,
  wizardLf: (lf: string) => `wlf:${lf}`,
  wizardSeekToggle: (g: string) => `wsk:${g}`,
  wizardSeekDone: "wsk:done",

  interestToggle: (key: string) => `int:${key}`,
  interestDone: "int:done",

  swipeLike: "sw:like",
  swipeNope: "sw:nope",
  swipeNext: "sw:next",
  swipeReport: "sw:report",

  matchChat: (userId: number) => `mchat:${userId}`,
  likerLikeBack: (userId: number) => `lkback:${userId}`,
};

export function langKeyboard() {
  return new InlineKeyboard()
    .text("فارسی", cb.setLang("fa"))
    .text("English", cb.setLang("en"));
}

export function settingsLangPickKb() {
  return new InlineKeyboard().text("فارسی", "slang:fa").text("English", "slang:en");
}

function onOff(v: boolean | undefined) {
  return v === false ? "❌" : "✅";
}

export function settingsKeyboardFull(
  cfg: BotConfigDocument,
  lang: Language,
  prefs: ProfilePreferences
) {
  const L = (pair: { fa: string; en: string }) => labelForLang(pair, lang);
  const kb = new InlineKeyboard()
    .text(`${onOff(prefs.only_verified_can_like_me)} ${L(cfg.settings.toggles.only_verified)}`, cb.setToggleVc)
    .row()
    .text(`${onOff(prefs.notify_like)} ${L(cfg.settings.toggles.notify_like)}`, cb.setToggleNl)
    .row()
    .text(`${onOff(prefs.notify_match)} ${L(cfg.settings.toggles.notify_match)}`, cb.setToggleNm)
    .row()
    .text(`${onOff(prefs.receive_chat_requests)} ${L(cfg.settings.toggles.receive_chat)}`, cb.setToggleRc)
    .row()
    .text(`${onOff(prefs.receive_direct)} ${L(cfg.settings.toggles.receive_direct)}`, cb.setToggleRd)
    .row()
    .text(t(lang, "settings.language"), cb.settingsLang)
    .row()
    .text(t(lang, "settings.visibilityToggle"), cb.settingsVis)
    .row()
    .text(t(lang, "settings.radius5"), cb.settingsRad(5000))
    .text(t(lang, "settings.radius10"), cb.settingsRad(10000))
    .row()
    .text(t(lang, "settings.radius20"), cb.settingsRad(20000))
    .text(t(lang, "settings.radius50"), cb.settingsRad(50000))
    .row()
    .text(t(lang, "settings.seekGenders"), cb.settingsSeekPick)
    .row()
    .text(t(lang, "settings.back"), cb.settingsHome);
  return kb;
}

export function homeKeyboard(lang: Language) {
  return new InlineKeyboard()
    .text(t(lang, "home.profile"), cb.profile)
    .text(t(lang, "home.discover"), cb.discover)
    .row()
    .text(t(lang, "home.settings"), cb.settings)
    .text(t(lang, "home.likes"), cb.likes)
    .row()
    .text(t(lang, "home.matches"), cb.matches)
    .text(t(lang, "home.share"), cb.share)
    .row()
    .text(t(lang, "home.stats"), cb.stats)
    .text(t(lang, "home.delete"), cb.deleteAccount);
}

export function swipeKeyboard(lang: Language) {
  return new InlineKeyboard()
    .text(t(lang, "discover.nope"), cb.swipeNope)
    .text(t(lang, "discover.like"), cb.swipeLike)
    .row()
    .text(t(lang, "discover.report"), cb.swipeReport)
    .text(t(lang, "discover.next"), cb.swipeNext);
}

export function settingsKeyboard(lang: Language) {
  return new InlineKeyboard()
    .text(t(lang, "settings.language"), cb.settingsLang)
    .row()
    .text(t(lang, "settings.visibilityToggle"), cb.settingsVis)
    .row()
    .text(t(lang, "settings.radius5"), cb.settingsRad(5000))
    .text(t(lang, "settings.radius10"), cb.settingsRad(10000))
    .row()
    .text(t(lang, "settings.radius20"), cb.settingsRad(20000))
    .text(t(lang, "settings.radius50"), cb.settingsRad(50000))
    .row()
    .text(t(lang, "settings.seekGenders"), cb.settingsSeekPick)
    .row()
    .text(t(lang, "settings.back"), cb.settingsHome);
}

export function seekGenderKeyboard(lang: Language, selected: Set<string>) {
  const kb = new InlineKeyboard();
  const opts = [
    { key: "m", fa: "مرد", en: "Men" },
    { key: "f", fa: "زن", en: "Women" },
    { key: "x", fa: "سایر", en: "Other" },
  ];
  for (const o of opts) {
    const label = (selected.has(o.key) ? "✅ " : "") + (lang === "fa" ? o.fa : o.en);
    kb.text(label, cb.seekToggle(o.key)).row();
  }
  kb.text(lang === "fa" ? "تمام" : "Done", cb.seekDone);
  return kb;
}

export function wizardGenderKeyboard(lang: Language) {
  return new InlineKeyboard()
    .text(t(lang, "profile.gender.m"), cb.wizardGender("m"))
    .text(t(lang, "profile.gender.f"), cb.wizardGender("f"))
    .row()
    .text(t(lang, "profile.gender.x"), cb.wizardGender("x"))
    .text(t(lang, "profile.gender.skip"), cb.wizardGender("skip"));
}

export function wizardLookingForKeyboard(lang: Language) {
  return new InlineKeyboard()
    .text(t(lang, "profile.lf.friends"), cb.wizardLf("friends"))
    .text(t(lang, "profile.lf.dating"), cb.wizardLf("dating"))
    .row()
    .text(t(lang, "profile.lf.both"), cb.wizardLf("both"));
}

export function wizardSeekKeyboard(lang: Language, selected: Set<string>) {
  const kb = new InlineKeyboard();
  const opts = [
    { key: "m", fa: "مرد", en: "Men" },
    { key: "f", fa: "زن", en: "Women" },
    { key: "x", fa: "سایر", en: "Other" },
  ];
  for (const o of opts) {
    const label = (selected.has(o.key) ? "✅ " : "") + (lang === "fa" ? o.fa : o.en);
    kb.text(label, cb.wizardSeekToggle(o.key)).row();
  }
  kb.text(lang === "fa" ? "تمام" : "Done", cb.wizardSeekDone);
  return kb;
}
